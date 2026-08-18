# YouTube title & description

## Title (recommended)

```
Sentinel Memory — the incident agent that remembers consequences
```

63 characters, so it will not truncate in search or on the Devpost embed.

### Alternates

```
Normal agents remember conversations. Sentinel remembers consequences.
```
```
Sentinel Memory — CockroachDB vector memory + Amazon Bedrock demo
```
```
Sentinel Memory: incident response grounded in what past actions caused
```

Pick the first if you want the project name to land first; the second if you
want the hook to land first. Both work.

---

## Description

```
Normal agents remember conversations. Sentinel remembers consequences.

Sentinel Memory is an AI incident-response command center for industrial
safety, where the agent's memory is a database rather than a context window.

In this demo, a responder considers restarting Machine 7 to clear a fault —
the obvious move. Sentinel embeds that proposal, searches CockroachDB's
distributed vector index, and retrieves a 2025 incident where the same action,
taken before the shared pressure line was isolated, transferred pressure to
Machine 8 and cost eleven hours. It recommends the safer sequence instead,
citing the exact memories it used.

The responder approves. The decision, the recommendation status, the incident
state and the audit event commit in a single CockroachDB transaction. Then the
primary agent disconnects — and the backup agent reconstructs the entire
incident from the database: what happened, what was attempted, what must not be
repeated, and what to do next. None of it comes from a conversation transcript.

CockroachDB stores episodic memory (an append-only log of what happened in this
incident) and semantic memory (action → outcome → lesson, vector-searchable)
in one database — so a retrieved memory arrives with its incident code,
severity and date, and the human approval that follows is transactional against
the same rows. No separate vector database required.

── Built with ──
• CockroachDB Distributed Vector Indexing — cosine similarity over
  memory_embeddings, joined straight to the source incident
• CockroachDB Cloud Managed MCP Server — read-only operator inspection of
  schema, indexes and the audit trail
• CockroachDB Agent Skills — schema design, serializable retry, and credential
  separation decisions
• Amazon Bedrock — incident analysis, risk assessment, handoff briefings and
  contradiction detection, via the Converse API with strict JSON validation

── Links ──
Live app: https://sentinel-memory-lemon.vercel.app
Source:   https://github.com/ParishruthiGanesh/sentinel-memory

Built for the CockroachDB × AWS "Build with Agentic Memory" Hackathon.

Safety note: Sentinel is decision support. It has no machinery control path and
cannot actuate equipment. Approving a recommendation records a human
authorization; a person performs the action.

── Chapters ──
0:00 The problem: context dies at every handover
0:20 Proposing a restart, and what memory returns
0:32 Human approval, committed in one transaction
0:46 The agent disconnects — continuity from the database
0:56 Audit trail, memory search, and the close

#CockroachDB #AWS #AmazonBedrock #AIAgents #VectorSearch #AgenticMemory
```

### Notes on the chapters

YouTube requires the first chapter at `0:00`, at least three chapters, and each
one at least 10 seconds long. The five above satisfy that for a 1:24 video. If
you re-cut the video, re-check the boundaries or YouTube will silently ignore
the whole list.

### Before you publish

The description claims CockroachDB vector indexing and Bedrock are in use. Make
sure the video actually shows that — if the amber "Running on in-memory demo
store" banner is visible on screen, soften these lines or wire up the
environment variables first.
