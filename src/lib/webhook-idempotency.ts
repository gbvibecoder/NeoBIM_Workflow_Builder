import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch {
  console.warn("[webhook-idempotency] Failed to init Redis — idempotency disabled");
}

const TTL_SECONDS = 48 * 60 * 60; // 48 hours

/**
 * Check if a webhook event has already been processed.
 * Returns true if the event is a duplicate (already processed).
 * Uses Redis SET NX (set-if-not-exists) for atomic check-and-set.
 */
export async function checkWebhookIdempotency(
  provider: "stripe" | "razorpay",
  eventId: string,
): Promise<boolean> {
  if (!redis) return false; // No Redis = no dedup (allows processing)

  const key = `webhook:${provider}:${eventId}`;

  try {
    // SET NX returns "OK" if key was set (new event), null if already exists (duplicate)
    const result = await redis.set(key, "1", { nx: true, ex: TTL_SECONDS });
    return result === null; // null = key existed = duplicate
  } catch (error) {
    console.error("[webhook-idempotency] Redis error, allowing event:", error);
    return false; // On error, allow processing (fail-open to not block payments)
  }
}

/**
 * Clear an idempotency key so the event can be retried.
 * Call this when webhook processing FAILS — otherwise the provider's
 * retry would be blocked as a "duplicate" even though we never
 * successfully processed the event.
 */
export async function clearWebhookIdempotency(
  provider: "stripe" | "razorpay",
  eventId: string,
): Promise<void> {
  if (!redis) return;
  const key = `webhook:${provider}:${eventId}`;
  try {
    await redis.del(key);
  } catch {
    // Best-effort — if this fails, the retry will be blocked for up to 48h
    // but the reconcile cron provides a safety net.
  }
}
