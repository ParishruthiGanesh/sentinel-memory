/**
 * GET /api/health
 *
 * Reports application, CockroachDB and Bedrock configuration status.
 *
 * Redaction contract: this endpoint returns booleans, non-secret identifiers
 * (region, model id, hostname) and error *messages* only. It never returns
 * DATABASE_URL, AWS keys, session tokens, or any value that could be replayed.
 * `tests/health.test.ts` asserts that contract.
 */

import { describeConfig } from '@/lib/env';
import { getStore } from '@/lib/store';
import { getEmbeddingProvider } from '@/lib/ai/embeddings';
import { json, runtimeMode } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface HealthPayload {
  status: 'ok' | 'degraded';
  timestamp: string;
  mode: ReturnType<typeof runtimeMode>;
  config: ReturnType<typeof describeConfig>;
  database: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    version: string | null;
    vectorIndexPresent: boolean | null;
    memoryCount: number | null;
    error: string | null;
  };
  bedrock: {
    configured: boolean;
    region: string | null;
    modelId: string | null;
    embeddingModelId: string | null;
    /** What is actually producing vectors right now. */
    activeEmbeddingProvider: string;
    embeddingDimensions: number;
  };
  notices: string[];
}

export async function GET() {
  const config = describeConfig();
  const mode = runtimeMode();
  const store = getStore();
  const embeddings = getEmbeddingProvider();

  const health = config.database.configured
    ? await store.health()
    : { ok: false, latencyMs: 0, error: 'DATABASE_URL is not configured' };

  const notices: string[] = [];
  if (!config.database.configured) {
    notices.push(
      'No DATABASE_URL configured — running on the in-memory demo store. Data is not persisted and this is not a database integration.',
    );
  } else if (!health.ok) {
    notices.push('DATABASE_URL is configured but the cluster could not be reached.');
  } else if (health.vectorIndexPresent === false) {
    notices.push(
      'CockroachDB is connected but no vector index was found on memory_embeddings. Similarity search falls back to an exact scan. Requires CockroachDB v25.2+ (see db/migrations/002_vector_index.sql).',
    );
  }
  if (!config.bedrock.configured) {
    notices.push(
      'Amazon Bedrock is not configured — recommendations are produced by the local rule-based fallback, which performs no language modelling.',
    );
  }
  if (!config.bedrock.embeddingsConfigured) {
    notices.push(
      'No Bedrock embedding model configured — vectors come from the deterministic local provider (a hashed-feature projection, not a learned model).',
    );
  }

  const payload: HealthPayload = {
    status: notices.length === 0 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    mode,
    config,
    database: {
      configured: config.database.configured,
      reachable: health.ok,
      latencyMs: health.ok ? health.latencyMs : null,
      version: health.version ?? null,
      vectorIndexPresent: health.vectorIndexPresent ?? null,
      memoryCount: health.memoryCount ?? null,
      error: health.error ?? null,
    },
    bedrock: {
      configured: config.bedrock.configured,
      region: config.bedrock.region,
      modelId: config.bedrock.modelId,
      embeddingModelId: config.bedrock.embeddingModelId,
      activeEmbeddingProvider: embeddings.modelLabel,
      embeddingDimensions: embeddings.dimensions,
    },
    notices,
  };

  return json(payload);
}
