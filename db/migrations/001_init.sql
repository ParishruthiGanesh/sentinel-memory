-- =============================================================================
-- Sentinel Memory — core schema
--
-- CockroachDB is the system of record for:
--   * live incident state          (incidents, agents)
--   * immutable episodic memory    (memory_events)
--   * semantic vector memory       (memory_embeddings)
--   * agent output & human control (recommendations, action_decisions)
--   * safety policy                (safety_rules)
--   * conflict tracking            (contradictions)
--   * continuity                   (incident_handoffs)
--   * the audit trail              (audit_events)
--
-- The `{{EMBEDDING_DIM}}` placeholder is substituted by scripts/migrate.ts with
-- EMBEDDING_DIMENSIONS so the stored vector width always matches the configured
-- embedding model (Titan Text Embeddings V2 = 1024, Cohere Embed v3 = 1024).
-- =============================================================================

CREATE TABLE IF NOT EXISTS agents (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         STRING      NOT NULL,
    role         STRING      NOT NULL,
    status       STRING      NOT NULL DEFAULT 'ready',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agents_status_check
        CHECK (status IN ('active', 'ready', 'standby', 'disconnected'))
);

CREATE TABLE IF NOT EXISTS incidents (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_code     STRING      NOT NULL UNIQUE,
    title             STRING      NOT NULL,
    description       STRING      NOT NULL,
    location          STRING      NOT NULL,
    severity          STRING      NOT NULL,
    status            STRING      NOT NULL DEFAULT 'active',
    current_phase     STRING      NOT NULL DEFAULT 'detection',
    assigned_agent_id UUID        NULL REFERENCES agents (id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT incidents_severity_check
        CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    CONSTRAINT incidents_status_check
        CHECK (status IN ('active', 'contained', 'resolved', 'closed')),
    CONSTRAINT incidents_phase_check
        CHECK (current_phase IN ('detection', 'assessment', 'containment',
                                 'stabilization', 'recovery', 'review'))
);

CREATE INDEX IF NOT EXISTS incidents_status_created_idx
    ON incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_location_idx ON incidents (location);

-- -----------------------------------------------------------------------------
-- Episodic memory: the append-only record of what happened, in order.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID        NULL REFERENCES incidents (id) ON DELETE CASCADE,
    event_type  STRING      NOT NULL,
    actor_type  STRING      NOT NULL,
    actor_name  STRING      NOT NULL,
    content     STRING      NOT NULL,
    metadata    JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    immutable   BOOL        NOT NULL DEFAULT true,
    CONSTRAINT memory_events_actor_type_check
        CHECK (actor_type IN ('human', 'system', 'ai')),
    CONSTRAINT memory_events_event_type_check
        CHECK (event_type IN ('incident_created', 'observation', 'memory_retrieved',
                              'risk_detected', 'recommendation', 'human_decision',
                              'state_change', 'handoff', 'contradiction', 'note'))
);

CREATE INDEX IF NOT EXISTS memory_events_incident_time_idx
    ON memory_events (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS memory_events_type_idx
    ON memory_events (event_type, created_at DESC);

-- -----------------------------------------------------------------------------
-- Semantic memory: consequences, lessons and procedures, vector-searchable.
--
-- `action_taken` is stored alongside `outcome` and `lesson_learned` because the
-- product's core question is "what did this ACTION cause?", not just "what
-- happened?".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_embeddings (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_event_id UUID                    NULL REFERENCES memory_events (id) ON DELETE SET NULL,
    incident_id     UUID                    NULL REFERENCES incidents (id) ON DELETE CASCADE,
    memory_type     STRING                  NOT NULL,
    source_text     STRING                  NOT NULL,
    embedding       VECTOR({{EMBEDDING_DIM}}) NOT NULL,
    action_taken    STRING                  NULL,
    outcome         STRING                  NULL,
    lesson_learned  STRING                  NULL,
    severity        STRING                  NULL,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    CONSTRAINT memory_embeddings_type_check
        CHECK (memory_type IN ('incident_summary', 'observation', 'action_taken',
                               'outcome', 'lesson_learned', 'safety_procedure')),
    CONSTRAINT memory_embeddings_severity_check
        CHECK (severity IS NULL OR severity IN ('critical', 'high', 'medium', 'low'))
);

CREATE INDEX IF NOT EXISTS memory_embeddings_incident_idx ON memory_embeddings (incident_id);
CREATE INDEX IF NOT EXISTS memory_embeddings_type_idx ON memory_embeddings (memory_type);
CREATE INDEX IF NOT EXISTS memory_embeddings_severity_idx ON memory_embeddings (severity);

-- -----------------------------------------------------------------------------
-- Agent output and human control.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendations (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             UUID        NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    proposed_action         STRING      NOT NULL,
    explanation             STRING      NOT NULL,
    confidence              DECIMAL(4, 3) NOT NULL DEFAULT 0.000,
    risk_level              STRING      NOT NULL,
    status                  STRING      NOT NULL DEFAULT 'pending',
    retrieved_memory_ids    JSONB       NOT NULL DEFAULT '[]'::JSONB,
    potential_consequences  JSONB       NOT NULL DEFAULT '[]'::JSONB,
    requires_human_approval BOOL        NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at              TIMESTAMPTZ NULL,
    CONSTRAINT recommendations_risk_check
        CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
    CONSTRAINT recommendations_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
    CONSTRAINT recommendations_confidence_check
        CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS recommendations_incident_status_idx
    ON recommendations (incident_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS action_decisions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID        NOT NULL REFERENCES recommendations (id) ON DELETE CASCADE,
    incident_id       UUID        NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    decision          STRING      NOT NULL,
    decided_by        STRING      NOT NULL,
    reason            STRING      NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT action_decisions_decision_check
        CHECK (decision IN ('approved', 'rejected', 'alternative_requested'))
);

CREATE INDEX IF NOT EXISTS action_decisions_incident_idx
    ON action_decisions (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS action_decisions_recommendation_idx
    ON action_decisions (recommendation_id);

-- -----------------------------------------------------------------------------
-- Safety policy, conflicts, continuity, audit.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safety_rules (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    STRING      NOT NULL,
    description             STRING      NOT NULL,
    action_pattern          STRING      NOT NULL,
    enforcement_level       STRING      NOT NULL DEFAULT 'warn',
    requires_human_approval BOOL        NOT NULL DEFAULT true,
    active                  BOOL        NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT safety_rules_enforcement_check
        CHECK (enforcement_level IN ('block', 'warn', 'advise'))
);

CREATE TABLE IF NOT EXISTS contradictions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       UUID        NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    statement_a       STRING      NOT NULL,
    statement_b       STRING      NOT NULL,
    explanation       STRING      NOT NULL,
    resolution_status STRING      NOT NULL DEFAULT 'open',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT contradictions_status_check
        CHECK (resolution_status IN ('open', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS contradictions_incident_idx
    ON contradictions (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_handoffs (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id           UUID        NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    from_agent_id         UUID        NOT NULL REFERENCES agents (id),
    to_agent_id           UUID        NOT NULL REFERENCES agents (id),
    summary               JSONB       NOT NULL,
    supporting_memory_ids JSONB       NOT NULL DEFAULT '[]'::JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_handoffs_incident_idx
    ON incident_handoffs (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id  UUID        NULL REFERENCES incidents (id) ON DELETE CASCADE,
    entity_type  STRING      NOT NULL,
    entity_id    UUID        NOT NULL,
    action       STRING      NOT NULL,
    actor        STRING      NOT NULL,
    before_state JSONB       NULL,
    after_state  JSONB       NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_incident_idx
    ON audit_events (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
    ON audit_events (entity_type, entity_id);
