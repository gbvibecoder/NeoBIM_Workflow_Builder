/**
 * Tests for GET /api/kos/customer/drawings/[id]/boq/download
 *
 * Mocks: tenant-resolver, customer-auth, prisma, fetchKosObjectAsBuffer,
 * renderBoqExcel. Covers happy path, all 5 error codes, C2 + cross-tenant
 * threats, and response-header correctness.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireTenantOrThrowMock,
  requireKosCustomerMock,
  prismaMock,
  fetchKosObjectAsBufferMock,
  renderBoqExcelMock,
} = vi.hoisted(() => ({
  requireTenantOrThrowMock: vi.fn(),
  requireKosCustomerMock: vi.fn(),
  prismaMock: {
    kosCustomerDrawing: { findFirst: vi.fn() },
  },
  fetchKosObjectAsBufferMock: vi.fn(),
  renderBoqExcelMock: vi.fn(),
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
vi.mock("@/features/kos/services/renderers/boq-xlsx-renderer", () => ({
  renderBoqExcel: renderBoqExcelMock,
}));

import { GET } from "../download/route";
import { KosError } from "@/features/kos/lib/kos-errors";

const fakeTenant = { id: "tenant_1" } as never;
const fakeCustomer = { id: "cust_1" } as never;

function makeReq(): NextRequest {
  return new NextRequest("https://kalzen.example/api/kos/customer/drawings/draw_1/boq/download", {
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
  boqResultS3Key: "drawings/tenant_1/draw_1/boq.json",
  parseResult: null,
};

describe("GET BOQ download — auth + happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ boq_id: "boq_x" })),
      contentType: "application/json",
    });
    renderBoqExcelMock.mockResolvedValue(Buffer.from("XLSX_BYTES"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: 200 + Excel content-type + content-disposition + buffer", async () => {
    const res = await callGet("draw_1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("filename=");
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''");
    expect(res.headers.get("Content-Length")).toBe(String("XLSX_BYTES".length));
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const ab = await res.arrayBuffer();
    expect(Buffer.from(ab).toString("utf-8")).toBe("XLSX_BYTES");
  });

  it("filename in Content-Disposition is BOQ_<sanitized>.xlsx", async () => {
    const res = await callGet("draw_1");
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toContain("BOQ_Plan.xlsx");
  });
});

describe("GET BOQ download — C2 / cross-tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  it("THREAT: drawing not owned by current customer → 404 KOS_DL_BOQ_001 (same envelope as not-found)", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(null);
    const res = await callGet("draw_someone_elses");
    expect(res.status).toBe(404);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_001");
    expect(j.message).toContain("not found");
  });

  it("THREAT: drawing in different tenant → 404 same envelope (no leak via differentiated code)", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(null);
    const res = await callGet("draw_other_tenant");
    expect(res.status).toBe(404);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_001");
  });
});

describe("GET BOQ download — error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
  });

  it("boqResultS3Key null → 404 KOS_DL_BOQ_002 with friendly message", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue({
      ...validDrawing,
      boqResultS3Key: null,
    });
    const res = await callGet("draw_1");
    expect(res.status).toBe(404);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_002");
    expect(j.message).toContain("not been generated yet");
  });

  it("S3 fetch throws → 502 KOS_DL_BOQ_005", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockRejectedValue(new Error("S3 unreachable"));
    const res = await callGet("draw_1");
    expect(res.status).toBe(502);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_005");
  });

  it("malformed JSON in S3 → 500 KOS_DL_BOQ_003", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockResolvedValue({
      buffer: Buffer.from("{not-json"),
      contentType: "application/json",
    });
    const res = await callGet("draw_1");
    expect(res.status).toBe(500);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_003");
  });

  it("renderer throws → 500 KOS_DL_BOQ_004", async () => {
    prismaMock.kosCustomerDrawing.findFirst.mockResolvedValue(validDrawing);
    fetchKosObjectAsBufferMock.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ boq_id: "boq_x" })),
      contentType: "application/json",
    });
    renderBoqExcelMock.mockRejectedValue(new Error("xlsx blew up"));
    const res = await callGet("draw_1");
    expect(res.status).toBe(500);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_004");
  });

  it("auth throws (no session cookie) → KosError envelope passed through", async () => {
    requireKosCustomerMock.mockRejectedValue(
      new KosError("KOS_AUTH_001", "No session.", 401),
    );
    const res = await callGet("draw_1");
    expect(res.status).toBe(401);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_AUTH_001");
  });

  it("unhandled non-KosError → 500 KOS_DL_BOQ_000", async () => {
    // Tenant resolver throws something that's not a KosError
    requireTenantOrThrowMock.mockRejectedValue(new TypeError("boom"));
    const res = await callGet("draw_1");
    expect(res.status).toBe(500);
    const j = await readJson(res);
    expect(j.error_code).toBe("KOS_DL_BOQ_000");
  });
});
