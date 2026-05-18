/**
 * Pitch validation regression tests.
 *
 * Reproduces production failure in execution 3o4c390v6x41 where
 * Opus emitted pitch_x_m=0 for a single-instance cutting table,
 * causing INVALID_BRIEF_SPEC at TR-025 Brief Enricher.
 */

import { describe, it, expect } from "vitest";
import { briefFurnitureSchema, furnitureLayoutSchema } from "../types";

// Helper to build a minimal furniture item
function makeFurniture(overrides: Record<string, unknown> = {}) {
  return {
    id: "FURN-TABLE",
    type: "cutting_table",
    count: 1,
    material_id: "mat-oak",
    description: "Oak cutting table",
    ...overrides,
  };
}

describe("pitch_x_m / pitch_y_m validation (hotfix)", () => {
  it("single-instance furniture with pitch_x_m=0 passes validation", () => {
    const item = makeFurniture({
      count: 1,
      layout: { kind: "explicit", pitch_x_m: 0, pitch_y_m: 0 },
    });
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("single-instance furniture with no layout field passes validation", () => {
    const item = makeFurniture({ count: 1 });
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("multi-instance grid furniture (count=3) with pitch_x_m=0.5 passes", () => {
    const item = makeFurniture({
      count: 3,
      layout: { kind: "grid", rows: 1, cols: 3, pitch_x_m: 0.5, pitch_y_m: 0 },
    });
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("multi-instance grid furniture (count=3) with pitch_x_m=0 and pitch_y_m=0 FAILS", () => {
    const item = makeFurniture({
      count: 3,
      layout: { kind: "grid", rows: 1, cols: 3, pitch_x_m: 0, pitch_y_m: 0 },
    });
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map(i => i.message).join("; ");
      expect(msg).toContain("pitch_x_m > 0 OR pitch_y_m > 0");
    }
  });

  it("single-instance furniture with pitch_x_m=-1 fails (negative rejected)", () => {
    const item = makeFurniture({
      count: 1,
      layout: { kind: "explicit", pitch_x_m: -1 },
    });
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  it("reproduces exact production failure: tailor cutting table with pitch=0", () => {
    // This is the exact shape Opus emitted in execution 3o4c390v6x41
    const item = {
      id: "FURN-CUTTABLE",
      type: "cutting_table",
      count: 1,
      layout: {
        kind: "explicit" as const,
        pitch_x_m: 0,
        pitch_y_m: 0,
      },
      anchor_space_id: "sp-workshop",
      bounding_box: [2.2, 0.9, 0.9] as [number, number, number],
      material_id: "mat-oak",
      description: "Oak cutting table 2.2m × 0.9m against north wall with green felt top",
    };
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("multi-instance explicit layout (count=3) with pitch=0 passes (explicit, not grid)", () => {
    // Explicit layout doesn't use pitch for spacing — only grid does
    const item = makeFurniture({
      count: 3,
      layout: { kind: "explicit", pitch_x_m: 0, pitch_y_m: 0 },
    });
    const result = briefFurnitureSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("layout schema standalone: pitch_x_m=0 is valid", () => {
    const layout = { kind: "explicit", pitch_x_m: 0 };
    const result = furnitureLayoutSchema.safeParse(layout);
    expect(result.success).toBe(true);
  });
});
