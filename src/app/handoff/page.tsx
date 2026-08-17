import { getStore } from '@/lib/store';
import { loadShellData, selectIncident } from '@/lib/server-data';
import { HandoffCenter } from '@/components/handoff-center';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function HandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string }>;
}) {
  const { incident: requested } = await searchParams;
  const { incidents, agents } = await loadShellData();
  const incident = selectIncident(incidents, requested);

  if (!incident) {
    return (
      <div className="p-4">
        <Panel title="No incidents">
          <EmptyState title="There is no incident to hand off." />
        </Panel>
      </div>
    );
  }

  const store = getStore();
  const [handoffs, events, decisions] = await Promise.all([
    store.listHandoffs(incident.id),
    store.listMemoryEvents(incident.id, 300),
    store.listDecisions(incident.id),
  ]);

  return (
    <HandoffCenter
      incident={incident}
      agents={agents}
      handoffs={handoffs}
      memoryEventCount={events.length}
      decisionCount={decisions.length}
      storeKind={store.kind}
    />
  );
}
