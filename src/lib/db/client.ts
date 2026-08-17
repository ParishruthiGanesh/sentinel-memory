/**
 * CockroachDB connection handling.
 *
 * Two things matter here and are deliberately isolated so they can be unit
 * tested without a live cluster:
 *
 *  1. `withTransaction` — runs a unit of work inside BEGIN/COMMIT and retries
 *     the *whole* transaction when CockroachDB reports a serialization conflict
 *     (SQLSTATE 40001). Under SERIALIZABLE isolation that retry is the
 *     application's responsibility, and safety-critical writes here are exactly
 *     the transactions most likely to contend.
 *  2. `RETRYABLE_CODES` — the narrow set of errors we retry. Everything else
 *     rolls back and propagates.
 */

import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '@/lib/env';

/** 40001 = serialization_failure, 40003 = statement_completion_unknown. */
export const RETRYABLE_CODES = new Set(['40001', '40003', '08006', '08003', '57P01']);

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = env.databaseUrl;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured; cannot open a CockroachDB pool.');
  }

  const config: PoolConfig = {
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'sentinel-memory',
  };

  // CockroachDB Cloud requires TLS. `sslmode=verify-full` in the DSN uses the
  // system CA store via the `ssl` option below.
  if (/sslmode=(require|verify-ca|verify-full)/.test(connectionString)) {
    config.ssl = { rejectUnauthorized: true };
  }

  pool = new Pool(config);
  pool.on('error', (error) => {
    console.error('[db] idle client error:', error.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function isRetryable(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && RETRYABLE_CODES.has(code);
}

export interface TransactionOptions {
  maxAttempts?: number;
  /** Base backoff in ms; grows exponentially with jitter. */
  baseDelayMs?: number;
  /** Injected for tests — defaults to a client from the shared pool. */
  connect?: () => Promise<PoolClient>;
  /** Injected for tests so retries do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `work` inside a single CockroachDB transaction.
 *
 * On a retryable error the transaction is rolled back and the entire `work`
 * function is re-executed — which is why `work` must be free of side effects
 * outside the passed transaction handle.
 */
export async function withTransaction<T>(
  work: (tx: Queryable) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const sleep = options.sleep ?? defaultSleep;
  const connect = options.connect ?? (() => getPool().connect());

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      lastError = error;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[db] rollback failed:', rollbackError);
      }

      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff with full jitter.
      const ceiling = baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.floor(Math.random() * ceiling) + 1);
    } finally {
      client.release();
    }
  }

  throw lastError;
}

/** Format a JS number[] as a CockroachDB VECTOR literal. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value.toFixed(6) : '0')).join(',')}]`;
}
