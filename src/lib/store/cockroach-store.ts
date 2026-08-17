/**
 * CockroachDB implementation of the data store — the system of record.
 *
 * Every statement is parameterized. Safety-critical state changes run inside
 * `withTransaction`, which retries serialization conflicts (SQLSTATE 40001).
 * Vector retrieval uses the `<=>` cosine-distance operator, which CockroachDB's
 * distributed vector index accelerates.
 */

import { getPool, toVectorLiteral, withTransaction, type Queryable } from '@/lib/db/client';
import { diversifyByIncident } from '@/lib/store/retrieval';
import {
  ConflictError,
  NotFoundError,
  type DataStore,
  type DecisionOutcome,
  type DecisionRequest,
  type MemorySearchFilters,
  type MemorySearchOptions,
  type MemorySearchOutcome,
  type NewContradiction,
  type NewHandoff,
  type NewIncident,
  type NewMemoryEvent,
  type NewRecommendation,
  type StoreHealth,
} from '@/lib/store/types';
import type {
  ActionDecision,
  Agent,
  AgentStatus,
  AuditEvent,
  Contradiction,
  HandoffSummary,
  Incident,
  IncidentHandoff,
  MemoryEvent,
  Recommendation,
  RetrievedMemory,
  SafetyRule,
} from '@/lib/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function mapIncident(row: Row): Incident {
  return {
    id: row.id,
    incidentCode: row.incident_code,
    title: row.title,
    description: row.description,
    location: row.location,
    severity: row.severity,
    status: row.status,
    currentPhase: row.current_phase,
    assignedAgentId: row.assigned_agent_id ?? null,
    assignedAgentName: row.assigned_agent_name ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapAgent(row: Row): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    lastSeenAt: iso(row.last_seen_at),
    createdAt: iso(row.created_at),
  };
}

function mapMemoryEvent(row: Row): MemoryEvent {
  return {
    id: row.id,
    incidentId: row.incident_id ?? null,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorName: row.actor_name,
    content: row.content,
    metadata: jsonObject(row.metadata),
    createdAt: iso(row.created_at),
    immutable: row.immutable ?? true,
  };
}

function mapRecommendation(row: Row): Recommendation {
  return {
    id: row.id,
    incidentId: row.incident_id,
    proposedAction: row.proposed_action,
    explanation: row.explanation,
    confidence: Number(row.confidence),
    riskLevel: row.risk_level,
    status: row.status,
    retrievedMemoryIds: jsonArray(row.retrieved_memory_ids),
    potentialConsequences: jsonArray(row.potential_consequences),
    requiresHumanApproval: Boolean(row.requires_human_approval),
    createdAt: iso(row.created_at),
    decidedAt: isoOrNull(row.decided_at),
  };
}

function mapDecision(row: Row): ActionDecision {
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    incidentId: row.incident_id,
    decision: row.decision,
    decidedBy: row.decided_by,
    reason: row.reason ?? null,
    createdAt: iso(row.created_at),
  };
}

function mapAudit(row: Row): AuditEvent {
  return {
    id: row.id,
    incidentId: row.incident_id ?? null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actor: row.actor,
    beforeState: row.before_state ? jsonObject(row.before_state) : null,
    afterState: row.after_state ? jsonObject(row.after_state) : null,
    createdAt: iso(row.created_at),
  };
}

function mapSafetyRule(row: Row): SafetyRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    actionPattern: row.action_pattern,
    enforcementLevel: row.enforcement_level,
    requiresHumanApproval: Boolean(row.requires_human_approval),
    active: Boolean(row.active),
    createdAt: iso(row.created_at),
  };
}

/** Build the WHERE fragment for the Memory Explorer's structured filters. */
export function buildMemoryFilterClause(
  filters: MemorySearchFilters | undefined,
  excludeIncidentId: string | null | undefined,
  startIndex: number,
): { clause: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let index = startIndex;

  const push = (sql: string, value: unknown) => {
    conditions.push(sql.replace('$$', `$${index}`));
    values.push(value);
    index += 1;
  };

  if (excludeIncidentId) push('(m.incident_id IS NULL OR m.incident_id <> $$)', excludeIncidentId);
  if (filters?.severity) push('m.severity = $$', filters.severity);
  if (filters?.memoryType) push('m.memory_type = $$', filters.memoryType);
  if (filters?.location) push('i.location ILIKE $$', `%${filters.location}%`);
  if (filters?.outcomeContains) push('m.outcome ILIKE $$', `%${filters.outcomeContains}%`);
  if (filters?.from) push('COALESCE(i.created_at, m.created_at) >= $$::timestamptz', filters.from);
  if (filters?.to) {
    push('COALESCE(i.created_at, m.created_at) <= $$::timestamptz', `${filters.to}T23:59:59.999Z`);
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export class CockroachStore implements DataStore {
  readonly kind = 'cockroachdb' as const;

  private get db(): Queryable {
    return getPool();
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async health(): Promise<StoreHealth> {
    const started = Date.now();
    try {
      const version = await this.db.query<Row>('SELECT version() AS version');
      const counts = await this.db.query<Row>(
        'SELECT count(*)::int AS memory_count FROM memory_embeddings',
      );

      // `SHOW INDEXES` is the portable way to confirm the vector index exists.
      let vectorIndexPresent = false;
      try {
        const indexes = await this.db.query<Row>('SHOW INDEXES FROM memory_embeddings');
        vectorIndexPresent = indexes.rows.some(
          (row) =>
            String(row.index_name ?? '').includes('embedding') &&
            String(row.column_name ?? '') === 'embedding',
        );
      } catch {
        vectorIndexPresent = false;
      }

      return {
        ok: true,
        latencyMs: Date.now() - started,
        version: String(version.rows[0]?.version ?? '').split(' ').slice(0, 3).join(' '),
        vectorIndexPresent,
        memoryCount: counts.rows[0]?.memory_count ?? 0,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        // Message only — never the DSN or credentials.
        error: error instanceof Error ? error.message : 'unknown database error',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Incidents & agents
  // -------------------------------------------------------------------------

  private static readonly INCIDENT_SELECT = `
    SELECT i.*, a.name AS assigned_agent_name
    FROM incidents i
    LEFT JOIN agents a ON a.id = i.assigned_agent_id
  `;

  async listIncidents(): Promise<Incident[]> {
    const result = await this.db.query<Row>(
      `${CockroachStore.INCIDENT_SELECT}
       ORDER BY (i.status = 'active') DESC, i.created_at DESC
       LIMIT 100`,
    );
    return result.rows.map(mapIncident);
  }

  async getIncident(id: string): Promise<Incident | null> {
    const result = await this.db.query<Row>(
      `${CockroachStore.INCIDENT_SELECT} WHERE i.id = $1`,
      [id],
    );
    return result.rows[0] ? mapIncident(result.rows[0]) : null;
  }

  async getIncidentByCode(code: string): Promise<Incident | null> {
    const result = await this.db.query<Row>(
      `${CockroachStore.INCIDENT_SELECT} WHERE i.incident_code = $1`,
      [code],
    );
    return result.rows[0] ? mapIncident(result.rows[0]) : null;
  }

  async createIncident(input: NewIncident): Promise<Incident> {
    return withTransaction(async (tx) => {
      // Allocate the next code for the current year inside the transaction so
      // two concurrent reports cannot collide on the unique constraint.
      const year = new Date().getUTCFullYear();
      const codeResult = await tx.query<Row>(
        `SELECT count(*)::int AS n FROM incidents WHERE incident_code LIKE $1`,
        [`INC-${year}-%`],
      );
      const incidentCode = `INC-${year}-${String((codeResult.rows[0]?.n ?? 0) + 9001).padStart(4, '0')}`;

      const primaryAgent = await tx.query<Row>(
        `SELECT id FROM agents ORDER BY created_at ASC LIMIT 1`,
      );

      const inserted = await tx.query<Row>(
        `INSERT INTO incidents
           (incident_code, title, description, location, severity, status, current_phase, assigned_agent_id)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
         RETURNING *`,
        [
          incidentCode,
          input.title,
          input.description,
          input.location,
          input.severity,
          input.currentPhase,
          primaryAgent.rows[0]?.id ?? null,
        ],
      );
      const incident = mapIncident(inserted.rows[0]);

      await tx.query(
        `INSERT INTO memory_events (incident_id, event_type, actor_type, actor_name, content, metadata)
         VALUES ($1, 'incident_created', 'human', $2, $3, $4)`,
        [
          incident.id,
          input.reportedBy,
          `Incident ${incident.incidentCode} opened: ${incident.title} at ${incident.location}. Severity ${incident.severity}.`,
          JSON.stringify({ severity: incident.severity, phase: incident.currentPhase }),
        ],
      );

      await tx.query(
        `INSERT INTO audit_events (incident_id, entity_type, entity_id, action, actor, before_state, after_state)
         VALUES ($1, 'incident', $1, 'created', $2, NULL, $3)`,
        [
          incident.id,
          input.reportedBy,
          JSON.stringify({ status: incident.status, phase: incident.currentPhase }),
        ],
      );

      return incident;
    });
  }

  async listAgents(): Promise<Agent[]> {
    const result = await this.db.query<Row>('SELECT * FROM agents ORDER BY created_at ASC');
    return result.rows.map(mapAgent);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const result = await this.db.query<Row>('SELECT * FROM agents WHERE id = $1', [id]);
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async setAgentStatus(id: string, status: AgentStatus): Promise<Agent | null> {
    const result = await this.db.query<Row>(
      `UPDATE agents SET status = $2, last_seen_at = now() WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // Memory events
  // -------------------------------------------------------------------------

  async listMemoryEvents(incidentId: string, limit = 200): Promise<MemoryEvent[]> {
    const result = await this.db.query<Row>(
      `SELECT * FROM memory_events WHERE incident_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [incidentId, limit],
    );
    return result.rows.map(mapMemoryEvent);
  }

  async appendMemoryEvent(event: NewMemoryEvent): Promise<MemoryEvent> {
    const result = await this.db.query<Row>(
      `INSERT INTO memory_events (incident_id, event_type, actor_type, actor_name, content, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        event.incidentId,
        event.eventType,
        event.actorType,
        event.actorName,
        event.content,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
    return mapMemoryEvent(result.rows[0]);
  }

  // -------------------------------------------------------------------------
  // Vector memory
  // -------------------------------------------------------------------------

  async searchMemories(
    vector: number[],
    options: MemorySearchOptions,
  ): Promise<MemorySearchOutcome> {
    const literal = toVectorLiteral(vector);
    const { clause, values } = buildMemoryFilterClause(
      options.filters,
      options.excludeIncidentId,
      2,
    );

    // Over-fetch so diversification still has candidates to choose from after
    // capping how many memories a single source incident may contribute.
    const fetchLimit = Math.max(options.limit * 4, 12);

    const sql = `
      SELECT
        m.id,
        m.memory_event_id,
        m.incident_id,
        m.memory_type,
        m.source_text,
        m.action_taken,
        m.outcome,
        m.lesson_learned,
        m.severity,
        m.created_at,
        i.incident_code,
        i.title  AS incident_title,
        i.created_at AS incident_date,
        m.embedding <=> $1::VECTOR AS distance
      FROM memory_embeddings m
      LEFT JOIN incidents i ON i.id = m.incident_id
      ${clause}
      ORDER BY m.embedding <=> $1::VECTOR
      LIMIT ${fetchLimit}
    `;

    const [ranked, counted] = await Promise.all([
      this.db.query<Row>(sql, [literal, ...values]),
      this.countCandidates(options),
    ]);

    const memories: RetrievedMemory[] = ranked.rows.map((row) => {
      const distance = Number(row.distance);
      return {
        id: row.id,
        memoryEventId: row.memory_event_id ?? null,
        incidentId: row.incident_id ?? null,
        incidentCode: row.incident_code ?? 'PROCEDURE',
        incidentTitle: row.incident_title ?? 'Standing safety procedure',
        incidentDate: isoOrNull(row.incident_date),
        memoryType: row.memory_type,
        sourceText: row.source_text,
        actionTaken: row.action_taken ?? null,
        outcome: row.outcome ?? null,
        lessonLearned: row.lesson_learned ?? null,
        severity: row.severity ?? null,
        createdAt: iso(row.created_at),
        distance,
        // CockroachDB's `<=>` is cosine distance; similarity is its complement.
        similarity: Math.max(0, Math.min(1, 1 - distance)),
      };
    });

    return {
      memories: diversifyByIncident(memories, options.limit, options.maxPerIncident ?? 1),
      memoriesSearched: counted,
      vectorIndexUsed: true,
    };
  }

  private async countCandidates(options: MemorySearchOptions): Promise<number> {
    const { clause, values } = buildMemoryFilterClause(
      options.filters,
      options.excludeIncidentId,
      1,
    );
    const result = await this.db.query<Row>(
      `SELECT count(*)::int AS n
       FROM memory_embeddings m
       LEFT JOIN incidents i ON i.id = m.incident_id
       ${clause}`,
      values,
    );
    return result.rows[0]?.n ?? 0;
  }

  async countMemories(): Promise<number> {
    const result = await this.db.query<Row>(
      'SELECT count(*)::int AS n FROM memory_embeddings',
    );
    return result.rows[0]?.n ?? 0;
  }

  // -------------------------------------------------------------------------
  // Safety rules
  // -------------------------------------------------------------------------

  async listSafetyRules(): Promise<SafetyRule[]> {
    const result = await this.db.query<Row>(
      'SELECT * FROM safety_rules WHERE active = true ORDER BY created_at ASC',
    );
    return result.rows.map(mapSafetyRule);
  }

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  async createRecommendation(input: NewRecommendation): Promise<Recommendation> {
    return withTransaction(async (tx) => {
      const incident = await tx.query<Row>('SELECT id FROM incidents WHERE id = $1', [
        input.incidentId,
      ]);
      if (!incident.rows[0]) throw new NotFoundError(`Incident ${input.incidentId} not found`);

      await tx.query(
        `UPDATE recommendations SET status = 'superseded', decided_at = now()
         WHERE incident_id = $1 AND status = 'pending'`,
        [input.incidentId],
      );

      const inserted = await tx.query<Row>(
        `INSERT INTO recommendations
           (incident_id, proposed_action, explanation, confidence, risk_level, status,
            retrieved_memory_ids, potential_consequences, requires_human_approval)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
         RETURNING *`,
        [
          input.incidentId,
          input.proposedAction,
          input.explanation,
          input.confidence,
          input.riskLevel,
          JSON.stringify(input.retrievedMemoryIds),
          JSON.stringify(input.potentialConsequences),
          input.requiresHumanApproval,
        ],
      );
      const recommendation = mapRecommendation(inserted.rows[0]);

      await tx.query(
        `INSERT INTO audit_events (incident_id, entity_type, entity_id, action, actor, before_state, after_state)
         VALUES ($1, 'recommendation', $2, 'created', $3, NULL, $4)`,
        [
          input.incidentId,
          recommendation.id,
          input.provider,
          JSON.stringify({
            riskLevel: recommendation.riskLevel,
            status: recommendation.status,
            confidence: recommendation.confidence,
          }),
        ],
      );

      return recommendation;
    });
  }

  async getRecommendation(id: string): Promise<Recommendation | null> {
    const result = await this.db.query<Row>('SELECT * FROM recommendations WHERE id = $1', [id]);
    return result.rows[0] ? mapRecommendation(result.rows[0]) : null;
  }

  async listRecommendations(incidentId: string): Promise<Recommendation[]> {
    const result = await this.db.query<Row>(
      'SELECT * FROM recommendations WHERE incident_id = $1 ORDER BY created_at DESC LIMIT 50',
      [incidentId],
    );
    return result.rows.map(mapRecommendation);
  }

  /**
   * The safety-critical transaction.
   *
   * Four writes, one atomic unit: the approval record, the recommendation
   * status, an immutable audit event, and the incident's current state. If any
   * statement fails, none of them are committed — a recommendation can never
   * read as "approved" without the matching audit trail and incident state.
   */
  async decideRecommendation(request: DecisionRequest): Promise<DecisionOutcome> {
    return withTransaction(async (tx) => {
      // FOR UPDATE so two responders cannot both decide the same recommendation.
      const recResult = await tx.query<Row>(
        'SELECT * FROM recommendations WHERE id = $1 FOR UPDATE',
        [request.recommendationId],
      );
      const existing = recResult.rows[0];
      if (!existing) {
        throw new NotFoundError(`Recommendation ${request.recommendationId} not found`);
      }
      if (existing.status !== 'pending') {
        throw new ConflictError(
          `Recommendation ${request.recommendationId} has already been ${existing.status}`,
        );
      }

      const incidentResult = await tx.query<Row>(
        'SELECT * FROM incidents WHERE id = $1 FOR UPDATE',
        [existing.incident_id],
      );
      const incidentBefore = incidentResult.rows[0];
      if (!incidentBefore) {
        throw new NotFoundError(`Incident ${existing.incident_id} not found`);
      }

      // 1. the approval / rejection record
      const decisionResult = await tx.query<Row>(
        `INSERT INTO action_decisions (recommendation_id, incident_id, decision, decided_by, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          request.recommendationId,
          existing.incident_id,
          request.decision,
          request.decidedBy,
          request.reason ?? null,
        ],
      );
      const decision = mapDecision(decisionResult.rows[0]);

      // 2. the recommendation status
      const nextStatus =
        request.decision === 'approved'
          ? 'approved'
          : request.decision === 'rejected'
            ? 'rejected'
            : 'superseded';
      const updatedRec = await tx.query<Row>(
        `UPDATE recommendations SET status = $2, decided_at = now() WHERE id = $1 RETURNING *`,
        [request.recommendationId, nextStatus],
      );

      // 3. the incident's current state
      const nextPhase =
        request.decision === 'approved'
          ? (request.nextPhase ?? incidentBefore.current_phase)
          : incidentBefore.current_phase;
      const nextIncidentStatus = request.nextStatus ?? incidentBefore.status;

      const updatedIncident = await tx.query<Row>(
        `UPDATE incidents SET status = $2, current_phase = $3, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [existing.incident_id, nextIncidentStatus, nextPhase],
      );

      // 4. the immutable audit event
      const beforeState = {
        status: incidentBefore.status,
        phase: incidentBefore.current_phase,
        recommendationStatus: existing.status,
      };
      const afterState = {
        status: nextIncidentStatus,
        phase: nextPhase,
        recommendationStatus: nextStatus,
      };
      const auditResult = await tx.query<Row>(
        `INSERT INTO audit_events (incident_id, entity_type, entity_id, action, actor, before_state, after_state)
         VALUES ($1, 'recommendation', $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          existing.incident_id,
          request.recommendationId,
          `decision:${request.decision}`,
          request.decidedBy,
          JSON.stringify(beforeState),
          JSON.stringify(afterState),
        ],
      );

      // Durable memory events, written in the same transaction so the timeline
      // can never disagree with the audit trail.
      const memoryEventIds: string[] = [];
      const decisionEvent = await tx.query<Row>(
        `INSERT INTO memory_events (incident_id, event_type, actor_type, actor_name, content, metadata)
         VALUES ($1, 'human_decision', 'human', $2, $3, $4)
         RETURNING id`,
        [
          existing.incident_id,
          request.decidedBy,
          `${labelDecision(request.decision)}: "${existing.proposed_action}"${
            request.reason ? ` — ${request.reason}` : ''
          }`,
          JSON.stringify({ recommendationId: request.recommendationId, decision: request.decision }),
        ],
      );
      memoryEventIds.push(decisionEvent.rows[0].id);

      if (nextPhase !== incidentBefore.current_phase || nextIncidentStatus !== incidentBefore.status) {
        const stateEvent = await tx.query<Row>(
          `INSERT INTO memory_events (incident_id, event_type, actor_type, actor_name, content, metadata)
           VALUES ($1, 'state_change', 'system', 'Sentinel', $2, $3)
           RETURNING id`,
          [
            existing.incident_id,
            `Incident state updated: status ${incidentBefore.status} -> ${nextIncidentStatus}, phase ${incidentBefore.current_phase} -> ${nextPhase}.`,
            JSON.stringify({ before: beforeState, after: afterState }),
          ],
        );
        memoryEventIds.push(stateEvent.rows[0].id);
      }

      return {
        decision,
        recommendation: mapRecommendation(updatedRec.rows[0]),
        incident: mapIncident(updatedIncident.rows[0]),
        auditEvent: mapAudit(auditResult.rows[0]),
        memoryEventIds,
      };
    });
  }

  async listDecisions(
    incidentId: string,
  ): Promise<(ActionDecision & { proposedAction: string })[]> {
    const result = await this.db.query<Row>(
      `SELECT d.*, r.proposed_action
       FROM action_decisions d
       JOIN recommendations r ON r.id = d.recommendation_id
       WHERE d.incident_id = $1
       ORDER BY d.created_at ASC`,
      [incidentId],
    );
    return result.rows.map((row) => ({
      ...mapDecision(row),
      proposedAction: row.proposed_action,
    }));
  }

  // -------------------------------------------------------------------------
  // Contradictions
  // -------------------------------------------------------------------------

  async recordContradictions(items: NewContradiction[]): Promise<Contradiction[]> {
    if (items.length === 0) return [];
    const created: Contradiction[] = [];
    for (const item of items) {
      const result = await this.db.query<Row>(
        `INSERT INTO contradictions (incident_id, statement_a, statement_b, explanation, resolution_status)
         VALUES ($1, $2, $3, $4, 'open')
         RETURNING *`,
        [item.incidentId, item.statementA, item.statementB, item.explanation],
      );
      const row = result.rows[0];
      created.push({
        id: row.id,
        incidentId: row.incident_id,
        statementA: row.statement_a,
        statementB: row.statement_b,
        explanation: row.explanation,
        resolutionStatus: row.resolution_status,
        createdAt: iso(row.created_at),
      });
    }
    return created;
  }

  async listContradictions(incidentId: string): Promise<Contradiction[]> {
    const result = await this.db.query<Row>(
      'SELECT * FROM contradictions WHERE incident_id = $1 ORDER BY created_at DESC',
      [incidentId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      statementA: row.statement_a,
      statementB: row.statement_b,
      explanation: row.explanation,
      resolutionStatus: row.resolution_status,
      createdAt: iso(row.created_at),
    }));
  }

  // -------------------------------------------------------------------------
  // Handoffs
  // -------------------------------------------------------------------------

  async createHandoff(input: NewHandoff): Promise<IncidentHandoff> {
    return withTransaction(async (tx) => {
      const agents = await tx.query<Row>('SELECT * FROM agents WHERE id = ANY($1::UUID[])', [
        [input.fromAgentId, input.toAgentId],
      ]);
      const from = agents.rows.find((row) => row.id === input.fromAgentId);
      const to = agents.rows.find((row) => row.id === input.toAgentId);
      if (!from || !to) throw new NotFoundError('Handoff agent not found');

      const inserted = await tx.query<Row>(
        `INSERT INTO incident_handoffs (incident_id, from_agent_id, to_agent_id, summary, supporting_memory_ids)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.incidentId,
          input.fromAgentId,
          input.toAgentId,
          JSON.stringify(input.summary),
          JSON.stringify(input.supportingMemoryIds),
        ],
      );

      await tx.query(
        `UPDATE incidents SET assigned_agent_id = $2, updated_at = now() WHERE id = $1`,
        [input.incidentId, input.toAgentId],
      );
      await tx.query(`UPDATE agents SET status = 'standby', last_seen_at = now() WHERE id = $1`, [
        input.fromAgentId,
      ]);
      await tx.query(`UPDATE agents SET status = 'active', last_seen_at = now() WHERE id = $1`, [
        input.toAgentId,
      ]);

      await tx.query(
        `INSERT INTO memory_events (incident_id, event_type, actor_type, actor_name, content, metadata)
         VALUES ($1, 'handoff', 'ai', 'Sentinel', $2, $3)`,
        [
          input.incidentId,
          `Incident handed off from ${from.name} to ${to.name}. Continuity briefing generated from durable memory.`,
          JSON.stringify({ handoffId: inserted.rows[0].id, provider: input.provider }),
        ],
      );

      await tx.query(
        `INSERT INTO audit_events (incident_id, entity_type, entity_id, action, actor, before_state, after_state)
         VALUES ($1, 'handoff', $2, 'created', $3, $4, $5)`,
        [
          input.incidentId,
          inserted.rows[0].id,
          input.provider,
          JSON.stringify({ assignedAgent: from.name }),
          JSON.stringify({ assignedAgent: to.name }),
        ],
      );

      const row = inserted.rows[0];
      return {
        id: row.id,
        incidentId: row.incident_id,
        fromAgentId: row.from_agent_id,
        toAgentId: row.to_agent_id,
        fromAgentName: from.name,
        toAgentName: to.name,
        summary: jsonObject(row.summary) as unknown as HandoffSummary,
        supportingMemoryIds: jsonArray(row.supporting_memory_ids),
        createdAt: iso(row.created_at),
      };
    });
  }

  async listHandoffs(incidentId: string): Promise<IncidentHandoff[]> {
    const result = await this.db.query<Row>(
      `SELECT h.*, af.name AS from_name, at.name AS to_name
       FROM incident_handoffs h
       LEFT JOIN agents af ON af.id = h.from_agent_id
       LEFT JOIN agents at ON at.id = h.to_agent_id
       WHERE h.incident_id = $1
       ORDER BY h.created_at DESC
       LIMIT 20`,
      [incidentId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      fromAgentName: row.from_name ?? undefined,
      toAgentName: row.to_name ?? undefined,
      summary: jsonObject(row.summary) as unknown as HandoffSummary,
      supportingMemoryIds: jsonArray(row.supporting_memory_ids),
      createdAt: iso(row.created_at),
    }));
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async listAuditEvents(incidentId: string, limit = 200): Promise<AuditEvent[]> {
    const result = await this.db.query<Row>(
      'SELECT * FROM audit_events WHERE incident_id = $1 ORDER BY created_at ASC LIMIT $2',
      [incidentId, limit],
    );
    return result.rows.map(mapAudit);
  }
}

function labelDecision(decision: DecisionRequest['decision']): string {
  if (decision === 'approved') return 'Approved recommended action';
  if (decision === 'rejected') return 'Rejected recommended action';
  return 'Requested an alternative to';
}
