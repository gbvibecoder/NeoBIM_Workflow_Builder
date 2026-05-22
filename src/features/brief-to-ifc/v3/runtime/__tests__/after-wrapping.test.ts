/**
 * Phase gamma.2: QStash dispatch regression test (replaces after() test).
 *
 * The route now dispatches the agent build via QStash instead of after().
 * This test verifies:
 *   1. Response is 202 with a runId
 *   2. scheduleAgentBuildWorker was called with the runId
 *
 * On the broken (after-based) code this test would fail because
 * scheduleAgentBuildWorker wouldn't be called.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

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
      update: vi.fn(async () => ({})),
    },
    briefToIfcV3UserQuota: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/features/brief-to-ifc/v3/quota/quota", () => ({
  checkBriefToIfcV3Quota: vi.fn(async () => ({ ok: true, limit: 99, used: 0 })),
  incrementBriefToIfcV3Usage: vi.fn(async () => {}),
}));

vi.mock("@/features/brief-to-ifc/v3", async (importOriginal) => {
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
  };
});

vi.mock("@/features/brief-to-ifc/v3/runtime/append-log", () => ({
  appendLog: vi.fn(async () => {}),
}));

// Mock QStash — the key assertion target
vi.mock("@/lib/qstash", () => ({
  scheduleAgentBuildWorker: vi.fn(async () => "msg-test-123"),
}));

const validBriefSpec = {
  project: {
    name: "Test Office",
    type: "office" as const,
    location: "Test City",
    description: "Smallest valid spec for the QStash dispatch test.",
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

describe("v3 /runs route — QStash dispatch (gamma.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches agent build via QStash scheduleAgentBuildWorker", async () => {
    const { POST } = await import("@/app/api/brief-to-ifc/v3/runs/route");
    const { scheduleAgentBuildWorker } = await import("@/lib/qstash");

    const req = new Request("http://test.local/api/brief-to-ifc/v3/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        briefSpec: validBriefSpec,
        cost_cap_usd: 1.5,
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(req as any);

    // (1) The route returns 202 with a runId
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.runId).toBe("test-run-id");

    // (2) QStash was called with a payload containing the runId
    expect(scheduleAgentBuildWorker).toHaveBeenCalledTimes(1);
    const callArg = (scheduleAgentBuildWorker as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toMatchObject({ runId: "test-run-id" });
  });
});
