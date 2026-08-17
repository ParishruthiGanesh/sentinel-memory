/**
 * GET /api/timeline?incidentId=…
 *
 * The reconstructed incident timeline. Every entry is a durable memory event or
 * audit record read back out of the store — nothing is held in application
 * memory between requests.
 */

import { getStore } from '@/lib/store';
import { badRequest, errorResponse, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const incidentId = new URL(request.url).searchParams.get('incidentId');
    if (!incidentId) return badRequest('incidentId query parameter is required');

    const store = getStore();
    const incident = await store.getIncident(incidentId);
    if (!incident) return json({ error: `Incident ${incidentId} not found` }, { status: 404 });

    const [events, audit] = await Promise.all([
      store.listMemoryEvents(incidentId, 300),
      store.listAuditEvents(incidentId, 300),
    ]);

    return json({
      incident,
      events,
      audit,
      source: store.kind,
      note: 'This timeline is reconstructed from durable memory events, not from a session transcript.',
    });
  } catch (error) {
    return errorResponse(error, 'timeline:get');
  }
}
