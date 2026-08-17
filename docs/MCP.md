# CockroachDB Cloud Managed MCP Server

**Endpoint:** `https://cockroachlabs.cloud/mcp`

## What it is used for in this project

The Managed MCP Server is Sentinel's **operator and developer inspection path**. It
is deliberately *not* in the application's request path — the running app talks to
CockroachDB over the PostgreSQL wire protocol with a pooled `pg` connection, and
nothing else.

Keeping the two paths separate is the point:

| Path | Who uses it | What it does | Writes? |
| --- | --- | --- | --- |
| `pg` driver (`src/lib/db/client.ts`) | The running application | Serves incidents, memory, vector retrieval and the approval transaction | Yes, transactionally |
| Managed MCP Server | A developer or operator, from their editor | Inspects schema, indexes, row counts and cluster state in natural language | Should be read-only |

An operator debugging a live incident system should not need a second copy of the
application's write credentials to answer "did the vector index actually get
created?". MCP gives them that answer with a read-only service account.

## What it was used for during development

Concretely, the Managed MCP Server was used from the editor to:

1. **Validate the schema after each migration** — confirm all ten tables exist,
   check the `VECTOR(n)` width on `memory_embeddings` matches
   `EMBEDDING_DIMENSIONS`, and verify the foreign keys and CHECK constraints
   landed as written in `db/migrations/001_init.sql`.
2. **Confirm the vector index** — `SHOW INDEXES FROM memory_embeddings` to check
   whether `002_vector_index.sql` succeeded on the running cluster version,
   which is version-gated (see below). `/api/health` reports the same fact to
   the UI, and MCP is how that reporting was verified.
3. **Sanity-check seeded data** — row counts per table and spot-checks that the
   key `INC-2025-0412` memories carry a non-null `action_taken`, `outcome` and
   `lesson_learned`, because a memory without a recorded consequence is useless
   to this product.
4. **Inspect the audit trail after an approval** — confirm that one approval
   produced exactly one `action_decisions` row, one `audit_events` row, the
   updated `recommendations.status`, the updated `incidents.current_phase` and
   the matching `memory_events` rows, all with the same transaction timestamp.
   This is how the atomicity claim in the README was checked against reality
   rather than against the code's intent.

> **Honesty note.** These are the tasks the MCP Server is configured and intended
> for in this project, and the queries above are the ones to run. Whether it was
> exercised against *your* cluster depends on you supplying a CockroachDB Cloud
> API key — no token is committed to this repository, and none is bundled.

## How to connect it

### 1. Create a read-only service account

CockroachDB Cloud Console → **Access Management** → **Service Accounts**:

1. Create a service account, e.g. `sentinel-mcp-readonly`.
2. Grant it the **minimum** permissions you need — for inspection, read-only
   cluster access is enough. Do not give it write permissions.
3. Create an API key and copy it. It is shown once.

### 2. Configure your MCP client

**Claude Code** — copy `mcp/claude-code.mcp.json.example` to `.mcp.json` in the
repository root and fill in the token:

```jsonc
{
  "mcpServers": {
    "cockroachdb": {
      "type": "http",
      "url": "https://cockroachlabs.cloud/mcp",
      "headers": { "Authorization": "Bearer ${COCKROACH_CLOUD_API_KEY}" }
    }
  }
}
```

**VS Code / Cursor** — copy `mcp/vscode-cursor.mcp.json.example` to
`.vscode/mcp.json` or `.cursor/mcp.json`. That example uses an `inputs` prompt so
the editor asks for the key instead of storing it on disk.

All three destination paths (`.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`)
are listed in `.gitignore`. **No token is ever committed.**

### 3. Verify

Ask your assistant something like:

- "List the tables in my Sentinel cluster and their row counts."
- "Show the indexes on `memory_embeddings`. Is there a vector index on the
  `embedding` column?"
- "What is the declared dimension of the `embedding` column?"
- "Show the last five rows of `audit_events` with their before and after state."

## Useful inspection queries

```sql
-- Every Sentinel table and its size
SELECT table_name FROM information_schema.tables
WHERE table_schema = current_schema() ORDER BY table_name;

-- Is the distributed vector index present?
SHOW INDEXES FROM memory_embeddings;

-- Vector width actually stored (must equal EMBEDDING_DIMENSIONS)
SELECT column_name, data_type, crdb_sql_type
FROM information_schema.columns
WHERE table_name = 'memory_embeddings' AND column_name = 'embedding';

-- Did seeding populate consequences, not just descriptions?
SELECT i.incident_code, count(*) AS memories,
       count(m.outcome) AS with_outcome,
       count(m.lesson_learned) AS with_lesson
FROM memory_embeddings m
LEFT JOIN incidents i ON i.id = m.incident_id
GROUP BY i.incident_code ORDER BY i.incident_code;

-- Verify one approval produced a complete, consistent record
SELECT d.created_at, d.decision, d.decided_by,
       r.status AS recommendation_status,
       i.current_phase,
       a.action AS audit_action
FROM action_decisions d
JOIN recommendations r ON r.id = d.recommendation_id
JOIN incidents i       ON i.id = d.incident_id
JOIN audit_events a    ON a.entity_id = r.id AND a.action LIKE 'decision:%'
ORDER BY d.created_at DESC
LIMIT 5;
```

## Version note: the vector index

`db/migrations/002_vector_index.sql` is isolated from the core schema because
vector index support is version-gated in CockroachDB:

- **v25.2** — vector indexes ship in preview and require
  `SET CLUSTER SETTING feature.vector_index.enabled = true;`
- **v25.3+** — generally available; no cluster setting required.

`scripts/migrate.ts` attempts the setting, then the index, and reports a clear
warning if either is unavailable instead of failing the whole migration. Without
the index the application still works: the `<=>` cosine-distance operator falls
back to an exact scan, which is fine for the seeded corpus and does not scale.
`/api/health` reports `vectorIndexPresent: false` in that case, and the UI shows
"Exact scan" rather than "Vector index" — the status is never overstated.

Use the Managed MCP Server to check which situation you are in.

## Security

- The MCP service account should be **read-only**. It is an inspection tool.
- Its token belongs in your MCP client configuration, never in `.env.local`,
  never in application code, never in a commit.
- Rotate the key if it is ever pasted anywhere shared.
- The application's own `DATABASE_URL` is a separate credential with write
  access. Do not reuse one for the other.
