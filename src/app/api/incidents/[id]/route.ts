/**
 * GET /api/incidents/:id
 *
 * The full incident view, reconstructed from durable CockroachDB memory:
 * incident record, memory events, recommendations, human decisions,
 * contradictions, handoffs and the audit trail.
 */

import { getStore } from '@/lib/store';
import { errorResponse, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = getStore();

    const incident = await store.getIncident(id);
    if (!incident) {
      return json({ error: `Incident ${id} not found` }, { status: 404 });
    }

    const [events, recommendations, decisions, contradictions, handoffs, audit, safetyRules, agents] =
      await Promise.all([
        store.listMemoryEvents(id, 300),
        store.listRecommendations(id),
        store.listDecisions(id),
        store.listContradictions(id),
        store.listHandoffs(id),
        store.listAuditEvents(id, 300),
        store.listSafetyRules(),
        store.listAgents(),
      ]);

    return json({
      incident,
      events,
      recommendations,
      decisions,
      contradictions,
      handoffs,
      audit,
      safetyRules,
      agents,
      pendingRecommendation: recommendations.find((rec) => rec.status === 'pending') ?? null,
    });
  } catch (error) {
    return errorResponse(error, 'incidents:get');
  }
}
