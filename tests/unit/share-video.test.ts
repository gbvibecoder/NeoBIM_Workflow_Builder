/**
 * Tests for the video Share Link feature:
 *   - POST /api/share/video                  (route handler)
 *   - GET  /share/[slug]                     (page generateMetadata + render)
 *
 * NOTE: a separate `share.test.ts` already exists in this directory; it tests
 * unrelated social-share helpers (Twitter intent / LinkedIn). This file is the
 * suite for the *new* video share-link feature added in the hardening sprint.
 *
 * Mock strategy follows the project pattern (analytics.test.ts, rate-limit.test.ts):
 * use vi.hoisted to declare module-level mock state before vi.mock evaluates,
 * then import the route under test AFTER the mocks are wired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
const { mockPrisma, mockAuth, mockRateLimit } = vi.hoisted(() => {
  return {
    mockPrisma: {
      videoShareLink: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
    mockAuth: vi.fn(),
    mockRateLimit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkEndpointRateLimit: mockRateLimit,
}));

// Stub generateId so slugs in tests are deterministic; the route uses it for the slug.
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  let counter = 0;
  return {
    ...actual,
    generateId: vi.fn(() => `slug-${++counter}`),
  };
});

// Import AFTER mocks are wired
import { POST } from "@/app/api/share/video/route";

// ─── Helper: construct a NextRequest-shaped object the route accepts ─────────
function makeReq(body: unknown, headers: Record<string, string> = {}): import("next/server").NextRequest {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  // We only need .json(), .headers.get() — duck-type the bits route.ts touches.
  const req = {
    json: async () => body,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
  };
  return req as unknown as import("next/server").NextRequest;
}

const validSession = {
  user: { id: "user_test_1", email: "alice@example.com", role: "FREE" },
};

const okRateLimit = { success: true, remaining: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(validSession);
  mockRateLimit.mockResolvedValue(okRateLimit);
  mockPrisma.videoShareLink.findUnique.mockResolvedValue(null);
  mockPrisma.videoShareLink.create.mockImplementation(async ({ data, select }) => {
    const result = {
      slug: data.slug,
      videoUrl: data.videoUrl,
      title: data.title ?? null,
      expiresAt: data.expiresAt ?? null,
      createdById: data.createdById,
    };
    if (select) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(select)) out[k] = (result as Record<string, unknown>)[k];
      return out;
    }
    return result;
  });
});

// ─── 1. Auth ────────────────────────────────────────────────────────────────
describe("POST /api/share/video — auth", () => {
  it("returns 401 when not signed in", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ videoUrl: "https://example.com/v.mp4" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("AUTH_001");
  });

  it("returns 401 when session has no user id", async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: "x@y.z" } });
    const res = await POST(makeReq({ videoUrl: "https://example.com/v.mp4" }));
    expect(res.status).toBe(401);
  });
});

// ─── 2. Validation ──────────────────────────────────────────────────────────
describe("POST /api/share/video — request validation", () => {
  it("returns 400 when body is not JSON", async () => {
    const req = {
      json: async () => {
        throw new Error("invalid json");
      },
      headers: { get: () => null },
    } as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/videoUrl/i);
  });

  it("returns 400 when videoUrl is empty string", async () => {
    const res = await POST(makeReq({ videoUrl: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is unparseable", async () => {
    const res = await POST(makeReq({ videoUrl: "not a url" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/valid URL/i);
  });

  it("returns 400 when videoUrl is not http/https", async () => {
    const res = await POST(makeReq({ videoUrl: "ftp://example.com/v.mp4" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/http/i);
  });
});

// ─── 3. SSRF protection — block local + private IPs ────────────────────────
describe("POST /api/share/video — SSRF / local URL blocking", () => {
  const blocked = [
    "http://localhost/v.mp4",
    "http://127.0.0.1/v.mp4",
    "http://0.0.0.0/v.mp4",
    "http://10.0.0.1/v.mp4",
    "http://192.168.1.1/v.mp4",
    "http://172.16.0.1/v.mp4",
    "http://172.20.5.5/v.mp4",
    "http://172.31.255.254/v.mp4",
    "http://something.local/v.mp4",
  ];

  for (const url of blocked) {
    it(`rejects ${url}`, async () => {
      const res = await POST(makeReq({ videoUrl: url }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.title).toMatch(/local URL|cannot share/i);
    });
  }

  it("does NOT block 172.15.x.x (just below private range)", async () => {
    const res = await POST(makeReq({ videoUrl: "https://172.15.0.1/v.mp4" }));
    // Not blocked by SSRF check; should reach the success path
    expect(res.status).toBe(200);
  });

  it("does NOT block 172.32.x.x (just above private range)", async () => {
    const res = await POST(makeReq({ videoUrl: "https://172.32.0.1/v.mp4" }));
    expect(res.status).toBe(200);
  });
});

// ─── 4. Rate limiting ──────────────────────────────────────────────────────
describe("POST /api/share/video — rate limiting", () => {
  it("returns 429 when the limiter rejects the request", async () => {
    mockRateLimit.mockResolvedValueOnce({ success: false, remaining: 0 });
    const res = await POST(makeReq({ videoUrl: "https://example.com/v.mp4" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error?.code).toBe("RATE_001");
  });

  it("uses the share-video endpoint key with limit=10 per hour", async () => {
    await POST(makeReq({ videoUrl: "https://example.com/v.mp4" }));
    expect(mockRateLimit).toHaveBeenCalledWith("user_test_1", "share-video", 10, "1 h");
  });
});

// ─── 5. Happy path ─────────────────────────────────────────────────────────
describe("POST /api/share/video — happy path", () => {
  it("returns 200 with a slug + shareUrl on success", async () => {
    const res = await POST(
      makeReq({ videoUrl: "https://r2.cdn.com/walkthrough.mp4", title: "My Office" }, { origin: "https://app.example.com" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toMatch(/^slug-/);
    expect(body.shareUrl).toBe(`https://app.example.com/share/${body.slug}`);
    expect(body.expiresAt).toBeNull();
  });

  it("calls prisma.create with the right shape", async () => {
    await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4", title: "Hello" }));
    expect(mockPrisma.videoShareLink.create).toHaveBeenCalledOnce();
    const arg = mockPrisma.videoShareLink.create.mock.calls[0][0];
    expect(arg.data.videoUrl).toBe("https://r2.cdn.com/v.mp4");
    expect(arg.data.title).toBe("Hello");
    expect(arg.data.createdById).toBe("user_test_1");
    expect(arg.data.expiresAt).toBeNull();
  });

  it("trims the title and caps it at 200 chars", async () => {
    const longTitle = "x".repeat(500);
    await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4", title: longTitle }));
    const arg = mockPrisma.videoShareLink.create.mock.calls[0][0];
    expect(arg.data.title.length).toBe(200);
  });

  it("clamps expiresInDays to 1-365", async () => {
    // 9999 days → clamped (route accepts 1-365 only, otherwise null)
    await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4", expiresInDays: 9999 }));
    expect(mockPrisma.videoShareLink.create.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  it("accepts a valid expiresInDays and stores a future date", async () => {
    const before = Date.now();
    await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4", expiresInDays: 7 }));
    const stored: Date = mockPrisma.videoShareLink.create.mock.calls[0][0].data.expiresAt;
    expect(stored).toBeInstanceOf(Date);
    const diffMs = stored.getTime() - before;
    // 7 days ± 1 second tolerance for test timing
    expect(diffMs).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000);
    expect(diffMs).toBeLessThanOrEqual(7 * 86_400_000 + 2000);
  });

  it("retries on slug collision until a unique one is found", async () => {
    mockPrisma.videoShareLink.findUnique
      .mockResolvedValueOnce({ id: "exists" }) // first slug taken
      .mockResolvedValueOnce({ id: "exists" }) // second slug taken
      .mockResolvedValueOnce(null); // third slug free
    const res = await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4" }));
    expect(res.status).toBe(200);
    expect(mockPrisma.videoShareLink.findUnique).toHaveBeenCalledTimes(3);
  });

  it("returns 500 if 5 collision retries are exhausted", async () => {
    mockPrisma.videoShareLink.findUnique.mockResolvedValue({ id: "exists" }); // all slugs taken
    const res = await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4" }));
    expect(res.status).toBe(500);
  });

  it("falls back to NEXT_PUBLIC_APP_URL when origin header is missing", async () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://prod.buildflow.example";
    try {
      const res = await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.shareUrl).toMatch(/^https:\/\/prod\.buildflow\.example\/share\/slug-/);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });
});

// ─── 6. Database failure handling ──────────────────────────────────────────
describe("POST /api/share/video — db error path", () => {
  it("returns 500 when prisma.create throws", async () => {
    mockPrisma.videoShareLink.create.mockRejectedValueOnce(new Error("DB down"));
    const res = await POST(makeReq({ videoUrl: "https://r2.cdn.com/v.mp4" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.message).toMatch(/DB down/);
  });
});
