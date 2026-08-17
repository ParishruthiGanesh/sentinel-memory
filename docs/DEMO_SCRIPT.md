# Demo script — Sentinel Memory

**Target length:** under 3:00. The cut below runs **2:45**.
**Recording setup:** 1600×1000 browser window, `DEMO_MODE=true`, seeded database,
Bedrock configured. Zoom the browser to 110% so text is legible at 1080p.

## Before you record

```bash
npm run db:reset          # fresh incident, no prior decisions or handoffs
npm run build && npm start
curl -s localhost:3000/api/health | jq '.mode'
# expect: { "store": "cockroachdb", "reasoning": "bedrock", "embeddings": "bedrock", … }
```

Open `http://localhost:3000` and leave it on the Command Center. Do **not**
pre-click the proposed-action button — the retrieval needs to happen on camera.

---

## 0:00–0:20 · The problem

**On screen:** Command Center, top summary bar visible.

> "During an industrial emergency, the people change faster than the situation
> does. Shifts rotate, responders hand over, agent processes restart. And what
> gets lost isn't the incident description — that's written down. What gets lost
> is the consequence of what was already tried.
>
> So the next responder reaches for the same obvious action again. This is
> Sentinel Memory, and it's built so that can't happen."

---

## 0:20–0:45 · The live incident

**On screen:** point at the incident header, then the observation feed.

> "Incident INC-2026-0817. Smoke near Machine 7, Assembly Plant Zone 4. Critical,
> in containment.
>
> Four observations so far: smoke on a thermal alarm, a worker accounted for,
> pressure rising on the Machine 8 header, and main power still live.
>
> Every one of those is a durable row in CockroachDB, not a message in a context
> window."

*Point at the top-right badges.* 

> "CockroachDB connected, Bedrock connected — the app tells you exactly what's
> live."

---

## 0:45–1:15 · Retrieval from vector memory

**On screen:** click the amber **"Check a proposed action against memory"**
button — *"Shut down and restart Machine 7 immediately to stop the smoke."*

> "Here's the reasonable thing to do: restart Machine 7 to clear the fault.
>
> Watch what happens. Sentinel embeds that proposal, searches CockroachDB's
> distributed vector index, and pulls back the three closest memories."

*Let the response land. Point at the Retrieved Memories panel.*

> "Eighteen memories searched. Milliseconds. And notice what these rows carry —
> not just a description, but the **action taken**, the **outcome it produced**,
> and the **lesson recorded**. That's the difference between remembering a
> conversation and remembering a consequence."

---

## 1:15–1:40 · The counterfactual and the approval

**On screen:** the amber "What happened last time?" card.

> "The closest match is INC-2025-0412, April last year. Same machine, same
> situation — and somebody did exactly what we were about to do.
>
> They restarted Machine 7 before isolating the shared pressure line. Pressure
> transferred to Machine 8, destroyed a secondary valve, and added eleven hours
> to the shutdown."

*Point at the recommendation on the left.*

> "So Sentinel doesn't recommend the restart. It recommends the safer sequence:
> isolate and verify the shared pressure line **first** — citing the memory it
> got that from."

*Click **Approve safer action**, add a reason, confirm.*

> "I approve as the authorized responder. Sentinel never touches the machine —
> a person does. And that approval writes the decision, the recommendation
> status, the incident state and the audit event in **one CockroachDB
> transaction**. All four, or none."

---

## 1:40–2:05 · The agent disconnects

**On screen:** navigate to **Agent Handoff**.

> "Now the part that usually breaks everything."

*Click **Simulate Primary Agent Disconnect**.*

> "The primary agent is gone. Backup agent: zero context.
>
> Except the incident was never stored in the agent."

*Click **Transfer to Backup Agent**.*

> "Sentinel reconstructs the whole thing from durable memory and briefs the
> backup: what happened, what was attempted, **what must not be repeated** —
> including the 2025 pressure transfer, and any action this responder already
> rejected — current risks, open questions, and the recommended next step.
>
> Continuity verified. That briefing came out of a database, not a transcript."

---

## 2:05–2:30 · The receipts

**On screen:** navigate to **Incident Timeline**.

> "And every step is auditable. Observation received. Memory retrieved from the
> vector index. Consequence warning raised. Safer sequence recommended. Human
> approved. Incident state changed. Handoff created.
>
> Reconstructed from durable memory events — with the audit trail underneath
> showing before and after state for every change."

*Switch to **Memory Explorer**, run the demo query.*

> "The same retrieval is searchable directly — similarity scores, query latency,
> and which index served it. Nothing hidden behind the AI's answer."

---

## 2:30–2:45 · Close

**On screen:** back to the Command Center, counterfactual card in frame.

> "CockroachDB is the system of record: live state, immutable event memory,
> vector-searchable consequences, transactional approvals and agent handoffs, in
> one database. Amazon Bedrock does the reasoning over what that memory returns.
>
> Normal agents remember conversations.
>
> **Sentinel remembers consequences.**"

---

## Backup takes

Record these separately in case a live call is slow:

1. **The seeder's retrieval smoke test** (`npm run db:seed` output) — proves the
   vector path against a real cluster in one terminal screenshot.
2. **`curl -s localhost:3000/api/health | jq`** — shows both integrations live
   and no secrets in the payload.
3. **A rejection instead of an approval** — then the handoff, so
   "what must not be repeated" contains the responder's own refusal.
4. **`npm test`** — 94 passing tests, if you want a quality beat.

## If something goes wrong on camera

- **Bedrock times out** → the UI degrades to the local reasoner and says so
  explicitly. Acknowledge it: "that's the honest-degradation path — it names the
  failure rather than pretending." Then continue.
- **The recommendation is already decided** → add a quick observation; that
  triggers a fresh retrieval and a new pending recommendation.
- **Reset mid-take** → `npm run db:reset` restores the exact starting state.
