/**
 * Transaction behaviour.
 *
 * `withTransaction` is exercised against a fake pg client so the retry and
 * rollback semantics are covered without a live cluster — which is the point of
 * having a store abstraction in the first place.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { isRetryable, withTransaction, toVectorLiteral } from '@/lib/db/client';
import { DemoStore } from '@/lib/store/demo-store';
import { ConflictError, NotFoundError } from '@/lib/store/types';
import { ACTIVE_INCIDENT_ID } from '@/lib/seed-data';

/** Minimal pg client double that records every statement it is given. */
function fakeClient(behaviour: (sql: string, call: number) => unknown = () => undefined) {
  const statements: string[] = [];
  let calls = 0;
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql.trim().split('\n')[0].trim());
      calls += 1;
      const result = behaviour(sql, calls);
      if (result instanceof Error) throw result;
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { client: client as unknown as PoolClient, statements, raw: client };
}

function serializationError() {
  return Object.assign(new Error('restart transaction: TransactionRetryWithProtoRefreshError'), {
    code: '40001',
  });
}

const noSleep = async () => {};

describe('withTransaction', () => {
  it('wraps the unit of work in BEGIN/COMMIT', async () => {
    const { client, statements } = fakeClient();
    const result = await withTransaction(async () => 'done', {
      connect: async () => client,
      sleep: noSleep,
    });

    expect(result).toBe('done');
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back and rethrows on a non-retryable failure', async () => {
    const { client, statements, raw } = fakeClient();
    const boom = Object.assign(new Error('null value violates not-null constraint'), {
      code: '23502',
    });

    await expect(
      withTransaction(
        async () => {
          throw boom;
        },
        { connect: async () => client, sleep: noSleep },
      ),
    ).rejects.toThrow('null value violates not-null constraint');

    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(statements).not.toContain('COMMIT');
    expect(raw.release).toHaveBeenCalledTimes(1);
  });

  it('retries the whole transaction on SQLSTATE 40001 and eventually commits', async () => {
    const { client, statements } = fakeClient();
    let attempts = 0;

    const result = await withTransaction(
      async () => {
        attempts += 1;
        if (attempts < 3) throw serializationError();
        return attempts;
      },
      { connect: async () => client, sleep: noSleep },
    );

    expect(result).toBe(3);
    expect(attempts).toBe(3);
    expect(statements.filter((sql) => sql === 'ROLLBACK')).toHaveLength(2);
    expect(statements.filter((sql) => sql === 'COMMIT')).toHaveLength(1);
  });

  it('gives up after maxAttempts and leaves nothing committed', async () => {
    const { client, statements } = fakeClient();

    await expect(
      withTransaction(
        async () => {
          throw serializationError();
        },
        { connect: async () => client, sleep: noSleep, maxAttempts: 3 },
      ),
    ).rejects.toThrow(/restart transaction/);

    expect(statements.filter((sql) => sql === 'ROLLBACK')).toHaveLength(3);
    expect(statements).not.toContain('COMMIT');
  });

  it('releases the client on every attempt, including failures', async () => {
    const releases: number[] = [];
    let attempt = 0;
    const connect = async () => {
      attempt += 1;
      const current = attempt;
      return {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
        release: vi.fn(() => releases.push(current)),
      } as unknown as PoolClient;
    };

    let calls = 0;
    await withTransaction(
      async () => {
        calls += 1;
        if (calls === 1) throw serializationError();
        return 'ok';
      },
      { connect, sleep: noSleep },
    );

    expect(releases).toEqual([1, 2]);
  });

  it('classifies retryable codes correctly', () => {
    expect(isRetryable({ code: '40001' })).toBe(true);
    expect(isRetryable({ code: '40003' })).toBe(true);
    expect(isRetryable({ code: '23505' })).toBe(false);
    expect(isRetryable(new Error('plain error'))).toBe(false);
  });
});

describe('vector literal formatting', () => {
  it('renders a pg-compatible VECTOR literal', () => {
    expect(toVectorLiteral([1, -0.5, 0])).toBe('[1.000000,-0.500000,0.000000]');
  });

  it('substitutes zero for non-finite components rather than emitting NaN', () => {
    expect(toVectorLiteral([Number.NaN, Infinity])).toBe('[0,0]');
  });
});

describe('recommendation approval is all-or-nothing', () => {
  async function seedPendingRecommendation(store: DemoStore) {
    return store.createRecommendation({
      incidentId: ACTIVE_INCIDENT_ID,
      proposedAction: 'Isolate the shared pressure line before shutting down Machine 7.',
      explanation: 'A 2025 incident recorded pressure transfer to Machine 8.',
      confidence: 0.86,
      riskLevel: 'critical',
      retrievedMemoryIds: ['20000000-0000-4000-8000-000000000004'],
      potentialConsequences: ['Pressure transfer to Machine 8.'],
      requiresHumanApproval: true,
      provider: 'test',
    });
  }

  it('writes the decision, status, incident state and audit event together', async () => {
    const store = new DemoStore();
    const recommendation = await seedPendingRecommendation(store);

    const before = await store.getIncident(ACTIVE_INCIDENT_ID);
    const outcome = await store.decideRecommendation({
      recommendationId: recommendation.id,
      decision: 'approved',
      decidedBy: 'A. Reyes (Shift Lead)',
      reason: 'Gauge confirmed at zero.',
      nextPhase: 'stabilization',
    });

    expect(outcome.decision.decision).toBe('approved');
    expect(outcome.recommendation.status).toBe('approved');
    expect(outcome.recommendation.decidedAt).not.toBeNull();
    expect(outcome.incident.currentPhase).toBe('stabilization');
    expect(outcome.auditEvent.action).toBe('decision:approved');
    expect(outcome.auditEvent.beforeState).toMatchObject({ phase: before?.currentPhase });
    expect(outcome.auditEvent.afterState).toMatchObject({
      phase: 'stabilization',
      recommendationStatus: 'approved',
    });

    // The durable memory events land in the same unit of work.
    const events = await store.listMemoryEvents(ACTIVE_INCIDENT_ID);
    expect(events.some((event) => event.eventType === 'human_decision')).toBe(true);
    expect(events.some((event) => event.eventType === 'state_change')).toBe(true);

    const audit = await store.listAuditEvents(ACTIVE_INCIDENT_ID);
    expect(audit.some((entry) => entry.id === outcome.auditEvent.id)).toBe(true);
  });

  it('rolls back completely when the recommendation does not exist', async () => {
    const store = new DemoStore();
    const incidentBefore = await store.getIncident(ACTIVE_INCIDENT_ID);
    const eventsBefore = await store.listMemoryEvents(ACTIVE_INCIDENT_ID);
    const auditBefore = await store.listAuditEvents(ACTIVE_INCIDENT_ID);

    await expect(
      store.decideRecommendation({
        recommendationId: '99999999-0000-4000-8000-000000000000',
        decision: 'approved',
        decidedBy: 'A. Reyes',
        nextPhase: 'recovery',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Nothing moved: no partial write escaped.
    const incidentAfter = await store.getIncident(ACTIVE_INCIDENT_ID);
    expect(incidentAfter).toEqual(incidentBefore);
    expect(await store.listMemoryEvents(ACTIVE_INCIDENT_ID)).toHaveLength(eventsBefore.length);
    expect(await store.listAuditEvents(ACTIVE_INCIDENT_ID)).toHaveLength(auditBefore.length);
    expect(await store.listDecisions(ACTIVE_INCIDENT_ID)).toHaveLength(0);
  });

  it('refuses to decide the same recommendation twice', async () => {
    const store = new DemoStore();
    const recommendation = await seedPendingRecommendation(store);

    await store.decideRecommendation({
      recommendationId: recommendation.id,
      decision: 'approved',
      decidedBy: 'A. Reyes',
    });

    const incidentAfterFirst = await store.getIncident(ACTIVE_INCIDENT_ID);
    const decisionsAfterFirst = await store.listDecisions(ACTIVE_INCIDENT_ID);

    await expect(
      store.decideRecommendation({
        recommendationId: recommendation.id,
        decision: 'rejected',
        decidedBy: 'Someone else',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // The conflicting attempt changed nothing.
    expect(await store.getIncident(ACTIVE_INCIDENT_ID)).toEqual(incidentAfterFirst);
    expect(await store.listDecisions(ACTIVE_INCIDENT_ID)).toHaveLength(decisionsAfterFirst.length);
  });

  it('does not advance the incident phase on rejection', async () => {
    const store = new DemoStore();
    const recommendation = await seedPendingRecommendation(store);
    const before = await store.getIncident(ACTIVE_INCIDENT_ID);

    const outcome = await store.decideRecommendation({
      recommendationId: recommendation.id,
      decision: 'rejected',
      decidedBy: 'A. Reyes',
      reason: 'Pressure not yet verified.',
      nextPhase: 'recovery',
    });

    expect(outcome.recommendation.status).toBe('rejected');
    expect(outcome.incident.currentPhase).toBe(before?.currentPhase);
  });

  it('supersedes an earlier pending recommendation when a new one arrives', async () => {
    const store = new DemoStore();
    const first = await seedPendingRecommendation(store);
    await seedPendingRecommendation(store);

    const refreshed = await store.getRecommendation(first.id);
    expect(refreshed?.status).toBe('superseded');
  });
});
