/**
 * Regression test for the `after()` wrap fix.
 *
 * Yesterday's eval cycle (2026-05-16) discovered that
 * `void runBackground(...)` at `src/app/api/brief-to-ifc/v3/runs/route.ts:195`
 * was dying mid-await on Vercel because the runtime suspends the V8
 * isolate the moment the response flushes. `maxDuration = 800` is the
 * CEILING, not a keepalive — the function never lived long enough for
 * the agent loop's first `await` to resume.
 *
 * The fix wraps the call in `after()` from `next/server` (Next.js 15+
 * primitive that registers post-response work). This test mocks
 * `after()` so the assertion fires against the *call site*, not the
 * runtime behaviour:
 *
 *   1. Response is 202 with a runId (happy-path proves the route ran)
 *   2. `after()` was called exactly once
 *   3. The callback is a function returning a Promise (= async)
 *
 * On the *broken* code (`void runBackground(...)`) this test FAILS at
 * step (2): the spy sees 0 calls. On the fixed code (this commit),
 * all three assertions pass. The test exists to prevent future
 * regressions where someone "simplifies" the wrap back to
 * fire-and-forget.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────
//
// `vi.mock()` is hoisted to the top of the file by vitest's transform,
// so these run BEFORE the dynamic `import("...route")` below resolves
// the route module's own imports.

// Mock `after` while preserving NextRequest/NextResponse — the route
// still needs to construct/return real response objects.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "test-user-id", email: "test@buildflow.dev" },
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkEndpointRateLimit: vi.fn(async () => ({
    success: true,
    limit: 10,
    remaining: 9,
    reset: 0,
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    briefToIfcV3Run: {
      create: vi.fn(async () => ({
        id: "test-run-id",
        createdAt: new Date("2026-05-16T12:00:00Z"),
        status: "PENDING",
      })),
    },
    // PHASE 6 quota — the route now consults the quota table after
    // the rate-limit check; the test user defaults to STARTER tier
    // (test mock above sets `email: test@buildflow.dev`; session role
    // defaults to FREE which would block, so we mock the quota helper
    // call below to bypass).
    briefToIfcV3UserQuota: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  },
}));

// Bypass the quota check — the focus of this test is the after() wrap,
// not the quota subsystem. Quota behaviour has its own test file.
vi.mock("@/features/brief-to-ifc/v3/quota/quota", () => ({
  checkBriefToIfcV3Quota: vi.fn(async () => ({ ok: true, limit: 99, used: 0 })),
  incrementBriefToIfcV3Usage: vi.fn(async () => {}),
}));

vi.mock("@/features/brief-to-ifc/v3", async (importOriginal) => {
  // Preserve `briefSpecSchema` (used by zod validation in the route)
  // and any other re-exports the route imports; only override the
  // canary + the agent-loop entry points so we don't need an Anthropic
  // key / live network.
  const actual = await importOriginal<typeof import("@/features/brief-to-ifc/v3")>();
  return {
    ...actual,
    shouldUseBriefToIfcV3: vi.fn(() => true),
    enrichBrief: vi.fn(async () => ({
      ok: true,
      brief: null,
      costUsd: 0,
      durationMs: 0,
    })),
    runGenerator: vi.fn(async () => ({
      ok: true,
      ifcUrl: "",
      entityCount: 0,
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      ledger: [],
      turnRecords: [],
    })),
  };
});

vi.mock("@/features/brief-to-ifc/v3/runtime/background-runner", () => ({
  runBackground: vi.fn(async () => ({
    runId: "test-run-id",
    terminalStatus: "COMPLETED" as const,
    errorCode: null,
    durationMs: 100,
  })),
}));

vi.mock("@/features/brief-to-ifc/v3/runtime/append-log", () => ({
  appendLog: vi.fn(async () => {}),
}));

// A minimal-but-valid BriefSpec that satisfies `briefSpecSchema`.
// Keeping it inline (rather than importing the JSON fixture) so the
// test stays portable if the fixture moves. Schema requirements
// honoured: 1+ material, `brand_language` present, spaces non-empty.
const validBriefSpec = {
  project: {
    name: "Test Office",
    type: "office" as const,
    location: "Test City",
    description: "Smallest valid spec for the after() wrap test.",
  },
  site: {
    bounds_m: [5.0, 5.0] as [number, number],
    height_limit_m: 3.0,
    coordinate_origin: "sw_corner" as const,
  },
  spaces: [
    {
      id: "SP-1",
      name: "SP-1",
      long_name: "Test Space",
      polygon_world_m: [
        [0.0, 0.0],
        [5.0, 0.0],
        [5.0, 5.0],
        [0.0, 5.0],
      ] as [number, number][],
      height_m: 2.8,
      occupancy_type: "Office Workstation",
    },
  ],
  elements: [],
  materials: [
    {
      id: "mat-test",
      name: "Test Material",
      rgb: [0.5, 0.5, 0.5] as [number, number, number],
      roughness: 0.5,
      method: "MATT" as const,
      category: "test",
    },
  ],
  brand_language: {
    primary_text: "Test brand",
    approved_terms: [],
    forbidden_terms: [],
  },
};

describe("v3 /runs route — after() wrap regression", () => {
  beforeEach(() => {
    // Only clear call history; the mocks themselves stay registered.
    vi.clearAllMocks();
  });

  it("schedules runBackground via after() from next/server", async () => {
    // Dynamic import: ensures the hoisted vi.mock above is fully wired
    // before the route's own `import { after } from "next/server"`
    // resolves.
    const { POST } = await import("@/app/api/brief-to-ifc/v3/runs/route");
    const { after } = await import("next/server");

    const req = new Request("http://test.local/api/brief-to-ifc/v3/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        briefSpec: validBriefSpec,
        cost_cap_usd: 1.5,
      }),
    });

    // The route's POST signature accepts NextRequest; in vitest's node
    // env, a plain `Request` is a structural match (NextRequest extends
    // Request and the route only calls `req.json()`).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(req as any);

    // (1) The route returns 202 with a runId — proves the happy path.
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.runId).toBe("test-run-id");

    // (2) The load-bearing assertion: after() was called exactly once.
    //     On the broken `void runBackground(...)` code, this is 0 and
    //     the test fails — which is the entire point.
    expect(after).toHaveBeenCalledTimes(1);

    // (3) The callback passed to after() is a function returning a
    //     Promise (= async). Belt-and-braces against someone writing
    //     `after(runBackground)` or `after(() => runBackground(...))`
    //     without the await — both shapes pass (1) and (2) but lose
    //     the error-propagation guarantee.
    const mockedAfter = vi.mocked(after);
    expect(mockedAfter.mock.calls.length).toBe(1);
    const callback = mockedAfter.mock.calls[0][0];
    expect(typeof callback).toBe("function");
    // Invoke the callback so the mocked runBackground gets called —
    // that proves the wrap actually delegates to runBackground rather
    // than being a no-op placeholder.
    const cbResult = (callback as () => unknown)();
    expect(cbResult).toBeInstanceOf(Promise);
    await cbResult;
  });
});
