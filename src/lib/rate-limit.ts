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
  } else {
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

export const freeTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:free",
});

export const proTierRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1000, "1 d"),
  analytics: true,
  prefix: "@upstash/ratelimit:execute-node:pro",
});

/**
 * Check if user is an admin (bypasses rate limits)
 * Reads from ADMIN_EMAILS environment variable (comma-separated list)
 */
function isAdminUser(userEmail?: string): boolean {
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
