/**
 * KOS BIM (Week 5A) — generic retry/backoff HTTP helper for Autodesk APS.
 *
 * APS publishes hard rate limits (≈60 req/min on auth, ≈14 req/min on
 * translation submission) and occasionally 500s under load. This helper
 * centralises the retry contract so `aps-auth.ts`, `aps-bucket.ts`, and
 * `aps-translation.ts` all behave identically:
 *
 *   • network error (fetch throws)  → retry with exp backoff + jitter
 *   • 5xx                            → retry with exp backoff + jitter
 *   • 429                            → honour Retry-After, bounded retries
 *   • everything else (incl. 4xx)    → return the Response as-is; the
 *                                      CALLER decides whether a 401/404/409
 *                                      is fatal or expected. We never retry
 *                                      4xx — a bad request won't fix itself.
 *
 * The helper returns the raw `Response`; it never throws on HTTP status,
 * only on exhausting retries against network/5xx failures. Callers map
 * status codes to their own KosError codes.
 */

import { KosError } from "@/features/kos/lib/kos-errors";

export interface ApsRetryConfig {
  /** Human label for error messages, e.g. "APS auth", "APS upload part 3". */
  label: string;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; doubles each attempt. Default 1000. */
  baseDelayMs?: number;
  /** Cap on a single backoff sleep. Default 30000. */
  maxDelayMs?: number;
  /** Max retries specifically on 429. Default 1. */
  maxRetryOn429?: number;
  /** KosError code thrown when retries are exhausted. Default KOS_APS_002. */
  exhaustedCode?: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with ±20% jitter, capped at `maxDelayMs`.
 * `attempt` is 1-based (the delay BEFORE retry N).
 */
export function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exp = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exp, maxDelayMs);
  // ±20% jitter to avoid thundering-herd retries against APS.
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Parse a `Retry-After` header. APS sends seconds (numeric) per RFC 7231;
 * we also tolerate an HTTP-date. Returns ms, or null when unparseable.
 */
export function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

/**
 * Fetch with the APS retry contract described in the file header. Body
 * passed in `init` MUST be replayable across retries (string / Buffer /
 * Uint8Array) — do NOT pass a one-shot stream, since a retry re-sends it.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: ApsRetryConfig,
): Promise<Response> {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 1000;
  const maxDelayMs = config.maxDelayMs ?? 30_000;
  const maxRetryOn429 = config.maxRetryOn429 ?? 1;
  const exhaustedCode = config.exhaustedCode ?? "KOS_APS_002";

  let attempt = 0;
  let rateLimitRetries = 0;
  let lastNetworkError: unknown = null;

  while (attempt < maxAttempts) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network-level failure (DNS, connection reset, timeout). Retry
      // until attempts exhausted.
      lastNetworkError = err;
      if (attempt >= maxAttempts) break;
      await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
      continue;
    }

    // 429 — respect the server's Retry-After, bounded.
    if (res.status === 429 && rateLimitRetries < maxRetryOn429) {
      rateLimitRetries++;
      const retryAfter =
        parseRetryAfterMs(res.headers.get("retry-after")) ??
        backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
      await sleep(retryAfter);
      continue;
    }

    // 5xx — transient server error, retry if attempts remain.
    if (res.status >= 500 && attempt < maxAttempts) {
      await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
      continue;
    }

    // 2xx / 3xx / 4xx — return for the caller to interpret.
    return res;
  }

  const detail =
    lastNetworkError instanceof Error
      ? `${lastNetworkError.name}: ${lastNetworkError.message}`
      : lastNetworkError != null
        ? String(lastNetworkError)
        : "all retries returned a retryable HTTP status";
  throw new KosError(
    exhaustedCode,
    `${config.label}: exhausted ${maxAttempts} attempt(s) against ${url} — ${detail}.`,
    502,
  );
}
