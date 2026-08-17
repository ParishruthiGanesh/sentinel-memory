'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Database,
  Gauge,
  History,
  Lock,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { Chip, EmptyState, KeyValue, Panel, ProviderTag, RiskBadge, SimilarityBar, StatusDot } from '@/components/ui';
import { MemoryCard } from '@/components/memory-card';
import { Modal } from '@/components/shell/modal';
import type {
  Incident,
  MemoryEvent,
  Recommendation,
  RetrievalResult,
  RetrievedMemory,
  SafetyRule,
} from '@/lib/types';

export interface CommandCenterProps {
  incident: Incident;
  events: MemoryEvent[];
  pendingRecommendation: Recommendation | null;
  latestDecidedRecommendation: Recommendation | null;
  safetyRules: SafetyRule[];
  initialRetrieval: RetrievalResult;
  responder: string;
  quickObservations: string[];
  demoProposedAction: string;
  demoMode: boolean;
  storeKind: 'cockroachdb' | 'in-memory-demo';
}

interface Reasoning {
  provider: 'bedrock' | 'local-heuristic';
  providerLabel: string;
  latencyMs: number;
  degradedReason?: string;
}

export function CommandCenter(props: CommandCenterProps) {
  const router = useRouter();

  const [events, setEvents] = useState<MemoryEvent[]>(props.events);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    props.pendingRecommendation,
  );
  const [decided, setDecided] = useState<Recommendation | null>(props.latestDecidedRecommendation);
  const [retrieval, setRetrieval] = useState<RetrievalResult>(props.initialRetrieval);
  const [reasoning, setReasoning] = useState<Reasoning | null>(null);
  const [observation, setObservation] = useState('');
  const [busy, setBusy] = useState<null | 'observation' | 'action' | 'decision'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | 'approved' | 'rejected' | 'alternative_requested'>(
    null,
  );
  const [decisionNote, setDecisionNote] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  // Note: this component is mounted with `key={incident.id}` by the page, so
  // switching incidents remounts it and every piece of local state above is
  // re-initialized from the new server props. No reset effect is needed.

  const observations = useMemo(
    () =>
      events.filter(
        (event) =>
          event.eventType === 'observation' ||
          event.eventType === 'incident_created' ||
          event.eventType === 'note',
      ),
    [events],
  );

  const counterfactual = useMemo(
    () => retrieval.memories.find((memory) => memory.outcome && memory.actionTaken) ?? null,
    [retrieval],
  );

  const supporting = useMemo(() => {
    if (!recommendation) return retrieval.memories;
    const ids = new Set(recommendation.retrievedMemoryIds);
    const cited = retrieval.memories.filter((memory) => ids.has(memory.id));
    return cited.length > 0 ? cited : retrieval.memories;
  }, [recommendation, retrieval]);

  const applyAnalysis = useCallback(
    (analysis: {
      recommendation: Recommendation;
      retrieval: RetrievalResult;
      reasoning: Reasoning;
    }) => {
      setRecommendation(analysis.recommendation);
      setRetrieval(analysis.retrieval);
      setReasoning(analysis.reasoning);
    },
    [],
  );

  const post = useCallback(async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Request failed');
    return payload;
  }, []);

  const submitObservation = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content) return;
      setBusy('observation');
      setError(null);
      try {
        const payload = await post('/api/observations', {
          incidentId: props.incident.id,
          content,
          actorType: 'human',
          actorName: props.responder,
          analyze: true,
        });
        setEvents((current) => [...current, payload.event as MemoryEvent]);
        if (payload.analysis) applyAnalysis(payload.analysis);
        setObservation('');
        setFlash('Observation stored in durable memory and analyzed against past incidents.');
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Failed to record observation');
      } finally {
        setBusy(null);
      }
    },
    [applyAnalysis, post, props.incident.id, props.responder, router],
  );

  const proposeAction = useCallback(
    async (action: string) => {
      setBusy('action');
      setError(null);
      try {
        const payload = await post('/api/recommendations', {
          incidentId: props.incident.id,
          proposedAction: action,
          requestedBy: props.responder,
        });
        applyAnalysis(payload.analysis);
        setFlash('Sentinel checked this action against what similar actions actually caused.');
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Failed to evaluate the action');
      } finally {
        setBusy(null);
      }
    },
    [applyAnalysis, post, props.incident.id, props.responder, router],
  );

  const submitDecision = useCallback(
    async (decision: 'approved' | 'rejected' | 'alternative_requested') => {
      if (!recommendation) return;
      setBusy('decision');
      setError(null);
      try {
        const payload = await post(`/api/recommendations/${recommendation.id}/decision`, {
          decision,
          decidedBy: props.responder,
          reason: decisionNote.trim() || undefined,
        });
        setDecided(payload.recommendation as Recommendation);
        setRecommendation(null);
        setConfirming(null);
        setDecisionNote('');
        setFlash(
          decision === 'approved'
            ? 'Approval committed atomically: decision, recommendation status, incident state and audit event.'
            : decision === 'rejected'
              ? 'Rejection recorded. The refused action is now part of the handoff briefing.'
              : 'Alternative requested. Add an observation or propose a different action.',
        );
        router.refresh();

        if (decision === 'alternative_requested') {
          await proposeAction(
            `The responder rejected "${recommendation.proposedAction}" and requested a different approach.`,
          );
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Failed to record the decision');
        setConfirming(null);
      } finally {
        setBusy(null);
      }
    },
    [decisionNote, post, proposeAction, recommendation, props.responder, router],
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4">
      <IncidentHeader incident={props.incident} responder={props.responder} />

      {flash && (
        <p className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span className="flex-1">{flash}</span>
          <button type="button" onClick={() => setFlash(null)} className="text-success/70 hover:text-success">
            dismiss
          </button>
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ------------------------------ LEFT ------------------------------ */}
        {/*
          Recommendation first, observation feed second. The recommended action
          is what the responder acts on, and pairing it with the counterfactual
          card on the right is the whole product thesis — both belong in the
          first viewport. The feed is context and can scroll below.
        */}
        <div className="space-y-4">
          <RecommendationPanel
            recommendation={recommendation}
            decided={decided}
            reasoning={reasoning}
            supporting={supporting}
            busy={busy === 'decision'}
            onDecide={(decision) => setConfirming(decision)}
          />

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Radio size={13} className="text-info" aria-hidden /> Live observation feed
              </span>
            }
            actions={<Chip tone="neutral">{observations.length} entries</Chip>}
          >
            <ol className="max-h-[18rem] divide-y divide-edge/60 overflow-y-auto">
              {observations.length === 0 && (
                <EmptyState title="No observations recorded yet." />
              )}
              {observations.map((event) => (
                <li key={event.id} className="flex gap-3 px-4 py-3">
                  <ActorGlyph actorType={event.actorType} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-ink">{event.content}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                      <span>{event.actorName}</span>
                      <span aria-hidden>·</span>
                      <span>{formatTime(event.createdAt)}</span>
                      <span aria-hidden>·</span>
                      <span className="font-mono">{event.eventType}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="space-y-2.5 border-t border-edge p-4">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitObservation(observation);
                }}
                className="flex gap-2"
              >
                <label htmlFor="observation-input" className="sr-only">
                  Add a new observation
                </label>
                <input
                  id="observation-input"
                  value={observation}
                  onChange={(event) => setObservation(event.target.value)}
                  placeholder="Add a new observation…"
                  maxLength={2000}
                  className="field"
                  disabled={busy !== null}
                />
                <button
                  type="submit"
                  className="btn-neutral shrink-0"
                  disabled={busy !== null || observation.trim().length === 0}
                >
                  {busy === 'observation' ? (
                    <RefreshCw size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Send size={14} aria-hidden />
                  )}
                  <span className="hidden sm:inline">Record</span>
                </button>
              </form>

              <div className="flex flex-wrap gap-2">
                {props.quickObservations.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => void submitObservation(text)}
                    disabled={busy !== null}
                    className="chip border-edge bg-panel2 text-muted transition-colors hover:border-info/50 hover:text-ink disabled:opacity-50"
                  >
                    {text.length > 44 ? `${text.slice(0, 44)}…` : text}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => void proposeAction(props.demoProposedAction)}
                disabled={busy !== null}
                className="w-full rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-left text-xs text-warn transition-colors hover:bg-warn/20 disabled:opacity-50"
              >
                <span className="flex items-center gap-2 font-medium">
                  {busy === 'action' ? (
                    <RefreshCw size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <TriangleAlert size={13} aria-hidden />
                  )}
                  Check a proposed action against memory
                </span>
                <span className="mt-1 block text-warn/80">“{props.demoProposedAction}”</span>
              </button>
            </div>
          </Panel>
        </div>

        {/* ------------------------------ RIGHT ----------------------------- */}
        <div className="space-y-4">
          <CounterfactualCard memory={counterfactual} retrieval={retrieval} />

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Database size={13} className="text-info" aria-hidden /> Retrieved memories
              </span>
            }
            subtitle={`${retrieval.memoriesSearched} memories searched · ${retrieval.latencyMs}ms · ${retrieval.embeddingDimensions}-dim vectors`}
            actions={
              <Chip tone={retrieval.vectorIndexUsed ? 'success' : 'warn'}>
                {retrieval.vectorIndexUsed ? 'Vector index' : 'Exact scan'}
              </Chip>
            }
          >
            <div className="space-y-2.5 p-4">
              {retrieval.memories.length === 0 ? (
                <EmptyState
                  title="No sufficiently similar precedent found."
                  hint="Sentinel will recommend escalation rather than invent a procedure."
                />
              ) : (
                retrieval.memories.map((memory) => <MemoryCard key={memory.id} memory={memory} />)
              )}
            </div>
            <div className="space-y-1.5 border-t border-edge px-4 py-2.5">
              <p className="flex items-center gap-2 text-[10px] text-muted">
                <Database size={11} aria-hidden />
                {props.storeKind === 'cockroachdb'
                  ? 'Retrieved from the CockroachDB distributed vector index using cosine distance.'
                  : 'Retrieved from the in-memory demo store — no database is connected.'}
              </p>
              {retrieval.embeddingProvider === 'local-deterministic' && (
                <p className="text-[10px] leading-relaxed text-warn/90">
                  Vectors come from the local fallback embedder, which compares shared vocabulary
                  rather than meaning — absolute scores read lower than a learned model would give.
                  Ranking order is the signal here.
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Lock size={13} className="text-success" aria-hidden /> Safety guardrails
              </span>
            }
          >
            <ul className="divide-y divide-edge/60">
              {props.safetyRules.map((rule) => (
                <li key={rule.id} className="flex gap-3 px-4 py-2.5">
                  <ShieldAlert
                    size={14}
                    className={`mt-0.5 shrink-0 ${
                      rule.enforcementLevel === 'block' ? 'text-critical' : 'text-success'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink">{rule.name}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{rule.description}</p>
                  </div>
                  {rule.requiresHumanApproval && (
                    <Chip tone="warn" className="ml-auto h-fit shrink-0">
                      approval
                    </Chip>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <ConfirmDecisionModal
        decision={confirming}
        recommendation={recommendation}
        note={decisionNote}
        onNoteChange={setDecisionNote}
        onCancel={() => setConfirming(null)}
        onConfirm={(decision) => void submitDecision(decision)}
        busy={busy === 'decision'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function IncidentHeader({ incident, responder }: { incident: Incident; responder: string }) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(incident.createdAt));

  // The initial value comes from the useState initializer; the effect only
  // subscribes to the clock so the elapsed counter keeps ticking.
  useEffect(() => {
    const timer = setInterval(() => setElapsed(formatElapsed(incident.createdAt)), 30_000);
    return () => clearInterval(timer);
  }, [incident.createdAt]);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-info">{incident.incidentCode}</span>
            <RiskBadge level={incident.severity} />
            <Chip tone={incident.status === 'active' ? 'critical' : 'neutral'}>
              <StatusDot state={incident.status === 'active' ? 'error' : 'idle'} />
              {incident.status}
            </Chip>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight text-ink sm:text-2xl">
            {incident.title}
          </h1>
          <p className="mt-1 text-sm text-muted">{incident.location}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <KeyValue label="Phase" value={<span className="capitalize">{incident.currentPhase}</span>} />
          <KeyValue label="Elapsed" value={elapsed} />
          <KeyValue label="Responder" value={responder} />
          <KeyValue label="Agent" value={incident.assignedAgentName ?? 'unassigned'} />
        </dl>
      </div>
      <p className="border-t border-edge bg-panel2/40 px-4 py-2 text-xs leading-relaxed text-muted">
        {incident.description}
      </p>
    </section>
  );
}

function CounterfactualCard({
  memory,
  retrieval,
}: {
  memory: RetrievedMemory | null;
  retrieval: RetrievalResult;
}) {
  const [open, setOpen] = useState(false);

  if (!memory) {
    return (
      <Panel
        tone="default"
        title={
          <span className="flex items-center gap-2">
            <History size={13} aria-hidden /> What happened last time?
          </span>
        }
      >
        <EmptyState
          title="No comparable past action found in memory."
          hint={`${retrieval.memoriesSearched} memories searched. Sentinel will not fabricate a precedent.`}
        />
      </Panel>
    );
  }

  return (
    <>
      <section className="panel border-warn/50 bg-warn/[0.07]">
        <header className="flex items-center justify-between gap-3 border-b border-warn/30 px-4 py-3">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-warn">
            <TriangleAlert size={14} aria-hidden />
            What happened last time?
          </h2>
          <SimilarityBar value={memory.similarity} />
        </header>

        <div className="space-y-3 p-4">
          <p className="text-[15px] leading-relaxed text-ink">
            In {memory.incidentCode}
            {memory.incidentDate
              ? ` (${new Date(memory.incidentDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })})`
              : ''}
            , <span className="text-warn">{lowerFirst(memory.actionTaken ?? '')}</span> {memory.outcome}
          </p>

          <dl className="grid grid-cols-2 gap-3 rounded-md border border-warn/25 bg-base/40 p-3 sm:grid-cols-4">
            <KeyValue label="Similarity" value={`${(memory.similarity * 100).toFixed(1)}%`} />
            <KeyValue label="Incident" value={<span className="font-mono text-xs">{memory.incidentCode}</span>} />
            <KeyValue
              label="Date"
              value={
                memory.incidentDate
                  ? new Date(memory.incidentDate).toLocaleDateString(undefined, { dateStyle: 'medium' })
                  : '—'
              }
            />
            <KeyValue
              label="Severity"
              value={<span className="capitalize text-critical">{memory.severity ?? 'unknown'}</span>}
            />
          </dl>

          {memory.lessonLearned && (
            <p className="rounded-md border border-success/30 bg-success/[0.07] px-3 py-2 text-xs text-success">
              <span className="font-medium">Lesson recorded: </span>
              {memory.lessonLearned}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] leading-relaxed text-muted">
              A similarity match over past consequences — not causal proof. Verify current conditions
              before acting.
            </p>
            <button type="button" onClick={() => setOpen(true)} className="btn-neutral shrink-0 py-1.5 text-xs">
              View complete memory
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        tone="warn"
        title={`${memory.incidentCode} — ${memory.incidentTitle}`}
        description="Stored in CockroachDB as vector-searchable semantic memory."
      >
        <div className="space-y-3">
          <MemoryCard memory={memory} />
          <p className="mono-id">memory id {memory.id}</p>
        </div>
      </Modal>
    </>
  );
}

function RecommendationPanel({
  recommendation,
  decided,
  reasoning,
  supporting,
  busy,
  onDecide,
}: {
  recommendation: Recommendation | null;
  decided: Recommendation | null;
  reasoning: Reasoning | null;
  supporting: RetrievedMemory[];
  busy: boolean;
  onDecide: (decision: 'approved' | 'rejected' | 'alternative_requested') => void;
}) {
  if (!recommendation) {
    return (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <BrainCircuit size={13} className="text-info" aria-hidden /> Recommended next action
          </span>
        }
        tone={decided?.status === 'approved' ? 'success' : 'default'}
      >
        {decided ? (
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={decided.status === 'approved' ? 'success' : 'critical'}>
                {decided.status === 'approved' ? (
                  <CheckCircle2 size={12} aria-hidden />
                ) : (
                  <XCircle size={12} aria-hidden />
                )}
                {decided.status}
              </Chip>
              <RiskBadge level={decided.riskLevel} />
            </div>
            <p className="text-[15px] leading-snug text-ink">{decided.proposedAction}</p>
            <p className="text-xs leading-relaxed text-muted">{decided.explanation}</p>
            <p className="text-[11px] text-muted">
              Recorded as an authorization only. Sentinel does not operate equipment — an authorized
              responder performs the action on site.
            </p>
            <p className="pt-1 text-[11px] text-muted">
              Add an observation or check another proposed action to continue.
            </p>
          </div>
        ) : (
          <EmptyState
            icon={<ClipboardList size={20} />}
            title="No recommendation pending."
            hint="Record an observation or check a proposed action to run the memory cycle."
          />
        )}
      </Panel>
    );
  }

  return (
    <Panel
      tone={recommendation.riskLevel === 'critical' ? 'critical' : 'warn'}
      title={
        <span className="flex items-center gap-2">
          <BrainCircuit size={13} className="text-info" aria-hidden /> Recommended next action
        </span>
      }
      actions={
        reasoning ? (
          <ProviderTag provider={reasoning.provider} label={`${reasoning.latencyMs}ms`} />
        ) : null
      }
    >
      <div className="space-y-3.5 p-4">
        <p className="text-lg font-medium leading-snug text-ink">{recommendation.proposedAction}</p>

        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={recommendation.riskLevel} label={`risk: ${recommendation.riskLevel}`} />
          <Chip tone="info">
            <Gauge size={12} aria-hidden />
            confidence {(recommendation.confidence * 100).toFixed(0)}%
          </Chip>
          {recommendation.requiresHumanApproval && (
            <Chip tone="warn">
              <Lock size={12} aria-hidden />
              human approval required
            </Chip>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Why this action
          </h3>
          <p className="text-xs leading-relaxed text-muted">{recommendation.explanation}</p>
        </div>

        {recommendation.potentialConsequences.length > 0 && (
          <div>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Consequences on record
            </h3>
            <ul className="space-y-1">
              {recommendation.potentialConsequences.map((consequence) => (
                <li key={consequence} className="flex gap-2 text-xs text-warn/90">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                  {consequence}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Supporting memory references
          </h3>
          {supporting.length === 0 ? (
            <p className="text-xs text-muted">No memories were cited for this recommendation.</p>
          ) : (
            <ul className="space-y-1.5">
              {supporting.map((memory) => (
                <li
                  key={memory.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-edge bg-panel2/50 px-2.5 py-1.5"
                >
                  <span className="font-mono text-[11px] text-info">{memory.incidentCode}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {memory.lessonLearned ?? memory.sourceText}
                  </span>
                  <SimilarityBar value={memory.similarity} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {reasoning?.degradedReason && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            Bedrock was configured but the call failed ({reasoning.degradedReason}). This
            recommendation came from the local rule-based fallback.
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-edge pt-3.5">
          <button
            type="button"
            onClick={() => onDecide('approved')}
            disabled={busy}
            className="btn-primary flex-1"
          >
            <CheckCircle2 size={15} aria-hidden />
            Approve safer action
          </button>
          <button type="button" onClick={() => onDecide('rejected')} disabled={busy} className="btn-danger">
            <XCircle size={15} aria-hidden />
            Reject
          </button>
          <button
            type="button"
            onClick={() => onDecide('alternative_requested')}
            disabled={busy}
            className="btn-neutral"
          >
            <RefreshCw size={15} aria-hidden />
            Request alternative
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ConfirmDecisionModal({
  decision,
  recommendation,
  note,
  onNoteChange,
  onCancel,
  onConfirm,
  busy,
}: {
  decision: 'approved' | 'rejected' | 'alternative_requested' | null;
  recommendation: Recommendation | null;
  note: string;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: (decision: 'approved' | 'rejected' | 'alternative_requested') => void;
  busy: boolean;
}) {
  if (!decision || !recommendation) return null;

  const copy = {
    approved: {
      title: 'Confirm human approval',
      description:
        'This records your authorization and updates the incident state in one atomic transaction.',
      cta: 'Approve as authorized responder',
      tone: 'warn' as const,
      button: 'btn-primary',
    },
    rejected: {
      title: 'Reject this recommendation',
      description: 'The refused action is recorded and carried into every future handoff briefing.',
      cta: 'Reject recommendation',
      tone: 'critical' as const,
      button: 'btn-danger',
    },
    alternative_requested: {
      title: 'Request an alternative',
      description: 'Sentinel will re-run retrieval and propose a different sequence.',
      cta: 'Request alternative',
      tone: 'default' as const,
      button: 'btn-neutral',
    },
  }[decision];

  return (
    <Modal open onClose={onCancel} title={copy.title} description={copy.description} tone={copy.tone}>
      <div className="space-y-3.5">
        <p className="rounded-md border border-edge bg-panel2 px-3 py-2.5 text-sm text-ink">
          {recommendation.proposedAction}
        </p>

        {decision === 'approved' && (
          <p className="flex gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Approving records that you, as an authorized responder, have decided to carry this out.
              Sentinel does not and cannot operate equipment.
            </span>
          </p>
        )}

        <div>
          <label htmlFor="decision-note" className="mb-1 block text-xs font-medium text-muted">
            Reason (optional, stored on the audit trail)
          </label>
          <textarea
            id="decision-note"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className="field resize-none"
            placeholder="e.g. Pressure gauge confirmed at zero by M. Osei."
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(decision)}
            className={copy.button}
            disabled={busy}
          >
            {busy ? <RefreshCw size={14} className="animate-spin" aria-hidden /> : null}
            {copy.cta}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ActorGlyph({ actorType }: { actorType: string }) {
  const map = {
    human: { icon: Users, tone: 'text-info' },
    system: { icon: Activity, tone: 'text-muted' },
    ai: { icon: BrainCircuit, tone: 'text-warn' },
  } as const;
  const entry = map[actorType as keyof typeof map] ?? map.system;
  const Icon = entry.icon;
  return (
    <span className={`mt-0.5 shrink-0 ${entry.tone}`} title={actorType}>
      <Icon size={14} aria-hidden />
    </span>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatElapsed(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
