/**
 * Tests for GET /api/kos/customer/drawings/[id] — summary endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireTenantOrThrowMock,
  requireKosCustomerMock,
  prismaMock,
  fetchKosObjectAsBufferMock,
} = vi.hoisted(() => ({
  requireTenantOrThrowMock: vi.fn(),
  requireKosCustomerMock: vi.fn(),
  prismaMock: {
    kosCustomerDrawing: { findFirst: vi.fn() },
  },
  fetchKosObjectAsBufferMock: vi.fn(),
}));

vi.mock("@/features/kos/lib/tenant-resolver", () => ({
  requireTenantOrThrow: requireTenantOrThrowMock,
}));
vi.mock("@/features/kos/services/kos-customer-auth", () => ({
  requireKosCustomer: requireKosCustomerMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/s3-client", () => ({
  fetchKosObjectAsBuffer: fetchKosObjectAsBufferMock,
}));

import { GET } from "../route";

const fakeTenant = { id: "tenant_1" } as never;
const fakeCustomer = { id: "cust_1" } as never;

function makeReq(): NextRequest {
  return new NextRequest("https://kalzen.example/api/kos/customer/drawings/draw_1", {
    method: "GET",
  });
}
async function callGet(id: string): Promise<Response> {
  return GET(makeReq(), { params: Promise.resolve({ id }) });
}

describe("GET drawing summary — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns full summary with both BOQ + Formwork download URLs when all data present", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "PARSED",
      errorCode: null,
      errorText: null,
      parseResult: { kind: "mapper", data: {} },
      fullParseResultS3Key: null,
      boqResultS3Key: "drawings/tenant_1/draw_1/boq.json",
      formworkResultS3Key: "drawings/tenant_1/draw_1/formwork.json",
    });

    fetchKosObjectAsBufferMock
      .mockResolvedValueOnce({
        buffer: Buffer.from(JSON.stringify({
          boq_id: "boq_x",
          tier_1_summary: {
            total_standard_panels: 15583,
            grand_total_inr_formatted: "₹4.8Cr",
            custom_quotes_pending_count: 81,
          },
          warnings: ["w1"],
        })),
        contentType: "application/json",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from(JSON.stringify({
          formwork_id: "frm_x",
          tier_1_summary: {
            total_props: 5456,
            total_walers: 5456,
            total_kickers: 24545,
          },
          warnings: [],
        })),
        contentType: "application/json",
      });

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.drawingId).toBe("draw_1");
    expect(j.filename).toBe("Plan.dxf");
    expect(j.status).toBe("PARSED");
    expect(j.hasMapper).toBe(true);
    expect(j.boq).toMatchObject({
      boqId: "boq_x",
      totalStandardPanels: 15583,
      grandTotalInrFormatted: "₹4.8Cr",
      customQuotesPendingCount: 81,
      warningsCount: 1,
      downloadUrl: "/api/kos/customer/drawings/draw_1/boq/download",
    });
    expect(j.formwork).toMatchObject({
      formworkId: "frm_x",
      propsCount: 5456,
      walersCount: 5456,
      kickersCount: 24545,
      downloadUrl: "/api/kos/customer/drawings/draw_1/formwork/download",
    });
  });

  it("when boqResultS3Key set but fetch fails → response is 200 with boq: null (graceful)", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "PARSED",
      errorCode: null,
      errorText: null,
      parseResult: { kind: "mapper", data: {} },
      fullParseResultS3Key: null,
      boqResultS3Key: "drawings/tenant_1/draw_1/boq.json",
      formworkResultS3Key: null,
    });
    fetchKosObjectAsBufferMock.mockRejectedValueOnce(new Error("S3 down"));

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.boq).toBeNull();
    expect(j.formwork).toBeNull();
  });

  it("when only parser envelope present → drawingSummary populated from inline parser data", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "PARSED",
      errorCode: null,
      errorText: null,
      parseResult: {
        kind: "parser",
        data: {
          walls: new Array(140).fill({}),
          junctions: new Array(213).fill({}),
          openings: new Array(25).fill({}),
          title_block: { drawing_title: "Plan A" },
          drawing_type: "FLOOR_PLAN",
          drawing_type_confidence: 0.9,
        },
      },
      fullParseResultS3Key: null,
      boqResultS3Key: null,
      formworkResultS3Key: null,
    });

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.hasMapper).toBe(false);
    expect(j.drawingSummary).toMatchObject({
      walls: 140,
      junctions: 213,
      openings: 25,
      titleBlockDrawingTitle: "Plan A",
      drawingType: "FLOOR_PLAN",
      drawingTypeConfidence: 0.9,
    });
  });

  it("mapper-only envelope + fullParseResultS3Key fetch failure → drawingSummary null (graceful)", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "PARSED",
      errorCode: null,
      errorText: null,
      parseResult: { kind: "mapper", data: {} },
      fullParseResultS3Key: "drawings/tenant_1/draw_1/parser-result.json",
      boqResultS3Key: null,
      formworkResultS3Key: null,
    });
    fetchKosObjectAsBufferMock.mockRejectedValueOnce(new Error("S3 down"));

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.hasMapper).toBe(true);
    expect(j.drawingSummary).toBeNull();
  });

  it("FAILED drawing → errorCode + errorMessage surfaced", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "FAILED",
      errorCode: "KOS_DRAWING_004",
      errorText: "scanned PDF",
      parseResult: null,
      fullParseResultS3Key: null,
      boqResultS3Key: null,
      formworkResultS3Key: null,
    });

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("FAILED");
    expect(j.errorCode).toBe("KOS_DRAWING_004");
    expect(j.errorMessage).toContain("scanned");
  });
});

describe("GET drawing summary — C2 / cross-tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  it("THREAT: drawing not owned → 404 KOS_DL_SUMMARY_001", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(null);
    const res = await callGet("draw_other_customer");
    expect(res.status).toBe(404);
    const j = await res.json();
    expect(j.error_code).toBe("KOS_DL_SUMMARY_001");
  });

  it("THREAT: cross-tenant → 404 same envelope", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(null);
    const res = await callGet("draw_other_tenant");
    expect(res.status).toBe(404);
    const j = await res.json();
    expect(j.error_code).toBe("KOS_DL_SUMMARY_001");
  });
});

describe("GET drawing summary — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  it("parseResult is null → drawingSummary null + hasMapper false", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "PARSING",
      errorCode: null,
      errorText: null,
      parseResult: null,
      fullParseResultS3Key: null,
      boqResultS3Key: null,
      formworkResultS3Key: null,
    });

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.drawingSummary).toBeNull();
    expect(j.hasMapper).toBe(false);
    expect(j.boq).toBeNull();
    expect(j.formwork).toBeNull();
  });

  it("parseResult.kind === 'mapper_s3' → hasMapper true; no inline drawingSummary", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      id: "draw_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      originalFilename: "Plan.dxf",
      status: "PARSED",
      errorCode: null,
      errorText: null,
      parseResult: { kind: "mapper_s3", s3Key: "k" },
      fullParseResultS3Key: null,
      boqResultS3Key: null,
      formworkResultS3Key: null,
    });

    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.hasMapper).toBe(true);
    expect(j.drawingSummary).toBeNull();
  });
});
