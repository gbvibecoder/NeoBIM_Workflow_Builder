/**
 * Unit tests for the process_drawing bot tool.
 *
 * Mocks every external boundary: prisma, sidecar wrappers, S3 helpers.
 * Asserts state transitions on KosCustomerDrawing, envelope shapes,
 * and the four terminal outcomes (ready / needs_classification /
 * scanned_pdf / failed) plus the C2 threat.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, parseDrawingFromS3Mock, generatePanelLayoutMock, uploadKosObjectMock, fetchKosObjectAsBufferMock } =
  vi.hoisted(() => ({
    prismaMock: {
      kosCustomerDrawing: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
    parseDrawingFromS3Mock: vi.fn(),
    generatePanelLayoutMock: vi.fn(),
    uploadKosObjectMock: vi.fn(),
    fetchKosObjectAsBufferMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/kos-drawing-parser", () => ({
  parseDrawingFromS3: parseDrawingFromS3Mock,
}));
vi.mock("@/features/kos/services/kos-panel-mapper", () => ({
  generatePanelLayout: generatePanelLayoutMock,
}));
vi.mock("@/features/kos/services/s3-client", () => ({
  uploadKosObject: uploadKosObjectMock,
  fetchKosObjectAsBuffer: fetchKosObjectAsBufferMock,
  kosS3Key: (_tenant: unknown, kind: string, ...segments: string[]) =>
    [kind, "tenant_1", ...segments].join("/"),
}));

import { processDrawingTool } from "../tool-process-drawing";
import { KosError } from "@/features/kos/lib/kos-errors";
import type { Tenant, KosCustomer, KosCustomerDrawing } from "@prisma/client";
import type { DrawingParseResult } from "@/features/kos/types/drawing";
import type { MapperOutput } from "@/features/kos/types/sidecar";

const fakeTenant = { id: "tenant_1", slug: "kalzen" } as unknown as Tenant;
const fakeCustomer = { id: "cust_1" } as unknown as KosCustomer;
const fakeCtx = () => ({
  tenant: fakeTenant,
  customer: fakeCustomer,
  sidecarCallsRemaining: { count: 6 },
});

function buildDrawing(overrides: Partial<KosCustomerDrawing> = {}): KosCustomerDrawing {
  return {
    id: "draw_1",
    tenantId: "tenant_1",
    customerId: "cust_1",
    conversationId: null,
    filename: "test.dxf",
    originalFilename: "test.dxf",
    sourceFormat: "dxf",
    sizeBytes: 1000,
    actualSizeBytes: 1000,
    s3Key: "drawings/tenant_1/cust_1/draw_1/source.dxf",
    status: "UPLOADED",
    parseResult: null,
    fullParseResultS3Key: null,
    parserVersion: null,
    errorCode: null,
    errorText: null,
    parsedAt: null,
    boqResultS3Key: null,
    formworkResultS3Key: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KosCustomerDrawing;
}

function buildParseFixture(overrides: Partial<DrawingParseResult> = {}): DrawingParseResult {
  return {
    filename: "test.dxf",
    format: "dxf",
    size_bytes: 1000,
    parser_version: "0.2.0",
    phase: "5C-2",
    drawing_type: "FLOOR_PLAN",
    drawing_type_confidence: 0.9,
    drawing_classification_signals: [],
    drawing_classification_reasoning: "",
    title_block: {
      project_name: "Test Project",
      drawing_number: null,
      drawing_title: "Plan A",
      revision: null,
      scale: null,
      date: null,
      sheet: null,
      level: null,
      client: null,
      drawn_by: null,
      checked_by: null,
      raw_text_block: "",
      source: "title_block",
      extraction_warnings: [],
    },
    walls: [],
    junctions: [],
    openings: [],
    layers_found: [],
    drawing_bounds: { min_x: 0, min_y: 0, max_x: 0, max_y: 0 },
    units_detected: "mm",
    stats: {
      total_entities: 0,
      walls_count: 0,
      junctions_count: 0,
      title_block_fields_extracted: 0,
      lines: 0,
      polylines: 0,
      text: 0,
      dimensions: 0,
      circles: 0,
      blocks: 0,
    },
    warnings: [],
    detection_strategy_used: "tier_1",
    overall_confidence: 0.85,
    field_confidences: { walls: 0.85, title_block: 1 },
    missing_data: [],
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 100,
    debug_png_base64: null,
    ...overrides,
  } as DrawingParseResult;
}

function buildMapperFixture(overrides: Partial<MapperOutput> = {}): MapperOutput {
  return {
    project_name: "Test Project",
    seismic_zone: "III",
    split_strategy_used: "minimize_cuts",
    wall_height_mm: 3000,
    wall_segments: [],
    custom_quote_requests: [],
    total_counts: {},
    total_cost_inr: 0,
    total_weight_kg: 0,
    total_skin_kg: 0,
    total_rib_kg: 0,
    total_raw_kg: 0,
    total_waste_kg: 0,
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
    info_notes: [],
    schema_version: "0.1.0",
    generated_at: "2026-05-27T00:00:00Z",
    waste_ratio: 0,
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 0,
    ...overrides,
  };
}

describe("processDrawingTool", () => {
  beforeEach(() => {
    prismaMock.kosCustomerDrawing.findFirst.mockReset();
    prismaMock.kosCustomerDrawing.update.mockReset();
    parseDrawingFromS3Mock.mockReset();
    generatePanelLayoutMock.mockReset();
    uploadKosObjectMock.mockReset();
    fetchKosObjectAsBufferMock.mockReset();
    uploadKosObjectMock.mockResolvedValue({ key: "x", eTag: "x" });
    prismaMock.kosCustomerDrawing.update.mockResolvedValue(buildDrawing());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("C2 boundary", () => {
    it("THREAT: drawing belongs to different customer → KosError 404 BEFORE any sidecar call", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(null);
      const ctx = fakeCtx();

      await expect(
        processDrawingTool({ drawing_id: "draw_other_customer" }, ctx),
      ).rejects.toMatchObject({
        code: "KOS_TOOL_PROCESS_DRAWING_001",
        httpStatus: 404,
      });
      expect(parseDrawingFromS3Mock).not.toHaveBeenCalled();
      expect(generatePanelLayoutMock).not.toHaveBeenCalled();
      expect(ctx.sidecarCallsRemaining.count).toBe(6);
    });
  });

  describe("happy path", () => {
    it("parse + mapper succeed → status='ready' with summaries; PARSING then PARSED state transitions; parser persisted to S3", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      const parsed = buildParseFixture({ walls: new Array(5).fill({}) as never });
      parseDrawingFromS3Mock.mockResolvedValueOnce(parsed);
      generatePanelLayoutMock.mockResolvedValueOnce(buildMapperFixture());
      const ctx = fakeCtx();

      const result = await processDrawingTool({ drawing_id: "draw_1" }, ctx);

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.drawing_summary.walls_count).toBe(5);
        expect(result.drawing_summary.parser_version).toBe("0.2.0");
        expect(result.drawing_summary.drawing_type).toBe("FLOOR_PLAN");
        expect(result.mapper_summary.downstream_ready_boq).toBe(true);
      }

      // PARSING transition + final PARSED + envelope write + parser S3 update
      const updateCalls = prismaMock.kosCustomerDrawing.update.mock.calls.map(
        (c) => (c[0] as { data: Record<string, unknown> }).data,
      );
      expect(updateCalls.some((d) => d.status === "PARSING")).toBe(true);
      expect(updateCalls.some((d) => d.status === "PARSED" && d.parserVersion === "0.2.0")).toBe(true);

      // Parser persisted to S3 (envelope: parser-result.json key)
      expect(uploadKosObjectMock).toHaveBeenCalledWith(
        fakeTenant,
        "drawings/tenant_1/draw_1/parser-result.json",
        expect.any(Buffer),
        "application/json",
      );

      // Two sidecar calls consumed
      expect(ctx.sidecarCallsRemaining.count).toBe(4);
    });
  });

  describe("UNKNOWN classifier", () => {
    it("parse=UNKNOWN, no hint → status='needs_classification' with suggested_hints; mapper NOT called; envelope kind='parser'", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      parseDrawingFromS3Mock.mockResolvedValueOnce(
        buildParseFixture({
          drawing_type: "UNKNOWN",
          drawing_type_confidence: 0,
          title_block: {
            project_name: null,
            drawing_number: null,
            drawing_title: "Mystery Drawing",
            revision: null,
            scale: null,
            date: null,
            sheet: null,
            level: "BASEMENT",
            client: null,
            drawn_by: null,
            checked_by: null,
            raw_text_block: "",
            source: "mixed",
            extraction_warnings: [],
          },
        }),
      );
      const ctx = fakeCtx();

      const result = await processDrawingTool({ drawing_id: "draw_1" }, ctx);

      expect(result.status).toBe("needs_classification");
      if (result.status === "needs_classification") {
        expect(result.title_block.drawing_title).toBe("Mystery Drawing");
        expect(result.title_block.level).toBe("BASEMENT");
        expect(result.suggested_hints.length).toBeGreaterThan(0);
        expect(result.message).toContain("Mystery Drawing");
      }
      expect(generatePanelLayoutMock).not.toHaveBeenCalled();
      expect(ctx.sidecarCallsRemaining.count).toBe(5);  // only parse consumed

      // Envelope persisted as kind="parser"
      const updateCalls = prismaMock.kosCustomerDrawing.update.mock.calls;
      const envelopeUpdate = updateCalls.find(
        (c) => (c[0] as { data: Record<string, unknown> }).data.parseResult,
      );
      expect(envelopeUpdate).toBeDefined();
      const envelope = (envelopeUpdate![0] as { data: { parseResult: { kind: string } } }).data
        .parseResult;
      expect(envelope.kind).toBe("parser");
    });
  });

  describe("re-classification round", () => {
    it("cached parser envelope + application_hint → reuses parsed JSON, no re-parse, calls mapper with hint", async () => {
      const cachedParsed = buildParseFixture({ drawing_type: "UNKNOWN" });
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
        buildDrawing({
          status: "PARSED",
          parseResult: { kind: "parser", data: cachedParsed } as never,
        }),
      );
      generatePanelLayoutMock.mockResolvedValueOnce(buildMapperFixture());
      const ctx = fakeCtx();

      const result = await processDrawingTool(
        { drawing_id: "draw_1", application_hint: "villa_external" },
        ctx,
      );

      expect(result.status).toBe("ready");
      expect(parseDrawingFromS3Mock).not.toHaveBeenCalled();  // re-used cache
      expect(generatePanelLayoutMock).toHaveBeenCalledTimes(1);
      const mapperCallArgs = generatePanelLayoutMock.mock.calls[0][0];
      expect(mapperCallArgs.context.application_hint).toBe("villa_external");
      expect(ctx.sidecarCallsRemaining.count).toBe(5);  // only mapper consumed
    });
  });

  describe("scanned PDF", () => {
    it("parser throws KOS_DRAWING_004 → status='scanned_pdf' with FAILED state + errorCode set", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
        buildDrawing({ sourceFormat: "pdf" }),
      );
      parseDrawingFromS3Mock.mockRejectedValueOnce(
        new KosError("KOS_DRAWING_004", "PDF appears to be a scanned image", 415),
      );
      const ctx = fakeCtx();

      const result = await processDrawingTool({ drawing_id: "draw_1" }, ctx);

      expect(result.status).toBe("scanned_pdf");
      if (result.status === "scanned_pdf") {
        expect(result.message).toContain("scanned image");
      }
      const updateCalls = prismaMock.kosCustomerDrawing.update.mock.calls;
      const failedUpdate = updateCalls.find(
        (c) => (c[0] as { data: Record<string, unknown> }).data.status === "FAILED",
      );
      expect(failedUpdate).toBeDefined();
      expect((failedUpdate![0] as { data: Record<string, unknown> }).data.errorCode).toBe(
        "KOS_DRAWING_004",
      );
    });
  });

  describe("generic failure", () => {
    it("mapper throws schema error → status='failed' with sidecar code preserved + FAILED state", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      parseDrawingFromS3Mock.mockResolvedValueOnce(buildParseFixture());
      generatePanelLayoutMock.mockRejectedValueOnce(
        new KosError(
          "KOS_MAPPER_SIDECAR_4XX",
          "MAPPER_INPUT_INVALID: IV-1 expected FLOOR_PLAN",
          400,
        ),
      );
      const ctx = fakeCtx();

      const result = await processDrawingTool({ drawing_id: "draw_1" }, ctx);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error_code).toBe("KOS_MAPPER_SIDECAR_4XX");
        expect(result.error_message).toContain("MAPPER_INPUT_INVALID");
      }
    });
  });

  describe("sidecar quota", () => {
    it("quota=0 at entry → KOS_BOT_QUOTA_EXCEEDED thrown; no sidecar call", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      const ctx = { ...fakeCtx(), sidecarCallsRemaining: { count: 0 } };

      await expect(
        processDrawingTool({ drawing_id: "draw_1" }, ctx),
      ).rejects.toMatchObject({
        code: "KOS_BOT_QUOTA_EXCEEDED",
        httpStatus: 429,
      });
      expect(parseDrawingFromS3Mock).not.toHaveBeenCalled();
    });

    it("quota=1 with UNKNOWN parse → quota=0 after parse, no mapper call, returns needs_classification (not quota exceeded)", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      parseDrawingFromS3Mock.mockResolvedValueOnce(
        buildParseFixture({ drawing_type: "UNKNOWN" }),
      );
      const ctx = { ...fakeCtx(), sidecarCallsRemaining: { count: 1 } };

      const result = await processDrawingTool({ drawing_id: "draw_1" }, ctx);
      expect(result.status).toBe("needs_classification");
      expect(ctx.sidecarCallsRemaining.count).toBe(0);
    });
  });

  describe("cache reuse", () => {
    it("already-PARSED drawing with cached mapper envelope + NO hint → returns ready without any sidecar call", async () => {
      const cachedMapper = buildMapperFixture();
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
        buildDrawing({
          status: "PARSED",
          parseResult: { kind: "mapper", data: cachedMapper } as never,
        }),
      );
      const ctx = fakeCtx();

      const result = await processDrawingTool({ drawing_id: "draw_1" }, ctx);

      expect(result.status).toBe("ready");
      expect(parseDrawingFromS3Mock).not.toHaveBeenCalled();
      expect(generatePanelLayoutMock).not.toHaveBeenCalled();
      expect(ctx.sidecarCallsRemaining.count).toBe(6);
    });
  });
});
