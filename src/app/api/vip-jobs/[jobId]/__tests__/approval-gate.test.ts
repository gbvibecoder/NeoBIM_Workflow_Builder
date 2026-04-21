/**
 * Phase 2.3 Workstream C — API routes for image approval gate.
 *
 * Covers POST /api/vip-jobs/[jobId]/approve
 *    and POST /api/vip-jobs/[jobId]/regenerate-image
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Hoisted module mocks — must be set before importing the routes.
vi.mock("@/lib/db", () => ({
  prisma: {
    vipJob: {
      findUnique: vi.fn(),
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

  it("returns 404 when job does not exist", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue(null);
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 403 when job belongs to a different user", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue({
      id: "j1", userId: "someone-else", status: "AWAITING_APPROVAL",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findUnique>>);
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 400 when status is not AWAITING_APPROVAL", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue({
      id: "j1", userId: "user-1", status: "RUNNING",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findUnique>>);
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not AWAITING_APPROVAL/);
  });

  it("happy path: enqueues resume worker + flips status to RUNNING", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue({
      id: "j1", userId: "user-1", status: "AWAITING_APPROVAL",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findUnique>>);
    vi.mocked(prisma.vipJob.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.vipJob.update>>);

    const { scheduleVipWorkerResume } = await import("@/lib/qstash");
    const POST = await importApprove();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });

    expect(res.status).toBe(200);
    expect(scheduleVipWorkerResume).toHaveBeenCalledWith("j1");
    expect(prisma.vipJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { status: "RUNNING", userApproval: "approved" },
    });
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

  it("returns 400 when status is not AWAITING_APPROVAL", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue({
      id: "j1", userId: "user-1", status: "COMPLETED",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findUnique>>);
    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(400);
  });

  it("happy path: enqueues regenerate worker + flags userApproval='regenerating'", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue({
      id: "j1", userId: "user-1", status: "AWAITING_APPROVAL",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findUnique>>);
    vi.mocked(prisma.vipJob.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.vipJob.update>>);

    const { scheduleVipWorkerRegenerateImage } = await import("@/lib/qstash");
    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });

    expect(res.status).toBe(200);
    expect(scheduleVipWorkerRegenerateImage).toHaveBeenCalledWith("j1");
    const updateCall = vi.mocked(prisma.vipJob.update).mock.calls[0][0];
    expect(updateCall.data).toMatchObject({ userApproval: "regenerating", progress: 20 });
  });

  it("returns 503 when the QStash scheduler throws", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.findUnique).mockResolvedValue({
      id: "j1", userId: "user-1", status: "AWAITING_APPROVAL",
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.findUnique>>);
    const { scheduleVipWorkerRegenerateImage } = await import("@/lib/qstash");
    vi.mocked(scheduleVipWorkerRegenerateImage).mockRejectedValueOnce(new Error("qstash down"));

    const POST = await importRegen();
    const res = await POST(makeReq(), { params: Promise.resolve({ jobId: "j1" }) });
    expect(res.status).toBe(503);
  });
});
