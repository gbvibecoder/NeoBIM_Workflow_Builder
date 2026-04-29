/**
 * Phase 5 supplements to the Phase 4 worker-render tests.
 *
 * Phase 4's `worker-render.test.ts` covered the per-shot dispatch
 * branching (rate-limit retry, lock_busy, etc). Phase 5 modifies the
 * "no more pending shots" terminal action — `markAwaitingCompile()`
 * is replaced with `transitionToAwaitingCompileAndDispatch()`, which
 * flips currentStage AND dispatches the compile worker (with revert
 * on QStash failure).
 *
 * These tests assert the new dispatch behaviour without re-running
 * the full Phase 4 matrix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  verifySignatureMock,
  scheduleRenderWorkerMock,
  scheduleCompileWorkerMock,
  runStage3Mock,
  prismaFindUniqueMock,
  prismaUpdateManyMock,
  prismaExecuteRawMock,
} = vi.hoisted(() => ({
  verifySignatureMock: vi.fn(),
  scheduleRenderWorkerMock: vi.fn(),
  scheduleCompileWorkerMock: vi.fn(),
  runStage3Mock: vi.fn(),
  prismaFindUniqueMock: vi.fn(),
  prismaUpdateManyMock: vi.fn(),
  prismaExecuteRawMock: vi.fn(),
}));

vi.mock("@/lib/qstash", () => ({
  scheduleBriefRenderRenderWorker: (...args: unknown[]) =>
    scheduleRenderWorkerMock(...args),
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

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders/worker/render", {
    method: "POST",
    headers: { "content-type": "application/json", "upstash-signature": "v" },
    body: JSON.stringify(body),
  });
}

function makeShot(ai: number, si: number, status = "pending") {
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

beforeEach(() => {
  verifySignatureMock.mockReset().mockResolvedValue(true);
  scheduleRenderWorkerMock.mockReset().mockResolvedValue("msg-id");
  scheduleCompileWorkerMock.mockReset().mockResolvedValue("compile-msg-id");
  runStage3Mock.mockReset();
  prismaFindUniqueMock.mockReset();
  prismaUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
  prismaExecuteRawMock.mockReset().mockResolvedValue(1);
});

// ─── No-more-pending → dispatch compile ───────────────────────────

describe("worker/render — Phase 5 compile dispatch", () => {
  it("invocation finds no pending shots → flip awaiting_compile + dispatch compile worker", async () => {
    // Single invocation (no body indices) where all shots are already done.
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      shots: [makeShot(0, 0, "success"), makeShot(0, 1, "success")],
      stageLog: null,
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleCompileWorkerMock).toHaveBeenCalledTimes(1);
    expect(scheduleCompileWorkerMock).toHaveBeenCalledWith("job-1");
    expect(runStage3Mock).not.toHaveBeenCalled();

    // Forward updateMany set currentStage=awaiting_compile, progress=80.
    const flipCall = prismaUpdateManyMock.mock.calls[0][0];
    expect(flipCall.where.status).toBe("RUNNING");
    expect(flipCall.data.currentStage).toBe("awaiting_compile");
    expect(flipCall.data.progress).toBe(80);
  });

  it("flip count=0 (race with cancel) → no compile dispatch", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      shots: [makeShot(0, 0, "success")],
      stageLog: null,
    });
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleCompileWorkerMock).not.toHaveBeenCalled();
  });

  it("compile dispatch failure → revert currentStage + 500", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      shots: [makeShot(0, 0, "success")],
      stageLog: null,
    });
    scheduleCompileWorkerMock.mockRejectedValueOnce(new Error("qstash down"));
    // Two updateMany calls: forward flip + revert.
    prismaUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(500);

    const revertCall = prismaUpdateManyMock.mock.calls[1][0];
    expect(revertCall.where.currentStage).toBe("awaiting_compile");
    expect(revertCall.data.currentStage).toBe("rendering");
    expect(revertCall.data.progress).toBe(35);
  });

  it("Stage 3 success on last shot → re-checks pending → dispatches compile", async () => {
    prismaFindUniqueMock
      .mockResolvedValueOnce({
        id: "job-1",
        status: "RUNNING",
        shots: [makeShot(0, 0)],
        stageLog: null,
      }) // initial
      .mockResolvedValueOnce({
        status: "RUNNING",
        shots: [makeShot(0, 0, "success")],
      }); // post-shot
    runStage3Mock.mockResolvedValueOnce({
      status: "success",
      imageUrl: "https://r2/img.png",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
    });

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(200);
    expect(scheduleCompileWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("revert is conditional on currentStage=awaiting_compile (won't reset cancelled)", async () => {
    prismaFindUniqueMock.mockResolvedValueOnce({
      id: "job-1",
      status: "RUNNING",
      shots: [makeShot(0, 0, "success")],
      stageLog: null,
    });
    scheduleCompileWorkerMock.mockRejectedValueOnce(new Error("qstash down"));
    prismaUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // revert no-op (job moved past)

    const res = await workerPOST(makeReq({ jobId: "job-1" }));
    expect(res.status).toBe(500);
    // Revert call still happened with the conditional where.
    const revertCall = prismaUpdateManyMock.mock.calls[1][0];
    expect(revertCall.where.currentStage).toBe("awaiting_compile");
  });
});
