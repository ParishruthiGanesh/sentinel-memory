/**
 * Architecture & integration explanation.
 *
 * Server-rendered and static apart from the live status strip, so it loads
 * instantly during a demo. The diagram is styled HTML/CSS — no image asset and
 * no client-side diagramming library.
 */

import {
  ArrowDown,
  Boxes,
  BrainCircuit,
  Database,
  GitBranchPlus,
  Layers3,
  Lock,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Terminal,
  UserRound,
} from 'lucide-react';
import { Chip, KeyValue, Panel } from '@/components/ui';
import { loadSystemStatus } from '@/lib/server-data';

export const dynamic = 'force-dynamic';

export default async function ArchitecturePage() {
  const status = await loadSystemStatus();

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Architecture &amp; Integrations</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Sentinel Memory is an incident-response command center whose memory is a database, not a
          context window. CockroachDB holds live incident state, the immutable event log and the
          vector-searchable record of what past actions actually caused; Amazon Bedrock reasons over
          what CockroachDB returns.
        </p>
      </header>

      {/* ------------------------------ diagram ---------------------------- */}
      <Panel title="Request path">
        <div className="space-y-3 p-4 sm:p-6">
          <Node
            icon={<UserRound size={16} />}
            title="Responder / incident commander"
            detail="Reports observations, proposes actions, approves or rejects recommendations."
            tone="info"
          />
          <Connector />
          <Node
            icon={<MonitorSmartphone size={16} />}
            title="Next.js Incident Command Center"
            detail="App Router. Server components read the store directly; client components handle mutations. No secret ever reaches the browser."
          />
          <Connector />
          <Node
            icon={<Server size={16} />}
            title="Server-side agent orchestrator"
            detail="embed → retrieve → ground → validate → persist. The single place the memory loop lives (src/lib/agent/orchestrator.ts)."
            tone="warn"
          />

          <div className="grid gap-3 pt-1 md:grid-cols-2">
            <div className="space-y-3">
              <ArrowLabel label="reasoning" />
              <Node
                icon={<BrainCircuit size={16} />}
                title="Amazon Bedrock"
                detail="Converse API with the model named by BEDROCK_MODEL_ID. Returns strict JSON validated by Zod before a responder ever sees it."
                tone="info"
                foot={
                  status.bedrock.configured
                    ? `${status.bedrock.region} · ${status.bedrock.modelId}`
                    : 'not configured — local rule-based fallback active'
                }
                ok={status.bedrock.configured}
              />
            </div>

            <div className="space-y-3">
              <ArrowLabel label="memory + system of record" />
              <Node
                icon={<Database size={16} />}
                title="CockroachDB Cloud"
                detail="Incident state, immutable memory events, vector embeddings, recommendations, approvals, contradictions, handoffs and the audit trail — one database, one transaction boundary."
                tone="success"
                foot={
                  status.database.configured
                    ? status.database.reachable
                      ? `${status.database.host} · vector index ${status.database.vectorIndexPresent ? 'present' : 'absent'}`
                      : 'configured but unreachable'
                    : 'not configured — in-memory demo store active'
                }
                ok={status.database.configured && status.database.reachable}
              />
            </div>
          </div>

          <div className="pt-2">
            <Connector />
            <Node
              icon={<Terminal size={16} />}
              title="CockroachDB Cloud Managed MCP Server"
              detail="A separate, operator-facing path at https://cockroachlabs.cloud/mcp. Used during development to inspect schema and validate cluster state from the editor. It is not in the application's request path."
              tone="info"
              foot="read-only / audit-friendly inspection · see docs/MCP.md"
            />
          </div>
        </div>
      </Panel>

      {/* ---------------------------- memory types ------------------------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Layers3 size={13} className="text-info" aria-hidden /> Episodic memory
            </span>
          }
          subtitle="What happened during a specific incident"
        >
          <div className="space-y-2.5 p-4 text-sm text-muted">
            <p>
              Every observation, retrieval, recommendation, human decision, state change and handoff
              is appended to <code className="font-mono text-info">memory_events</code> with its
              actor, timestamp and metadata. Rows are never updated or deleted.
            </p>
            <p>
              This is what makes the timeline reconstructable: any agent, at any time, can rebuild
              the incident&apos;s history by reading the log — no session transcript required.
            </p>
            <p className="text-xs">
              Tables: <code className="font-mono">incidents</code>,{' '}
              <code className="font-mono">memory_events</code>,{' '}
              <code className="font-mono">action_decisions</code>,{' '}
              <code className="font-mono">audit_events</code>
            </p>
          </div>
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Boxes size={13} className="text-warn" aria-hidden /> Semantic memory
            </span>
          }
          subtitle="Lessons, patterns, procedures and consequences"
        >
          <div className="space-y-2.5 p-4 text-sm text-muted">
            <p>
              Historical incidents are distilled into rows in{' '}
              <code className="font-mono text-warn">memory_embeddings</code>, each carrying the
              action taken, the outcome it produced and the lesson recorded — plus a{' '}
              <code className="font-mono">VECTOR({status.embeddingDimensions})</code> embedding.
            </p>
            <p>
              A new observation is embedded and matched by cosine distance, so &ldquo;smoke near
              Machine 7&rdquo; retrieves a 2025 pressure-transfer incident that shares no keywords
              with the query.
            </p>
            <p className="text-xs">
              This is why Sentinel remembers <span className="text-ink">consequences</span>, not
              conversations.
            </p>
          </div>
        </Panel>
      </div>

      {/* --------------------------- why cockroach ------------------------- */}
      <Panel title="Why CockroachDB is the right home for agent memory">
        <ul className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          <Reason
            title="Structured state and vector memory live together"
            body="No separate vector database to sync. A single query joins memory_embeddings to incidents, so a retrieved vector immediately carries its incident code, severity and date."
          />
          <Reason
            title="Transactional action approval"
            body="The approval record, the recommendation status, the incident state and the audit event commit as one unit. A recommendation cannot read as approved without its audit trail."
          />
          <Reason
            title="Durable incident history"
            body="Agents restart, responders change shift, processes get redeployed. The incident record does not live in a context window, so none of that loses it."
          />
          <Reason
            title="PostgreSQL-compatible access"
            body="Standard pg driver, parameterized SQL, familiar tooling. Nothing bespoke to learn or maintain."
          />
          <Reason
            title="Serializable isolation with retries"
            body="Concurrent responders deciding on the same incident contend safely: withTransaction retries SQLSTATE 40001 with exponential backoff instead of corrupting state."
          />
          <Reason
            title="Distributed and production-oriented"
            body="Survivability and horizontal scale are properties of the database, not something the application layer has to reinvent for a safety-critical workload."
          />
        </ul>
      </Panel>

      {/* ------------------------------ safety ----------------------------- */}
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Lock size={13} className="text-success" aria-hidden /> Safety model
          </span>
        }
      >
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="space-y-2 text-sm text-muted">
            <p className="flex gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              Sentinel has <span className="text-ink">no machinery control path</span>. It cannot
              start, stop, isolate or energize anything. Approving a recommendation records a human
              authorization; a person performs the action.
            </p>
            <p className="flex gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              A post-model safety floor forces{' '}
              <code className="font-mono">requiresHumanApproval</code> on any high-risk physical
              action regardless of what the model returned, and filters out memory citations that
              were not actually retrieved.
            </p>
            <p className="flex gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              Structured output is validated with Zod. A malformed or unsafe response is rejected —
              no recommendation is recorded — rather than shown to a responder.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-edge bg-panel2/50 p-3.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Live configuration
            </h3>
            <dl className="grid grid-cols-2 gap-3">
              <KeyValue
                label="Store"
                value={status.mode.store === 'cockroachdb' ? 'CockroachDB' : 'in-memory demo'}
              />
              <KeyValue
                label="Reasoning"
                value={status.mode.reasoning === 'bedrock' ? 'Amazon Bedrock' : 'local fallback'}
              />
              <KeyValue
                label="Embeddings"
                value={status.mode.embeddings === 'bedrock' ? 'Amazon Bedrock' : 'local fallback'}
              />
              <KeyValue label="Vector width" value={`${status.embeddingDimensions}d`} />
            </dl>
            <p className="pt-1 text-[11px] text-muted">
              Read live from <code className="font-mono">/api/health</code>, which returns
              configuration booleans and non-secret identifiers only.
            </p>
          </div>
        </div>
      </Panel>

      {/* ----------------------------- handoff ----------------------------- */}
      <Panel
        title={
          <span className="flex items-center gap-2">
            <GitBranchPlus size={13} className="text-info" aria-hidden /> Continuity
          </span>
        }
      >
        <p className="p-4 text-sm leading-relaxed text-muted">
          When the primary agent disconnects, nothing about the incident is lost, because nothing
          about the incident was ever stored in the agent. The backup reconstructs its briefing by
          querying <code className="font-mono">memory_events</code>,{' '}
          <code className="font-mono">action_decisions</code> and{' '}
          <code className="font-mono">memory_embeddings</code>, then asks Bedrock to compress that
          into what happened, what was attempted, what must not be repeated, what is still risky and
          what to do next. The briefing itself is stored in{' '}
          <code className="font-mono">incident_handoffs</code>, so it too survives.
        </p>
      </Panel>
    </div>
  );
}

function Node({
  icon,
  title,
  detail,
  tone = 'default',
  foot,
  ok,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  tone?: 'default' | 'info' | 'warn' | 'success';
  foot?: string;
  ok?: boolean;
}) {
  const border = {
    default: 'border-edge',
    info: 'border-info/40',
    warn: 'border-warn/40',
    success: 'border-success/40',
  }[tone];
  const iconTone = {
    default: 'text-muted',
    info: 'text-info',
    warn: 'text-warn',
    success: 'text-success',
  }[tone];

  return (
    <div className={`rounded-lg border bg-panel2/50 p-3.5 ${border}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 ${iconTone}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
          {foot && (
            <p className="mt-2">
              <Chip tone={ok === undefined ? 'neutral' : ok ? 'success' : 'warn'}>{foot}</Chip>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex justify-center py-0.5" aria-hidden>
      <ArrowDown size={16} className="text-edge" />
    </div>
  );
}

function ArrowLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted" aria-hidden>
      <ArrowDown size={14} className="text-edge" />
      {label}
    </div>
  );
}

function Reason({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
    </li>
  );
}
