/**
 * POST /api/memory/search
 *
 * Semantic search across Sentinel's durable memory, backed by CockroachDB's
 * distributed vector index. Returns similarity scores and query telemetry so
 * the retrieval is visible rather than hidden behind a generated answer.
 */

import { retrieveMemories } from '@/lib/agent/orchestrator';
import {
  badRequest,
  checkRateLimit,
  clientKey,
  errorResponse,
  json,
  rateLimited,
  readJson,
  runtimeMode,
} from '@/lib/api';
import { memorySearchSchema, parseInput } from '@/lib/validation';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request, 'memory-search'), 60);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(memorySearchSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    const store = getStore();
    const [retrieval, totalMemories] = await Promise.all([
      retrieveMemories(parsed.data.query, {
        limit: parsed.data.limit,
        filters: parsed.data.filters,
        // Explorer results are richer when a single incident can contribute
        // more than one memory (summary + lesson), so relax diversification.
        maxPerIncident: 2,
      }),
      store.countMemories(),
    ]);

    return json({
      retrieval,
      totalMemories,
      mode: runtimeMode(),
      source: store.kind === 'cockroachdb'
        ? 'CockroachDB distributed vector index'
        : 'In-memory demo store (no database configured)',
    });
  } catch (error) {
    return errorResponse(error, 'memory:search');
  }
}
