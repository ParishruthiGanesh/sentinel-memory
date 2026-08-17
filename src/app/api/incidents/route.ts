/**
 * GET  /api/incidents  — list incidents (newest active first)
 * POST /api/incidents  — open a new incident
 */

import { getStore } from '@/lib/store';
import { badRequest, checkRateLimit, clientKey, errorResponse, json, rateLimited, readJson } from '@/lib/api';
import { createIncidentSchema, parseInput } from '@/lib/validation';
import { defaultResponder } from '@/lib/agent/orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const incidents = await getStore().listIncidents();
    return json({ incidents });
  } catch (error) {
    return errorResponse(error, 'incidents:list');
  }
}

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request, 'incidents:create'), 10);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(createIncidentSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    const incident = await getStore().createIncident({
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      severity: parsed.data.severity,
      currentPhase: parsed.data.currentPhase,
      reportedBy: parsed.data.reportedBy ?? defaultResponder(),
    });

    return json({ incident }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'incidents:create');
  }
}
