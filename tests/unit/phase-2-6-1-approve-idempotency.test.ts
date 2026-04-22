/**
 * Phase 2.6.1 hotfix — /api/vip-jobs/[jobId]/approve + /regenerate-image
 * idempotency tests.
 *
 * Invariant under test: two concurrent POSTs for the same job must not
 * both succeed in scheduling a QStash worker and must not return a
 * 400 "Job is RUNNING, not AWAITING_APPROVAL" error to the user. The
 * winning claim schedules exactly one worker; the loser gets a 200
 * {already: true}.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ───── Mocks ─────────────────────────────────────────────────────

// auth() — always returns a logged-in admin.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

// QStash schedulers — tracked with vi.fn so we can assert call counts.
const scheduleVipWorkerResume = vi.fn().mockResolvedValue("msg-resume-1");
const scheduleVipWorkerRegenerateImage = vi
  .fn()
  .mockResolvedValue("msg-regen-1");
vi.mock("@/lib/qstash", () => ({
  scheduleVipWorkerResume,
  scheduleVipWorkerRegenerateImage,
}));

// Prisma — a minimal in-memory stand-in for `vip_jobs`. updateMany
// mimics the production atomic check-and-set by filtering the single
// row in state against the predicate.
type VipJobRow = {
  id: string;
  userId: string;
  status: string;
  userApproval: string | null;
  progress?: number;
};

const state: { row: VipJobRow | null } = { row: null };

function matches(row: VipJobRow, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if ((row as unknown as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    vipJob: {
      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) {
        if (!state.row || !matches(state.row, where)) return { count: 0 };
        state.row = { ...state.row, ...(data as Partial<VipJobRow>) };
        return { count: 1 };
      },
      async findFirst({
        where,
      }: {
        where: Record<string, unknown>;
        select?: unknown;
      }) {
        if (!state.row || !matches(state.row, where)) return null;
        return { ...state.row };
      },
      async update({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) {
        if (!state.row || !matches(state.row, where)) {
          throw new Error("not found");
        }
        state.row = { ...state.row, ...(data as Partial<VipJobRow>) };
        return { ...state.row };
      },
    },
  },
}));

// ───── Fixtures ──────────────────────────────────────────────────

async function callApprove(jobId: string) {
  const { POST } = await import(
    "@/app/api/vip-jobs/[jobId]/approve/route"
  );
  const req = new Request(`http://localhost/api/vip-jobs/${jobId}/approve`, {
    method: "POST",
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ jobId }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function callRegenerate(jobId: string) {
  const { POST } = await import(
    "@/app/api/vip-jobs/[jobId]/regenerate-image/route"
  );
  const req = new Request(
    `http://localhost/api/vip-jobs/${jobId}/regenerate-image`,
    { method: "POST" },
  );
  const res = await POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ jobId }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

function seedPending() {
  state.row = {
    id: "job-1",
    userId: "user-1",
    status: "AWAITING_APPROVAL",
    userApproval: "pending",
  };
}

beforeEach(() => {
  scheduleVipWorkerResume.mockClear();
  scheduleVipWorkerRegenerateImage.mockClear();
  scheduleVipWorkerResume.mockResolvedValue("msg-resume-1");
  scheduleVipWorkerRegenerateImage.mockResolvedValue("msg-regen-1");
});

// ───── Approve ──────────────────────────────────────────────────

describe("/approve — idempotency", () => {
  it("first call succeeds: 200, schedules resume, flips status to RUNNING", async () => {
    seedPending();
    const r = await callApprove("job-1");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.status).toBe("RUNNING");
    expect(scheduleVipWorkerResume).toHaveBeenCalledTimes(1);
    expect(scheduleVipWorkerResume).toHaveBeenCalledWith("job-1");
    expect(state.row?.status).toBe("RUNNING");
    expect(state.row?.userApproval).toBe("approved");
  });

  it("second call is idempotent: 200 {already:true}, does NOT re-schedule", async () => {
    seedPending();
    const r1 = await callApprove("job-1");
    expect(r1.status).toBe(200);
    const r2 = await callApprove("job-1");
    expect(r2.status).toBe(200);
    expect(r2.body.already).toBe(true);
    expect(r2.body.status).toBe("RUNNING");
    expect(scheduleVipWorkerResume).toHaveBeenCalledTimes(1); // still only once
  });

  it("returns 400 when the job is in a state that is neither pending nor approved", async () => {
    state.row = {
      id: "job-1",
      userId: "user-1",
      status: "COMPLETED",
      userApproval: null,
    };
    const r = await callApprove("job-1");
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/not AWAITING_APPROVAL/);
    expect(scheduleVipWorkerResume).toHaveBeenCalledTimes(0);
  });

  it("returns 404 when the job does not belong to the user", async () => {
    state.row = {
      id: "job-1",
      userId: "different-user",
      status: "AWAITING_APPROVAL",
      userApproval: "pending",
    };
    const r = await callApprove("job-1");
    expect(r.status).toBe(404);
    expect(scheduleVipWorkerResume).toHaveBeenCalledTimes(0);
  });

  it("rolls the approval claim back if QStash scheduling fails", async () => {
    seedPending();
    scheduleVipWorkerResume.mockRejectedValueOnce(new Error("qstash down"));
    const r = await callApprove("job-1");
    expect(r.status).toBe(503);
    expect(String(r.body.error)).toMatch(/Failed to schedule resume/);
    // Claim rolled back so the next call can re-try cleanly.
    expect(state.row?.userApproval).toBe("pending");
    expect(state.row?.status).toBe("AWAITING_APPROVAL");

    // Retry now succeeds.
    const r2 = await callApprove("job-1");
    expect(r2.status).toBe(200);
    expect(scheduleVipWorkerResume).toHaveBeenCalledTimes(2);
  });
});

// ───── Regenerate ──────────────────────────────────────────────

describe("/regenerate-image — idempotency", () => {
  it("first call succeeds: 200, schedules regen worker, flips userApproval to 'regenerating'", async () => {
    seedPending();
    const r = await callRegenerate("job-1");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(scheduleVipWorkerRegenerateImage).toHaveBeenCalledTimes(1);
    expect(state.row?.userApproval).toBe("regenerating");
    expect(state.row?.status).toBe("AWAITING_APPROVAL");
  });

  it("second call is idempotent: 200 {already:true}, does NOT re-schedule", async () => {
    seedPending();
    const r1 = await callRegenerate("job-1");
    expect(r1.status).toBe(200);
    const r2 = await callRegenerate("job-1");
    expect(r2.status).toBe(200);
    expect(r2.body.already).toBe(true);
    expect(scheduleVipWorkerRegenerateImage).toHaveBeenCalledTimes(1);
  });

  it("rolls the regenerate claim back if QStash scheduling fails", async () => {
    seedPending();
    scheduleVipWorkerRegenerateImage.mockRejectedValueOnce(
      new Error("qstash 502"),
    );
    const r = await callRegenerate("job-1");
    expect(r.status).toBe(503);
    expect(state.row?.userApproval).toBe("pending");

    // Retry now succeeds.
    const r2 = await callRegenerate("job-1");
    expect(r2.status).toBe(200);
    expect(scheduleVipWorkerRegenerateImage).toHaveBeenCalledTimes(2);
  });

  it("approve + regenerate can't both win from 'pending' — second caller gets 400 already-claimed or idempotent response", async () => {
    seedPending();
    const approveResult = await callApprove("job-1");
    expect(approveResult.status).toBe(200);
    // Now userApproval="approved", status="RUNNING". A subsequent regen
    // attempt must NOT succeed in claiming — the row is no longer pending
    // and status is no longer AWAITING_APPROVAL.
    const regenResult = await callRegenerate("job-1");
    expect(regenResult.status).toBe(400);
    expect(String(regenResult.body.error)).toMatch(/not AWAITING_APPROVAL/);
    expect(scheduleVipWorkerRegenerateImage).toHaveBeenCalledTimes(0);
  });
});
