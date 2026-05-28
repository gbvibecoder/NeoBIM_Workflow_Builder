/**
 * Tests for GET /api/kos/customer/conversations/[id]/messages — the
 * 5I PR 4b2 reload-hydration endpoint.
 *
 * Coverage:
 *   - happy path (customer + bot rows mapped correctly)
 *   - C2 boundary (cross-customer + cross-tenant + truly-not-found all 404
 *     with the same envelope)
 *   - filtering (BD_HUMAN and SYSTEM rows excluded)
 *   - attachmentRefs pass-through + defensive parsing
 *   - timestamp conversion (Date → epoch ms)
 *   - empty conversation (200 with empty array, NOT 404)
 *   - DB failure surfaces as KOS_CONV_MSG_002
 *   - Cache-Control header
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireTenantOrThrowMock,
  requireKosCustomerMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireTenantOrThrowMock: vi.fn(),
  requireKosCustomerMock: vi.fn(),
  prismaMock: {
    kosConversation: { findFirst: vi.fn() },
    kosMessage: { findMany: vi.fn() },
  },
}));

vi.mock("@/features/kos/lib/tenant-resolver", () => ({
  requireTenantOrThrow: requireTenantOrThrowMock,
}));
vi.mock("@/features/kos/services/kos-customer-auth", () => ({
  requireKosCustomer: requireKosCustomerMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { GET } from "../route";

const fakeTenant = { id: "tenant_1" } as never;
const fakeCustomer = { id: "cust_1" } as never;

function makeReq(): NextRequest {
  return new NextRequest(
    "https://kalzen.example/api/kos/customer/conversations/conv_1/messages",
    { method: "GET" },
  );
}
async function callGet(id: string): Promise<Response> {
  return GET(makeReq(), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
  requireKosCustomerMock.mockResolvedValue(fakeCustomer);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET conversation messages — happy path", () => {
  it("maps customer + bot rows in chronological order with attachmentRefs + citations", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([
      {
        id: "msg_a",
        conversationId: "conv_1",
        authorType: "CUSTOMER",
        content: "process my drawing",
        createdAt: new Date("2026-05-28T10:00:00Z"),
        attachmentRefs: ["cdraw_alpha", "cdraw_beta"],
        citations: null,
      },
      {
        id: "msg_b",
        conversationId: "conv_1",
        authorType: "BOT",
        content: "Working on it.",
        createdAt: new Date("2026-05-28T10:00:05Z"),
        attachmentRefs: null,
        citations: [{ documentId: "d1", chunkId: "c1", pageNum: 3, snippet: "...", title: "Doc" }],
      },
    ]);

    const res = await callGet("conv_1");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.conversationId).toBe("conv_1");
    expect(body.truncated).toBe(false);
    expect(body.messages).toHaveLength(2);

    // Customer row
    expect(body.messages[0]).toEqual({
      id: "msg_a",
      role: "customer",
      content: "process my drawing",
      timestamp: new Date("2026-05-28T10:00:00Z").getTime(),
      attachmentRefs: ["cdraw_alpha", "cdraw_beta"],
    });
    // Bot row
    expect(body.messages[1]).toMatchObject({
      id: "msg_b",
      role: "bot",
      content: "Working on it.",
      timestamp: new Date("2026-05-28T10:00:05Z").getTime(),
    });
    expect(body.messages[1].citations).toHaveLength(1);
    expect(body.messages[1].attachmentRefs).toBeUndefined();
  });

  it("returns 200 with empty array for a brand-new empty conversation (NOT 404)", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([]);

    const res = await callGet("conv_1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      conversationId: "conv_1",
      messages: [],
      truncated: false,
    });
  });

  it("sets Cache-Control: no-store on the response", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([]);

    const res = await callGet("conv_1");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("GET conversation messages — C2 boundary (info-leak proof)", () => {
  it("returns 404 KOS_CONV_MSG_001 when conversation belongs to a different customer", async () => {
    // findFirst returns null when {id, tenantId, customerId} don't all match
    prismaMock.kosConversation.findFirst.mockResolvedValue(null);

    const res = await callGet("conv_belonging_to_alice");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error_code: "KOS_CONV_MSG_001",
      message: "Conversation not found.",
    });
  });

  it("returns 404 KOS_CONV_MSG_001 for cross-tenant conversation", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue(null);

    const res = await callGet("conv_from_other_tenant");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe("KOS_CONV_MSG_001");
  });

  it("returns 404 KOS_CONV_MSG_001 for truly-not-found conversation", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue(null);

    const res = await callGet("conv_doesnt_exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe("KOS_CONV_MSG_001");
  });

  it("the 404 envelope is byte-identical across all three not-found cases (no probing)", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue(null);

    const responses = await Promise.all([
      callGet("conv_cross_customer").then((r) => r.json()),
      callGet("conv_cross_tenant").then((r) => r.json()),
      callGet("conv_does_not_exist").then((r) => r.json()),
    ]);
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[1]).toEqual(responses[2]);
  });
});

describe("GET conversation messages — authorType filtering", () => {
  it("drops BD_HUMAN rows from the response", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([
      { id: "msg_a", authorType: "CUSTOMER", content: "hi", createdAt: new Date("2026-05-28T10:00:00Z"), attachmentRefs: null, citations: null },
      { id: "msg_b", authorType: "BD_HUMAN", content: "Let me check that for you", createdAt: new Date("2026-05-28T10:00:30Z"), attachmentRefs: null, citations: null },
      { id: "msg_c", authorType: "BOT", content: "Sure", createdAt: new Date("2026-05-28T10:01:00Z"), attachmentRefs: null, citations: null },
    ]);

    const res = await callGet("conv_1");
    const body = await res.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["msg_a", "msg_c"]);
  });

  it("drops SYSTEM rows from the response", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([
      { id: "msg_sys", authorType: "SYSTEM", content: "Conversation escalated", createdAt: new Date("2026-05-28T10:00:00Z"), attachmentRefs: null, citations: null },
      { id: "msg_c", authorType: "CUSTOMER", content: "hi", createdAt: new Date("2026-05-28T10:00:10Z"), attachmentRefs: null, citations: null },
    ]);

    const res = await callGet("conv_1");
    const body = await res.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["msg_c"]);
  });
});

describe("GET conversation messages — defensive attachmentRefs parsing", () => {
  it("omits attachmentRefs when DB has null", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([
      { id: "msg_a", authorType: "CUSTOMER", content: "hi", createdAt: new Date(0), attachmentRefs: null, citations: null },
    ]);

    const res = await callGet("conv_1");
    const body = await res.json();
    expect(body.messages[0]).not.toHaveProperty("attachmentRefs");
  });

  it("omits attachmentRefs when DB has a non-array (e.g. accidental object)", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([
      { id: "msg_a", authorType: "CUSTOMER", content: "hi", createdAt: new Date(0), attachmentRefs: { not: "an array" }, citations: null },
    ]);

    const res = await callGet("conv_1");
    const body = await res.json();
    expect(body.messages[0]).not.toHaveProperty("attachmentRefs");
  });

  it("filters non-string and empty entries out of the array", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([
      { id: "msg_a", authorType: "CUSTOMER", content: "hi", createdAt: new Date(0), attachmentRefs: ["cdraw_x", "", null, 42, "cdraw_y"], citations: null },
    ]);

    const res = await callGet("conv_1");
    const body = await res.json();
    expect(body.messages[0].attachmentRefs).toEqual(["cdraw_x", "cdraw_y"]);
  });
});

describe("GET conversation messages — DB failure surfaces specifically", () => {
  it("kosMessage.findMany throws → 500 KOS_CONV_MSG_002 with the underlying message", async () => {
    prismaMock.kosConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    prismaMock.kosMessage.findMany.mockRejectedValueOnce(
      new Error("connection terminated"),
    );

    const res = await callGet("conv_1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe("KOS_CONV_MSG_002");
    expect(body.message).toContain("connection terminated");
  });

  it("an unexpected non-KosError thrown → 500 KOS_CONV_MSG_000 (generic fallback)", async () => {
    requireTenantOrThrowMock.mockRejectedValueOnce(new Error("upstream auth bug"));

    const res = await callGet("conv_1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe("KOS_CONV_MSG_000");
  });
});
