/**
 * Phase 2.4 GA.3 (Phase 2.3 port): Verify the QStash signature bypass is
 * opt-in only on /api/vip-jobs/worker/resume (Phase 2.3 Workstream C).
 *
 * - SKIP_QSTASH_SIG_VERIFY=true + NODE_ENV=production → throws
 * - SKIP_QSTASH_SIG_VERIFY=true + NODE_ENV=development → skips verify
 * - SKIP_QSTASH_SIG_VERIFY unset + NODE_ENV=production → verifies
 * - SKIP_QSTASH_SIG_VERIFY=false + NODE_ENV=development → verifies
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const qstashMocks = vi.hoisted(() => ({
  verify: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

const qstashClientMocks = vi.hoisted(() => ({
  publishJSON: vi.fn(),
}));

vi.mock("@upstash/qstash", () => {
  class Receiver {
    verify = qstashMocks.verify;
  }
  class Client {
    publishJSON = qstashClientMocks.publishJSON;
  }
  return { Receiver, Client };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    vipJob: {
      findUnique: prismaMocks.findUnique,
      update: prismaMocks.update,
    },
  },
}));

vi.mock("@/features/floor-plan/lib/vip-pipeline/orchestrator-gated", () => ({
  runVIPPipelinePhaseB: vi.fn(async () => ({
    success: true,
    project: { floors: [], metadata: {} },
    qualityScore: 80,
  })),
}));

vi.mock("@/features/floor-plan/lib/structured-parser", () => ({
  parseConstraints: vi.fn(async () => ({
    constraints: { plot: { width_ft: 40, depth_ft: 40 }, rooms: [] },
  })),
}));

describe("Phase 2.4 GA.3 — QStash signature bypass is opt-in only (worker/resume)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QSTASH_TOKEN = "test-token";
    process.env.QSTASH_CURRENT_SIGNING_KEY = "cur";
    process.env.QSTASH_NEXT_SIGNING_KEY = "next";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function callResume(body: unknown, signature?: string): Promise<Response> {
    const { POST } = await import("@/app/api/vip-jobs/worker/resume/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signature) headers["upstash-signature"] = signature;
    const req = new Request("http://localhost/api/vip-jobs/worker/resume", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return POST(req as unknown as Parameters<typeof POST>[0]);
  }

  it("throws when SKIP_QSTASH_SIG_VERIFY=true in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.SKIP_QSTASH_SIG_VERIFY = "true";
    await expect(callResume({ jobId: "job_1" })).rejects.toThrow(
      /SKIP_QSTASH_SIG_VERIFY must not be true in production/,
    );
    expect(qstashMocks.verify).not.toHaveBeenCalled();
  });

  it("skips verification when SKIP_QSTASH_SIG_VERIFY=true in development", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.SKIP_QSTASH_SIG_VERIFY = "true";
    prismaMocks.findUnique.mockResolvedValue(null);
    const res = await callResume({ jobId: "job_1" });
    // Job not found → 404, but verify was NOT called (signature skipped).
    expect(res.status).toBe(404);
    expect(qstashMocks.verify).not.toHaveBeenCalled();
  });

  it("verifies signature when SKIP_QSTASH_SIG_VERIFY is unset in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.SKIP_QSTASH_SIG_VERIFY;
    qstashMocks.verify.mockResolvedValue(false);
    const res = await callResume({ jobId: "job_1" }, "sig-v1=bad");
    expect(res.status).toBe(401);
    expect(qstashMocks.verify).toHaveBeenCalled();
  });

  it("verifies signature when SKIP_QSTASH_SIG_VERIFY=false in development", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.SKIP_QSTASH_SIG_VERIFY = "false";
    qstashMocks.verify.mockResolvedValue(false);
    const res = await callResume({ jobId: "job_1" }, "sig-v1=bad");
    expect(res.status).toBe(401);
    expect(qstashMocks.verify).toHaveBeenCalled();
  });
});
