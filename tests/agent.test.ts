/**
 * Agent behaviour: the post-model safety floor, handoff-briefing construction
 * and the safety-rule contract.
 */

import { describe, expect, it } from 'vitest';
import {
  enforceSafetyFloor,
  HeuristicReasoner,
  isHighRiskPhysicalAction,
} from '@/lib/ai/reasoner';
import { buildRecommendationPrompt, buildHandoffPrompt, SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { SEED_SAFETY_RULES } from '@/lib/seed-data';
import type { AgentResponse } from '@/lib/validation';
import type { Incident, RetrievedMemory, SafetyRule } from '@/lib/types';

const incident: Incident = {
  id: '10000000-0000-4000-8000-000000000009',
  incidentCode: 'INC-2026-0817',
  title: 'Smoke detected near Machine 7',
  description: 'Smoke near Machine 7. Machine 7 shares a pressure header with Machine 8.',
  location: 'Assembly Plant · Zone 4',
  severity: 'critical',
  status: 'active',
  currentPhase: 'containment',
  assignedAgentId: null,
  createdAt: '2026-08-17T08:42:00.000Z',
  updatedAt: '2026-08-17T08:49:00.000Z',
};

const memory: RetrievedMemory = {
  id: '20000000-0000-4000-8000-000000000004',
  memoryEventId: null,
  incidentId: '10000000-0000-4000-8000-000000000001',
  incidentCode: 'INC-2025-0412',
  incidentTitle: 'Pressure transfer after premature Machine 7 restart',
  incidentDate: '2025-04-12T09:14:00.000Z',
  memoryType: 'lesson_learned',
  sourceText: 'Isolate the shared pressure line before restarting Machine 7.',
  actionTaken: 'Machine 7 was restarted before pressure isolation.',
  outcome: 'Secondary equipment damage near Machine 8. Eleven-hour operational shutdown.',
  lessonLearned:
    'Isolate and verify the shared pressure line before shutting down or restarting Machine 7.',
  severity: 'critical',
  createdAt: '2025-04-12T09:14:00.000Z',
  similarity: 0.94,
  distance: 0.06,
};

const rules: SafetyRule[] = SEED_SAFETY_RULES.map((rule) => ({
  ...rule,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

describe('high-risk action detection', () => {
  it.each([
    'Shut down Machine 7',
    'Restart the drive to clear the fault',
    'Restore power to Substation B',
    'Vent the header',
    'Enter Zone 4 to inspect',
    'Bypass the interlock',
  ])('flags "%s" as a high-risk physical action', (action) => {
    expect(isHighRiskPhysicalAction(action)).toBe(true);
  });

  it.each([
    'Continue monitoring the pressure gauge',
    'Record a further observation',
    'Notify the safety lead',
  ])('does not flag "%s"', (action) => {
    expect(isHighRiskPhysicalAction(action)).toBe(false);
  });
});

describe('post-model safety floor', () => {
  const base: AgentResponse = {
    riskLevel: 'low',
    recommendedAction: 'Restart Machine 7 to clear the fault.',
    explanation: 'Reasoning.',
    confidence: 0.9,
    supportingMemoryIds: [],
    potentialConsequences: [],
    requiresHumanApproval: false,
    contradictions: [],
  };

  it('forces human approval on a high-risk action even when the model said otherwise', () => {
    const result = enforceSafetyFloor(base, [memory]);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('forces human approval whenever the risk level is high or critical', () => {
    const result = enforceSafetyFloor(
      { ...base, recommendedAction: 'Keep monitoring.', riskLevel: 'critical' },
      [memory],
    );
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('leaves a genuinely low-risk, non-physical recommendation alone', () => {
    const result = enforceSafetyFloor(
      { ...base, recommendedAction: 'Continue monitoring the gauge.', riskLevel: 'low' },
      [memory],
    );
    expect(result.requiresHumanApproval).toBe(false);
  });

  it('drops citations for memories that were never retrieved', () => {
    const result = enforceSafetyFloor(
      { ...base, supportingMemoryIds: [memory.id, 'fabricated-memory-id'] },
      [memory],
    );
    expect(result.supportingMemoryIds).toEqual([memory.id]);
  });

  it('keeps every citation that was genuinely retrieved', () => {
    const result = enforceSafetyFloor({ ...base, supportingMemoryIds: [memory.id] }, [memory]);
    expect(result.supportingMemoryIds).toEqual([memory.id]);
  });
});

describe('safety rules', () => {
  it('includes a blocking rule that requires human approval for physical actions', () => {
    const rule = rules.find((candidate) => candidate.enforcementLevel === 'block');
    expect(rule).toBeDefined();
    expect(rule?.requiresHumanApproval).toBe(true);
  });

  it('states that emergency shutdown cannot be automated', () => {
    const rule = rules.find((candidate) => /emergency shutdown/i.test(candidate.name));
    expect(rule?.enforcementLevel).toBe('block');
    expect(rule?.requiresHumanApproval).toBe(true);
  });

  it('requires conflicting instructions to be escalated', () => {
    expect(rules.some((rule) => /conflicting/i.test(rule.name))).toBe(true);
  });

  it('records that all actions are audit logged', () => {
    expect(rules.some((rule) => /audit logged/i.test(rule.name))).toBe(true);
  });
});

describe('grounding prompt', () => {
  it('forbids fabrication and requires escalation when information is insufficient', () => {
    expect(SYSTEM_PROMPT).toMatch(/Never fabricate/i);
    expect(SYSTEM_PROMPT).toMatch(/recommend escalation/i);
    expect(SYSTEM_PROMPT).toMatch(/never state or imply that an external physical action/i);
    expect(SYSTEM_PROMPT).toMatch(/NOT guaranteed causal proof/i);
  });

  it('includes the retrieved memory ids so citations can be verified', () => {
    const prompt = buildRecommendationPrompt({
      incident,
      observations: [],
      memories: [memory],
      safetyRules: rules,
      trigger: 'Restart Machine 7 now.',
      triggerKind: 'proposed_action',
    });

    expect(prompt).toContain(`MEMORY ID: ${memory.id}`);
    expect(prompt).toContain(memory.outcome!);
    expect(prompt).toContain('ACTION THE RESPONDER IS CONSIDERING');
    expect(prompt).toContain(incident.incidentCode);
  });

  it('says plainly when no memory was retrieved instead of leaving the section blank', () => {
    const prompt = buildRecommendationPrompt({
      incident,
      observations: [],
      memories: [],
      safetyRules: rules,
      trigger: 'Something new happened.',
      triggerKind: 'observation',
    });
    expect(prompt).toContain('no sufficiently similar memories were retrieved');
  });
});

describe('handoff briefing construction', () => {
  const reasoner = new HeuristicReasoner();

  it('carries rejected actions into "what must not be repeated"', async () => {
    const summary = await reasoner.handoff({
      incident,
      events: [],
      memories: [memory],
      decisions: [
        {
          decision: 'rejected',
          action: 'Restart Machine 7 immediately.',
          decidedBy: 'A. Reyes',
          reason: 'Pressure not verified.',
        },
      ],
      safetyRules: rules,
      fromAgent: 'Sentinel Primary',
      toAgent: 'Sentinel Backup',
    });

    expect(summary.whatMustNotBeRepeated.some((item) => /Restart Machine 7/.test(item))).toBe(true);
  });

  it('carries a historical consequence into "what must not be repeated"', async () => {
    const summary = await reasoner.handoff({
      incident,
      events: [],
      memories: [memory],
      decisions: [],
      safetyRules: rules,
      fromAgent: 'Sentinel Primary',
      toAgent: 'Sentinel Backup',
    });

    expect(
      summary.whatMustNotBeRepeated.some((item) => item.includes('INC-2025-0412')),
    ).toBe(true);
  });

  it('states the incident identity, severity and status in "what happened"', async () => {
    const summary = await reasoner.handoff({
      incident,
      events: [],
      memories: [],
      decisions: [],
      safetyRules: rules,
      fromAgent: 'Sentinel Primary',
      toAgent: 'Sentinel Backup',
    });

    expect(summary.whatHappened).toContain('INC-2026-0817');
    expect(summary.whatHappened).toContain('critical');
    expect(summary.whatHappened).toContain('containment');
  });

  it('recommends the retrieved lesson as the next action when one exists', async () => {
    const summary = await reasoner.handoff({
      incident,
      events: [],
      memories: [memory],
      decisions: [],
      safetyRules: rules,
      fromAgent: 'Sentinel Primary',
      toAgent: 'Sentinel Backup',
    });

    expect(summary.recommendedNextAction).toBe(memory.lessonLearned);
  });

  it('says nothing was attempted rather than inventing history', async () => {
    const summary = await reasoner.handoff({
      incident,
      events: [],
      memories: [],
      decisions: [],
      safetyRules: rules,
      fromAgent: 'Sentinel Primary',
      toAgent: 'Sentinel Backup',
    });

    expect(summary.whatWasAttempted).toEqual(['No actions have been approved yet.']);
    expect(summary.whatMustNotBeRepeated[0]).toMatch(/No prohibited actions/);
  });

  it('names both agents in the handoff prompt', () => {
    const prompt = buildHandoffPrompt({
      incident,
      events: [],
      memories: [memory],
      decisions: [],
      safetyRules: rules,
      fromAgent: 'Sentinel Primary',
      toAgent: 'Sentinel Backup',
    });
    expect(prompt).toContain('Sentinel Primary -> Sentinel Backup');
  });
});

describe('offline reasoner grounding', () => {
  const reasoner = new HeuristicReasoner();

  it('recommends the retrieved lesson and always requires human approval', async () => {
    const response = await reasoner.recommend({
      incident,
      observations: [],
      memories: [memory],
      safetyRules: rules,
      trigger: 'Shut down and restart Machine 7 immediately to stop the smoke.',
      triggerKind: 'proposed_action',
    });

    expect(response.recommendedAction).toBe(memory.lessonLearned);
    expect(response.requiresHumanApproval).toBe(true);
    expect(response.riskLevel).toBe('critical');
    expect(response.supportingMemoryIds).toContain(memory.id);
    expect(response.potentialConsequences).toContain(memory.outcome);
  });

  it('escalates instead of inventing a procedure when nothing was retrieved', async () => {
    const response = await reasoner.recommend({
      incident,
      observations: [],
      memories: [],
      safetyRules: rules,
      trigger: 'Restart Machine 7.',
      triggerKind: 'proposed_action',
    });

    expect(response.recommendedAction).toMatch(/escalate/i);
    expect(response.explanation).toMatch(/no sufficiently similar memory/i);
    expect(response.confidence).toBeLessThan(0.5);
  });
});
