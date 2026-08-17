/**
 * Schema migration runner.
 *
 * Usage:
 *   npm run db:migrate          apply all migrations
 *   npm run db:migrate -- --drop  drop every Sentinel table first (destructive)
 *
 * The vector-index migration is applied separately and is allowed to fail with
 * a clear message: vector index support is CockroachDB version-gated, and the
 * application degrades to an exact scan without it.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { env } from '../src/lib/env';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

const TABLES_IN_DROP_ORDER = [
  'audit_events',
  'incident_handoffs',
  'contradictions',
  'action_decisions',
  'recommendations',
  'memory_embeddings',
  'memory_events',
  'safety_rules',
  'incidents',
  'agents',
];

async function main(): Promise<void> {
  const connectionString = env.databaseUrl;
  if (!connectionString) {
    console.error(
      '\n  DATABASE_URL is not set.\n\n' +
        '  Copy .env.example to .env.local and set DATABASE_URL to your CockroachDB\n' +
        '  Cloud connection string, then re-run `npm run db:migrate`.\n',
    );
    process.exit(1);
  }

  const drop = process.argv.includes('--drop');
  const client = new Client({
    connectionString,
    application_name: 'sentinel-memory-migrate',
    ssl: /sslmode=(require|verify-ca|verify-full)/.test(connectionString)
      ? { rejectUnauthorized: true }
      : undefined,
  });

  await client.connect();
  console.log(`→ connected to CockroachDB`);

  try {
    const version = await client.query<{ version: string }>('SELECT version() AS version');
    console.log(`  ${version.rows[0]?.version?.split(',')[0] ?? 'unknown version'}`);

    if (drop) {
      console.log('→ dropping existing Sentinel tables (--drop)');
      for (const table of TABLES_IN_DROP_ORDER) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
    }

    // --- core schema -------------------------------------------------------
    const dimensions = env.embeddingDimensions;
    const initSql = (await readFile(join(MIGRATIONS_DIR, '001_init.sql'), 'utf8')).replaceAll(
      '{{EMBEDDING_DIM}}',
      String(dimensions),
    );

    console.log(`→ applying 001_init.sql (VECTOR(${dimensions}))`);
    await client.query(initSql);
    console.log('  core schema applied');

    // --- vector index (version-gated) --------------------------------------
    const vectorSql = await readFile(join(MIGRATIONS_DIR, '002_vector_index.sql'), 'utf8');
    console.log('→ applying 002_vector_index.sql');
    try {
      // Enable the v25.2 preview gate when the cluster exposes it. Older/newer
      // versions simply do not have the setting, which is not an error for us.
      try {
        await client.query('SET CLUSTER SETTING feature.vector_index.enabled = true');
        console.log('  enabled feature.vector_index.enabled (v25.2 preview gate)');
      } catch {
        // Setting absent (v25.3+ GA) or insufficient privileges — continue.
      }

      await client.query(stripSqlComments(vectorSql));
      console.log('  distributed vector index created');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        '\n  ! Vector index was NOT created.\n' +
          `    Reason: ${message}\n` +
          '    CockroachDB v25.2+ is required (v25.2 also needs\n' +
          '    `SET CLUSTER SETTING feature.vector_index.enabled = true`).\n' +
          '    The app still works — similarity search falls back to an exact scan\n' +
          '    and /api/health reports vectorIndexPresent: false.\n',
      );
    }

    // --- verification ------------------------------------------------------
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ANY($1::STRING[])
       ORDER BY table_name`,
      [TABLES_IN_DROP_ORDER],
    );
    console.log(`\n✓ ${tables.rows.length}/${TABLES_IN_DROP_ORDER.length} tables present:`);
    console.log(`  ${tables.rows.map((row) => row.table_name).join(', ')}`);
    console.log('\nNext: npm run db:seed\n');
  } finally {
    await client.end();
  }
}

/** Remove `--` comments so the whole file can be sent as one statement batch. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim();
}

main().catch((error) => {
  console.error('\nMigration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
