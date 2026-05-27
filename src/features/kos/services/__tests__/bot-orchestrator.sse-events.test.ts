/**
 * 5I PR 3 — Orchestrator SSE-event regression tests.
 *
 * Approach: rather than mock the full Anthropic streaming SDK (which
 * has no pre-existing test scaffolding from PR 2b — wired up here would
 * balloon scope), we mock the inner pieces (anthropic-client,
 * rag-retriever, drawing tools, prisma) so `runBotTurn` runs against
 * canned tool-use traces.
 *
 * Each test verifies a specific event sequence emitted by the
 * generator. Existing PR 2b events (`tool_call_start` /
 * `tool_call_result` / `text_delta` / `done` / `error`) must still
 * appear in the right order — regression for PR 1+PR 2a+PR 2b.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, anthropicMock, processDrawingMock, generateBoqMock, generateFormworkMock, generateShopDrawingMock } =
  vi.hoisted(() => ({
    prismaMock: {
      kosConversation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      kosMessage: { create: vi.fn(), findMany: vi.fn() },
      kosAuditLog: { create: vi.fn() },
      tenant: { findUnique: vi.fn() },
      kosCustomer: { findUnique: vi.fn() },
    },
    anthropicMock: { messages: { stream: vi.fn() } },
    processDrawingMock: vi.fn(),
    generateBoqMock: vi.fn(),
    generateFormworkMock: vi.fn(),
    generateShopDrawingMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/features/kos/services/anthropic-client", () => ({
  getKosAnthropicClient: () => anthropicMock,
}));
vi.mock("@/features/kos/services/rag-retriever", () => ({
  retrieveChunks: vi.fn(),
}));
vi.mock("@/features/kos/services/bot-tools/tool-process-drawing", () => ({
  processDrawingTool: processDrawingMock,
}));
vi.mock("@/features/kos/services/bot-tools/tool-generate-boq", () => ({
  generateBoqTool: generateBoqMock,
}));
vi.mock("@/features/kos/services/bot-tools/tool-generate-formwork", () => ({
  generateFormworkTool: generateFormworkMock,
}));
vi.mock("@/features/kos/services/bot-tools/tool-generate-shop-drawing", () => ({
  generateShopDrawingTool: generateShopDrawingMock,
}));

import { runBotTurn, type BotEvent } from "../bot-orchestrator";

// ── Mock-anthropic streaming machinery ──────────────────────────────────
//
// `runOneStreamingTurn` (private inside the orchestrator) iterates raw
// stream events from the SDK and builds a `{events, toolUses, stopReason,
// finalMessage}` shape. We mock `anthropic.messages.stream(...)` to
// return a value that satisfies BOTH the for-await loop and the
// `.finalMessage()` method.

interface MockToolUse {
  id: string;
  name: string;
  input: unknown;
}
interface MockTurnSpec {
  textDeltas?: string[];
  toolUses?: MockToolUse[];
  stopReason: "tool_use" | "end_turn";
}

function makeStreamMock(spec: MockTurnSpec) {
  // Yields the minimum set of RawMessageStreamEvent shapes the
  // orchestrator's runOneStreamingTurn cares about.
  async function* gen() {
    let idx = 0;
    for (const txt of spec.textDeltas ?? []) {
      yield {
        type: "content_block_delta",
        index: idx,
        delta: { type: "text_delta", text: txt },
      };
    }
    for (const tu of spec.toolUses ?? []) {
      idx += 1;
      yield {
        type: "content_block_start",
        index: idx,
        content_block: { type: "tool_use", id: tu.id, name: tu.name },
      };
      yield {
        type: "content_block_delta",
        index: idx,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(tu.input),
        },
      };
      yield { type: "content_block_stop", index: idx };
    }
    yield {
      type: "message_delta",
      delta: { stop_reason: spec.stopReason },
    };
  }
  const stream = gen();
  // finalMessage() returns an Anthropic message with `content` (an
  // array of content blocks). The orchestrator embeds this in the next
  // iteration's `messages` array; for our happy-path tests the content
  // does not need to be structurally rich.
  (stream as unknown as { finalMessage: () => Promise<unknown> }).finalMessage =
    async () => ({
      content: (spec.toolUses ?? []).map((tu) => ({
        type: "tool_use",
        id: tu.id,
        name: tu.name,
        input: tu.input,
      })),
      stop_reason: spec.stopReason,
    });
  return stream;
}

function setupStream(specs: MockTurnSpec[]): void {
  let call = 0;
  anthropicMock.messages.stream.mockImplementation(() => {
    const spec = specs[call] ?? { stopReason: "end_turn" };
    call += 1;
    return makeStreamMock(spec);
  });
}

async function collect(input: Parameters<typeof runBotTurn>[0]): Promise<BotEvent[]> {
  const out: BotEvent[] = [];
  for await (const ev of runBotTurn(input)) {
    out.push(ev);
  }
  return out;
}

// ── Fixtures ────────────────────────────────────────────────────────────

const baseInput = {
  tenantId: "tenant_1",
  tenantName: "Kalzen",
  conversationId: null,
  customerId: "cust_1",
  customerMessage: "process my drawing",
  customerDisplayName: "Test User",
};

describe("bot-orchestrator SSE events — PR 3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    prismaMock.tenant.findUnique.mockResolvedValue({ id: "tenant_1" });
    prismaMock.kosCustomer.findUnique.mockResolvedValue({ id: "cust_1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: process_drawing → BOQ + Formwork → COMPLETE event emitted exactly once", async () => {
    // Turn 1 emits the 3 drawing-tool tool_uses in sequence (sequential
    // dispatch even though the model may have issued them in one batch
    // — orchestrator iterates them in order).
    // Turn 2 sees no tool_use, just an end_turn (model writes final text).
    setupStream([
      {
        toolUses: [
          { id: "tu_pd", name: "process_drawing", input: { drawing_id: "draw_1" } },
          { id: "tu_boq", name: "generate_boq", input: { drawing_id: "draw_1" } },
          { id: "tu_frm", name: "generate_formwork", input: { drawing_id: "draw_1" } },
        ],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);

    processDrawingMock.mockResolvedValueOnce({
      status: "ready",
      drawing_id: "draw_1",
      drawing_summary: {
        title_block_drawing_title: "Plan A",
        title_block_project_name: "Proj",
        walls_count: 140,
        junctions_count: 213,
        openings_count: 25,
        parser_version: "0.2.0",
        drawing_type: "FLOOR_PLAN",
        drawing_type_confidence: 0.9,
      },
      mapper_summary: {
        total_weight_kg: 1234,
        waste_ratio: 0.05,
        downstream_ready_boq: true,
        downstream_ready_formwork: true,
        wall_segments_count: 8,
      },
    });

    generateBoqMock.mockResolvedValueOnce({
      status: "generated",
      drawing_id: "draw_1",
      boq_id: "boq_xyz",
      s3_key: "kos/t/drawings/draw_1/boq.json",
      summary: {
        total_standard_panels: 15583,
        grand_total_inr_formatted: "₹4,80,70,359.97",
        custom_quotes_pending_count: 81,
      },
      warnings_count: 0,
      pending_karthik_count: 0,
    });

    generateFormworkMock.mockResolvedValueOnce({
      status: "generated",
      drawing_id: "draw_1",
      formwork_id: "frm_xyz",
      s3_key: "kos/t/drawings/draw_1/formwork.json",
      summary: {
        total_props: 5456,
        total_walers: 5456,
        total_kickers: 24545,
        total_starter_track_meters: 4908.75,
      },
      warnings_count: 0,
      pending_karthik_count: 0,
    });

    const events = await collect(baseInput);
    const types = events.map((e) => e.type);

    // Expected sequence (ignoring done + citations at the end):
    // tool_call_start(pd) →
    //   drawing_status: PROCESSING_PARSE →   [emitted INSIDE pd branch BEFORE the await]
    //   drawing_status: READY_FOR_GENERATION →
    // tool_call_result(pd) →
    // tool_call_start(boq) →
    //   drawing_status: GENERATING_BOQ →
    //   artifact_ready(boq) →
    // tool_call_result(boq) →
    // tool_call_start(frm) →
    //   drawing_status: GENERATING_FORMWORK →
    //   artifact_ready(frm) →
    //   drawing_status: COMPLETE →
    // tool_call_result(frm) →
    // ...
    // citations → done
    expect(types).toContain("drawing_status");
    expect(types).toContain("artifact_ready");

    const drawingStatuses = events
      .filter((e) => e.type === "drawing_status")
      .map((e) => (e as { status: string }).status);
    expect(drawingStatuses).toEqual([
      "PROCESSING_PARSE",
      "READY_FOR_GENERATION",
      "GENERATING_BOQ",
      "GENERATING_FORMWORK",
      "COMPLETE",
    ]);

    // COMPLETE fires exactly once even across both branches' checks.
    expect(drawingStatuses.filter((s) => s === "COMPLETE")).toHaveLength(1);

    const artifactReady = events.filter((e) => e.type === "artifact_ready");
    expect(artifactReady).toHaveLength(2);
    expect(artifactReady.map((e) => (e as { kind: string }).kind).sort()).toEqual([
      "boq",
      "formwork",
    ]);

    // Existing PR 2b events still fire — regression catcher
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_result");
    expect(types).toContain("done");
  });

  it("UNKNOWN classifier → classification_needed + drawing_status NEEDS_CLASSIFICATION (no BOQ/Formwork tools called)", async () => {
    setupStream([
      {
        toolUses: [
          { id: "tu", name: "process_drawing", input: { drawing_id: "draw_1" } },
        ],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);

    processDrawingMock.mockResolvedValueOnce({
      status: "needs_classification",
      drawing_id: "draw_1",
      title_block: { drawing_title: "Mystery", level: "BASEMENT" },
      suggested_hints: [{ id: "villa_external", label: "Villa external wall" }],
      message: "What kind of wall?",
    });

    const events = await collect(baseInput);
    const types = events.map((e) => e.type);
    expect(types).toContain("classification_needed");
    expect(types).toContain("drawing_status");

    const ds = events
      .filter((e) => e.type === "drawing_status")
      .map((e) => (e as { status: string }).status);
    expect(ds).toEqual(["PROCESSING_PARSE", "NEEDS_CLASSIFICATION"]);

    const cn = events.find((e) => e.type === "classification_needed");
    // Cast via `unknown` first — the underlying union is a readonly
    // tuple from the kos-bot-constants APPLICATION_HINT_SUGGESTIONS,
    // not a mutable array.
    expect(
      (cn as unknown as { suggestedHints: readonly unknown[] }).suggestedHints,
    ).toHaveLength(1);
    expect(generateBoqMock).not.toHaveBeenCalled();
    expect(generateFormworkMock).not.toHaveBeenCalled();
  });

  it("scanned PDF → drawing_status FAILED with errorCode KOS_DRAWING_004", async () => {
    setupStream([
      {
        toolUses: [
          { id: "tu", name: "process_drawing", input: { drawing_id: "draw_1" } },
        ],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);

    processDrawingMock.mockResolvedValueOnce({
      status: "scanned_pdf",
      drawing_id: "draw_1",
      message: "scanned image — please re-upload a vector PDF or DXF",
    });

    const events = await collect(baseInput);
    const failed = events.find(
      (e) => e.type === "drawing_status" && (e as { status: string }).status === "FAILED",
    );
    expect(failed).toBeDefined();
    expect((failed as { errorCode: string }).errorCode).toBe("KOS_DRAWING_004");
  });

  it("generic parse failure → drawing_status FAILED with surfaced error", async () => {
    setupStream([
      {
        toolUses: [{ id: "tu", name: "process_drawing", input: { drawing_id: "draw_1" } }],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);

    processDrawingMock.mockResolvedValueOnce({
      status: "failed",
      drawing_id: "draw_1",
      error_code: "KOS_DRAWING_001",
      error_message: "Sidecar timed out",
    });

    const events = await collect(baseInput);
    const failed = events.find(
      (e) => e.type === "drawing_status" && (e as { status: string }).status === "FAILED",
    );
    expect((failed as { errorCode: string }).errorCode).toBe("KOS_DRAWING_001");
    expect((failed as { errorMessage: string }).errorMessage).toContain("Sidecar");
  });

  it("BOQ succeeds, Formwork fails → artifact_ready(boq) + artifact_failed(formwork); NO drawing_status COMPLETE", async () => {
    setupStream([
      {
        toolUses: [
          { id: "pd", name: "process_drawing", input: { drawing_id: "draw_1" } },
          { id: "boq", name: "generate_boq", input: { drawing_id: "draw_1" } },
          { id: "frm", name: "generate_formwork", input: { drawing_id: "draw_1" } },
        ],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);

    processDrawingMock.mockResolvedValueOnce({
      status: "ready",
      drawing_id: "draw_1",
      drawing_summary: {
        title_block_drawing_title: "x",
        title_block_project_name: "x",
        walls_count: 10,
        junctions_count: 0,
        openings_count: 0,
        parser_version: "0.2.0",
        drawing_type: "FLOOR_PLAN",
        drawing_type_confidence: 0.9,
      },
      mapper_summary: {
        total_weight_kg: 1,
        waste_ratio: 0,
        downstream_ready_boq: true,
        downstream_ready_formwork: true,
        wall_segments_count: 1,
      },
    });
    generateBoqMock.mockResolvedValueOnce({
      status: "generated",
      drawing_id: "draw_1",
      boq_id: "x",
      s3_key: "k",
      summary: {},
      warnings_count: 0,
      pending_karthik_count: 0,
    });
    generateFormworkMock.mockResolvedValueOnce({
      status: "failed",
      drawing_id: "draw_1",
      error_code: "KOS_FRM_GEN_SIDECAR_5XX",
      error_message: "sidecar down",
    });

    const events = await collect(baseInput);
    const ready = events.filter((e) => e.type === "artifact_ready");
    const failed = events.filter((e) => e.type === "artifact_failed");
    expect(ready).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((ready[0] as { kind: string }).kind).toBe("boq");
    expect((failed[0] as { kind: string }).kind).toBe("formwork");

    const completes = events.filter(
      (e) => e.type === "drawing_status" && (e as { status: string }).status === "COMPLETE",
    );
    expect(completes).toHaveLength(0); // not COMPLETE because Formwork failed
  });

  it("Both BOQ and Formwork fail → 2 artifact_failed events, no COMPLETE", async () => {
    setupStream([
      {
        toolUses: [
          { id: "pd", name: "process_drawing", input: { drawing_id: "draw_1" } },
          { id: "boq", name: "generate_boq", input: { drawing_id: "draw_1" } },
          { id: "frm", name: "generate_formwork", input: { drawing_id: "draw_1" } },
        ],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);
    processDrawingMock.mockResolvedValueOnce({
      status: "ready",
      drawing_id: "draw_1",
      drawing_summary: {
        title_block_drawing_title: "x",
        title_block_project_name: null,
        walls_count: 0,
        junctions_count: 0,
        openings_count: 0,
        parser_version: "0.2.0",
        drawing_type: "FLOOR_PLAN",
        drawing_type_confidence: 0.9,
      },
      mapper_summary: {
        total_weight_kg: null,
        waste_ratio: null,
        downstream_ready_boq: true,
        downstream_ready_formwork: true,
        wall_segments_count: 0,
      },
    });
    generateBoqMock.mockResolvedValueOnce({
      status: "failed",
      drawing_id: "draw_1",
      error_code: "KOS_BOQ_GEN_SIDECAR_4XX",
      error_message: "bad input",
    });
    generateFormworkMock.mockResolvedValueOnce({
      status: "failed",
      drawing_id: "draw_1",
      error_code: "KOS_FRM_GEN_SIDECAR_4XX",
      error_message: "bad input",
    });

    const events = await collect(baseInput);
    expect(events.filter((e) => e.type === "artifact_failed")).toHaveLength(2);
    expect(
      events.filter(
        (e) =>
          e.type === "drawing_status" && (e as { status: string }).status === "COMPLETE",
      ),
    ).toHaveLength(0);
  });

  it("KOS_BOT_QUOTA_EXCEEDED thrown by process_drawing → drawing_status FAILED with that errorCode", async () => {
    setupStream([
      {
        toolUses: [{ id: "tu", name: "process_drawing", input: { drawing_id: "draw_1" } }],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);

    const { KosError } = await import("@/features/kos/lib/kos-errors");
    processDrawingMock.mockRejectedValueOnce(
      new KosError("KOS_BOT_QUOTA_EXCEEDED", "quota exceeded", 429),
    );

    const events = await collect(baseInput);
    const failed = events.find(
      (e) => e.type === "drawing_status" && (e as { status: string }).status === "FAILED",
    );
    expect((failed as { errorCode: string }).errorCode).toBe("KOS_BOT_QUOTA_EXCEEDED");
  });

  it("drawing_status PROCESSING_PARSE fires BEFORE tool_call_start's matching pair? — note: tool_call_start fires first per dispatch order", async () => {
    setupStream([
      {
        toolUses: [{ id: "tu", name: "process_drawing", input: { drawing_id: "draw_1" } }],
        stopReason: "tool_use",
      },
      { stopReason: "end_turn" },
    ]);
    processDrawingMock.mockResolvedValueOnce({
      status: "ready",
      drawing_id: "draw_1",
      drawing_summary: {
        title_block_drawing_title: "x",
        title_block_project_name: null,
        walls_count: 0,
        junctions_count: 0,
        openings_count: 0,
        parser_version: "0.2.0",
        drawing_type: "FLOOR_PLAN",
        drawing_type_confidence: 0.9,
      },
      mapper_summary: {
        total_weight_kg: null,
        waste_ratio: null,
        downstream_ready_boq: true,
        downstream_ready_formwork: true,
        wall_segments_count: 0,
      },
    });

    const events = await collect(baseInput);
    // Documented ordering: tool_call_start fires from the outer dispatch
    // loop, THEN PROCESSING_PARSE fires from inside the branch. We
    // assert this so a future refactor doesn't break UI assumptions.
    const tcsIdx = events.findIndex(
      (e) => e.type === "tool_call_start" && (e as { tool: string }).tool === "process_drawing",
    );
    const ppIdx = events.findIndex(
      (e) =>
        e.type === "drawing_status" && (e as { status: string }).status === "PROCESSING_PARSE",
    );
    expect(tcsIdx).toBeLessThan(ppIdx);
    expect(ppIdx).toBeGreaterThan(-1);
  });

  it("existing event types (text_delta) still fire when present", async () => {
    setupStream([
      {
        textDeltas: ["Hello "],
        stopReason: "end_turn",
      },
    ]);
    const events = await collect(baseInput);
    const texts = events.filter((e) => e.type === "text_delta");
    expect(texts.length).toBeGreaterThan(0);
    expect((texts[0] as { text: string }).text).toBe("Hello ");
  });
});
