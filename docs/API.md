# API reference

All routes run on the Node runtime, are `force-dynamic`, and accept/return JSON.
Every request body is validated with Zod; every mutating route is rate limited
per client IP.

**Error shape**

```jsonc
{ "error": "human-readable message", "details": [{ "path": "content", "message": "…" }] }
```

`details` is present only for 400 validation failures. Internal errors are logged
server-side and replaced with a generic message — SQL text, DSNs and stack traces
are never returned.

| Status | Meaning |
| --- | --- |
| 400 | Validation failed, or a required query parameter is missing |
| 404 | Referenced incident / recommendation / agent does not exist |
| 409 | The recommendation has already been decided |
| 429 | Rate limit exceeded (`Retry-After` header present) |
| 502 | The model returned a response that failed safety validation; nothing recorded |
| 500 | Unhandled error; the incident record was not modified |

---

## `GET /api/health`

Application, database and Bedrock status. Safe to expose — returns booleans,
non-secret identifiers and error messages only. Asserted by `tests/health.test.ts`.

```jsonc
{
  "status": "ok",                       // "degraded" when any notice is present
  "timestamp": "2026-08-17T22:38:26.476Z",
  "mode": {
    "store": "cockroachdb",             // or "in-memory-demo"
    "reasoning": "bedrock",             // or "local-heuristic"
    "embeddings": "bedrock",            // or "local-deterministic"
    "demoMode": true
  },
  "database": {
    "configured": true,
    "reachable": true,
    "latencyMs": 34,
    "version": "CockroachDB CCL v25.3.0",
    "vectorIndexPresent": true,
    "memoryCount": 18,
    "error": null
  },
  "bedrock": {
    "configured": true,
    "region": "us-east-1",
    "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "embeddingModelId": "amazon.titan-embed-text-v2:0",
    "activeEmbeddingProvider": "amazon.titan-embed-text-v2:0",
    "embeddingDimensions": 1024
  },
  "notices": []
}
```

`config.database.host` contains **host and port only** — never the user,
password or full DSN. A malformed DSN reports `"configured"` rather than being
echoed back.

---

## `GET /api/incidents`

Lists incidents, active first, then newest.

```jsonc
{ "incidents": [{ "id": "…", "incidentCode": "INC-2026-0817", "title": "…", "severity": "critical", "status": "active", "currentPhase": "containment", … }] }
```

## `POST /api/incidents`

Opens an incident and writes the first durable memory event plus an audit record,
transactionally. Rate limit: 10/min.

```jsonc
{
  "title": "Smoke detected near Machine 7",     // required, ≤200
  "description": "Thermal alarm on the drive…", // required, ≤2000
  "location": "Assembly Plant · Zone 4",        // required, ≤160
  "severity": "critical",                       // default "high"
  "currentPhase": "detection",                  // default "detection"
  "reportedBy": "A. Reyes (Shift Lead)"         // optional
}
```

→ `201 { "incident": { … } }`

The incident code is allocated inside the transaction so concurrent reports
cannot collide on the unique constraint.

## `GET /api/incidents/:id`

The full incident view reconstructed from durable memory.

```jsonc
{
  "incident": { … },
  "events": [ … ],            // memory_events, chronological
  "recommendations": [ … ],
  "decisions": [ … ],         // with the proposed action joined in
  "contradictions": [ … ],
  "handoffs": [ … ],
  "audit": [ … ],
  "safetyRules": [ … ],
  "agents": [ … ],
  "pendingRecommendation": { … } | null
}
```

---

## `POST /api/observations`

Records an observation and, unless `analyze` is false, runs the full memory
cycle: embed → retrieve → ground Bedrock → validate → persist. Rate limit:
30/min. `maxDuration` 60s.

```jsonc
{
  "incidentId": "uuid",            // required
  "content": "Pressure rising…",   // required, ≤2000
  "actorType": "human",            // human | system | ai, default "human"
  "actorName": "A. Reyes",         // default "Responder"
  "analyze": true                  // default true
}
```

→ `201`

```jsonc
{
  "event": { "id": "…", "eventType": "observation", … },
  "analysis": {
    "incident": { … },
    "recommendation": { … },
    "retrieval": { … },        // see below
    "contradictions": [ … ],
    "reasoning": { "provider": "bedrock", "providerLabel": "…", "latencyMs": 812 },
    "safetyRules": [ … ]
  },
  "mode": { … }
}
```

`analysis` is `null` when `analyze: false`.

---

## `POST /api/recommendations`

Submits an action the responder is **considering**. Returns a grounded
recommendation, which may be a warning against the proposed action itself.
Nothing is actuated. Rate limit: 30/min. `maxDuration` 60s.

```jsonc
{
  "incidentId": "uuid",
  "proposedAction": "Shut down and restart Machine 7 immediately.",
  "requestedBy": "A. Reyes"
}
```

→ `201 { "analysis": { … }, "mode": { … } }` — same `analysis` shape as above.

Creating a new recommendation marks any earlier pending one for that incident as
`superseded`, in the same transaction.

## `GET /api/recommendations?incidentId=…`

→ `{ "recommendations": [ … ] }`, newest first.

---

## `POST /api/recommendations/:id/decision`

**The safety-critical write path.** One CockroachDB transaction:

1. `INSERT INTO action_decisions` — the approval/rejection record
2. `UPDATE recommendations SET status` — the recommendation status
3. `UPDATE incidents SET status, current_phase` — the incident's current state
4. `INSERT INTO audit_events` — immutable audit with before/after state
5. `INSERT INTO memory_events` — durable timeline entries

If any statement fails, none commit. Rate limit: 30/min.

```jsonc
{
  "decision": "approved",           // approved | rejected | alternative_requested
  "decidedBy": "A. Reyes (Shift Lead)",
  "reason": "Gauge confirmed at zero."   // optional, ≤2000, stored on the audit trail
}
```

→ `200`

```jsonc
{
  "decision": { "id": "…", "decision": "approved", "decidedBy": "…", … },
  "recommendation": { "status": "approved", "decidedAt": "…", … },
  "incident": { "currentPhase": "stabilization", … },
  "auditEvent": {
    "action": "decision:approved",
    "beforeState": { "status": "active", "phase": "containment", "recommendationStatus": "pending" },
    "afterState":  { "status": "active", "phase": "stabilization", "recommendationStatus": "approved" }
  },
  "memoryEventIds": ["…", "…"],
  "transaction": { "atomic": true, "writes": [ … ], "store": "cockroachdb" }
}
```

On approval the incident advances one phase toward review. Rejection does not
advance the phase. Deciding an already-decided recommendation → **409**, with no
state change.

> Approving records a **human authorization**. Sentinel has no machinery control
> path and does not perform physical actions.

---

## `POST /api/memory/search`

Semantic search over durable memory via the CockroachDB vector index. Rate limit:
60/min.

```jsonc
{
  "query": "What happened when Machine 7 was restarted before pressure isolation?",
  "limit": 3,                        // 1–10, default 3
  "filters": {                       // all optional
    "severity": "critical",
    "memoryType": "lesson_learned",
    "location": "Zone 4",
    "from": "2025-01-01",
    "to": "2025-12-31",
    "outcomeContains": "damage"
  }
}
```

→ `200`

```jsonc
{
  "retrieval": {
    "memories": [{
      "id": "uuid",
      "incidentCode": "INC-2025-0412",
      "incidentTitle": "Pressure transfer after premature Machine 7 restart",
      "incidentDate": "2025-04-12T09:14:00.000Z",
      "memoryType": "lesson_learned",
      "sourceText": "…",
      "actionTaken": "Machine 7 was restarted before pressure isolation.",
      "outcome": "Secondary equipment damage near Machine 8…",
      "lessonLearned": "Isolate and verify the shared pressure line…",
      "severity": "critical",
      "similarity": 0.94,
      "distance": 0.06
    }],
    "latencyMs": 41,
    "memoriesSearched": 18,
    "vectorIndexUsed": true,
    "embeddingProvider": "bedrock",
    "embeddingDimensions": 1024,
    "query": "…"
  },
  "totalMemories": 18,
  "mode": { … },
  "source": "CockroachDB distributed vector index"
}
```

`similarity` is `1 - distance`, where `distance` is CockroachDB's `<=>` cosine
distance. Results are diversified: at most 2 memories per source incident here,
1 on the Command Center.

---

## `GET /api/timeline?incidentId=…`

```jsonc
{ "incident": { … }, "events": [ … ], "audit": [ … ], "source": "cockroachdb", "note": "…" }
```

---

## `GET /api/handoffs?incidentId=…`

→ `{ "handoffs": [ … ], "agents": [ … ] }`

## `POST /api/handoffs`

Reconstructs incident state from durable memory, generates a structured
continuity briefing, stores it, reassigns the incident and updates both agents'
status — transactionally. Rate limit: 10/min. `maxDuration` 60s.

```jsonc
{ "incidentId": "uuid", "fromAgentId": "uuid", "toAgentId": "uuid" }
```

→ `201`

```jsonc
{
  "handoff": { "id": "…", "summary": { … }, "supportingMemoryIds": [ … ], … },
  "summary": {
    "whatHappened": "…",
    "whatWasAttempted": [ "…" ],
    "whatMustNotBeRepeated": [ "…" ],
    "currentRisks": [ "…" ],
    "unresolvedQuestions": [ "…" ],
    "recommendedNextAction": "…"
  },
  "retrieval": { … },
  "reasoning": { "provider": "bedrock", … },
  "mode": { … }
}
```

Handing off to the same agent → **400**.

---

## `GET /api/agents`

→ `{ "agents": [{ "id": "…", "name": "Sentinel Primary", "status": "active", … }] }`

## `PATCH /api/agents`

Sets an agent's status. This is what "Simulate Primary Agent Disconnect" calls.
It changes the status field and **nothing else** — no incident, memory event,
recommendation or audit record is deleted or altered. Rate limit: 30/min.

```jsonc
{ "agentId": "uuid", "status": "disconnected" }   // active | ready | standby | disconnected
```

→ `200 { "agent": { … }, "dataPreserved": true }`

---

## `GET /api/seed`

Reports whether the seed corpus is present, and the demo constants the UI uses.

```jsonc
{
  "mode": { … },
  "store": "cockroachdb",
  "seeded": true,
  "counts": { "incidents": 9, "memories": 18, "expectedHistoricalIncidents": 8, "expectedMemories": 18 },
  "activeIncident": { "id": "…", "incidentCode": "INC-2026-0817" },
  "demo": { "quickObservations": [ … ], "proposedAction": "…", "memoryQuery": "…" },
  "howToSeed": "Run `npm run db:migrate && npm run db:seed` with DATABASE_URL set."
}
```

**Read-only by design.** Seeding writes to the system of record, so it is a
deliberate operator action run with database credentials (`npm run db:seed`) —
not something an unauthenticated HTTP caller can trigger against a live incident
database.
