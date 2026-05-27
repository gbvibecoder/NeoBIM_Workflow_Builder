/**
 * Tests for GET /api/kos/customer/me — customer identity endpoint.
 *
 * PR 4b1 added `currentConversationId` to the response so the chat UI
 * can find the right conversation on reload. These tests cover the new
 * field plus the existing fields (regression).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireTenantOrThrowMock, requireKosCustomerMock } = vi.hoisted(
  () => ({
    requireTenantOrThrowMock: vi.fn(),
    requireKosCustomerMock: vi.fn(),
  }),
);

vi.mock("@/features/kos/lib/tenant-resolver", () => ({
  requireTenantOrThrow: requireTenantOrThrowMock,
}));
vi.mock("@/features/kos/services/kos-customer-auth", () => ({
  requireKosCustomer: requireKosCustomerMock,
}));

import { GET } from "../route";

function makeReq(): NextRequest {
  return new NextRequest("https://kalzen.example/api/kos/customer/me", {
    method: "GET",
  });
}

describe("GET /api/kos/customer/me — PR 4b1 currentConversationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantOrThrowMock.mockResolvedValue({
      id: "tenant_1",
      slug: "kalzen",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns currentConversationId on the response when set", async () => {
    requireKosCustomerMock.mockResolvedValue({
      id: "cust_1",
      displayName: "Test User",
      name: null,
      isAnonymous: true,
      currentConversationId: "conv_42",
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: "cust_1",
      displayName: "Test User",
      isAnonymous: true,
      tenantSlug: "kalzen",
      currentConversationId: "conv_42",
    });
  });

  it("returns null currentConversationId for a customer who has never sent a message", async () => {
    requireKosCustomerMock.mockResolvedValue({
      id: "cust_2",
      displayName: null,
      name: null,
      isAnonymous: true,
      currentConversationId: null,
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.currentConversationId).toBeNull();
  });

  it("coerces undefined currentConversationId to null (defensive)", async () => {
    // Older row read before the migration could theoretically come back
    // without the field at all if the type widens. Verify the route
    // returns null rather than `undefined` (which would drop from JSON).
    requireKosCustomerMock.mockResolvedValue({
      id: "cust_3",
      displayName: null,
      name: null,
      isAnonymous: true,
      // currentConversationId intentionally absent
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveProperty("currentConversationId", null);
  });

  it("falls back to customer.name when displayName is null (regression)", async () => {
    requireKosCustomerMock.mockResolvedValue({
      id: "cust_4",
      displayName: null,
      name: "Contact Name",
      isAnonymous: false,
      currentConversationId: null,
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.displayName).toBe("Contact Name");
  });
});
