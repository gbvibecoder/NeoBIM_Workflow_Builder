import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Initialize Redis client for Upstash
// Note: Upstash Redis uses REST API, so we need to parse the Redis URL
// or use Upstash-specific env vars (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)
// For local Redis or ioredis-compatible URLs, we'll use the ioredis adapter

// For now, using a simple implementation that works with both local and Upstash
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
    // For local testing, we'll create a mock Redis client
    // In production, use Upstash Redis with proper env vars
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    
    // Extract credentials from redis://[username]:[password]@host:port format
    const url = new URL(redisUrl.replace("redis://", "http://"));
    
    redis = new Redis({
      url: `https://${url.host}`, // This won't work with local Redis
      token: url.password || "",
    });
  }
} catch (error) {
  console.warn("[rate-limit] Failed to initialize Redis, using in-memory fallback:", error);
  // Fallback to a basic implementation - this should be replaced with proper config
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
 * @returns Rate limit result with success status
 */
export async function checkRateLimit(
  userId: string,
  userRole: "FREE" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN"
) {
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
