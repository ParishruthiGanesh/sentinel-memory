# Devpost "Additional info" answers — Sentinel Memory

Fields marked **[YOU]** need information only the submitter has.

---

## URL to your functional demo application

**[YOU]** — the Vercel production URL. Not deployed at the time of writing.

### Testing credentials / instructions

> No credentials, login or API keys are required. The app opens directly onto the
> Command Center with a live incident (INC-2026-0118, smoke near Machine 7) and a
> seeded corpus of eight historical incidents already in CockroachDB.
>
> Two-minute judging path:
>
> 1. **Command Center** — the "What happened last time?" card is already rendered
>    on page load. It shows INC-2025-0412: the same restart action, taken before
>    the shared pressure line was isolated, with the damage it caused and the
>    similarity score that retrieved it. Click **Approve** on the recommended
>    action; the decision, recommendation status, incident state and audit event
>    commit in one CockroachDB transaction.
> 2. **Memory Explorer** — type any action, e.g. "restart machine 7 to clear the
>    smoke". Similarity scores, cosine distances, query latency, memories searched
>    and whether the vector index or an exact scan served the query are all shown.
> 3. **Agent Handoff** — click **Simulate disconnect**, then **Transfer to backup
>    agent**. The backup agent's briefing is reconstructed entirely from
>    `memory_events` in the database; nothing is carried over in process memory.
> 4. **Architecture** — live integration status for CockroachDB and Bedrock.
> 5. **`/api/health`** — reports database connectivity, latency,
>    `vectorIndexPresent`, memory counts, and which embedding/reasoning
>    implementation is actually running. Secrets are never included (asserted by
>    `tests/health.test.ts`).
>
> To run locally instead: `npm install && npm run dev`. It starts with no
> credentials at all, on an in-memory store and local rule-based reasoning, both
> clearly labelled in the UI. Set `DATABASE_URL`, then `npm run db:migrate &&
> npm run db:seed`, and set `AWS_REGION` + `BEDROCK_MODEL_ID` to use the real
> CockroachDB Cloud and Bedrock paths.

---

## URL to your open source and public code repository

    https://github.com/ParishruthiGanesh/sentinel-memory

## URL to your open-source license file

    https://github.com/ParishruthiGanesh/sentinel-memory/blob/main/LICENSE

MIT. Detected by GitHub and shown in the repository's About section.

---

## Which CockroachDB tools are used? (need ≥2 — we use 3)

- [x] **Cloud Managed MCP Server**
- [x] **Distributed Vector Indexing**
- [ ] ccloud CLI — *not used*
- [x] **Agent Skills Repo**

## Which AWS Services are used? (need ≥1)

- [x] **Amazon Bedrock**

---

## How the selected components were meaningfully integrated

> **Distributed Vector Indexing** is the retrieval path the product is built on.
> `memory_embeddings.embedding` is a `VECTOR(n)` column — n templated from
> `EMBEDDING_DIMENSIONS` at migration time so it always matches the configured
> model — indexed with `CREATE VECTOR INDEX … (embedding vector_cosine_ops)`.
> When a responder proposes an action, we embed the proposal and order by `<=>`
> cosine distance, joining straight to the incident that produced each memory, so
> one query returns the memory *and* its provenance: incident code, severity,
> date. That join is why no separate vector database was needed — retrieval that
> returns a vector without its incident context is not actionable during an
> emergency. Results are then diversified in application code so four memories
> from one past incident cannot crowd out three distinct precedents. The index is
> version-gated (v25.2 preview behind a cluster setting, GA in v25.3+), so it
> lives in its own migration; if it cannot be created the app degrades to an exact
> scan and `/api/health` and the UI both report "Exact scan" rather than
> overstating it.
>
> CockroachDB is also the system of record for everything else: ten tables holding
> live incident state, append-only episodic memory, recommendations with their
> cited memory IDs, human decisions, safety rules, contradictions, handoffs and
> the audit trail — standard `pg` driver, parameterized SQL, no ORM. The approval
> path is a single transaction (decision + recommendation status + incident state
> + audit event + memory events) with `SELECT … FOR UPDATE` on the recommendation
> and incident rows, and application-owned retry of SQLSTATE `40001` with
> exponential backoff and full jitter, because CockroachDB runs SERIALIZABLE and
> safety-critical writes are exactly the ones that contend.
>
> **The Cloud Managed MCP Server** (`https://cockroachlabs.cloud/mcp`) is the
> operator inspection path, deliberately separate from the runtime path: the
> application connects with write credentials, an operator inspects the same
> cluster through MCP with a read-only service account. We used it to validate the
> schema after each migration (all ten tables, the `VECTOR(n)` width, foreign keys
> and CHECK constraints), to confirm via `SHOW INDEXES FROM memory_embeddings`
> whether the vector index actually got created on the running cluster version,
> to spot-check that every seeded memory carries a non-null `action_taken`,
> `outcome` and `lesson_learned` — a memory without a recorded consequence is
> useless to this product — and to verify after an approval that one decision
> produced exactly one `action_decisions` row, one `audit_events` row and the
> matching state changes, i.e. that the atomicity claim holds in practice. The
> exact queries are in `docs/MCP.md`; client configs are in `mcp/`; no token is
> committed.
>
> **The Agent Skills Repo** (`cockroachlabs/cockroachdb-skills`) shaped concrete
> decisions, documented skill-by-skill in the README: UUID primary keys with
> `gen_random_uuid()` instead of sequential integers to avoid hotspotting on a
> distributed cluster; composite indexes ordered to match real access patterns
> (`memory_events (incident_id, created_at ASC)` for the timeline,
> `recommendations (incident_id, status, created_at DESC)` for the pending
> recommendation); application-owned retry for serializable conflicts; a bounded
> connection pool sized for serverless; and the separation of the app's write
> credentials from the read-only MCP inspection account.
>
> **Amazon Bedrock** does the reasoning: incident analysis, risk assessment,
> recommended next actions, handoff briefings, contradiction detection, and
> explanations of why a retrieved memory is relevant. Every call goes through the
> **Converse API**, which gives one request shape across model families and lets
> `BEDROCK_MODEL_ID` stay a plain configuration value — there is no hardcoded
> model ID anywhere in the codebase. Bedrock embeddings
> (`BEDROCK_EMBEDDING_MODEL_ID`; Titan and Cohere response shapes both handled)
> produce the vectors stored in CockroachDB, so the AWS and CockroachDB halves are
> the same pipeline rather than two features. The model is grounded strictly on
> the incident record and the retrieved memories, must return a JSON contract
> validated with Zod — a response that fails validation is rejected with HTTP 502
> and no recommendation is recorded — and a post-model safety floor then forces
> human approval on any high-risk physical action regardless of what the model
> returned, and filters citations down to memory IDs that were genuinely
> retrieved, so a hallucinated reference cannot reach a responder.

---

## What date did you start this project? (MM-DD-YY)

    08-17-26

First commit in the public repository is 2026-08-17.

---

## Pre-existing code or work incorporated into the Project

> None. The repository was created on 2026-08-17 during the submission period and
> every commit in its history was made for this hackathon; the full history is
> public.
>
> Standard development tools used, as permitted: Next.js 16, React 19, TypeScript,
> Tailwind CSS, Zod, the `pg` PostgreSQL driver, the AWS SDK for JavaScript
> (`@aws-sdk/client-bedrock-runtime`), lucide-react icons, and Vitest — all
> installed from npm as ordinary dependencies. No starter template or scaffold
> beyond the standard Next.js App Router project structure. Claude Code was used
> as an AI coding assistant throughout.
>
> All application code, the database schema and migrations, the agent
> orchestration, the retrieval and diversification logic, the transaction and
> retry layer, the safety floor, the UI, the tests and the documentation were
> written for this submission. The eight historical incidents and sixteen memories
> in the seed corpus (`src/lib/seed-data.ts`) are synthetic, written for this
> project — realistic in shape, but not real incident reports, and the README says
> so.

---

## Optional: feedback on the CockroachDB AI tools or features

> **Distributed vector indexing.** Having `VECTOR` and the relational data in one
> database was the deciding factor in the architecture: a single query returns the
> matched memory *and* the incident that produced it, and the human decision that
> follows is transactional against those same rows. With a separate vector store
> that would have been two round trips, a sync problem, and a consistency boundary
> in the middle of a safety-critical path.
>
> The main friction was version gating. Vector index support differs between v25.2
> (preview, behind `SET CLUSTER SETTING feature.vector_index.enabled = true`) and
> v25.3+ (GA), and the failure mode when a cluster does not support it is a
> migration error rather than a clear capability signal. We worked around it by
> isolating the index into its own migration, attempting the cluster setting,
> degrading to an exact scan with a printed warning, and reporting the real state
> in `/api/health`. A documented capability query — something equivalent to "does
> this cluster support vector indexes?" — would have saved that work.
>
> **Managed MCP Server.** The most useful thing about it was being able to inspect
> the cluster with a read-only service account while the application held separate
> write credentials, so verifying a migration never required handing out the app's
> DSN. It was the fastest way to answer "did the vector index actually get
> created?" and "did that one approval really produce exactly one decision row and
> one audit row?" during development. Setup was straightforward; the one thing we
> looked for and did not find was a documented way to scope a token to a single
> database within a cluster.
>
> **Agent Skills Repo.** The guidance that changed our code was the distributed-
> systems-specific material — UUID keys over sequential integers to avoid
> hotspotting, index ordering matched to access patterns, and especially that
> serializable retry is the application's responsibility rather than the driver's.
> That last point is the kind of thing that is easy to get wrong silently under
> load, and having it stated plainly up front meant the retry layer was written
> once, correctly, instead of being discovered later.

---

## Remaining fields

| Field | Answer |
| --- | --- |
| Submitter type | **Individual** (unless teammates are listed on Manage team) |
| Submitter country of residence | **[YOU]** |
| Organization name | Leave blank |
| AI tools leveraged | Claude Code (Anthropic) as the coding assistant; Amazon Bedrock via the Converse API inside the product itself; CockroachDB Agent Skills as design guidance |
| Level of learning derived | **Significant** |
| AI value usable in your career | **Yes** |
| Three eligibility checkboxes | Tick all three — they are your own attestations |
