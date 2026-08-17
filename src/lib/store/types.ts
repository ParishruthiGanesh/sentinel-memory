/**
 * The data-store contract.
 *
 * Everything above this line (API routes, orchestrator, UI) depends only on
 * `DataStore`. Two implementations satisfy it:
 *
 *   - `CockroachStore` — the real system of record (parameterized SQL, vector
 *     retrieval, transactional approvals).
 *   - `DemoStore` — an in-memory implementation seeded from the same corpus, so
 *     the interface can be previewed and unit tested without a cluster.
 *
 * This is also what makes the transaction logic testable without connecting to
 * a production database.
 */

import type {
  ActionDecision,
  Agent,
  AgentStatus,
  AuditEvent,
  Contradiction,
  HandoffSummary,
  Incident,
  IncidentHandoff,
  IncidentPhase,
  IncidentStatus,
  MemoryEvent,
  MemoryEventType,
  MemoryType,
  Recommendation,
  RetrievedMemory,
  RiskLevel,
  SafetyRule,
  Severity,
  ActorType,
} from '@/lib/types';

export interface StoreHealth {
  ok: boolean;
  latencyMs: number;
  version?: string;
  /** True when the CockroachDB vector index exists on memory_embeddings. */
  vectorIndexPresent?: boolean;
  memoryCount?: number;
  error?: string;
}

export interface NewIncident {
  title: string;
  description: string;
  location: string;
  severity: Severity;
  currentPhase: IncidentPhase;
  reportedBy: string;
}

export interface NewMemoryEvent {
  incidentId: string | null;
  eventType: MemoryEventType;
  actorType: ActorType;
  actorName: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchFilters {
  severity?: Severity;
  memoryType?: MemoryType;
  location?: string;
  from?: string;
  to?: string;
  outcomeContains?: string;
}

export interface MemorySearchOptions {
  limit: number;
  filters?: MemorySearchFilters;
  /** Exclude memories belonging to this incident (do not retrieve yourself). */
  excludeIncidentId?: string | null;
  /**
   * Cap how many memories may come from the same source incident. Defaults to
   * 1 so the retrieved-memory panel shows distinct historical incidents.
   */
  maxPerIncident?: number;
}

export interface MemorySearchOutcome {
  memories: RetrievedMemory[];
  /** How many memory rows were candidates for this query. */
  memoriesSearched: number;
  /** True when CockroachDB's vector index served the ordering. */
  vectorIndexUsed: boolean;
}

export interface NewRecommendation {
  incidentId: string;
  proposedAction: string;
  explanation: string;
  confidence: number;
  riskLevel: RiskLevel;
  retrievedMemoryIds: string[];
  potentialConsequences: string[];
  requiresHumanApproval: boolean;
  /** Free-form provenance recorded on the audit trail. */
  provider: string;
}

export interface DecisionRequest {
  recommendationId: string;
  decision: 'approved' | 'rejected' | 'alternative_requested';
  decidedBy: string;
  reason?: string;
  /** Phase the incident moves to on approval. */
  nextPhase?: IncidentPhase;
  nextStatus?: IncidentStatus;
}

export interface DecisionOutcome {
  decision: ActionDecision;
  recommendation: Recommendation;
  incident: Incident;
  auditEvent: AuditEvent;
  memoryEventIds: string[];
}

export interface NewHandoff {
  incidentId: string;
  fromAgentId: string;
  toAgentId: string;
  summary: HandoffSummary;
  supportingMemoryIds: string[];
  /** Provenance of the summary, e.g. the Bedrock model id. */
  provider: string;
}

export interface NewContradiction {
  incidentId: string;
  statementA: string;
  statementB: string;
  explanation: string;
}

export interface DataStore {
  readonly kind: 'cockroachdb' | 'in-memory-demo';

  health(): Promise<StoreHealth>;

  // Incidents & agents
  listIncidents(): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | null>;
  getIncidentByCode(code: string): Promise<Incident | null>;
  createIncident(input: NewIncident): Promise<Incident>;
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;
  setAgentStatus(id: string, status: AgentStatus): Promise<Agent | null>;

  // Durable memory events
  listMemoryEvents(incidentId: string, limit?: number): Promise<MemoryEvent[]>;
  appendMemoryEvent(event: NewMemoryEvent): Promise<MemoryEvent>;

  // Vector memory
  searchMemories(vector: number[], options: MemorySearchOptions): Promise<MemorySearchOutcome>;
  countMemories(): Promise<number>;

  // Safety rules
  listSafetyRules(): Promise<SafetyRule[]>;

  // Recommendations & decisions
  createRecommendation(input: NewRecommendation): Promise<Recommendation>;
  getRecommendation(id: string): Promise<Recommendation | null>;
  listRecommendations(incidentId: string): Promise<Recommendation[]>;
  /**
   * Atomically: write the decision, update the recommendation status, append an
   * immutable audit event, and update the incident state. All four or none.
   */
  decideRecommendation(request: DecisionRequest): Promise<DecisionOutcome>;
  listDecisions(incidentId: string): Promise<(ActionDecision & { proposedAction: string })[]>;

  // Contradictions
  recordContradictions(items: NewContradiction[]): Promise<Contradiction[]>;
  listContradictions(incidentId: string): Promise<Contradiction[]>;

  // Handoffs
  createHandoff(input: NewHandoff): Promise<IncidentHandoff>;
  listHandoffs(incidentId: string): Promise<IncidentHandoff[]>;

  // Audit
  listAuditEvents(incidentId: string, limit?: number): Promise<AuditEvent[]>;
}

/** Raised when a request references an entity that does not exist. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Raised when a request is valid but conflicts with current state. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
