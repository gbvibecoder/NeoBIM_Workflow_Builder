/**
 * Unit tests for the generate_boq bot tool.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, generateBoqMock, uploadKosObjectMock, fetchKosObjectAsBufferMock } =
  vi.hoisted(() => ({
    prismaMock: {
      kosCustomerDrawing: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
    generateBoqMock: vi.fn(),
    uploadKosObjectMock: vi.fn(),
    fetchKosObjectAsBufferMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/kos-boq-generator", () => ({
  generateBoq: generateBoqMock,
}));
vi.mock("@/features/kos/services/s3-client", () => ({
  uploadKosObject: uploadKosObjectMock,
  fetchKosObjectAsBuffer: fetchKosObjectAsBufferMock,
  kosS3Key: (_t: unknown, kind: string, ...segments: string[]) =>
    [kind, "tenant_1", ...segments].join("/"),
}));

import { generateBoqTool } from "../tool-generate-boq";
import { KosError } from "@/features/kos/lib/kos-errors";
import type { KosCustomer, KosCustomerDrawing, Tenant } from "@prisma/client";
import type { BOQOutput, MapperOutput } from "@/features/kos/types/sidecar";

const fakeTenant = { id: "tenant_1" } as unknown as Tenant;
const fakeCustomer = { id: "cust_1" } as unknown as KosCustomer;
const fakeCtx = () => ({
  tenant: fakeTenant,
  customer: fakeCustomer,
  sidecarCallsRemaining: { count: 6 },
});

function buildMapperFixture(): MapperOutput {
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
  };
}

function buildBoqFixture(): BOQOutput {
  return {
    boq_id: "boq_xyz",
    generated_at: "2026-05-27T00:00:00Z",
    schema_version: "0.1.0",
    tier_1_summary: {
      total_standard_panels: 15583,
      grand_total_inr_formatted: "₹4,80,70,359.97",
      custom_quotes_pending_count: 81,
    },
    tier_2_categories: {},
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_panel_pieces: [],
    custom_quote_items: [],
    operator_review_items: [],
    commercial_terms: {},
    audit_trail: {},
    warnings: ["w1"],
    assumptions_made: [],
    pending_karthik: ["x", "y"],
  };
}

function buildDrawing(overrides: Partial<KosCustomerDrawing> = {}): KosCustomerDrawing {
  return {
    id: "draw_1",
    tenantId: "tenant_1",
    customerId: "cust_1",
    conversationId: null,
    filename: "x.dxf",
    originalFilename: "x.dxf",
    sourceFormat: "dxf",
    sizeBytes: 1,
    actualSizeBytes: 1,
    s3Key: "drawings/tenant_1/cust_1/draw_1/source.dxf",
    status: "PARSED",
    parseResult: { kind: "mapper", data: buildMapperFixture() } as never,
    fullParseResultS3Key: null,
    parserVersion: "0.2.0",
    errorCode: null,
    errorText: null,
    parsedAt: new Date(),
    boqResultS3Key: null,
    formworkResultS3Key: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KosCustomerDrawing;
}

describe("generateBoqTool", () => {
  beforeEach(() => {
    prismaMock.kosCustomerDrawing.findFirst.mockReset();
    prismaMock.kosCustomerDrawing.update.mockReset();
    generateBoqMock.mockReset();
    uploadKosObjectMock.mockReset();
    fetchKosObjectAsBufferMock.mockReset();
    uploadKosObjectMock.mockResolvedValue({ key: "x", eTag: "x" });
    prismaMock.kosCustomerDrawing.update.mockResolvedValue(buildDrawing());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("C2 boundary", () => {
    it("THREAT: drawing belongs to different customer → KosError 404, no sidecar call", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(null);
      const ctx = fakeCtx();
      await expect(
        generateBoqTool({ drawing_id: "draw_other" }, ctx),
      ).rejects.toMatchObject({ code: "KOS_TOOL_BOQ_001", httpStatus: 404 });
      expect(generateBoqMock).not.toHaveBeenCalled();
      expect(ctx.sidecarCallsRemaining.count).toBe(6);
    });
  });

  describe("happy path", () => {
    it("PARSED drawing with mapper inline → generate succeeds, uploads to S3, updates row", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      generateBoqMock.mockResolvedValueOnce(buildBoqFixture());
      const ctx = fakeCtx();

      const result = await generateBoqTool({ drawing_id: "draw_1" }, ctx);

      expect(result.status).toBe("generated");
      if (result.status === "generated") {
        expect(result.s3_key).toBe("drawings/tenant_1/draw_1/boq.json");
        expect(result.boq_id).toBe("boq_xyz");
        expect(result.summary.total_standard_panels).toBe(15583);
        expect(result.summary.grand_total_inr_formatted).toBe("₹4,80,70,359.97");
        expect(result.warnings_count).toBe(1);
        expect(result.pending_karthik_count).toBe(2);
      }

      // generateBoq called with mapper from envelope + auto-filled context
      const callArgs = generateBoqMock.mock.calls[0][0];
      expect(callArgs.context.project_id).toBe("draw_1");
      expect(callArgs.context.quote_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Upload + row update
      expect(uploadKosObjectMock).toHaveBeenCalledWith(
        fakeTenant,
        "drawings/tenant_1/draw_1/boq.json",
        expect.any(Buffer),
        "application/json",
      );
      const rowUpdate = prismaMock.kosCustomerDrawing.update.mock.calls.find(
        (c) => (c[0] as { data: Record<string, unknown> }).data.boqResultS3Key,
      );
      expect(rowUpdate).toBeDefined();
      expect(ctx.sidecarCallsRemaining.count).toBe(5);
    });

    it("loads mapper from S3 when envelope kind='mapper_s3'", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
        buildDrawing({
          parseResult: { kind: "mapper_s3", s3Key: "drawings/tenant_1/draw_1/mapper-result.json" } as never,
        }),
      );
      fetchKosObjectAsBufferMock.mockResolvedValueOnce({
        buffer: Buffer.from(JSON.stringify(buildMapperFixture()), "utf-8"),
        contentType: "application/json",
      });
      generateBoqMock.mockResolvedValueOnce(buildBoqFixture());

      const result = await generateBoqTool({ drawing_id: "draw_1" }, fakeCtx());
      expect(result.status).toBe("generated");
      expect(fetchKosObjectAsBufferMock).toHaveBeenCalledWith(
        fakeTenant,
        "drawings/tenant_1/draw_1/mapper-result.json",
      );
    });
  });

  describe("preconditions", () => {
    it("drawing not PARSED → status='no_mapper_output'", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
        buildDrawing({ status: "UPLOADED", parseResult: null }),
      );
      const result = await generateBoqTool({ drawing_id: "draw_1" }, fakeCtx());
      expect(result.status).toBe("no_mapper_output");
      if (result.status === "no_mapper_output") {
        expect(result.error_code).toBe("KOS_TOOL_BOQ_002");
      }
      expect(generateBoqMock).not.toHaveBeenCalled();
    });

    it("envelope kind='parser' (UNKNOWN waiting for hint) → status='no_mapper_output' with KOS_TOOL_BOQ_005", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
        buildDrawing({ parseResult: { kind: "parser", data: {} } as never }),
      );
      const result = await generateBoqTool({ drawing_id: "draw_1" }, fakeCtx());
      expect(result.status).toBe("no_mapper_output");
      if (result.status === "no_mapper_output") {
        expect(result.error_code).toBe("KOS_TOOL_BOQ_005");
        expect(result.error_message).toContain("application_hint");
      }
    });
  });

  describe("failure paths", () => {
    it("generateBoq throws KosError → status='failed' with sidecar code preserved", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      generateBoqMock.mockRejectedValueOnce(
        new KosError("KOS_BOQ_GEN_SIDECAR_4XX", "BOQ_INPUT_INVALID", 400),
      );
      const result = await generateBoqTool({ drawing_id: "draw_1" }, fakeCtx());
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error_code).toBe("KOS_BOQ_GEN_SIDECAR_4XX");
      }
    });

    it("S3 PUT throws → KosError KOS_TOOL_BOQ_004 thrown (not 'failed' status)", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      generateBoqMock.mockResolvedValueOnce(buildBoqFixture());
      uploadKosObjectMock.mockRejectedValueOnce(new Error("S3 unreachable"));
      await expect(
        generateBoqTool({ drawing_id: "draw_1" }, fakeCtx()),
      ).rejects.toMatchObject({
        code: "KOS_TOOL_BOQ_004",
        httpStatus: 500,
      });
    });

    it("quota exhausted at entry → KOS_BOT_QUOTA_EXCEEDED", async () => {
      prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
      const ctx = { ...fakeCtx(), sidecarCallsRemaining: { count: 0 } };
      await expect(
        generateBoqTool({ drawing_id: "draw_1" }, ctx),
      ).rejects.toMatchObject({ code: "KOS_BOT_QUOTA_EXCEEDED", httpStatus: 429 });
      expect(generateBoqMock).not.toHaveBeenCalled();
    });
  });
});
