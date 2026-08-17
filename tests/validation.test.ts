import { describe, expect, it } from 'vitest';
import {
  agentResponseSchema,
  createIncidentSchema,
  createObservationSchema,
  decisionSchema,
  extractJsonObject,
  handoffResponseSchema,
  memorySearchSchema,
  parseInput,
  proposeActionSchema,
} from '@/lib/validation';

describe('input validation', () => {
  it('rejects an empty observation', () => {
    const result = parseInput(createObservationSchema, {
      incidentId: '10000000-0000-4000-8000-000000000009',
      content: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details.some((detail) => detail.path === 'content')).toBe(true);
    }
  });

  it('rejects an observation longer than the content limit', () => {
    const result = parseInput(createObservationSchema, {
      incidentId: '10000000-0000-4000-8000-000000000009',
      content: 'x'.repeat(2001),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-uuid incident id', () => {
    const result = parseInput(createObservationSchema, {
      incidentId: 'not-a-uuid',
      content: 'Smoke observed.',
    });
    expect(result.ok).toBe(false);
  });

  it('applies defaults and trims accepted observations', () => {
    const result = parseInput(createObservationSchema, {
      incidentId: '10000000-0000-4000-8000-000000000009',
      content: '  Pressure rising in Machine 8.  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.content).toBe('Pressure rising in Machine 8.');
      expect(result.data.actorType).toBe('human');
      expect(result.data.analyze).toBe(true);
    }
  });

  it('requires title, description and location on a new incident', () => {
    const result = parseInput(createIncidentSchema, { title: 'Smoke' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.details.map((detail) => detail.path);
      expect(paths).toContain('description');
      expect(paths).toContain('location');
    }
  });

  it('rejects an unknown severity', () => {
    const result = parseInput(createIncidentSchema, {
      title: 'Smoke',
      description: 'Smoke near Machine 7',
      location: 'Zone 4',
      severity: 'catastrophic',
    });
    expect(result.ok).toBe(false);
  });

  it('caps memory search limit at 10', () => {
    const result = parseInput(memorySearchSchema, { query: 'machine 7', limit: 99 });
    expect(result.ok).toBe(false);
  });

  it('defaults memory search filters to an empty object', () => {
    const result = parseInput(memorySearchSchema, { query: 'machine 7' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.limit).toBe(3);
      expect(result.data.filters).toEqual({});
    }
  });

  it('rejects an unknown decision verb', () => {
    const result = parseInput(decisionSchema, { decision: 'maybe', decidedBy: 'A. Reyes' });
    expect(result.ok).toBe(false);
  });

  it('accepts a proposed action with a requester', () => {
    const result = parseInput(proposeActionSchema, {
      incidentId: '10000000-0000-4000-8000-000000000009',
      proposedAction: 'Restart Machine 7.',
      requestedBy: 'A. Reyes',
    });
    expect(result.ok).toBe(true);
  });
});

describe('structured Bedrock response validation', () => {
  const valid = {
    riskLevel: 'critical',
    recommendedAction: 'Isolate the shared pressure line before shutting down Machine 7.',
    explanation: 'A similar 2025 incident recorded pressure transfer to Machine 8.',
    confidence: 0.86,
    supportingMemoryIds: ['20000000-0000-4000-8000-000000000004'],
    potentialConsequences: ['Pressure transfer to the coupled machine.'],
    requiresHumanApproval: true,
    contradictions: [],
  };

  it('accepts a well-formed response', () => {
    expect(() => agentResponseSchema.parse(valid)).not.toThrow();
  });

  it('rejects an out-of-range confidence', () => {
    expect(() => agentResponseSchema.parse({ ...valid, confidence: 1.4 })).toThrow();
  });

  it('rejects an unknown risk level', () => {
    expect(() => agentResponseSchema.parse({ ...valid, riskLevel: 'extreme' })).toThrow();
  });

  it('rejects a missing requiresHumanApproval flag', () => {
    const { requiresHumanApproval: _omitted, ...withoutFlag } = valid;
    expect(() => agentResponseSchema.parse(withoutFlag)).toThrow();
  });

  it('defaults optional arrays so downstream code never sees undefined', () => {
    const parsed = agentResponseSchema.parse({
      riskLevel: 'low',
      recommendedAction: 'Keep monitoring.',
      explanation: 'No precedent retrieved.',
      confidence: 0.3,
      requiresHumanApproval: false,
    });
    expect(parsed.supportingMemoryIds).toEqual([]);
    expect(parsed.potentialConsequences).toEqual([]);
    expect(parsed.contradictions).toEqual([]);
  });

  it('validates a handoff briefing', () => {
    const parsed = handoffResponseSchema.parse({
      whatHappened: 'Smoke near Machine 7.',
      whatWasAttempted: ['Isolation approved.'],
      whatMustNotBeRepeated: ['Do not restart before isolation.'],
      currentRisks: ['Header still pressurized.'],
      unresolvedQuestions: ['Is the gauge at zero?'],
      recommendedNextAction: 'Verify the gauge reads zero.',
    });
    expect(parsed.whatMustNotBeRepeated).toHaveLength(1);
  });
});

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a markdown fence', () => {
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it('parses JSON wrapped in prose', () => {
    expect(extractJsonObject('Here is my answer:\n{"a":3}\nHope that helps.')).toEqual({ a: 3 });
  });

  it('throws when there is no JSON object at all', () => {
    expect(() => extractJsonObject('I cannot help with that.')).toThrow(/parseable JSON/);
  });
});
