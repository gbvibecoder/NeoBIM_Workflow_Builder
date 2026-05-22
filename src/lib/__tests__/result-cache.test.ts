/**
 * Result cache — unit tests.
 *
 * Covers the SELF-CHECK requirements from the build brief:
 *   1. cache miss calls compute + stores the result
 *   2. cache hit returns the stored value, does NOT call compute, cost=0
 *      (the caller-side cost-rewrite contract; the wrapper exposes
 *      `cacheHit` and `value`, the caller does the zeroing)
 *   3. failures are NOT cached — a thrown compute propagates and nothing
 *      is written to Redis
 *   4. prompt-version change invalidates: same input + new prompt =
 *      different cache key
 *
 * The Upstash Redis SDK is mocked with a stateful in-memory map so we
 * can observe writes, reads, and TTL behaviour without touching a real
 * Redis. The `@upstash/ratelimit` mock mirrors the pattern used in
 * tests/unit/rate-limit.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Stateful in-memory Redis double ───────────────────────────────────
// vi.mock factories are hoisted to the top of the file by vitest, which
// is BEFORE any normal top-level const initialization. `vi.hoisted(...)`
// is the documented escape: its body runs in the same hoisted pass as
// the mock factory, so the mock can close over the same shared instance
// the tests later interact with.

interface MockSetOptions {
  ex?: number;
}

const { mockRedisInstance } = vi.hoisted(() => {
  class MockRedis {
    store = new Map<string, { value: unknown; ttlSeconds: number; setAt: number }>();
    getCalls: string[] = [];
    setCalls: Array<{ key: string; value: unknown; options?: { ex?: number } }> = [];

    async get<T>(key: string): Promise<T | null> {
      this.getCalls.push(key);
      const entry = this.store.get(key);
      if (!entry) return null;
      return entry.value as T;
    }

    async set(key: string, value: unknown, options?: { ex?: number }): Promise<"OK"> {
      this.setCalls.push({ key, value, options });
      this.store.set(key, {
        value,
        ttlSeconds: options?.ex ?? 0,
        setAt: Date.now(),
      });
      return "OK";
    }

    async incr() { return 0; }
    async expire() { return 1; }
    async decr() { return 0; }
    async eval() { return 0; }
  }
  return { mockRedisInstance: new MockRedis() };
});

// rate-limit.ts decides `redisConfigured` from env vars at module-load
// time, which fires BEFORE tests/setup.ts populates those env vars — so
// in tests it always reads as `false` and our cache becomes a no-op.
// Mocking the module lets us force the configured-true path with our
// in-memory Redis double, and is enough to exercise the cache behaviour.
vi.mock("@/lib/rate-limit", () => ({
  redis: mockRedisInstance,
  redisConfigured: true,
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class MockRatelimit {
    constructor() {}
    async limit() {
      return {
        success: true,
        limit: 1000,
        remaining: 999,
        reset: Date.now() + 86400000,
        pending: Promise.resolve(),
      };
    }
    static slidingWindow() { return {}; }
  },
}));

// Import AFTER the mocks so the module picks them up.
import {
  canonicalize,
  computeCacheKey,
  getCached,
  setCached,
  readThrough,
} from "@/lib/result-cache";

beforeEach(() => {
  mockRedisInstance.store.clear();
  mockRedisInstance.getCalls = [];
  mockRedisInstance.setCalls = [];
});

// ─── canonicalize ──────────────────────────────────────────────────────

describe("canonicalize", () => {
  it("sorts object keys recursively so byte-equal input always hashes the same", () => {
    const a = canonicalize({ b: 2, a: 1, c: { z: 9, a: 1 } });
    const b = canonicalize({ a: 1, c: { a: 1, z: 9 }, b: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("preserves array order (order is semantic)", () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("passes through primitives untouched", () => {
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize("brief")).toBe("brief");
    expect(canonicalize(null)).toBe(null);
    expect(canonicalize(true)).toBe(true);
  });
});

// ─── computeCacheKey ───────────────────────────────────────────────────

describe("computeCacheKey", () => {
  const baseConfig = {
    namespace: "test-node",
    promptVersion: ["model-x", "system-prompt-v1"],
  };

  it("produces v3:cache: namespaced keys", () => {
    const key = computeCacheKey({ brief: "office" }, baseConfig);
    expect(key.startsWith("v3:cache:test-node:")).toBe(true);
  });

  it("same input + same prompt -> same key", () => {
    const k1 = computeCacheKey({ brief: "abc", n: 1 }, baseConfig);
    const k2 = computeCacheKey({ n: 1, brief: "abc" }, baseConfig);
    expect(k1).toBe(k2);
  });

  it("different input -> different key", () => {
    const k1 = computeCacheKey({ brief: "abc" }, baseConfig);
    const k2 = computeCacheKey({ brief: "xyz" }, baseConfig);
    expect(k1).not.toBe(k2);
  });

  it("different prompt version -> different key (auto-invalidation)", () => {
    const k1 = computeCacheKey(
      { brief: "abc" },
      { namespace: "test-node", promptVersion: ["v1"] },
    );
    const k2 = computeCacheKey(
      { brief: "abc" },
      { namespace: "test-node", promptVersion: ["v2"] },
    );
    expect(k1).not.toBe(k2);
  });
});

// ─── get / set ─────────────────────────────────────────────────────────

describe("getCached / setCached", () => {
  it("returns null when the key is absent", async () => {
    const v = await getCached<{ x: number }>("v3:cache:test-node:missing");
    expect(v).toBeNull();
  });

  it("round-trips: set then get returns the unwrapped result", async () => {
    const config = { namespace: "ns", promptVersion: "v1" };
    const key = "v3:cache:ns:abc";
    await setCached(key, { x: 7 }, config);
    const v = await getCached<{ x: number }>(key);
    expect(v).toEqual({ x: 7 });
  });

  it("set passes the TTL through to redis.set's ex option (default 7d)", async () => {
    const config = { namespace: "ns", promptVersion: "v1" };
    await setCached("k", { hello: "world" }, config);
    const call = mockRedisInstance.setCalls.at(-1);
    expect(call?.options?.ex).toBe(7 * 24 * 60 * 60);
  });

  it("respects a custom TTL", async () => {
    const config = { namespace: "ns", promptVersion: "v1", ttlSeconds: 60 };
    await setCached("k", { hello: "world" }, config);
    const call = mockRedisInstance.setCalls.at(-1);
    expect(call?.options?.ex).toBe(60);
  });

  it("treats a Redis get failure as a miss (fail-soft)", async () => {
    const original = mockRedisInstance.get.bind(mockRedisInstance);
    mockRedisInstance.get = async () => {
      throw new Error("redis down");
    };
    try {
      const v = await getCached("any");
      expect(v).toBeNull();
    } finally {
      mockRedisInstance.get = original;
    }
  });
});

// ─── readThrough — the core contract ───────────────────────────────────

describe("readThrough", () => {
  const config = { namespace: "enrich", promptVersion: ["model", "prompt-v1"] };

  it("MISS: calls compute, stores the result, returns cacheHit=false", async () => {
    const compute = vi.fn(async () => ({ ok: true, payload: "fresh" }));
    const r = await readThrough({ config, input: { brief: "x" }, compute });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(r.cacheHit).toBe(false);
    expect(r.value).toEqual({ ok: true, payload: "fresh" });
    expect(mockRedisInstance.setCalls).toHaveLength(1);
  });

  it("HIT: skips compute and returns the stored value (cost=0 contract is caller-side)", async () => {
    const compute1 = vi.fn(async () => ({ ok: true, payload: "first" }));
    await readThrough({ config, input: { brief: "x" }, compute: compute1 });

    const compute2 = vi.fn(async () => ({ ok: true, payload: "WOULD-BE-SECOND" }));
    const r = await readThrough({ config, input: { brief: "x" }, compute: compute2 });

    expect(compute2).not.toHaveBeenCalled();
    expect(r.cacheHit).toBe(true);
    expect(r.value).toEqual({ ok: true, payload: "first" });
  });

  it("FAILURE: when compute throws, the error propagates AND nothing is stored", async () => {
    const compute = vi.fn(async () => {
      throw new Error("anthropic down");
    });
    await expect(
      readThrough({ config, input: { brief: "y" }, compute }),
    ).rejects.toThrow(/anthropic down/);
    expect(mockRedisInstance.setCalls).toHaveLength(0);
  });

  it("shouldCache=false: returns the value but does NOT write to Redis", async () => {
    const compute = vi.fn(async () => ({ ok: false, payload: null }));
    const r = await readThrough({
      config,
      input: { brief: "z" },
      compute,
      shouldCache: (v) => v.ok === true,
    });
    expect(r.cacheHit).toBe(false);
    expect(r.value.ok).toBe(false);
    expect(mockRedisInstance.setCalls).toHaveLength(0);
  });

  it("prompt-version change invalidates: same input, new version key -> recompute", async () => {
    const compute1 = vi.fn(async () => ({ payload: "v1" }));
    await readThrough({
      config: { namespace: "n", promptVersion: "v1-prompt" },
      input: { brief: "same" },
      compute: compute1,
    });

    const compute2 = vi.fn(async () => ({ payload: "v2" }));
    const r = await readThrough({
      config: { namespace: "n", promptVersion: "v2-prompt" },
      input: { brief: "same" },
      compute: compute2,
    });

    expect(compute2).toHaveBeenCalledTimes(1);
    expect(r.cacheHit).toBe(false);
    expect(r.value).toEqual({ payload: "v2" });
  });

  it("key-order in the input doesn't affect cache hits (canonicalization works end-to-end)", async () => {
    const compute1 = vi.fn(async () => ({ payload: "first" }));
    await readThrough({
      config,
      input: { brief: "abc", projectType: "office" },
      compute: compute1,
    });

    const compute2 = vi.fn(async () => ({ payload: "second" }));
    const r = await readThrough({
      config,
      input: { projectType: "office", brief: "abc" },
      compute: compute2,
    });

    expect(compute2).not.toHaveBeenCalled();
    expect(r.cacheHit).toBe(true);
    expect(r.value).toEqual({ payload: "first" });
  });

  it("RESULT_CACHE_ENABLED=false bypasses the cache entirely", async () => {
    const original = process.env.RESULT_CACHE_ENABLED;
    process.env.RESULT_CACHE_ENABLED = "false";
    try {
      const compute1 = vi.fn(async () => ({ payload: "1" }));
      await readThrough({ config, input: { brief: "kill-switch" }, compute: compute1 });
      const compute2 = vi.fn(async () => ({ payload: "2" }));
      const r = await readThrough({ config, input: { brief: "kill-switch" }, compute: compute2 });
      expect(compute2).toHaveBeenCalledTimes(1);
      expect(r.cacheHit).toBe(false);
      expect(r.value).toEqual({ payload: "2" });
      expect(mockRedisInstance.setCalls).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.RESULT_CACHE_ENABLED;
      else process.env.RESULT_CACHE_ENABLED = original;
    }
  });
});
