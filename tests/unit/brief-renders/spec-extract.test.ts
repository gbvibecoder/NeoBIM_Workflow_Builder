/**
 * Stage 1 — Spec Extract orchestrator tests.
 *
 * Load-bearing for the strict-faithfulness contract. Mocks every
 * external collaborator (fetch, Anthropic SDK, R2 upload, pdf-parse,
 * mammoth) so the orchestrator's logic is the only thing under test.
 *
 * The five system-prompt rules cannot all be enforced at the unit
 * level — Claude itself is mocked, so semantic faithfulness (e.g.
 * "Claude inventing a wall colour for a shot whose source said
 * nothing") is out of scope here. That's a Phase 6 E2E concern. What
 * we CAN test:
 *   • Schema rejects invented keys (.strict).
 *   • Schema rejects wrong-typed values.
 *   • Schema accepts omitted nullable fields and normalizes them to null.
 *   • System prompt verbatim contains the load-bearing phrases.
 *   • Tool name is `submit_brief_spec` and tool_choice is forced.
 *   • Reference images are passed as image blocks.
 *   • SSRF guard fires before any network call.
 *   • Cost is computed correctly from token usage.
 *   • Logger receives startStage/recordCost/endStage in order.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import {
  EmptyPdfError,
  InvalidSpecError,
  UnauthorizedBriefUrlError,
  UnsupportedBriefFormatError,
} from "@/features/brief-renders/services/brief-pipeline/errors";
import {
  _setPdfParseForTest,
} from "@/features/brief-renders/services/brief-pipeline/extractors/pdf-text";
import {
  _setMammothForTest,
} from "@/features/brief-renders/services/brief-pipeline/extractors/docx-text";
import {
  _setUnpdfForTest,
  _setSharpForTest,
  _setMammothForImagesForTest,
} from "@/features/brief-renders/services/brief-pipeline/extractors/embedded-images";

// ─── Hoisted mocks ─────────────────────────────────────────────────
//
// vi.mock factories are hoisted to the top of the file and cannot
// reference module-scope variables. `vi.hoisted` is the supported
// pattern for sharing mock state with the factory body.

const { messagesCreateMock, uploadToR2Mock } = vi.hoisted(() => ({
  messagesCreateMock: vi.fn(),
  uploadToR2Mock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: messagesCreateMock };
  },
}));

vi.mock("@/lib/r2", () => ({
  uploadToR2: uploadToR2Mock,
  isR2Configured: () => true,
}));

// ─── Imports under test (after mocks) ──────────────────────────────

import {
  runStage1SpecExtract,
} from "@/features/brief-renders/services/brief-pipeline/stage-1-spec-extract";
import { BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT } from "@/features/brief-renders/services/brief-pipeline/prompts/spec-extractor";

// ─── Fixtures ──────────────────────────────────────────────────────

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

function pad(buf: Buffer, totalLen: number): Buffer {
  return Buffer.concat([buf, Buffer.alloc(Math.max(0, totalLen - buf.length))]);
}

const VALID_SPEC = {
  projectTitle: "Marx12",
  projectLocation: "Berlin",
  projectType: "residential",
  baseline: {
    visualStyle: "photorealistic interior",
    materialPalette: "oak floor, white walls",
    lightingBaseline: "golden hour",
    cameraBaseline: "eye-level wide-angle",
    qualityTarget: "real-estate listing quality",
    additionalNotes: null,
  },
  // Phase 3 nested shape: shots live inside each apartment.
  apartments: [
    {
      label: "WE 01bb",
      labelDe: null,
      totalAreaSqm: 95.4,
      bedrooms: 2,
      bathrooms: 1,
      description: null,
      shots: [
        {
          shotIndex: 1,
          roomNameEn: "Open Kitchen-Dining",
          roomNameDe: "Kochen-Essen",
          areaSqm: 32.54,
          aspectRatio: "3:2",
          lightingDescription: "golden hour",
          cameraDescription: null,
          materialNotes: null,
          isHero: true,
        },
      ],
    },
  ],
  referenceImageUrls: [],
} as const;

function makeSuccessResponse(spec: unknown, tokens?: { in?: number; out?: number }) {
  return {
    content: [
      {
        type: "tool_use",
        name: "submit_brief_spec",
        input: spec,
      },
    ],
    usage: {
      input_tokens: tokens?.in ?? 1000,
      output_tokens: tokens?.out ?? 500,
    },
    stop_reason: "tool_use",
  };
}

function makeFetchOk(body: Buffer, contentType = "application/pdf"): Response {
  // Buffer → Uint8Array — same shape narrowing reason as Phase 1's
  // upload-brief test: Buffer's underlying ArrayBufferLike isn't always
  // assignable to BodyInit's expected ArrayBuffer.
  const view = new Uint8Array(body.byteLength);
  view.set(body);
  return new Response(view, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
    },
  });
}

const VALID_R2_URL = "https://buildflow-files.acct123.r2.cloudflarestorage.com/briefs/2026/04/28/abc-marx12.pdf";

// ─── Test scaffolding ──────────────────────────────────────────────

let logger: BriefRenderLogger;

beforeEach(() => {
  messagesCreateMock.mockReset();
  uploadToR2Mock.mockReset();

  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

  // Default extractor stubs — happy path content.
  _setPdfParseForTest(async () => ({
    text: "Marx12 brief — apartment WE 01bb — shot list S1, S2, S3, S4",
    numpages: 5,
    info: {},
  }));
  _setMammothForTest({
    convertToHtml: async () => ({ value: "<p>docx html</p>", messages: [] }),
    extractRawText: async () => ({ value: "docx raw text", messages: [] }),
  });
  _setUnpdfForTest({
    getDocumentProxy: async () => ({ numPages: 1 }),
    extractImages: async () => [],
  });
  _setSharpForTest(() => ({
    png: () => ({ toBuffer: async () => Buffer.from("fake-png") }),
  }));
  _setMammothForImagesForTest({
    images: { imgElement: () => ({}) },
    convertToHtml: async () => ({ value: "<p>x</p>", messages: [] }),
  });

  uploadToR2Mock.mockResolvedValue({
    success: true,
    url: "https://r2.example/refs/0.png",
    key: "files/refs/0.png",
    size: 100,
  });

  logger = new BriefRenderLogger();
});

afterEach(() => {
  _setPdfParseForTest(null);
  _setMammothForTest(null);
  _setUnpdfForTest(null);
  _setSharpForTest(null);
  _setMammothForImagesForTest(null);
  vi.unstubAllGlobals();
});

// ─── Strict-faithfulness — schema enforcement ──────────────────────

describe("runStage1SpecExtract — strict-faithfulness schema enforcement", () => {
  it("strict-faithfulness #1: valid spec with explicit nulls is accepted as-is", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(VALID_SPEC));

    const result = await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-1",
      logger,
    });

    expect(result.spec.projectTitle).toBe("Marx12");
    expect(result.spec.baseline.additionalNotes).toBeNull();
    expect(result.spec.apartments[0].labelDe).toBeNull();
  });

  it("strict-faithfulness #2: omitted nullable fields normalize to null", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);

    // Claude returns a spec with several keys absent (most common Sonnet behaviour).
    // Phase 3 nested shape — no top-level `shots` key.
    const minimalSpec = {
      projectTitle: "Marx12",
      // projectLocation and projectType omitted entirely
      baseline: {
        visualStyle: "photorealistic interior",
        // remaining baseline fields omitted
      },
      apartments: [],
      referenceImageUrls: [],
    };
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(minimalSpec));

    const result = await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-2",
      logger,
    });

    expect(result.spec.projectTitle).toBe("Marx12");
    expect(result.spec.projectLocation).toBeNull();
    expect(result.spec.projectType).toBeNull();
    expect(result.spec.baseline.materialPalette).toBeNull();
    expect(result.spec.baseline.additionalNotes).toBeNull();
  });

  it("strict-faithfulness #3: invented top-level field → InvalidSpecError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    messagesCreateMock.mockResolvedValueOnce(
      makeSuccessResponse({ ...VALID_SPEC, hallucinatedField: "boom" }),
    );

    await expect(
      runStage1SpecExtract({ briefUrl: VALID_R2_URL, jobId: "job-3", logger }),
    ).rejects.toBeInstanceOf(InvalidSpecError);
  });

  it("strict-faithfulness #3b: invented field inside a nested shot → InvalidSpecError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    // Phase 3 nested shape: shots live inside apartments. Inject the
    // invented key inside the first apartment's first shot.
    const badSpec = {
      ...VALID_SPEC,
      apartments: [
        {
          ...VALID_SPEC.apartments[0],
          shots: [
            {
              ...VALID_SPEC.apartments[0].shots[0],
              wallColor: "white", // invented — not in schema
            },
          ],
        },
      ],
    };
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(badSpec));

    await expect(
      runStage1SpecExtract({ briefUrl: VALID_R2_URL, jobId: "job-3b", logger }),
    ).rejects.toBeInstanceOf(InvalidSpecError);
  });

  it("strict-faithfulness #4: wrong-typed value (string for number) → InvalidSpecError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    const badSpec = {
      ...VALID_SPEC,
      apartments: [
        {
          ...VALID_SPEC.apartments[0],
          shots: [
            {
              ...VALID_SPEC.apartments[0].shots[0],
              areaSqm: "approximately 32m", // string, schema expects number | null
            },
          ],
        },
      ],
    };
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(badSpec));

    await expect(
      runStage1SpecExtract({ briefUrl: VALID_R2_URL, jobId: "job-4", logger }),
    ).rejects.toBeInstanceOf(InvalidSpecError);
  });

  // NOTE: strict-faithfulness #5 (plausible-but-invented values, e.g. Claude
  // filling `wall_color` when the source said nothing about wall colors)
  // CANNOT be enforced at the unit-test level because Claude is mocked.
  // The system prompt is the only line of defense for that class of
  // hallucination — see Phase 6 E2E suite.
});

// ─── Marx12-shaped happy path ──────────────────────────────────────

describe("runStage1SpecExtract — Marx12-shaped happy path", () => {
  it("returns 3 apartments, 12 shots, populated baseline", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);

    const baseShot = {
      roomNameEn: "Open Kitchen-Dining",
      roomNameDe: "Kochen-Essen",
      areaSqm: 32.54,
      aspectRatio: "3:2",
      lightingDescription: "golden hour",
      cameraDescription: null,
      materialNotes: null,
    };
    const buildShots = () =>
      Array.from({ length: 4 }, (_, i) => ({
        ...baseShot,
        shotIndex: i + 1,
        isHero: i === 0,
      }));
    const apartmentBase = {
      labelDe: null,
      totalAreaSqm: 95.4,
      bedrooms: 2,
      bathrooms: 1,
      description: null,
    };
    const marxSpec = {
      projectTitle: "Marx12",
      projectLocation: "Berlin",
      projectType: "residential",
      baseline: {
        visualStyle: "photorealistic interior",
        materialPalette: "oak floor, white walls",
        lightingBaseline: "golden hour",
        cameraBaseline: "eye-level wide-angle",
        qualityTarget: "real-estate listing",
        additionalNotes: null,
      },
      apartments: [
        { ...apartmentBase, label: "WE 01bb", shots: buildShots() },
        { ...apartmentBase, label: "WE 02ab", shots: buildShots() },
        { ...apartmentBase, label: "WE 03cc", shots: buildShots() },
      ],
      referenceImageUrls: [],
    };
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(marxSpec));

    const result = await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-marx",
      logger,
    });

    expect(result.spec.apartments.length).toBe(3);
    // Phase 3 nested shape — shots live inside each apartment.
    expect(result.spec.apartments[0].shots.length).toBe(4);
    expect(result.spec.apartments[0].shots[0].isHero).toBe(true);
    expect(result.spec.apartments[0].shots[1].isHero).toBe(false);
    const allShots = result.spec.apartments.flatMap((a) => a.shots);
    expect(allShots.length).toBe(12);
    expect(allShots.filter((s) => s.isHero).length).toBe(3);
  });
});

// ─── System prompt content check ──────────────────────────────────

describe("BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT", () => {
  it('contains the exact phrase "STRICT FAITHFULNESS"', () => {
    expect(BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT).toContain("STRICT FAITHFULNESS");
  });

  it('contains the exact phrase "set it to `null`"', () => {
    expect(BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT).toContain("set it to `null`");
  });

  it("references all five rules by name (1, 2, 3, 4, 5)", () => {
    for (const ruleNumber of [1, 2, 3, 4, 5]) {
      expect(BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT).toMatch(
        new RegExp(`Rule ${ruleNumber}`, "i"),
      );
    }
  });
});

// ─── Anthropic call shape ──────────────────────────────────────────

describe("runStage1SpecExtract — Anthropic call shape", () => {
  it("forces tool_choice to the submit_brief_spec tool", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(VALID_SPEC));

    await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-tool",
      logger,
    });

    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    const [body] = messagesCreateMock.mock.calls[0];
    expect(body.tool_choice).toEqual({
      type: "tool",
      name: "submit_brief_spec",
    });
    expect(body.tools[0].name).toBe("submit_brief_spec");
    expect(body.system).toBe(BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT);
  });

  it("includes uploaded reference images as image content blocks", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);

    // Two embedded images that will be uploaded to R2.
    _setUnpdfForTest({
      getDocumentProxy: async () => ({ numPages: 1 }),
      extractImages: async () => [
        { width: 800, height: 600, channels: 4, data: new Uint8Array(800 * 600 * 4) },
        { width: 1024, height: 768, channels: 4, data: new Uint8Array(1024 * 768 * 4) },
      ],
    });
    uploadToR2Mock
      .mockResolvedValueOnce({
        success: true,
        url: "https://r2.example/ref-0.png",
        key: "k0",
        size: 1,
      })
      .mockResolvedValueOnce({
        success: true,
        url: "https://r2.example/ref-1.png",
        key: "k1",
        size: 1,
      });
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(VALID_SPEC));

    await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-imgs",
      logger,
    });

    const [body] = messagesCreateMock.mock.calls[0];
    const userContent = body.messages[0].content as Array<{ type: string }>;
    const imageBlocks = userContent.filter((b) => b.type === "image");
    expect(imageBlocks.length).toBe(2);
  });
});

// ─── SSRF guard ────────────────────────────────────────────────────

describe("runStage1SpecExtract — SSRF guard", () => {
  it("rejects a non-R2 URL BEFORE any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      runStage1SpecExtract({
        briefUrl: "https://malicious.example.com/brief.pdf",
        jobId: "job-ssrf",
        logger,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedBriefUrlError);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it("rejects internal-network URLs (no http/https)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      runStage1SpecExtract({
        briefUrl: "file:///etc/passwd",
        jobId: "job-file",
        logger,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedBriefUrlError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts URLs whose host matches R2_PUBLIC_URL", async () => {
    process.env.R2_PUBLIC_URL = "https://files.test.example";
    try {
      const fetchSpy = vi.fn().mockResolvedValue(
        makeFetchOk(pad(PDF_HEADER, 200)),
      );
      vi.stubGlobal("fetch", fetchSpy);
      messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(VALID_SPEC));

      await runStage1SpecExtract({
        briefUrl: "https://files.test.example/briefs/abc.pdf",
        jobId: "job-public",
        logger,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.R2_PUBLIC_URL;
    }
  });
});

// ─── Empty PDF / unsupported format ────────────────────────────────

describe("runStage1SpecExtract — extractor errors", () => {
  it("propagates EmptyPdfError when pdf-parse yields no text", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    _setPdfParseForTest(async () => ({ text: "", numpages: 1, info: {} }));

    await expect(
      runStage1SpecExtract({ briefUrl: VALID_R2_URL, jobId: "job-empty", logger }),
    ).rejects.toBeInstanceOf(EmptyPdfError);

    // Logger should record the failure.
    const log = logger.getStageLog();
    expect(log.length).toBe(1);
    expect(log[0].status).toBe("failed");
  });

  it("rejects bodies that match neither PDF nor DOCX magic bytes", async () => {
    const garbage = Buffer.from("this is not a real document at all");
    const fetchSpy = vi.fn().mockResolvedValue(
      makeFetchOk(garbage, "application/octet-stream"),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      runStage1SpecExtract({ briefUrl: VALID_R2_URL, jobId: "job-junk", logger }),
    ).rejects.toBeInstanceOf(UnsupportedBriefFormatError);
  });
});

// ─── DOCX path ─────────────────────────────────────────────────────

describe("runStage1SpecExtract — DOCX path", () => {
  it("classifies a ZIP-prefixed body as DOCX and runs mammoth", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeFetchOk(
        pad(ZIP_HEADER, 200),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(VALID_SPEC));

    const result = await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-docx",
      logger,
    });

    expect(result.pageCount).toBeNull(); // DOCX has no page concept here
    expect(result.spec.projectTitle).toBe("Marx12");
  });
});

// ─── Cost computation ─────────────────────────────────────────────

describe("runStage1SpecExtract — cost computation", () => {
  it("computes cost = (in/1M)*$3 + (out/1M)*$15", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    messagesCreateMock.mockResolvedValueOnce(
      makeSuccessResponse(VALID_SPEC, { in: 1000, out: 2000 }),
    );

    const result = await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-cost",
      logger,
    });

    // (1000 / 1e6) * 3 + (2000 / 1e6) * 15 = 0.003 + 0.030 = 0.033
    expect(result.tokensIn).toBe(1000);
    expect(result.tokensOut).toBe(2000);
    expect(result.costUsd).toBeCloseTo(0.033, 6);
    expect(logger.getTotalCost()).toBeCloseTo(0.033, 6);
  });
});

// ─── Logger spy ───────────────────────────────────────────────────

describe("runStage1SpecExtract — logger lifecycle", () => {
  it("calls startStage(1) → endStage(1, 'success') in order on happy path", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    messagesCreateMock.mockResolvedValueOnce(makeSuccessResponse(VALID_SPEC));

    const startSpy = vi.spyOn(logger, "startStage");
    const recordCostSpy = vi.spyOn(logger, "recordCost");
    const endSpy = vi.spyOn(logger, "endStage");

    await runStage1SpecExtract({
      briefUrl: VALID_R2_URL,
      jobId: "job-log",
      logger,
    });

    expect(startSpy).toHaveBeenCalledWith(1, "Spec Extract");
    expect(recordCostSpy).toHaveBeenCalledWith(1, expect.any(Number));
    expect(endSpy).toHaveBeenCalledWith(
      1,
      "success",
      expect.any(Object),
    );

    // Order: start → recordCost → end
    const startOrder = startSpy.mock.invocationCallOrder[0];
    const costOrder = recordCostSpy.mock.invocationCallOrder[0];
    const endOrder = endSpy.mock.invocationCallOrder[0];
    expect(startOrder).toBeLessThan(costOrder);
    expect(costOrder).toBeLessThan(endOrder);
  });

  it("calls startStage(1) → endStage(1, 'failed') on error", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeFetchOk(pad(PDF_HEADER, 200)));
    vi.stubGlobal("fetch", fetchSpy);
    _setPdfParseForTest(async () => ({ text: "", numpages: 1, info: {} }));

    const endSpy = vi.spyOn(logger, "endStage");

    await expect(
      runStage1SpecExtract({ briefUrl: VALID_R2_URL, jobId: "job-fail", logger }),
    ).rejects.toThrow();

    expect(endSpy).toHaveBeenCalledWith(
      1,
      "failed",
      undefined,
      expect.stringContaining("EMPTY_PDF"),
    );
  });
});
