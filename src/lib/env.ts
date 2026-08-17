/**
 * Server-side environment access.
 *
 * This module must never be imported from a `'use client'` component: it reads
 * raw secrets. Everything here runs in API routes, server components, and the
 * migrate/seed scripts. The only values that ever cross the network boundary
 * are the redacted booleans and non-secret identifiers from `describeConfig()`.
 *
 * No `NEXT_PUBLIC_*` variable is used anywhere in this project, so no secret can
 * be inlined into the client bundle.
 */

function str(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function int(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = str(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export const env = {
  // --- CockroachDB ---------------------------------------------------------
  get databaseUrl() {
    return str('DATABASE_URL');
  },

  // --- Amazon Bedrock ------------------------------------------------------
  get awsRegion() {
    return str('AWS_REGION') ?? str('AWS_DEFAULT_REGION');
  },
  get awsAccessKeyId() {
    return str('AWS_ACCESS_KEY_ID');
  },
  get awsSecretAccessKey() {
    return str('AWS_SECRET_ACCESS_KEY');
  },
  get awsSessionToken() {
    return str('AWS_SESSION_TOKEN');
  },
  get bedrockModelId() {
    return str('BEDROCK_MODEL_ID');
  },
  get bedrockEmbeddingModelId() {
    return str('BEDROCK_EMBEDDING_MODEL_ID');
  },

  // --- Application ---------------------------------------------------------
  /**
   * Vector width stored in CockroachDB. Must match the configured embedding
   * model (Titan Text Embeddings V2 = 1024, Cohere Embed English v3 = 1024).
   * The migration is templated with this value.
   */
  get embeddingDimensions() {
    return int('EMBEDDING_DIMENSIONS', 1024);
  },
  get demoMode() {
    return bool('DEMO_MODE', false);
  },
  get maxContentLength() {
    return int('MAX_CONTENT_LENGTH', 2000);
  },
  get rateLimitPerMinute() {
    return int('RATE_LIMIT_PER_MINUTE', 60);
  },
  get defaultResponder() {
    return str('DEFAULT_RESPONDER') ?? 'A. Reyes (Shift Lead)';
  },
} as const;

/** True when a real CockroachDB connection string is present. */
export function hasDatabase(): boolean {
  return Boolean(env.databaseUrl);
}

/**
 * True when Bedrock text generation can be attempted. We require an explicit
 * model id plus a region; credentials may also come from the ambient AWS
 * provider chain (instance role, SSO profile), so they are not required here.
 */
export function hasBedrock(): boolean {
  return Boolean(env.bedrockModelId && env.awsRegion);
}

/** True when a Bedrock embedding model has been configured. */
export function hasBedrockEmbeddings(): boolean {
  return Boolean(env.bedrockEmbeddingModelId && env.awsRegion);
}

/** True when explicit static credentials were supplied via env vars. */
export function hasStaticAwsCredentials(): boolean {
  return Boolean(env.awsAccessKeyId && env.awsSecretAccessKey);
}

/**
 * Redacted configuration description. Safe to return from `/api/health` and to
 * serialize into the client — contains booleans and non-secret identifiers only.
 */
export function describeConfig() {
  return {
    database: {
      configured: hasDatabase(),
      driver: 'pg (PostgreSQL wire protocol)',
      // Host only — never the user, password or full DSN.
      host: hasDatabase() ? safeHost(env.databaseUrl!) : null,
    },
    bedrock: {
      configured: hasBedrock(),
      region: env.awsRegion ?? null,
      modelId: env.bedrockModelId ?? null,
      embeddingModelId: env.bedrockEmbeddingModelId ?? null,
      embeddingsConfigured: hasBedrockEmbeddings(),
      credentialSource: hasStaticAwsCredentials()
        ? 'environment static credentials'
        : 'default AWS provider chain',
    },
    app: {
      demoMode: env.demoMode,
      embeddingDimensions: env.embeddingDimensions,
      maxContentLength: env.maxContentLength,
    },
  };
}

/** Extract just the hostname from a DSN so health output leaks no credentials. */
export function safeHost(dsn: string): string {
  try {
    const url = new URL(dsn);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return 'configured';
  }
}
