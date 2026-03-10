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

const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_EXECUTIONS_PER_DAY || "10");
const PRO_TIER_LIMIT = parseInt(process.env.PRO_TIER_EXECUTIONS_PER_DAY || "100");

export const freeTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(FREE_TIER_LIMIT, "1 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:free",
});

export const proTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(PRO_TIER_LIMIT, "1 d"),
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
  userRole: "FREE" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN",
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

  // Apply role-based rate limiting
  if (userRole === "PRO" || userRole === "TEAM_ADMIN" || userRole === "PLATFORM_ADMIN") {
    return await proTierRateLimit.limit(userId);
  }

  return await freeTierRateLimit.limit(userId);
}

export function logRateLimitHit(userId: string, userRole: string, remaining: number) {
  console.warn("[RATE_LIMIT] User " + userId + " (" + userRole + ") hit rate limit. Remaining: " + remaining);

  // 🔥 TRACK RATE LIMIT HIT
  if (remaining === 0) {
    trackRateLimitHit(userId, "execute-node", userRole);
  }
}

// ─── Per-workflow dedup (count rate limit once per workflow, not per node) ──

/**
 * Check if this workflow execution has already been counted for rate limiting.
 * Returns true if already counted (skip rate limit), false if first time (count it).
 * Uses a Redis key with 24h TTL to track seen execution IDs.
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
    // Mark as seen with 24h TTL
    await redis.set(key, "1", { ex: 86400 });
    return false;
  } catch {
    // On Redis error, don't dedup — count the request
    return false;
  }
}

// ─── Generic endpoint rate limiter ──────────────────────────────────────────

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
