/**
 * POST /api/recommendations/:id/decision
 *
 * The safety-critical write path. A single CockroachDB transaction:
 *   1. inserts the approval/rejection record,
 *   2. updates the recommendation status,
 *   3. appends the immutable audit event,
 *   4. updates the incident's current state.
 *
 * If any step fails the whole thing rolls back — a recommendation can never
 * read as "approved" without the matching audit trail and incident state.
 *
 * Approving here records a human authorization. It does not actuate equipment;
 * Sentinel has no machinery control path.
 */

import { getStore } from '@/lib/store';
import {
  badRequest,
  checkRateLimit,
  clientKey,
  errorResponse,
  json,
  rateLimited,
  readJson,
} from '@/lib/api';
import { decisionSchema, parseInput } from '@/lib/validation';
import type { IncidentPhase } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On approval the incident advances one phase toward recovery. Approving does
 * not resolve an incident — a responder closes it explicitly.
 */
const PHASE_PROGRESSION: Record<IncidentPhase, IncidentPhase> = {
  detection: 'assessment',
  assessment: 'containment',
  containment: 'stabilization',
  stabilization: 'recovery',
  recovery: 'review',
  review: 'review',
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit(clientKey(request, 'decision'), 30);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const { id } = await context.params;

    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(decisionSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    const store = getStore();
    const existing = await store.getRecommendation(id);
    if (!existing) return json({ error: `Recommendation ${id} not found` }, { status: 404 });

    const incident = await store.getIncident(existing.incidentId);
    const nextPhase = incident ? PHASE_PROGRESSION[incident.currentPhase] : undefined;

    const outcome = await store.decideRecommendation({
      recommendationId: id,
      decision: parsed.data.decision,
      decidedBy: parsed.data.decidedBy,
      reason: parsed.data.reason,
      nextPhase,
    });

    return json({
      ...outcome,
      transaction: {
        atomic: true,
        writes: [
          'action_decisions insert',
          'recommendations status update',
          'audit_events insert',
          'incidents state update',
          'memory_events append',
        ],
        store: store.kind,
      },
    });
  } catch (error) {
    return errorResponse(error, 'recommendations:decision');
  }
}
