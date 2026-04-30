/**
 * Stage 4 — PDF compile orchestrator tests.
 *
 * Mocks Prisma, R2, fetch, jspdf. Drives the orchestrator through every
 * path: happy compile, status guards, image-fetch failures, R2 failure,
 * race-loss on the terminal flip, idempotent re-invoke.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const {
  uploadR2Mock,
  jspdfCtorMock,
  jspdfTextMock,
  jspdfSetFontMock,
  jspdfSetFontSizeMock,
  jspdfSetTextColorMock,
  jspdfSetDrawColorMock,
  jspdfSetLineWidthMock,
  jspdfLineMock,
  jspdfAddPageMock,
  jspdfAddImageMock,
  jspdfSetPageMock,
  jspdfSplitTextToSizeMock,
  jspdfOutputMock,
  jspdfGetNumberOfPagesMock,
  jspdfAddFileToVFSMock,
  jspdfAddFontMock,
  jspdfSetFillColorMock,
  jspdfRectMock,
  jspdfLinesMock,
  jspdfGetTextWidthMock,
} = vi.hoisted(() => ({
  uploadR2Mock: vi.fn(),
  jspdfCtorMock: vi.fn(),
  jspdfTextMock: vi.fn(),
  jspdfSetFontMock: vi.fn(),
  jspdfSetFontSizeMock: vi.fn(),
  jspdfSetTextColorMock: vi.fn(),
  jspdfSetDrawColorMock: vi.fn(),
  jspdfSetLineWidthMock: vi.fn(),
  jspdfLineMock: vi.fn(),
  jspdfAddPageMock: vi.fn(),
  jspdfAddImageMock: vi.fn(),
  jspdfSetPageMock: vi.fn(),
  jspdfSplitTextToSizeMock: vi.fn((t: string) => [t]),
  jspdfOutputMock: vi.fn(),
  jspdfGetNumberOfPagesMock: vi.fn(),
  jspdfAddFileToVFSMock: vi.fn(),
  jspdfAddFontMock: vi.fn(),
  jspdfSetFillColorMock: vi.fn(),
  jspdfRectMock: vi.fn(),
  jspdfLinesMock: vi.fn(),
  // Deterministic stub — real jspdf measures from font metrics; spy
  // returns a non-zero number so per-shot-page.ts can place the hero
  // badge icon to the left of the label.
  jspdfGetTextWidthMock: vi.fn((s: string) => s.length * 1.5),
}));

vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  uploadEditorialPdfToR2: (...args: unknown[]) => uploadR2Mock(...args),
}));

vi.mock("jspdf", () => {
  class MockJsPDF {
    constructor(opts?: unknown) {
      jspdfCtorMock(opts);
    }
    text = jspdfTextMock;
    setFont = jspdfSetFontMock;
    setFontSize = jspdfSetFontSizeMock;
    setTextColor = jspdfSetTextColorMock;
    setDrawColor = jspdfSetDrawColorMock;
    setLineWidth = jspdfSetLineWidthMock;
    line = jspdfLineMock;
    addPage = jspdfAddPageMock;
    addImage = jspdfAddImageMock;
    setPage = jspdfSetPageMock;
    splitTextToSize = jspdfSplitTextToSizeMock;
    output = jspdfOutputMock;
    getNumberOfPages = jspdfGetNumberOfPagesMock;
    addFileToVFS = jspdfAddFileToVFSMock;
    addFont = jspdfAddFontMock;
    setFillColor = jspdfSetFillColorMock;
    rect = jspdfRectMock;
    lines = jspdfLinesMock;
    getTextWidth = jspdfGetTextWidthMock;
  }
  return { jsPDF: MockJsPDF };
});

import { runStage4PdfCompile } from "@/features/brief-renders/services/brief-pipeline/stage-4-pdf-compile";
import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import type {
  ApartmentSpec,
  BriefSpec,
  ShotResult,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Prisma mock ────────────────────────────────────────────────────

function makePrismaMock() {
  const findUnique = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    briefRenderJob: { findUnique, updateMany },
  } as unknown as PrismaClient;
  return { prisma, findUnique, updateMany };
}

// ─── Fixtures ──────────────────────────────────────────────────────

function makeShot(ai: number, si: number, hasImage = true): ShotResult {
  return {
    shotIndex: ai * 4 + si,
    apartmentIndex: ai,
    shotIndexInApartment: si,
    status: hasImage ? "success" : "pending",
    prompt: "p",
    aspectRatio: "3:2",
    templateVersion: "v1",
    imageUrl: hasImage ? "https://r2.example/img.png" : null,
    errorMessage: null,
    costUsd: hasImage ? 0.25 : null,
    createdAt: "2026-04-28T10:00:00Z",
    startedAt: hasImage ? "2026-04-28T10:00:30Z" : null,
    completedAt: hasImage ? "2026-04-28T10:01:00Z" : null,
  };
}

function makeShotSpec(): ShotSpec {
  return {
    shotIndex: 1,
    roomNameEn: "Open Kitchen-Dining",
    roomNameDe: "Kochen-Essen",
    areaSqm: 32.54,
    aspectRatio: "3:2",
    lightingDescription: "golden hour",
    cameraDescription: null,
    materialNotes: null,
    isHero: false,
  };
}

function makeApt(label: string, shotCount: number): ApartmentSpec {
  return {
    label,
    labelDe: null,
    totalAreaSqm: 95.4,
    bedrooms: 2,
    bathrooms: 1,
    description: null,
    shots: Array.from({ length: shotCount }, makeShotSpec),
  };
}

function makeSpec(apartments: number, shotsPerApt: number): BriefSpec {
  return {
    projectTitle: "Marx12",
    projectLocation: "Berlin",
    projectType: "residential",
    baseline: {
      visualStyle: "photorealistic",
      materialPalette: "oak / white",
      lightingBaseline: "golden hour",
      cameraBaseline: null,
      qualityTarget: null,
      additionalNotes: null,
    },
    apartments: Array.from({ length: apartments }, (_, i) =>
      makeApt(`WE 0${i + 1}`, shotsPerApt),
    ),
    referenceImageUrls: [],
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  const defaultShots = Array.from({ length: 12 }, (_, i) =>
    makeShot(Math.floor(i / 4), i % 4),
  );
  return {
    id: "job-1",
    status: "RUNNING",
    currentStage: "awaiting_compile",
    pdfUrl: null,
    specResult: makeSpec(3, 4),
    shots: defaultShots,
    stageLog: null,
    ...overrides,
  };
}

// ─── Setup ─────────────────────────────────────────────────────────

beforeEach(() => {
  uploadR2Mock.mockReset();
  jspdfCtorMock.mockReset();
  jspdfTextMock.mockReset();
  jspdfSetFontMock.mockReset();
  jspdfSetFontSizeMock.mockReset();
  jspdfSetTextColorMock.mockReset();
  jspdfSetDrawColorMock.mockReset();
  jspdfSetLineWidthMock.mockReset();
  jspdfLineMock.mockReset();
  jspdfAddPageMock.mockReset();
  jspdfAddImageMock.mockReset();
  jspdfSetPageMock.mockReset();
  jspdfSplitTextToSizeMock.mockReset().mockImplementation((t: string) => [t]);
  // Stage 4 calls `doc.output("arraybuffer")` — return a small fake
  // ArrayBuffer so `Buffer.from(arrayBuffer)` works in the production
  // code path. The legacy "datauristring" mode is preserved as a
  // fallback for any older test that calls output() with no arg.
  jspdfOutputMock.mockReset().mockImplementation((mode?: string) => {
    if (mode === "arraybuffer") {
      // 4 bytes is enough — the cap check passes, real bytes irrelevant.
      return new ArrayBuffer(4);
    }
    return "data:application/pdf;base64,QUFBQQ==";
  });
  jspdfGetNumberOfPagesMock.mockReset().mockReturnValue(13);
  jspdfAddFileToVFSMock.mockReset();
  jspdfAddFontMock.mockReset();
  jspdfSetFillColorMock.mockReset();
  jspdfRectMock.mockReset();
  jspdfLinesMock.mockReset();
  jspdfGetTextWidthMock
    .mockReset()
    .mockImplementation((s: string) => s.length * 1.5);

  // Default: fetch returns a small PNG buffer. Return a FRESH Response
  // per call (Response bodies are single-consumption — re-using the
  // same instance across shots would throw "body already consumed").
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    ),
  );

  // New uploader returns the success/error envelope shape, not a
  // bare URL. Tests that need to simulate failure override this with
  // `{ success: false, error: "..." }`.
  uploadR2Mock.mockResolvedValue({
    success: true,
    url: "https://r2.example/briefs-pdfs-job-1.pdf",
    key: "briefs-pdfs-job-1.pdf",
    size: 4,
  });
});

// ─── Happy path ────────────────────────────────────────────────────

describe("runStage4PdfCompile — happy path", () => {
  it("12-shot job → claim → fetch → render → upload → COMPLETED", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    // Two updateMany calls: claim flip + terminal flip.
    m.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // terminal

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.pdfUrl).toBe(
        "https://r2.example/briefs-pdfs-job-1.pdf",
      );
      expect(result.pageCount).toBe(13); // 1 cover + 12 shot pages
      expect(result.costUsd).toBe(0);
    }

    expect(uploadR2Mock).toHaveBeenCalledTimes(1);
    // New uploader signature: (Buffer, key) — no longer accepts a
    // contentType argument because it always uploads as application/pdf.
    const [pdfBuffer, pdfKey] = uploadR2Mock.mock.calls[0];
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfKey).toBe("briefs-pdfs-job-1.pdf");

    // Terminal flip uses status filter on RUNNING + compiling.
    const terminalCall = m.updateMany.mock.calls.find(
      (c) => c[0].data.status === "COMPLETED",
    );
    expect(terminalCall).toBeDefined();
    expect(terminalCall![0].where.status).toBe("RUNNING");
    expect(terminalCall![0].where.currentStage).toBe("compiling");
    expect(terminalCall![0].data.pdfUrl).toBe(
      "https://r2.example/briefs-pdfs-job-1.pdf",
    );
  });

  it("variable-shot brief: 1 apt × 4 shots → page count 5 (1 cover + 4)", async () => {
    const m = makePrismaMock();
    const spec = makeSpec(1, 4);
    const shots = Array.from({ length: 4 }, (_, i) => makeShot(0, i));
    m.findUnique.mockResolvedValueOnce(
      makeJob({ specResult: spec, shots }),
    );
    jspdfGetNumberOfPagesMock.mockReturnValue(5);

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.pageCount).toBe(5);
    }
  });

  it("page count derived from spec, never hardcoded — 7-shot brief produces 8 pages", async () => {
    const m = makePrismaMock();
    const spec: BriefSpec = {
      ...makeSpec(2, 0),
      apartments: [
        { ...makeApt("WE 01", 4) },
        { ...makeApt("WE 02", 2) },
        { ...makeApt("WE 03", 1) },
      ],
    };
    const shots = [
      makeShot(0, 0),
      makeShot(0, 1),
      makeShot(0, 2),
      makeShot(0, 3),
      makeShot(1, 0),
      makeShot(1, 1),
      makeShot(2, 0),
    ];
    m.findUnique.mockResolvedValueOnce(makeJob({ specResult: spec, shots }));
    jspdfGetNumberOfPagesMock.mockReturnValue(8);

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.pageCount).toBe(8);
    }
  });
});

// ─── Status guards ─────────────────────────────────────────────────

describe("runStage4PdfCompile — status guards", () => {
  it("status != RUNNING → skipped(job_not_ready), no work", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ status: "CANCELLED" }));
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("job_not_ready");
    expect(uploadR2Mock).not.toHaveBeenCalled();
  });

  it("status RUNNING but currentStage != awaiting_compile|compiling → skipped", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({ currentStage: "rendering" }),
    );
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("job_not_ready");
  });

  it("missing image URL on a shot → skipped(missing_shots)", async () => {
    const m = makePrismaMock();
    const shots = Array.from({ length: 12 }, (_, i) =>
      makeShot(Math.floor(i / 4), i % 4, i !== 5),
    );
    m.findUnique.mockResolvedValueOnce(makeJob({ shots }));
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("missing_shots");
  });

  it("zero shots → skipped(missing_shots)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ shots: [] }));
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("missing_shots");
  });

  it("already COMPLETED with pdfUrl → skipped(already_compiled)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({
        status: "COMPLETED",
        currentStage: "completed",
        pdfUrl: "https://r2.example/old.pdf",
      }),
    );
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped")
      expect(result.reason).toBe("already_compiled");
  });

  it("specResult missing → failed", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ specResult: null }));
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
  });
});

// ─── Image fetch failures ──────────────────────────────────────────

describe("runStage4PdfCompile — image fetch", () => {
  it("any image fetch returns non-OK → failed (no PDF rendered)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404 })),
    );

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    expect(jspdfCtorMock).not.toHaveBeenCalled();
  });

  it("fetch throws (timeout) → failed (no partial PDF)", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("aborted")),
    );

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    expect(uploadR2Mock).not.toHaveBeenCalled();
  });
});

// ─── R2 upload failures ────────────────────────────────────────────

describe("runStage4PdfCompile — R2 upload", () => {
  it("uploader returns success:false envelope (cap exceeded) → failed with specific error", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    uploadR2Mock.mockResolvedValueOnce({
      success: false,
      error: "Editorial PDF size 32.45 MB exceeds 30 MB cap",
    });

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      // Specific-errors rule: caller-facing text must explain why.
      expect(result.error).toContain("32.45 MB exceeds 30 MB cap");
      expect(result.error).toContain("pdfSize=");
    }
  });

  it("uploader throws → failed with specific error", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    uploadR2Mock.mockRejectedValueOnce(new Error("boom"));

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("boom");
      expect(result.error).toContain("pdfSize=");
    }
  });

  it("uses deterministic key briefs-pdfs-{jobId}.pdf", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob({ id: "job-XYZ-Z" }));

    await runStage4PdfCompile({
      jobId: "job-XYZ-Z",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(uploadR2Mock.mock.calls[0][1]).toBe("briefs-pdfs-job-XYZ-Z.pdf");
  });
});

// ─── Race conditions ──────────────────────────────────────────────

describe("runStage4PdfCompile — race conditions", () => {
  it("terminal flip count=0 (cancel mid-compile) → skipped, PDF stays in R2", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(makeJob());
    m.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim succeeded
      .mockResolvedValueOnce({ count: 0 }); // terminal raced

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    expect(uploadR2Mock).toHaveBeenCalledTimes(1); // PDF was uploaded
  });

  it("claim count=0 + currentStage=compiling on refetch → proceed (concurrent worker scenario)", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob({ currentStage: "compiling" })) // initial
      .mockResolvedValueOnce({
        status: "RUNNING",
        currentStage: "compiling",
      }); // refetch after claim count=0

    m.updateMany
      .mockResolvedValueOnce({ count: 0 }) // claim raced (already compiling)
      .mockResolvedValueOnce({ count: 1 }); // terminal

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("success");
  });

  it("claim count=0 + currentStage no longer compatible → skipped", async () => {
    const m = makePrismaMock();
    m.findUnique
      .mockResolvedValueOnce(makeJob({ currentStage: "compiling" }))
      .mockResolvedValueOnce({ status: "CANCELLED", currentStage: null });

    m.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
  });
});

// ─── Idempotency ───────────────────────────────────────────────────

describe("runStage4PdfCompile — idempotency", () => {
  it("re-invoke against COMPLETED+pdfUrl → skipped(already_compiled), no R2 call", async () => {
    const m = makePrismaMock();
    m.findUnique.mockResolvedValueOnce(
      makeJob({
        status: "COMPLETED",
        currentStage: "completed",
        pdfUrl: "https://r2.example/old.pdf",
      }),
    );
    const result = await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m.prisma,
    });
    expect(result.status).toBe("skipped");
    expect(jspdfCtorMock).not.toHaveBeenCalled();
    expect(uploadR2Mock).not.toHaveBeenCalled();
  });

  it("re-invoke during compiling — same deterministic R2 key (overwrite-safe)", async () => {
    const m1 = makePrismaMock();
    m1.findUnique.mockResolvedValueOnce(makeJob());
    await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m1.prisma,
    });
    expect(uploadR2Mock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const firstKey = uploadR2Mock.mock.calls[0][1];

    // Don't `mockClear` on uploadR2Mock — that wipes the mockResolvedValue
    // configured in beforeEach. Just snapshot the next call index.
    const callIdxBeforeSecond = uploadR2Mock.mock.calls.length;

    const m2 = makePrismaMock();
    m2.findUnique.mockResolvedValueOnce(makeJob());
    await runStage4PdfCompile({
      jobId: "job-1",
      logger: new BriefRenderLogger(),
      prisma: m2.prisma,
    });
    const secondKey = uploadR2Mock.mock.calls[callIdxBeforeSecond][1];

    expect(firstKey).toBe(secondKey);
  });
});
