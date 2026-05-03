/**
 * Market intelligence strike counter — tracks consecutive AI call failures.
 *
 * After 3 failures within 1 hour for the same user+city, the system skips
 * further AI calls and falls back to static rates. This prevents hammering
 * the Anthropic API during outages and surfaces a clear "data unavailable"
 * signal to the user.
 *
 * Uses Upstash Redis with 1hr TTL. Falls back to in-memory map when Redis
 * is unavailable (single-process only, but better than nothing).
 */

const STRIKE_TTL = 3600; // 1 hour
const MAX_STRIKES = 3;

// In-memory fallback when Redis is unavailable
const memoryStrikes = new Map<string, { count: number; expiresAt: number }>();

function getStrikeKey(userId: string, city: string): string {
  return `mkt-strike:${userId}:${(city || "national").toLowerCase().replace(/\s+/g, "_")}`;
}

async function getRedis() {
  // Skip Redis in test environment — use in-memory fallback
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    const { Redis } = await import("@upstash/redis");
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch {
    return null;
  }
}

export async function recordStrike(userId: string, city: string): Promise<{ count: number; blocked: boolean }> {
  const key = getStrikeKey(userId, city);
  const redis = await getRedis();

  if (redis) {
    try {
      const count = await redis.incr(key);
      await redis.expire(key, STRIKE_TTL);
      return { count, blocked: count >= MAX_STRIKES };
    } catch { /* fall through to memory */ }
  }

  // Memory fallback
  const now = Date.now();
  const existing = memoryStrikes.get(key);
  if (existing && existing.expiresAt > now) {
    existing.count++;
    return { count: existing.count, blocked: existing.count >= MAX_STRIKES };
  }
  memoryStrikes.set(key, { count: 1, expiresAt: now + STRIKE_TTL * 1000 });
  return { count: 1, blocked: false };
}

export async function clearStrikes(userId: string, city: string): Promise<void> {
  const key = getStrikeKey(userId, city);
  const redis = await getRedis();
  if (redis) {
    try { await redis.del(key); } catch { /* non-fatal */ }
  }
  memoryStrikes.delete(key);
}

export async function getStrikeCount(userId: string, city: string): Promise<number> {
  const key = getStrikeKey(userId, city);
  const redis = await getRedis();

  if (redis) {
    try {
      const val = await redis.get<number>(key);
      return val ?? 0;
    } catch { /* fall through */ }
  }

  // Memory fallback
  const existing = memoryStrikes.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.count;
  return 0;
}

export function isBlocked(strikeCount: number): boolean {
  return strikeCount >= MAX_STRIKES;
}
