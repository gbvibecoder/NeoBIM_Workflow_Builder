import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Use vi.hoisted to declare mocks before hoisting ─────────────────────────
const { mockRedisGet, mockRedisSet, mockLimit, mockTrackRateLimitHit } =
  vi.hoisted(() => ({
    mockRedisGet: vi.fn(),
    mockRedisSet: vi.fn(),
    mockLimit: vi.fn(),
    mockTrackRateLimitHit: vi.fn(),
  }));

vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    constructor() {}
    get = mockRedisGet;
    set = mockRedisSet;
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class MockRatelimit {
    constructor() {}
    limit = mockLimit;
    static slidingWindow(requests: number, window: string) {
      return { requests, window };
    }
  },
}));

vi.mock("@/lib/analytics", () => ({
  trackRateLimitHit: (...args: unknown[]) => mockTrackRateLimitHit(...args),
}));

import {
  getClientIp,
  logRateLimitHit,
  isExecutionAlreadyCounted,
  checkEndpointRateLimit,
  isAdminUser,
} from "@/lib/rate-limit";

describe("Rate Limit — getClientIp", () => {
  it("should extract first IP from x-forwarded-for header", () => {
    const req = {
      headers: {
        get: (name: string) =>
          name === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8, 9.10.11.12" : null,
      },
    };
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("should return single IP when no comma in x-forwarded-for", () => {
    const req = {
      headers: {
        get: (name: string) =>
          name === "x-forwarded-for" ? "192.168.1.1" : null,
      },
    };
    expect(getClientIp(req)).toBe("192.168.1.1");
  });

  it('should return "anonymous" when no x-forwarded-for header', () => {
    const req = {
      headers: {
        get: () => null,
      },
    };
    expect(getClientIp(req)).toBe("anonymous");
  });

  it("should trim whitespace from IP", () => {
    const req = {
      headers: {
        get: (name: string) =>
          name === "x-forwarded-for" ? "  10.0.0.1  , 10.0.0.2" : null,
      },
    };
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it('should return "anonymous" for empty x-forwarded-for', () => {
    const req = {
      headers: {
        get: (name: string) => (name === "x-forwarded-for" ? "" : null),
      },
    };
    expect(getClientIp(req)).toBe("anonymous");
  });
});

describe("Rate Limit — logRateLimitHit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should log a warning message to console", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logRateLimitHit("user-1", "FREE", 2);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[RATE_LIMIT]")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("user-1")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("FREE")
    );
    warnSpy.mockRestore();
  });

  it("should call trackRateLimitHit when remaining is 0", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logRateLimitHit("user-1", "FREE", 0);

    expect(mockTrackRateLimitHit).toHaveBeenCalledWith(
      "user-1",
      "execute-node",
      "FREE"
    );
    vi.restoreAllMocks();
  });

  it("should NOT call trackRateLimitHit when remaining > 0", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logRateLimitHit("user-1", "FREE", 5);

    expect(mockTrackRateLimitHit).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("should NOT call trackRateLimitHit when remaining is 1", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logRateLimitHit("user-1", "PRO", 1);

    expect(mockTrackRateLimitHit).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("Rate Limit — isExecutionAlreadyCounted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return false for empty executionId", async () => {
    const result = await isExecutionAlreadyCounted("user-1", "");
    expect(result).toBe(false);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it("should return false on first call (not yet counted)", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");

    const result = await isExecutionAlreadyCounted("user-1", "exec-123");

    expect(result).toBe(false);
    expect(mockRedisGet).toHaveBeenCalledWith("exec-seen:user-1:exec-123");
    expect(mockRedisSet).toHaveBeenCalledWith(
      "exec-seen:user-1:exec-123",
      "1",
      { ex: 86400 }
    );
  });

  it("should return true when execution was already counted", async () => {
    mockRedisGet.mockResolvedValue("1");

    const result = await isExecutionAlreadyCounted("user-1", "exec-123");

    expect(result).toBe(true);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("should return false on Redis error (fail open)", async () => {
    mockRedisGet.mockRejectedValue(new Error("Redis connection lost"));

    const result = await isExecutionAlreadyCounted("user-1", "exec-456");

    expect(result).toBe(false);
  });
});

describe("Rate Limit — checkEndpointRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return success when rate limit allows", async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 15 });

    const result = await checkEndpointRateLimit("user-1", "ai-chat");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(15);
  });

  it("should return failure when rate limit exceeded", async () => {
    mockLimit.mockResolvedValue({ success: false, remaining: 0 });

    const result = await checkEndpointRateLimit("user-1", "ai-chat");

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should allow through in dev mode on Redis error", async () => {
    const origEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    mockLimit.mockRejectedValue(new Error("Redis unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkEndpointRateLimit("user-1", "ai-chat");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(999);

    (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
    vi.restoreAllMocks();
  });

  it("should fail closed in production on Redis error", async () => {
    const origEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    mockLimit.mockRejectedValue(new Error("Redis unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkEndpointRateLimit("user-1", "ai-chat");

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);

    (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
    vi.restoreAllMocks();
  });

  it("should accept custom maxRequests and window", async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 49 });

    const result = await checkEndpointRateLimit(
      "user-1",
      "parse-ifc",
      50,
      "5 m"
    );

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(49);
  });

  it("should use default maxRequests=20 and window='1 m'", async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 19 });

    const result = await checkEndpointRateLimit("user-1", "some-endpoint");

    expect(result.success).toBe(true);
  });
});

describe("Rate Limit — isAdminUser", () => {
  it("should return false for undefined email", () => {
    expect(isAdminUser(undefined)).toBe(false);
  });

  it("should return false for non-admin email", () => {
    expect(isAdminUser("regular@example.com")).toBe(false);
  });

  it("should return true for admin email from ADMIN_EMAILS env", () => {
    expect(isAdminUser("admin@test.com")).toBe(true);
  });

  it("should handle case-insensitive comparison", () => {
    expect(isAdminUser("ADMIN@TEST.COM")).toBe(true);
  });

  it("should return false when ADMIN_EMAILS is not set", () => {
    const orig = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    expect(isAdminUser("admin@test.com")).toBe(false);
    process.env.ADMIN_EMAILS = orig;
  });
});
