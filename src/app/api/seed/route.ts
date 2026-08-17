/**
 * GET /api/seed
 *
 * Reports whether the seed corpus is present and, when it is not, exactly which
 * command loads it.
 *
 * This endpoint is intentionally READ-ONLY. Seeding writes to the system of
 * record, so it is a deliberate operator action (`npm run db:seed`) run with
 * database credentials — not something an unauthenticated HTTP caller can
 * trigger against a live incident database.
 */

import { getStore } from '@/lib/store';
import { errorResponse, json, runtimeMode } from '@/lib/api';
import {
  SEED_ACTIVE_INCIDENT,
  SEED_HISTORICAL_INCIDENTS,
  SEED_PROCEDURE_MEMORIES,
  DEMO_MEMORY_QUERY,
  DEMO_PROPOSED_ACTION,
  DEMO_QUICK_OBSERVATIONS,
} from '@/lib/seed-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const store = getStore();
    const [incidents, memoryCount] = await Promise.all([
      store.listIncidents(),
      store.countMemories(),
    ]);

    const expectedMemories =
      SEED_HISTORICAL_INCIDENTS.reduce((total, incident) => total + incident.memories.length, 0) +
      SEED_PROCEDURE_MEMORIES.length;

    const activeIncident = incidents.find(
      (incident) => incident.incidentCode === SEED_ACTIVE_INCIDENT.incidentCode,
    );

    return json({
      mode: runtimeMode(),
      store: store.kind,
      seeded: Boolean(activeIncident) && memoryCount >= expectedMemories,
      counts: {
        incidents: incidents.length,
        memories: memoryCount,
        expectedHistoricalIncidents: SEED_HISTORICAL_INCIDENTS.length,
        expectedMemories,
      },
      activeIncident: activeIncident
        ? { id: activeIncident.id, incidentCode: activeIncident.incidentCode }
        : null,
      demo: {
        quickObservations: DEMO_QUICK_OBSERVATIONS,
        proposedAction: DEMO_PROPOSED_ACTION,
        memoryQuery: DEMO_MEMORY_QUERY,
      },
      howToSeed:
        store.kind === 'cockroachdb'
          ? 'Run `npm run db:migrate && npm run db:seed` with DATABASE_URL set.'
          : 'No DATABASE_URL configured. The in-memory demo store loads this corpus automatically on boot; set DATABASE_URL to persist it in CockroachDB.',
    });
  } catch (error) {
    return errorResponse(error, 'seed:status');
  }
}
