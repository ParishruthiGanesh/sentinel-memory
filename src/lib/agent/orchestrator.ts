/**
 * The server-side agent orchestrator.
 *
 * This is the single place where the loop lives:
 *
 *   observation / proposed action
 *     -> embed                              (embedding provider)
 *     -> retrieve similar memories          (CockroachDB vector search)
 *     -> ground the model on those memories (Amazon Bedrock)
 *     -> validate the structured response   (Zod)
 *     -> persist recommendation + provenance (CockroachDB)
 *
 * Retrieval telemetry is returned to the caller rather than hidden, because the
 * whole point of the product is that you can *see* memory working.
 */

import { embedWithFallback, getEmbeddingProvider } from '@/lib/ai/embeddings';
import { reasonHandoff, reasonRecommendation } from '@/lib/ai/reasoner';
import { getStore } from '@/lib/store';
import { NotFoundError } from '@/lib/store/types';
import type { MemorySearchFilters } from '@/lib/store/types';
import { env } from '@/lib/env';
import type {
  Contradiction,
  HandoffSummary,
  Incident,
  IncidentHandoff,
  MemoryEvent,
  Recommendation,
  RetrievalResult,
  RetrievedMemory,
  SafetyRule,
} from '@/lib/types';

export interface AnalysisRequest {
  incidentId: string;
  /** The observation text, or the action the responder is considering. */
  trigger: string;
  triggerKind: 'observation' | 'proposed_action';
  actorName: string;
}

export interface AnalysisResult {
  incident: Incident;
  recommendation: Recommendation;
  retrieval: RetrievalResult;
  contradictions: Contradiction[];
  reasoning: {
    provider: 'bedrock' | 'local-heuristic';
    providerLabel: string;
    latencyMs: number;
    degradedReason?: string;
  };
  safetyRules: SafetyRule[];
}

/**
 * Build the text we embed for retrieval.
 *
 * The incident's own framing (title, location, description) is blended with the
 * new trigger so retrieval is anchored to the situation, not just to the last
 * sentence a responder typed.
 */
export function buildRetrievalQuery(incident: Incident, trigger: string): string {
  return [incident.title, incident.location, incident.description, trigger]
    .filter(Boolean)
    .join('\n');
}

/** Embed a query and run vector retrieval, returning full telemetry. */
export async function retrieveMemories(
  query: string,
  options: {
    limit?: number;
    filters?: MemorySearchFilters;
    excludeIncidentId?: string | null;
    maxPerIncident?: number;
  } = {},
): Promise<RetrievalResult> {
  const store = getStore();
  const started = Date.now();

  const { vector, provider } = await embedWithFallback(query);
  const outcome = await store.searchMemories(vector, {
    limit: options.limit ?? 3,
    filters: options.filters,
    excludeIncidentId: options.excludeIncidentId ?? null,
    maxPerIncident: options.maxPerIncident,
  });

  return {
    memories: outcome.memories,
    latencyMs: Date.now() - started,
    memoriesSearched: outcome.memoriesSearched,
    vectorIndexUsed: outcome.vectorIndexUsed,
    embeddingProvider: provider,
    embeddingDimensions: getEmbeddingProvider().dimensions,
    query,
  };
}

/**
 * Full analysis cycle for a new observation or a proposed action.
 *
 * Everything it learns is written back to CockroachDB as durable memory:
 * the retrieval itself, the recommendation, and any contradictions detected.
 */
export async function analyzeAndRecommend(request: AnalysisRequest): Promise<AnalysisResult> {
  const store = getStore();

  const incident = await store.getIncident(request.incidentId);
  if (!incident) throw new NotFoundError(`Incident ${request.incidentId} not found`);

  const [events, safetyRules] = await Promise.all([
    store.listMemoryEvents(incident.id, 60),
    store.listSafetyRules(),
  ]);

  const observations = events.filter(
    (event) => event.eventType === 'observation' || event.eventType === 'incident_created',
  );

  const retrieval = await retrieveMemories(buildRetrievalQuery(incident, request.trigger), {
    limit: 3,
    // Never retrieve the live incident's own rows as "historical precedent".
    excludeIncidentId: incident.id,
  });

  // Record the retrieval itself as a durable memory event so the timeline shows
  // that memory was consulted, not just that an answer appeared.
  await store.appendMemoryEvent({
    incidentId: incident.id,
    eventType: 'memory_retrieved',
    actorType: 'system',
    actorName: 'Sentinel',
    content: retrieval.memories.length
      ? `Retrieved ${retrieval.memories.length} similar memories from CockroachDB vector index in ${retrieval.latencyMs}ms. Closest: ${retrieval.memories[0].incidentCode} at ${(retrieval.memories[0].similarity * 100).toFixed(1)}% similarity.`
      : `Vector retrieval over ${retrieval.memoriesSearched} memories returned no sufficiently similar precedent.`,
    metadata: {
      memoryIds: retrieval.memories.map((memory) => memory.id),
      similarities: retrieval.memories.map((memory) => Number(memory.similarity.toFixed(4))),
      latencyMs: retrieval.latencyMs,
      memoriesSearched: retrieval.memoriesSearched,
      vectorIndexUsed: retrieval.vectorIndexUsed,
      embeddingProvider: retrieval.embeddingProvider,
    },
  });

  const reasoning = await reasonRecommendation({
    incident,
    observations,
    memories: retrieval.memories,
    safetyRules,
    trigger: request.trigger,
    triggerKind: request.triggerKind,
  });

  const recommendation = await store.createRecommendation({
    incidentId: incident.id,
    proposedAction: reasoning.recommendedAction,
    explanation: reasoning.explanation,
    confidence: reasoning.confidence,
    riskLevel: reasoning.riskLevel,
    retrievedMemoryIds: reasoning.supportingMemoryIds.length
      ? reasoning.supportingMemoryIds
      : retrieval.memories.map((memory) => memory.id),
    potentialConsequences: reasoning.potentialConsequences,
    requiresHumanApproval: reasoning.requiresHumanApproval,
    provider: reasoning.providerLabel,
  });

  await store.appendMemoryEvent({
    incidentId: incident.id,
    eventType: 'recommendation',
    actorType: 'ai',
    actorName: 'Sentinel',
    content: `Recommended: ${recommendation.proposedAction}`,
    metadata: {
      recommendationId: recommendation.id,
      riskLevel: recommendation.riskLevel,
      confidence: recommendation.confidence,
      provider: reasoning.provider,
      providerLabel: reasoning.providerLabel,
      supportingMemoryIds: recommendation.retrievedMemoryIds,
    },
  });

  // A retrieved precedent whose recorded outcome was harmful is surfaced as an
  // explicit risk event — this is the "consequence memory" the product is about.
  const counterfactual = retrieval.memories.find((memory) => memory.outcome && memory.actionTaken);
  if (counterfactual) {
    await store.appendMemoryEvent({
      incidentId: incident.id,
      eventType: 'risk_detected',
      actorType: 'ai',
      actorName: 'Sentinel',
      content: `Consequence warning from ${counterfactual.incidentCode}: "${counterfactual.actionTaken}" previously led to "${counterfactual.outcome}".`,
      metadata: {
        memoryId: counterfactual.id,
        similarity: Number(counterfactual.similarity.toFixed(4)),
        sourceIncidentCode: counterfactual.incidentCode,
      },
    });
  }

  const contradictions = reasoning.contradictions.length
    ? await store.recordContradictions(
        reasoning.contradictions.map((item) => ({
          incidentId: incident.id,
          statementA: item.statementA,
          statementB: item.statementB,
          explanation: item.explanation,
        })),
      )
    : [];

  for (const contradiction of contradictions) {
    await store.appendMemoryEvent({
      incidentId: incident.id,
      eventType: 'contradiction',
      actorType: 'ai',
      actorName: 'Sentinel',
      content: `Contradiction detected: "${contradiction.statementA}" vs "${contradiction.statementB}". ${contradiction.explanation}`,
      metadata: { contradictionId: contradiction.id },
    });
  }

  return {
    incident,
    recommendation,
    retrieval,
    contradictions,
    reasoning: {
      provider: reasoning.provider,
      providerLabel: reasoning.providerLabel,
      latencyMs: reasoning.latencyMs,
      degradedReason: reasoning.degradedReason,
    },
    safetyRules,
  };
}

export interface HandoffResult {
  handoff: IncidentHandoff;
  summary: HandoffSummary;
  retrieval: RetrievalResult;
  reasoning: {
    provider: 'bedrock' | 'local-heuristic';
    providerLabel: string;
    latencyMs: number;
    degradedReason?: string;
  };
}

/**
 * Reconstruct everything the incoming agent needs from durable memory, ask the
 * model to compress it into a briefing, and store the briefing.
 *
 * The incoming agent's knowledge does not come from a conversation transcript —
 * it comes from CockroachDB.
 */
export async function generateHandoff(input: {
  incidentId: string;
  fromAgentId: string;
  toAgentId: string;
}): Promise<HandoffResult> {
  const store = getStore();

  const incident = await store.getIncident(input.incidentId);
  if (!incident) throw new NotFoundError(`Incident ${input.incidentId} not found`);

  const [fromAgent, toAgent, events, decisions, safetyRules] = await Promise.all([
    store.getAgent(input.fromAgentId),
    store.getAgent(input.toAgentId),
    store.listMemoryEvents(incident.id, 200),
    store.listDecisions(incident.id),
    store.listSafetyRules(),
  ]);

  if (!fromAgent || !toAgent) throw new NotFoundError('Handoff agent not found');

  const recentContext = events
    .slice(-12)
    .map((event: MemoryEvent) => event.content)
    .join('\n');

  const retrieval = await retrieveMemories(
    buildRetrievalQuery(incident, recentContext),
    { limit: 3, excludeIncidentId: incident.id },
  );

  const reasoning = await reasonHandoff({
    incident,
    events,
    memories: retrieval.memories,
    decisions: decisions.map((decision) => ({
      decision: decision.decision,
      action: decision.proposedAction,
      decidedBy: decision.decidedBy,
      reason: decision.reason,
    })),
    safetyRules,
    fromAgent: fromAgent.name,
    toAgent: toAgent.name,
  });

  const summary: HandoffSummary = {
    whatHappened: reasoning.whatHappened,
    whatWasAttempted: reasoning.whatWasAttempted,
    whatMustNotBeRepeated: reasoning.whatMustNotBeRepeated,
    currentRisks: reasoning.currentRisks,
    unresolvedQuestions: reasoning.unresolvedQuestions,
    recommendedNextAction: reasoning.recommendedNextAction,
  };

  const handoff = await store.createHandoff({
    incidentId: incident.id,
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    summary,
    supportingMemoryIds: retrieval.memories.map((memory: RetrievedMemory) => memory.id),
    provider: reasoning.providerLabel,
  });

  return {
    handoff,
    summary,
    retrieval,
    reasoning: {
      provider: reasoning.provider,
      providerLabel: reasoning.providerLabel,
      latencyMs: reasoning.latencyMs,
      degradedReason: reasoning.degradedReason,
    },
  };
}

/** Default responder name shown in the UI and attributed to manual actions. */
export function defaultResponder(): string {
  return env.defaultResponder;
}
