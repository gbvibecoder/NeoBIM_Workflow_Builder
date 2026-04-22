/**
 * Phase 2.3 Workstream C — API routes for image approval gate.
 *
 * Covers POST /api/vip-jobs/[jobId]/approve
 *    and POST /api/vip-jobs/[jobId]/regenerate-image
 *
 * Updated in Phase 2.6.1: both routes now use an atomic `updateMany`
 * claim on userApproval (pending → approved | regenerating) instead of
 * the old check-then-act (findUnique → if-status → update). The tests
 * here were updated to exercise that new surface. Broader concurrency
 * + idempotency coverage lives in tests/unit/phase-2-6-1-approve-
 * idempotency.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Hoisted module mocks — must be set before importing the routes.
vi.mock("@/lib/db", () => ({
  prisma: {
    vipJob: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/qstash", () => ({
  scheduleVipWorkerResume: vi.fn().mockResolvedValue("msg-resume"),
  scheduleVipWorkerRegenerateImage: vi.fn().mockResolvedValue("msg-regen"),
}));

// Build a minimal NextRequest-like object for the handlers.
function makeReq(): NextRequest {
  return new Request("http://localhost/api/vip-jobs/j1/approve", { method: "POST" }) as unknown as NextRequest;
}

async function importApprove() {
  return (await import("@/app/api/vip-jobs/[jobId]/approve/route")).POST;
}
async function importRegen() {
  return (await import("@/app/api/vip-jobs/[jobId]/regenerate-image/route")).POST;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { auth } = await import("@/lib/auth");
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as unknown as Awaited<ReturnType<typeof auth>>);
  // Default: re-arm QStash mocks so a failing .mockRejectedValueOnce from
  // a prior test doesn't leak into the next.
  const qstash = await import("@/lib/qstash");
  vi.mocked(qstash.scheduleVipWorkerResume).mockResolvedValue("msg-resume");
  vi.mocked(qstash.scheduleVipWorkerRegenerateImage).mockResolvedValue("msg-regen");
});

// ─── Approve route ───────────────────────────────────────────────

describe("Phase 2.3 — POST /api/vip-jobs/[jobId]/approve", () => {
  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as unknown as Awaited<ReturnType<typeof auth>>);
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when job does not exist (or does not belong to the caller — existence hidden)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.vipJob.findFirst).mockResolvedValue(null);
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when status is not AWAITING_APPROVAL and not already approved", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.vipJob.findFirst).mockResolvedValue({
      status: "RUNNING", userApproval: null,
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findFirst>>);
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not AWAITING_APPROVAL/);
  });

  it("returns 200 {already:true} when a prior click has already claimed approval (idempotent)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.vipJob.findFirst).mockResolvedValue({
      status: "RUNNING", userApproval: "approved",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findFirst>>);
    const { scheduleVipWorkerResume } = await import("@/lib/qstash");
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already).toBe(true);
    expect(scheduleVipWorkerResume).not.toHaveBeenCalled();
  });

  it("happy path: claims the transition, enqueues resume worker, flips status to RUNNING", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.vipJob.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.vipJob.update>>);

    const { scheduleVipWorkerResume } = await import("@/lib/qstash");
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });

    expect(res.status).toBe(200);
    expect(scheduleVipWorkerResume).toHaveBeenCalledWith("j1");
    expect(prisma.vipJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { status: "RUNNING" },
    });
    const claimCall = vi.mocked(prisma.vipJob.updateMany).mock.calls[0][0];
    expect(claimCall.where).toMatchObject({
      id: "j1", userId: "user-1", status: "AWAITING_APPROVAL", userApproval: "pending",
    });
    expect(claimCall.data).toMatchObject({ userApproval: "approved" });
  });
});

// ─── Regenerate-image route ──────────────────────────────────────

describe("Phase 2.3 — POST /api/vip-jobs/[jobId]/regenerate-image", () => {
  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as unknown as Awaited<ReturnType<typeof auth>>);
    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when status is not AWAITING_APPROVAL and not already regenerating", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.vipJob.findFirst).mockResolvedValue({
      status: "COMPLETED", userApproval: null,
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findFirst>>);
    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(400);
  });

  it("happy path: claims the transition, enqueues regenerate worker, flags userApproval='regenerating'", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 1 });

    const { scheduleVipWorkerRegenerateImage } = await import("@/lib/qstash");
    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });

    expect(res.status).toBe(200);
    expect(scheduleVipWorkerRegenerateImage).toHaveBeenCalledWith("j1");
    const claimCall = vi.mocked(prisma.vipJob.updateMany).mock.calls[0][0];
    expect(claimCall.data).toMatchObject({ userApproval: "regenerating", progress: 20 });
  });

  it("returns 503 when the QStash scheduler throws — and rolls the claim back", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 1 });
    const { scheduleVipWorkerRegenerateImage } = await import("@/lib/qstash");
    vi.mocked(scheduleVipWorkerRegenerateImage).mockRejectedValueOnce(new Error("qstash down"));

    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(503);

    // Rollback claim call: second updateMany flips regenerating→pending
    const calls = vi.mocked(prisma.vipJob.updateMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const rollback = calls[calls.length - 1][0];
    expect(rollback.where).toMatchObject({ userApproval: "regenerating" });
    expect(rollback.data).toMatchObject({ userApproval: "pending" });
  });
});
