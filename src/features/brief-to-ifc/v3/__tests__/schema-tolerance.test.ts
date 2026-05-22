/**
 * Phase δ.1a — schema tolerance regression tests.
 *
 * Asserts that briefSpecSchema:
 *   • COERCES recoverable malformed Opus output (wrong RGB scale,
 *     near-miss enum strings, missing optional components, numeric
 *     strings, junk-but-typed values) instead of rejecting the spec
 *   • RECORDS every coercion into the active coercion context
 *     (visible via `withCoercionCollection`) so telemetry can observe
 *     the recovery rate
 *   • STILL fails loudly for genuinely broken specs — missing
 *     required sections, structurally invalid input
 *
 * The guardrail (Rule 5): tolerance recovers field-level deviations.
 * It does NOT mean accept garbage. Missing project / site / elements /
 * materials must still fail with INVALID_BRIEF_SPEC.
 */

import { describe, it, expect } from "vitest";

import {
  briefMaterialSchema,
  briefProjectSchema,
  briefSiteSchema,
  briefSpecSchema,
} from "../types";
import { withCoercionCollection } from "../telemetry";

/** Minimal valid spec — used as the base; tests perturb one field. */
function makeValidSpec() {
  return {
    project: {
      name: "Test Project",
      type: "office",
      location: "Test City",
      description: "Test description",
    },
    site: {
      bounds_m: [10, 10],
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    },
    spaces: [],
    elements: [],
    materials: [
      {
        id: "mat-test",
        name: "Test Material",
        rgb: [0.5, 0.5, 0.5],
        roughness: 0.5,
        method: "MATT",
        category: "test",
      },
    ],
  };
}

describe("project.type — tolerantEnum", () => {
  it("accepts canonical values verbatim", () => {
    const r = briefProjectSchema.safeParse({
      name: "X", type: "office", location: "Y", description: "Z",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("office");
  });

  it("coerces known synonym 'co-working' to 'office'", () => {
    const { result, coercions } = withCoercionCollection(() =>
      briefProjectSchema.safeParse({
        name: "X", type: "co-working", location: "Y", description: "Z",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("office");
    expect(coercions.some((c) => c.kind === "enum_normalized")).toBe(true);
  });

  it("coerces unknown 'space_station' to fallback 'other'", () => {
    const { result, coercions } = withCoercionCollection(() =>
      briefProjectSchema.safeParse({
        name: "X", type: "space_station", location: "Y", description: "Z",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("other");
    expect(coercions.some((c) => c.kind === "enum_fallback")).toBe(true);
  });

  it("coerces 'apartment' to 'residential'", () => {
    const r = briefProjectSchema.safeParse({
      name: "X", type: "apartment", location: "Y", description: "Z",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("residential");
  });
});

describe("site.coordinate_origin — tolerantEnum (single canonical value)", () => {
  it("accepts 'sw_corner' verbatim", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
  });

  it("coerces 'SW_CORNER' to 'sw_corner'", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: 100,
      coordinate_origin: "SW_CORNER",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coordinate_origin).toBe("sw_corner");
  });

  it("coerces 'origin' synonym to 'sw_corner'", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: 100,
      coordinate_origin: "origin",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coordinate_origin).toBe("sw_corner");
  });

  it("falls back to 'sw_corner' for unknown junk", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: 100,
      coordinate_origin: "centre_of_universe",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coordinate_origin).toBe("sw_corner");
  });
});

describe("site.bounds_m — tolerantBoundsTuple", () => {
  it("accepts [w, d] verbatim", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [15, 20],
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bounds_m).toEqual([15, 20]);
  });

  it("drops Z from 3-element input", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [15, 20, 5],
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bounds_m).toEqual([15, 20]);
  });

  it("falls back when input is junk (not an array)", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: "not an array",
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Falls back to default width/depth (10, 10) per types.ts config.
      expect(r.data.bounds_m[0]).toBeGreaterThan(0);
      expect(r.data.bounds_m[1]).toBeGreaterThan(0);
    }
  });

  it("coerces negative components to fallback", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [-5, -10],
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bounds_m[0]).toBeGreaterThan(0);
      expect(r.data.bounds_m[1]).toBeGreaterThan(0);
    }
  });
});

describe("site.height_limit_m — tolerantPositive with acceptZero", () => {
  it("preserves 0 as 'uncapped' sentinel", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: 0,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.height_limit_m).toBe(0);
  });

  it("falls back on negative", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: -50,
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.height_limit_m).toBeGreaterThanOrEqual(0);
  });

  it("coerces numeric string '50' to 50", () => {
    const r = briefSiteSchema.safeParse({
      bounds_m: [10, 10],
      height_limit_m: "50",
      coordinate_origin: "sw_corner",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.height_limit_m).toBe(50);
  });
});

describe("materials[].rgb — tolerantRgb", () => {
  it("accepts [r,g,b] in [0,1] verbatim", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.1, 0.2, 0.3],
      roughness: 0.5, method: "MATT", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rgb).toEqual([0.1, 0.2, 0.3]);
  });

  it("rescales [128, 128, 128] (0-255 scale) to [0.5, 0.5, 0.5]", () => {
    const { result, coercions } = withCoercionCollection(() =>
      briefMaterialSchema.safeParse({
        id: "m1", name: "M", rgb: [128, 128, 128],
        roughness: 0.5, method: "MATT", category: "x",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rgb[0]).toBeCloseTo(128 / 255, 5);
      expect(result.data.rgb[1]).toBeCloseTo(128 / 255, 5);
      expect(result.data.rgb[2]).toBeCloseTo(128 / 255, 5);
    }
    expect(coercions.some((c) => c.kind === "rgb_rescaled_255")).toBe(true);
  });

  it("truncates RGBA to RGB", () => {
    const { result, coercions } = withCoercionCollection(() =>
      briefMaterialSchema.safeParse({
        id: "m1", name: "M", rgb: [0.3, 0.4, 0.5, 0.8],
        roughness: 0.5, method: "MATT", category: "x",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rgb).toEqual([0.3, 0.4, 0.5]);
    expect(coercions.some((c) => c.kind === "rgb_truncated")).toBe(true);
  });

  it("pads missing component to gray", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.3, 0.4],
      roughness: 0.5, method: "MATT", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rgb.length).toBe(3);
  });

  it("falls back to gray for non-array junk", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: "rgb(128, 128, 128)",
      roughness: 0.5, method: "MATT", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rgb).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("materials[].method — tolerantEnum with synonyms", () => {
  it("coerces lowercase 'matte' to 'MATT'", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: 0.5, method: "matte", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.method).toBe("MATT");
  });

  it("coerces 'wood' synonym to 'MATT'", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: 0.5, method: "wood", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.method).toBe("MATT");
  });

  it("coerces 'metallic' to 'METAL'", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: 0.5, method: "metallic", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.method).toBe("METAL");
  });

  it("falls back unknown method to 'MATT'", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: 0.5, method: "iridescent_chrome_xyz", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.method).toBe("MATT");
  });
});

describe("materials[].roughness — tolerantPositive clamped to [0,1]", () => {
  it("clamps 1.5 to 1.0", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: 1.5, method: "MATT", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.roughness).toBe(1);
  });

  it("preserves 0", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: 0, method: "MATT", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.roughness).toBe(0);
  });

  it("falls back NaN/junk to 0.5", () => {
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [0.5, 0.5, 0.5],
      roughness: "very rough", method: "MATT", category: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.roughness).toBe(0.5);
  });
});

describe("briefSpecSchema — coercion records visible across the full spec", () => {
  it("records multiple coercions for a single malformed spec", () => {
    const spec = makeValidSpec();
    spec.project.type = "coworking";              // → office
    spec.site.coordinate_origin = "SW_CORNER";    // → sw_corner
    spec.materials[0].rgb = [200, 200, 200];      // → rescale 0-255
    spec.materials[0].method = "metallic";        // → METAL

    const { result, coercions } = withCoercionCollection(() =>
      briefSpecSchema.safeParse(spec),
    );
    expect(result.success).toBe(true);
    // Expect at least 4 coercions: enum*2 + rgb_rescaled_255 + enum
    expect(coercions.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── GUARDRAIL: core sections still fail loudly ──────────────────────

describe("briefSpecSchema — loud-failure guardrail", () => {
  it("REJECTS a spec missing the project section", () => {
    const spec = makeValidSpec() as Record<string, unknown>;
    delete spec.project;
    const r = briefSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it("REJECTS a spec missing the site section", () => {
    const spec = makeValidSpec() as Record<string, unknown>;
    delete spec.site;
    const r = briefSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it("REJECTS a spec missing the elements array", () => {
    const spec = makeValidSpec() as Record<string, unknown>;
    delete spec.elements;
    const r = briefSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it("REJECTS a spec missing the materials array", () => {
    const spec = makeValidSpec() as Record<string, unknown>;
    delete spec.materials;
    const r = briefSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it("REJECTS a spec with empty materials (min(1) enforced)", () => {
    const spec = makeValidSpec();
    spec.materials = [];
    const r = briefSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it("REJECTS a spec where the whole input is not an object", () => {
    const r = briefSpecSchema.safeParse("not a spec");
    expect(r.success).toBe(false);
  });
});

describe("withCoercionCollection — outside the context, recordCoercion is a no-op", () => {
  it("schema parses fine with no active context; coercions are not collected", () => {
    // Direct parse outside withCoercionCollection — should not throw.
    const r = briefMaterialSchema.safeParse({
      id: "m1", name: "M", rgb: [128, 128, 128],
      roughness: 0.5, method: "matte", category: "x",
    });
    expect(r.success).toBe(true);
  });
});
