/**
 * In-memory data store.
 *
 * This is the honest local fallback: it is NOT a database and never claims to
 * be. It exists so the interface can be previewed, demonstrated and unit tested
 * when DATABASE_URL is absent. `kind` is `'in-memory-demo'` and the UI renders
 * that as an explicit badge on every page.
 *
 * It implements exactly the same contract as `CockroachStore`, including
 * all-or-nothing approval semantics: the decision mutation builds the new state
 * off to the side and only publishes it once every step has succeeded.
 */

import { randomUUID } from 'node:crypto';
import {
  ACTIVE_INCIDENT_ID,
  SEED_AGENTS,
  SEED_ACTIVE_INCIDENT,
  SEED_HISTORICAL_INCIDENTS,
  SEED_PROCEDURE_MEMORIES,
  SEED_SAFETY_RULES,
  type SeedIncident,
} from '@/lib/seed-data';
import { cosineSimilarity, getEmbeddingProvider } from '@/lib/ai/embeddings';
import type {
  ActionDecision,
  Agent,
  AgentStatus,
  AuditEvent,
  Contradiction,
  Incident,
  IncidentHandoff,
  MemoryEvent,
  MemoryRecord,
  Recommendation,
  RetrievedMemory,
  SafetyRule,
} from '@/lib/types';
import {
  ConflictError,
  NotFoundError,
  type DataStore,
  type DecisionOutcome,
  type DecisionRequest,
  type MemorySearchOptions,
  type MemorySearchOutcome,
  type NewContradiction,
  type NewHandoff,
  type NewIncident,
  type NewMemoryEvent,
  type NewRecommendation,
  type StoreHealth,
} from '@/lib/store/types';
import { applySearchFilters, diversifyByIncident } from '@/lib/store/retrieval';

interface DemoMemoryRow extends MemoryRecord {
  location: string | null;
  embedding: number[] | null;
}

function isoOffset(base: string, minutes: number): string {
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

function nextIncidentCode(existing: Incident[]): string {
  const year = new Date().getUTCFullYear();
  const count = existing.filter((incident) => incident.incidentCode.includes(String(year))).length;
  return `INC-${year}-${String(9000 + count + 1).padStart(4, '0')}`;
}

export class DemoStore implements DataStore {
  readonly kind = 'in-memory-demo' as const;

  private incidents: Incident[] = [];
  private agents: Agent[] = [];
  private events: MemoryEvent[] = [];
  private memories: DemoMemoryRow[] = [];
  private rules: SafetyRule[] = [];
  private recommendations: Recommendation[] = [];
  private decisions: ActionDecision[] = [];
  private contradictions: Contradiction[] = [];
  private handoffs: IncidentHandoff[] = [];
  private audit: AuditEvent[] = [];
  private embeddingsReady = false;

  constructor() {
    this.load();
  }

  // -------------------------------------------------------------------------
  // Seeding
  // -------------------------------------------------------------------------

  private load(): void {
    const now = new Date().toISOString();

    this.agents = SEED_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      lastSeenAt: now,
      createdAt: now,
    }));

    this.rules = SEED_SAFETY_RULES.map((rule) => ({
      ...rule,
      active: true,
      createdAt: now,
    }));

    const loadIncident = (seed: SeedIncident) => {
      const agent = this.agents.find((candidate) => candidate.id === seed.assignedAgentId);
      this.incidents.push({
        id: seed.id,
        incidentCode: seed.incidentCode,
        title: seed.title,
        description: seed.description,
        location: seed.location,
        severity: seed.severity,
        status: seed.status,
        currentPhase: seed.currentPhase,
        assignedAgentId: seed.assignedAgentId,
        assignedAgentName: agent?.name ?? null,
        createdAt: seed.occurredAt,
        updatedAt: isoOffset(seed.occurredAt, 30),
      });

      for (const observation of seed.observations) {
        this.events.push({
          id: observation.id,
          incidentId: seed.id,
          eventType: observation.eventType,
          actorType: observation.actorType,
          actorName: observation.actorName,
          content: observation.content,
          metadata: {},
          createdAt: isoOffset(seed.occurredAt, observation.offsetMinutes),
          immutable: true,
        });
      }

      for (const memory of seed.memories) {
        this.memories.push({
          id: memory.id,
          memoryEventId: null,
          incidentId: seed.id,
          incidentCode: seed.incidentCode,
          incidentTitle: seed.title,
          incidentDate: seed.occurredAt,
          location: seed.location,
          memoryType: memory.memoryType,
          sourceText: memory.sourceText,
          actionTaken: memory.actionTaken,
          outcome: memory.outcome,
          lessonLearned: memory.lessonLearned,
          severity: memory.severity,
          createdAt: seed.occurredAt,
          embedding: null,
        });
      }
    };

    SEED_HISTORICAL_INCIDENTS.forEach(loadIncident);
    loadIncident(SEED_ACTIVE_INCIDENT);

    for (const memory of SEED_PROCEDURE_MEMORIES) {
      this.memories.push({
        id: memory.id,
        memoryEventId: null,
        incidentId: null,
        incidentCode: 'PROCEDURE',
        incidentTitle: 'Standing safety procedure',
        incidentDate: null,
        location: null,
        memoryType: memory.memoryType,
        sourceText: memory.sourceText,
        actionTaken: memory.actionTaken,
        outcome: memory.outcome,
        lessonLearned: memory.lessonLearned,
        severity: memory.severity,
        createdAt: now,
        embedding: null,
      });
    }
  }

  private async ensureEmbeddings(): Promise<void> {
    if (this.embeddingsReady) return;
    const provider = getEmbeddingProvider();
    for (const memory of this.memories) {
      if (memory.embedding) continue;
      memory.embedding = await provider.embed(embeddableText(memory));
    }
    this.embeddingsReady = true;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async health(): Promise<StoreHealth> {
    return {
      ok: true,
      latencyMs: 0,
      version: 'in-memory demo store (no database connection)',
      vectorIndexPresent: false,
      memoryCount: this.memories.length,
    };
  }

  // -------------------------------------------------------------------------
  // Incidents & agents
  // -------------------------------------------------------------------------

  async listIncidents(): Promise<Incident[]> {
    return copy(this.incidents).sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  async getIncident(id: string): Promise<Incident | null> {
    const found = this.incidents.find((incident) => incident.id === id);
    return found ? copy(found) : null;
  }

  async getIncidentByCode(code: string): Promise<Incident | null> {
    const found = this.incidents.find((incident) => incident.incidentCode === code);
    return found ? copy(found) : null;
  }

  async createIncident(input: NewIncident): Promise<Incident> {
    const now = new Date().toISOString();
    const incident: Incident = {
      id: randomUUID(),
      incidentCode: nextIncidentCode(this.incidents),
      title: input.title,
      description: input.description,
      location: input.location,
      severity: input.severity,
      status: 'active',
      currentPhase: input.currentPhase,
      assignedAgentId: this.agents[0]?.id ?? null,
      assignedAgentName: this.agents[0]?.name ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.incidents.unshift(incident);

    await this.appendMemoryEvent({
      incidentId: incident.id,
      eventType: 'incident_created',
      actorType: 'human',
      actorName: input.reportedBy,
      content: `Incident ${incident.incidentCode} opened: ${incident.title} at ${incident.location}. Severity ${incident.severity}.`,
      metadata: { severity: incident.severity, phase: incident.currentPhase },
    });

    this.audit.push(auditRow(incident.id, 'incident', incident.id, 'created', input.reportedBy, null, {
      status: incident.status,
      phase: incident.currentPhase,
    }));

    return copy(incident);
  }

  async listAgents(): Promise<Agent[]> {
    return copy(this.agents);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const found = this.agents.find((agent) => agent.id === id);
    return found ? copy(found) : null;
  }

  async setAgentStatus(id: string, status: AgentStatus): Promise<Agent | null> {
    const agent = this.agents.find((candidate) => candidate.id === id);
    if (!agent) return null;
    agent.status = status;
    agent.lastSeenAt = new Date().toISOString();
    return copy(agent);
  }

  // -------------------------------------------------------------------------
  // Memory events
  // -------------------------------------------------------------------------

  async listMemoryEvents(incidentId: string, limit = 200): Promise<MemoryEvent[]> {
    return copy(
      this.events
        .filter((event) => event.incidentId === incidentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-limit),
    );
  }

  async appendMemoryEvent(event: NewMemoryEvent): Promise<MemoryEvent> {
    const row: MemoryEvent = {
      id: randomUUID(),
      incidentId: event.incidentId,
      eventType: event.eventType,
      actorType: event.actorType,
      actorName: event.actorName,
      content: event.content,
      metadata: event.metadata ?? {},
      createdAt: new Date().toISOString(),
      immutable: true,
    };
    this.events.push(row);
    return copy(row);
  }

  // -------------------------------------------------------------------------
  // Vector memory
  // -------------------------------------------------------------------------

  async searchMemories(
    vector: number[],
    options: MemorySearchOptions,
  ): Promise<MemorySearchOutcome> {
    await this.ensureEmbeddings();

    const candidates = applySearchFilters(this.memories, {
      filters: options.filters,
      excludeIncidentId: options.excludeIncidentId ?? null,
    });

    const scored: RetrievedMemory[] = candidates
      .filter((memory) => memory.embedding !== null)
      .map((memory) => {
        const similarity = cosineSimilarity(vector, memory.embedding!);
        // Cosine distance in CockroachDB's `<=>` operator is 1 - similarity.
        return { ...stripInternal(memory), similarity, distance: 1 - similarity };
      })
      .sort((a, b) => b.similarity - a.similarity);

    return {
      memories: diversifyByIncident(scored, options.limit, options.maxPerIncident ?? 1),
      memoriesSearched: candidates.length,
      vectorIndexUsed: false,
    };
  }

  async countMemories(): Promise<number> {
    return this.memories.length;
  }

  // -------------------------------------------------------------------------
  // Safety rules
  // -------------------------------------------------------------------------

  async listSafetyRules(): Promise<SafetyRule[]> {
    return copy(this.rules.filter((rule) => rule.active));
  }

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  async createRecommendation(input: NewRecommendation): Promise<Recommendation> {
    const incident = await this.getIncident(input.incidentId);
    if (!incident) throw new NotFoundError(`Incident ${input.incidentId} not found`);

    const recommendation: Recommendation = {
      id: randomUUID(),
      incidentId: input.incidentId,
      proposedAction: input.proposedAction,
      explanation: input.explanation,
      confidence: input.confidence,
      riskLevel: input.riskLevel,
      status: 'pending',
      retrievedMemoryIds: input.retrievedMemoryIds,
      potentialConsequences: input.potentialConsequences,
      requiresHumanApproval: input.requiresHumanApproval,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };

    // Any earlier pending recommendation for this incident is superseded.
    for (const existing of this.recommendations) {
      if (existing.incidentId === input.incidentId && existing.status === 'pending') {
        existing.status = 'superseded';
      }
    }

    this.recommendations.push(recommendation);
    this.audit.push(
      auditRow(input.incidentId, 'recommendation', recommendation.id, 'created', input.provider, null, {
        riskLevel: recommendation.riskLevel,
        status: recommendation.status,
      }),
    );
    return copy(recommendation);
  }

  async getRecommendation(id: string): Promise<Recommendation | null> {
    const found = this.recommendations.find((recommendation) => recommendation.id === id);
    return found ? copy(found) : null;
  }

  async listRecommendations(incidentId: string): Promise<Recommendation[]> {
    return copy(
      this.recommendations
        .filter((recommendation) => recommendation.incidentId === incidentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  /**
   * All-or-nothing decision.
   *
   * Every mutation is prepared first and only applied to the store once all of
   * them have succeeded, mirroring the CockroachDB transaction. A validation
   * failure part-way through leaves the store byte-for-byte unchanged.
   */
  async decideRecommendation(request: DecisionRequest): Promise<DecisionOutcome> {
    const recommendation = this.recommendations.find(
      (candidate) => candidate.id === request.recommendationId,
    );
    if (!recommendation) {
      throw new NotFoundError(`Recommendation ${request.recommendationId} not found`);
    }
    if (recommendation.status !== 'pending') {
      throw new ConflictError(
        `Recommendation ${request.recommendationId} has already been ${recommendation.status}`,
      );
    }

    const incident = this.incidents.find(
      (candidate) => candidate.id === recommendation.incidentId,
    );
    if (!incident) {
      throw new NotFoundError(`Incident ${recommendation.incidentId} not found`);
    }

    const now = new Date().toISOString();

    // ---- prepare (nothing published yet) ----
    const decision: ActionDecision = {
      id: randomUUID(),
      recommendationId: recommendation.id,
      incidentId: recommendation.incidentId,
      decision: request.decision,
      decidedBy: request.decidedBy,
      reason: request.reason ?? null,
      createdAt: now,
    };

    const nextRecommendation: Recommendation = {
      ...recommendation,
      status:
        request.decision === 'approved'
          ? 'approved'
          : request.decision === 'rejected'
            ? 'rejected'
            : 'superseded',
      decidedAt: now,
    };

    const beforeState = { status: incident.status, phase: incident.currentPhase };
    const nextIncident: Incident = {
      ...incident,
      status: request.nextStatus ?? incident.status,
      currentPhase:
        request.decision === 'approved'
          ? (request.nextPhase ?? incident.currentPhase)
          : incident.currentPhase,
      updatedAt: now,
    };

    const audit = auditRow(
      incident.id,
      'recommendation',
      recommendation.id,
      `decision:${request.decision}`,
      request.decidedBy,
      { ...beforeState, recommendationStatus: recommendation.status },
      {
        status: nextIncident.status,
        phase: nextIncident.currentPhase,
        recommendationStatus: nextRecommendation.status,
      },
    );

    const decisionEvent: MemoryEvent = {
      id: randomUUID(),
      incidentId: incident.id,
      eventType: 'human_decision',
      actorType: 'human',
      actorName: request.decidedBy,
      content: `${labelDecision(request.decision)}: "${recommendation.proposedAction}"${
        request.reason ? ` — ${request.reason}` : ''
      }`,
      metadata: { recommendationId: recommendation.id, decision: request.decision },
      createdAt: now,
      immutable: true,
    };

    const stateEvent: MemoryEvent | null =
      nextIncident.currentPhase !== incident.currentPhase ||
      nextIncident.status !== incident.status
        ? {
            id: randomUUID(),
            incidentId: incident.id,
            eventType: 'state_change',
            actorType: 'system',
            actorName: 'Sentinel',
            content: `Incident state updated: status ${beforeState.status} -> ${nextIncident.status}, phase ${beforeState.phase} -> ${nextIncident.currentPhase}.`,
            metadata: { before: beforeState, after: { status: nextIncident.status, phase: nextIncident.currentPhase } },
            createdAt: now,
            immutable: true,
          }
        : null;

    // ---- commit (single synchronous block, cannot partially fail) ----
    Object.assign(recommendation, nextRecommendation);
    Object.assign(incident, nextIncident);
    this.decisions.push(decision);
    this.audit.push(audit);
    this.events.push(decisionEvent);
    if (stateEvent) this.events.push(stateEvent);

    return {
      decision: copy(decision),
      recommendation: copy(recommendation),
      incident: copy(incident),
      auditEvent: copy(audit),
      memoryEventIds: stateEvent ? [decisionEvent.id, stateEvent.id] : [decisionEvent.id],
    };
  }

  async listDecisions(
    incidentId: string,
  ): Promise<(ActionDecision & { proposedAction: string })[]> {
    return this.decisions
      .filter((decision) => decision.incidentId === incidentId)
      .map((decision) => ({
        ...decision,
        proposedAction:
          this.recommendations.find((rec) => rec.id === decision.recommendationId)
            ?.proposedAction ?? '(recommendation not found)',
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // -------------------------------------------------------------------------
  // Contradictions
  // -------------------------------------------------------------------------

  async recordContradictions(items: NewContradiction[]): Promise<Contradiction[]> {
    const created = items.map((item) => ({
      id: randomUUID(),
      incidentId: item.incidentId,
      statementA: item.statementA,
      statementB: item.statementB,
      explanation: item.explanation,
      resolutionStatus: 'open' as const,
      createdAt: new Date().toISOString(),
    }));
    this.contradictions.push(...created);
    return copy(created);
  }

  async listContradictions(incidentId: string): Promise<Contradiction[]> {
    return copy(this.contradictions.filter((item) => item.incidentId === incidentId));
  }

  // -------------------------------------------------------------------------
  // Handoffs
  // -------------------------------------------------------------------------

  async createHandoff(input: NewHandoff): Promise<IncidentHandoff> {
    const from = await this.getAgent(input.fromAgentId);
    const to = await this.getAgent(input.toAgentId);
    if (!from || !to) throw new NotFoundError('Handoff agent not found');

    const handoff: IncidentHandoff = {
      id: randomUUID(),
      incidentId: input.incidentId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      fromAgentName: from.name,
      toAgentName: to.name,
      summary: input.summary,
      supportingMemoryIds: input.supportingMemoryIds,
      createdAt: new Date().toISOString(),
    };

    this.handoffs.push(handoff);
    this.incidents = this.incidents.map((incident) =>
      incident.id === input.incidentId
        ? {
            ...incident,
            assignedAgentId: to.id,
            assignedAgentName: to.name,
            updatedAt: handoff.createdAt,
          }
        : incident,
    );
    from.status = 'standby';
    to.status = 'active';

    this.events.push({
      id: randomUUID(),
      incidentId: input.incidentId,
      eventType: 'handoff',
      actorType: 'ai',
      actorName: 'Sentinel',
      content: `Incident handed off from ${from.name} to ${to.name}. Continuity briefing generated from durable memory.`,
      metadata: { handoffId: handoff.id, provider: input.provider },
      createdAt: handoff.createdAt,
      immutable: true,
    });

    this.audit.push(
      auditRow(input.incidentId, 'handoff', handoff.id, 'created', input.provider, null, {
        fromAgent: from.name,
        toAgent: to.name,
      }),
    );

    return copy(handoff);
  }

  async listHandoffs(incidentId: string): Promise<IncidentHandoff[]> {
    return copy(
      this.handoffs
        .filter((handoff) => handoff.incidentId === incidentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async listAuditEvents(incidentId: string, limit = 200): Promise<AuditEvent[]> {
    return copy(
      this.audit
        .filter((event) => event.incidentId === incidentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-limit),
    );
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Return a defensive copy.
 *
 * A real database hands back rows, not live objects. Returning internal
 * references from the demo store would let a caller mutate committed state by
 * accident, which would make it behave unlike CockroachDB in exactly the place
 * that matters most — the approval path.
 */
function copy<T>(value: T): T {
  return Array.isArray(value)
    ? (value.map((item) => ({ ...item })) as unknown as T)
    : ({ ...value } as T);
}

function stripInternal(memory: DemoMemoryRow): MemoryRecord {
  const { embedding: _embedding, location: _location, ...rest } = memory;
  return rest;
}

function auditRow(
  incidentId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  actor: string,
  beforeState: Record<string, unknown> | null,
  afterState: Record<string, unknown> | null,
): AuditEvent {
  return {
    id: randomUUID(),
    incidentId,
    entityType,
    entityId,
    action,
    actor,
    beforeState,
    afterState,
    createdAt: new Date().toISOString(),
  };
}

function labelDecision(decision: DecisionRequest['decision']): string {
  if (decision === 'approved') return 'Approved recommended action';
  if (decision === 'rejected') return 'Rejected recommended action';
  return 'Requested an alternative to';
}

/** The text that gets embedded for a memory row — kept identical across stores. */
export function embeddableText(memory: {
  sourceText: string;
  actionTaken?: string | null;
  outcome?: string | null;
  lessonLearned?: string | null;
}): string {
  return [memory.sourceText, memory.actionTaken, memory.outcome, memory.lessonLearned]
    .filter(Boolean)
    .join('\n');
}

/** Convenience: the incident the demo opens on. */
export const DEMO_ACTIVE_INCIDENT_ID = ACTIVE_INCIDENT_ID;
