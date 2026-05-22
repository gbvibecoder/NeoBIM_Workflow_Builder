/**
 * Phase δ.3 — anti-cold-start: compressed prior-state summary.
 *
 * Asserts:
 *   - Element counts, world bbox, missing IDs surface in the summary
 *   - Verifier mismatches surface (high/med severity only)
 *   - Missing optional inputs degrade gracefully (no throw)
 *   - The retry hint is preserved
 *   - Output stays under MAX_SUMMARY_CHARS
 */

import { describe, it, expect } from "vitest";

import { buildPriorStateSummary } from "../prior-state-summary";
import type {
  SandboxValidateResult,
  VerifierReport,
  VisionReport,
} from "../types";

function makeValidation(): SandboxValidateResult {
  return {
    session_id: "sess-1",
    schema_name: "IFC4",
    entity_count: 1500,
    refs_resolve: true,
    spaces_present: ["space-1", "space-2"],
    spaces_missing: ["space-3"],
    errors: [],
    web_ifc_load_test: "PASS",
    ascii_only: true,
    ascii_first_bad_offset: null,
    world_bbox: {
      verdict: "OK",
      expected_extent: [20, 15, 6],
      actual_bbox: { xmin: 0, ymin: 0, zmin: 0, xmax: 20, ymax: 15, zmax: 6 },
      actual_extent: [20, 15, 6],
      extent_ratio: [1, 1, 1],
      suggested_unit_fix: null,
    },
    space_polygons: null,
    element_coverage: {
      verdict: "MISSING_ELEMENTS",
      total_expected: 30,
      total_actual_in_expected_classes: 22,
      by_class_expected: { IfcWall: 10, IfcDoor: 5, IfcStair: 2, IfcFurnishingElement: 13 },
      by_class_actual: { IfcWall: 10, IfcDoor: 4, IfcFurnishingElement: 8 },
      missing_ids: [
        { id: "door-bath-1", expected_class: "IfcDoor" },
        { id: "stair-main", expected_class: "IfcStair" },
        { id: "stair-aux", expected_class: "IfcStair" },
      ],
      missing_id_count: 3,
    },
    origin_collapse: null,
  };
}

function makeVerifier(): VerifierReport {
  return {
    verified: false,
    parts_coverage: 0.55,
    trim_coverage: 0.3,
    mismatches: [
      {
        type: "missing_parts",
        item_id: "table-cutting",
        item_type: "cutting_table",
        expected: 3,
        actual: 1,
        severity: "high",
        description: "Cutting table collapsed into a single block; needs decomposed parts.",
      },
      {
        type: "missing_trim",
        item_id: "wall-trim-1",
        item_type: "skirting",
        expected: 1,
        actual: 0,
        severity: "med",
        description: "Skirting missing along east wall.",
      },
      {
        type: "missing_parts",
        item_id: "trivial-low",
        expected: 1,
        actual: 0,
        severity: "low",
        description: "Low-severity issue — should not appear in summary.",
      },
    ],
    summary: "55% parts coverage",
    verified_at: new Date().toISOString(),
    source: "railway",
  };
}

describe("buildPriorStateSummary — happy path", () => {
  it("includes iteration number, score, and the honest 'rebuild incorporating fixes' instruction (ε.5 wording fix)", () => {
    // Phase ε.5 — the previous wording "Build ON your prior work — do
    // not start over" was misleading: the sandbox session IS destroyed
    // at finalize_ifc, so iteration N+1 starts with a fresh sandbox.
    // The honest framing tells the agent to address the issues by
    // rebuilding, not to look for nonexistent prior state.
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 55,
      finalValidation: makeValidation(),
      verifierReport: makeVerifier(),
      visionReport: null,
      retryHint: "Decompose the cutting table.",
    });
    expect(out).toContain("ITERATION 1 RESULT");
    expect(out).toContain("55/100");
    expect(out).toContain("iteration 2 of up to 3");
    expect(out).toContain("Address the issues from your prior iteration");
    expect(out).toContain("rebuild");
    expect(out).not.toContain("Build ON your prior work");
  });

  it("includes entity count + spaces present + world bbox extent", () => {
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 55,
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: null,
      retryHint: "x",
    });
    expect(out).toContain("Entity count: 1500");
    expect(out).toContain("Spaces present: 2");
    expect(out).toContain("verdict=OK");
    expect(out).toContain("20.0m × 15.0m × 6.0m");
  });

  it("surfaces built-vs-expected per IFC class", () => {
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 55,
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: null,
      retryHint: "x",
    });
    expect(out).toContain("IfcWall: built 10/10");
    expect(out).toContain("IfcDoor: built 4/5");
    expect(out).toContain("IfcStair: built 0/2");
  });

  it("surfaces missing element IDs and the spaces-missing count", () => {
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 55,
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: null,
      retryHint: "x",
    });
    expect(out).toContain("3 missing");
    expect(out).toContain("stair-main");
    expect(out).toContain("door-bath-1");
    expect(out).toContain("Spaces missing from IFC: 1");
    expect(out).toContain("space-3");
  });

  it("surfaces high+med verifier mismatches but NOT low severity", () => {
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 55,
      finalValidation: makeValidation(),
      verifierReport: makeVerifier(),
      visionReport: null,
      retryHint: "x",
    });
    expect(out).toContain("table-cutting");
    expect(out).toContain("wall-trim-1");
    expect(out).not.toContain("trivial-low");
  });

  it("appends the retry hint as the closing section", () => {
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 55,
      finalValidation: makeValidation(),
      verifierReport: makeVerifier(),
      visionReport: null,
      retryHint: "Decompose the cutting table into a top + 4 legs.",
    });
    expect(out).toContain("Retry hint from reviewer");
    expect(out).toContain("Decompose the cutting table into a top + 4 legs.");
  });
});

describe("buildPriorStateSummary — degrades gracefully on missing inputs", () => {
  it("validation null → adds 'validation unavailable' fallback, no crash", () => {
    const out = buildPriorStateSummary({
      iteration: 2,
      qualityScore: 30,
      finalValidation: null,
      verifierReport: null,
      visionReport: null,
      retryHint: "Try again.",
    });
    expect(out).toContain("ITERATION 2 RESULT");
    expect(out).toContain("validation result unavailable");
    expect(out).toContain("Try again.");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
  });

  it("verifier null AND validation null AND empty retry hint → still returns a coherent string", () => {
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 0,
      finalValidation: null,
      verifierReport: null,
      visionReport: null,
      retryHint: "",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("ITERATION 1 RESULT");
  });

  it("vision report with only low-severity issues → no vision section emitted", () => {
    const visionLow: VisionReport = {
      quality_score: 60,
      pass: false,
      issues: [
        {
          severity: "low",
          type: "other",
          description: "minor cosmetic.",
          fixable: true,
        },
      ],
      summary: "low only",
      inspected_at: new Date().toISOString(),
    };
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 60,
      finalValidation: null,
      verifierReport: null,
      visionReport: visionLow,
      retryHint: "x",
    });
    expect(out).not.toContain("Vision inspector findings");
  });
});

describe("buildPriorStateSummary — bounded length", () => {
  it("never exceeds 2000 chars even when verifier flags many high-sev issues", () => {
    // 50 high-severity mismatches — the summary must truncate.
    const verifier: VerifierReport = {
      verified: false,
      parts_coverage: 0.1,
      trim_coverage: 0.1,
      mismatches: Array.from({ length: 50 }, (_, i) => ({
        type: "missing_parts" as const,
        item_id: `huge-item-${i}`,
        item_type: "thing",
        expected: 5,
        actual: 0,
        severity: "high" as const,
        description: `A very wordy description that takes up many characters and explains in detail what is wrong with this item ${i}.`,
      })),
      summary: "many issues",
      verified_at: new Date().toISOString(),
      source: "railway",
    };
    const out = buildPriorStateSummary({
      iteration: 1,
      qualityScore: 10,
      finalValidation: makeValidation(),
      verifierReport: verifier,
      visionReport: null,
      retryHint: "A".repeat(500),
    });
    expect(out.length).toBeLessThanOrEqual(2000);
  });
});
