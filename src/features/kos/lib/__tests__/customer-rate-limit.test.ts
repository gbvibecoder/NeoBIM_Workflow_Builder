import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Module-level mocks for Upstash. The actual SDK is not exercised in
// these tests — we control limit() results and Redis init via spies.
// `vi.hoisted` is required because vi.mock factories are hoisted ABOVE
// regular `const` declarations; a bare `const limitMock = vi.fn()`
// would land in TDZ when the factory closure first evaluates.
const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: class FakeRedis {
    static fromEnv() {
      return new FakeRedis();
    }
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(limit: number, window: string) {
      return { _limit: limit, _window: window };
    }
    limit = limitMock;
    constructor(_args: unknown) {
      void _args;
    }
  },
}));

import {
  checkUploadRateLimit,
  resolveClientIp,
  _resetRateLimitForTest,
} from "../customer-rate-limit";

beforeEach(() => {
  _resetRateLimitForTest();
  limitMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkUploadRateLimit", () => {
  it("returns ok:true unconditionally when NODE_ENV !== 'production'", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const result = await checkUploadRateLimit({
      customerId: "c_1",
      ip: "1.2.3.4",
    });
    expect(result.ok).toBe(true);
    // Limiters never invoked in dev mode
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("fails open when Upstash env vars are missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const result = await checkUploadRateLimit({
      customerId: "c_1",
      ip: "1.2.3.4",
    });
    expect(result.ok).toBe(true);
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("fails open when Redis throws during check", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    limitMock.mockRejectedValueOnce(new Error("redis network broke"));
    const result = await checkUploadRateLimit({
      customerId: "c_1",
      ip: "1.2.3.4",
    });
    expect(result.ok).toBe(true);
  });

  it("denies when customer limiter says success: false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    limitMock
      .mockResolvedValueOnce({ success: false, remaining: 0, reset: 9999 }) // customer
      .mockResolvedValueOnce({ success: true, remaining: 10, reset: 0 }); // ip
    const result = await checkUploadRateLimit({
      customerId: "c_1",
      ip: "1.2.3.4",
    });
    expect(result.ok).toBe(false);
    expect(result.dimension).toBe("customer");
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBe(9999);
  });

  it("denies when ip limiter says success: false (customer ok)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    limitMock
      .mockResolvedValueOnce({ success: true, remaining: 4, reset: 0 }) // customer
      .mockResolvedValueOnce({ success: false, remaining: 0, reset: 5555 }); // ip
    const result = await checkUploadRateLimit({
      customerId: "c_1",
      ip: "1.2.3.4",
    });
    expect(result.ok).toBe(false);
    expect(result.dimension).toBe("ip");
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBe(5555);
  });

  it("returns ok:true when both limiters succeed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    limitMock
      .mockResolvedValueOnce({ success: true, remaining: 4, reset: 0 })
      .mockResolvedValueOnce({ success: true, remaining: 9, reset: 0 });
    const result = await checkUploadRateLimit({
      customerId: "c_1",
      ip: "1.2.3.4",
    });
    expect(result.ok).toBe(true);
  });
});

describe("resolveClientIp", () => {
  function buildReq(headers: Record<string, string>): Request {
    return new Request("http://x/y", { headers });
  }

  it("returns x-real-ip when present", () => {
    const req = buildReq({ "x-real-ip": "192.168.1.1" });
    expect(resolveClientIp(req)).toBe("192.168.1.1");
  });

  it("trims whitespace from x-real-ip", () => {
    const req = buildReq({ "x-real-ip": "  192.168.1.1  " });
    expect(resolveClientIp(req)).toBe("192.168.1.1");
  });

  it("falls back to first x-forwarded-for entry", () => {
    const req = buildReq({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3" });
    expect(resolveClientIp(req)).toBe("10.0.0.1");
  });

  it("returns 'unknown' when neither header is present", () => {
    const req = buildReq({});
    expect(resolveClientIp(req)).toBe("unknown");
  });

  it("prefers x-real-ip over x-forwarded-for when both are present", () => {
    const req = buildReq({
      "x-real-ip": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2",
    });
    expect(resolveClientIp(req)).toBe("1.1.1.1");
  });

  it("falls through empty x-real-ip to x-forwarded-for", () => {
    const req = buildReq({
      "x-real-ip": "",
      "x-forwarded-for": "3.3.3.3",
    });
    expect(resolveClientIp(req)).toBe("3.3.3.3");
  });
});
