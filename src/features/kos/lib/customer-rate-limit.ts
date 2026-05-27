/**
 * customer-rate-limit — Upstash sliding-window limiter for the
 * customer-side upload routes (5I PR 1 scope: per-customer + per-IP
 * only; per-tenant + sidecar quotas land in PR 5).
 *
 * Fail-open by design. The KOS chat surface is the customer's primary
 * touchpoint with Kalzen; an Upstash outage must NOT take down the
 * chat. When Redis is unreachable or env vars are unset, we log a
 * warning and let the request through. The trade-off is conscious:
 * brief over-limit traffic during an Upstash incident is preferable
 * to lockout. Hard ceilings (50 MB cap, content-type allowlist,
 * conversation-ownership) still hold via the route's other defenses.
 *
 * IP resolution prefers `x-real-ip` (Vercel sets this from the
 * infrastructure layer — it cannot be set by the client). We fall
 * back to the first entry of `x-forwarded-for` only when x-real-ip
 * is absent; xff is client-spoofable in plain HTTP, so the fallback
 * logs a debug breadcrumb so a future audit can spot fraud patterns.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { kosLog } from "./kos-logger";

let _redis: Redis | null = null;
let _redisInitTried = false;

function redis(): Redis | null {
  if (_redis) return _redis;
  if (_redisInitTried) return null;
  _redisInitTried = true;
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  try {
    _redis = Redis.fromEnv();
    return _redis;
  } catch (err) {
    kosLog.warn("kos_rl_redis_init_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Test hook — reset the cached Redis client + init flag so each
 * suite can override env vars and observe fresh init behaviour.
 * NOT for production use; the public surface is `checkUploadRateLimit`.
 */
export function _resetRateLimitForTest(): void {
  _redis = null;
  _redisInitTried = false;
}

function buildLimiter(
  prefix: string,
  limit: number,
  window: `${number} s` | `${number} ms`,
): Ratelimit | null {
  const r = redis();
  if (!r) return null;
  return new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix,
  });
}

const limiters = {
  uploadCustomer: () => buildLimiter("kos:cust:up:cust", 5, "3600 s"),
  uploadIp: () => buildLimiter("kos:cust:up:ip", 10, "3600 s"),
};

export interface RateLimitResult {
  ok: boolean;
  dimension?: "customer" | "ip";
  remaining?: number;
  resetAt?: number;
}

export async function checkUploadRateLimit(args: {
  customerId: string;
  ip: string;
}): Promise<RateLimitResult> {
  // Dev mode bypass — the limiter is exercised only in production
  // traffic. Tests stub NODE_ENV='production' when they need to
  // observe limiter behavior.
  if (process.env.NODE_ENV !== "production") return { ok: true };

  const custLim = limiters.uploadCustomer();
  const ipLim = limiters.uploadIp();

  if (!custLim || !ipLim) {
    kosLog.warn("kos_rl_redis_down_fail_open", { dim: "upload" });
    return { ok: true };
  }

  try {
    const [cust, ip] = await Promise.all([
      custLim.limit(args.customerId),
      ipLim.limit(args.ip),
    ]);
    if (!cust.success) {
      return {
        ok: false,
        dimension: "customer",
        remaining: cust.remaining,
        resetAt: cust.reset,
      };
    }
    if (!ip.success) {
      return {
        ok: false,
        dimension: "ip",
        remaining: ip.remaining,
        resetAt: ip.reset,
      };
    }
    return { ok: true };
  } catch (err) {
    kosLog.warn("kos_rl_redis_check_failed_fail_open", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: true };
  }
}

/**
 * Resolve client IP for rate limiting.
 *
 * Order:
 *   1. `x-real-ip` — set by Vercel's infrastructure; not client-spoofable.
 *   2. First entry of `x-forwarded-for` — fallback only; spoofable.
 *   3. "unknown" — caught all traffic missing both headers (CLI tests, etc.).
 */
export function resolveClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) {
      kosLog.debug("kos_rl_ip_fallback_xff", { ip: first });
      return first;
    }
  }
  return "unknown";
}
