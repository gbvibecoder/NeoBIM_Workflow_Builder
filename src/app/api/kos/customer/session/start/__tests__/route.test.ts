/**
 * Tests for POST /api/kos/customer/session/start.
 *
 * PR 4b1 extended `serializeCustomer` to include `currentConversationId`.
 * This is the data path the `CustomerSessionProvider` reads on every
 * mount, so it's the load-bearing surface for PR 4b2 reload-hydration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireTenantOrThrowMock,
  getKosCustomerFromRequestMock,
  createAnonymousCustomerMock,
  buildKosCustomerSessionCookieHeaderMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireTenantOrThrowMock: vi.fn(),
  getKosCustomerFromRequestMock: vi.fn(),
  createAnonymousCustomerMock: vi.fn(),
  buildKosCustomerSessionCookieHeaderMock: vi.fn(),
  prismaMock: {
    kosAuditLog: { create: vi.fn() },
  },
}));

vi.mock("@/features/kos/lib/tenant-resolver", () => ({
  requireTenantOrThrow: requireTenantOrThrowMock,
}));
vi.mock("@/features/kos/services/kos-customer-auth", () => ({
  getKosCustomerFromRequest: getKosCustomerFromRequestMock,
  createAnonymousCustomer: createAnonymousCustomerMock,
  buildKosCustomerSessionCookieHeader: buildKosCustomerSessionCookieHeaderMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { POST } from "../route";

function makeReq(): NextRequest {
  return new NextRequest("https://kalzen.example/api/kos/customer/session/start", {
    method: "POST",
  });
}

describe("POST /api/kos/customer/session/start — PR 4b1 currentConversationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue({
      id: "tenant_1",
      slug: "kalzen",
    });
    prismaMock.kosAuditLog.create.mockResolvedValue({});
    buildKosCustomerSessionCookieHeaderMock.mockReturnValue(
      "kos_customer_session=abc; HttpOnly",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns currentConversationId on the reused-session path", async () => {
    getKosCustomerFromRequestMock.mockResolvedValue({
      id: "cust_1",
      tenantId: "tenant_1",
      displayName: "Test User",
      name: null,
      isAnonymous: true,
      createdAt: new Date("2026-05-28T00:00:00Z"),
      currentConversationId: "conv_99",
    });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.reused).toBe(true);
    expect(body.customer.currentConversationId).toBe("conv_99");
  });

  it("returns null currentConversationId for a fresh anonymous customer", async () => {
    getKosCustomerFromRequestMock.mockResolvedValue(null);
    createAnonymousCustomerMock.mockResolvedValue({
      customer: {
        id: "cust_new",
        tenantId: "tenant_1",
        displayName: "Guest-AAAA",
        name: null,
        isAnonymous: true,
        createdAt: new Date("2026-05-28T00:00:00Z"),
        currentConversationId: null,
      },
      token: "tok_xyz",
      expiresAt: new Date("2026-06-28T00:00:00Z"),
    });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.reused).toBe(false);
    expect(body.customer.currentConversationId).toBeNull();
  });

  it("preserves other customer fields (regression)", async () => {
    getKosCustomerFromRequestMock.mockResolvedValue({
      id: "cust_1",
      tenantId: "tenant_1",
      displayName: "Test User",
      name: null,
      isAnonymous: false,
      createdAt: new Date("2026-05-28T00:00:00Z"),
      currentConversationId: "conv_42",
    });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(body.customer).toEqual({
      id: "cust_1",
      tenantId: "tenant_1",
      displayName: "Test User",
      isAnonymous: false,
      createdAt: "2026-05-28T00:00:00.000Z",
      currentConversationId: "conv_42",
    });
  });
});
