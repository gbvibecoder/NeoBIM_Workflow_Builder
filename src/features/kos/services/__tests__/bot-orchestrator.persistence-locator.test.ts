/**
 * 5I PR 4b1 — Persistence + Locator regression tests.
 *
 * Verifies the two write sites added by PR 4b1:
 *   1. `persistCustomerMessage` writes `attachmentRefs` to KosMessage
 *      when the customer attached drawings this turn; omits the field
 *      (Prisma → SQL NULL) when no attachments were sent.
 *   2. `runBotTurn` updates `KosCustomer.currentConversationId` after
 *      the customer message is persisted — best-effort: a failed
 *      update is logged but does NOT abort the turn.
 *
 * Approach mirrors PR 3's `bot-orchestrator.sse-events.test.ts`:
 * hoisted prismaMock + a minimal anthropic streaming mock so a single
 * turn runs end-to-end without any real LLM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, anthropicMock } = vi.hoisted(() => ({
  prismaMock: {
    kosConversation: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    kosMessage: { create: vi.fn(), findMany: vi.fn() },
    kosCustomer: { findUnique: vi.fn(), update: vi.fn() },
    kosAuditLog: { create: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
  anthropicMock: { messages: { stream: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/anthropic-client", () => ({
  getKosAnthropicClient: () => anthropicMock,
}));
vi.mock("@/features/kos/services/rag-retriever", () => ({
  retrieveChunks: vi.fn(),
}));
vi.mock("@/features/kos/services/bot-tools/tool-process-drawing", () => ({
  processDrawingTool: vi.fn(),
}));
vi.mock("@/features/kos/services/bot-tools/tool-generate-boq", () => ({
  generateBoqTool: vi.fn(),
}));
vi.mock("@/features/kos/services/bot-tools/tool-generate-formwork", () => ({
  generateFormworkTool: vi.fn(),
}));
vi.mock("@/features/kos/services/bot-tools/tool-generate-shop-drawing", () => ({
  generateShopDrawingTool: vi.fn(),
}));

import { runBotTurn, type BotEvent } from "../bot-orchestrator";

// ── Minimal end_turn stream — no tool uses, no text. The turn just
//    persists the customer message + an empty bot reply and finishes.
function makeEmptyEndTurnStream() {
  async function* gen() {
    yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
  }
  const stream = gen();
  (stream as unknown as { finalMessage: () => Promise<unknown> }).finalMessage =
    async () => ({ content: [], stop_reason: "end_turn" });
  return stream;
}

async function collect(
  input: Parameters<typeof runBotTurn>[0],
): Promise<BotEvent[]> {
  const out: BotEvent[] = [];
  for await (const ev of runBotTurn(input)) out.push(ev);
  return out;
}

const baseInput = {
  tenantId: "tenant_1",
  tenantName: "Kalzen",
  conversationId: null,
  customerId: "cust_1",
  customerMessage: "hi",
  customerDisplayName: "Test User",
};

describe("bot-orchestrator persistence + locator — PR 4b1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    anthropicMock.messages.stream.mockImplementation(() =>
      makeEmptyEndTurnStream(),
    );
    prismaMock.kosConversation.create.mockResolvedValue({
      id: "conv_1",
      tenantId: "tenant_1",
      customerId: "cust_1",
      status: "BOT_ACTIVE",
    });
    prismaMock.kosConversation.update.mockResolvedValue({});
    prismaMock.kosMessage.create.mockResolvedValue({ id: "msg_1" });
    prismaMock.kosMessage.findMany.mockResolvedValue([]);
    prismaMock.kosAuditLog.create.mockResolvedValue({});
    prismaMock.kosCustomer.update.mockResolvedValue({});
    prismaMock.tenant.findUnique.mockResolvedValue({ id: "tenant_1" });
    prismaMock.kosCustomer.findUnique.mockResolvedValue({ id: "cust_1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── attachmentRefs persistence ────────────────────────────────────

  it("persists attachmentRefs as a JSON array when the customer attached drawings", async () => {
    await collect({
      ...baseInput,
      attachmentRefs: ["cdraw_alpha", "cdraw_beta"],
    });

    // The FIRST kosMessage.create call is the customer message
    // (persistCustomerMessage runs before any bot message create).
    const calls = prismaMock.kosMessage.create.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const customerCreate = calls[0][0];
    expect(customerCreate.data.authorType).toBe("CUSTOMER");
    expect(customerCreate.data.attachmentRefs).toEqual([
      "cdraw_alpha",
      "cdraw_beta",
    ]);
  });

  it("omits attachmentRefs (Prisma → SQL NULL) when no attachments were sent", async () => {
    await collect({ ...baseInput, attachmentRefs: [] });

    const customerCreate = prismaMock.kosMessage.create.mock.calls[0][0];
    expect(customerCreate.data.authorType).toBe("CUSTOMER");
    expect(customerCreate.data).not.toHaveProperty("attachmentRefs");
  });

  it("omits attachmentRefs when input.attachmentRefs is undefined", async () => {
    await collect(baseInput); // no attachmentRefs key at all

    const customerCreate = prismaMock.kosMessage.create.mock.calls[0][0];
    expect(customerCreate.data).not.toHaveProperty("attachmentRefs");
  });

  it("filters out empty/non-string refs before persisting", async () => {
    await collect({
      ...baseInput,
      attachmentRefs: [
        "cdraw_real",
        "",
        // @ts-expect-error — runtime defence; verify the filter rejects this
        null,
        // @ts-expect-error
        123,
        "cdraw_other",
      ],
    });

    const customerCreate = prismaMock.kosMessage.create.mock.calls[0][0];
    expect(customerCreate.data.attachmentRefs).toEqual([
      "cdraw_real",
      "cdraw_other",
    ]);
  });

  it("preserves the original content (no attachment hint injected into the persisted row)", async () => {
    await collect({
      ...baseInput,
      customerMessage: "process my drawing",
      attachmentRefs: ["cdraw_alpha"],
    });

    const customerCreate = prismaMock.kosMessage.create.mock.calls[0][0];
    // The in-memory message sent to the LLM gets a "[The customer
    // attached ...]" hint appended (PR 2b behavior); the DB row must
    // hold ONLY the original customer text.
    expect(customerCreate.data.content).toBe("process my drawing");
  });

  // ── currentConversationId locator update ─────────────────────────

  it("updates KosCustomer.currentConversationId after persisting the customer message", async () => {
    await collect(baseInput);

    expect(prismaMock.kosCustomer.update).toHaveBeenCalledWith({
      where: { id: "cust_1" },
      data: { currentConversationId: "conv_1" },
    });
  });

  it("orders the locator update AFTER persistCustomerMessage (so a reload always finds at least one row)", async () => {
    await collect(baseInput);

    // First kosMessage.create is the customer message; kosCustomer.update
    // must run after it but before history is loaded by loadHistoryAsMessages
    // (which calls kosMessage.findMany).
    const customerCreateOrder =
      prismaMock.kosMessage.create.mock.invocationCallOrder[0];
    const customerUpdateOrder =
      prismaMock.kosCustomer.update.mock.invocationCallOrder[0];
    const findManyOrder =
      prismaMock.kosMessage.findMany.mock.invocationCallOrder[0];

    expect(customerCreateOrder).toBeLessThan(customerUpdateOrder);
    expect(customerUpdateOrder).toBeLessThan(findManyOrder);
  });

  it("does NOT abort the turn when the locator update fails (best-effort)", async () => {
    // The locator update transiently fails (e.g. Neon cold start). The
    // turn must still complete cleanly — no error event emitted, no
    // throw escapes the generator.
    prismaMock.kosCustomer.update.mockRejectedValueOnce(
      new Error("connection reset"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = await collect(baseInput);

    // Turn completed: `done` event is the terminal one.
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events[events.length - 1].type).toBe("done");

    // And kosLog.warn fired (kosLog.warn routes to console.warn).
    expect(warnSpy).toHaveBeenCalled();
    const warnPayload = warnSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .join("\n");
    expect(warnPayload).toContain("kos_current_conv_update_failed");

    warnSpy.mockRestore();
  });
});
