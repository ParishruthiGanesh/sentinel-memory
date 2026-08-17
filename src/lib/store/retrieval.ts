/**
 * Pure retrieval helpers shared by both stores.
 *
 * Keeping filtering and diversification here (rather than inside the SQL or the
 * demo store) means the ranking rules the judge sees on screen are the same
 * rules covered by unit tests.
 */

import type { RetrievedMemory } from '@/lib/types';
import type { MemorySearchFilters } from '@/lib/store/types';

export interface FilterableMemory {
  incidentId: string | null;
  memoryType: string;
  severity: string | null;
  outcome: string | null;
  location?: string | null;
  incidentDate?: string | null;
  createdAt: string;
}

export interface FilterContext {
  filters?: MemorySearchFilters;
  excludeIncidentId?: string | null;
}

/**
 * Apply the Memory Explorer's structured filters. Semantic ranking happens
 * separately — these narrow the candidate set before (or alongside) it.
 */
export function applySearchFilters<T extends FilterableMemory>(
  memories: T[],
  context: FilterContext,
): T[] {
  const { filters = {}, excludeIncidentId } = context;

  return memories.filter((memory) => {
    if (excludeIncidentId && memory.incidentId === excludeIncidentId) return false;
    if (filters.severity && memory.severity !== filters.severity) return false;
    if (filters.memoryType && memory.memoryType !== filters.memoryType) return false;

    if (filters.location) {
      const haystack = (memory.location ?? '').toLowerCase();
      if (!haystack.includes(filters.location.toLowerCase())) return false;
    }

    if (filters.outcomeContains) {
      const haystack = (memory.outcome ?? '').toLowerCase();
      if (!haystack.includes(filters.outcomeContains.toLowerCase())) return false;
    }

    const timestamp = memory.incidentDate ?? memory.createdAt;
    if (filters.from && timestamp < filters.from) return false;
    // `to` is an inclusive upper bound on the date, so compare against the day's end.
    if (filters.to && timestamp > `${filters.to}T23:59:59.999Z`) return false;

    return true;
  });
}

/**
 * Take the top `limit` memories, allowing at most `maxPerIncident` from any one
 * source incident.
 *
 * Without this, four highly-similar memories from a single past incident crowd
 * out every other precedent — the responder sees one story instead of three.
 * Standing procedures (incidentId === null) are not capped against each other.
 */
export function diversifyByIncident(
  ranked: RetrievedMemory[],
  limit: number,
  maxPerIncident = 1,
): RetrievedMemory[] {
  if (maxPerIncident <= 0) return ranked.slice(0, limit);

  const perIncident = new Map<string, number>();
  const selected: RetrievedMemory[] = [];
  const deferred: RetrievedMemory[] = [];

  for (const memory of ranked) {
    if (selected.length >= limit) break;
    const key = memory.incidentId ?? `procedure:${memory.id}`;
    const used = perIncident.get(key) ?? 0;
    if (used >= maxPerIncident) {
      deferred.push(memory);
      continue;
    }
    perIncident.set(key, used + 1);
    selected.push(memory);
  }

  // If diversification left us short of `limit`, backfill with the best of the
  // ones we skipped rather than returning fewer results than asked for.
  for (const memory of deferred) {
    if (selected.length >= limit) break;
    selected.push(memory);
  }

  return selected;
}
