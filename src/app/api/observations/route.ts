/**
 * POST /api/observations
 *
 * Record a new observation on an incident and, unless `analyze` is false, run
 * the full memory cycle: embed -> retrieve from CockroachDB -> ground Bedrock
 * -> validate -> persist a recommendation.
 */

import { getStore } from '@/lib/store';
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
import { createObservationSchema, parseInput } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Bedrock round-trips can take a while on cold model invocations.
export const maxDuration = 60;

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request, 'observations'), 30);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(createObservationSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    const store = getStore();
    const incident = await store.getIncident(parsed.data.incidentId);
    if (!incident) {
      return json({ error: `Incident ${parsed.data.incidentId} not found` }, { status: 404 });
    }

    const event = await store.appendMemoryEvent({
      incidentId: incident.id,
      eventType: 'observation',
      actorType: parsed.data.actorType,
      actorName: parsed.data.actorName,
      content: parsed.data.content,
      metadata: { source: 'command-center' },
    });

    if (!parsed.data.analyze) {
      return json({ event, analysis: null, mode: runtimeMode() }, { status: 201 });
    }

    const analysis = await analyzeAndRecommend({
      incidentId: incident.id,
      trigger: parsed.data.content,
      triggerKind: 'observation',
      actorName: parsed.data.actorName,
    });

    return json({ event, analysis, mode: runtimeMode() }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'observations:create');
  }
}
