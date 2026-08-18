# Video narration — record-ready

**Hard limit: under 3:00.** This script is **2:44** at a calm 145 words/minute
(≈395 words). Read it once out loud before recording; if you naturally run fast,
the pauses marked `[beat]` are where to spend the slack.

The judging criterion is *"demonstrates your submission **and the CockroachDB
memory layer at work**."* So every section below names the database out loud and
shows it on screen. That is deliberate — do not trim those phrases.

---

## Before you hit record

```bash
curl -s https://YOUR-PRODUCTION-URL/api/health | jq '.mode, .notices'
```

You want:

```json
{ "store": "cockroachdb", "reasoning": "bedrock", "embeddings": "bedrock", "demoMode": true }
[]
```

If `store` says `in-memory-demo` or `reasoning` says `local-heuristic`, **stop and
fix the environment variables first.** The app is honest about degraded mode —
it will paint "Running on in-memory demo store" across the top of every frame of
your video, directly contradicting the thing you are being judged on.

Then:

- Reset to a clean incident: `npm run db:reset`
- Browser at **1600×1000**, zoom **110%**, no bookmarks bar, no extensions
- Close other tabs (the tab strip is in frame)
- Open `/` and **do not pre-click** the proposed-action button — the retrieval
  must happen on camera
- Record at 1080p, 30fps

---

## 0:00 – 0:20 · The problem  *(48 words)*

> **On screen:** Command Center, top summary bar. Do not click yet.

"During an industrial emergency, the people change faster than the situation
does. Shifts rotate. Responders hand over. Agent processes restart. `[beat]`

And what gets lost isn't the incident description — that's written down. What
gets lost is the *consequence* of what was already tried."

---

## 0:20 – 0:45 · The live incident  *(59 words)*

> **On screen:** point at the incident header, then run your cursor down the
> observation feed. Then the badges in the top-right.

"This is Sentinel Memory. Incident INC-2026-0817 — smoke near Machine 7,
Assembly Plant Zone 4. Critical, in containment.

Four observations so far: smoke on a thermal alarm, a worker accounted for,
pressure rising on the Machine 8 header, main power still live. `[beat]`

Every one of those is a durable row in **CockroachDB** — not a message in a
context window."

---

## 0:45 – 1:15 · Retrieval from the vector index  *(70 words)*

> **On screen:** click the amber **"Check a proposed action against memory"**
> button. Let the response land before you keep talking.

"Here's the reasonable thing to do: restart Machine 7 to clear the fault. Watch
what happens. `[click — pause 2s]`

Sentinel embeds that proposal and searches **CockroachDB's distributed vector
index**. Eighteen memories searched, in milliseconds. `[beat — point at the
telemetry line]`

And look at what these rows carry. Not just a description — the **action taken**,
the **outcome it produced**, and the **lesson recorded**. That's the difference
between remembering a conversation and remembering a consequence."

---

## 1:15 – 1:40 · The counterfactual, and the approval  *(72 words)*

> **On screen:** the amber "What happened last time?" card, then the
> recommendation on the left, then click **Approve safer action** → confirm.

"The closest match is INC-2025-0412. Same machine, same situation — and somebody
did exactly what we were about to do.

They restarted Machine 7 *before* isolating the shared pressure line. Pressure
transferred to Machine 8, destroyed a secondary valve, added eleven hours to the
shutdown. `[beat]`

So Sentinel recommends the safer sequence instead — isolate and verify the
pressure line first — and cites the memory it got that from. `[click Approve]`

I approve as the authorized responder. Sentinel never touches the machine; a
person does. And that approval writes the decision, the recommendation status,
the incident state and the audit event in **one CockroachDB transaction**. All
four, or none."

---

## 1:40 – 2:05 · The agent disconnects  *(63 words)*

> **On screen:** navigate to **Agent Handoff**. Click **Simulate Primary Agent
> Disconnect**, then **Transfer to Backup Agent**. Let the briefing render.

"Now the part that usually breaks everything. `[click disconnect]`

The primary agent is gone. Backup agent: zero context. Except the incident was
never stored *in* the agent. `[click transfer — pause 3s]`

Sentinel rebuilds the whole thing from **CockroachDB** and briefs the backup:
what happened, what was attempted, **what must not be repeated** — including that
2025 pressure transfer — current risks, and the next step. `[beat]`

Continuity verified. That briefing came out of a database, not a transcript."

---

## 2:05 – 2:30 · The receipts  *(60 words)*

> **On screen:** **Incident Timeline**, scroll slowly through the event stream.
> Then **Memory Explorer** — it auto-runs the demo query.

"And every step is auditable. Observation received. Memory retrieved from the
vector index. Consequence warning raised. Safer sequence recommended. Human
approved. Incident state changed. Handoff created. `[beat]`

All reconstructed from durable memory events in CockroachDB.

The same retrieval is searchable directly — similarity scores, query latency,
and which index served it. Nothing hidden behind the AI's answer."

---

## 2:30 – 2:44 · Close  *(43 words)*

> **On screen:** back to the Command Center, counterfactual card in frame. Hold
> the last shot for two seconds after you stop speaking.

"CockroachDB is the system of record: live state, immutable event memory,
vector-searchable consequences, transactional approvals and agent handoffs — one
database. Amazon Bedrock reasons over what that memory returns. `[beat]`

Normal agents remember conversations.

**Sentinel remembers consequences.**"

---

## If something goes wrong mid-take

- **Bedrock is slow or times out** → the UI degrades to the local reasoner and
  says so on screen. Don't cut. Say: *"and that's the honest-degradation path —
  it names the failure instead of pretending."* Then carry on. Judges reward
  that more than a suspiciously perfect demo.
- **The recommendation is already decided** → add any observation from the quick
  buttons; that triggers a fresh retrieval and a new pending recommendation.
- **You need a clean slate** → `npm run db:reset` restores the exact opening
  state.

## Upload checklist

- [ ] Under 3:00
- [ ] Uploaded to **YouTube or Vimeo** and set to **Public** (not Unlisted —
      the rules say public)
- [ ] Audio is audible and the narration matches what's on screen
- [ ] The words "CockroachDB", "vector index" and "Amazon Bedrock" are all
      spoken aloud
- [ ] No credentials visible in any frame (check the browser URL bar and any
      terminal you show)
- [ ] Video URL pasted into the Devpost submission

---

## Recording it automatically (recommended)

Hand-recording means mouse wobble, missed clicks and dead air while you hunt for
a button. `scripts/record-demo.mjs` drives the whole demo through a real browser
with the pacing above and writes a silent video you narrate over.

```bash
npm i -D playwright && npx playwright install chromium

# against your deployed app
npm run record:demo -- --base-url https://your-app.vercel.app

# or against a local production build
npm run build && npm start
npm run record:demo
```

It runs a **pre-flight `/api/health` check and refuses to record** if
CockroachDB or Bedrock is not connected — because a degraded-mode banner in
every frame is the single worst thing that can happen to this submission. Add
`--skip-health-check` to override (e.g. for a plain UI walkthrough).

Useful flags:

| Flag | Purpose |
| --- | --- |
| `--base-url <url>` | Target app (default `http://localhost:3000`) |
| `--out <dir>` | Output directory (default `./demo-recording`) |
| `--width` / `--height` | Viewport, default 1600×1000 |
| `--executable-path <path>` | Use an existing Chrome instead of Playwright's download |
| `--skip-health-check` | Record even in degraded mode |
| `--captions` | Burn the narration in as on-screen captions |

It prints a timestamp for each section as it records, so you can check the beats
line up with this script before you commit to a voice take. A clean run lands at
about **2:41**.

Then drop the `.webm` into any editor, record the narration above over it, and
export. Reset between takes with `npm run db:reset`.

### No time to record audio?

```bash
npm run record:demo -- --base-url https://your-app.vercel.app --captions
```

`--captions` burns this script in as timed on-screen captions, so the silent
recording explains itself and is submittable as-is. A voice track is still
better — judges watch a lot of these and a human voice carries conviction that
text does not — but a captioned video beats no video, and beats a video whose
point nobody can follow. If you do record voice, leave `--captions` on anyway:
they double as accessibility subtitles.
