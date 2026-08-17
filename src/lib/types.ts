/**
 * Core domain types for Sentinel Memory.
 *
 * These mirror the CockroachDB schema in `db/migrations/001_init.sql` and are
 * the shared contract between the data store implementations, the agent
 * orchestrator, the API routes and the UI.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RiskLevel = Severity;

export type IncidentStatus = 'active' | 'contained' | 'resolved' | 'closed';

export type IncidentPhase =
  | 'detection'
  | 'assessment'
  | 'containment'
  | 'stabilization'
  | 'recovery'
  | 'review';

export type ActorType = 'human' | 'system' | 'ai';

export type MemoryEventType =
  | 'incident_created'
  | 'observation'
  | 'memory_retrieved'
  | 'risk_detected'
  | 'recommendation'
  | 'human_decision'
  | 'state_change'
  | 'handoff'
  | 'contradiction'
  | 'note';

export type MemoryType =
  | 'incident_summary'
  | 'observation'
  | 'action_taken'
  | 'outcome'
  | 'lesson_learned'
  | 'safety_procedure';

export type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export type DecisionType = 'approved' | 'rejected' | 'alternative_requested';

export type AgentStatus = 'active' | 'ready' | 'standby' | 'disconnected';

export interface Incident {
  id: string;
  incidentCode: string;
  title: string;
  description: string;
  location: string;
  severity: Severity;
  status: IncidentStatus;
  currentPhase: IncidentPhase;
  assignedAgentId: string | null;
  assignedAgentName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  lastSeenAt: string;
  createdAt: string;
}

export interface MemoryEvent {
  id: string;
  incidentId: string | null;
  eventType: MemoryEventType;
  actorType: ActorType;
  actorName: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  immutable: boolean;
}

export interface MemoryRecord {
  id: string;
  memoryEventId: string | null;
  incidentId: string | null;
  incidentCode?: string | null;
  incidentTitle?: string | null;
  incidentDate?: string | null;
  memoryType: MemoryType;
  sourceText: string;
  actionTaken?: string | null;
  outcome: string | null;
  lessonLearned: string | null;
  severity: Severity | null;
  createdAt: string;
}

/** A memory record plus its similarity to the query vector. */
export interface RetrievedMemory extends MemoryRecord {
  /** Cosine similarity in [0, 1]. Higher is more similar. */
  similarity: number;
  /** Raw cosine distance returned by the vector index (1 - similarity). */
  distance: number;
}

export interface Recommendation {
  id: string;
  incidentId: string;
  proposedAction: string;
  explanation: string;
  confidence: number;
  riskLevel: RiskLevel;
  status: RecommendationStatus;
  retrievedMemoryIds: string[];
  potentialConsequences: string[];
  requiresHumanApproval: boolean;
  createdAt: string;
  decidedAt: string | null;
}

export interface ActionDecision {
  id: string;
  recommendationId: string;
  incidentId: string;
  decision: DecisionType;
  decidedBy: string;
  reason: string | null;
  createdAt: string;
}

export interface SafetyRule {
  id: string;
  name: string;
  description: string;
  actionPattern: string;
  enforcementLevel: 'block' | 'warn' | 'advise';
  requiresHumanApproval: boolean;
  active: boolean;
  createdAt: string;
}

export interface Contradiction {
  id: string;
  incidentId: string;
  statementA: string;
  statementB: string;
  explanation: string;
  resolutionStatus: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
}

export interface HandoffSummary {
  whatHappened: string;
  whatWasAttempted: string[];
  whatMustNotBeRepeated: string[];
  currentRisks: string[];
  unresolvedQuestions: string[];
  recommendedNextAction: string;
}

export interface IncidentHandoff {
  id: string;
  incidentId: string;
  fromAgentId: string;
  toAgentId: string;
  fromAgentName?: string;
  toAgentName?: string;
  summary: HandoffSummary;
  supportingMemoryIds: string[];
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  incidentId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: string;
}

/** Which backend is actually serving data / reasoning right now. */
export interface RuntimeMode {
  /** 'cockroachdb' when DATABASE_URL is configured, otherwise 'in-memory-demo'. */
  store: 'cockroachdb' | 'in-memory-demo';
  /** 'bedrock' when AWS credentials + model id are configured, else 'local-heuristic'. */
  reasoning: 'bedrock' | 'local-heuristic';
  /** 'bedrock' when an embedding model is configured, else the deterministic fallback. */
  embeddings: 'bedrock' | 'local-deterministic';
  demoMode: boolean;
}

/** Result of a vector-memory retrieval, including the telemetry the UI shows. */
export interface RetrievalResult {
  memories: RetrievedMemory[];
  latencyMs: number;
  memoriesSearched: number;
  /** True when CockroachDB's vector index served the query. */
  vectorIndexUsed: boolean;
  embeddingProvider: RuntimeMode['embeddings'];
  embeddingDimensions: number;
  query: string;
}
