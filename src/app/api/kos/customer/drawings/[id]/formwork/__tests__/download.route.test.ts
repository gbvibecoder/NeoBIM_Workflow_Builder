/**
 * Tests for GET /api/kos/customer/drawings/[id]/formwork/download.
 * Mirrors the BOQ download tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireTenantOrThrowMock,
  requireKosCustomerMock,
  prismaMock,
  fetchKosObjectAsBufferMock,
  renderFormworkPdfMock,
} = vi.hoisted(() => ({
  requireTenantOrThrowMock: vi.fn(),
  requireKosCustomerMock: vi.fn(),
  prismaMock: {
    kosCustomerDrawing: { findFirst: vi.fn() },
  },
  fetchKosObjectAsBufferMock: vi.fn(),
  renderFormworkPdfMock: vi.fn(),
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
vi.mock("@/features/kos/services/renderers/formwork-pdf-renderer", () => ({
  renderFormworkPdf: renderFormworkPdfMock,
}));

import { GET } from "../download/route";
import { KosError } from "@/features/kos/lib/kos-errors";

const fakeTenant = { id: "tenant_1" } as never;
const fakeCustomer = { id: "cust_1" } as never;

function makeReq(): NextRequest {
  return new NextRequest("https://kalzen.example/api/kos/customer/drawings/draw_1/formwork/download", {
    method: "GET",
  });
}
async function callGet(id: string): Promise<Response> {
  return GET(makeReq(), { params: Promise.resolve({ id }) });
}
async function readJson(res: Response): Promise<{ error_code: string; message: string }> {
  return res.json();
}

const validDrawing = {
  id: "draw_1",
  tenantId: "tenant_1",
  customerId: "cust_1",
  originalFilename: "Plan.dxf",
  formworkResultS3Key: "drawings/tenant_1/draw_1/formwork.json",
  parseResult: null,
};

describe("GET Formwork download — auth + happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ formwork_id: "frm_x" })),
      contentType: "application/json",
    });
    renderFormworkPdfMock.mockResolvedValue(Buffer.from("PDF_BYTES"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: 200 + application/pdf + content-disposition + buffer", async () => {
    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("Formwork_quantities_Plan.pdf");
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const ab = await res.arrayBuffer();
    expect(Buffer.from(ab).toString("utf-8")).toBe("PDF_BYTES");
  });
});

describe("GET Formwork download — C2 / cross-tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  it("THREAT: drawing not owned by customer → 404 KOS_DL_FRM_001", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(null);
    const res = await callGet("draw_other_customer");
    expect(res.status).toBe(404);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_FRM_001");
  });

  it("THREAT: drawing in different tenant → 404 same envelope as cross-customer", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(null);
    const res = await callGet("draw_other_tenant");
    expect(res.status).toBe(404);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_FRM_001");
  });
});

describe("GET Formwork download — error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  it("formworkResultS3Key null → 404 KOS_DL_FRM_002 with friendly message", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      ...validDrawing,
      formworkResultS3Key: null,
    });
    const res = await callGet("draw_1");
    expect(res.status).toBe(404);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_FRM_002");
    expect(j.message).toContain("not been generated yet");
  });

  it("S3 fetch throws → 502 KOS_DL_FRM_005", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockRejectedValue(new Error("S3 unreachable"));
    const res = await callGet("draw_1");
    expect(res.status).toBe(502);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_FRM_005");
  });

  it("malformed JSON → 500 KOS_DL_FRM_003", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockResolvedValue({
      buffer: Buffer.from("{not-json"),
      contentType: "application/json",
    });
    const res = await callGet("draw_1");
    expect(res.status).toBe(500);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_FRM_003");
  });

  it("renderer throws → 500 KOS_DL_FRM_004", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ formwork_id: "x" })),
      contentType: "application/json",
    });
    renderFormworkPdfMock.mockRejectedValue(new Error("jspdf blew up"));
    const res = await callGet("draw_1");
    expect(res.status).toBe(500);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_FRM_004");
  });

  it("auth throws → KosError envelope passed through", async () => {
    requireKosCustomerMock.mockRejectedValue(
      new KosError("KOS_AUTH_001", "No session.", 401),
    );
    const res = await callGet("draw_1");
    expect(res.status).toBe(401);
  });
});
