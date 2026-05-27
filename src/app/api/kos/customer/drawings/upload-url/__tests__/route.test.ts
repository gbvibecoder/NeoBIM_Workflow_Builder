/**
 * Tests for POST /api/kos/customer/drawings/upload-url
 *
 * Mocks every external boundary (prisma, auth helpers, s3-client,
 * rate-limit) so this is a pure handler unit test — no DB, no AWS,
 * no Redis touched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { POST, GET } from "../route";

// ─── Module mocks ──────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    kosConversation: { findFirst: vi.fn() },
    kosCustomerDrawing: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
  createKosPresignedUploadUrl: vi.fn(),
  kosS3Key: (
    _tenant: unknown,
    kind: string,
    ...segments: string[]
  ) => [kind, "tenant_1", ...segments].join("/"),
}));

vi.mock("@/features/kos/lib/customer-rate-limit", () => ({
  checkUploadRateLimit: vi.fn(),
  resolveClientIp: vi.fn().mockReturnValue("1.2.3.4"),
}));

// ─── Imports of the mocked modules so we can assert on them ─────

import { prisma } from "@/lib/db";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { createKosPresignedUploadUrl } from "@/features/kos/services/s3-client";
import { checkUploadRateLimit } from "@/features/kos/lib/customer-rate-limit";
import { KosError } from "@/features/kos/lib/kos-errors";

// ─── Helpers ────────────────────────────────────────────────────

function buildReq(body: unknown): Request {
  return new Request("http://x/api/kos/customer/drawings/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TENANT = {
  id: "tenant_1",
  slug: "kalzen",
  name: "Kalzen",
  s3Config: {
    bucket: "kalzen-test",
    region: "ap-south-1",
    accessKeyRef: "X",
    secretKeyRef: "Y",
  },
} as unknown as Awaited<ReturnType<typeof requireTenantOrThrow>>;

const CUSTOMER = {
  id: "cust_1",
  tenantId: "tenant_1",
  phone: "anon:abc",
  displayName: "Guest-AB12",
  isAnonymous: true,
} as unknown as Awaited<ReturnType<typeof requireKosCustomer>>;

const VALID_BODY = {
  filename: "villa.dxf",
  originalFilename: "villa.dxf",
  contentType: "application/dxf",
  sizeBytes: 1024,
  sourceFormat: "dxf",
  conversationId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireTenantOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(TENANT);
  (requireKosCustomer as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
  (checkUploadRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  (
    prisma.kosCustomerDrawing.create as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    id: "draw_1",
    tenantId: "tenant_1",
    customerId: "cust_1",
  });
  (
    prisma.kosCustomerDrawing.update as ReturnType<typeof vi.fn>
  ).mockResolvedValue({});
  (prisma.kosAuditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (createKosPresignedUploadUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
    uploadUrl: "https://s3.example/signed",
    key: "drawings/tenant_1/cust_1/draw_1/source.dxf",
    publicGetHint: "s3://kalzen-test/...",
  });
});

// ─── Cases ─────────────────────────────────────────────────────

describe("POST /api/kos/customer/drawings/upload-url", () => {
  it("returns 401 when no customer cookie (requireKosCustomer throws)", async () => {
    (requireKosCustomer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new KosError("KOS_CHAT_001", "Customer session required", 401),
    );
    const res = await POST(buildReq(VALID_BODY) as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("KOS_CHAT_001");
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://x/y", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{this is not valid json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_002");
  });

  it("returns 400 on Zod validation failure (missing sourceFormat)", async () => {
    const bad = { ...VALID_BODY };
    // @ts-expect-error intentional bad input
    delete bad.sourceFormat;
    const res = await POST(buildReq(bad) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_003");
  });

  it("returns 400 on unknown sourceFormat (Zod enum)", async () => {
    const res = await POST(
      buildReq({ ...VALID_BODY, sourceFormat: "exe" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_003");
  });

  it("returns 400 on negative sizeBytes", async () => {
    const res = await POST(
      buildReq({ ...VALID_BODY, sizeBytes: -1 }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on oversize sizeBytes (Zod caps before route check)", async () => {
    const res = await POST(
      buildReq({ ...VALID_BODY, sizeBytes: 20 * 1024 * 1024 }) as never,
    );
    // Zod's .max(MAX_BYTES) catches this before our explicit 413 check,
    // so the response is 400 KOS_DRAW_UP_003 here. Documented behaviour.
    expect([400, 413]).toContain(res.status);
  });

  it("returns 415 on contentType not matching sourceFormat", async () => {
    const res = await POST(
      buildReq({
        ...VALID_BODY,
        sourceFormat: "pdf",
        contentType: "image/png",
      }) as never,
    );
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_005");
  });

  it("returns 403 on conversationId not owned", async () => {
    (
      prisma.kosConversation.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);
    const res = await POST(
      buildReq({ ...VALID_BODY, conversationId: "convo_X" }) as never,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_007");
  });

  it("returns 429 when rate-limit denies", async () => {
    (checkUploadRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      dimension: "customer",
      remaining: 0,
      resetAt: 999,
    });
    const res = await POST(buildReq(VALID_BODY) as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_006");
    expect(body.message).toContain("customer");
  });

  it("returns 200 happy path with drawingId/uploadUrl/s3Key/expiresAt and persists row", async () => {
    const res = await POST(buildReq(VALID_BODY) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drawingId).toBe("draw_1");
    expect(body.uploadUrl).toBe("https://s3.example/signed");
    expect(body.s3Key).toBe("drawings/tenant_1/cust_1/draw_1/source.dxf");
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(prisma.kosCustomerDrawing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant_1",
          customerId: "cust_1",
          status: "AWAITING_UPLOAD",
          filename: "villa.dxf",
          originalFilename: "villa.dxf",
          sourceFormat: "dxf",
          sizeBytes: 1024,
          s3Key: "PENDING",
        }),
      }),
    );
    expect(prisma.kosCustomerDrawing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "draw_1" },
        data: { s3Key: "drawings/tenant_1/cust_1/draw_1/source.dxf" },
      }),
    );
    expect(prisma.kosAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CUSTOMER_DRAWING_UPLOAD_REQUESTED",
          actorType: "CUSTOMER",
          actorId: "cust_1",
        }),
      }),
    );
  });

  it("sanitizes a hostile filename server-side", async () => {
    const res = await POST(
      buildReq({
        ...VALID_BODY,
        filename: `'><script>.dxf`,
      }) as never,
    );
    expect(res.status).toBe(200);
    const createCall = (
      prisma.kosCustomerDrawing.create as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(createCall.data.filename).not.toContain("<");
    expect(createCall.data.filename).not.toContain(">");
    expect(createCall.data.filename).not.toContain("'");
    expect(createCall.data.filename.endsWith(".dxf")).toBe(true);
  });

  it("rolls back the drawing row when presign fails", async () => {
    (
      createKosPresignedUploadUrl as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("presign blew up"));
    (
      prisma.kosCustomerDrawing.delete as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({});

    const res = await POST(buildReq(VALID_BODY) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_009");
    expect(prisma.kosCustomerDrawing.delete).toHaveBeenCalledWith({
      where: { id: "draw_1" },
    });
  });

  it("GET returns 405 with KOS_DRAW_UP_405", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.code).toBe("KOS_DRAW_UP_405");
    expect(res.headers.get("allow")).toBe("POST");
  });
});
