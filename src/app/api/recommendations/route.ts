/**
 * POST /api/recommendations
 *
 * Submit an action the responder is *considering*. Sentinel retrieves what
 * similar actions actually caused and returns a grounded recommendation —
 * which may be a warning against the proposed action itself.
 *
 * Nothing here actuates anything. The response is decision support.
 */

import { analyzeAndRecommend } from '@/lib/agent/orchestrator';
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
import { parseInput, proposeActionSchema } from '@/lib/validation';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request, 'recommendations'), 30);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(proposeActionSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    const store = getStore();

    // Record what the responder proposed, so the timeline shows the human's
    // intent alongside Sentinel's response to it.
    await store.appendMemoryEvent({
      incidentId: parsed.data.incidentId,
      eventType: 'note',
      actorType: 'human',
      actorName: parsed.data.requestedBy,
      content: `Responder is considering: ${parsed.data.proposedAction}`,
      metadata: { kind: 'proposed_action' },
    });

    const analysis = await analyzeAndRecommend({
      incidentId: parsed.data.incidentId,
      trigger: parsed.data.proposedAction,
      triggerKind: 'proposed_action',
      actorName: parsed.data.requestedBy,
    });

    return json({ analysis, mode: runtimeMode() }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'recommendations:create');
  }
}

export async function GET(request: Request) {
  try {
    const incidentId = new URL(request.url).searchParams.get('incidentId');
    if (!incidentId) return badRequest('incidentId query parameter is required');
    const recommendations = await getStore().listRecommendations(incidentId);
    return json({ recommendations });
  } catch (error) {
    return errorResponse(error, 'recommendations:list');
  }
}
