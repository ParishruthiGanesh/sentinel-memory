/**
 * Embedding provider abstraction.
 *
 * Sentinel needs a vector for every memory it stores and every query it runs.
 * Which model produces that vector is an implementation detail: the rest of the
 * application only depends on `EmbeddingProvider`. That keeps the architecture
 * unchanged if Bedrock embedding access is unavailable and another compatible
 * provider is swapped in.
 *
 * Two providers ship today:
 *
 *  1. `BedrockEmbeddingProvider` — real Amazon Bedrock embeddings (Titan or
 *     Cohere), used whenever BEDROCK_EMBEDDING_MODEL_ID + AWS_REGION are set.
 *  2. `LocalDeterministicEmbeddingProvider` — an honest, clearly-labelled
 *     fallback. It is a hashed bag-of-features projection, NOT a learned model.
 *     It is good enough to demonstrate the vector-index code path end to end
 *     with the seeded corpus, and the UI/health endpoint always says so.
 */

import { env, hasBedrockEmbeddings } from '@/lib/env';

export interface EmbeddingProvider {
  /** Stable identifier surfaced in the UI and /api/health. */
  readonly id: 'bedrock' | 'local-deterministic';
  /** Human-readable model label, e.g. "amazon.titan-embed-text-v2:0". */
  readonly modelLabel: string;
  /** Vector width. Must match the VECTOR(n) column width in CockroachDB. */
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Normalize a vector to unit length so cosine distance is well-conditioned. */
export function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector.slice();
  return vector.map((value) => value / magnitude);
}

/** Cosine similarity of two equal-length vectors, clamped to [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  return Math.max(-1, Math.min(1, similarity));
}

// ---------------------------------------------------------------------------
// Local deterministic fallback
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'was',
  'were', 'is', 'are', 'be', 'been', 'it', 'its', 'this', 'that', 'with', 'by',
  'as', 'from', 'has', 'had', 'have', 'but', 'not', 'no', 'we', 'they', 'he',
  'she', 'his', 'her', 'their', 'our', 'you', 'i', 'if', 'then', 'than', 'so',
]);

/** Split text into normalized content tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** FNV-1a — small, fast, dependency-free, and stable across processes. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic hashed-feature embedding.
 *
 * Unigrams and bigrams are hashed into `dimensions` buckets with signed,
 * sub-linear term weighting. Two texts that share vocabulary land close
 * together under cosine distance — enough to exercise and demonstrate the
 * CockroachDB vector path without a hosted model.
 */
export function deterministicEmbed(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;

  const counts = new Map<string, number>();
  const bump = (feature: string, weight: number) => {
    counts.set(feature, (counts.get(feature) ?? 0) + weight);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    bump(tokens[i], 1);
    if (i + 1 < tokens.length) bump(`${tokens[i]}_${tokens[i + 1]}`, 0.6);
  }

  for (const [feature, count] of counts) {
    const hash = fnv1a(feature);
    const bucket = hash % dimensions;
    // Second hash decides the sign, which keeps unrelated collisions from
    // systematically inflating similarity.
    const sign = fnv1a(`${feature}#sign`) % 2 === 0 ? 1 : -1;
    vector[bucket] += sign * (1 + Math.log(count));
  }

  return normalize(vector);
}

export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-deterministic' as const;
  readonly modelLabel = 'local-deterministic-hash (fallback — not a learned model)';
  readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return deterministicEmbed(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => deterministicEmbed(text, this.dimensions));
  }
}

// ---------------------------------------------------------------------------
// Amazon Bedrock embeddings
// ---------------------------------------------------------------------------

/** Build the request body for the configured embedding model family. */
export function buildEmbeddingRequestBody(modelId: string, text: string): string {
  if (modelId.startsWith('cohere.')) {
    return JSON.stringify({ texts: [text], input_type: 'search_document' });
  }
  // Amazon Titan Text Embeddings V1/V2.
  return JSON.stringify({ inputText: text });
}

/** Pull the vector out of a model-family-specific response body. */
export function parseEmbeddingResponseBody(modelId: string, body: unknown): number[] {
  const payload = body as Record<string, unknown>;

  if (modelId.startsWith('cohere.')) {
    const embeddings = payload.embeddings;
    if (Array.isArray(embeddings) && Array.isArray(embeddings[0])) {
      return embeddings[0] as number[];
    }
    // Cohere v3 with embedding_types returns { embeddings: { float: [[...]] } }
    if (embeddings && typeof embeddings === 'object') {
      const floats = (embeddings as Record<string, unknown>).float;
      if (Array.isArray(floats) && Array.isArray(floats[0])) return floats[0] as number[];
    }
    throw new Error('Unexpected Cohere embedding response shape');
  }

  const embedding = payload.embedding;
  if (Array.isArray(embedding)) return embedding as number[];
  throw new Error('Unexpected Titan embedding response shape');
}

export class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'bedrock' as const;
  readonly modelLabel: string;
  readonly dimensions: number;
  private readonly modelId: string;

  constructor(modelId: string, dimensions: number) {
    this.modelId = modelId;
    this.modelLabel = modelId;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    // Imported lazily so the AWS SDK is never pulled into a bundle that does
    // not use it, and so the fallback path has no hard dependency on it.
    const { BedrockRuntimeClient, InvokeModelCommand } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const { bedrockClientConfig } = await import('@/lib/ai/bedrock-client');

    const client = new BedrockRuntimeClient(bedrockClientConfig());
    const response = await client.send(
      new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: buildEmbeddingRequestBody(this.modelId, text),
      }),
    );

    const decoded = JSON.parse(new TextDecoder().decode(response.body));
    const vector = parseEmbeddingResponseBody(this.modelId, decoded);

    if (vector.length !== this.dimensions) {
      throw new Error(
        `Embedding model returned ${vector.length} dimensions but EMBEDDING_DIMENSIONS is ` +
          `${this.dimensions}. Re-run the migration with the correct width.`,
      );
    }
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    // Sequential on purpose: Bedrock embedding endpoints are per-request and
    // seeding a handful of memories does not warrant a concurrency limiter.
    for (const text of texts) out.push(await this.embed(text));
    return out;
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: EmbeddingProvider | null = null;

/**
 * Resolve the active provider. Bedrock is used whenever it is configured;
 * otherwise the deterministic fallback keeps the whole retrieval path working.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  const dimensions = env.embeddingDimensions;
  cached = hasBedrockEmbeddings()
    ? new BedrockEmbeddingProvider(env.bedrockEmbeddingModelId!, dimensions)
    : new LocalDeterministicEmbeddingProvider(dimensions);
  return cached;
}

/** Test seam. */
export function resetEmbeddingProvider(): void {
  cached = null;
}

/**
 * Embed with an automatic fallback. If a real Bedrock embedding call fails
 * (throttling, missing model access), we degrade to the deterministic provider
 * rather than failing the responder's request — and report which one ran.
 */
export async function embedWithFallback(
  text: string,
): Promise<{ vector: number[]; provider: EmbeddingProvider['id']; degraded: boolean }> {
  const provider = getEmbeddingProvider();
  try {
    return { vector: await provider.embed(text), provider: provider.id, degraded: false };
  } catch (error) {
    if (provider.id === 'local-deterministic') throw error;
    console.error('[embeddings] Bedrock embedding failed, using deterministic fallback:', error);
    const fallback = new LocalDeterministicEmbeddingProvider(provider.dimensions);
    return { vector: await fallback.embed(text), provider: fallback.id, degraded: true };
  }
}
