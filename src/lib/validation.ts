/**
 * Zod schemas for every untrusted input boundary (HTTP request bodies, query
 * strings) and for the structured JSON contract we require from Amazon Bedrock.
 */

import { z } from 'zod';

/**
 * Hard ceiling on free-text fields. Kept in sync with MAX_CONTENT_LENGTH but
 * defined statically so schemas can be reused in tests without env access.
 */
export const MAX_TEXT = 2000;

const nonEmptyText = (max = MAX_TEXT) =>
  z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be at most ${max} characters`);

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const riskLevelSchema = severitySchema;

export const incidentPhaseSchema = z.enum([
  'detection',
  'assessment',
  'containment',
  'stabilization',
  'recovery',
  'review',
]);

export const incidentStatusSchema = z.enum(['active', 'contained', 'resolved', 'closed']);

export const actorTypeSchema = z.enum(['human', 'system', 'ai']);

export const memoryTypeSchema = z.enum([
  'incident_summary',
  'observation',
  'action_taken',
  'outcome',
  'lesson_learned',
  'safety_procedure',
]);

// ---------------------------------------------------------------------------
// HTTP request payloads
// ---------------------------------------------------------------------------

export const createIncidentSchema = z.object({
  title: nonEmptyText(200),
  description: nonEmptyText(),
  location: nonEmptyText(160),
  severity: severitySchema.default('high'),
  currentPhase: incidentPhaseSchema.default('detection'),
  reportedBy: nonEmptyText(120).optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const createObservationSchema = z.object({
  incidentId: z.string().uuid('must be a valid incident id'),
  content: nonEmptyText(),
  actorType: actorTypeSchema.default('human'),
  actorName: nonEmptyText(120).default('Responder'),
  /**
   * When true the orchestrator immediately retrieves similar memories and asks
   * Bedrock for a grounded recommendation.
   */
  analyze: z.boolean().default(true),
});
export type CreateObservationInput = z.infer<typeof createObservationSchema>;

export const memorySearchSchema = z.object({
  query: nonEmptyText(),
  limit: z.number().int().min(1).max(10).default(3),
  filters: z
    .object({
      severity: severitySchema.optional(),
      memoryType: memoryTypeSchema.optional(),
      location: z.string().trim().max(160).optional(),
      /** ISO date (inclusive lower bound) */
      from: z.string().trim().max(40).optional(),
      /** ISO date (inclusive upper bound) */
      to: z.string().trim().max(40).optional(),
      outcomeContains: z.string().trim().max(200).optional(),
    })
    .default({}),
});
export type MemorySearchInput = z.infer<typeof memorySearchSchema>;

export const proposeActionSchema = z.object({
  incidentId: z.string().uuid(),
  proposedAction: nonEmptyText(),
  requestedBy: nonEmptyText(120).default('Responder'),
  /** Set when the responder pressed "Request alternative" on a prior rec. */
  supersedesRecommendationId: z.string().uuid().optional(),
});
export type ProposeActionInput = z.infer<typeof proposeActionSchema>;

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'alternative_requested']),
  decidedBy: nonEmptyText(120),
  reason: z.string().trim().max(MAX_TEXT).optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const handoffSchema = z.object({
  incidentId: z.string().uuid(),
  fromAgentId: z.string().uuid(),
  toAgentId: z.string().uuid(),
});
export type HandoffInput = z.infer<typeof handoffSchema>;

export const agentStatusSchema = z.object({
  agentId: z.string().uuid(),
  status: z.enum(['active', 'ready', 'standby', 'disconnected']),
});

// ---------------------------------------------------------------------------
// Agent reasoning contract — the JSON shape Bedrock must return
// ---------------------------------------------------------------------------

export const contradictionSchema = z.object({
  statementA: nonEmptyText(600),
  statementB: nonEmptyText(600),
  explanation: nonEmptyText(800),
});

/**
 * The structured response contract. Bedrock output is parsed against this;
 * anything that fails validation is rejected rather than shown to a responder.
 */
export const agentResponseSchema = z.object({
  riskLevel: riskLevelSchema,
  recommendedAction: nonEmptyText(600),
  explanation: nonEmptyText(),
  confidence: z.number().min(0).max(1),
  supportingMemoryIds: z.array(z.string()).max(10).default([]),
  potentialConsequences: z.array(nonEmptyText(400)).max(10).default([]),
  requiresHumanApproval: z.boolean(),
  contradictions: z.array(contradictionSchema).max(5).default([]),
});
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const handoffResponseSchema = z.object({
  whatHappened: nonEmptyText(),
  whatWasAttempted: z.array(nonEmptyText(400)).max(12).default([]),
  whatMustNotBeRepeated: z.array(nonEmptyText(400)).max(12).default([]),
  currentRisks: z.array(nonEmptyText(400)).max(12).default([]),
  unresolvedQuestions: z.array(nonEmptyText(400)).max(12).default([]),
  recommendedNextAction: nonEmptyText(600),
});
export type HandoffResponse = z.infer<typeof handoffResponseSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface ParseFailure {
  ok: false;
  error: string;
  details: { path: string; message: string }[];
}

export type ParseOutcome<T> = { ok: true; data: T } | ParseFailure;

/**
 * Validate an unknown value and flatten Zod issues into a shape that is safe to
 * return to a client (field paths + messages only, never raw internals).
 */
export function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): ParseOutcome<z.infer<T>> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: 'Invalid request payload',
    details: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}

/**
 * Extract the first JSON object from a model response. Bedrock text models
 * frequently wrap JSON in prose or a ```json fence, so we cannot rely on the
 * whole body being parseable.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], trimmed].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  );

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }

  throw new Error('Model response did not contain a parseable JSON object');
}
