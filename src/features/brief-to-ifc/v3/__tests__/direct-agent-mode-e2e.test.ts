/**
 * Phase gamma.1 — Direct Agent Mode E2E Integration Test.
 *
 * Mocks Anthropic + Railway sandbox + render endpoint.
 * Tests a 2-iteration flow: iteration 1 (quality 60), retry hint,
 * iteration 2 (quality 85).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the sandbox client before importing driver
vi.mock("../generator/sandbox-client", () => ({
  sandboxExec: vi.fn(),
  sandboxFinalize: vi.fn(),
  sandboxSummary: vi.fn(),
  sandboxValidate: vi.fn(),
}));

import type { BriefSpec, AgentInputSuggestions, VerifierReport, VisionReport } from "../types";
import type { RunGeneratorArgs } from "../generator/driver";
import {
  AGENT_MAX_TURNS_DIRECT_MODE,
  QUALITY_THRESHOLD,
  RENDER_PREVIEW_BUDGET,
} from "../constants";
import { generateRetryHint } from "../retry-hint";

// Minimal valid BriefSpec
function makeSpec(): BriefSpec {
  return {
    project: { name: "Podcasting Studio", type: "office", location: "Mumbai", description: "A podcasting studio with recording booth, mixing desk, and 4 microphones." },
    site: { bounds_m: [8, 6], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "sp-studio", name: "Studio", long_name: "Podcasting Studio", polygon_world_m: [[0,0],[8,0],[8,6],[0,6]], height_m: 3, occupancy_type: "Studio" }],
    elements: [],
    materials: [
      { id: "mat-1", name: "Concrete", rgb: [0.5, 0.5, 0.5], roughness: 0.8, method: "MATT", category: "concrete" },
      { id: "mat-acoustic", name: "Acoustic Foam", rgb: [0.2, 0.2, 0.2], roughness: 0.95, method: "MATT", category: "acoustic" },
    ],
    brand_language: { primary_text: "", approved_terms: [], forbidden_terms: [] },
    furniture: [
      { id: "mixing-desk", type: "mixing_desk", count: 1, material_id: "mat-1", description: "Professional mixing desk" },
      { id: "mic-01", type: "microphone", count: 4, material_id: "mat-1", description: "Condenser microphones on boom arms" },
    ],
  } as BriefSpec;
}

describe("Direct Agent Mode — E2E Integration (Phase gamma.1)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    process.env.IFC_SERVICE_URL = "https://test-railway.example.com";
    process.env.IFC_SERVICE_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("full 2-iteration flow: 60 → retry hint → 85 quality", async () => {
    // ── Setup ──────────────────────────────────────────────────
    const briefText = "Build a podcasting studio with a recording booth, mixing desk, and 4 microphones on boom arms.";
    const spec = makeSpec();
    const suggestions: AgentInputSuggestions = {
      rationale: [{ itemId: "mixing-desk", position: [3, 2, 0], rotation_z_rad: 0, rationale: "Center of room" }],
      materials: spec.materials,
    };

    // ── Iteration 1: quality 60 ──────────────────────────────
    // Mock runGenerator for iteration 1: agent builds 4 items as collapsed boxes
    const iteration1Called = false;
    let iteration1BriefText: string | undefined;
    let iteration1Feedback: string | undefined;

    const mockClientIter1 = {
      messages: {
        stream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "I'll plan the build..." }],
            usage: { input_tokens: 5000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: "end_turn",
          }),
        }),
      },
    };

    const { runGenerator } = await import("../generator/driver");

    // Run iteration 1
    const result1 = await runGenerator({
      brief: spec,
      briefText,
      suggestions,
      iteration: 1,
      maxTurns: 1, // Short-circuit for test
      clientFactory: () => mockClientIter1 as never,
    });

    // Verify briefText was passed
    const iter1Call = mockClientIter1.messages.stream.mock.calls[0][0];
    const iter1UserMsg = iter1Call.messages[0].content as string;
    expect(iter1UserMsg).toContain("## THE BRIEF");
    expect(iter1UserMsg).toContain("podcasting studio");

    // Verify previousFeedback is absent on iteration 1
    expect(iter1UserMsg).not.toContain("PREVIOUS ITERATION FEEDBACK");

    // Verify 200-turn default is used
    expect(AGENT_MAX_TURNS_DIRECT_MODE).toBe(200);

    // ── Retry Hint generation ────────────────────────────────
    const verifierReport: VerifierReport = {
      verified: false,
      parts_coverage: 0.3,
      trim_coverage: 0.5,
      mismatches: [
        { type: "missing_parts", item_id: "mixing-desk", expected: 5, actual: 1, severity: "high", description: "Mixing desk collapsed" },
        { type: "wrong_class", item_id: "mic-01", expected: "IfcFurnishingElement", actual: "IfcBuildingElementProxy", severity: "high", description: "Mics use wrong class" },
      ],
      summary: "Build quality insufficient",
      verified_at: new Date().toISOString(),
      source: "railway",
    };
    const visionReport: VisionReport = {
      quality_score: 60,
      pass: false,
      issues: [
        { severity: "high", type: "collapsed", description: "Mixing desk is a single box", affected_element: "mixing-desk", fixable: true },
      ],
      summary: "Quality needs improvement",
      inspected_at: new Date().toISOString(),
    };

    // Generate retry hint (uses deterministic fallback since no real API)
    delete process.env.ANTHROPIC_API_KEY;
    const hintResult = await generateRetryHint({
      brief: briefText,
      iteration: 1,
      previousIfcUrl: "https://example.com/iter1.ifc",
      verifierReport,
      visionReport,
      qualityScore: 60,
    });

    expect(hintResult.shouldIterate).toBe(true);
    expect(hintResult.hint.length).toBeGreaterThan(0);
    expect(hintResult.hint).toContain("mixing-desk");

    // ── Iteration 2: quality 85 ──────────────────────────────
    process.env.ANTHROPIC_API_KEY = "sk-test-key";

    const mockClientIter2 = {
      messages: {
        stream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Addressing feedback..." }],
            usage: { input_tokens: 8000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: "end_turn",
          }),
        }),
      },
    };

    const result2 = await runGenerator({
      brief: spec,
      briefText,
      suggestions,
      iteration: 2,
      previousFeedback: hintResult.hint,
      maxTurns: 1,
      clientFactory: () => mockClientIter2 as never,
    });

    // Verify previousFeedback is present on iteration 2
    const iter2Call = mockClientIter2.messages.stream.mock.calls[0][0];
    const iter2UserMsg = iter2Call.messages[0].content as string;
    expect(iter2UserMsg).toContain("## PREVIOUS ITERATION FEEDBACK");
    expect(iter2UserMsg).toContain("iteration 2");
    expect(iter2UserMsg).toContain("mixing-desk");

    // Verify briefText still present on iteration 2
    expect(iter2UserMsg).toContain("## THE BRIEF");
    expect(iter2UserMsg).toContain("podcasting studio");

    // ── Quality gate: iteration 2 should NOT iterate further ──
    const hintResult2 = await generateRetryHint({
      brief: briefText,
      iteration: 2,
      previousIfcUrl: "https://example.com/iter2.ifc",
      verifierReport: {
        ...verifierReport,
        verified: true,
        parts_coverage: 0.95,
        mismatches: [],
      },
      visionReport: { ...visionReport, quality_score: 85, pass: true, issues: [] },
      qualityScore: 85,
    });

    expect(hintResult2.shouldIterate).toBe(false);
    expect(hintResult2.hint).toBe("");
  });

  it("render_preview budget is enforced across iterations", () => {
    expect(RENDER_PREVIEW_BUDGET).toBe(10);
  });

  it("system prompt mentions render_preview and advisory framing", async () => {
    const { GENERATOR_SYSTEM_PROMPT } = await import("../generator/driver");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("render_preview");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("advisory");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("200 turns");
  });

  it("quality threshold and max iterations match constants", () => {
    // δ.2 raised the threshold from 75 → 80 alongside the new composite
    // quality formula (see PHASE_DELTA_2_2026-05-21.md §0.4). The old
    // value (75) was tuned to the broken legacy parts_coverage-only
    // formula; the new value is calibrated to the composite's
    // distribution (perfect ≈ 96, borderline ≈ 70-79, gray box ≈ 45).
    expect(QUALITY_THRESHOLD).toBe(80);
    expect(RENDER_PREVIEW_BUDGET).toBe(10);
    expect(AGENT_MAX_TURNS_DIRECT_MODE).toBe(200);
  });
});
