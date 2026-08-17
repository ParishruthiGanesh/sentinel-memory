-- =============================================================================
-- Sentinel Memory — CockroachDB Distributed Vector Index
--
-- This migration is deliberately ISOLATED from 001_init.sql because vector
-- index support is version-gated:
--
--   * CockroachDB v25.2 — vector indexes ship in preview and require the
--     cluster setting `feature.vector_index.enabled = true`.
--   * CockroachDB v25.3+ — generally available; no cluster setting needed.
--
-- If this migration fails, the application still works: the `<=>` cosine
-- distance operator falls back to an exact scan over memory_embeddings. With a
-- seeded corpus of a few dozen memories that is fast, but it does not scale,
-- and /api/health will report `vectorIndexPresent: false`.
--
-- scripts/migrate.ts runs this file separately and reports a clear message
-- rather than aborting the whole migration.
-- =============================================================================

-- Preview-gate for v25.2. Harmless (and skipped by the migrate script) when the
-- setting does not exist on the running cluster version.
-- SET CLUSTER SETTING feature.vector_index.enabled = true;

-- Cosine distance matches the `<=>` operator used by CockroachStore.searchMemories
-- and the unit-normalized vectors produced by the embedding providers.
CREATE VECTOR INDEX IF NOT EXISTS memory_embeddings_embedding_cosine_idx
    ON memory_embeddings (embedding vector_cosine_ops);
