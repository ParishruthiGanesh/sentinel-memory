/**
 * GET  /api/handoffs?incidentId=…  — list stored handoffs
 * POST /api/handoffs               — reconstruct incident state from durable
 *                                     memory, generate a continuity briefing
 *                                     and store it in CockroachDB.
 */

import { generateHandoff } from '@/lib/agent/orchestrator';
import { getStore } from '@/lib/store';
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
import { handoffSchema, parseInput } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const incidentId = new URL(request.url).searchParams.get('incidentId');
    if (!incidentId) return badRequest('incidentId query parameter is required');

    const store = getStore();
    const [handoffs, agents] = await Promise.all([
      store.listHandoffs(incidentId),
      store.listAgents(),
    ]);
    return json({ handoffs, agents });
  } catch (error) {
    return errorResponse(error, 'handoffs:list');
  }
}

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request, 'handoffs'), 10);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(handoffSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    if (parsed.data.fromAgentId === parsed.data.toAgentId) {
      return badRequest('An incident cannot be handed off to the same agent');
    }

    const result = await generateHandoff(parsed.data);
    return json({ ...result, mode: runtimeMode() }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'handoffs:create');
  }
}
