/**
 * /api/brief-renders/worker/render integration tests.
 *
 * Mocks Stage 3, QStash signature verification, render-worker scheduler,
 * and Prisma. Verifies the worker route's branching dispatch logic for
 * every Stage 3 result.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  verifySignatureMock,
  scheduleRenderWorkerMock,
  runStage3Mock,
  scheduleCompileWorkerMock,
  prismaFindUniqueMock,
  prismaUpdateManyMock,
  prismaExecuteRawMock,
} = vi.hoisted(() => ({
  verifySignatureMock: vi.fn(),
  scheduleRenderWorkerMock: vi.fn(),
  runStage3Mock: vi.fn(),
  scheduleCompileWorkerMock: vi.fn(),
  prismaFindUniqueMock: vi.fn(),
  prismaUpdateManyMock: vi.fn(),
  prismaExecuteRawMock: vi.fn(),
}));

vi.mock("@/lib/qstash", () => ({
  scheduleBriefRenderRenderWorker: (...args: unknown[]) =>
    scheduleRenderWorkerMock(...args),
  // Phase 5 added compile-worker dispatch — mock it so worker/render
  // route's terminal-flip path doesn't blow up when reached.
  scheduleBriefRenderCompileWorker: (...args: unknown[]) =>
    scheduleCompileWorkerMock(...args),
  verifyQstashSignature: (...args: unknown[]) =>
    verifySignatureMock(...args),
}));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/stage-3-image-gen",
  () => ({
    runStage3ImageGen: (...args: unknown[]) => runStage3Mock(...args),
  }),
);

vi.mock("@/lib/db", () => ({
  prisma: {
    briefRenderJob: {
      findUnique: prismaFindUniqueMock,
      updateMany: prismaUpdateManyMock,
    },
    $executeRaw: prismaExecuteRawMock,
  },
}));

import { POST as workerPOST } from "@/app/api/brief-renders/worker/render/route";

// ─── Helpers ──────────────────────────────────────────────────────

function makeReq(body: unknown, signature: string | null = "valid"): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders/worker/render", {
    method: "POST",
    headers: signature
      ? { "content-type": "application/json", "upstash-signature": signature }
      : { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeShot(
  ai: number,
  si: number,
  status: "pending" | "running" | "success" | "failed" = "pending",
) {
  return {
    shotIndex: ai * 4 + si,
    apartmentIndex: ai,
    shotIndexInApartment: si,
    status,
    prompt: "p",
    aspectRatio: "3:2",
    templateVersion: "v1",
    imageUrl: status === "success" ? "https://r2/img.png" : null,
    errorMessage: null,
    costUsd: status === "success" ? 0.25 : null,
    createdAt: "2026-04-28T10:00:00Z",
    startedAt: null,
    completedAt: status === "success" ? "2026-04-28T10:01:00Z" : null,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "RUNNING",
    shots: [makeShot(0, 0), makeShot(0, 1)],
    stageLog: null,
    ...overrides,
  };
}

beforeEach(() => {
  verifySignatureMock.mockReset().mockResolvedValue(true);
  scheduleRenderWorkerMock.mockReset().mockResolvedValue("msg-id");
  scheduleCompileWorkerMock.mockReset().mockResolvedValue("compile-msg-id");
  runStage3Mock.mockReset();
  prismaFindUniqueMock.mockReset();
  prismaUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
  prismaExecuteRawMock.mockReset().mockResolvedValue(1);
});

// ─── Auth + body validation ───────────────────────────────────────

describe("POST /api/brief-renders/worker/render — auth & body", () => {
  it("401 when QStash signature is invalid", async () => {
    verifySignatureMock.mockResolvedValueOnce(false);
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(401);
  });

  it("400 on bad JSON body", async () => {
    const res = await workerPOST(makeReq("{bad json"));
    expect(res.status).toBe(400);
  });

  it("400 on missing jobId", async () => {
    const res = await workerPOST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("400 when only one of (apartmentIndex, shotIndexInApartment) is supplied", async () => {
    const res = await workerPOST(makeReq({ jobId: "j", apartmentIndex: 0 }));
    expect(res.status).toBe(400);
  });

  it("404 when job not found", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(null);
    const res = await workerPOST(makeReq({ jobId: "nope" }));
    expect(res.status).toBe(404);
  });
});

// ─── Job-status guards ────────────────────────────────────────────

describe("POST /api/brief-renders/worker/render — job-status guards", () => {
  it("200 + skipped when job status is not RUNNING (e.g. CANCELLED)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(runStage3Mock).not.toHaveBeenCalled();
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });

  it("marks awaiting_compile when no pending shots remain", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(
      makeJob({
        shots: [makeShot(0, 0, "success"), makeShot(0, 1, "success")],
      }),
    );
    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(prismaUpdateManyMock).toHaveBeenCalledTimes(1);
    const updateCall = prismaUpdateManyMock.mock.calls[0][0];
    expect(updateCall.data.currentStage).toBe("awaiting_compile");
    expect(updateCall.where.status).toBe("RUNNING");
    expect(runStage3Mock).not.toHaveBeenCalled();
  });
});

// ─── Stage 3 dispatch branching ────────────────────────────────────

describe("POST /api/brief-renders/worker/render — Stage 3 dispatch branching", () => {
  it("Stage 3 success + more pending → re-enqueue without specific indices", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob()) // initial
      .mockResolvedValueOnce(
        makeJob({ shots: [makeShot(0, 0, "success"), makeShot(0, 1)] }),
      ); // post-render check
    runStage3Mock.mockResolvedValueOnce({
      status: "success",
      imageUrl: "https://r2/img.png",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
    const scheduleArgs = scheduleRenderWorkerMock.mock.calls[0];
    expect(scheduleArgs[0]).toBe("job-1");
    // No options object means find next pending — verified by absence of indices.
    if (scheduleArgs[1]) {
      expect(scheduleArgs[1].apartmentIndex).toBeUndefined();
      expect(scheduleArgs[1].shotIndexInApartment).toBeUndefined();
    }
  });

  it("Stage 3 success + no more pending → marks awaiting_compile, no re-enqueue", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(
        makeJob({ shots: [makeShot(0, 0, "success"), makeShot(0, 1, "success")] }),
      );
    runStage3Mock.mockResolvedValueOnce({
      status: "success",
      imageUrl: "https://r2/img.png",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
    // updateMany should have set awaiting_compile.
    const compileCall = prismaUpdateManyMock.mock.calls.find(
      (c) => c[0].data.currentStage === "awaiting_compile",
    );
    expect(compileCall).toBeDefined();
  });

  it("Stage 3 skipped(already_done) → re-enqueue for next pending", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(
        makeJob({ shots: [makeShot(0, 0, "success"), makeShot(0, 1)] }),
      );
    runStage3Mock.mockResolvedValueOnce({
      status: "skipped",
      reason: "already_done",
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("Stage 3 skipped(lock_busy) → re-enqueue with delay=5s, same indices", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(makeJob());
    runStage3Mock.mockResolvedValueOnce({
      status: "skipped",
      reason: "lock_busy",
    });

    const res = await workerPOST(
      makeReq({ jobId: "job-1", apartmentIndex: 0, shotIndexInApartment: 0 }),
    );
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
    const opts = scheduleRenderWorkerMock.mock.calls[0][1];
    expect(opts.delay).toBe(5);
    expect(opts.apartmentIndex).toBe(0);
    expect(opts.shotIndexInApartment).toBe(0);
  });

  it("Stage 3 skipped(job_cancelled) → no re-enqueue", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(makeJob());
    runStage3Mock.mockResolvedValueOnce({
      status: "skipped",
      reason: "job_cancelled",
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });

  it("rate_limited retryCount=0 → re-enqueue with delay=5s, retryCount=1", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(makeJob());
    runStage3Mock.mockResolvedValueOnce({
      status: "failed",
      error: "rate_limited",
      costUsd: 0,
      kind: "rate_limited",
    });

    const res = await workerPOST(
      makeReq({ jobId: "job-1", apartmentIndex: 0, shotIndexInApartment: 0 }),
    );
    expect(res.status).toBe(200);
    const opts = scheduleRenderWorkerMock.mock.calls[0][1];
    expect(opts.delay).toBe(5);
    expect(opts.retryCount).toBe(1);
  });

  it("rate_limited retryCount=1 → re-enqueue with delay=15s, retryCount=2", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(makeJob());
    runStage3Mock.mockResolvedValueOnce({
      status: "failed",
      error: "rate_limited",
      costUsd: 0,
      kind: "rate_limited",
    });

    const res = await workerPOST(
      makeReq({
        jobId: "job-1",
        apartmentIndex: 0,
        shotIndexInApartment: 0,
        retryCount: 1,
      }),
    );
    expect(res.status).toBe(200);
    const opts = scheduleRenderWorkerMock.mock.calls[0][1];
    expect(opts.delay).toBe(15);
    expect(opts.retryCount).toBe(2);
  });

  it("rate_limited retryCount=2 → re-enqueue with delay=45s, retryCount=3", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(makeJob());
    runStage3Mock.mockResolvedValueOnce({
      status: "failed",
      error: "rate_limited",
      costUsd: 0,
      kind: "rate_limited",
    });

    const res = await workerPOST(
      makeReq({
        jobId: "job-1",
        apartmentIndex: 0,
        shotIndexInApartment: 0,
        retryCount: 2,
      }),
    );
    expect(res.status).toBe(200);
    const opts = scheduleRenderWorkerMock.mock.calls[0][1];
    expect(opts.delay).toBe(45);
    expect(opts.retryCount).toBe(3);
  });

  it("rate_limited retryCount=3 → mark shot permanently failed, then continue", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob()) // initial
      .mockResolvedValueOnce(makeJob()) // markShotPermanentlyFailed read
      .mockResolvedValueOnce(
        makeJob({ shots: [makeShot(0, 0, "failed"), makeShot(0, 1)] }),
      ); // post-fail check
    runStage3Mock.mockResolvedValueOnce({
      status: "failed",
      error: "rate_limited",
      costUsd: 0,
      kind: "rate_limited",
    });

    const res = await workerPOST(
      makeReq({
        jobId: "job-1",
        apartmentIndex: 0,
        shotIndexInApartment: 0,
        retryCount: 3,
      }),
    );
    expect(res.status).toBe(200);
    // Permanently failed → executeRaw called (jsonb_set patch).
    expect(prismaExecuteRawMock).toHaveBeenCalledTimes(1);
    // Next pending exists → re-enqueue without indices.
    const reenqueue = scheduleRenderWorkerMock.mock.calls.find(
      (c) => !c[1] || (c[1].apartmentIndex === undefined && c[1].retryCount === undefined),
    );
    expect(reenqueue).toBeDefined();
  });

  it("provider failure → re-enqueue for next pending shot", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(
        makeJob({ shots: [makeShot(0, 0, "failed"), makeShot(0, 1)] }),
      );
    runStage3Mock.mockResolvedValueOnce({
      status: "failed",
      error: "provider auth",
      costUsd: 0,
      kind: "provider",
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
    // No retry indices in options for the next-shot re-enqueue.
    const opts = scheduleRenderWorkerMock.mock.calls[0][1];
    expect(opts?.apartmentIndex).toBeUndefined();
  });

  it("specified indices: targets that exact shot, then next-pending re-enqueue on success", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(
        makeJob({ shots: [makeShot(0, 0), makeShot(0, 1, "success")] }),
      );
    runStage3Mock.mockResolvedValueOnce({
      status: "success",
      imageUrl: "https://r2/img.png",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
    });

    const res = await workerPOST(
      makeReq({ jobId: "job-1", apartmentIndex: 0, shotIndexInApartment: 1 }),
    );
    expect(res.status).toBe(200);
    expect(runStage3Mock.mock.calls[0][0].apartmentIndex).toBe(0);
    expect(runStage3Mock.mock.calls[0][0].shotIndexInApartment).toBe(1);
    // After success there's still 0:0 pending → re-enqueue without indices.
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("no pending shots and no specified indices → marks awaiting_compile (no Stage 3 call)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce(
      makeJob({
        shots: [makeShot(0, 0, "success"), makeShot(0, 1, "success")],
      }),
    );

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(runStage3Mock).not.toHaveBeenCalled();
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });

  it("Stage 3 success but post-result job no longer RUNNING → no re-enqueue", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));
    runStage3Mock.mockResolvedValueOnce({
      status: "success",
      imageUrl: "https://r2/img.png",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });
});

// ─── Production hard-fail on dev escape hatch ─────────────────────

describe("POST /api/brief-renders/worker/render — security guard", () => {
  it("throws when SKIP_QSTASH_SIG_VERIFY=true in production", async () => {
    // vitest stubEnv handles the NODE_ENV proxy correctly across runtimes
    // (plain assignment trips a "non-configurable" guard in some envs).
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SKIP_QSTASH_SIG_VERIFY", "true");
    try {
      await expect(workerPOST(makeReq({ jobId: "job-1" }))).rejects.toThrow(
        /SECURITY/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
