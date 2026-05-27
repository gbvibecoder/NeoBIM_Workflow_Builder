/**
 * Tests for POST /api/kos/customer/drawings/[id]/confirm-upload
 *
 * Includes the C2 cross-customer-ownership threat test (drawing
 * owned by customer A must return 404 — NOT 200, NOT 403 — when
 * customer B's cookie hits the route).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { POST } from "../confirm-upload/route";

// ─── Module mocks ──────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    kosCustomerDrawing: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    kosAuditLog: { create: vi.fn() },
  },
}));

vi.mock("@/features/kos/lib/tenant-resolver", () => ({
  requireTenantOrThrow: vi.fn(),
}));

vi.mock("@/features/kos/services/kos-customer-auth", () => ({
  requireKosCustomer: vi.fn(),
}));

vi.mock("@/features/kos/services/s3-client", () => ({
  headKosObject: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { headKosObject } from "@/features/kos/services/s3-client";

// ─── Helpers ────────────────────────────────────────────────────

function buildReq(): Request {
  return new Request("http://x/api/kos/customer/drawings/draw_1/confirm-upload", {
    method: "POST",
  });
}

function buildCtx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const TENANT = { id: "tenant_1", slug: "kalzen", name: "Kalzen" } as unknown as Awaited<
  ReturnType<typeof requireTenantOrThrow>
>;

const CUSTOMER_A = { id: "cust_A", tenantId: "tenant_1" } as unknown as Awaited<
  ReturnType<typeof requireKosCustomer>
>;
const CUSTOMER_B = { id: "cust_B", tenantId: "tenant_1" } as unknown as Awaited<
  ReturnType<typeof requireKosCustomer>
>;

const DRAWING_AWAITING = {
  id: "draw_1",
  tenantId: "tenant_1",
  customerId: "cust_A",
  conversationId: null,
  filename: "villa.dxf",
  originalFilename: "villa.dxf",
  sourceFormat: "dxf",
  sizeBytes: 1000,
  actualSizeBytes: null,
  s3Key: "drawings/tenant_1/cust_A/draw_1/source.dxf",
  status: "AWAITING_UPLOAD" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireTenantOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(TENANT);
  (requireKosCustomer as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER_A);
  (prisma.kosAuditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

// ─── Cases ─────────────────────────────────────────────────────

describe("POST /api/kos/customer/drawings/[id]/confirm-upload", () => {
  describe("Defect C2 threat — cross-customer ownership", () => {
    it("returns 404 (NOT 200, NOT 403) when drawing belongs to a different customer", async () => {
      // Customer B has a valid session. They guess drawing id "draw_1"
      // (which actually belongs to customer A). The findFirst query
      // scopes by customerId, so it returns null — and the route
      // returns 404 to avoid leaking existence.
      (requireKosCustomer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(CUSTOMER_B);
      (
        prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(null);

      const res = await POST(buildReq() as never, buildCtx("draw_1"));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe("KOS_DRAW_CFM_001");

      // S3 must NOT have been hit — we should fail closed before any
      // side effect that could confirm existence.
      expect(headKosObject).not.toHaveBeenCalled();
      expect(prisma.kosCustomerDrawing.updateMany).not.toHaveBeenCalled();
    });
  });

  it("returns 404 when drawing simply does not exist", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);
    const res = await POST(buildReq() as never, buildCtx("draw_missing"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when drawing is in FAILED state", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ ...DRAWING_AWAITING, status: "FAILED" });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_CFM_006");
  });

  it("idempotent on already-UPLOADED — returns 200 + does NOT call S3", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...DRAWING_AWAITING,
      status: "UPLOADED",
      actualSizeBytes: 950,
    });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drawing.status).toBe("UPLOADED");
    expect(body.drawing.sizeBytes).toBe(950);
    expect(body.attachmentRef).toEqual({ drawingId: "draw_1", kind: "drawing" });
    expect(headKosObject).not.toHaveBeenCalled();
    expect(prisma.kosCustomerDrawing.updateMany).not.toHaveBeenCalled();
  });

  it("idempotent on PARSING — returns 200 with the live state", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...DRAWING_AWAITING,
      status: "PARSING",
      actualSizeBytes: 970,
    });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drawing.status).toBe("PARSING");
  });

  it("returns 422 when headKosObject returns { exists: false }", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(DRAWING_AWAITING);
    (headKosObject as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: false,
    });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_CFM_003");
  });

  it("returns 422 when headKosObject returns exists:true but contentLength is undefined", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(DRAWING_AWAITING);
    (headKosObject as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      contentLength: undefined,
    });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_CFM_003");
  });

  it("returns 422 when actualSize > 1.1× claimed size (tolerance breach)", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(DRAWING_AWAITING);
    // claimed 1000; tolerance 1100; head reports 1200
    (headKosObject as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      contentLength: 1200,
    });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_CFM_004");
  });

  it("returns 422 when actualSize is 0", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(DRAWING_AWAITING);
    (headKosObject as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      contentLength: 0,
    });
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_CFM_004");
  });

  it("returns 500 when headKosObject throws", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(DRAWING_AWAITING);
    (headKosObject as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("S3 network down"),
    );
    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_CFM_005");
  });

  it("happy path: 200, atomic update, audit row written, response shape correct", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(DRAWING_AWAITING);
    (headKosObject as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      contentLength: 950,
    });
    (
      prisma.kosCustomerDrawing.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ count: 1 });

    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drawing).toEqual({
      id: "draw_1",
      filename: "villa.dxf",
      sizeBytes: 950,
      sourceFormat: "dxf",
      status: "UPLOADED",
    });
    expect(body.attachmentRef).toEqual({
      drawingId: "draw_1",
      kind: "drawing",
    });
    expect(prisma.kosCustomerDrawing.updateMany).toHaveBeenCalledWith({
      where: { id: "draw_1", status: "AWAITING_UPLOAD" },
      data: { status: "UPLOADED", actualSizeBytes: 950 },
    });
    expect(prisma.kosAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CUSTOMER_DRAWING_UPLOADED",
          actorId: "cust_A",
        }),
      }),
    );
  });

  it("atomic update race: updateMany returns count:0 → re-reads and returns existing state", async () => {
    (
      prisma.kosCustomerDrawing.findFirst as ReturnType<typeof vi.fn>
    )
      .mockResolvedValueOnce(DRAWING_AWAITING)
      .mockResolvedValueOnce({
        ...DRAWING_AWAITING,
        status: "UPLOADED",
        actualSizeBytes: 950,
      });
    (headKosObject as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: true,
      contentLength: 950,
    });
    (
      prisma.kosCustomerDrawing.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ count: 0 });

    const res = await POST(buildReq() as never, buildCtx("draw_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drawing.status).toBe("UPLOADED");
    expect(body.drawing.sizeBytes).toBe(950);
  });
});
