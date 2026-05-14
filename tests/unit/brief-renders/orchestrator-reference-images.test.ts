/**
 * Brief-to-Renders orchestrator — reference-image wiring tests.
 *
 * Regression coverage for the latent bug fixed in
 * `fix/brief-renders-reference-image-wire`: Stage 1 extracts reference
 * images from embedded brief attachments and returns them as
 * `stage1.referenceImages`, but the orchestrator persisted only
 * `stage1.spec` — so `spec.referenceImageUrls` stayed `[]` for every
 * brief, Stage 3 always fell through to `images.generate()`, and the
 * `images.edit()` + `input_fidelity:"high"` anchoring path was dead code
 * for every customer in production.
 *
 * These tests assert the orchestrator now wires
 * `stage1.referenceImages` → persisted `specResult.referenceImageUrls`,
 * capped at 4 (the gpt-image API reference-image limit), with the
 * zero-image case preserved (empty array → Stage 3 falls back to
 * `images.generate()`).
 *
 * Mocks Stage 1 + Stage 2 + prisma — no real APIs touched. Mirrors the
 * mock harness in the sibling `orchestrator.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  BriefRenderJob,
  BriefRenderJobStatus,
  PrismaClient,
} from "@prisma/client";

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
    // Re-export the real typed errors so the module shape stays intact
    // while `runStage2PromptGen` itself is mocked.
    const actual = await vi.importActual<
      typeof import("@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen")
    >("@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen");
    return { ...actual, runStage2PromptGen: runStage2Mock };
  },
);

import { runBriefRenderOrchestrator } from "@/features/brief-renders/services/brief-pipeline/orchestrator";

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
  // Cast through a minimal record — the orchestrator only reads the
  // columns listed here.
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
  // Claude leaves this empty per the spec-extractor contract — the
  // orchestrator is what populates it from `stage1.referenceImages`.
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

/** Build N mock `ReferenceImage` records matching the Stage 1 output shape. */
function makeReferenceImages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    r2Url: `https://r2.example/briefs-refs-job-1-${i}.png`,
    mimeType: "image/png",
  }));
}

/** A `Stage1Result`-shaped value carrying the given reference images. */
function stage1Result(referenceImages: ReturnType<typeof makeReferenceImages>) {
  return {
    spec: VALID_SPEC,
    referenceImages,
    pageCount: 5,
    costUsd: 0.045,
    tokensIn: 1000,
    tokensOut: 500,
  };
}

/** The spec the orchestrator persisted into `specResult` (Stage 1 update). */
function persistedSpec(m: PrismaMockHandle): { referenceImageUrls: string[] } {
  return m.update.mock.calls[0][0].data.specResult as {
    referenceImageUrls: string[];
  };
}

beforeEach(() => {
  runStage1Mock.mockReset();
  runStage2Mock.mockReset();
  runStage2Mock.mockReturnValue({
    shots: VALID_SHOTS,
    totalShots: 1,
    totalApartments: 1,
  });
});

// ─── Reference-image wiring ────────────────────────────────────────

describe("orchestrator — reference-image wiring", () => {
  it("0 reference images → persisted spec.referenceImageUrls === []", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockResolvedValueOnce(stage1Result(makeReferenceImages(0)));

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });

    expect(result.status).toBe("AWAITING_APPROVAL");
    expect(persistedSpec(m).referenceImageUrls).toEqual([]);
    if (result.status === "AWAITING_APPROVAL") {
      // Result envelope mirrors the persisted spec — Stage 3 reads the
      // persisted copy, but the two must not diverge.
      expect(result.spec.referenceImageUrls).toEqual([]);
    }
  });

  it("N reference images (1–4) → persisted spec.referenceImageUrls has all N, in source order", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockResolvedValueOnce(stage1Result(makeReferenceImages(3)));

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });

    expect(result.status).toBe("AWAITING_APPROVAL");
    expect(persistedSpec(m).referenceImageUrls).toEqual([
      "https://r2.example/briefs-refs-job-1-0.png",
      "https://r2.example/briefs-refs-job-1-1.png",
      "https://r2.example/briefs-refs-job-1-2.png",
    ]);
    if (result.status === "AWAITING_APPROVAL") {
      expect(result.spec.referenceImageUrls).toHaveLength(3);
    }
  });

  it("5+ reference images → persisted spec.referenceImageUrls capped at the first 4", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    runStage1Mock.mockResolvedValueOnce(stage1Result(makeReferenceImages(6)));

    const result = await runBriefRenderOrchestrator({
      jobId: "job-1",
      prisma: m.prisma,
    });

    expect(result.status).toBe("AWAITING_APPROVAL");
    const persisted = persistedSpec(m);
    expect(persisted.referenceImageUrls).toHaveLength(4);
    expect(persisted.referenceImageUrls).toEqual([
      "https://r2.example/briefs-refs-job-1-0.png",
      "https://r2.example/briefs-refs-job-1-1.png",
      "https://r2.example/briefs-refs-job-1-2.png",
      "https://r2.example/briefs-refs-job-1-3.png",
    ]);
  });
});
