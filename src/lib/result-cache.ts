/**
 * Result Cache — exact-match memoization for deterministic advisory
 * Anthropic calls (TR-025 / TR-028 / TR-029 / TR-030).
 *
 * Backed by the Upstash Redis client already used by the rate limiter
 * (src/lib/rate-limit.ts). Same brief twice => the second run reads the
 * stored output instead of paying Anthropic.
 *
 * Scope (by design):
 *   • EXACT-match only. Same brief reworded => different canonical JSON
 *     => different SHA-256 => cache miss. No semantic / embedding match.
 *   • Failures are NEVER cached. `readThrough()` only stores when the
 *     compute callback resolves AND the caller's `shouldCache` predicate
 *     returns true. Thrown errors propagate; nothing is written.
 *   • Vision / agent loop / final IFC are NEVER cached at this layer —
 *     this module is only consumed by the deterministic advisory call
 *     sites that import it.
 *
 * Telemetry: cache hits are logged once (info level) with the key and
 * the elapsed read time. Callers are responsible for rewriting their
 * own cost telemetry to 0 on hit (the wrapper exposes `cacheHit` so the
 * caller can do that locally — it does not touch caller-shaped data).
 *
 * Failure model: any Redis error treats the lookup as a miss and any
 * write as a no-op. Cache outage MUST NOT break advisory nodes.
 */

import crypto from "node:crypto";

import { redis, redisConfigured } from "./rate-limit";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const NAMESPACE_PREFIX = "v3:cache:";

/**
 * Master kill switch. Set `RESULT_CACHE_ENABLED=false` to bypass the
 * cache entirely (every lookup reports a miss; every write is a no-op).
 * Useful for ops to disable mid-incident without a redeploy.
 */
function cacheEnabled(): boolean {
  return process.env.RESULT_CACHE_ENABLED !== "false";
}

export interface CacheConfig {
  /** Short node/function identifier appended to NAMESPACE_PREFIX. */
  namespace: string;
  /**
   * One or more strings that together identify the prompt + model
   * version. The wrapper SHA-256s the concatenation and embeds the
   * first 16 hex chars in the key so editing the prompt or upgrading
   * the model automatically invalidates every prior entry.
   */
  promptVersion: string | string[];
  /** TTL override in seconds. Default 7 days. */
  ttlSeconds?: number;
}

export interface CacheEnvelope<T> {
  result: T;
  /** Wall-clock when the result was written (ms since epoch). */
  cachedAt: number;
  /** Same prompt-version hash that's already embedded in the key — kept
   *  here for diagnostic logs only. */
  promptVersionHash: string;
}

export interface ReadThroughResult<T> {
  value: T;
  cacheHit: boolean;
  cacheKey: string;
  /** Time spent on the lookup itself (Redis round-trip + decode). */
  lookupMs: number;
}

export interface ReadThroughOptions<T> {
  config: CacheConfig;
  /** Input that determines the result; will be canonicalized + hashed. */
  input: unknown;
  /** Compute on miss. Thrown errors propagate; nothing is cached. */
  compute: () => Promise<T>;
  /**
   * Optional predicate run on the computed value. Return false to keep
   * the value as the function's return but skip storing it (e.g. an
   * "ok but zero useful work" result that you don't want to memoize).
   */
  shouldCache?: (value: T) => boolean;
}

/**
 * Deterministic JSON: sort object keys recursively so the byte-equal
 * input always hashes to the same key, regardless of the field order
 * the caller happens to use. Arrays preserve order (order is semantic).
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function promptVersionHashOf(promptVersion: string | string[]): string {
  const joined = Array.isArray(promptVersion)
    ? promptVersion.join("␟") // unit separator — won't appear in prompts
    : promptVersion;
  return sha256Hex(joined).slice(0, 16);
}

export function computeCacheKey(input: unknown, config: CacheConfig): string {
  const versionHash = promptVersionHashOf(config.promptVersion);
  const canonical = JSON.stringify(canonicalize(input));
  const inputHash = sha256Hex(canonical);
  return `${NAMESPACE_PREFIX}${config.namespace}:${versionHash}:${inputHash}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  if (!cacheEnabled() || !redisConfigured) return null;
  try {
    const envelope = await redis.get<CacheEnvelope<T>>(key);
    if (!envelope || typeof envelope !== "object" || !("result" in envelope)) {
      return null;
    }
    return envelope.result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[result-cache] get failed for ${key}: ${err instanceof Error ? err.message : String(err)}. Treating as miss.`,
    );
    return null;
  }
}

export async function setCached<T>(
  key: string,
  value: T,
  config: CacheConfig,
): Promise<void> {
  if (!cacheEnabled() || !redisConfigured) return;
  try {
    const envelope: CacheEnvelope<T> = {
      result: value,
      cachedAt: Date.now(),
      promptVersionHash: promptVersionHashOf(config.promptVersion),
    };
    await redis.set(key, envelope, {
      ex: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    });
  } catch (err) {
    // Non-fatal. The next caller will recompute on miss.
    // eslint-disable-next-line no-console
    console.warn(
      `[result-cache] set failed for ${key}: ${err instanceof Error ? err.message : String(err)}. Caller will recompute.`,
    );
  }
}

/**
 * Read-through wrapper.
 *
 *   - HIT  : returns the stored value, `cacheHit: true`, no compute.
 *   - MISS : runs `compute()`, stores on success (subject to `shouldCache`),
 *            returns the freshly computed value with `cacheHit: false`.
 *   - ERR  : `compute()` throws -> error propagates, nothing is stored.
 *
 * Callers translate the `cacheHit` flag into whatever cost-rewrite logic
 * their own result type needs (e.g. set `costUsd: 0`).
 */
export async function readThrough<T>(
  opts: ReadThroughOptions<T>,
): Promise<ReadThroughResult<T>> {
  const key = computeCacheKey(opts.input, opts.config);
  const t0 = Date.now();
  const cached = await getCached<T>(key);
  const lookupMs = Date.now() - t0;
  if (cached !== null) {
    // eslint-disable-next-line no-console
    console.info(
      `[result-cache] HIT ns=${opts.config.namespace} key=${key.slice(-12)} lookupMs=${lookupMs}`,
    );
    return { value: cached, cacheHit: true, cacheKey: key, lookupMs };
  }
  const computed = await opts.compute();
  if (!opts.shouldCache || opts.shouldCache(computed)) {
    await setCached(key, computed, opts.config);
  }
  // eslint-disable-next-line no-console
  console.info(
    `[result-cache] MISS ns=${opts.config.namespace} key=${key.slice(-12)} lookupMs=${lookupMs} stored=${!opts.shouldCache || opts.shouldCache(computed)}`,
  );
  return { value: computed, cacheHit: false, cacheKey: key, lookupMs };
}
