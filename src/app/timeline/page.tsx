import { getStore } from '@/lib/store';
import { loadShellData, selectIncident } from '@/lib/server-data';
import { IncidentTimeline } from '@/components/incident-timeline';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string }>;
}) {
  const { incident: requested } = await searchParams;
  const { incidents } = await loadShellData();
  const incident = selectIncident(incidents, requested);

  if (!incident) {
    return (
      <div className="p-4">
        <Panel title="No incidents">
          <EmptyState title="There is no incident to display a timeline for." />
        </Panel>
      </div>
    );
  }

  const store = getStore();
  const [events, audit] = await Promise.all([
    store.listMemoryEvents(incident.id, 300),
    store.listAuditEvents(incident.id, 300),
  ]);

  return (
    <IncidentTimeline
      incident={incident}
      events={events}
      audit={audit}
      storeKind={store.kind}
    />
  );
}
