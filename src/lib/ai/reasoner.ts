/**
 * The reasoning layer.
 *
 * `BedrockReasoner` is the real integration: it calls the Amazon Bedrock
 * Converse API with the model named by BEDROCK_MODEL_ID and validates the
 * returned JSON against the Zod contract in `@/lib/validation`.
 *
 * `HeuristicReasoner` is the clearly-labelled offline fallback. It performs no
 * language modelling — it composes a recommendation directly from the memories
 * CockroachDB returned (their recorded outcomes and lessons) so the retrieval
 * story still demonstrates end to end without AWS credentials. Every response
 * carries `provider: 'local-heuristic'`, which the UI renders as a badge, so it
 * is never mistaken for model output.
 */

import { env, hasBedrock } from '@/lib/env';
import {
  agentResponseSchema,
  handoffResponseSchema,
  extractJsonObject,
  type AgentResponse,
  type HandoffResponse,
} from '@/lib/validation';
import {
  SYSTEM_PROMPT,
  HANDOFF_SYSTEM_PROMPT,
  buildRecommendationPrompt,
  buildHandoffPrompt,
  type RecommendationPromptInput,
  type HandoffPromptInput,
} from '@/lib/ai/prompts';
import type { RetrievedMemory, RiskLevel } from '@/lib/types';

export type ReasoningProviderId = 'bedrock' | 'local-heuristic';

export interface ReasonedRecommendation extends AgentResponse {
  provider: ReasoningProviderId;
  providerLabel: string;
  latencyMs: number;
  /** Set when Bedrock was configured but the call failed and we degraded. */
  degradedReason?: string;
}

export interface ReasonedHandoff extends HandoffResponse {
  provider: ReasoningProviderId;
  providerLabel: string;
  latencyMs: number;
  degradedReason?: string;
}

export interface Reasoner {
  readonly id: ReasoningProviderId;
  readonly label: string;
  recommend(input: RecommendationPromptInput): Promise<AgentResponse>;
  handoff(input: HandoffPromptInput): Promise<HandoffResponse>;
}

// ---------------------------------------------------------------------------
// Amazon Bedrock
// ---------------------------------------------------------------------------

export class BedrockReasoner implements Reasoner {
  readonly id = 'bedrock' as const;
  readonly label: string;
  private readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
    this.label = modelId;
  }

  private async converse(system: string, user: string, maxTokens: number): Promise<string> {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const { bedrockClientConfig } = await import('@/lib/ai/bedrock-client');

    const client = new BedrockRuntimeClient(bedrockClientConfig());

    // The Converse API gives us one model-agnostic request shape, which is what
    // lets BEDROCK_MODEL_ID stay a plain configuration value.
    const response = await client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        inferenceConfig: { maxTokens, temperature: 0.2, topP: 0.9 },
      }),
    );

    const text = response.output?.message?.content
      ?.map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();

    if (!text) throw new Error('Bedrock returned an empty response');
    return text;
  }

  async recommend(input: RecommendationPromptInput): Promise<AgentResponse> {
    const raw = await this.converse(SYSTEM_PROMPT, buildRecommendationPrompt(input), 1600);
    const parsed = agentResponseSchema.parse(extractJsonObject(raw));
    return enforceSafetyFloor(parsed, input.memories);
  }

  async handoff(input: HandoffPromptInput): Promise<HandoffResponse> {
    const raw = await this.converse(HANDOFF_SYSTEM_PROMPT, buildHandoffPrompt(input), 1600);
    return handoffResponseSchema.parse(extractJsonObject(raw));
  }
}

/**
 * Post-model safety floor.
 *
 * The prompt tells the model that high-risk physical actions require human
 * approval, but we do not rely on the model to comply. Any recommendation that
 * names a high-risk physical verb, or that is rated high/critical, is forced to
 * require approval before a responder ever sees it. Supporting memory ids are
 * also filtered to ids that were genuinely retrieved, so a hallucinated citation
 * cannot reach the UI.
 */
export function enforceSafetyFloor(
  response: AgentResponse,
  memories: RetrievedMemory[],
): AgentResponse {
  const retrievedIds = new Set(memories.map((memory) => memory.id));
  const highRisk =
    response.riskLevel === 'critical' ||
    response.riskLevel === 'high' ||
    isHighRiskPhysicalAction(response.recommendedAction);

  return {
    ...response,
    supportingMemoryIds: response.supportingMemoryIds.filter((id) => retrievedIds.has(id)),
    requiresHumanApproval: response.requiresHumanApproval || highRisk,
  };
}

const HIGH_RISK_VERBS = [
  'shut down', 'shutdown', 'shut-down', 'restart', 'reboot', 'power on', 'power off',
  'energize', 'energise', 're-energize', 'de-energize', 'isolate', 'vent', 'purge',
  'depressurize', 'depressurise', 'evacuate', 'enter', 'open the valve', 'close the valve',
  'bypass', 'override', 'disable', 'reset the breaker', 'restore power',
];

/** True when the proposed action text names a physical action with hazard potential. */
export function isHighRiskPhysicalAction(action: string): boolean {
  const normalized = action.toLowerCase();
  return HIGH_RISK_VERBS.some((verb) => normalized.includes(verb));
}

// ---------------------------------------------------------------------------
// Offline heuristic fallback
// ---------------------------------------------------------------------------

export class HeuristicReasoner implements Reasoner {
  readonly id = 'local-heuristic' as const;
  readonly label = 'local rule-based fallback (no language model)';

  async recommend(input: RecommendationPromptInput): Promise<AgentResponse> {
    const { memories, trigger, incident, triggerKind } = input;
    const top = memories[0];

    const consequences = memories
      .map((memory) => memory.outcome)
      .filter((outcome): outcome is string => Boolean(outcome))
      .slice(0, 3);

    const highRisk = isHighRiskPhysicalAction(trigger);

    // The recommendation is composed from what CockroachDB actually returned:
    // the highest-similarity memory's recorded lesson.
    const recommendedAction = top?.lessonLearned
      ? top.lessonLearned
      : highRisk
        ? 'Hold the proposed physical action and escalate to the on-site safety lead for verification before proceeding.'
        : 'Continue monitoring and record further observations; escalate if conditions worsen.';

    const riskLevel: RiskLevel = deriveRiskLevel(incident.severity, top?.severity ?? null, highRisk);

    const explanation = top
      ? [
          // Deliberately does not name the backing store: this reasoner runs in
          // both configurations, and the UI reports which store actually served
          // the query. Claiming CockroachDB here would be wrong in demo mode.
          `Vector retrieval over stored incident memory matched ${top.incidentCode ?? 'an earlier incident'} at ${(top.similarity * 100).toFixed(1)}% similarity.`,
          top.actionTaken ? `In that incident the action taken was: ${top.actionTaken}` : null,
          top.outcome ? `The recorded outcome was: ${top.outcome}` : null,
          `Because the current ${triggerKind === 'proposed_action' ? 'proposed action' : 'observation'} resembles that situation, the recorded lesson is surfaced as the recommended sequence.`,
          'This is a similarity match, not causal proof — an authorized responder must verify current conditions before acting.',
        ]
          .filter(Boolean)
          .join(' ')
      : 'No sufficiently similar memory was retrieved, so there is no historical precedent to ground a specific recommendation. Escalate and gather more information.';

    const response: AgentResponse = {
      riskLevel,
      recommendedAction,
      explanation,
      confidence: top ? Math.min(0.92, Math.max(0.35, top.similarity)) : 0.3,
      supportingMemoryIds: memories.slice(0, 3).map((memory) => memory.id),
      potentialConsequences: consequences.length
        ? consequences
        : ['Insufficient historical data to enumerate specific consequences.'],
      requiresHumanApproval: true,
      contradictions: [],
    };

    return enforceSafetyFloor(response, memories);
  }

  async handoff(input: HandoffPromptInput): Promise<HandoffResponse> {
    const { incident, events, memories, decisions } = input;

    const attempted = decisions.map(
      (decision) => `${decision.action} — ${decision.decision} by ${decision.decidedBy}`,
    );

    const mustNotRepeat = [
      ...decisions
        .filter((decision) => decision.decision === 'rejected')
        .map((decision) => `Do not proceed with: ${decision.action}`),
      ...memories
        .filter((memory) => memory.actionTaken && memory.outcome)
        .slice(0, 2)
        .map(
          (memory) =>
            `Avoid repeating "${memory.actionTaken}" (${memory.incidentCode ?? 'past incident'}) — recorded outcome: ${memory.outcome}`,
        ),
    ];

    const observations = events.filter((event) => event.eventType === 'observation');

    return {
      whatHappened: `${incident.incidentCode} — ${incident.title} at ${incident.location}. Severity ${incident.severity}, status ${incident.status}, phase ${incident.currentPhase}. ${observations.length} observation(s) recorded since ${incident.createdAt}.`,
      whatWasAttempted: attempted.length ? attempted : ['No actions have been approved yet.'],
      whatMustNotBeRepeated: mustNotRepeat.length
        ? mustNotRepeat
        : ['No prohibited actions have been recorded for this incident yet.'],
      currentRisks: [
        `Incident severity remains ${incident.severity} and the incident is ${incident.status}.`,
        ...memories
          .filter((memory) => memory.outcome)
          .slice(0, 2)
          .map((memory) => `Historical precedent: ${memory.outcome}`),
      ],
      unresolvedQuestions: [
        'Has the shared pressure line been verified as isolated?',
        'Are all personnel accounted for in the affected zone?',
      ],
      recommendedNextAction:
        memories[0]?.lessonLearned ??
        'Verify current conditions on site and escalate to the safety lead before any physical action.',
    };
  }
}

function deriveRiskLevel(
  incidentSeverity: RiskLevel,
  memorySeverity: RiskLevel | null,
  highRiskAction: boolean,
): RiskLevel {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  const rank = (level: RiskLevel | null) => (level ? order.indexOf(level) : 0);
  let highest = Math.max(rank(incidentSeverity), rank(memorySeverity));
  if (highRiskAction) highest = Math.max(highest, order.indexOf('high'));
  return order[highest];
}

// ---------------------------------------------------------------------------
// Selection + graceful degradation
// ---------------------------------------------------------------------------

export function getReasoner(): Reasoner {
  return hasBedrock() ? new BedrockReasoner(env.bedrockModelId!) : new HeuristicReasoner();
}

/**
 * Produce a recommendation, degrading to the heuristic reasoner if Bedrock is
 * configured but unreachable. The provider that actually produced the answer is
 * always reported back so the UI can label it truthfully.
 */
export async function reasonRecommendation(
  input: RecommendationPromptInput,
): Promise<ReasonedRecommendation> {
  const reasoner = getReasoner();
  const started = Date.now();
  try {
    const response = await reasoner.recommend(input);
    return {
      ...response,
      provider: reasoner.id,
      providerLabel: reasoner.label,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (reasoner.id === 'local-heuristic') throw error;
    const reason = error instanceof Error ? error.message : 'unknown Bedrock error';
    console.error('[reasoner] Bedrock call failed, degrading to heuristic reasoner:', error);
    const fallback = new HeuristicReasoner();
    const response = await fallback.recommend(input);
    return {
      ...response,
      provider: fallback.id,
      providerLabel: fallback.label,
      latencyMs: Date.now() - started,
      degradedReason: reason,
    };
  }
}

export async function reasonHandoff(input: HandoffPromptInput): Promise<ReasonedHandoff> {
  const reasoner = getReasoner();
  const started = Date.now();
  try {
    const response = await reasoner.handoff(input);
    return {
      ...response,
      provider: reasoner.id,
      providerLabel: reasoner.label,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (reasoner.id === 'local-heuristic') throw error;
    const reason = error instanceof Error ? error.message : 'unknown Bedrock error';
    console.error('[reasoner] Bedrock handoff failed, degrading to heuristic reasoner:', error);
    const fallback = new HeuristicReasoner();
    const response = await fallback.handoff(input);
    return {
      ...response,
      provider: fallback.id,
      providerLabel: fallback.label,
      latencyMs: Date.now() - started,
      degradedReason: reason,
    };
  }
}
