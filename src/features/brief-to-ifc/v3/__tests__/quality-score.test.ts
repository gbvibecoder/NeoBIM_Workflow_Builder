/**
 * Phase δ.2 — composite quality scoring (replacement for the legacy
 * parts_coverage*80+verified*20 formula).
 *
 * Asserts the load-bearing invariants:
 *   - Truly perfect build → HIGH score (proves the "perfect build
 *     scored 50" bug is fixed)
 *   - Gray box / mostly empty → LOW score (drives the iteration loop
 *     to retry it)
 *   - Each sub-signal correctly contributes / drops out under its
 *     own conditions
 *   - Graceful degradation: signals can be missing in any combination
 *     without NaN / crash
 *   - Backward-compat: the legacy formula recompute matches the old
 *     code's behaviour for telemetry validation
 *   - Threshold calibration: PERFECT passes 80, GRAY BOX fails 80
 */

import { describe, it, expect } from "vitest";

import {
  computeLegacyQualityScore,
  computeQualityScore,
  QUALITY_SCORE_FORMULA_VERSION,
} from "../quality-score";
import { QUALITY_THRESHOLD } from "../constants";
import type {
  BriefSpec,
  SandboxValidateResult,
  VerifierReport,
  VisionReport,
} from "../types";

// ─── Brief spec fixtures ─────────────────────────────────────────────

function makeBriefSpec(overrides: Partial<BriefSpec> = {}): BriefSpec {
  return {
    project: {
      name: "Test",
      type: "office",
      location: "X",
      description: "Y",
    },
    site: {
      bounds_m: [10, 10],
      height_limit_m: 10,
      coordinate_origin: "sw_corner",
    },
    spaces: [
      {
        id: "space-1",
        name: "S1",
        long_name: "Space 1",
        polygon_world_m: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        height_m: 3,
        occupancy_type: "Office",
      },
    ],
    elements: [
      { id: "wall-1", type: "wall", origin_world_m: [0, 0, 0], material_id: "m1", description: "", object_type: "", tag: "" },
    ],
    materials: [
      {
        id: "m1",
        name: "M",
        rgb: [0.5, 0.5, 0.5],
        roughness: 0.5,
        method: "MATT",
        category: "x",
      },
    ],
    ...overrides,
  };
}

function makeValidation(overrides: Partial<SandboxValidateResult> = {}): SandboxValidateResult {
  return {
    session_id: "s1",
    schema_name: "IFC4",
    entity_count: 1500,
    refs_resolve: true,
    spaces_present: ["space-1"],
    spaces_missing: [],
    errors: [],
    web_ifc_load_test: "PASS",
    ascii_only: true,
    ascii_first_bad_offset: null,
    world_bbox: {
      verdict: "OK",
      expected_extent: [10, 10, 3],
      actual_bbox: { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 10, zmax: 3 },
      actual_extent: [10, 10, 3],
      extent_ratio: [1, 1, 1],
      suggested_unit_fix: null,
    },
    space_polygons: null,
    element_coverage: {
      verdict: "OK",
      total_expected: 20,
      total_actual_in_expected_classes: 19,
      by_class_expected: { IfcWall: 10, IfcDoor: 5, IfcFurnishingElement: 5 },
      by_class_actual: { IfcWall: 10, IfcDoor: 5, IfcFurnishingElement: 4 },
      missing_ids: [],
      missing_id_count: 0,
    },
    origin_collapse: {
      verdict: "OK",
      total_elements: 20,
      at_origin_count: 0,
      fraction_at_origin: 0,
      collapsed: false,
    },
    ...overrides,
  };
}

function makeVerifier(overrides: Partial<VerifierReport> = {}): VerifierReport {
  return {
    verified: true,
    parts_coverage: 0.9,
    trim_coverage: 0.8,
    mismatches: [],
    summary: "ok",
    verified_at: new Date().toISOString(),
    source: "railway",
    ...overrides,
  };
}

function makeVision(overrides: Partial<VisionReport> = {}): VisionReport {
  return {
    quality_score: 90,
    pass: true,
    issues: [],
    summary: "looks good",
    inspected_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── 1. Perfect build → HIGH score ───────────────────────────────────

describe("computeQualityScore — perfect build scores HIGH (fixes the bug)", () => {
  it("all four sub-signals perfect → score ≥ 95", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec({
        furniture: [
          {
            id: "f1",
            type: "table",
            count: 1,
            material_id: "m1",
            parts: [
              { id: "leg1", subtype: "leg", origin_local_m: [0, 0, 0], dims_m: [0.05, 0.05, 0.7], material_id: "m1", shape: "box" as const, rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" as const },
              { id: "leg2", subtype: "leg", origin_local_m: [0.5, 0, 0], dims_m: [0.05, 0.05, 0.7], material_id: "m1", shape: "box" as const, rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" as const },
              { id: "top", subtype: "top", origin_local_m: [0, 0, 0.7], dims_m: [0.6, 0.6, 0.03], material_id: "m1", shape: "box" as const, rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" as const },
            ],
            description: "",
          },
        ],
      }),
      finalValidation: makeValidation({
        element_coverage: {
          verdict: "OK",
          total_expected: 20,
          total_actual_in_expected_classes: 20,
          by_class_expected: { IfcWall: 10 },
          by_class_actual: { IfcWall: 10 },
          missing_ids: [],
          missing_id_count: 0,
        },
      }),
      verifierReport: makeVerifier({ parts_coverage: 1.0, verified: true }),
      visionReport: makeVision({ quality_score: 95 }),
    });

    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.signalsAvailable).toBe(4);
    expect(result.structuralCompleteness.available).toBe(true);
    expect(result.geometricSanity.available).toBe(true);
    expect(result.visionQuality.available).toBe(true);
    expect(result.partsDecomposition.available).toBe(true);
  });

  it("perfect build PASSES the calibrated threshold (>= QUALITY_THRESHOLD)", () => {
    // The whole point of δ.2 — visually-correct builds must clear
    // the gate so the δ.3 loop stops on iteration 1.
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: makeVerifier({ parts_coverage: 1.0, verified: true }),
      visionReport: makeVision({ quality_score: 92 }),
    });
    expect(result.score).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
  });
});

// ─── 2. Gray box / mostly empty → LOW score ──────────────────────────

describe("computeQualityScore — gray box scores LOW (drives retry)", () => {
  it("most elements missing + low vision → score < threshold", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation({
        spaces_present: [],
        spaces_missing: ["space-1"],
        element_coverage: {
          verdict: "MISSING_ELEMENTS",
          total_expected: 20,
          total_actual_in_expected_classes: 4,
          by_class_expected: { IfcWall: 10, IfcDoor: 5, IfcFurnishingElement: 5 },
          by_class_actual: { IfcWall: 4 },
          missing_ids: [],
          missing_id_count: 16,
        },
      }),
      verifierReport: makeVerifier(),
      visionReport: makeVision({
        quality_score: 30,
        pass: false,
        issues: [
          { severity: "high", type: "missing", description: "Furniture not visible.", fixable: true },
        ],
      }),
    });
    expect(result.score).toBeLessThan(QUALITY_THRESHOLD);
    expect(result.score).toBeLessThan(60);
  });

  it("broken: bbox FAIL + load FAIL → score very low (block the loop from accepting)", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation({
        web_ifc_load_test: "FAIL",
        refs_resolve: false,
        world_bbox: {
          verdict: "COLLAPSED_AT_ORIGIN",
          expected_extent: [10, 10, 3],
          actual_bbox: null,
          actual_extent: null,
          extent_ratio: null,
          suggested_unit_fix: null,
        },
        origin_collapse: {
          verdict: "COLLAPSED",
          total_elements: 5,
          at_origin_count: 5,
          fraction_at_origin: 1,
          collapsed: true,
        },
        element_coverage: {
          verdict: "MISSING_ELEMENTS",
          total_expected: 20,
          total_actual_in_expected_classes: 2,
          by_class_expected: {},
          by_class_actual: {},
          missing_ids: [],
          missing_id_count: 18,
        },
      }),
      verifierReport: null,
      visionReport: null,
    });
    expect(result.score).toBeLessThan(40);
  });
});

// ─── 3. Each sub-signal contributes correctly ────────────────────────

describe("computeQualityScore — sub-signal contributions", () => {
  it("structural_completeness reflects spaces ratio + element ratio average", () => {
    // spaces 1/1=1.0, elements 19/20=0.95 → structural = 0.975
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: null,
    });
    expect(result.structuralCompleteness.available).toBe(true);
    expect(result.structuralCompleteness.rawValue).toBeCloseTo(0.975, 2);
    expect(result.structuralCompleteness.notes).toMatch(/spaces 1\/1; elements 19\/20/);
  });

  it("geometric_sanity averages bbox + origin + load + refs gates", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: null,
    });
    // All gates pass → 1.0
    expect(result.geometricSanity.available).toBe(true);
    expect(result.geometricSanity.rawValue).toBe(1.0);
  });

  it("geometric_sanity drops a single gate when bbox verdict is non-OK", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation({
        world_bbox: {
          verdict: "SCALED_TOO_SMALL",
          expected_extent: [10, 10, 3],
          actual_bbox: { xmin: 0, ymin: 0, zmin: 0, xmax: 0.01, ymax: 0.01, zmax: 0.01 },
          actual_extent: [0.01, 0.01, 0.01],
          extent_ratio: [0.001, 0.001, 0.001],
          suggested_unit_fix: "millimetres to metres",
        },
      }),
      verifierReport: null,
      visionReport: null,
    });
    // 3 of 4 gates pass → 0.75
    expect(result.geometricSanity.rawValue).toBe(0.75);
  });

  it("vision_quality contributes vision.quality_score / 100", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: makeVision({ quality_score: 72 }),
    });
    expect(result.visionQuality.available).toBe(true);
    expect(result.visionQuality.rawValue).toBeCloseTo(0.72, 2);
  });

  it("parts_decomposition is N/A when briefSpec has no decomposed furniture", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(), // no .furniture[].parts
      finalValidation: makeValidation(),
      verifierReport: makeVerifier({ parts_coverage: 1.0 }),
      visionReport: null,
    });
    expect(result.partsDecomposition.available).toBe(false);
    expect(result.partsDecomposition.notes).toMatch(/no decomposed furniture/);
  });

  it("parts_decomposition contributes when expected_parts > 0 AND verifier is Railway", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec({
        furniture: [
          {
            id: "f1",
            type: "table",
            count: 1,
            material_id: "m1",
            parts: [
              { id: "leg1", subtype: "leg", origin_local_m: [0, 0, 0], dims_m: [0.05, 0.05, 0.7], material_id: "m1", shape: "box" as const, rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" as const },
              { id: "top", subtype: "top", origin_local_m: [0, 0, 0.7], dims_m: [0.6, 0.6, 0.03], material_id: "m1", shape: "box" as const, rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" as const },
            ],
            description: "",
          },
        ],
      }),
      finalValidation: makeValidation(),
      verifierReport: makeVerifier({ parts_coverage: 0.75 }),
      visionReport: null,
    });
    expect(result.partsDecomposition.available).toBe(true);
    expect(result.partsDecomposition.rawValue).toBeCloseTo(0.75, 2);
  });

  it("parts_decomposition drops out when verifier source != railway (pessimistic fallback)", () => {
    // Verifier returned heuristic_fallback (Railway was down). We do
    // NOT want a transient Railway outage to tank otherwise-good builds.
    const result = computeQualityScore({
      briefSpec: makeBriefSpec({
        furniture: [
          {
            id: "f1",
            type: "table",
            count: 1,
            material_id: "m1",
            parts: [
              { id: "leg1", subtype: "leg", origin_local_m: [0, 0, 0], dims_m: [0.05, 0.05, 0.7], material_id: "m1", shape: "box" as const, rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" as const },
            ],
            description: "",
          },
        ],
      }),
      finalValidation: makeValidation(),
      verifierReport: makeVerifier({ source: "heuristic_fallback", parts_coverage: 0 }),
      visionReport: null,
    });
    expect(result.partsDecomposition.available).toBe(false);
    expect(result.partsDecomposition.notes).toMatch(/heuristic_fallback/);
  });
});

// ─── 4. Coverage > 1.0 clamped ───────────────────────────────────────

describe("computeQualityScore — coverage clamping", () => {
  it("clamps spaces_ratio at 1.0 when built > expected", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(), // spec has 1 space
      finalValidation: makeValidation({
        spaces_present: ["space-1", "extra-1", "extra-2"], // built 3
      }),
      verifierReport: null,
      visionReport: null,
    });
    expect(result.structuralCompleteness.rawValue).toBeLessThanOrEqual(1.0);
  });

  it("clamps elements_ratio at 1.0 when actual > expected", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation({
        element_coverage: {
          verdict: "OK",
          total_expected: 10,
          total_actual_in_expected_classes: 25, // over-built
          by_class_expected: {},
          by_class_actual: {},
          missing_ids: [],
          missing_id_count: 0,
        },
      }),
      verifierReport: null,
      visionReport: null,
    });
    expect(result.structuralCompleteness.rawValue).toBeLessThanOrEqual(1.0);
  });
});

// ─── 5. Graceful degradation ─────────────────────────────────────────

describe("computeQualityScore — graceful degradation (Rule 7)", () => {
  it("vision absent → renormalizes remaining weights, never NaN", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: makeVerifier(),
      visionReport: null,
    });
    expect(result.visionQuality.available).toBe(false);
    expect(Number.isFinite(result.score)).toBe(true);
    // structural + sanity (parts is N/A because the base briefSpec has
    // no decomposed furniture; vision is null per this test).
    expect(result.signalsAvailable).toBe(2);
  });

  it("validation absent → structural + sanity both drop, score still finite", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: null,
      verifierReport: null,
      visionReport: makeVision(),
    });
    expect(result.structuralCompleteness.available).toBe(false);
    expect(result.geometricSanity.available).toBe(false);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.signalsAvailable).toBe(1); // only vision
  });

  it("vision infrastructure failure → vision drops out (does not zero the metric)", () => {
    // vision-inspector returns this shape when Anthropic call fails or
    // the JSON parse retries exhaust.
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: {
        quality_score: 0,
        pass: false,
        issues: [
          {
            severity: "high",
            type: "other",
            description: "Vision inspector unavailable: Anthropic client creation failed.",
            fixable: false,
          },
        ],
        summary: "Inspection could not be performed.",
        inspected_at: new Date().toISOString(),
      },
    });
    expect(result.visionQuality.available).toBe(false);
    expect(result.visionQuality.notes).toMatch(/vision infrastructure failure/);
    // The other signals still produce a sensible score.
    expect(result.score).toBeGreaterThan(50);
  });

  it("vision genuine failure (high-sev real issue) → score reflects the bad build", () => {
    // Distinct from infra failure: vision returned score 0 because the
    // build is genuinely broken (e.g. missing geometry).
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: {
        quality_score: 10,
        pass: false,
        issues: [
          {
            severity: "high",
            type: "missing",
            description: "Most furniture is missing from the render.",
            fixable: true,
          },
        ],
        summary: "Major issues.",
        inspected_at: new Date().toISOString(),
      },
    });
    expect(result.visionQuality.available).toBe(true);
    expect(result.visionQuality.rawValue).toBeCloseTo(0.1, 2);
  });

  it("ALL signals absent → score 0, breakdown notes the failure, no throw", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: null,
      verifierReport: null,
      visionReport: null,
    });
    expect(result.score).toBe(0);
    expect(result.signalsAvailable).toBe(0);
    expect(result.summary).toMatch(/no signals available/);
  });
});

// ─── 6. The score never NaN / never crashes ──────────────────────────

describe("computeQualityScore — never throws / never NaN", () => {
  it.each([
    ["everything null", { briefSpec: makeBriefSpec(), finalValidation: null, verifierReport: null, visionReport: null }],
    ["pathological verifier", { briefSpec: makeBriefSpec(), finalValidation: makeValidation(), verifierReport: { ...makeVerifier(), parts_coverage: NaN as number }, visionReport: null }],
    ["pathological vision", { briefSpec: makeBriefSpec(), finalValidation: makeValidation(), verifierReport: null, visionReport: { ...makeVision(), quality_score: NaN as number } }],
    ["empty spec", { briefSpec: { ...makeBriefSpec(), spaces: [], elements: [] }, finalValidation: makeValidation(), verifierReport: null, visionReport: null }],
  ])("does not throw / NaN for: %s", (_label, inputs) => {
    const result = computeQualityScore(inputs);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ─── 7. Backward-compat: legacy formula ──────────────────────────────

describe("computeLegacyQualityScore — preserves the old formula (Rule 6)", () => {
  it("parts_coverage=1.0, verified=true → 100", () => {
    expect(computeLegacyQualityScore(makeVerifier({ parts_coverage: 1.0, verified: true }))).toBe(100);
  });

  it("parts_coverage=0.5, verified=false → 40", () => {
    expect(computeLegacyQualityScore(makeVerifier({ parts_coverage: 0.5, verified: false }))).toBe(40);
  });

  it("verifier null → 0", () => {
    expect(computeLegacyQualityScore(null)).toBe(0);
  });

  it("matches the old worker's exact formula", () => {
    const r = makeVerifier({ parts_coverage: 0.625, verified: false });
    const expected = Math.round(r.parts_coverage * 80 + (r.verified ? 20 : 0));
    expect(computeLegacyQualityScore(r)).toBe(expected);
  });
});

// ─── 8. Threshold calibration (Rule 5) ───────────────────────────────

describe("QUALITY_THRESHOLD calibration — new metric distribution", () => {
  it("threshold is 80 (was 75 under the broken legacy formula)", () => {
    expect(QUALITY_THRESHOLD).toBe(80);
  });

  it("a 'good with minor issues' build (>80) PASSES the threshold", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: makeVision({ quality_score: 88 }),
    });
    expect(result.score).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
  });

  it("a 'borderline' build (~70) FAILS the threshold, triggering retry", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation({
        spaces_present: [],
        spaces_missing: ["space-1"],
        element_coverage: {
          verdict: "MISSING_ELEMENTS",
          total_expected: 20,
          total_actual_in_expected_classes: 12,
          by_class_expected: {},
          by_class_actual: {},
          missing_ids: [],
          missing_id_count: 8,
        },
      }),
      verifierReport: null,
      visionReport: makeVision({ quality_score: 70 }),
    });
    expect(result.score).toBeLessThan(QUALITY_THRESHOLD);
  });
});

// ─── 9. Formula version is stamped ───────────────────────────────────

describe("computeQualityScore — formula version baked into breakdown", () => {
  it("includes formulaVersion for telemetry distinguishability", () => {
    const result = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeValidation(),
      verifierReport: null,
      visionReport: null,
    });
    expect(result.formulaVersion).toBe(QUALITY_SCORE_FORMULA_VERSION);
    expect(result.formulaVersion).toMatch(/^delta\.2/);
  });
});
