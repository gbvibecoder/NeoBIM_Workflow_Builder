/**
 * Per-shot Redis mutex for the Stage 3 image-gen worker.
 *
 * QStash retries can fire the same worker invocation multiple times
 * (network glitch, worker timeout, manual redeliver). Without a mutex,
 * the same shot can be rendered twice, producing wasted spend and
 * duplicate writes. The mutex serialises per-shot renders.
 *
 * Implementation:
 *   • SET NX EX — atomic acquire-or-fail with TTL.
 *   • Release uses a Lua script that DELs only when the stored value
 *     equals the lock holder's UUID — prevents releasing another
 *     worker's lock after our TTL has expired.
 *
 * Lock key: `briefjob:lock:{jobId}:{apartmentIndex}:{shotIndexInApartment}`
 *
 * TTL: 90 seconds. gpt-image-1.5 at high quality typically takes 30-60 s;
 * 90 s leaves headroom but is short enough that a stuck worker doesn't
 * hold the lock forever. If a render legitimately exceeds 90 s, the lock
 * expires and another worker may take over — the persisted shot status
 * + R2 deterministic key make the duplicate work an idempotent no-op
 * (the second worker uploads to the same R2 path; the DB write rejects
 * if status is already success).
 */

import { redis, redisConfigured } from "@/lib/rate-limit";

/**
 * Lock TTL (seconds). gpt-image-1.5 high-quality landscape can take
 * 60-90 s; 90 s gives a small safety margin without risking long
 * orphaned locks.
 */
export const SHOT_LOCK_TTL_SECONDS = 90;

/**
 * Lua script — DELete the key only if its value matches the supplied
 * value. Passed as a single-shot EVAL so the comparison and deletion
 * happen atomically server-side.
 */
const SAFE_RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export interface ShotLockHandle {
  /** True when the SET NX EX succeeded; false when the key was already held. */
  acquired: boolean;
  /** Composed lock key — needed for the release call. */
  lockKey: string;
  /**
   * Random per-acquire UUID stored as the key's value. The release script
   * checks this against the current key value so we never delete another
   * worker's lock after our TTL expires.
   */
  lockValue: string;
}

export function makeShotLockKey(
  jobId: string,
  apartmentIndex: number,
  shotIndexInApartment: number,
): string {
  return `briefjob:lock:${jobId}:${apartmentIndex}:${shotIndexInApartment}`;
}

/**
 * Atomically acquire the per-shot lock. Returns `{ acquired: false }`
 * when another worker holds it (or when Redis is unconfigured — which
 * fails closed in production). Never throws.
 */
export async function acquireShotLock(
  jobId: string,
  apartmentIndex: number,
  shotIndexInApartment: number,
  ttlSeconds: number = SHOT_LOCK_TTL_SECONDS,
): Promise<ShotLockHandle> {
  const lockKey = makeShotLockKey(jobId, apartmentIndex, shotIndexInApartment);
  const lockValue = globalThis.crypto.randomUUID();

  if (!redisConfigured) {
    // In production, Redis must be configured — fail closed so we don't
    // silently bypass the mutex. In dev (no Redis) we still report not
    // acquired; the worker route's "skipped" path keeps the pipeline safe.
    return { acquired: false, lockKey, lockValue };
  }

  try {
    const result = await redis.set(lockKey, lockValue, {
      nx: true,
      ex: ttlSeconds,
    });
    // Upstash returns "OK" when SET NX EX succeeds, null otherwise.
    return { acquired: result === "OK", lockKey, lockValue };
  } catch {
    // Network blip — fail closed so the caller skips and re-enqueues.
    return { acquired: false, lockKey, lockValue };
  }
}

/**
 * Release the lock — value-matched via Lua so we never delete another
 * worker's lock after our TTL expires. Best-effort; never throws.
 */
export async function releaseShotLock(handle: ShotLockHandle): Promise<void> {
  if (!handle.acquired || !redisConfigured) return;
  try {
    await redis.eval(SAFE_RELEASE_LUA, [handle.lockKey], [handle.lockValue]);
  } catch {
    // The lock will expire on its own via TTL. Swallow.
  }
}
