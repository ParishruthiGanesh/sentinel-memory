'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  BrainCircuit,
  Database,
  FileClock,
  GitBranchPlus,
  Radio,
  ShieldAlert,
  Split,
  UserCheck,
} from 'lucide-react';
import { Chip, EmptyState, Panel } from '@/components/ui';
import type { AuditEvent, Incident, MemoryEvent, MemoryEventType } from '@/lib/types';

/** Filter groups map onto memory event types. */
const FILTERS = [
  { key: 'observations', label: 'Observations', types: ['observation', 'incident_created', 'note'] },
  { key: 'recommendations', label: 'AI recommendations', types: ['recommendation', 'memory_retrieved'] },
  { key: 'decisions', label: 'Human decisions', types: ['human_decision'] },
  { key: 'warnings', label: 'Warnings', types: ['risk_detected', 'contradiction'] },
  { key: 'state', label: 'State changes', types: ['state_change'] },
  { key: 'handoffs', label: 'Handoffs', types: ['handoff'] },
] as const;

const EVENT_STYLE: Record<
  MemoryEventType,
  { icon: typeof Activity; tone: string; ring: string; label: string }
> = {
  incident_created: { icon: FileClock, tone: 'text-info', ring: 'border-info/40', label: 'Incident created' },
  observation: { icon: Radio, tone: 'text-ink', ring: 'border-edge', label: 'Observation' },
  memory_retrieved: { icon: Database, tone: 'text-info', ring: 'border-info/40', label: 'Memory retrieved' },
  risk_detected: { icon: ShieldAlert, tone: 'text-warn', ring: 'border-warn/50', label: 'Consequence warning' },
  recommendation: { icon: BrainCircuit, tone: 'text-warn', ring: 'border-warn/40', label: 'Recommendation' },
  human_decision: { icon: UserCheck, tone: 'text-success', ring: 'border-success/50', label: 'Human decision' },
  state_change: { icon: ArrowRightLeft, tone: 'text-info', ring: 'border-info/40', label: 'State change' },
  handoff: { icon: GitBranchPlus, tone: 'text-info', ring: 'border-info/40', label: 'Agent handoff' },
  contradiction: { icon: Split, tone: 'text-critical', ring: 'border-critical/50', label: 'Contradiction' },
  note: { icon: Activity, tone: 'text-muted', ring: 'border-edge', label: 'Note' },
};

const ACTOR_LABEL = {
  human: 'human-entered',
  system: 'system-generated',
  ai: 'AI-generated',
} as const;

export function IncidentTimeline({
  incident,
  events,
  audit,
  storeKind,
}: {
  incident: Incident;
  events: MemoryEvent[];
  audit: AuditEvent[];
  storeKind: 'cockroachdb' | 'in-memory-demo';
}) {
  const [active, setActive] = useState<string[]>(FILTERS.map((filter) => filter.key));

  const allowedTypes = useMemo(() => {
    const set = new Set<string>();
    for (const filter of FILTERS) {
      if (active.includes(filter.key)) filter.types.forEach((type) => set.add(type));
    }
    return set;
  }, [active]);

  const visible = events.filter((event) => allowedTypes.has(event.eventType));

  const auditByEntity = useMemo(() => {
    const map = new Map<string, AuditEvent>();
    for (const entry of audit) map.set(entry.entityId, entry);
    return map;
  }, [audit]);

  const toggle = (key: string) =>
    setActive((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Incident Timeline &amp; Audit Trail
        </h1>
        <p className="mt-1 text-sm text-muted">
          {incident.incidentCode} · {incident.title}
        </p>
      </header>

      <p className="flex items-center gap-2 rounded-md border border-info/30 bg-info/[0.07] px-3 py-2 text-xs text-info">
        <Database size={14} className="shrink-0" aria-hidden />
        This timeline is reconstructed from durable memory events in{' '}
        {storeKind === 'cockroachdb' ? 'CockroachDB' : 'the in-memory demo store'} — not from a
        conversation transcript held in an agent&apos;s context.
      </p>

      <Panel
        title="Filters"
        actions={
          <Chip tone="neutral">
            {visible.length} of {events.length} events
          </Chip>
        }
      >
        <div className="flex flex-wrap gap-2 p-4">
          {FILTERS.map((filter) => {
            const on = active.includes(filter.key);
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => toggle(filter.key)}
                aria-pressed={on}
                className={`chip transition-colors ${
                  on
                    ? 'border-info/50 bg-info/10 text-info'
                    : 'border-edge bg-panel2 text-muted hover:text-ink'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Event stream">
        {visible.length === 0 ? (
          <EmptyState title="No events match the selected filters." />
        ) : (
          <ol className="relative p-4">
            {/* Vertical spine */}
            <span
              className="absolute left-[2.05rem] top-6 bottom-6 w-px bg-edge"
              aria-hidden
            />
            {visible.map((event) => {
              const style = EVENT_STYLE[event.eventType] ?? EVENT_STYLE.note;
              const Icon = style.icon;
              const linkedAudit =
                typeof event.metadata.recommendationId === 'string'
                  ? auditByEntity.get(event.metadata.recommendationId)
                  : undefined;

              return (
                <li key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
                  <span
                    className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-panel ${style.ring}`}
                  >
                    <Icon size={14} className={style.tone} aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1 rounded-lg border border-edge bg-panel2/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-medium ${style.tone}`}>{style.label}</span>
                      <Chip tone="neutral">{ACTOR_LABEL[event.actorType]}</Chip>
                      <span className="text-[10px] text-muted">{event.actorName}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted">
                        {new Date(event.createdAt).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </span>
                    </div>

                    <p className="mt-1.5 text-sm leading-snug text-ink">{event.content}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge/70 pt-2 text-[10px] text-muted">
                      {/* Seeded ids share a prefix — the tail is what identifies a row. */}
                      <span className="font-mono">event …{event.id.slice(-8)}</span>
                      {typeof event.metadata.riskLevel === 'string' && (
                        <span>risk: {event.metadata.riskLevel}</span>
                      )}
                      {typeof event.metadata.similarity === 'number' && (
                        <span>similarity: {(event.metadata.similarity * 100).toFixed(1)}%</span>
                      )}
                      {typeof event.metadata.latencyMs === 'number' && (
                        <span>{event.metadata.latencyMs}ms</span>
                      )}
                      {typeof event.metadata.providerLabel === 'string' && (
                        <span>via {event.metadata.providerLabel}</span>
                      )}
                      {Array.isArray(event.metadata.memoryIds) && (
                        <span>{(event.metadata.memoryIds as unknown[]).length} memories cited</span>
                      )}
                      {linkedAudit && (
                        <span className="text-success">
                          audit {linkedAudit.action} · {linkedAudit.id.slice(0, 8)}
                        </span>
                      )}
                      <span className="ml-auto text-success">committed</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <Panel
        title="Audit trail"
        subtitle="Immutable records written in the same transaction as the state change they describe."
      >
        {audit.length === 0 ? (
          <EmptyState title="No audit records yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead className="border-b border-edge text-[10px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Time</th>
                  <th className="px-4 py-2 font-semibold">Entity</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Actor</th>
                  <th className="px-4 py-2 font-semibold">Before → after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {audit.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-muted">
                      {new Date(entry.createdAt).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {entry.entityType}
                      <span className="ml-1 font-mono text-[10px] text-muted/70">
                        {entry.entityId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink">{entry.action}</td>
                    <td className="px-4 py-2 text-muted">{entry.actor}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-muted">
                      {entry.beforeState ? summarize(entry.beforeState) : '—'}
                      <span className="mx-1 text-info">→</span>
                      {entry.afterState ? summarize(entry.afterState) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function summarize(state: Record<string, unknown>): string {
  return Object.entries(state)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}
