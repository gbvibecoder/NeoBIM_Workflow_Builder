/**
 * Unit tests for generate_formwork bot tool.
 *
 * Mirrors generate_boq tests with formwork-specific differences:
 *  - response has 15 keys (no commercial_terms; tier_6_components)
 *  - summary contains prop/waler/kicker counts, not INR figures
 *  - S3 key suffix is `formwork.json`, row column is `formworkResultS3Key`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, generateFormworkMock, uploadKosObjectMock, fetchKosObjectAsBufferMock } =
  vi.hoisted(() => ({
    prismaMock: {
      kosCustomerDrawing: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
    generateFormworkMock: vi.fn(),
    uploadKosObjectMock: vi.fn(),
    fetchKosObjectAsBufferMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/kos-formwork-generator", () => ({
  generateFormwork: generateFormworkMock,
}));
vi.mock("@/features/kos/services/s3-client", () => ({
  uploadKosObject: uploadKosObjectMock,
  fetchKosObjectAsBuffer: fetchKosObjectAsBufferMock,
  kosS3Key: (_t: unknown, kind: string, ...segments: string[]) =>
    [kind, "tenant_1", ...segments].join("/"),
}));

import { generateFormworkTool } from "../tool-generate-formwork";
import { KosError } from "@/features/kos/lib/kos-errors";
import type { KosCustomer, KosCustomerDrawing, Tenant } from "@prisma/client";
import type { FormworkOutput, MapperOutput } from "@/features/kos/types/sidecar";

const fakeTenant = { id: "tenant_1" } as unknown as Tenant;
const fakeCustomer = { id: "cust_1" } as unknown as KosCustomer;
const fakeCtx = () => ({
  tenant: fakeTenant,
  customer: fakeCustomer,
  sidecarCallsRemaining: { count: 6 },
});

function buildMapperFixture(): MapperOutput {
  return {
    project_name: "Test",
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

function buildFormworkFixture(): FormworkOutput {
  return {
    formwork_id: "frm_xyz",
    generated_at: "2026-05-27T00:00:00Z",
    schema_version: "0.1.0",
    tier_1_summary: {
      total_props: 5456,
      total_walers: 5456,
      total_kickers: 24545,
      total_starter_track_meters: 4908.75,
    },
    tier_2_categories: {},
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_components: [],
    custom_quote_items: [],
    operator_review_items: [],
    audit_trail: {},
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
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

describe("generateFormworkTool", () => {
  beforeEach(() => {
    prismaMock.kosCustomerDrawing.findFirst.mockReset();
    prismaMock.kosCustomerDrawing.update.mockReset();
    generateFormworkMock.mockReset();
    uploadKosObjectMock.mockReset();
    fetchKosObjectAsBufferMock.mockReset();
    uploadKosObjectMock.mockResolvedValue({ key: "x", eTag: "x" });
    prismaMock.kosCustomerDrawing.update.mockResolvedValue(buildDrawing());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("THREAT C2: wrong customer → KosError 404, no sidecar call", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(null);
    const ctx = fakeCtx();
    await expect(
      generateFormworkTool({ drawing_id: "draw_other" }, ctx),
    ).rejects.toMatchObject({ code: "KOS_TOOL_FRM_001", httpStatus: 404 });
    expect(generateFormworkMock).not.toHaveBeenCalled();
  });

  it("happy path: PARSED with inline mapper → uploads formwork.json + updates formworkResultS3Key", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
    generateFormworkMock.mockResolvedValueOnce(buildFormworkFixture());
    const ctx = fakeCtx();

    const result = await generateFormworkTool({ drawing_id: "draw_1" }, ctx);

    expect(result.status).toBe("generated");
    if (result.status === "generated") {
      expect(result.s3_key).toBe("drawings/tenant_1/draw_1/formwork.json");
      expect(result.formwork_id).toBe("frm_xyz");
      expect(result.summary.total_props).toBe(5456);
      expect(result.summary.total_kickers).toBe(24545);
      expect(result.summary.total_starter_track_meters).toBe(4908.75);
    }

    expect(uploadKosObjectMock).toHaveBeenCalledWith(
      fakeTenant,
      "drawings/tenant_1/draw_1/formwork.json",
      expect.any(Buffer),
      "application/json",
    );
    const rowUpdate = prismaMock.kosCustomerDrawing.update.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.formworkResultS3Key,
    );
    expect(rowUpdate).toBeDefined();
    expect(ctx.sidecarCallsRemaining.count).toBe(5);
  });

  it("not PARSED → status='no_mapper_output'", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
      buildDrawing({ status: "UPLOADED", parseResult: null }),
    );
    const result = await generateFormworkTool({ drawing_id: "draw_1" }, fakeCtx());
    expect(result.status).toBe("no_mapper_output");
  });

  it("parser-only envelope (UNKNOWN waiting) → no_mapper_output with KOS_TOOL_FRM_005", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(
      buildDrawing({ parseResult: { kind: "parser", data: {} } as never }),
    );
    const result = await generateFormworkTool({ drawing_id: "draw_1" }, fakeCtx());
    expect(result.status).toBe("no_mapper_output");
    if (result.status === "no_mapper_output") {
      expect(result.error_code).toBe("KOS_TOOL_FRM_005");
    }
  });

  it("generateFormwork throws → status='failed' with code preserved", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
    generateFormworkMock.mockRejectedValueOnce(
      new KosError("KOS_FRM_GEN_SIDECAR_4XX", "FORMWORK_INPUT_INVALID", 400),
    );
    const result = await generateFormworkTool({ drawing_id: "draw_1" }, fakeCtx());
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error_code).toBe("KOS_FRM_GEN_SIDECAR_4XX");
    }
  });

  it("S3 PUT throws → KOS_TOOL_FRM_004 thrown (not 'failed' status)", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
    generateFormworkMock.mockResolvedValueOnce(buildFormworkFixture());
    uploadKosObjectMock.mockRejectedValueOnce(new Error("S3 down"));
    await expect(
      generateFormworkTool({ drawing_id: "draw_1" }, fakeCtx()),
    ).rejects.toMatchObject({ code: "KOS_TOOL_FRM_004", httpStatus: 500 });
  });

  it("quota=0 → KOS_BOT_QUOTA_EXCEEDED", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValueOnce(buildDrawing());
    const ctx = { ...fakeCtx(), sidecarCallsRemaining: { count: 0 } };
    await expect(
      generateFormworkTool({ drawing_id: "draw_1" }, ctx),
    ).rejects.toMatchObject({ code: "KOS_BOT_QUOTA_EXCEEDED", httpStatus: 429 });
  });
});
