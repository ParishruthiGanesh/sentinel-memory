/**
 * Prompt construction for the Sentinel reasoning agent.
 *
 * Everything the model is allowed to reason over is assembled here, explicitly,
 * from CockroachDB rows: the incident record, the recent observation stream and
 * the memories returned by vector retrieval. The guardrails in the system
 * prompt are the product's safety contract, not decoration.
 */

import type { Incident, MemoryEvent, RetrievedMemory, SafetyRule } from '@/lib/types';

export const SYSTEM_PROMPT = `You are Sentinel, an incident-response decision-support agent for industrial and workplace safety.

Your job is to help a human responder choose a SAFE NEXT ACTION by grounding the decision in retrieved memories of what similar past actions actually caused.

Hard rules — follow every one of them:
1. Use ONLY the incident context and retrieved memories provided in the user message. If something is not in that context, you do not know it.
2. Never fabricate procedures, sensor readings, equipment specifications, timings, or outcomes. If a number was not given to you, do not state a number.
3. Clearly distinguish known facts (stated in the context) from inferences (your reasoning). Write inferences with hedged language such as "this suggests" or "likely".
4. You have no control over physical machinery. Never state or imply that an external physical action has been performed, scheduled, or automated. You RECOMMEND; an authorized human decides and acts.
5. When the available information is insufficient to recommend safely, recommend escalation or an information-gathering step instead of a physical action.
6. Any high-risk physical action (shutdown, restart, re-energizing, venting, entry into a hazard zone, isolation of a live system) ALWAYS requires human approval: set "requiresHumanApproval" to true.
7. Cite the memories you actually used in "supportingMemoryIds", using the exact MEMORY ID strings from the context. Cite nothing you did not use. If you used no memories, return an empty array.
8. Retrieved historical memories are context, NOT guaranteed causal proof. A past outcome shows what happened once under similar conditions; it does not prove the same cause applies now. Phrase warnings accordingly.
9. Report a contradiction whenever two statements in the context cannot both be true (for example, conflicting equipment states or conflicting personnel accounts).
10. Set "confidence" to reflect how well the retrieved memories and the observations actually support your recommendation. Low retrieval overlap means low confidence.

Respond with a single JSON object and nothing else. No prose before or after, no markdown fence.

Schema:
{
  "riskLevel": "critical" | "high" | "medium" | "low",
  "recommendedAction": string,
  "explanation": string,
  "confidence": number between 0 and 1,
  "supportingMemoryIds": string[],
  "potentialConsequences": string[],
  "requiresHumanApproval": boolean,
  "contradictions": [{ "statementA": string, "statementB": string, "explanation": string }]
}`;

export const HANDOFF_SYSTEM_PROMPT = `You are Sentinel, writing a shift-handoff briefing for a backup incident-response agent that has zero prior context.

The incoming agent will act on this briefing. It must be able to answer, immediately: what happened, what has already been attempted, what must never be repeated, what is still dangerous, and what to do next.

Hard rules:
1. Use ONLY the provided incident record, memory events, decisions and retrieved memories. Never invent events, readings, or outcomes.
2. "whatMustNotBeRepeated" must be grounded in an actual rejected action, an actual recorded consequence from a past incident, or an explicit safety rule in the context. Do not invent prohibitions.
3. Never state that a physical action was performed unless the context records it as performed.
4. List genuinely open questions in "unresolvedQuestions" — things the context does not answer that the next responder must find out.
5. Be concrete and terse. Each list item is one sentence a responder can act on.

Respond with a single JSON object and nothing else. No prose before or after, no markdown fence.

Schema:
{
  "whatHappened": string,
  "whatWasAttempted": string[],
  "whatMustNotBeRepeated": string[],
  "currentRisks": string[],
  "unresolvedQuestions": string[],
  "recommendedNextAction": string
}`;

function formatMemory(memory: RetrievedMemory, index: number): string {
  const lines = [
    `[${index + 1}] MEMORY ID: ${memory.id}`,
    `    Similarity: ${(memory.similarity * 100).toFixed(1)}%`,
    `    Source incident: ${memory.incidentCode ?? 'unknown'} — ${memory.incidentTitle ?? 'untitled'}`,
    `    Date: ${memory.incidentDate ?? memory.createdAt}`,
    `    Severity: ${memory.severity ?? 'unspecified'}`,
    `    Memory type: ${memory.memoryType}`,
    `    Summary: ${memory.sourceText}`,
  ];
  if (memory.actionTaken) lines.push(`    Action taken: ${memory.actionTaken}`);
  if (memory.outcome) lines.push(`    Outcome: ${memory.outcome}`);
  if (memory.lessonLearned) lines.push(`    Lesson learned: ${memory.lessonLearned}`);
  return lines.join('\n');
}

function formatObservation(event: MemoryEvent): string {
  return `- [${event.createdAt}] (${event.actorType}/${event.actorName}) ${event.content}`;
}

function formatRule(rule: SafetyRule): string {
  return `- ${rule.name} [${rule.enforcementLevel}${
    rule.requiresHumanApproval ? ', human approval required' : ''
  }]: ${rule.description}`;
}

export interface RecommendationPromptInput {
  incident: Incident;
  observations: MemoryEvent[];
  memories: RetrievedMemory[];
  safetyRules: SafetyRule[];
  /** The new observation or the action the responder is considering. */
  trigger: string;
  triggerKind: 'observation' | 'proposed_action';
}

export function buildRecommendationPrompt(input: RecommendationPromptInput): string {
  const { incident, observations, memories, safetyRules, trigger, triggerKind } = input;

  const sections = [
    '## ACTIVE INCIDENT (from CockroachDB system of record)',
    `Incident code: ${incident.incidentCode}`,
    `Title: ${incident.title}`,
    `Description: ${incident.description}`,
    `Location: ${incident.location}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Current phase: ${incident.currentPhase}`,
    `Opened at: ${incident.createdAt}`,
    '',
    '## OBSERVATION STREAM (most recent last)',
    observations.length
      ? observations.map(formatObservation).join('\n')
      : '- (no observations recorded yet)',
    '',
    triggerKind === 'proposed_action'
      ? '## ACTION THE RESPONDER IS CONSIDERING'
      : '## NEW OBSERVATION JUST RECEIVED',
    trigger,
    '',
    '## RETRIEVED MEMORIES (vector similarity search over stored past incidents)',
    memories.length
      ? memories.map(formatMemory).join('\n\n')
      : '(no sufficiently similar memories were retrieved)',
    '',
    '## ACTIVE SAFETY RULES',
    safetyRules.length ? safetyRules.map(formatRule).join('\n') : '- (none configured)',
    '',
    '## YOUR TASK',
    triggerKind === 'proposed_action'
      ? 'Assess the action the responder is considering. If a retrieved memory shows that a similar action produced a harmful consequence, say so explicitly and recommend a safer ordering or a safer alternative. Cite the memory IDs you relied on.'
      : 'Given the new observation, recommend the safest next action for the responder. If a retrieved memory shows a similar situation where an action produced a harmful consequence, warn about it explicitly and recommend a safer sequence. Cite the memory IDs you relied on.',
    'Return only the JSON object described in your instructions.',
  ];

  return sections.join('\n');
}

export interface HandoffPromptInput {
  incident: Incident;
  events: MemoryEvent[];
  memories: RetrievedMemory[];
  decisions: { decision: string; action: string; decidedBy: string; reason: string | null }[];
  safetyRules: SafetyRule[];
  fromAgent: string;
  toAgent: string;
}

export function buildHandoffPrompt(input: HandoffPromptInput): string {
  const { incident, events, memories, decisions, safetyRules, fromAgent, toAgent } = input;

  return [
    `## HANDOFF: ${fromAgent} -> ${toAgent}`,
    '',
    '## INCIDENT RECORD (CockroachDB)',
    `Incident code: ${incident.incidentCode}`,
    `Title: ${incident.title}`,
    `Description: ${incident.description}`,
    `Location: ${incident.location}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Current phase: ${incident.currentPhase}`,
    `Opened at: ${incident.createdAt}`,
    '',
    '## DURABLE MEMORY EVENTS (chronological)',
    events.length
      ? events
          .map(
            (event) =>
              `- [${event.createdAt}] ${event.eventType} (${event.actorType}/${event.actorName}): ${event.content}`,
          )
          .join('\n')
      : '- (none)',
    '',
    '## HUMAN DECISIONS ON RECOMMENDED ACTIONS',
    decisions.length
      ? decisions
          .map(
            (decision) =>
              `- ${decision.decision.toUpperCase()} by ${decision.decidedBy}: "${decision.action}"${
                decision.reason ? ` — reason: ${decision.reason}` : ''
              }`,
          )
          .join('\n')
      : '- (no decisions recorded yet)',
    '',
    '## RELEVANT HISTORICAL MEMORIES (vector retrieval)',
    memories.length ? memories.map(formatMemory).join('\n\n') : '(none retrieved)',
    '',
    '## ACTIVE SAFETY RULES',
    safetyRules.length ? safetyRules.map(formatRule).join('\n') : '- (none configured)',
    '',
    '## YOUR TASK',
    `Write the handoff briefing for ${toAgent}. Return only the JSON object described in your instructions.`,
  ].join('\n');
}
