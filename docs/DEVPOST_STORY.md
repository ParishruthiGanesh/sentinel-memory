## Inspiration

Industrial incident reviews keep producing the same finding, written slightly differently each time: *the responder took a reasonable action in the wrong order, because nobody present remembered what happened the last time someone did that.*

The information usually existed. It was in a report, filed after the last incident, that nobody was reading at 3am with an alarm going off. The failure isn't that the organization didn't know — it's that the knowledge wasn't available at the exact moment a decision was being made.

AI agents have the identical failure mode, and reproduce it faster. An agent whose memory is a context window forgets on restart, forgets on handoff, forgets when the conversation gets long. Give that agent an emergency and it will confidently recommend the thing that caused the damage last time.

So we asked a narrower question than "how do we give agents memory?": **what specifically does an incident agent need to remember?** The answer wasn't conversations. It was consequences — what a given action, taken in a given situation, actually caused.

> Normal agents remember conversations. Sentinel remembers consequences.

## What it does

Sentinel Memory is an incident-response command center where a database, not a context window, is the memory.

The demonstration runs end to end:

1. A new incident reports smoke near Machine 7.
2. The responder considers shutting down and restarting Machine 7 — the obvious move.
3. Sentinel embeds that proposal and searches CockroachDB's distributed vector index.
4. It retrieves `INC-2025-0412`: the same action, taken before the shared pressure line was isolated, transferred pressure to Machine 8, destroyed a secondary valve, and added eleven hours to the shutdown.
5. Sentinel surfaces that consequence in a prominent **"What happened last time?"** card and recommends the safer sequence — isolate and verify the shared pressure line first — citing the memory it drew that from.
6. The responder approves. The approval record, recommendation status, incident state and audit event commit in **one transaction**.
7. The primary agent disconnects.
8. The backup agent reconstructs the entire incident from CockroachDB — what happened, what was attempted, what must not be repeated, what's still open — and is useful immediately.

Nothing in step 8 comes from a transcript. It all comes out of the database.

![Command Center — the counterfactual memory card beside the recommended action](https://raw.githubusercontent.com/ParishruthiGanesh/sentinel-memory/main/docs/screenshots/command-center.png)

Five routes: Command Center, Memory Explorer, Incident Timeline, Agent Handoff, Architecture.

**Two kinds of memory, one database.** Episodic memory (`memory_events`) is an append-only log of every observation, retrieval, recommendation, decision, state change and handoff — it makes an incident *reconstructable*. Semantic memory (`memory_embeddings`) stores distilled `action_taken → outcome → lesson_learned` triples as vectors — it makes an incident *comparable*. An agent needs both, and it needs them in the same database.

## How we built it

**Stack.** Next.js 16 (App Router) with React 19 and TypeScript, Tailwind CSS, Zod, the `pg` driver, and the AWS SDK for JavaScript. CockroachDB Cloud for storage, Amazon Bedrock for reasoning, Vitest for tests. No ORM, no separate vector database, no queue, no cache layer — a small surface with a real spine.

**The architectural decision that mattered** was making three things interfaces rather than integrations: `DataStore`, `EmbeddingProvider` and `Reasoner`. Each has a real implementation and a clearly labelled local fallback. That bought three things at once — the interface is previewable without any credentials, the transaction logic is unit-testable without a live cluster, and swapping an embedding provider requires no architectural change.

The corollary we committed to: **the UI always names which implementation actually ran** — top bar, safety banner, sidebar, `/api/health` and every API response. Nothing in this project claims to be an integration it isn't.

**The agent loop** lives in one file (`src/lib/agent/orchestrator.ts`): embed → retrieve from CockroachDB → ground Bedrock on what came back → validate the structured response with Zod → persist the recommendation with its cited memory IDs. Every step writes durable memory events, including the retrieval itself, so the timeline shows that memory was *consulted*, not just that an answer appeared.

**The safety model assumes the model will not comply.** The prompt states the rules; `enforceSafetyFloor` then runs on every response, forces `requiresHumanApproval` on any high-risk physical action regardless of what came back, and filters citations down to memory IDs that were genuinely retrieved, so a hallucinated reference can't reach a responder.

### CockroachDB tools used

**CockroachDB Cloud** is the system of record — live incident state, immutable memory events, vector memory, recommendations, human decisions, contradictions, agent handoffs and the audit trail. Ten tables, standard `pg` driver, parameterized SQL throughout, no ORM.

**Distributed Vector Indexing.** `memory_embeddings.embedding` is a `VECTOR(n)` column with `CREATE VECTOR INDEX … (embedding vector_cosine_ops)`. Retrieval orders by `<=>` cosine distance and joins straight to the source incident, so one query returns the memory *and* its provenance — incident code, severity, date. That join is why we didn't need a separate vector database: retrieval that returns a vector without its incident context isn't actionable during an emergency. The index is version-gated (v25.2 preview behind a cluster setting, GA in v25.3+), so it lives in its own migration; if it can't be created the app still works via exact scan, `/api/health` reports `vectorIndexPresent: false`, and the UI shows "Exact scan" instead of "Vector index".

**Transactions.** The approval path is a single transaction — insert the decision, update the recommendation, update the incident, insert the audit event, append memory events — with `SELECT … FOR UPDATE` on the recommendation and incident rows so two responders can't both decide the same action. Under SERIALIZABLE isolation, retry is the application's job: `withTransaction` retries SQLSTATE `40001` with exponential backoff and full jitter, re-executing the whole unit of work.

**CockroachDB Cloud Managed MCP Server** (`https://cockroachlabs.cloud/mcp`) is the operator inspection path, deliberately separate from the runtime path: the app connects with write credentials, an operator inspects with a read-only service account. We used it to validate the schema after each migration, confirm whether the vector index actually got created on the running cluster version, spot-check that seeded memories carry a non-null action/outcome/lesson, and verify after an approval that one decision produced exactly one decision row, one audit row and the matching state changes. Config examples for Claude Code and VS Code/Cursor are in `mcp/`; no token is committed.

**CockroachDB Agent Skills** (`cockroachlabs/cockroachdb-skills`) shaped concrete decisions, documented skill-by-skill in the README: UUID keys over sequential integers to avoid hotspotting, index ordering matched to real access patterns, application-owned retry for serializable conflicts, a bounded pool sized for serverless, and separating write credentials from read-only inspection credentials.

### AWS services used

**Amazon Bedrock** — incident analysis, risk summaries, recommended next actions, handoff briefings, contradiction detection, and explanations of why a retrieved memory is relevant. All calls go through the **Converse API**, which gives one request shape across model families and is what lets `BEDROCK_MODEL_ID` stay a plain configuration value — there is no hardcoded model ID in the codebase. Credentials come from explicit environment variables when present, otherwise the default AWS provider chain, so an IAM role works without code changes. Bedrock embeddings (Titan or Cohere, via `BEDROCK_EMBEDDING_MODEL_ID`) produce the vectors stored in CockroachDB; both request/response shapes are handled. Output is a strict JSON contract validated with Zod — a response that fails validation is rejected (HTTP 502, no recommendation recorded) rather than shown to a responder.

## Challenges we ran into

**Making memory *visible*.** Our first version worked and demoed badly: retrieval happened, the answer was good, and you had to take our word that a database did anything. We rebuilt the UI around the retrieval instead of around the answer — similarity scores, cosine distances, query latency, memories searched, and whether the index or an exact scan served it. The counterfactual card renders server-side on page load, so the thesis is legible in about five seconds without clicking anything.

**Retrieval that returns one story instead of three.** Vector search over a corpus where one past incident contributes four memories returns four angles on that incident and crowds out every other precedent. We over-fetch and then cap per source incident in application code — one per incident on the Command Center, two in the Memory Explorer where depth matters more than breadth. A small, unit-tested function that changed the demo completely.

**Not letting the fallback lie.** The local embedder ranks the seeded corpus correctly, but its absolute cosine scores land around 0.4–0.65 where a learned model would give 0.85–0.95, simply because bag-of-words similarity between a short query and a long document is bounded. The tempting fix was to rescale the number so it looked impressive. We kept the raw cosine and added a line next to the scores explaining what the fallback measures and that ranking, not absolute value, is the signal. A judge who checks will find the number is real.

**Trusting the model exactly as far as it should be trusted.** Prompts asking for `requiresHumanApproval: true` on dangerous actions mostly work — mostly isn't good enough when the failure mode is an unauthorized shutdown. The post-model safety floor was the fix, and writing it forced us to be precise about which verbs constitute a high-risk physical action.

**Version-gated vector indexes.** Support differs between v25.2 (preview, behind a cluster setting) and v25.3+ (GA). Rather than pinning a version, we isolated the index migration, attempt the setting, degrade to exact scan with a clear warning, and report the actual state in the health check and the UI.

## Accomplishments that we're proud of

- **The counterfactual moment works.** Type a reasonable action and the system tells you what that exact action cost someone last time — incident code, date, damage. It's the whole pitch in one screen.
- **The approval really is atomic.** Four writes, one transaction, `FOR UPDATE` locking, `40001` retry, and tests proving a rollback leaves the store unchanged.
- **94 tests, no live cluster or AWS account required.** The store abstraction earned its keep.
- **The disconnect demo is not theatre.** Nothing is deleted. The backup agent rebuilds from the database, and "what must not be repeated" contains real rejected actions and real recorded consequences — not invented prohibitions.

![Backup agent briefed entirely from durable memory](https://raw.githubusercontent.com/ParishruthiGanesh/sentinel-memory/main/docs/screenshots/handoff-after.png)

- **It's honest about itself.** Every fallback is labelled in the UI, the health endpoint and the API responses, and the README lists what's missing instead of hiding it.

## What we learned

**Agent memory is two problems, not one.** Episodic and semantic memory have different shapes, different query patterns and different consumers. Conflating them produces a system that can either replay a timeline or find similar text, but can't answer "someone is about to do X — has X hurt us before?"

**Keeping both in one database is the actual advantage.** Not "one less service to run" — the join. Retrieval returns the memory *and* its incident code, severity and date in a single query, and the human decision that follows is transactional against the same rows. A separate vector store would have meant two round trips, a sync problem, and a consistency boundary in the middle of a safety-critical path.

**Structure the memory around the action.** Storing incident summaries and embedding them gets you "similar incidents". Storing `action_taken → outcome → lesson_learned` as distinct fields gets you "this specific action caused this specific damage" — which is what a responder standing in front of Machine 7 actually needs.

**Constraints beat prompts for safety.** The prompt is necessary and not sufficient. Schema CHECK constraints, Zod validation and the post-model safety floor are what make the guarantee real.

**Honest degradation is a feature.** We expected fallback labelling to be a compliance chore. It turned out to be the thing that makes the architecture legible: anyone can see exactly which parts are real, which is far more convincing than a demo that claims everything works.

## What's next for Sentinel Memory

1. **Close the learning loop.** Sentinel learns from historical incidents but not yet from its own recommendations. Capturing whether an approved action produced the predicted outcome — and writing *that* back as a new memory — is the step that would compound.
2. **Authentication and RBAC.** There's none today; the audit trail's `decided_by` is only as trustworthy as the identity behind it.
3. **Database-enforced immutability.** Revoke UPDATE/DELETE on `memory_events` and `audit_events`, and stream them to an append-only sink via changefeeds.
4. **Real ingestion.** SCADA/historian feeds for observations instead of manual entry, plus paging integration for escalation.
5. **Retrieval evaluation.** A labelled set with precision@k tracking, and regression tests on the structured-output contract across model families.
6. **Multi-region.** Regional-by-row for data residency, with Bedrock invoked in-region.

---

**Scope note:** Sentinel Memory is decision support, not a control system. It has no machinery control path — it cannot start, stop, isolate, vent or energize anything. Approving a recommendation records that an authorized human decided to carry it out; a person performs the action.
