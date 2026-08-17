'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Ban,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Database,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { Chip, EmptyState, KeyValue, Panel, ProviderTag, StatusDot } from '@/components/ui';
import type { Agent, HandoffSummary, Incident, IncidentHandoff, RetrievalResult } from '@/lib/types';

interface Reasoning {
  provider: 'bedrock' | 'local-heuristic';
  providerLabel: string;
  latencyMs: number;
  degradedReason?: string;
}

export function HandoffCenter({
  incident,
  agents: initialAgents,
  handoffs: initialHandoffs,
  memoryEventCount,
  decisionCount,
  storeKind,
}: {
  incident: Incident;
  agents: Agent[];
  handoffs: IncidentHandoff[];
  memoryEventCount: number;
  decisionCount: number;
  storeKind: 'cockroachdb' | 'in-memory-demo';
}) {
  const router = useRouter();

  const [agents, setAgents] = useState(initialAgents);
  const [handoffs, setHandoffs] = useState(initialHandoffs);
  const [retrieval, setRetrieval] = useState<RetrievalResult | null>(null);
  const [reasoning, setReasoning] = useState<Reasoning | null>(null);
  const [busy, setBusy] = useState<null | 'handoff' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);

  const primary = agents.find((agent) => agent.role.toLowerCase().includes('primary')) ?? agents[0];
  const backup = agents.find((agent) => agent.id !== primary?.id) ?? agents[1];

  const latest = handoffs[0] ?? null;
  const transferred = Boolean(latest);

  const transfer = async () => {
    if (!primary || !backup) return;
    setBusy('handoff');
    setError(null);
    try {
      const response = await fetch('/api/handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: incident.id,
          fromAgentId: primary.id,
          toAgentId: backup.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Handoff failed');

      setHandoffs((current) => [payload.handoff as IncidentHandoff, ...current]);
      setRetrieval(payload.retrieval as RetrievalResult);
      setReasoning(payload.reasoning as Reasoning);
      setAgents((current) =>
        current.map((agent) =>
          agent.id === primary.id
            ? { ...agent, status: 'standby' as const }
            : agent.id === backup.id
              ? { ...agent, status: 'active' as const }
              : agent,
        ),
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Handoff failed');
    } finally {
      setBusy(null);
    }
  };

  const simulateDisconnect = async () => {
    if (!primary) return;
    setBusy('disconnect');
    setError(null);
    try {
      const response = await fetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: primary.id, status: 'disconnected' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not update agent status');

      setAgents((current) =>
        current.map((agent) =>
          agent.id === primary.id ? { ...agent, status: 'disconnected' as const } : agent,
        ),
      );
      setDisconnected(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update agent status');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Agent Handoff Center</h1>
        <p className="mt-1 text-sm text-muted">
          {incident.incidentCode} · {incident.title}
        </p>
      </header>

      {error && (
        <p className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          {error}
        </p>
      )}

      {disconnected && (
        <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <PlugZap size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Primary agent marked disconnected. <span className="text-ink">Nothing was deleted</span> —
            the incident record, {memoryEventCount} memory events, decisions and audit trail are all
            still in the system of record, which is exactly how the backup recovers context.
          </span>
        </p>
      )}

      {/* ------------------------- transfer visualization ------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <AgentPanel
          agent={primary}
          title="Current agent"
          knowledge={transferred ? 100 : 100}
          knowledgeLabel="Incident knowledge"
          tone={primary?.status === 'disconnected' ? 'critical' : 'default'}
          detail={`${memoryEventCount} memory events · ${decisionCount} recorded decisions`}
        />

        <div className="flex items-center justify-center lg:flex-col lg:justify-center">
          <div className="flex items-center gap-3 rounded-lg border border-edge bg-panel px-4 py-3 lg:flex-col">
            <Waypoints size={18} className="text-info" aria-hidden />
            <ArrowRight size={18} className="text-info lg:rotate-90" aria-hidden />
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted">transfer</span>
          </div>
        </div>

        <AgentPanel
          agent={backup}
          title="Backup agent"
          knowledge={transferred ? 100 : 0}
          knowledgeLabel={transferred ? 'Incident knowledge' : 'Incident knowledge before transfer'}
          tone={transferred ? 'success' : 'default'}
          detail={
            transferred
              ? 'Context synchronized from durable memory'
              : 'No incident context yet'
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void transfer()}
          disabled={busy !== null || !primary || !backup}
          className="btn-primary"
        >
          {busy === 'handoff' ? (
            <RefreshCw size={15} className="animate-spin" aria-hidden />
          ) : (
            <Waypoints size={15} aria-hidden />
          )}
          Transfer to Backup Agent
        </button>

        <button
          type="button"
          onClick={() => void simulateDisconnect()}
          disabled={busy !== null || !primary}
          className="btn-neutral"
          title="Changes the simulated agent status only. No data is deleted."
        >
          {busy === 'disconnect' ? (
            <RefreshCw size={15} className="animate-spin" aria-hidden />
          ) : (
            <PlugZap size={15} aria-hidden />
          )}
          Simulate Primary Agent Disconnect
        </button>
      </div>

      {/* ------------------------------ briefing --------------------------- */}
      {latest ? (
        <>
          <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success">
            <CheckCircle2 size={16} className="shrink-0" aria-hidden />
            Continuity verified. {latest.toAgentName ?? 'Backup Agent'} is ready.
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
            <BriefingPanels summary={latest.summary} />

            <div className="space-y-4">
              <Panel title="Briefing provenance">
                <div className="space-y-3 p-4">
                  {reasoning ? (
                    <ProviderTag provider={reasoning.provider} label={`${reasoning.latencyMs}ms`} />
                  ) : (
                    <Chip tone="neutral">stored briefing</Chip>
                  )}

                  <dl className="grid grid-cols-2 gap-3">
                    <KeyValue label="From" value={latest.fromAgentName ?? '—'} />
                    <KeyValue label="To" value={latest.toAgentName ?? '—'} />
                    <KeyValue
                      label="Created"
                      value={new Date(latest.createdAt).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    />
                    <KeyValue label="Stored in" value={storeKind === 'cockroachdb' ? 'CockroachDB' : 'demo store'} />
                  </dl>

                  {reasoning?.degradedReason && (
                    <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
                      Bedrock failed ({reasoning.degradedReason}); this briefing came from the local
                      rule-based fallback.
                    </p>
                  )}

                  <div className="rule pt-3">
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Supporting memories
                    </h3>
                    <ul className="mt-1.5 space-y-1">
                      {latest.supportingMemoryIds.length === 0 && (
                        <li className="text-[11px] text-muted">None cited.</li>
                      )}
                      {latest.supportingMemoryIds.map((id) => (
                        <li key={id} className="mono-id">
                          {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Panel>

              {retrieval && (
                <Panel title="Retrieval during handoff">
                  <dl className="grid grid-cols-2 gap-3 p-4">
                    <KeyValue label="Latency" value={`${retrieval.latencyMs} ms`} />
                    <KeyValue label="Searched" value={String(retrieval.memoriesSearched)} />
                    <KeyValue label="Returned" value={String(retrieval.memories.length)} />
                    <KeyValue
                      label="Index"
                      value={retrieval.vectorIndexUsed ? 'vector index' : 'exact scan'}
                    />
                  </dl>
                </Panel>
              )}
            </div>
          </div>
        </>
      ) : (
        <Panel title="Continuity briefing">
          <EmptyState
            icon={<Database size={20} />}
            title="No handoff has been generated for this incident yet."
            hint="Transfer to the backup agent to reconstruct incident state from durable memory and store a briefing."
          />
        </Panel>
      )}

      {handoffs.length > 1 && (
        <Panel title="Earlier handoffs">
          <ul className="divide-y divide-edge/60">
            {handoffs.slice(1).map((handoff) => (
              <li key={handoff.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="text-xs text-ink">
                  {handoff.fromAgentName} → {handoff.toAgentName}
                </span>
                <span className="text-[10px] text-muted">
                  {new Date(handoff.createdAt).toLocaleString()}
                </span>
                <span className="mono-id ml-auto">{handoff.id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function AgentPanel({
  agent,
  title,
  knowledge,
  knowledgeLabel,
  detail,
  tone,
}: {
  agent: Agent | undefined;
  title: string;
  knowledge: number;
  knowledgeLabel: string;
  detail: string;
  tone: 'default' | 'success' | 'critical';
}) {
  if (!agent) {
    return (
      <Panel title={title}>
        <EmptyState title="No agent configured." />
      </Panel>
    );
  }

  const statusTone =
    agent.status === 'active'
      ? 'success'
      : agent.status === 'disconnected'
        ? 'critical'
        : agent.status === 'ready'
          ? 'info'
          : 'neutral';

  return (
    <Panel title={title} tone={tone}>
      <div className="space-y-3.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-medium text-ink">{agent.name}</p>
            <p className="text-xs text-muted">{agent.role}</p>
          </div>
          <Chip tone={statusTone}>
            <StatusDot
              state={
                agent.status === 'active' ? 'ok' : agent.status === 'disconnected' ? 'error' : 'idle'
              }
            />
            {agent.status}
          </Chip>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-muted">
            <span>{knowledgeLabel}</span>
            <span className="font-mono text-ink">{knowledge}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel2">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                knowledge === 0 ? 'bg-muted/40' : 'bg-success'
              }`}
              style={{ width: `${knowledge}%` }}
            />
          </div>
        </div>

        <p className="text-[11px] text-muted">{detail}</p>
        <p className="mono-id">
          last synchronized {new Date(agent.lastSeenAt).toLocaleTimeString()}
        </p>
      </div>
    </Panel>
  );
}

function BriefingPanels({ summary }: { summary: HandoffSummary }) {
  const sections = [
    {
      title: 'What happened',
      icon: BrainCircuit,
      tone: 'text-info',
      body: <p className="text-sm leading-relaxed text-ink">{summary.whatHappened}</p>,
    },
    {
      title: 'What has been attempted',
      icon: CheckCircle2,
      tone: 'text-muted',
      body: <BulletList items={summary.whatWasAttempted} />,
    },
    {
      title: 'What must not be repeated',
      icon: Ban,
      tone: 'text-critical',
      body: <BulletList items={summary.whatMustNotBeRepeated} tone="critical" />,
    },
    {
      title: 'Current risks',
      icon: TriangleAlert,
      tone: 'text-warn',
      body: <BulletList items={summary.currentRisks} tone="warn" />,
    },
    {
      title: 'Unresolved questions',
      icon: CircleHelp,
      tone: 'text-info',
      body: <BulletList items={summary.unresolvedQuestions} />,
    },
    {
      title: 'Recommended next action',
      icon: ShieldAlert,
      tone: 'text-success',
      body: (
        <p className="rounded-md border border-success/30 bg-success/[0.07] px-3 py-2 text-sm text-success">
          {summary.recommendedNextAction}
        </p>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <Panel
            key={section.title}
            title={
              <span className="flex items-center gap-2">
                <Icon size={13} className={section.tone} aria-hidden />
                {section.title}
              </span>
            }
          >
            <div className="p-4">{section.body}</div>
          </Panel>
        );
      })}
    </div>
  );
}

function BulletList({ items, tone = 'neutral' }: { items: string[]; tone?: 'neutral' | 'warn' | 'critical' }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted">Nothing recorded.</p>;
  }
  const color =
    tone === 'critical' ? 'text-critical' : tone === 'warn' ? 'text-warn' : 'text-ink';
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className={`flex gap-2 text-sm leading-snug ${color}`}>
          <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  );
}
