import { describe, expect, it } from 'vitest';
import { applySearchFilters, diversifyByIncident } from '@/lib/store/retrieval';
import {
  cosineSimilarity,
  deterministicEmbed,
  LocalDeterministicEmbeddingProvider,
  normalize,
  tokenize,
} from '@/lib/ai/embeddings';
import { DemoStore } from '@/lib/store/demo-store';
import { KEY_HISTORICAL_INCIDENT_ID, ACTIVE_INCIDENT_ID } from '@/lib/seed-data';
import type { RetrievedMemory } from '@/lib/types';

const DIM = 256;

function memory(overrides: Partial<RetrievedMemory> & { id: string }): RetrievedMemory {
  return {
    memoryEventId: null,
    incidentId: null,
    incidentCode: 'INC-TEST',
    incidentTitle: 'Test',
    incidentDate: '2025-01-01T00:00:00.000Z',
    memoryType: 'incident_summary',
    sourceText: 'text',
    actionTaken: null,
    outcome: null,
    lessonLearned: null,
    severity: 'high',
    createdAt: '2025-01-01T00:00:00.000Z',
    similarity: 0.5,
    distance: 0.5,
    ...overrides,
  };
}

describe('embedding provider', () => {
  it('produces vectors of the configured width', async () => {
    const provider = new LocalDeterministicEmbeddingProvider(DIM);
    const vector = await provider.embed('Machine 7 restart before pressure isolation');
    expect(vector).toHaveLength(DIM);
  });

  it('is deterministic across calls', () => {
    const a = deterministicEmbed('smoke near machine 7', DIM);
    const b = deterministicEmbed('smoke near machine 7', DIM);
    expect(a).toEqual(b);
  });

  it('scores related text above unrelated text', () => {
    const query = deterministicEmbed(
      'Machine 7 restarted before the shared pressure line was isolated',
      DIM,
    );
    const related = deterministicEmbed(
      'The responder restarted Machine 7 before pressure isolation and pressure transferred to Machine 8',
      DIM,
    );
    const unrelated = deterministicEmbed(
      'Palletized stock blocked the east corridor emergency exit during a night shift',
      DIM,
    );
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });

  it('normalizes to unit length', () => {
    const vector = normalize([3, 4]);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
  });

  it('returns a zero vector for text with no content tokens', () => {
    const vector = deterministicEmbed('the and of to', DIM);
    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it('drops stop words when tokenizing', () => {
    expect(tokenize('The pressure in the header was rising')).toEqual([
      'pressure',
      'header',
      'rising',
    ]);
  });

  it('rejects a length mismatch rather than scoring nonsense', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/length mismatch/);
  });
});

describe('applySearchFilters', () => {
  const rows = [
    {
      incidentId: 'a',
      memoryType: 'incident_summary',
      severity: 'critical',
      outcome: 'Secondary valve damage near Machine 8',
      location: 'Assembly Plant, Zone 4',
      incidentDate: '2025-04-12T00:00:00.000Z',
      createdAt: '2025-04-12T00:00:00.000Z',
    },
    {
      incidentId: 'b',
      memoryType: 'lesson_learned',
      severity: 'low',
      outcome: 'No hazard present',
      location: 'Assembly Plant, Zone 3',
      incidentDate: '2025-07-09T00:00:00.000Z',
      createdAt: '2025-07-09T00:00:00.000Z',
    },
  ];

  it('filters by severity', () => {
    expect(applySearchFilters(rows, { filters: { severity: 'critical' } })).toHaveLength(1);
  });

  it('filters by memory type', () => {
    const result = applySearchFilters(rows, { filters: { memoryType: 'lesson_learned' } });
    expect(result[0].incidentId).toBe('b');
  });

  it('filters by location substring, case insensitively', () => {
    expect(applySearchFilters(rows, { filters: { location: 'zone 4' } })).toHaveLength(1);
  });

  it('filters by outcome substring', () => {
    expect(applySearchFilters(rows, { filters: { outcomeContains: 'valve' } })).toHaveLength(1);
  });

  it('treats the `to` bound as inclusive of the whole day', () => {
    const result = applySearchFilters(rows, { filters: { to: '2025-04-12' } });
    expect(result).toHaveLength(1);
    expect(result[0].incidentId).toBe('a');
  });

  it('excludes the live incident so it cannot retrieve itself', () => {
    expect(applySearchFilters(rows, { excludeIncidentId: 'a' })).toHaveLength(1);
  });
});

describe('diversifyByIncident', () => {
  const ranked = [
    memory({ id: '1', incidentId: 'a', similarity: 0.9 }),
    memory({ id: '2', incidentId: 'a', similarity: 0.88 }),
    memory({ id: '3', incidentId: 'a', similarity: 0.85 }),
    memory({ id: '4', incidentId: 'b', similarity: 0.6 }),
    memory({ id: '5', incidentId: 'c', similarity: 0.4 }),
  ];

  it('returns one memory per incident by default', () => {
    const result = diversifyByIncident(ranked, 3, 1);
    expect(result.map((item) => item.incidentId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the highest-scoring memory from each incident', () => {
    expect(diversifyByIncident(ranked, 3, 1)[0].id).toBe('1');
  });

  it('honours a higher per-incident cap', () => {
    const result = diversifyByIncident(ranked, 3, 2);
    expect(result.map((item) => item.id)).toEqual(['1', '2', '4']);
  });

  it('backfills rather than returning fewer results than requested', () => {
    const single = [
      memory({ id: '1', incidentId: 'a', similarity: 0.9 }),
      memory({ id: '2', incidentId: 'a', similarity: 0.8 }),
      memory({ id: '3', incidentId: 'a', similarity: 0.7 }),
    ];
    expect(diversifyByIncident(single, 3, 1)).toHaveLength(3);
  });

  it('does not cap standing procedures against each other', () => {
    const procedures = [
      memory({ id: 'p1', incidentId: null, similarity: 0.9 }),
      memory({ id: 'p2', incidentId: null, similarity: 0.8 }),
    ];
    expect(diversifyByIncident(procedures, 2, 1)).toHaveLength(2);
  });
});

describe('similar-memory retrieval over the seeded corpus', () => {
  it('surfaces the Machine 7 pressure-transfer incident for a Machine 7 restart query', async () => {
    const store = new DemoStore();
    const provider = new LocalDeterministicEmbeddingProvider(1024);
    const vector = await provider.embed(
      'Smoke detected near Machine 7. The responder is considering restarting Machine 7 to clear the fault.',
    );

    const { memories, memoriesSearched } = await store.searchMemories(vector, {
      limit: 3,
      excludeIncidentId: ACTIVE_INCIDENT_ID,
    });

    expect(memoriesSearched).toBeGreaterThan(0);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].incidentId).toBe(KEY_HISTORICAL_INCIDENT_ID);
    expect(memories[0].incidentCode).toBe('INC-2025-0412');
    // The retrieved memory must carry the consequence, not just the description.
    expect(memories[0].outcome).toMatch(/Machine 8/);
    expect(memories[0].lessonLearned).toMatch(/isolate/i);
  });

  it('never returns the live incident as its own precedent', async () => {
    const store = new DemoStore();
    const provider = new LocalDeterministicEmbeddingProvider(1024);
    const vector = await provider.embed('Smoke detected near Machine 7 in Assembly Plant Zone 4');

    const { memories } = await store.searchMemories(vector, {
      limit: 5,
      excludeIncidentId: ACTIVE_INCIDENT_ID,
    });

    expect(memories.every((item) => item.incidentId !== ACTIVE_INCIDENT_ID)).toBe(true);
  });

  it('ranks by similarity descending', async () => {
    const store = new DemoStore();
    const provider = new LocalDeterministicEmbeddingProvider(1024);
    const vector = await provider.embed('chemical vapour spread after ventilation was increased');

    const { memories } = await store.searchMemories(vector, { limit: 4 });
    const scores = memories.map((item) => item.similarity);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('reports similarity as the complement of cosine distance', async () => {
    const store = new DemoStore();
    const provider = new LocalDeterministicEmbeddingProvider(1024);
    const vector = await provider.embed('restricted zone entry during lockout');

    const { memories } = await store.searchMemories(vector, { limit: 2 });
    for (const item of memories) {
      expect(item.similarity + item.distance).toBeCloseTo(1, 6);
    }
  });
});
