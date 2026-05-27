/**
 * Tests for the 5I PR 2b chat-route attachmentRefs extension.
 *
 * Focused on:
 *   - body schema validation (accepts string array, rejects non-string)
 *   - max-5 cap enforcement
 *   - C2 boundary: cross-customer drawingId → 404
 *   - cross-tenant drawingId → 404
 *   - duplicates de-duped before count check
 *   - happy path: validated refs reach runBotTurn verbatim
 *
 * Mocks: tenant-resolver, customer-auth, prisma, runBotTurn.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireTenantOrThrowMock,
  requireKosCustomerMock,
  prismaMock,
  runBotTurnMock,
} = vi.hoisted(() => ({
  requireTenantOrThrowMock: vi.fn(),
  requireKosCustomerMock: vi.fn(),
  prismaMock: {
    kosConversation: { findFirst: vi.fn() },
    kosCustomerDrawing: { findMany: vi.fn() },
  },
  runBotTurnMock: vi.fn(),
}));

vi.mock("@/features/kos/lib/tenant-resolver", () => ({
  requireTenantOrThrow: requireTenantOrThrowMock,
}));
vi.mock("@/features/kos/services/kos-customer-auth", () => ({
  requireKosCustomer: requireKosCustomerMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/bot-orchestrator", () => ({
  runBotTurn: runBotTurnMock,
}));

import { POST } from "../route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("https://kalzen.example/api/kos/customer/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function readJson(res: Response): Promise<unknown> {
  return res.json();
}

const fakeTenant = { id: "tenant_1", name: "Kalzen", slug: "kalzen" } as never;
const fakeCustomer = {
  id: "cust_1",
  displayName: "Alice",
  name: "Alice",
} as never;

describe("POST /api/kos/customer/chat — attachmentRefs validation", () => {
  beforeEach(() => {
    requireTenantOrThrowMock.mockReset();
    requireKosCustomerMock.mockReset();
    prismaMock.kosConversation.findFirst.mockReset();
    prismaMock.kosCustomerDrawing.findMany.mockReset();
    runBotTurnMock.mockReset();

    requireTenantOrThrowMock.mockResolvedValue(fakeTenant);
    requireKosCustomerMock.mockResolvedValue(fakeCustomer);
    // Empty async generator — passes validation, opens SSE stream that
    // immediately closes; tests only check the validation outcome.
    runBotTurnMock.mockReturnValue(
      (async function* () {
        /* empty */
      })(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("body validation", () => {
    it("rejects non-array attachmentRefs with KOS_CHAT_002 400", async () => {
      const res = await POST(
        makeReq({ message: "hi", attachmentRefs: "not-an-array" }),
      );
      expect(res.status).toBe(400);
      const j = (await readJson(res)) as {
        error: { code: string; message: string };
      };
      expect(j.error.code).toBe("KOS_CHAT_002");
      expect(runBotTurnMock).not.toHaveBeenCalled();
    });

    it("rejects attachmentRefs entries that aren't strings", async () => {
      const res = await POST(
        makeReq({ message: "hi", attachmentRefs: ["draw_1", 42] }),
      );
      expect(res.status).toBe(400);
      const j = (await readJson(res)) as {
        error: { code: string };
      };
      expect(j.error.code).toBe("KOS_CHAT_002");
    });

    it("rejects more than KOS_CHAT_MAX_ATTACHMENT_REFS (5) with KOS_CHAT_DRAWING_005", async () => {
      const refs = ["d1", "d2", "d3", "d4", "d5", "d6"];
      const res = await POST(makeReq({ message: "hi", attachmentRefs: refs }));
      expect(res.status).toBe(400);
      const j = (await readJson(res)) as {
        error: { code: string };
      };
      expect(j.error.code).toBe("KOS_CHAT_DRAWING_005");
      expect(prismaMock.kosCustomerDrawing.findMany).not.toHaveBeenCalled();
    });

    it("accepts message-only body (no attachmentRefs) — pre-PR-2b behaviour preserved", async () => {
      const res = await POST(makeReq({ message: "hello" }));
      expect(res.status).toBe(200);
      expect(runBotTurnMock).toHaveBeenCalledTimes(1);
      const args = runBotTurnMock.mock.calls[0][0];
      expect(args.attachmentRefs).toBeUndefined();
    });
  });

  describe("C2 threats — cross-customer / cross-tenant", () => {
    it("THREAT: drawingId belongs to a different customer → KOS_CHAT_DRAWING_004 404", async () => {
      // findMany returns empty (the WHERE clause filtered out the drawing
      // because its customerId/tenantId don't match the current request)
      prismaMock.kosCustomerDrawing.findMany.mockResolvedValueOnce([]);

      const res = await POST(
        makeReq({ message: "look", attachmentRefs: ["draw_belongs_to_B"] }),
      );
      expect(res.status).toBe(404);
      const j = (await readJson(res)) as {
        error: { code: string; message: string };
      };
      expect(j.error.code).toBe("KOS_CHAT_DRAWING_004");
      expect(j.error.message).toContain("not found");
      expect(runBotTurnMock).not.toHaveBeenCalled();
    });

    it("THREAT: one good + one cross-customer drawingId → 404 (partial mismatch blocks the whole turn)", async () => {
      prismaMock.kosCustomerDrawing.findMany.mockResolvedValueOnce([
        { id: "draw_good" },
      ]);

      const res = await POST(
        makeReq({
          message: "look",
          attachmentRefs: ["draw_good", "draw_cross_customer"],
        }),
      );
      expect(res.status).toBe(404);
      const j = (await readJson(res)) as {
        error: { code: string };
      };
      expect(j.error.code).toBe("KOS_CHAT_DRAWING_004");
    });

    it("THREAT: cross-tenant drawingId (different tenant) → 404 (same as cross-customer)", async () => {
      // findMany scopes by (tenantId, customerId); cross-tenant rows are
      // invisible — empty result triggers the same 404.
      prismaMock.kosCustomerDrawing.findMany.mockResolvedValueOnce([]);

      const res = await POST(
        makeReq({ message: "look", attachmentRefs: ["draw_tenant_X"] }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("happy path", () => {
    it("valid refs → runBotTurn called with attachmentRefs (de-duped)", async () => {
      // Duplicate entries; findMany returns 1 row → should NOT be a mismatch
      // because the route de-dupes before the count check.
      prismaMock.kosCustomerDrawing.findMany.mockResolvedValueOnce([
        { id: "draw_1" },
      ]);

      const res = await POST(
        makeReq({ message: "process this", attachmentRefs: ["draw_1", "draw_1"] }),
      );
      expect(res.status).toBe(200);

      expect(runBotTurnMock).toHaveBeenCalledTimes(1);
      const args = runBotTurnMock.mock.calls[0][0];
      expect(args.attachmentRefs).toEqual(["draw_1"]);
      expect(args.tenantId).toBe("tenant_1");
      expect(args.customerId).toBe("cust_1");
    });

    it("multiple distinct refs → all forwarded; findMany WHERE includes tenant + customer", async () => {
      prismaMock.kosCustomerDrawing.findMany.mockResolvedValueOnce([
        { id: "draw_1" },
        { id: "draw_2" },
      ]);

      const res = await POST(
        makeReq({
          message: "process these",
          attachmentRefs: ["draw_1", "draw_2"],
        }),
      );
      expect(res.status).toBe(200);

      const findManyCall = prismaMock.kosCustomerDrawing.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({
        id: { in: ["draw_1", "draw_2"] },
        tenantId: "tenant_1",
        customerId: "cust_1",
      });
    });
  });
});
