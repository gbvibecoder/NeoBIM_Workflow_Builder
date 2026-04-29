/**
 * Per-shot Redis mutex tests.
 *
 * Mocks @upstash/redis (via @/lib/rate-limit) so we exercise SET NX EX
 * and the value-matched Lua release without needing a real Redis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { redisSetMock, redisEvalMock, redisConfiguredMock } = vi.hoisted(() => ({
  redisSetMock: vi.fn(),
  redisEvalMock: vi.fn(),
  redisConfiguredMock: { value: true },
}));

vi.mock("@/lib/rate-limit", () => ({
  redis: {
    set: redisSetMock,
    eval: redisEvalMock,
  },
  // Use a getter so tests can flip configured state via the box object.
  get redisConfigured() {
    return redisConfiguredMock.value;
  },
  checkEndpointRateLimit: vi.fn(),
}));

import {
  acquireShotLock,
  makeShotLockKey,
  releaseShotLock,
  SHOT_LOCK_TTL_SECONDS,
} from "@/features/brief-renders/services/brief-pipeline/redis-locks";

beforeEach(() => {
  redisSetMock.mockReset();
  redisEvalMock.mockReset();
  redisConfiguredMock.value = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("makeShotLockKey", () => {
  it("composes the canonical key format", () => {
    expect(makeShotLockKey("job-1", 0, 0)).toBe("briefjob:lock:job-1:0:0");
    expect(makeShotLockKey("job-1", 2, 3)).toBe("briefjob:lock:job-1:2:3");
  });
});

describe("acquireShotLock", () => {
  it("returns acquired:true when SET NX EX succeeds (Upstash returns 'OK')", async () => {
    redisSetMock.mockResolvedValueOnce("OK");
    const result = await acquireShotLock("job-1", 0, 0);
    expect(result.acquired).toBe(true);
    expect(result.lockKey).toBe("briefjob:lock:job-1:0:0");
    expect(result.lockValue.length).toBeGreaterThan(0);

    // Verify the SET call shape — NX + EX with the configured TTL.
    expect(redisSetMock).toHaveBeenCalledTimes(1);
    const [key, value, opts] = redisSetMock.mock.calls[0];
    expect(key).toBe("briefjob:lock:job-1:0:0");
    expect(value).toBe(result.lockValue);
    expect(opts).toEqual({ nx: true, ex: SHOT_LOCK_TTL_SECONDS });
  });

  it("returns acquired:false when SET NX returns null (key already held)", async () => {
    redisSetMock.mockResolvedValueOnce(null);
    const result = await acquireShotLock("job-1", 1, 2);
    expect(result.acquired).toBe(false);
  });

  it("returns acquired:false when redis is not configured (production-fail-closed)", async () => {
    redisConfiguredMock.value = false;
    const result = await acquireShotLock("job-1", 0, 0);
    expect(result.acquired).toBe(false);
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  it("returns acquired:false when redis.set throws (network blip)", async () => {
    redisSetMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await acquireShotLock("job-1", 0, 0);
    expect(result.acquired).toBe(false);
  });

  it("uses a per-acquire random UUID as lock value", async () => {
    redisSetMock.mockResolvedValue("OK");
    const a = await acquireShotLock("job-1", 0, 0);
    const b = await acquireShotLock("job-1", 0, 0);
    expect(a.lockValue).not.toBe(b.lockValue);
  });

  it("honours custom TTL when supplied", async () => {
    redisSetMock.mockResolvedValueOnce("OK");
    await acquireShotLock("job-1", 0, 0, 30);
    const [, , opts] = redisSetMock.mock.calls[0];
    expect(opts).toEqual({ nx: true, ex: 30 });
  });
});

describe("releaseShotLock", () => {
  it("calls EVAL with the value-match Lua script + key + value", async () => {
    redisEvalMock.mockResolvedValueOnce(1);
    await releaseShotLock({
      acquired: true,
      lockKey: "briefjob:lock:job-1:0:0",
      lockValue: "uuid-A",
    });
    expect(redisEvalMock).toHaveBeenCalledTimes(1);
    const [script, keys, args] = redisEvalMock.mock.calls[0];
    expect(typeof script).toBe("string");
    expect(script).toContain("redis.call('GET'");
    expect(script).toContain("redis.call('DEL'");
    expect(keys).toEqual(["briefjob:lock:job-1:0:0"]);
    expect(args).toEqual(["uuid-A"]);
  });

  it("is a no-op when the handle was never acquired", async () => {
    await releaseShotLock({
      acquired: false,
      lockKey: "briefjob:lock:job-1:0:0",
      lockValue: "uuid-A",
    });
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("is a no-op when redis is not configured", async () => {
    redisConfiguredMock.value = false;
    await releaseShotLock({
      acquired: true,
      lockKey: "briefjob:lock:job-1:0:0",
      lockValue: "uuid-A",
    });
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("swallows redis errors (best-effort release)", async () => {
    redisEvalMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    // Must not throw — TTL will eventually clean up the lock.
    await expect(
      releaseShotLock({
        acquired: true,
        lockKey: "briefjob:lock:job-1:0:0",
        lockValue: "uuid-A",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("acquire/release end-to-end semantics (mocked)", () => {
  it("simulating two workers racing — only one acquires", async () => {
    // First call wins (SET returns "OK"), second loses (SET returns null).
    redisSetMock
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null);

    const a = await acquireShotLock("job-X", 0, 0);
    const b = await acquireShotLock("job-X", 0, 0);
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
  });
});
