/**
 * Brief-to-Renders API integration tests.
 *
 * Mocks: auth, canary, prisma, qstash, rate-limit, orchestrator.
 * Drives each route's POST/GET/DELETE handlers via plain Web Request /
 * NextRequest fixtures — no HTTP server.
 *
 * Coverage spans all five endpoints (POST/GET collection, GET/DELETE
 * single, POST approve, worker callback). 30+ scenarios total.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ─────────────────────────────────────────────────

const {
  authMock,
  canaryMock,
  rateLimitMock,
  scheduleWorkerMock,
  scheduleRenderWorkerMock,
  verifySignatureMock,
  orchestratorMock,
  prismaFindFirstMock,
  prismaFindUniqueMock,
  prismaFindManyMock,
  prismaCountMock,
  prismaCreateMock,
  prismaUpdateMock,
  prismaUpdateManyMock,
  prismaUserFindUniqueMock,
  isPlatformAdminMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  canaryMock: vi.fn(),
  rateLimitMock: vi.fn(),
  scheduleWorkerMock: vi.fn(),
  scheduleRenderWorkerMock: vi.fn(),
  verifySignatureMock: vi.fn(),
  orchestratorMock: vi.fn(),
  prismaFindFirstMock: vi.fn(),
  prismaFindUniqueMock: vi.fn(),
  prismaFindManyMock: vi.fn(),
  prismaCountMock: vi.fn(),
  prismaCreateMock: vi.fn(),
  prismaUpdateMock: vi.fn(),
  prismaUpdateManyMock: vi.fn(),
  prismaUserFindUniqueMock: vi.fn(),
  isPlatformAdminMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/canary",
  () => ({
    shouldUserSeeBriefRenders: (...args: unknown[]) => canaryMock(...args),
  }),
);

vi.mock("@/lib/rate-limit", () => ({
  checkEndpointRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("@/lib/qstash", () => ({
  scheduleBriefRenderWorker: (...args: unknown[]) =>
    scheduleWorkerMock(...args),
  // Phase 4 added the per-shot render worker dispatch; the approve
  // route now invokes it after the status flip succeeds.
  scheduleBriefRenderRenderWorker: (...args: unknown[]) =>
    scheduleRenderWorkerMock(...args),
  verifyQstashSignature: (...args: unknown[]) =>
    verifySignatureMock(...args),
}));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/orchestrator",
  () => ({
    runBriefRenderOrchestrator: (...args: unknown[]) =>
      orchestratorMock(...args),
  }),
);

vi.mock("@/lib/db", () => ({
  prisma: {
    briefRenderJob: {
      findFirst: prismaFindFirstMock,
      findUnique: prismaFindUniqueMock,
      findMany: prismaFindManyMock,
      count: prismaCountMock,
      create: prismaCreateMock,
      update: prismaUpdateMock,
      updateMany: prismaUpdateManyMock,
    },
    // Phase 6 admin-bypass + quota check both read `user.role`. The
    // mock is hoisted so individual tests can override (admin tests
    // set TEAM_ADMIN; rate-limit / quota tests stick with the default
    // FREE so the gate actually fires).
    user: {
      findUnique: prismaUserFindUniqueMock,
    },
  },
}));

// `isPlatformAdmin` is the env-based admin signal. Default false so
// FREE users get the rate-limit / quota gate; admin-specific tests
// override.
vi.mock("@/lib/platform-admin", () => ({
  isPlatformAdmin: (...args: unknown[]) => isPlatformAdminMock(...args),
}));

// ─── Routes under test ────────────────────────────────────────────

import { POST as collectionPOST, GET as collectionGET } from "@/app/api/brief-renders/route";
import { GET as singleGET, DELETE as singleDELETE } from "@/app/api/brief-renders/[jobId]/route";
import { POST as approvePOST } from "@/app/api/brief-renders/[jobId]/approve/route";
import { POST as workerPOST } from "@/app/api/brief-renders/worker/route";

// ─── Helpers ──────────────────────────────────────────────────────

const SESSION_OK = { user: { id: "user-A", email: "alice@example.com" } };
const VALID_BRIEF_URL =
  "https://buildflow-files.acct123.r2.cloudflarestorage.com/briefs/2026/04/28/abc.pdf";

function postCollection(
  body: Record<string, unknown> | string | null,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getCollection(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/brief-renders${query}`);
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    userId: "user-A",
    requestId: "req-1",
    briefUrl: VALID_BRIEF_URL,
    status: "QUEUED",
    progress: 0,
    currentStage: null,
    specResult: null,
    shots: null,
    pdfUrl: null,
    errorMessage: null,
    costUsd: 0,
    startedAt: null,
    completedAt: null,
    pausedAt: null,
    userApproval: null,
    stageLog: null,
    createdAt: new Date("2026-04-28T10:00:00Z"),
    updatedAt: new Date("2026-04-28T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  canaryMock.mockReset();
  rateLimitMock.mockReset();
  scheduleWorkerMock.mockReset();
  scheduleRenderWorkerMock.mockReset();
  scheduleRenderWorkerMock.mockResolvedValue("render-msg-id");
  verifySignatureMock.mockReset();
  orchestratorMock.mockReset();
  prismaFindFirstMock.mockReset();
  prismaFindUniqueMock.mockReset();
  prismaFindManyMock.mockReset();
  prismaCountMock.mockReset();
  prismaCreateMock.mockReset();
  prismaUserFindUniqueMock.mockReset();
  // Default to STARTER so quota gates pass (FREE has briefRendersPerMonth=0
  // and would block creation). Admin-bypass tests override with TEAM_ADMIN /
  // PLATFORM_ADMIN as needed.
  prismaUserFindUniqueMock.mockResolvedValue({ role: "STARTER" });
  isPlatformAdminMock.mockReset();
  isPlatformAdminMock.mockReturnValue(false);
  prismaUpdateMock.mockReset();
  prismaUpdateManyMock.mockReset();

  // Sensible defaults — individual tests override.
  authMock.mockResolvedValue(SESSION_OK);
  canaryMock.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ success: true, remaining: 9 });
  scheduleWorkerMock.mockResolvedValue("msg-id");
  verifySignatureMock.mockResolvedValue(true);
  prismaCountMock.mockResolvedValue(0);
  prismaCreateMock.mockResolvedValue(makeJob());
  prismaFindUniqueMock.mockResolvedValue(null);
  prismaFindFirstMock.mockResolvedValue(null);
  prismaFindManyMock.mockResolvedValue([]);
  prismaUpdateManyMock.mockResolvedValue({ count: 1 });
  prismaUpdateMock.mockResolvedValue(makeJob());
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/brief-renders
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/brief-renders", () => {
  it("401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await collectionPOST(postCollection({ briefUrl: VALID_BRIEF_URL }));
    expect(res.status).toBe(401);
  });

  it("403 when canary returns false", async () => {
    canaryMock.mockReturnValueOnce(false);
    const res = await collectionPOST(postCollection({ briefUrl: VALID_BRIEF_URL }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("BRIEF_RENDERS_NOT_AVAILABLE");
  });

  it("429 when rate-limit exceeded", async () => {
    rateLimitMock.mockResolvedValueOnce({ success: false, remaining: 0 });
    const res = await collectionPOST(postCollection({ briefUrl: VALID_BRIEF_URL }));
    expect(res.status).toBe(429);
  });

  it("400 when body is invalid JSON", async () => {
    const res = await collectionPOST(postCollection("{ broken json"));
    expect(res.status).toBe(400);
  });

  it("400 when briefUrl is missing", async () => {
    const res = await collectionPOST(postCollection({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VAL_004");
  });

  it("400 when briefUrl is not from R2", async () => {
    const res = await collectionPOST(
      postCollection({ briefUrl: "https://malicious.example/brief.pdf" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BRIEF_RENDERS_INVALID_URL");
  });

  it("429 when concurrency cap reached (≥2 active jobs)", async () => {
    prismaCountMock.mockResolvedValueOnce(2);
    const res = await collectionPOST(postCollection({ briefUrl: VALID_BRIEF_URL }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("BRIEF_RENDERS_CONCURRENCY_LIMIT");
  });

  it("201 happy path — creates job and dispatches QStash", async () => {
    const res = await collectionPOST(postCollection({ briefUrl: VALID_BRIEF_URL }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.jobId).toBe("job-1");
    expect(body.status).toBe("QUEUED");
    expect(scheduleWorkerMock).toHaveBeenCalledWith("job-1");
    expect(prismaCreateMock).toHaveBeenCalledTimes(1);
  });

  it("503 when QStash dispatch throws (job still created)", async () => {
    scheduleWorkerMock.mockRejectedValueOnce(new Error("qstash down"));
    const res = await collectionPOST(postCollection({ briefUrl: VALID_BRIEF_URL }));
    expect(res.status).toBe(503);
    expect(prismaCreateMock).toHaveBeenCalledTimes(1);
  });

  it("Idempotency-Key first call → creates a new job (201)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(null);
    const res = await collectionPOST(
      postCollection({ briefUrl: VALID_BRIEF_URL }, {
        "idempotency-key": "abc-123",
      }),
    );
    expect(res.status).toBe(201);
    expect(prismaCreateMock).toHaveBeenCalledTimes(1);
  });

  it("Idempotency-Key repeat call from same user → returns existing job (200)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(
      makeJob({ status: "AWAITING_APPROVAL" }),
    );
    const res = await collectionPOST(
      postCollection({ briefUrl: VALID_BRIEF_URL }, {
        "idempotency-key": "abc-123",
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaCreateMock).not.toHaveBeenCalled();
    expect(scheduleWorkerMock).not.toHaveBeenCalled();
  });

  it("Idempotency-Key different user → does NOT collide (different requestId hash)", async () => {
    // Same key, different userId → hash differs → no row found → fresh create.
    authMock.mockResolvedValueOnce({ user: { id: "user-B", email: "bob@example.com" } });
    prismaFindUniqueMock.mockResolvedValueOnce(null);
    const res = await collectionPOST(
      postCollection({ briefUrl: VALID_BRIEF_URL }, {
        "idempotency-key": "abc-123",
      }),
    );
    expect(res.status).toBe(201);
    expect(prismaCreateMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/brief-renders
// ═══════════════════════════════════════════════════════════════════

describe("GET /api/brief-renders", () => {
  it("401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await collectionGET(getCollection());
    expect(res.status).toBe(401);
  });

  it("returns empty list when user has no jobs", async () => {
    prismaFindManyMock.mockResolvedValueOnce([]);
    const res = await collectionGET(getCollection());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
  });

  it("returns nextCursor when over-fetched limit + 1", async () => {
    // Default limit=20; if we return 21 rows the route trims to 20 and
    // surfaces the 20th id as nextCursor.
    const rows = Array.from({ length: 21 }, (_, i) =>
      makeJob({ id: `job-${i}` }),
    );
    prismaFindManyMock.mockResolvedValueOnce(rows);
    const res = await collectionGET(getCollection());
    const body = await res.json();
    expect(body.jobs.length).toBe(20);
    expect(body.nextCursor).toBe("job-19");
  });

  it("scopes findMany to the requesting user (no leakage)", async () => {
    await collectionGET(getCollection());
    expect(prismaFindManyMock).toHaveBeenCalledTimes(1);
    expect(prismaFindManyMock.mock.calls[0][0].where.userId).toBe("user-A");
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/brief-renders/[jobId]
// ═══════════════════════════════════════════════════════════════════

describe("GET /api/brief-renders/:jobId", () => {
  it("401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await singleGET(getCollection(), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("404 when job belongs to a different user", async () => {
    // findFirst({where: {id, userId}}) returns null because userId mismatch.
    prismaFindFirstMock.mockResolvedValueOnce(null);
    const res = await singleGET(getCollection(), {
      params: Promise.resolve({ jobId: "job-foreign" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 when job does not exist", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(null);
    const res = await singleGET(getCollection(), {
      params: Promise.resolve({ jobId: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("200 happy path with full payload (specResult + shots + stageLog)", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(
      makeJob({
        status: "AWAITING_APPROVAL",
        specResult: { projectTitle: "Marx12" },
        shots: [{ shotIndex: 0 }],
        stageLog: [{ stage: 1, name: "Spec Extract", status: "success" }],
      }),
    );
    const res = await singleGET(getCollection(), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.specResult).toBeDefined();
    expect(body.shots).toBeDefined();
    expect(body.stageLog).toBeDefined();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/brief-renders/[jobId]
// ═══════════════════════════════════════════════════════════════════

describe("DELETE /api/brief-renders/:jobId", () => {
  it("404 when job belongs to a different user", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(null);
    const res = await singleDELETE(getCollection(), {
      params: Promise.resolve({ jobId: "job-foreign" }),
    });
    expect(res.status).toBe(404);
  });

  it("409 when job is already terminal (updateMany count=0)", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(makeJob({ status: "COMPLETED" }));
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await singleDELETE(getCollection(), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("BRIEF_RENDERS_ALREADY_TERMINAL");
  });

  it("happy path — flips to CANCELLED with conditional where-clause", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(makeJob({ status: "RUNNING" }));
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    prismaFindUniqueMock.mockResolvedValueOnce(
      makeJob({ status: "CANCELLED", completedAt: new Date() }),
    );
    const res = await singleDELETE(getCollection(), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");
    // Verify the conditional `where` clause filtered by valid statuses.
    const updateCall = prismaUpdateManyMock.mock.calls[0][0];
    expect(updateCall.where.status).toEqual({
      in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL"],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/brief-renders/[jobId]/approve
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/brief-renders/:jobId/approve", () => {
  it("404 when job belongs to a different user", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(null);
    const res = await approvePOST(postCollection(null), {
      params: Promise.resolve({ jobId: "job-foreign" }),
    });
    expect(res.status).toBe(404);
  });

  it("409 when status is not AWAITING_APPROVAL (updateMany count=0)", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(makeJob({ status: "RUNNING" }));
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await approvePOST(postCollection(null), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("BRIEF_RENDERS_NOT_AWAITING_APPROVAL");
  });

  it("happy path — flips to RUNNING and sets userApproval=approved", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(
      makeJob({ status: "AWAITING_APPROVAL" }),
    );
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    prismaFindUniqueMock.mockResolvedValueOnce(
      makeJob({ status: "RUNNING", userApproval: "approved" }),
    );
    const res = await approvePOST(postCollection(null), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("RUNNING");
    expect(body.userApproval).toBe("approved");
    // Verify the conditional update filtered on AWAITING_APPROVAL.
    const updateCall = prismaUpdateManyMock.mock.calls[0][0];
    expect(updateCall.where.status).toBe("AWAITING_APPROVAL");
    expect(updateCall.data.userApproval).toBe("approved");
  });

  it("double-approve → 409 (loud, not silent success)", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(makeJob({ status: "RUNNING" }));
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await approvePOST(postCollection(null), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
  });

  it("race — status flips to CANCELLED during approve → 409", async () => {
    prismaFindFirstMock.mockResolvedValueOnce(
      makeJob({ status: "AWAITING_APPROVAL" }),
    );
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await approvePOST(postCollection(null), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/brief-renders/worker
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/brief-renders/worker", () => {
  function makeWorkerReq(body: unknown, signature: string | null = "valid-sig"): NextRequest {
    return new NextRequest("http://localhost/api/brief-renders/worker", {
      method: "POST",
      headers: signature
        ? { "content-type": "application/json", "upstash-signature": signature }
        : { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("401 when QStash signature is invalid", async () => {
    verifySignatureMock.mockResolvedValueOnce(false);
    const res = await workerPOST(makeWorkerReq({ jobId: "job-1" }));
    expect(res.status).toBe(401);
  });

  it("400 when body is invalid JSON", async () => {
    const res = await workerPOST(makeWorkerReq("{broken"));
    expect(res.status).toBe(400);
  });

  it("happy path — orchestrator called, 200 with status", async () => {
    orchestratorMock.mockResolvedValueOnce({
      status: "AWAITING_APPROVAL",
      spec: { projectTitle: "x" },
      shots: [],
      costUsd: 0.045,
    });
    const res = await workerPOST(makeWorkerReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("AWAITING_APPROVAL");
    expect(orchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("orchestrator throws → 200 returned (no QStash retry)", async () => {
    orchestratorMock.mockRejectedValueOnce(new Error("orchestrator boom"));
    const res = await workerPOST(makeWorkerReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("FAILED");
    expect(body.error).toContain("orchestrator boom");
  });
});
