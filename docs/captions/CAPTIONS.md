# Demo captions - timestamped

Caption text for the Sentinel Memory demo video, with timings.

**Ready-to-upload subtitle files** sit next to this one:

- [`sentinel-demo.srt`](sentinel-demo.srt) - YouTube: *Subtitles -> Add -> Upload file -> With timing*
- [`sentinel-demo.vtt`](sentinel-demo.vtt) - WebVTT, for players that prefer it

## Will these timings match my video?

**If you recorded with `npm run record:demo`** - yes. That pacing is scripted and
lands at 2:40-2:41 every run, and the recorder also writes its own `.srt` timed
from the actual run.

**If you screen-recorded by hand** - they will drift, because your clicks and
pauses are not the script's. Two ways to fix it:

1. **YouTube's caption editor.** Upload the `.srt`, then *Subtitles -> Edit ->
   Timings* and drag the cues. Fine for a second or two of drift.
2. **Send me your section times.** Scrub the video, note the second each of these
   happens, paste them to me, and I will regenerate an exactly-aligned `.srt`:

   | Moment | Your timestamp |
   | --- | --- |
   | Video opens on the Command Center | |
   | You click the proposed-action button | |
   | "What happened last time?" is on screen | |
   | You click Approve | |
   | Agent Handoff page opens | |
   | "Continuity verified" appears | |
   | Incident Timeline opens | |
   | Memory Explorer opens | |
   | Final shot begins | |
   | Video ends | |

**If your video has narration audio, skip all of this** - YouTube will generate
captions from your voice automatically. These files are for a silent recording.

## The captions


### The problem

| Start | End | Caption |
| --- | --- | --- |
| `0:05` | `0:10` | During an industrial emergency, the people change faster than the situation does. |
| `0:10` | `0:14` | Shifts rotate. Responders hand over. Agent processes restart. |
| `0:14` | `0:20` | What gets lost isn't the incident description - it's the consequence of what was already tried. |

### The live incident

| Start | End | Caption |
| --- | --- | --- |
| `0:22` | `0:24` | Incident INC-2026-0817 - smoke near Machine 7. Critical, in containment. |
| `0:25` | `0:28` | Pressure is rising on the Machine 8 header. |
| `0:29` | `0:32` | Main power is still live. |
| `0:33` | `0:38` | Every observation is a durable row in CockroachDB - not a message in a context window. |

### Retrieval

| Start | End | Caption |
| --- | --- | --- |
| `0:41` | `0:42` | Here's the reasonable thing to do: restart Machine 7 to clear the fault. |
| `0:43` | `0:50` | Sentinel embeds that proposal and searches CockroachDB's distributed vector index. |
| `0:51` | `0:56` | Eighteen memories searched, in milliseconds. |
| `0:57` | `1:03` | Each row carries the action taken, the outcome it produced, and the lesson recorded. |
| `1:04` | `1:08` | That is the difference between remembering a conversation and remembering a consequence. |

### The counterfactual and the approval

| Start | End | Caption |
| --- | --- | --- |
| `1:09` | `1:12` | The closest match: INC-2025-0412. Same machine, same situation. |
| `1:12` | `1:15` | Someone restarted Machine 7 before isolating the shared pressure line. |
| `1:15` | `1:18` | Pressure transferred to Machine 8. Secondary valve destroyed. Eleven-hour shutdown. |
| `1:19` | `1:20` | So Sentinel recommends the safer sequence instead - and cites the memory it came from. |
| `1:21` | `1:24` | A human approves. Sentinel never touches the machine - a person does. |
| `1:25` | `1:31` | Decision, recommendation status, incident state and audit event - one CockroachDB transaction. |

### The agent disconnects

| Start | End | Caption |
| --- | --- | --- |
| `1:33` | `1:36` | Now the part that usually breaks everything. |
| `1:36` | `1:40` | The primary agent is gone. The backup has zero context. |
| `1:40` | `1:44` | Except the incident was never stored in the agent. |
| `1:46` | `1:52` | Sentinel rebuilds it from CockroachDB: what happened, what was attempted... |
| `1:54` | `1:59` | ...what must not be repeated, current risks, and the next step. |

### The receipts

| Start | End | Caption |
| --- | --- | --- |
| `2:00` | `2:03` | Every step is auditable - retrieval, warning, recommendation, approval, handoff. |
| `2:08` | `2:12` | All reconstructed from durable memory events in CockroachDB. |
| `2:19` | `2:26` | The same retrieval is searchable directly - similarity, latency, and which index served it. |

### Close

| Start | End | Caption |
| --- | --- | --- |
| `2:29` | `2:33` | CockroachDB is the system of record. Amazon Bedrock reasons over what memory returns. |
| `2:33` | `2:36` | Normal agents remember conversations. |
| `2:36` | `2:40` | Sentinel remembers consequences. |

---

Total runtime 2:41. The full narration for a voice take, with delivery notes and
`[beat]` markers, is in [`../VIDEO_NARRATION.md`](../VIDEO_NARRATION.md).

