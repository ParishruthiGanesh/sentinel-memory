/**
 * Health-check redaction.
 *
 * `/api/health` must be safe to expose publicly: it may report *whether* things
 * are configured and their non-secret identifiers, but never a credential.
 * These tests set deliberately recognisable secret values and assert that none
 * of them can be found anywhere in the serialized output.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SECRETS = {
  DATABASE_URL:
    'postgresql://sentinel_user:SUPER-SECRET-PASSWORD@cluster-1234.aws-eu-west-1.cockroachlabs.cloud:26257/sentinel?sslmode=verify-full',
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY',
  AWS_SESSION_TOKEN: 'FQoGZXIvYXdzEXAMPLESESSIONTOKEN',
};

const SECRET_VALUES = [
  'SUPER-SECRET-PASSWORD',
  'sentinel_user',
  SECRETS.AWS_ACCESS_KEY_ID,
  SECRETS.AWS_SECRET_ACCESS_KEY,
  SECRETS.AWS_SESSION_TOKEN,
  SECRETS.DATABASE_URL,
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const [key, value] of Object.entries({
    ...SECRETS,
    AWS_REGION: 'eu-west-1',
    BEDROCK_MODEL_ID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
    DEMO_MODE: 'true',
  })) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('describeConfig redaction', () => {
  it('reports configuration status without exposing any secret value', async () => {
    const { describeConfig } = await import('@/lib/env');
    const serialized = JSON.stringify(describeConfig());

    for (const secret of SECRET_VALUES) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('reports only the host and port from the connection string', async () => {
    const { describeConfig } = await import('@/lib/env');
    const config = describeConfig();

    expect(config.database.configured).toBe(true);
    expect(config.database.host).toBe('cluster-1234.aws-eu-west-1.cockroachlabs.cloud:26257');
    expect(config.database.host).not.toContain('@');
    expect(config.database.host).not.toContain(':26257/sentinel');
  });

  it('reports non-secret Bedrock identifiers so operators can verify configuration', async () => {
    const { describeConfig } = await import('@/lib/env');
    const config = describeConfig();

    expect(config.bedrock.configured).toBe(true);
    expect(config.bedrock.region).toBe('eu-west-1');
    expect(config.bedrock.modelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
    expect(config.bedrock.embeddingModelId).toBe('amazon.titan-embed-text-v2:0');
    expect(config.bedrock.credentialSource).toBe('environment static credentials');
  });

  it('reports a malformed DSN as "configured" rather than echoing it back', async () => {
    process.env.DATABASE_URL = 'this-is-not-a-url-but-contains-SUPER-SECRET-PASSWORD';
    const { describeConfig } = await import('@/lib/env');
    const config = describeConfig();

    expect(config.database.host).toBe('configured');
    expect(JSON.stringify(config)).not.toContain('SUPER-SECRET-PASSWORD');
  });

  it('does not claim Bedrock is configured when the model id is missing', async () => {
    delete process.env.BEDROCK_MODEL_ID;
    const { describeConfig, hasBedrock } = await import('@/lib/env');

    expect(hasBedrock()).toBe(false);
    expect(describeConfig().bedrock.configured).toBe(false);
  });

  it('does not claim a database when DATABASE_URL is absent', async () => {
    delete process.env.DATABASE_URL;
    const { describeConfig, hasDatabase } = await import('@/lib/env');

    expect(hasDatabase()).toBe(false);
    expect(describeConfig().database.configured).toBe(false);
    expect(describeConfig().database.host).toBeNull();
  });

  it('treats whitespace-only values as unset rather than configured', async () => {
    process.env.DATABASE_URL = '   ';
    process.env.BEDROCK_MODEL_ID = '';
    const { hasBedrock, hasDatabase } = await import('@/lib/env');

    expect(hasDatabase()).toBe(false);
    expect(hasBedrock()).toBe(false);
  });
});

describe('runtime mode reporting', () => {
  it('never claims CockroachDB when no DSN is set', async () => {
    delete process.env.DATABASE_URL;
    const { runtimeMode } = await import('@/lib/api');

    expect(runtimeMode().store).toBe('in-memory-demo');
  });

  it('never claims Bedrock reasoning when no model is configured', async () => {
    delete process.env.BEDROCK_MODEL_ID;
    const { runtimeMode } = await import('@/lib/api');

    expect(runtimeMode().reasoning).toBe('local-heuristic');
  });

  it('reports demo mode independently of which backends are live', async () => {
    const { runtimeMode } = await import('@/lib/api');
    const mode = runtimeMode();

    expect(mode.demoMode).toBe(true);
    expect(mode.store).toBe('cockroachdb');
    expect(mode.embeddings).toBe('bedrock');
  });
});
