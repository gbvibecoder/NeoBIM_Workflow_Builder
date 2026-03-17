import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { trackRateLimitHit } from "./analytics";

// Initialize Redis client for Upstash
let redis: Redis;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } else if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL.replace("redis://", "http://"));
    redis = new Redis({
      url: `https://${url.host}`,
      token: url.password || "",
    });
  } else {
    if (process.env.NODE_ENV === "production") {
      console.error("[rate-limit] WARNING: No Redis configured in production — rate limiting is disabled!");
    }
    console.warn("[rate-limit] No Redis configured — rate limiting may not persist across restarts");
    redis = new Redis({
      url: "https://placeholder.upstash.io",
      token: "placeholder",
    });
  }
} catch (error) {
  console.error("[rate-limit] Failed to initialize Redis:", error);
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "https://placeholder.upstash.io",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "placeholder",
  });
}

const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_EXECUTIONS_PER_MONTH || "5");
const MINI_TIER_LIMIT = parseInt(process.env.MINI_TIER_EXECUTIONS_PER_MONTH || "10");
const STARTER_TIER_LIMIT = parseInt(process.env.STARTER_TIER_EXECUTIONS_PER_MONTH || "30");
const PRO_TIER_LIMIT = parseInt(process.env.PRO_TIER_EXECUTIONS_PER_MONTH || "100");

export const freeTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(FREE_TIER_LIMIT, "30 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:free",
});

export const miniTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(MINI_TIER_LIMIT, "30 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:mini",
});

export const starterTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(STARTER_TIER_LIMIT, "30 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:starter",
});

export const proTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(PRO_TIER_LIMIT, "30 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:pro",
});

/**
 * Check if user is an admin (bypasses rate limits)
 * Reads from ADMIN_EMAILS environment variable (comma-separated list)
 */
export function isAdminUser(userEmail?: string): boolean {
  if (!userEmail) return false;

  const adminEmails = process.env.ADMIN_EMAILS;
  if (!adminEmails) return false;

  const adminList = adminEmails.split(',').map(email => email.trim().toLowerCase());
  return adminList.includes(userEmail.toLowerCase());
}

export async function checkRateLimit(
  userId: string,
  userRole: "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN",
  userEmail?: string
) {
  // Check if user is in admin list (bypasses rate limits)
  if (isAdminUser(userEmail)) {
    return {
      success: true,
      limit: 999999,
      remaining: 999999,
      reset: Date.now() + 86400000,
      pending: Promise.resolve(),
    };
  }

  // Team/Platform admins bypass execution rate limits
  if (userRole === "TEAM_ADMIN" || userRole === "PLATFORM_ADMIN") {
    return {
      success: true,
      limit: 999999,
      remaining: 999999,
      reset: Date.now() + 86400000,
      pending: Promise.resolve(),
    };
  }

  // Apply role-based rate limiting
  if (userRole === "PRO") {
    return await proTierRateLimit.limit(userId);
  }

  if (userRole === "STARTER") {
    return await starterTierRateLimit.limit(userId);
  }

  if (userRole === "MINI") {
    return await miniTierRateLimit.limit(userId);
  }

  return await freeTierRateLimit.limit(userId);
}

export function logRateLimitHit(userId: string, userRole: string, remaining: number) {
  console.warn("[RATE_LIMIT] User " + userId + " (" + userRole + ") hit rate limit. Remaining: " + remaining);

  if (remaining === 0) {
    trackRateLimitHit(userId, "execute-node", userRole);
  }
}

// ─── Per-node-type metered limits (video, 3D, renders) ──────────────────────

/**
 * Check and enforce per-node-type monthly limits.
 * Uses atomic Redis INCR with monthly key auto-expiry.
 * Returns { allowed, used, limit }.
 */
export async function checkNodeTypeLimit(
  userId: string,
  nodeType: "video" | "3d" | "render",
  limit: number
): Promise<{ allowed: boolean; used: number; limit: number }> {
  // Unlimited
  if (limit < 0) return { allowed: true, used: 0, limit: -1 };

  // Blocked (limit = 0)
  if (limit === 0) return { allowed: false, used: 0, limit: 0 };

  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `node-limit:${userId}:${nodeType}:${monthKey}`;

    // Atomic increment
    const newCount = await redis.incr(key);

    // Set TTL on first increment so key auto-cleans after month ends
    if (newCount === 1) {
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const ttl = Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000) + 86400; // +1 day buffer
      await redis.expire(key, ttl);
    }

    // Over limit — roll back the increment
    if (newCount > limit) {
      await redis.decr(key);
      return { allowed: false, used: limit, limit };
    }

    return { allowed: true, used: newCount, limit };
  } catch (error) {
    // In development without Redis, allow through
    if (process.env.NODE_ENV === "development") {
      console.warn(`[rate-limit] Redis unavailable for node-type ${nodeType}, allowing in dev mode:`, error);
      return { allowed: true, used: 0, limit };
    }
    // In production, fail closed
    console.error(`[rate-limit] Node-type limit check failed for ${nodeType}:`, error);
    return { allowed: false, used: 0, limit };
  }
}

// ─── Per-workflow dedup (count rate limit once per workflow, not per node) ──

/**
 * Check if this workflow execution has already been counted for rate limiting.
 * Returns true if already counted (skip rate limit), false if first time (count it).
 * Uses a Redis key with 30-day TTL to track seen execution IDs.
 */
export async function isExecutionAlreadyCounted(
  userId: string,
  executionId: string,
): Promise<boolean> {
  if (!executionId) return false; // No executionId means count every time
  try {
    const key = `exec-seen:${userId}:${executionId}`;
    const exists = await redis.get(key);
    if (exists) return true;
    // Mark as seen with 30-day TTL (matches monthly window)
    await redis.set(key, "1", { ex: 2592000 });
    return false;
  } catch {
    // On Redis error, don't dedup — count the request
    return false;
  }
}

// ─── Generic endpoint rate limiter ──────────────────────────────────────────

/**
 * Extract client IP from request headers (for IP-based rate limiting on public endpoints).
 */
export function getClientIp(req: Request | { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "anonymous";
}

const endpointLimiters = new Map<string, Ratelimit>();

function getEndpointLimiter(endpoint: string, maxRequests: number, window: string): Ratelimit {
  const key = `${endpoint}:${maxRequests}:${window}`;
  if (!endpointLimiters.has(key)) {
    endpointLimiters.set(key, new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxRequests, window as Parameters<typeof Ratelimit.slidingWindow>[1]),
      analytics: true,
      prefix: `@upstash/ratelimit:${endpoint}`,
    }));
  }
  return endpointLimiters.get(key)!;
}

/**
 * Generic rate limit check for any API endpoint.
 * In development without Redis, logs a warning and allows the request.
 */
export async function checkEndpointRateLimit(
  userId: string,
  endpoint: string,
  maxRequests: number = 20,
  window: string = "1 m"
): Promise<{ success: boolean; remaining: number }> {
  try {
    const limiter = getEndpointLimiter(endpoint, maxRequests, window);
    const result = await limiter.limit(`${endpoint}:${userId}`);
    return { success: result.success, remaining: result.remaining };
  } catch (error) {
    // In development without Redis configured, allow through with warning
    if (process.env.NODE_ENV === "development") {
      console.warn(`[rate-limit] Redis unavailable for ${endpoint}, allowing in dev mode:`, error);
      return { success: true, remaining: 999 };
    }
    // In production, fail closed
    console.error(`[rate-limit] Redis unavailable for ${endpoint}:`, error);
    return { success: false, remaining: 0 };
  }
}
