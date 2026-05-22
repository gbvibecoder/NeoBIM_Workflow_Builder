/**
 * Phase gamma.1 — render_preview tool tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  handleRenderPreviewTool,
  RenderPreviewBudget,
} from "../tools/render-preview-tool";
import { RENDER_PREVIEW_BUDGET } from "../constants";
import { v3GeneratorTools, TOOL_RENDER_PREVIEW } from "../generator/tools";

describe("render_preview tool (Phase gamma.1)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.IFC_SERVICE_URL = "https://test-railway.example.com";
    process.env.IFC_SERVICE_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("tool definition includes 4 view enum values", () => {
    const tools = v3GeneratorTools();
    const renderTool = tools.find(t => t.name === TOOL_RENDER_PREVIEW);
    expect(renderTool).toBeDefined();
    const viewProp = (renderTool!.input_schema as Record<string, unknown> & {
      properties: Record<string, { enum?: string[] }>;
    }).properties.view;
    expect(viewProp.enum).toEqual(["iso", "top", "front", "side"]);
  });

  it("tool handler snapshots IFC, calls Railway, returns base64", async () => {
    const mockB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ image_b64: mockB64 }),
    });

    const budget = new RenderPreviewBudget();
    const result = await handleRenderPreviewTool(
      { view: "iso", note: "check walls" },
      { sessionId: "test-session-123", turn: 20 },
      budget,
    );

    expect(result.ok).toBe(true);
    expect(result.image_b64).toBe(mockB64);
    expect(result.render_ms).toBeTypeOf("number");
    expect(result.note).toBe("check walls");
    expect(budget.used).toBe(1);

    // Verify fetch was called with correct URL and session header
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://test-railway.example.com/api/v3/generator/render-preview",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "bf-session-id": "test-session-123",
        }),
      }),
    );
  });

  it("Railway 500 returns text-only error to agent (graceful)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const budget = new RenderPreviewBudget();
    const result = await handleRenderPreviewTool(
      { view: "top" },
      { sessionId: "sess-1", turn: 5 },
      budget,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("HTTP 500");
    // Budget still incremented (the call was attempted)
    expect(budget.used).toBe(1);
  });

  it("11th call within one build returns budget-exhausted message", async () => {
    const budget = new RenderPreviewBudget();
    // Exhaust the budget with mock calls
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ image_b64: "base64data" }),
    });

    for (let i = 0; i < RENDER_PREVIEW_BUDGET; i++) {
      await handleRenderPreviewTool(
        { view: "iso" },
        { sessionId: "sess-1", turn: i + 1 },
        budget,
      );
    }
    expect(budget.used).toBe(RENDER_PREVIEW_BUDGET);
    expect(budget.exhausted).toBe(true);

    // The 11th call should be rejected without calling fetch again
    const fetchCallCount = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const result = await handleRenderPreviewTool(
      { view: "iso" },
      { sessionId: "sess-1", turn: 11 },
      budget,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("budget exhausted");
    // fetch should NOT have been called again
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallCount);
  });

  it("render call logged with turn number and elapsed time", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ image_b64: "data" }),
    });

    const budget = new RenderPreviewBudget();
    await handleRenderPreviewTool(
      { view: "front", note: "check placement" },
      { sessionId: "sess-x", turn: 42 },
      budget,
    );

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("turn=42"),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("render_ms="),
    );
    infoSpy.mockRestore();
  });

  it("no session returns error without calling Railway", async () => {
    globalThis.fetch = vi.fn();
    const budget = new RenderPreviewBudget();
    const result = await handleRenderPreviewTool(
      { view: "iso" },
      { sessionId: null, turn: 1 },
      budget,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No active session");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
