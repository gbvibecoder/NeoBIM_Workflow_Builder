/**
 * Stage 3 — per-shot orchestrator tests.
 *
 * Mocks Prisma, R2 upload, gpt-image provider, and Redis locks. Covers
 * happy path, mutex contention, TOCTOU, error mapping, and DB-race
 * scenarios.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const {
  acquireLockMock,
  releaseLockMock,
  generateImageMock,
  uploadR2Mock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  releaseLockMock: vi.fn().mockResolvedValue(undefined),
  generateImageMock: vi.fn(),
  uploadR2Mock: vi.fn(),
}));

vi.mock("@/features/brief-renders/services/brief-pipeline/redis-locks", () => ({
  acquireShotLock: (...args: unknown[]) => acquireLockMock(...args),
  releaseShotLock: (...args: unknown[]) => releaseLockMock(...args),
  SHOT_LOCK_TTL_SECONDS: 90,
  makeShotLockKey: (jobId: string, ai: number, si: number) =>
    `briefjob:lock:${jobId}:${ai}:${si}`,
}));

vi.mock(
  "@/features/brief-renders/services/brief-pipeline/providers/gpt-image",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/features/brief-renders/services/brief-pipeline/providers/gpt-image")
    >("@/features/brief-renders/services/brief-pipeline/providers/gpt-image");
    return {
      ...actual,
      generateShotImage: (...args: unknown[]) => generateImageMock(...args),
    };
  },
);

vi.mock("@/lib/r2", () => ({
  uploadBase64ToR2: (...args: unknown[]) => uploadR2Mock(...args),
}));

import {
  ImageGenProviderError,
  ImageGenRateLimitError,
} from "@/features/brief-renders/services/brief-pipeline/providers/gpt-image";
import { runStage3ImageGen } from "@/features/brief-renders/services/brief-pipeline/stage-3-image-gen";
import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import type { ShotResult } from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Prisma mock factory ───────────────────────────────────────────

function makePrismaMock() {
  const findUnique = vi.fn();
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = {
    briefRenderJob: { findUnique, update, updateMany },
    $executeRaw: executeRaw,
  } as unknown as PrismaClient;
  return { prisma, findUnique, update, updateMany, executeRaw };
}

const PENDING_SHOT: ShotResult = {
  shotIndex: 0,
  apartmentIndex: 0,
  shotIndexInApartment: 0,
  status: "pending",
  prompt: "Test prompt",
  aspectRatio: "3:2",
  templateVersion: "v1",
  imageUrl: null,
  errorMessage: null,
  costUsd: null,
  createdAt: "2026-04-28T10:00:00Z",
  startedAt: null,
  completedAt: null,
};

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "RUNNING",
    shots: [PENDING_SHOT],
    specResult: { referenceImageUrls: [] },
    stageLog: null,
    ...overrides,
  };
}

beforeEach(() => {
  acquireLockMock.mockReset();
  releaseLockMock.mockReset().mockResolvedValue(undefined);
  generateImageMock.mockReset();
  uploadR2Mock.mockReset();
});

// ─── Happy path ────────────────────────────────────────────────────

describe("runStage3ImageGen — happy path", () => {
  it("renders one pending shot end-to-end with success", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "briefjob:lock:job-1:0:0",
      lockValue: "uuid-A",
    });
    generateImageMock.mockResolvedValueOnce({
      imageBase64: "AAAA",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
      openaiRequestId: "req-X",
    });
    uploadR2Mock.mockResolvedValueOnce("https://r2.example/shot-0-0.png");
    // Phase 6: stage-3 now does TWO atomic shot writes per run —
    // (1) status="running" before the OpenAI call so the polling UI
    // shows "Rendering…" within ≤5 s instead of waiting for the full
    // 15-45 s OpenAI round-trip; (2) status="success" after R2 upload.
    // Both writes return count=1 in the happy path.
    m.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const logger = new BriefRenderLogger();
    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger,
      prisma: m.prisma,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.imageUrl).toBe("https://r2.example/shot-0-0.png");
      expect(result.costUsd).toBe(0.25);
      expect(result.widthPx).toBe(1536);
    }
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(uploadR2Mock).toHaveBeenCalledTimes(1);
    expect(m.executeRaw).toHaveBeenCalledTimes(2); // running + success
    expect(releaseLockMock).toHaveBeenCalledTimes(1);

    // Logger lifecycle.
    const log = logger.getStageLog();
    expect(log.length).toBe(1);
    expect(log[0].status).toBe("success");
    expect(log[0].costUsd).toBe(0.25);
  });

  it("uses input_fidelity='high' when calling the provider", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    generateImageMock.mockResolvedValueOnce({
      imageBase64: "AAAA",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
      openaiRequestId: null,
    });
    uploadR2Mock.mockResolvedValueOnce("https://r2.example/img.png");
    // running + success writes (Phase 6)
    m.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });

    const callArgs = generateImageMock.mock.calls[0][0];
    expect(callArgs.inputFidelity).toBe("high");
    expect(callArgs.requestId).toBe("job-1:0:0");
    expect(callArgs.aspectRatio).toBe("3:2");
  });

  it("sources reference image URLs from job.specResult.referenceImageUrls", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(
        makeJob({
          specResult: {
            referenceImageUrls: ["https://r2.example/ref-0.png", "https://r2.example/ref-1.png"],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeJob({
          specResult: {
            referenceImageUrls: ["https://r2.example/ref-0.png", "https://r2.example/ref-1.png"],
          },
        }),
      );
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    generateImageMock.mockResolvedValueOnce({
      imageBase64: "AAAA",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
      openaiRequestId: null,
    });
    uploadR2Mock.mockResolvedValueOnce("https://r2.example/img.png");

    await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });

    expect(generateImageMock.mock.calls[0][0].referenceImageUrls).toEqual([
      "https://r2.example/ref-0.png",
      "https://r2.example/ref-1.png",
    ]);
  });

  it("uploads to deterministic R2 filename (briefs-shots-{jobId}-{ai}-{si}.png)", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob({ shots: [{ ...PENDING_SHOT, apartmentIndex: 2, shotIndexInApartment: 3 }] }))
      .mockResolvedValueOnce(makeJob({ shots: [{ ...PENDING_SHOT, apartmentIndex: 2, shotIndexInApartment: 3 }] }));
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    generateImageMock.mockResolvedValueOnce({
      imageBase64: "AAAA",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
      openaiRequestId: null,
    });
    uploadR2Mock.mockResolvedValueOnce("https://r2.example/img.png");

    await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 2,
      shotIndexInApartment: 3,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });

    expect(uploadR2Mock.mock.calls[0][1]).toBe("briefs-shots-job-1-2-3.png");
    expect(uploadR2Mock.mock.calls[0][2]).toBe("image/png");
  });
});

// ─── Skip paths ────────────────────────────────────────────────────

describe("runStage3ImageGen — skip paths", () => {
  it("returns skipped(job_cancelled) BEFORE acquiring lock when status != RUNNING", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("job_cancelled");
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("returns skipped(already_done) BEFORE acquiring lock when shot is success", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({ shots: [{ ...PENDING_SHOT, status: "success" }] }),
    );

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("already_done");
    expect(acquireLockMock).not.toHaveBeenCalled();
  });

  it("returns skipped(lock_busy) when mutex acquire fails", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: false,
      lockKey: "k",
      lockValue: "v",
    });

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("lock_busy");
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("TOCTOU: lock acquired but shot flipped to success between pre-check and re-read → skipped + lock released", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob()) // pre-check
      .mockResolvedValueOnce(
        makeJob({ shots: [{ ...PENDING_SHOT, status: "success" }] }),
      ); // re-read inside lock

    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("already_done");
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });

  it("TOCTOU: lock acquired but job cancelled between pre-check and re-read → skipped + lock released", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce({ status: "CANCELLED", shots: [PENDING_SHOT], specResult: { referenceImageUrls: [] } });

    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("job_cancelled");
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });
});

// ─── Failure paths ─────────────────────────────────────────────────

describe("runStage3ImageGen — failure paths", () => {
  it("rate-limit error → returns failed(rate_limited), shot is left in 'running' state, no cost increment", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob()).mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    // Phase 6: the running write (step 4a) succeeds with count=1
    // before the OpenAI call; the rate-limit error then aborts before
    // the would-be success/failed write. Net effect: ONE DB write,
    // shot is in 'running' state, no cost increment, lock TTL will
    // eventually let a retry claim it.
    m.executeRaw.mockResolvedValueOnce(1);
    generateImageMock.mockRejectedValueOnce(
      new ImageGenRateLimitError("rate limited"),
    );

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.kind).toBe("rate_limited");
      expect(result.error).toBe("rate_limited");
      expect(result.costUsd).toBe(0);
    }
    expect(uploadR2Mock).not.toHaveBeenCalled();
    expect(m.executeRaw).toHaveBeenCalledTimes(1); // running write only
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });

  it("provider error (non-rate-limit) → marks shot failed in DB and returns failed(provider)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob()).mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    generateImageMock.mockRejectedValueOnce(
      new ImageGenProviderError("auth failed", "auth"),
    );
    // Phase 6: running write (1) + failed write (1) = 2 atomic shot writes.
    m.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.kind).toBe("provider");
    expect(m.executeRaw).toHaveBeenCalledTimes(2); // running + failed
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });

  it("R2 upload returns data URI (not configured) → returns failed(r2_upload), lock released", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob()).mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    generateImageMock.mockResolvedValueOnce({
      imageBase64: "AAAA",
      costUsd: 0.25,
      widthPx: 1536,
      heightPx: 1024,
      openaiRequestId: null,
    });
    // uploadBase64ToR2 returns the original dataUri prefix when R2 is unconfigured.
    uploadR2Mock.mockResolvedValueOnce("data:image/png;base64,AAAA");
    // Phase 6: the running write fires before R2 upload; the R2 error
    // path returns without writing the failed status (R2 misconfig is
    // an infra-level failure that affects all shots — no per-shot
    // failed marker), so we expect exactly 1 DB write (the running
    // marker). The shot is left in 'running' state; lock TTL recovery.
    m.executeRaw.mockResolvedValueOnce(1);

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.kind).toBe("r2_upload");
    expect(m.executeRaw).toHaveBeenCalledTimes(1); // running write only
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });

  it("DB updateMany count=0 on running write → bails before OpenAI call, returns skipped(job_cancelled)", async () => {
    // Phase 6: the running-status write is now the first DB op, so
    // race-loss detection happens BEFORE the (expensive) OpenAI call.
    // This is a real cost-saving fix: previously we'd burn ~$0.25
    // generating an image we'd then refuse to persist. Now we abort
    // ~10 ms in.
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob()).mockResolvedValueOnce(makeJob());
    acquireLockMock.mockResolvedValueOnce({
      acquired: true,
      lockKey: "k",
      lockValue: "v",
    });
    m.executeRaw.mockResolvedValueOnce(0); // race-loss on running write

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("job_cancelled");
    // Critical: OpenAI was never called — proves the cost-saving fix.
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(uploadR2Mock).not.toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });

  it("shot not found in shots[] → returns failed(db_race)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ shots: [] }));

    const result = await runStage3ImageGen({
      jobId: "job-1",
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.kind).toBe("db_race");
      expect(result.error).toBe("shot_not_found");
    }
    expect(acquireLockMock).not.toHaveBeenCalled();
  });

  it("job not found → throws JobNotFoundError", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(null);

    await expect(
      runStage3ImageGen({
        jobId: "missing",
        apartmentIndex: 0,
        shotIndexInApartment: 0,
        logger: new BriefRenderLogger(),
        prisma: m.prisma,
      }),
    ).rejects.toThrow();
  });
});
