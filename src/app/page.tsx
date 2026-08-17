/**
 * Incident Command Center.
 *
 * The initial retrieval runs on the server so the counterfactual memory card is
 * already on screen when the page paints — the whole product thesis has to be
 * legible in the first five seconds, not after a click.
 */

import { getStore } from '@/lib/store';
import { loadShellData, selectIncident } from '@/lib/server-data';
import { buildRetrievalQuery, retrieveMemories } from '@/lib/agent/orchestrator';
import { CommandCenter } from '@/components/command-center';
import { EmptyState, Panel } from '@/components/ui';
import { DEMO_PROPOSED_ACTION, DEMO_QUICK_OBSERVATIONS } from '@/lib/seed-data';
import type { RetrievalResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string }>;
}) {
  const { incident: requested } = await searchParams;
  const { incidents, status, responder } = await loadShellData();
  const incident = selectIncident(incidents, requested);

  if (!incident) {
    return (
      <div className="p-4">
        <Panel title="No incidents">
          <EmptyState
            title="There are no incidents in the system of record."
            hint="Run `npm run db:migrate && npm run db:seed` to load the demo corpus, or open a new incident from the top bar."
          />
        </Panel>
      </div>
    );
  }

  const store = getStore();
  const [events, recommendations, safetyRules] = await Promise.all([
    store.listMemoryEvents(incident.id, 300),
    store.listRecommendations(incident.id),
    store.listSafetyRules(),
  ]);

  const latestObservation = [...events]
    .reverse()
    .find((event) => event.eventType === 'observation');

  let initialRetrieval: RetrievalResult;
  try {
    initialRetrieval = await retrieveMemories(
      buildRetrievalQuery(incident, latestObservation?.content ?? incident.description),
      { limit: 3, excludeIncidentId: incident.id },
    );
  } catch (error) {
    // Retrieval must never take the whole page down — the incident record is
    // still the most important thing on screen.
    console.error('[command-center] initial retrieval failed:', error);
    initialRetrieval = {
      memories: [],
      latencyMs: 0,
      memoriesSearched: 0,
      vectorIndexUsed: false,
      embeddingProvider: status.mode.embeddings,
      embeddingDimensions: status.embeddingDimensions,
      query: incident.description,
    };
  }

  return (
    <CommandCenter
      // Remounting on incident change resets the client component's local state
      // from the new server props — no reset effect required.
      key={incident.id}
      incident={incident}
      events={events}
      pendingRecommendation={recommendations.find((rec) => rec.status === 'pending') ?? null}
      latestDecidedRecommendation={
        recommendations.find((rec) => rec.status === 'approved' || rec.status === 'rejected') ?? null
      }
      safetyRules={safetyRules}
      initialRetrieval={initialRetrieval}
      responder={responder}
      quickObservations={DEMO_QUICK_OBSERVATIONS}
      demoProposedAction={DEMO_PROPOSED_ACTION}
      demoMode={status.mode.demoMode}
      storeKind={store.kind}
    />
  );
}
