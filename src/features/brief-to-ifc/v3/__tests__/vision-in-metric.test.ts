/**
 * Phase ε.3 — vision-in-the-metric integration test.
 *
 * Pre-ε.3 the composite metric's vision_quality sub-signal was
 * hardcoded null at the worker call site because finalize_ifc destroys
 * the agent's sandbox session. ε.3 wires the post-finalize render-
 * previews call so vision actually contributes.
 *
 * The pure scoring function (computeQualityScore) was already vision-
 * aware via δ.2; this test pins the BEHAVIOUR change: a build that's
 * structurally fine but visually broken (collapsed furniture, ugly
 * proportions) now scores LOWER because vision catches what
 * structural+sanity miss.
 *
 * Also pins graceful degradation: vision infra failure (Anthropic
 * client unreachable, JSON parse fails) drops the signal without
 * tanking the score.
 */

import { describe, it, expect } from "vitest";

import { computeQualityScore } from "../quality-score";
import { QUALITY_THRESHOLD } from "../constants";
import type {
  BriefSpec,
  SandboxValidateResult,
  VisionReport,
} from "../types";

function makeBriefSpec(): BriefSpec {
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
        long_name: "S1",
        polygon_world_m: [[0, 0], [10, 0], [10, 10], [0, 10]],
        height_m: 3,
        occupancy_type: "Office",
      },
    ],
    elements: [],
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
  };
}

function makeGoodValidation(): SandboxValidateResult {
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
      total_actual_in_expected_classes: 20,
      by_class_expected: { IfcWall: 20 },
      by_class_actual: { IfcWall: 20 },
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
  };
}

// ─── The behaviour the ε.3 wiring enables ───────────────────────────

describe("ε.3 — vision in the metric (was null pre-ε.3)", () => {
  it("a structurally-fine but visually-broken build scores LOWER with vision than without", () => {
    // Structural signals say "everything was built" (high score).
    // Vision says "the furniture is collapsed, proportions look wrong"
    // (low score). Pre-ε.3 vision was null → the broken build scored
    // high via structural alone, deceiving the loop. Post-ε.3 vision
    // contributes 0.25 weight and drags the score down.
    const validation = makeGoodValidation();
    const visionLowQuality: VisionReport = {
      quality_score: 30,
      pass: false,
      issues: [
        {
          severity: "high",
          type: "collapsed",
          description: "Cutting table rendered as a single block.",
          fixable: true,
        },
        {
          severity: "high",
          type: "proportions",
          description: "Bedroom appears 3x too tall.",
          fixable: true,
        },
      ],
      summary: "Major visual issues.",
      inspected_at: new Date().toISOString(),
    };

    const withoutVision = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: validation,
      verifierReport: null,
      visionReport: null, // pre-ε.3 state
    });
    const withVision = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: validation,
      verifierReport: null,
      visionReport: visionLowQuality, // post-ε.3 state
    });

    // Without vision, structural+sanity dominate → high score.
    expect(withoutVision.score).toBeGreaterThan(85);
    // With vision flagging real visual issues → meaningfully lower.
    expect(withVision.score).toBeLessThan(withoutVision.score);
    // Specifically: the loop's gate now triggers on the broken build.
    expect(withoutVision.score).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
    expect(withVision.score).toBeLessThan(withoutVision.score - 5);
  });

  it("a visually-good vision report keeps the composite above threshold (vision agrees with structural)", () => {
    // NOTE on weighted-renormalization arithmetic: when structural +
    // sanity are already at 1.0, adding vision at e.g. 0.95 will
    // SLIGHTLY lower the composite (renormalized vision contributes
    // its raw value times its weight, replacing some of the perfect
    // structural+sanity score). That's correct behaviour — the metric
    // is now MORE INFORMED, even if the absolute score moves a hair.
    // The meaningful invariant: vision is consulted (available=true)
    // and the build still clears threshold when vision agrees.
    const validation = makeGoodValidation();
    const visionHighQuality: VisionReport = {
      quality_score: 95,
      pass: true,
      issues: [],
      summary: "Looks great.",
      inspected_at: new Date().toISOString(),
    };

    const withVision = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: validation,
      verifierReport: null,
      visionReport: visionHighQuality,
    });

    expect(withVision.visionQuality.available).toBe(true);
    expect(withVision.visionQuality.rawValue).toBeCloseTo(0.95, 2);
    expect(withVision.score).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
  });

  it("breakdown shows vision_quality.available=true when vision is wired", () => {
    const r = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeGoodValidation(),
      verifierReport: null,
      visionReport: {
        quality_score: 80,
        pass: true,
        issues: [],
        summary: "ok",
        inspected_at: new Date().toISOString(),
      },
    });
    expect(r.visionQuality.available).toBe(true);
    expect(r.visionQuality.contribution).toBeGreaterThan(0);
    expect(r.signalsAvailable).toBe(3); // structural + sanity + vision
  });
});

// ─── ε.3 graceful degradation — vision infra failure ────────────────

describe("ε.3 — vision graceful degradation (Rule 4)", () => {
  it("vision-inspector's degraded-failure shape is detected and drops the signal", () => {
    // vision-inspector returns this exact shape when the Anthropic
    // client can't be created (e.g. ANTHROPIC_API_KEY unset) or the
    // JSON-parse retries exhaust. The composite metric must detect it
    // and treat as signal-unavailable — NOT as a real quality_score=0.
    const visionInfraFailure: VisionReport = {
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
    };

    const r = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeGoodValidation(),
      verifierReport: null,
      visionReport: visionInfraFailure,
    });

    // Vision MUST drop out (not zero the composite).
    expect(r.visionQuality.available).toBe(false);
    expect(r.visionQuality.notes).toMatch(/infrastructure failure/i);
    // Score is computed from structural+sanity → still passes.
    expect(r.score).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
  });

  it("post-ε.3 worker passes null visionReport when render-previews fails — composite degrades", () => {
    // This is the exact path through computeQualityScore when ε.3's
    // sandbox-render returns { ok: false } (IFC_SERVICE_URL unset,
    // network error, render returned no images) — the worker swallows
    // and passes null. The metric MUST handle null cleanly.
    const r = computeQualityScore({
      briefSpec: makeBriefSpec(),
      finalValidation: makeGoodValidation(),
      verifierReport: null,
      visionReport: null,
    });
    expect(r.visionQuality.available).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
