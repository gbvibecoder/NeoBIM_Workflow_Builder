/**
 * Phase gamma.1 — Agent Input Restructure tests.
 *
 * Verifies that the Direct Agent Mode input format is correctly
 * assembled: briefText + suggestions + previousFeedback flowing
 * through the generator driver's user message.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the sandbox client before importing driver
vi.mock("../generator/sandbox-client", () => ({
  sandboxExec: vi.fn(),
  sandboxFinalize: vi.fn(),
  sandboxSummary: vi.fn(),
  sandboxValidate: vi.fn(),
}));

import type { BriefSpec, AgentInputSuggestions } from "../types";
import type { RunGeneratorArgs } from "../generator/driver";

// Minimal valid BriefSpec for testing
function makeSpec(overrides?: Partial<BriefSpec>): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Mumbai", description: "A test office" },
    site: { bounds_m: [10, 10], height_limit_m: 5, coordinate_origin: "sw_corner" },
    spaces: [{ id: "sp-1", name: "Office", long_name: "Main Office", polygon_world_m: [[0,0],[10,0],[10,10],[0,10]], height_m: 3, occupancy_type: "Office" }],
    elements: [],
    materials: [{ id: "mat-1", name: "Concrete", rgb: [0.5, 0.5, 0.5], roughness: 0.8, method: "MATT", category: "concrete" }],
    brand_language: { primary_text: "", approved_terms: [], forbidden_terms: [] },
    ...overrides,
  } as BriefSpec;
}

describe("Agent Input Restructure (Phase gamma.1)", () => {
  let capturedMessages: unknown[];

  beforeEach(() => {
    capturedMessages = [];
  });

  function makeMockClient() {
    return {
      messages: {
        stream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Done." }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: "end_turn",
          }),
        }),
      },
    };
  }

  async function runWithArgs(args: Partial<RunGeneratorArgs>) {
    const { runGenerator } = await import("../generator/driver");
    const mockClient = makeMockClient();
    const fullArgs: RunGeneratorArgs = {
      brief: makeSpec(),
      maxTurns: 1,
      clientFactory: () => mockClient as never,
      ...args,
    };
    await runGenerator(fullArgs);
    // Extract the user message from the first call
    if (mockClient.messages.stream.mock.calls.length > 0) {
      const callArgs = mockClient.messages.stream.mock.calls[0][0];
      capturedMessages = callArgs.messages;
    }
    return { mockClient, capturedMessages };
  }

  it("includes briefText in the user message under THE BRIEF heading", async () => {
    const { capturedMessages } = await runWithArgs({
      briefText: "Build a podcasting studio with a recording booth, mixing desk, and 4 microphones.",
    });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).toContain("## THE BRIEF");
    expect(userMsg).toContain("podcasting studio");
    expect(userMsg).toContain("mixing desk");
  });

  it("labels upstream suggestions as advisory in user message", async () => {
    const suggestions: AgentInputSuggestions = {
      rationale: [
        { itemId: "desk-1", position: [2, 3, 0], rotation_z_rad: 0, rationale: "Against north wall" },
      ],
    };
    const { capturedMessages } = await runWithArgs({ suggestions });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).toContain("UPSTREAM SUGGESTIONS (advisory, not mandatory)");
    expect(userMsg).toContain("Design rationale from Architectural Reasoner");
    expect(userMsg).toContain("Against north wall");
  });

  it("includes previousFeedback on iteration 2+", async () => {
    const { capturedMessages } = await runWithArgs({
      iteration: 2,
      previousFeedback: "The cutting table was collapsed to a single box. Build it with 4 parts: top, legs, stretcher, felt covering.",
    });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).toContain("## PREVIOUS ITERATION FEEDBACK");
    expect(userMsg).toContain("cutting table was collapsed");
    expect(userMsg).toContain("iteration 2");
  });

  it("falls back to spec-only mode when briefText is absent (logs warning)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runWithArgs({ briefText: undefined });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("briefText absent"),
    );
    warnSpy.mockRestore();
  });

  it("labels materials as REQUIRED and deterministic", async () => {
    const suggestions: AgentInputSuggestions = {
      materials: [
        { id: "mat-oak", name: "Oak Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.7, method: "MATT", category: "wood" },
      ],
    };
    const { capturedMessages } = await runWithArgs({ suggestions });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).toContain("REQUIRED, deterministic");
    expect(userMsg).toContain("mat-oak");
  });

  it("includes all four upstream suggestion types when present", async () => {
    const suggestions: AgentInputSuggestions = {
      rationale: [{ itemId: "i1", position: [0, 0, 0], rotation_z_rad: 0, rationale: "test" }],
      decomposed_furniture: [{
        id: "f1", type: "desk", count: 1, material_id: "mat-1", description: "test desk",
        parts: [{ id: "p1", subtype: "top", origin_local_m: [0, 0, 0.7], dims_m: [1.5, 0.8, 0.03], shape: "box", rotation_z_rad: 0, material_id: "mat-1", ifc_class: "IfcFurnishingElement" }],
      }] as never,
      trim: [{ id: "t1", type: "skirting", hostId: "sp-1", material_id: "mat-1", dims_m: [5, 0.075, 0.018], rotation_z_rad: 0, ifc_class: "IfcCovering" }] as never,
      materials: [{ id: "mat-1", name: "Concrete", rgb: [0.5, 0.5, 0.5], roughness: 0.8, method: "MATT", category: "concrete" }],
    };
    const { capturedMessages } = await runWithArgs({ suggestions });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).toContain("Design rationale from Architectural Reasoner");
    expect(userMsg).toContain("Suggested part decomposition from Item Decomposer");
    expect(userMsg).toContain("Suggested trim items from Trim Specifier");
    expect(userMsg).toContain("Material catalog from Material Resolver");
  });

  it("does NOT include previousFeedback on iteration 1", async () => {
    const { capturedMessages } = await runWithArgs({
      iteration: 1,
      previousFeedback: "Should not appear",
    });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).not.toContain("PREVIOUS ITERATION FEEDBACK");
  });

  it("YOUR TASK section always present with turn count", async () => {
    const { capturedMessages } = await runWithArgs({
      briefText: "Simple test brief for an office space.",
      maxTurns: 200,
    });
    const userMsg = (capturedMessages[0] as { content: string }).content;
    expect(userMsg).toContain("## YOUR TASK");
    expect(userMsg).toContain("200 turns");
    expect(userMsg).toContain("render_preview tool");
  });
});
