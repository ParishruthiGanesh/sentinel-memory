/**
 * Store selection.
 *
 * CockroachDB is used whenever DATABASE_URL is configured — including in demo
 * mode, because DEMO_MODE only controls seeded content and UI affordances, not
 * which backend is real. The in-memory store is used only when there is no
 * database to talk to, and it always identifies itself as such.
 *
 * The instance is held on `globalThis` rather than in a module-level variable.
 * Next.js compiles Route Handlers and Server Components into separate bundles,
 * so a plain module singleton is instantiated *twice* — once per bundle. With
 * CockroachDB that is harmless (two pools, one source of truth). With the
 * in-memory store it is a correctness bug: an approval written through
 * `/api/recommendations/:id/decision` would be invisible to the server-rendered
 * timeline, because the page would be reading a different, freshly-seeded store.
 *
 * Pinning it to the global object gives both bundles the same instance. The
 * connection pool in `db/client.ts` is likewise per-bundle but self-managing, so
 * only the store needs this treatment.
 */

import { hasDatabase } from '@/lib/env';
import type { DataStore } from '@/lib/store/types';
import { CockroachStore } from '@/lib/store/cockroach-store';
import { DemoStore } from '@/lib/store/demo-store';

const globalScope = globalThis as typeof globalThis & {
  __sentinelMemoryStore?: DataStore;
};

export function getStore(): DataStore {
  if (!globalScope.__sentinelMemoryStore) {
    globalScope.__sentinelMemoryStore = hasDatabase() ? new CockroachStore() : new DemoStore();
  }
  return globalScope.__sentinelMemoryStore;
}

/** Test seam — lets a suite swap in a store without touching the environment. */
export function setStore(next: DataStore | null): void {
  globalScope.__sentinelMemoryStore = next ?? undefined;
}

export type { DataStore } from '@/lib/store/types';
