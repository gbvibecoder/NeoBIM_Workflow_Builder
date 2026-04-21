/**
 * Phase 1.11.1 — Runtime verification of 6 hardening fixes.
 *
 * Phase 1.11.1 shipped these fixes verified only by code inspection:
 *   (a) Stuck-job reaper cron (15-min threshold)
 *   (b) Monotonic progress updates (5→10→20→35→45→60→75→85→100)
 *   (c) 2000-char prompt cap
 *   (d) Env-var startup validation
 *   (e) Zod schema validation of LLM tool_use outputs (stage-1/3/6)
 *   (f) QStash retries=0 (no silent auto-replay on failure)
 *
 * These tests exercise each fix via the production code path with
 * appropriate mocks. If a test fails, DO NOT fix the underlying code
 * in Phase 2.0a — report as a Phase 2.0b BLOCKER.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// ─── Module-level mocks (hoisted) ───────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    vipJob: {
      updateMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    vipGeneration: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/features/floor-plan/lib/vip-pipeline/canary", () => ({
  shouldUserSeeVip: vi.fn().mockReturnValue(true),
}));

// Stage mocks — used by monotonic-progress test
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-1-prompt", () => ({
  runStage1PromptIntelligence: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-2-images", () => ({
  runStage2ParallelImageGen: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-3-jury", () => ({
  runStage3ExtractionJury: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-4-extract", () => ({
  runStage4RoomExtraction: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis", () => ({
  runStage5Synthesis: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-6-quality", () => ({
  runStage6QualityGate: vi.fn(),
}));
vi.mock("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver", () => ({
  runStage7Delivery: vi.fn(),
}));

// Upstream QStash SDK — used by retries=0 test (intercepts publishJSON).
// vi.hoisted so the mock fn is available inside the (hoisted) vi.mock factory.
const qstashMocks = vi.hoisted(() => ({
  publishJSON: vi.fn().mockResolvedValue({ messageId: "test-msg-id" }),
  verify: vi.fn().mockResolvedValue(true),
}));
vi.mock("@upstash/qstash", () => {
  class MockClient {
    publishJSON = qstashMocks.publishJSON;
  }
  class MockReceiver {
    verify = qstashMocks.verify;
  }
  return { Client: MockClient, Receiver: MockReceiver };
});

// ─── Shared env setup ───────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Reset env to original + required VIP vars for most tests
  process.env = {
    ...ORIGINAL_ENV,
    OPENAI_API_KEY: "sk-test-openai",
    ANTHROPIC_API_KEY: "sk-ant-test",
    QSTASH_TOKEN: "test-qstash-token",
    QSTASH_CURRENT_SIGNING_KEY: "test-current-key",
    QSTASH_NEXT_SIGNING_KEY: "test-next-key",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    CRON_SECRET: "test-cron-secret",
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// (a) Stuck-job reaper cron
// ═══════════════════════════════════════════════════════════════

describe("(a) Stuck-job reaper cron marks stuck RUNNING jobs as FAILED", () => {
  it("updates RUNNING jobs with startedAt older than 15 minutes", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.updateMany).mockResolvedValue({ count: 2 });

    const { GET } = await import("@/app/api/cron/cleanup-stuck-vip-jobs/route");

    const req = new Request("http://localhost/cron", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cleaned).toBe(2);

    expect(prisma.vipJob.updateMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.vipJob.updateMany).mock.calls[0][0];

    // Verify WHERE clause targets stuck RUNNING jobs
    expect(call.where).toMatchObject({
      status: "RUNNING",
      startedAt: { lt: expect.any(Date) },
    });

    // Verify cutoff is roughly 15 minutes before now (within 1s tolerance)
    const cutoff = (call.where!.startedAt as { lt: Date }).lt;
    const expectedCutoffMs = Date.now() - 15 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoffMs)).toBeLessThan(1000);

    // Verify UPDATE data flips status to FAILED with reason
    expect(call.data).toMatchObject({
      status: "FAILED",
      errorMessage: expect.stringContaining("15-minute"),
      completedAt: expect.any(Date),
    });
  });

  it("rejects requests without the correct bearer token", async () => {
    const { GET } = await import("@/app/api/cron/cleanup-stuck-vip-jobs/route");

    const req = new Request("http://localhost/cron", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const { GET } = await import("@/app/api/cron/cleanup-stuck-vip-jobs/route");
    const req = new Request("http://localhost/cron");
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

// ═══════════════════════════════════════════════════════════════
// (b) Monotonic progress updates
// ═══════════════════════════════════════════════════════════════

describe("(b) Monotonic progress 5→10→20→35→45→60→75→85→100", () => {
  it("orchestrator emits progress values 20, 35, 45, 60, 75, 85, 100 in order on happy path", async () => {
    // Setup: mock all 7 stages to return success with minimal shapes
    const mockBase64 = "iVBORw0KGgoAAAANS"; // minimal
    const mockProject = { floors: [], metadata: {} } as unknown as import("@/types/floor-plan-cad").FloorPlanProject;

    const { runStage1PromptIntelligence } = await import("@/features/floor-plan/lib/vip-pipeline/stage-1-prompt");
    const { runStage2ParallelImageGen } = await import("@/features/floor-plan/lib/vip-pipeline/stage-2-images");
    const { runStage3ExtractionJury } = await import("@/features/floor-plan/lib/vip-pipeline/stage-3-jury");
    const { runStage4RoomExtraction } = await import("@/features/floor-plan/lib/vip-pipeline/stage-4-extract");
    const { runStage5Synthesis } = await import("@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis");
    const { runStage6QualityGate } = await import("@/features/floor-plan/lib/vip-pipeline/stage-6-quality");
    const { runStage7Delivery } = await import("@/features/floor-plan/lib/vip-pipeline/stage-7-deliver");

    vi.mocked(runStage1PromptIntelligence).mockResolvedValue({
      output: {
        brief: {
          projectType: "villa",
          roomList: [{ name: "bedroom", type: "bedroom" }],
          plotWidthFt: 30,
          plotDepthFt: 40,
          facing: "north",
          styleCues: [],
          constraints: [],
          adjacencies: [],
        },
        imagePrompts: [{ model: "gpt-image-1.5", prompt: "x", styleGuide: "y" }],
      },
      metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    });

    vi.mocked(runStage2ParallelImageGen).mockResolvedValue({
      output: {
        images: [{ model: "gpt-image-1.5", base64: mockBase64, width: 1024, height: 1024, generationTimeMs: 100 }],
      },
      metrics: {
        totalCostUsd: 0.034,
        perModel: [{ model: "gpt-image-1.5", success: true, durationMs: 100, costUsd: 0.034 }],
      },
    });

    vi.mocked(runStage3ExtractionJury).mockResolvedValue({
      output: {
        verdict: {
          score: 80,
          dimensions: {
            roomCountMatch: 9, labelLegibility: 9, noDuplicateLabels: 10, orientation: 8,
            vastuCompliance: 8, wallCompleteness: 8, proportionalHierarchy: 7, extractability: 9,
          },
          reasoning: "ok",
          recommendation: "pass",
          weakAreas: [],
        },
      },
      metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    });

    vi.mocked(runStage4RoomExtraction).mockResolvedValue({
      output: {
        extraction: {
          imageSize: { width: 1024, height: 1024 },
          plotBoundsPx: null,
          rooms: [],
          issues: [],
          expectedRoomsMissing: [],
          unexpectedRoomsFound: [],
        },
      },
      metrics: { costUsd: 0 } as unknown as Awaited<ReturnType<typeof runStage4RoomExtraction>>["metrics"],
    });

    vi.mocked(runStage5Synthesis).mockResolvedValue({
      output: { project: mockProject, issues: [] },
      metrics: { roomCount: 0, wallCount: 0, doorCount: 0, windowCount: 0 } as unknown as Awaited<ReturnType<typeof runStage5Synthesis>>["metrics"],
    });

    vi.mocked(runStage6QualityGate).mockResolvedValue({
      output: {
        verdict: {
          score: 85,
          dimensions: {
            roomCountMatch: 9, noDuplicateNames: 10, dimensionPlausibility: 8,
            vastuCompliance: 8, orientationCorrect: 9, adjacencyCompliance: 8,
            connectivity: 8, exteriorWindows: 8,
          },
          reasoning: "good",
          recommendation: "pass",
          weakAreas: [],
        },
      },
      metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    });

    vi.mocked(runStage7Delivery).mockReturnValue({
      output: { project: mockProject },
    });

    // Exercise orchestrator with a progress recorder
    const { runVIPPipeline } = await import("@/features/floor-plan/lib/vip-pipeline/orchestrator");
    const progressUpdates: Array<{ progress: number; stage: string }> = [];
    const result = await runVIPPipeline({
      prompt: "3bhk villa north facing",
      parsedConstraints: {
        plot: {},
        rooms: [],
        adjacency_pairs: [],
        vastu_required: false,
        special_features: [],
      } as unknown as Parameters<typeof runVIPPipeline>[0]["parsedConstraints"],
      logContext: { requestId: "req-test", userId: "user-test" },
      onProgress: async (progress, stage) => {
        progressUpdates.push({ progress, stage });
      },
    });

    expect(result.success).toBe(true);

    const values = progressUpdates.map((u) => u.progress);

    // Strictly increasing
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }

    // Exact sequence for orchestrator stages (5 and 10 are emitted by the
    // worker route, not the orchestrator — verified separately below).
    expect(values).toEqual([20, 35, 45, 60, 75, 85, 100]);
  });

  it("worker route source contains the parse-stage progress emits (5 and 10)", () => {
    const workerPath = path.resolve(__dirname, "../../../../../app/api/vip-jobs/worker/route.ts");
    const src = fs.readFileSync(workerPath, "utf8");
    expect(src).toMatch(/progress:\s*5\b/);
    expect(src).toMatch(/progress:\s*10\b/);
  });
});

// ═══════════════════════════════════════════════════════════════
// (c) 2000-char prompt cap
// ═══════════════════════════════════════════════════════════════

describe("(c) 2000-char prompt cap at POST /api/vip-jobs", () => {
  beforeEach(async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "test-user", email: "test@test.com" },
    } as unknown as Awaited<ReturnType<typeof auth>>);

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.vipJob.count).mockResolvedValue(0);
    vi.mocked(prisma.vipJob.create).mockResolvedValue({
      id: "job-1",
      requestId: "req-1",
      status: "QUEUED",
      createdAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof prisma.vipJob.create>>);
  });

  it("rejects 2001-char prompt with HTTP 400 and 'too long' error", async () => {
    const { POST } = await import("@/app/api/vip-jobs/route");
    const req = new Request("http://localhost/api/vip-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a".repeat(2001) }),
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toMatch(/too long/i);
    expect(String(json.error)).toMatch(/2001/);
  });

  it("accepts exactly 2000-char prompt (boundary passes)", async () => {
    const { POST } = await import("@/app/api/vip-jobs/route");
    const req = new Request("http://localhost/api/vip-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a".repeat(2000) }),
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
  });

  it("accepts 1-char prompt (minimum passes)", async () => {
    const { POST } = await import("@/app/api/vip-jobs/route");
    const req = new Request("http://localhost/api/vip-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x" }),
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
  });

  it("rejects empty prompt with HTTP 400", async () => {
    const { POST } = await import("@/app/api/vip-jobs/route");
    const req = new Request("http://localhost/api/vip-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// (d) Env-var startup validation
// ═══════════════════════════════════════════════════════════════

describe("(d) VIP env-var startup validation throws on missing required vars", () => {
  beforeEach(() => {
    // Reset modules so validateVipEnvVars re-runs validation each time
    // (module-level `let validated = false;` is cached across calls)
    vi.resetModules();
  });

  it("throws when QSTASH_TOKEN is missing", async () => {
    delete process.env.QSTASH_TOKEN;
    const { validateVipEnvVars } = await import("@/features/floor-plan/lib/vip-pipeline/env-check");
    expect(() => validateVipEnvVars()).toThrow(/QSTASH_TOKEN/);
  });

  it("throws when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { validateVipEnvVars } = await import("@/features/floor-plan/lib/vip-pipeline/env-check");
    expect(() => validateVipEnvVars()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { validateVipEnvVars } = await import("@/features/floor-plan/lib/vip-pipeline/env-check");
    expect(() => validateVipEnvVars()).toThrow(/OPENAI_API_KEY/);
  });

  it("lists ALL missing vars in one error (fail-fast-all)", async () => {
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    const { validateVipEnvVars } = await import("@/features/floor-plan/lib/vip-pipeline/env-check");
    let caught: Error | null = null;
    try {
      validateVipEnvVars();
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeTruthy();
    expect(caught!.message).toMatch(/QSTASH_TOKEN/);
    expect(caught!.message).toMatch(/QSTASH_CURRENT_SIGNING_KEY/);
    expect(caught!.message).toMatch(/QSTASH_NEXT_SIGNING_KEY/);
  });

  it("succeeds (no throw) when all required vars are set", async () => {
    const { validateVipEnvVars } = await import("@/features/floor-plan/lib/vip-pipeline/env-check");
    expect(() => validateVipEnvVars()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// (e) Zod schemas validate LLM tool_use outputs
// ═══════════════════════════════════════════════════════════════

describe("(e) Zod schemas validate Stage 1/3/6 LLM tool_use outputs", () => {
  const validStage1 = {
    brief: {
      projectType: "villa",
      roomList: [{ name: "Master", type: "bedroom", approxAreaSqft: 168 }],
      plotWidthFt: 30,
      plotDepthFt: 40,
      facing: "north",
      styleCues: ["modern"],
      constraints: [],
    },
    imagePrompts: [{ model: "gpt-image-1.5", prompt: "floor plan", styleGuide: "blueprint" }],
  };

  const validStage3 = {
    dimensions: {
      roomCountMatch: 9, labelLegibility: 8, noDuplicateLabels: 10, orientation: 7,
      vastuCompliance: 8, wallCompleteness: 9, proportionalHierarchy: 8, extractability: 9,
    },
    reasoning: "Clean image, all rooms visible.",
  };

  const validStage6 = {
    dimensions: {
      roomCountMatch: 9, noDuplicateNames: 10, dimensionPlausibility: 8,
      vastuCompliance: 7, orientationCorrect: 9, connectivity: 8, exteriorWindows: 8,
    },
    reasoning: "Good layout.",
  };

  it("Stage1OutputSchema: valid input → success", async () => {
    const { Stage1OutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    expect(Stage1OutputSchema.safeParse(validStage1).success).toBe(true);
  });

  it("Stage1OutputSchema: missing roomList → failure", async () => {
    const { Stage1OutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    const bad = { ...validStage1, brief: { ...validStage1.brief, roomList: undefined } };
    expect(Stage1OutputSchema.safeParse(bad).success).toBe(false);
  });

  it("Stage1OutputSchema: wrong type for plotWidthFt → failure", async () => {
    const { Stage1OutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    const bad = { ...validStage1, brief: { ...validStage1.brief, plotWidthFt: "thirty" } };
    expect(Stage1OutputSchema.safeParse(bad).success).toBe(false);
  });

  it("Stage3RawOutputSchema: valid input → success", async () => {
    const { Stage3RawOutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    expect(Stage3RawOutputSchema.safeParse(validStage3).success).toBe(true);
  });

  it("Stage3RawOutputSchema: missing dimension → failure", async () => {
    const { Stage3RawOutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    const bad = { dimensions: { roomCountMatch: 9 }, reasoning: "" };
    expect(Stage3RawOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("Stage3RawOutputSchema: reasoning has default when missing", async () => {
    const { Stage3RawOutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    const input = { dimensions: validStage3.dimensions };
    const result = Stage3RawOutputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reasoning).toBe("");
  });

  it("Stage6RawOutputSchema: valid input → success", async () => {
    const { Stage6RawOutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    expect(Stage6RawOutputSchema.safeParse(validStage6).success).toBe(true);
  });

  it("Stage6RawOutputSchema: wrong type → failure", async () => {
    const { Stage6RawOutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    const bad = { ...validStage6, dimensions: { ...validStage6.dimensions, roomCountMatch: "nine" } };
    expect(Stage6RawOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("Stage6RawOutputSchema: missing dimension → failure", async () => {
    const { Stage6RawOutputSchema } = await import("@/features/floor-plan/lib/vip-pipeline/schemas");
    const bad = { dimensions: { roomCountMatch: 9 }, reasoning: "" };
    expect(Stage6RawOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// (f) QStash retries=0
// ═══════════════════════════════════════════════════════════════

describe("(f) QStash scheduleVipWorker publishes with retries=0", () => {
  it("publishJSON is called with retries: 0 (no silent auto-retry)", async () => {
    vi.resetModules();
    qstashMocks.publishJSON.mockClear();

    const { scheduleVipWorker } = await import("@/lib/qstash");
    const messageId = await scheduleVipWorker("test-job-id");

    expect(messageId).toBe("test-msg-id");
    expect(qstashMocks.publishJSON).toHaveBeenCalledTimes(1);
    const arg = qstashMocks.publishJSON.mock.calls[0][0];
    expect(arg).toMatchObject({
      retries: 0,
      body: { jobId: "test-job-id" },
    });
    expect(arg.url).toMatch(/\/api\/vip-jobs\/worker$/);
  });

  it("qstash.ts source file contains literal retries: 0 (static assertion)", () => {
    const qstashPath = path.resolve(__dirname, "../../../../../lib/qstash.ts");
    const src = fs.readFileSync(qstashPath, "utf8");
    expect(src).toMatch(/retries:\s*0/);
  });
});
