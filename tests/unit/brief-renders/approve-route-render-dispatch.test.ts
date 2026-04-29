/**
 * Phase 4 supplements to the Phase 3 approve-route tests.
 *
 * Phase 3's `tests/integration/brief-renders-api.test.ts` already covers
 * auth/canary/ownership/409. Phase 4 adds the render-worker dispatch
 * and the revert-on-failure path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  canaryMock,
  scheduleRenderWorkerMock,
  prismaFindFirstMock,
  prismaFindUniqueMock,
  prismaUpdateManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  canaryMock: vi.fn(),
  scheduleRenderWorkerMock: vi.fn(),
  prismaFindFirstMock: vi.fn(),
  prismaFindUniqueMock: vi.fn(),
  prismaUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/canary",
  () => ({
    shouldUserSeeBriefRenders: (...args: unknown[]) => canaryMock(...args),
  }),
);

vi.mock("@/lib/qstash", () => ({
  scheduleBriefRenderRenderWorker: (...args: unknown[]) =>
    scheduleRenderWorkerMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    briefRenderJob: {
      findFirst: prismaFindFirstMock,
      findUnique: prismaFindUniqueMock,
      updateMany: prismaUpdateManyMock,
    },
  },
}));

import { POST as approvePOST } from "@/app/api/brief-renders/[jobId]/approve/route";

const SESSION = { user: { id: "user-A", email: "alice@example.com" } };
const params = { params: Promise.resolve({ jobId: "job-1" }) };

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(SESSION);
  canaryMock.mockReset().mockReturnValue(true);
  scheduleRenderWorkerMock.mockReset().mockResolvedValue("msg-id");
  prismaFindFirstMock.mockReset().mockResolvedValue({
    id: "job-1",
    status: "AWAITING_APPROVAL",
  });
  prismaFindUniqueMock.mockReset().mockResolvedValue({
    id: "job-1",
    status: "RUNNING",
    userApproval: "approved",
    currentStage: "rendering",
    progress: 35,
    updatedAt: new Date(),
  });
  prismaUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
});

function makeReq(): NextRequest {
  return new NextRequest("http://localhost/api/brief-renders/job-1/approve", {
    method: "POST",
  });
}

describe("POST /api/brief-renders/:jobId/approve — Phase 4 render-dispatch wiring", () => {
  it("approve success → dispatches render worker exactly once", async () => {
    const res = await approvePOST(makeReq(), params);
    expect(res.status).toBe(200);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledTimes(1);
    expect(scheduleRenderWorkerMock).toHaveBeenCalledWith("job-1");
  });

  it("approve sets currentStage='rendering' and progress=35 on the status flip", async () => {
    await approvePOST(makeReq(), params);
    const flipCall = prismaUpdateManyMock.mock.calls[0][0];
    expect(flipCall.data.currentStage).toBe("rendering");
    expect(flipCall.data.progress).toBe(35);
    expect(flipCall.data.userApproval).toBe("approved");
  });

  it("approve race (status not AWAITING_APPROVAL) → no dispatch", async () => {
    prismaUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await approvePOST(makeReq(), params);
    expect(res.status).toBe(409);
    expect(scheduleRenderWorkerMock).not.toHaveBeenCalled();
  });

  it("QStash dispatch failure → revert status to AWAITING_APPROVAL + 503", async () => {
    scheduleRenderWorkerMock.mockRejectedValueOnce(new Error("qstash down"));
    // Two updateMany calls expected: forward flip + revert.
    prismaUpdateManyMock
      .mockResolvedValueOnce({ count: 1 }) // forward flip
      .mockResolvedValueOnce({ count: 1 }); // revert

    const res = await approvePOST(makeReq(), params);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("BRIEF_RENDERS_QSTASH_FAILED");

    // Revert call shape — conditional on RUNNING + userApproval=approved.
    expect(prismaUpdateManyMock).toHaveBeenCalledTimes(2);
    const revertCall = prismaUpdateManyMock.mock.calls[1][0];
    expect(revertCall.where.status).toBe("RUNNING");
    expect(revertCall.where.userApproval).toBe("approved");
    expect(revertCall.data.status).toBe("AWAITING_APPROVAL");
    expect(revertCall.data.userApproval).toBe("pending");
  });

  it("revert is conditional — won't reset a job that's been cancelled mid-flight", async () => {
    // The conditional `where: status: 'RUNNING' AND userApproval: 'approved'`
    // protects against reverting a job whose status moved past RUNNING
    // (e.g. user cancelled). The route doesn't try to detect this — the
    // count: 0 from updateMany means the revert was a no-op, which is
    // fine. The 503 is still returned to the caller.
    scheduleRenderWorkerMock.mockRejectedValueOnce(new Error("qstash down"));
    prismaUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // revert returned 0 — already CANCELLED

    const res = await approvePOST(makeReq(), params);
    expect(res.status).toBe(503);
  });
});
