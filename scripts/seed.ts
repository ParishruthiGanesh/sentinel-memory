/**
 * Seed CockroachDB from the canonical corpus in src/lib/seed-data.ts.
 *
 * Embeddings are generated with the configured provider (Amazon Bedrock when
 * BEDROCK_EMBEDDING_MODEL_ID is set, otherwise the deterministic local
 * fallback) and written into the VECTOR column so the vector index is exercised
 * by the very first query the demo runs.
 *
 * The script is idempotent: fixed UUIDs plus ON CONFLICT DO UPDATE mean it can
 * be re-run safely.
 */

import { Client } from 'pg';
import { env } from '../src/lib/env';
import { getEmbeddingProvider } from '../src/lib/ai/embeddings';
import { embeddableText } from '../src/lib/store/demo-store';
import {
  SEED_ACTIVE_INCIDENT,
  SEED_AGENTS,
  SEED_HISTORICAL_INCIDENTS,
  SEED_PROCEDURE_MEMORIES,
  SEED_SAFETY_RULES,
  type SeedIncident,
} from '../src/lib/seed-data';

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => value.toFixed(6)).join(',')}]`;
}

function offsetIso(base: string, minutes: number): string {
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

async function main(): Promise<void> {
  const connectionString = env.databaseUrl;
  if (!connectionString) {
    console.error(
      '\n  DATABASE_URL is not set — nothing to seed.\n\n' +
        '  Without a database the app runs on the in-memory demo store, which loads\n' +
        '  this same corpus automatically. Set DATABASE_URL to seed CockroachDB.\n',
    );
    process.exit(1);
  }

  const provider = getEmbeddingProvider();
  console.log(`→ embedding provider: ${provider.id} (${provider.modelLabel})`);
  console.log(`  vector width: ${provider.dimensions}`);
  if (provider.id === 'local-deterministic') {
    console.log(
      '  NOTE: BEDROCK_EMBEDDING_MODEL_ID is not configured, so the deterministic\n' +
        '        local fallback is being used. This is a hashed-feature projection,\n' +
        '        not a learned embedding model. Set BEDROCK_EMBEDDING_MODEL_ID and\n' +
        '        re-run this script to store real Bedrock embeddings.',
    );
  }

  const client = new Client({
    connectionString,
    application_name: 'sentinel-memory-seed',
    ssl: /sslmode=(require|verify-ca|verify-full)/.test(connectionString)
      ? { rejectUnauthorized: true }
      : undefined,
  });
  await client.connect();

  try {
    // --- agents ------------------------------------------------------------
    for (const agent of SEED_AGENTS) {
      await client.query(
        `INSERT INTO agents (id, name, role, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
           SET name = excluded.name, role = excluded.role, status = excluded.status`,
        [agent.id, agent.name, agent.role, agent.status],
      );
    }
    console.log(`✓ agents: ${SEED_AGENTS.length}`);

    // --- safety rules ------------------------------------------------------
    for (const rule of SEED_SAFETY_RULES) {
      await client.query(
        `INSERT INTO safety_rules
           (id, name, description, action_pattern, enforcement_level, requires_human_approval, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (id) DO UPDATE
           SET name = excluded.name,
               description = excluded.description,
               action_pattern = excluded.action_pattern,
               enforcement_level = excluded.enforcement_level,
               requires_human_approval = excluded.requires_human_approval,
               active = true`,
        [
          rule.id,
          rule.name,
          rule.description,
          rule.actionPattern,
          rule.enforcementLevel,
          rule.requiresHumanApproval,
        ],
      );
    }
    console.log(`✓ safety rules: ${SEED_SAFETY_RULES.length}`);

    // --- incidents, observations, memories ---------------------------------
    let memoryCount = 0;

    const seedIncident = async (incident: SeedIncident) => {
      await client.query(
        `INSERT INTO incidents
           (id, incident_code, title, description, location, severity, status,
            current_phase, assigned_agent_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (id) DO UPDATE
           SET title = excluded.title,
               description = excluded.description,
               location = excluded.location,
               severity = excluded.severity,
               status = excluded.status,
               current_phase = excluded.current_phase,
               assigned_agent_id = excluded.assigned_agent_id`,
        [
          incident.id,
          incident.incidentCode,
          incident.title,
          incident.description,
          incident.location,
          incident.severity,
          incident.status,
          incident.currentPhase,
          incident.assignedAgentId,
          incident.occurredAt,
        ],
      );

      for (const observation of incident.observations) {
        await client.query(
          `INSERT INTO memory_events
             (id, incident_id, event_type, actor_type, actor_name, content, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, '{}'::JSONB, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            observation.id,
            incident.id,
            observation.eventType,
            observation.actorType,
            observation.actorName,
            observation.content,
            offsetIso(incident.occurredAt, observation.offsetMinutes),
          ],
        );
      }

      for (const memory of incident.memories) {
        const vector = await provider.embed(embeddableText(memory));
        await client.query(
          `INSERT INTO memory_embeddings
             (id, incident_id, memory_type, source_text, embedding, action_taken,
              outcome, lesson_learned, severity, created_at)
           VALUES ($1, $2, $3, $4, $5::VECTOR, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE
             SET source_text = excluded.source_text,
                 embedding = excluded.embedding,
                 action_taken = excluded.action_taken,
                 outcome = excluded.outcome,
                 lesson_learned = excluded.lesson_learned,
                 severity = excluded.severity`,
          [
            memory.id,
            incident.id,
            memory.memoryType,
            memory.sourceText,
            vectorLiteral(vector),
            memory.actionTaken,
            memory.outcome,
            memory.lessonLearned,
            memory.severity,
            incident.occurredAt,
          ],
        );
        memoryCount += 1;
      }
    };

    for (const incident of SEED_HISTORICAL_INCIDENTS) await seedIncident(incident);
    await seedIncident(SEED_ACTIVE_INCIDENT);
    console.log(
      `✓ incidents: ${SEED_HISTORICAL_INCIDENTS.length} historical + 1 active (${SEED_ACTIVE_INCIDENT.incidentCode})`,
    );

    // --- standing procedures (semantic memory not tied to an incident) ------
    for (const memory of SEED_PROCEDURE_MEMORIES) {
      const vector = await provider.embed(embeddableText(memory));
      await client.query(
        `INSERT INTO memory_embeddings
           (id, incident_id, memory_type, source_text, embedding, action_taken,
            outcome, lesson_learned, severity)
         VALUES ($1, NULL, $2, $3, $4::VECTOR, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE
           SET source_text = excluded.source_text,
               embedding = excluded.embedding,
               lesson_learned = excluded.lesson_learned,
               severity = excluded.severity`,
        [
          memory.id,
          memory.memoryType,
          memory.sourceText,
          vectorLiteral(vector),
          memory.actionTaken,
          memory.outcome,
          memory.lessonLearned,
          memory.severity,
        ],
      );
      memoryCount += 1;
    }

    console.log(`✓ vector memories: ${memoryCount}`);

    // --- verification ------------------------------------------------------
    const counts = await client.query<{ table: string; n: string }>(
      `SELECT 'incidents' AS table, count(*)::string AS n FROM incidents
       UNION ALL SELECT 'memory_events', count(*)::string FROM memory_events
       UNION ALL SELECT 'memory_embeddings', count(*)::string FROM memory_embeddings
       UNION ALL SELECT 'safety_rules', count(*)::string FROM safety_rules
       UNION ALL SELECT 'agents', count(*)::string FROM agents`,
    );
    console.log('\nRow counts:');
    for (const row of counts.rows) console.log(`  ${row.table.padEnd(20)} ${row.n}`);

    // Prove the retrieval path works against the freshly seeded data.
    const probe = await provider.embed(
      'Smoke detected near Machine 7. Responder is considering restarting Machine 7 to clear the fault.',
    );
    const retrieved = await client.query<{ incident_code: string; distance: string }>(
      `SELECT i.incident_code, (m.embedding <=> $1::VECTOR)::string AS distance
       FROM memory_embeddings m
       LEFT JOIN incidents i ON i.id = m.incident_id
       WHERE m.incident_id IS DISTINCT FROM $2
       ORDER BY m.embedding <=> $1::VECTOR
       LIMIT 3`,
      [vectorLiteral(probe), SEED_ACTIVE_INCIDENT.id],
    );
    console.log('\nRetrieval smoke test — closest memories to the demo query:');
    for (const row of retrieved.rows) {
      const similarity = ((1 - Number(row.distance)) * 100).toFixed(1);
      console.log(`  ${(row.incident_code ?? 'PROCEDURE').padEnd(16)} ${similarity}% similar`);
    }

    console.log('\n✓ Seed complete. Start the app with `npm run dev`.\n');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('\nSeeding failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
