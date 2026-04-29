/**
 * Brief-to-Renders orchestrator state-machine tests.
 *
 * Mocks prisma + Stage 1 + Stage 2 so the orchestrator's transition
 * logic is the only thing under test. Covers:
 *   • Happy path QUEUED → RUNNING → AWAITING_APPROVAL
 *   • Idempotency (already AWAITING_APPROVAL / COMPLETED / FAILED / CANCELLED)
 *   • Stage 1 caching (no double-charge on retry)
 *   • Cancellation between stages
 *   • Race-loss on the transition where-clause
 *   • Stage failure → FAILED with code + userMessage
 *   • Job not found → throws
 *   • Cost increment correctness
 *   • progress / currentStage / pausedAt / userApproval transitions
 *   • startedAt preservation across retry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BriefRenderJob, BriefRenderJobStatus, PrismaClient } from "@prisma/client";

import {
  EmptyBriefSpecError,
} from "@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen";
import { InvalidSpecError } from "@/features/brief-renders/services/brief-pipeline/errors";

// ─── Hoisted mocks ─────────────────────────────────────────────────

const { runStage1Mock, runStage2Mock } = vi.hoisted(() => ({
  runStage1Mock: vi.fn(),
  runStage2Mock: vi.fn(),
}));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/stage-1-spec-extract",
  () => ({
    runStage1SpecExtract: runStage1Mock,
  }),
);

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen",
  async () => {
    // Re-export the typed errors from the real module so tests can use
    // them with `instanceof` while still mocking `runStage2PromptGen`.
    const actual = await vi.importActual<
      typeof import("@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen")
    >("@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen");
    return {
      ...actual,
      runStage2PromptGen: runStage2Mock,
    };
  },
);

import {
  runBriefRenderOrchestrator,
  JobNotFoundError,
} from "@/features/brief-renders/services/brief-pipeline/orchestrator";

// ─── Prisma mock factory ───────────────────────────────────────────

interface PrismaMockHandle {
  prisma: PrismaClient;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
}

function makePrismaMock(): PrismaMockHandle {
  const findUnique = vi.fn();
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    briefRenderJob: { findUnique, update, updateMany },
  } as unknown as PrismaClient;
  return { prisma, findUnique, update, updateMany };
}

function makeJob(overrides: Partial<BriefRenderJob> = {}): BriefRenderJob {
  // Cast through a minimal record because we don't model every Prisma
  // field; the orchestrator only reads the listed columns.
  const base = {
    id: "job-1",
    userId: "user-1",
    requestId: "req-1",
    briefUrl: "https://r2.example/briefs/x.pdf",
    status: "QUEUED" as BriefRenderJobStatus,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  return base as unknown as BriefRenderJob;
}

const VALID_SPEC = {
  projectTitle: "Marx12",
  projectLocation: null,
  projectType: null,
  baseline: {
    visualStyle: null,
    materialPalette: null,
    lightingBaseline: null,
    cameraBaseline: null,
    qualityTarget: null,
    additionalNotes: null,
  },
  apartments: [],
  referenceImageUrls: [],
};

const VALID_SHOTS = [
  {
    shotIndex: 0,
    apartmentIndex: 0,
    shotIndexInApartment: 0,
    status: "pending" as const,
    prompt: "test",
    aspectRatio: "3:2",
    templateVersion: "v1",
    imageUrl: null,
    errorMessage: null,
    costUsd: null,
    createdAt: "2026-04-28T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
  },
];

beforeEach(() => {
  runStage1Mock.mockReset();
  runStage2Mock.mockReset();
});

// ─── Happy path ────────────────────────────────────────────────────

describe("orchestrator — happy path", () => {
  it("QUEUED → RUNNING → AWAITING_APPROVAL with both stages run", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockResolvedValueOnce({
      spec: VALID_SPEC,
      referenceImages: [],
      pageCount: 5,
      costUsd: 0.045,
      tokensIn: 1000,
      tokensOut: 500,
    });
    runStage2Mock.mockReturnValueOnce({
      shots: VALID_SHOTS,
      totalShots: 1,
      totalApartments: 1,
    });

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });

    expect(result.status).toBe("AWAITING_APPROVAL");
    if (result.status === "AWAITING_APPROVAL") {
      expect(result.spec.projectTitle).toBe("Marx12");
      expect(result.shots.length).toBe(1);
    }
    expect(runStage1Mock).toHaveBeenCalledTimes(1);
    expect(runStage2Mock).toHaveBeenCalledTimes(1);

    // Ensure status transitions used updateMany with conditional where.
    const claimCall = m.updateMany.mock.calls[0][0];
    expect(claimCall.where.status).toEqual({ in: ["QUEUED", "RUNNING"] });
    expect(claimCall.data.status).toBe("RUNNING");
    expect(claimCall.data.progress).toBe(5);

    const handoffCall = m.updateMany.mock.calls[1][0];
    expect(handoffCall.where.status).toBe("RUNNING");
    expect(handoffCall.data.status).toBe("AWAITING_APPROVAL");
    expect(handoffCall.data.userApproval).toBe("pending");
    expect(handoffCall.data.progress).toBe(30);
    expect(handoffCall.data.pausedAt).toBeInstanceOf(Date);
  });

  it("preserves an existing startedAt across re-entry (does not overwrite)", async () => {
    const earlierStart = new Date("2026-04-28T09:00:00.000Z");
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({ status: "RUNNING", startedAt: earlierStart }),
    );
    runStage1Mock.mockResolvedValueOnce({
      spec: VALID_SPEC,
      referenceImages: [],
      pageCount: 5,
      costUsd: 0.045,
      tokensIn: 1000,
      tokensOut: 500,
    });
    runStage2Mock.mockReturnValueOnce({
      shots: VALID_SHOTS,
      totalShots: 1,
      totalApartments: 1,
    });

    await runBriefRenderOrchestrator({ jobId: "job-1", prisma: m.prisma });

    const claimCall = m.updateMany.mock.calls[0][0];
    expect(claimCall.data.startedAt).toBe(earlierStart);
  });

  it("Stage 1 cost increment is atomic (`{ increment: ... }`)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockResolvedValueOnce({
      spec: VALID_SPEC,
      referenceImages: [],
      pageCount: 5,
      costUsd: 0.045,
      tokensIn: 1000,
      tokensOut: 500,
    });
    runStage2Mock.mockReturnValueOnce({
      shots: VALID_SHOTS,
      totalShots: 1,
      totalApartments: 1,
    });

    await runBriefRenderOrchestrator({ jobId: "job-1", prisma: m.prisma });

    const stage1PersistCall = m.update.mock.calls[0][0];
    expect(stage1PersistCall.data.costUsd).toEqual({ increment: 0.045 });
    expect(stage1PersistCall.data.specResult).toEqual(VALID_SPEC);
    expect(stage1PersistCall.data.progress).toBe(20);
  });
});

// ─── Idempotency — already-terminal / already-paused states ─────────

describe("orchestrator — idempotency", () => {
  it("AWAITING_APPROVAL with cached specResult + shots → returns cached without re-running", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({
        status: "AWAITING_APPROVAL",
        specResult: VALID_SPEC,
        shots: VALID_SHOTS,
        costUsd: 0.045,
      }),
    );

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });

    expect(result.status).toBe("AWAITING_APPROVAL");
    if (result.status === "AWAITING_APPROVAL") {
      expect(result.costUsd).toBe(0.045);
    }
    expect(runStage1Mock).not.toHaveBeenCalled();
    expect(runStage2Mock).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("COMPLETED → returns terminal without re-running", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "COMPLETED" }));
    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("COMPLETED");
    expect(runStage1Mock).not.toHaveBeenCalled();
  });

  it("FAILED → returns terminal without re-running", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({ status: "FAILED", errorMessage: "boom" }),
    );
    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.errorMessage).toBe("boom");
    }
    expect(runStage1Mock).not.toHaveBeenCalled();
  });

  it("CANCELLED → returns CANCELLED without running anything", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));
    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("CANCELLED");
    expect(runStage1Mock).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("Stage 1 cached, Stage 2 not → skips Stage 1, runs Stage 2 only", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({
        status: "RUNNING",
        specResult: VALID_SPEC,
        shots: null,
      }),
    );
    runStage2Mock.mockReturnValueOnce({
      shots: VALID_SHOTS,
      totalShots: 1,
      totalApartments: 1,
    });

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });

    expect(result.status).toBe("AWAITING_APPROVAL");
    expect(runStage1Mock).not.toHaveBeenCalled();
    expect(runStage2Mock).toHaveBeenCalledTimes(1);
  });
});

// ─── Race-loss on conditional updates ───────────────────────────────

describe("orchestrator — race conditions", () => {
  it("claim updateMany returns 0 → exits gracefully via refetched state", async () => {
    const m = makePrismaMock();
    // First findUnique sees QUEUED.
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    // Claim updateMany returns 0 (status changed externally).
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    // Refetch sees CANCELLED.
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("CANCELLED");
    expect(runStage1Mock).not.toHaveBeenCalled();
  });

  it("cancellation BETWEEN stages 1 and 2 → exits with CANCELLED", async () => {
    const m = makePrismaMock();
    m.findUnique
      // initial load
      .mockResolvedValueOnce(makeJob({ status: "QUEUED" }))
      // post-Stage-1 recheck → CANCELLED
      .mockResolvedValueOnce({ status: "CANCELLED" } as unknown as BriefRenderJob);
    runStage1Mock.mockResolvedValueOnce({
      spec: VALID_SPEC,
      referenceImages: [],
      pageCount: 5,
      costUsd: 0.045,
      tokensIn: 1000,
      tokensOut: 500,
    });

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("CANCELLED");
    expect(runStage2Mock).not.toHaveBeenCalled();
  });

  it("handoff updateMany returns 0 (status changed during Stage 2) → CANCELLED", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob({ status: "QUEUED" }))
      // post-Stage-1 recheck still RUNNING (no cancel yet)
      .mockResolvedValueOnce({ status: "RUNNING" } as unknown as BriefRenderJob)
      // race-loss refetch shows CANCELLED
      .mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));
    runStage1Mock.mockResolvedValueOnce({
      spec: VALID_SPEC,
      referenceImages: [],
      pageCount: 5,
      costUsd: 0.045,
      tokensIn: 1000,
      tokensOut: 500,
    });
    runStage2Mock.mockReturnValueOnce({
      shots: VALID_SHOTS,
      totalShots: 1,
      totalApartments: 1,
    });
    // First updateMany (claim) succeeds; second (handoff) returns 0.
    m.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("CANCELLED");
  });
});

// ─── Errors ────────────────────────────────────────────────────────

describe("orchestrator — errors", () => {
  it("job not found → throws JobNotFoundError", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(null);
    await expect(
      runBriefRenderOrchestrator({ jobId: "missing", prisma: m.prisma }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it("Stage 1 throws InvalidSpecError → marks FAILED with the specific message (not the canned userMessage)", async () => {
    // Per `feedback_specific_errors.md`: orchestrator must propagate
    // the technical `err.message` into `Job.errorMessage` so banners
    // and admin panels show actionable detail without a second tool.
    // The previous behaviour replaced the message with the friendly
    // `userMessage` ("malformed specification…"), losing the schema
    // path that pinpoints what's wrong.
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockRejectedValueOnce(
      new InvalidSpecError("schema fail", [{ path: "x", message: "y" }]),
    );

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.errorCode).toBe("INVALID_SPEC");
      expect(result.errorMessage).toContain("schema fail");
      expect(result.errorMessage).toContain("InvalidSpecError");
    }

    // FAILED transition should use updateMany with terminal-protection.
    const failCall = m.updateMany.mock.calls.find(
      (c) => c[0].data.status === "FAILED",
    );
    expect(failCall).toBeDefined();
    expect(failCall![0].where.status).toEqual({
      in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL"],
    });
  });

  it("Stage 2 throws EmptyBriefSpecError → marks FAILED", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockResolvedValueOnce({
      spec: VALID_SPEC,
      referenceImages: [],
      pageCount: 5,
      costUsd: 0.045,
      tokensIn: 1000,
      tokensOut: 500,
    });
    runStage2Mock.mockImplementationOnce(() => {
      throw new EmptyBriefSpecError(0);
    });
    // Also mock the post-Stage-1 recheck (status: RUNNING).
    m.findUnique.mockResolvedValueOnce({ status: "RUNNING" } as unknown as BriefRenderJob);

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.errorCode).toBe("EMPTY_BRIEF_SPEC");
    }
  });

  it("untyped Error → INTERNAL_ERROR code with the original message preserved", async () => {
    // Specific-error rule: even untyped Errors must surface their
    // own `.message` field — replacing it with a canned "Unexpected
    // error" wastes diagnostic information.
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockRejectedValueOnce(new Error("totally unexpected"));

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.errorCode).toBe("INTERNAL_ERROR");
      expect(result.errorMessage).toContain("totally unexpected");
    }
  });
});

// ─── stageLog seeding on resume ─────────────────────────────────────

describe("orchestrator — stageLog seeding", () => {
  it("seeds the BriefRenderLogger from existing job.stageLog on resume", async () => {
    const existingLog = [
      {
        stage: 1,
        name: "Spec Extract",
        status: "success" as const,
        startedAt: "2026-04-28T10:00:00Z",
        completedAt: "2026-04-28T10:00:05Z",
        durationMs: 5000,
        costUsd: 0.045,
        summary: "12 shots",
        output: null,
        error: null,
      },
    ];
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({
        status: "RUNNING",
        specResult: VALID_SPEC,
        stageLog: existingLog,
      }),
    );
    runStage2Mock.mockImplementationOnce(({ logger }) => {
      // Verify the logger was seeded.
      expect(logger.getStageLog().length).toBe(1);
      expect(logger.getStageLog()[0].stage).toBe(1);
      return { shots: VALID_SHOTS, totalShots: 1, totalApartments: 1 };
    });

    await runBriefRenderOrchestrator({ jobId: "job-1", prisma: m.prisma });
  });
});
