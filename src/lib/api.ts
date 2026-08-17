/**
 * Shared API-route helpers: safe error mapping, JSON bodies and rate limiting.
 *
 * Errors returned to clients are deliberately shallow. Internal messages (SQL
 * text, DSNs, stack traces) are logged server-side and replaced with a generic
 * message in the response body.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ConflictError, NotFoundError } from '@/lib/store/types';
import { env, hasBedrock, hasBedrockEmbeddings, hasDatabase } from '@/lib/env';
import type { RuntimeMode } from '@/lib/types';

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

/**
 * Map any thrown value onto an HTTP response without leaking internals.
 * Only errors we raise deliberately carry their message through to the client.
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    // A Zod failure here means the *model* broke its contract, not the caller.
    console.error(`[api:${context}] structured response validation failed:`, error.issues);
    return NextResponse.json(
      {
        error:
          'The reasoning model returned a response that failed safety validation. No recommendation was recorded.',
      },
      { status: 502 },
    );
  }

  console.error(`[api:${context}] unhandled error:`, error);
  return NextResponse.json(
    { error: 'An internal error occurred. The incident record was not modified.' },
    { status: 500 },
  );
}

/** Parse a JSON body, tolerating an empty one. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window in-process rate limiter.
 *
 * Adequate for a single-instance demo deployment. It is explicitly NOT a
 * distributed limiter — a multi-instance production deployment should move this
 * to a shared store (documented in the README's production-hardening section).
 */
export function checkRateLimit(
  key: string,
  limit = env.rateLimitPerMinute,
  windowMs = 60_000,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetInMs: windowMs };
  }

  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count <= limit,
    remaining,
    resetInMs: bucket.resetAt - now,
  };
}

/** Best-effort client identity for rate limiting. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  return `${scope}:${ip}`;
}

export function rateLimited(resetInMs: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Slow down and try again shortly.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(resetInMs / 1000)) },
    },
  );
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}

// ---------------------------------------------------------------------------
// Runtime mode
// ---------------------------------------------------------------------------

/**
 * Which backends are actually live. This is what the UI badges render, so it
 * must never overstate: `store` is only 'cockroachdb' when a DSN is configured.
 */
export function runtimeMode(): RuntimeMode {
  return {
    store: hasDatabase() ? 'cockroachdb' : 'in-memory-demo',
    reasoning: hasBedrock() ? 'bedrock' : 'local-heuristic',
    embeddings: hasBedrockEmbeddings() ? 'bedrock' : 'local-deterministic',
    demoMode: env.demoMode,
  };
}
