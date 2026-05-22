/**
 * Phase δ.1b — element-type expansion regression.
 *
 * Previously, briefElementSchema.type was an 11-value enum that
 * REJECTED `stair`, `roof`, `balcony`, `canopy`, `parapet`, `railing`
 * — the agent's own system prompt names these architectural types as
 * valid, so Opus emitted them and the schema silently dropped the
 * containing spec at Layer 1. After δ.1b the enum carries all of them
 * (geometry-less ones still proxy-fallback in buildflow_ifc.py with a
 * telemetered event so δ.4 can prioritise real implementations).
 */

import { describe, it, expect } from "vitest";

import {
  ELEMENT_TYPE_VALUES,
  briefElementSchema,
  briefSpecSchema,
} from "../types";
import { withCoercionCollection } from "../telemetry";

function makeElement(type: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `el-${type}`,
    type,
    origin_world_m: [0, 0, 0],
    material_id: "mat-x",
    ...overrides,
  };
}

function makeSpecWithElement(type: string) {
  return {
    project: { name: "X", type: "residential", location: "Y", description: "Z" },
    site: {
      bounds_m: [10, 10],
      height_limit_m: 100,
      coordinate_origin: "sw_corner",
    },
    spaces: [],
    elements: [
      {
        id: `el-${type}`,
        type,
        origin_world_m: [0, 0, 0],
        material_id: "mat-x",
      },
    ],
    materials: [
      {
        id: "mat-x",
        name: "X",
        rgb: [0.5, 0.5, 0.5],
        roughness: 0.5,
        method: "MATT",
        category: "x",
      },
    ],
  };
}

describe("ELEMENT_TYPE_VALUES — new architectural types are present", () => {
  it.each([
    ["stair"],
    ["roof"],
    ["balcony"],
    ["canopy"],
    ["parapet"],
    ["railing"],
  ])("ELEMENT_TYPE_VALUES contains %s", (type) => {
    expect(ELEMENT_TYPE_VALUES).toContain(type);
  });
});

describe("briefElementSchema — each new type validates", () => {
  it.each([
    ["stair"],
    ["roof"],
    ["balcony"],
    ["canopy"],
    ["parapet"],
    ["railing"],
  ])("type=%s is accepted (was silently rejected pre-δ.1b)", (type) => {
    const r = briefElementSchema.safeParse(makeElement(type));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe(type);
  });
});

describe("briefElementSchema — synonyms coerce to the new canonical types", () => {
  it("'stairway' coerces to 'stair'", () => {
    const r = briefElementSchema.safeParse(makeElement("stairway"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("stair");
  });

  it("'staircase' coerces to 'stair'", () => {
    const r = briefElementSchema.safeParse(makeElement("staircase"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("stair");
  });

  it("'terrace' coerces to 'balcony'", () => {
    const r = briefElementSchema.safeParse(makeElement("terrace"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("balcony");
  });

  it("'handrail' coerces to 'railing'", () => {
    const r = briefElementSchema.safeParse(makeElement("handrail"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("railing");
  });

  it("'awning' coerces to 'canopy'", () => {
    const r = briefElementSchema.safeParse(makeElement("awning"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("canopy");
  });

  it("unknown 'helipad' falls back to 'proxy' (not rejected)", () => {
    const r = briefElementSchema.safeParse(makeElement("helipad"));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("proxy");
  });
});

describe("briefSpecSchema — full specs with new element types validate", () => {
  it("multi-storey villa spec with stair + balcony validates end-to-end", () => {
    const spec = {
      project: { name: "Villa", type: "residential", location: "X", description: "2-storey villa" },
      site: { bounds_m: [20, 15], height_limit_m: 12, coordinate_origin: "sw_corner" },
      spaces: [],
      elements: [
        { id: "wall-1", type: "wall", origin_world_m: [0, 0, 0], material_id: "mat-x" },
        { id: "stair-1", type: "stair", origin_world_m: [5, 5, 0], material_id: "mat-x" },
        { id: "balcony-1", type: "balcony", origin_world_m: [10, 0, 3], material_id: "mat-x" },
        { id: "railing-1", type: "railing", origin_world_m: [10, 0, 4], material_id: "mat-x" },
      ],
      materials: [
        { id: "mat-x", name: "X", rgb: [0.5, 0.5, 0.5], roughness: 0.5, method: "MATT", category: "x" },
      ],
    };
    const r = briefSpecSchema.safeParse(spec);
    expect(r.success).toBe(true);
    if (r.success) {
      const types = r.data.elements.map((e) => e.type);
      expect(types).toContain("stair");
      expect(types).toContain("balcony");
      expect(types).toContain("railing");
    }
  });

  it("a spec full of synonyms still validates (and records every coercion)", () => {
    const spec = makeSpecWithElement("stairway");
    spec.elements.push({
      id: "el-handrail",
      type: "handrail",
      origin_world_m: [0, 0, 0],
      material_id: "mat-x",
    });
    spec.elements.push({
      id: "el-terrace",
      type: "terrace",
      origin_world_m: [0, 0, 0],
      material_id: "mat-x",
    });
    const { result, coercions } = withCoercionCollection(() =>
      briefSpecSchema.safeParse(spec),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const types = result.data.elements.map((e) => e.type);
      expect(types).toContain("stair");
      expect(types).toContain("railing");
      expect(types).toContain("balcony");
    }
    // Each synonym coercion records an enum_normalized event.
    const enumNormalized = coercions.filter(
      (c) => c.kind === "enum_normalized",
    );
    expect(enumNormalized.length).toBeGreaterThanOrEqual(3);
  });
});
