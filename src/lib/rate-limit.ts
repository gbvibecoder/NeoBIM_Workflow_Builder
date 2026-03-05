import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Initialize Redis client for Upstash
let redis: Redis;

try {
  // Try to use Upstash env vars first (for production)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } else {
    // Fallback: parse REDIS_URL for local development
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const url = new URL(redisUrl.replace("redis://", "http://"));
    
    redis = new Redis({
      url: `https://${url.host}`,
      token: url.password || "",
    });
  }
} catch (error) {
  console.warn("[rate-limit] Failed to initialize Redis, using in-memory fallback:", error);
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "http://localhost:8079",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  });
}

// Rate limiter for free users: 3 requests per day
export const freeTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:free",
});

// Rate limiter for Pro users: essentially unlimited (1000 per day)
export const proTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1000, "1 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:pro",
});

/**
 * Check rate limit based on user tier
 * @param userId - User ID for rate limit key
 * @param userRole - User role (FREE, PRO, TEAM_ADMIN, PLATFORM_ADMIN)
 * @param userEmail - User email (for admin bypass check)
 * @returns Rate limit result with success status
 */
export async function checkRateLimit(
  userId: string,
  userRole: "FREE" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN",
  userEmail?: string
) {
  // ADMIN BYPASS: If user email matches ADMIN_EMAIL env variable, skip rate limiting
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && userEmail && userEmail.toLowerCase() === adminEmail.toLowerCase()) {
    console.log("[rate-limit] Admin bypass for:", userEmail);
    return {
      success: true,
      limit: 999999,
      remaining: 999999,
      reset: Date.now() + 86400000, // 24 hours
      pending: Promise.resolve(),
    };
  }

  // Pro, Team Admin, and Platform Admin users have unlimited access
  if (userRole === "PRO" || userRole === "TEAM_ADMIN" || userRole === "PLATFORM_ADMIN") {
    return await proTierRateLimit.limit(userId);
  }

  // Free tier users have 3 requests per day
  return await freeTierRateLimit.limit(userId);
}

/**
 * Log rate limit hit for monitoring
 */
export function logRateLimitHit(userId: string, userRole: string, remaining: number) {
  console.warn("[RATE_LIMIT] User " + userId + " (" + userRole + ") hit rate limit. Remaining: " + remaining);
}
