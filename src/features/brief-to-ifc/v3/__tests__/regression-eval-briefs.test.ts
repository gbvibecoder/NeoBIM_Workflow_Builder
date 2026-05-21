/**
 * Phase ε.4 — regression eval briefs.
 *
 * The eval harness (src/features/brief-to-ifc/v3/evals/run.ts) is a
 * CLI runner that actually invokes the Anthropic agent + Railway
 * sandbox per brief — too expensive and side-effecting to run in CI.
 *
 * This vitest test sits ABOVE the CLI harness as a static regression
 * gate: every brief in evals/briefs/ must:
 *   1. parse cleanly against briefSpecSchema (so a malformed brief
 *      can't sneak into the eval set)
 *   2. exercise the right element types for its named purpose (so a
 *      well-meaning refactor can't strip the stair/roof/balcony out
 *      of the villa brief and leave the eval green by mistake)
 *
 * Each ε.4 brief is paired with an assertion about which element
 * types it MUST contain — the regression gate that catches "we
 * accidentally removed the roof from the villa brief and now don't
 * exercise add_roof end-to-end".
 */

import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { briefSpecSchema } from "../types";

const BRIEFS_DIR = path.join(
  __dirname,
  "..",
  "evals",
  "briefs",
);

function loadBrief(filename: string) {
  const raw = fs.readFileSync(
    path.join(BRIEFS_DIR, filename),
    "utf-8",
  );
  return briefSpecSchema.safeParse(JSON.parse(raw));
}

function elementTypes(parsed: ReturnType<typeof loadBrief>): string[] {
  if (!parsed.success) return [];
  return parsed.data.elements.map((e) => e.type);
}

// ─── Every brief must parse cleanly against briefSpecSchema ──────────

describe("ε.4 eval briefs — schema validation", () => {
  const allBriefs = fs
    .readdirSync(BRIEFS_DIR)
    .filter((f) => f.endsWith(".json"));

  it.each(allBriefs)("%s parses against briefSpecSchema", (filename) => {
    const result = loadBrief(filename);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n  ");
      throw new Error(
        `Brief ${filename} failed to parse:\n  ${issues}`,
      );
    }
    expect(result.success).toBe(true);
  });
});

// ─── ε.4 briefs — exercise the right geometry methods ────────────────

describe("ε.4 two-storey-villa.json — δ.4 + ε.1 acceptance brief", () => {
  it("exercises stair, balcony, roof, parapet (the four ε.1+δ.4 builders)", () => {
    const result = loadBrief("two-storey-villa.json");
    expect(result.success).toBe(true);
    const types = elementTypes(result);
    expect(types).toContain("stair");
    expect(types).toContain("balcony");
    expect(types).toContain("roof");
    expect(types).toContain("parapet");
  });

  it("declares both ground and first floor spaces (multi-storey)", () => {
    const result = loadBrief("two-storey-villa.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.spaces.length).toBeGreaterThanOrEqual(2);
  });

  it("has at least one door (entrance) and window", () => {
    const result = loadBrief("two-storey-villa.json");
    const types = elementTypes(result);
    expect(types).toContain("door");
    expect(types).toContain("window");
  });
});

describe("ε.4 boutique-hotel-8r.json — scale + repetition + multi-storey", () => {
  it("exercises 'hotel' project type (was enum-only, never tested live)", () => {
    const result = loadBrief("boutique-hotel-8r.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.project.type).toBe("hotel");
  });

  it("declares multiple guest-room spaces on both floors (repetition)", () => {
    const result = loadBrief("boutique-hotel-8r.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    // 2 corridors + 8 guest rooms = 10 spaces
    expect(result.data.spaces.length).toBeGreaterThanOrEqual(8);
    const guestRoomCount = result.data.spaces.filter(
      (s) => s.occupancy_type === "Guest Room",
    ).length;
    expect(guestRoomCount).toBeGreaterThanOrEqual(4);
  });

  it("exercises stair (multi-storey circulation) + roof + parapet", () => {
    const result = loadBrief("boutique-hotel-8r.json");
    const types = elementTypes(result);
    expect(types).toContain("stair");
    expect(types).toContain("roof");
    expect(types).toContain("parapet");
  });
});

describe("ε.4 warehouse-30x60.json — unusual aspect ratio + scale", () => {
  it("exercises 'warehouse' project type (was enum-only, never tested live)", () => {
    const result = loadBrief("warehouse-30x60.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.project.type).toBe("warehouse");
  });

  it("has 2:1 long-aspect site bounds (60x30m) — exercises bbox extent gates", () => {
    const result = loadBrief("warehouse-30x60.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [w, d] = result.data.site.bounds_m;
    expect(w).toBeGreaterThanOrEqual(50);
    expect(d).toBeLessThanOrEqual(40);
    expect(w / d).toBeGreaterThan(1.5);
  });

  it("exercises roof (large flat-roof span)", () => {
    const result = loadBrief("warehouse-30x60.json");
    const types = elementTypes(result);
    expect(types).toContain("roof");
  });
});

describe("ε.4 small-clinic.json — room subdivision + 'hospital' enum", () => {
  it("exercises 'hospital' project type (was enum-only, never tested live)", () => {
    const result = loadBrief("small-clinic.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.project.type).toBe("hospital");
  });

  it("subdivides into multiple typed spaces (reception, consult x3, lab, restroom)", () => {
    const result = loadBrief("small-clinic.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.spaces.length).toBeGreaterThanOrEqual(6);
    const occupancies = new Set(
      result.data.spaces.map((s) => s.occupancy_type),
    );
    expect(occupancies.size).toBeGreaterThanOrEqual(4);
  });

  it("exercises room subdivision via interior partition walls", () => {
    const result = loadBrief("small-clinic.json");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const partitions = result.data.elements.filter(
      (e) => e.type === "wall" && e.object_type === "Partition",
    );
    expect(partitions.length).toBeGreaterThanOrEqual(4);
  });

  it("exercises roof on a healthcare brief", () => {
    const result = loadBrief("small-clinic.json");
    const types = elementTypes(result);
    expect(types).toContain("roof");
  });
});

// ─── Coverage roll-up: every ε.1/δ.4 element type is exercised by SOME brief ─

describe("ε.4 coverage roll-up — every new element type is exercised by SOME brief", () => {
  function unionElementTypes(): Set<string> {
    const all = fs
      .readdirSync(BRIEFS_DIR)
      .filter((f) => f.endsWith(".json"));
    const types = new Set<string>();
    for (const f of all) {
      const r = loadBrief(f);
      if (r.success) for (const e of r.data.elements) types.add(e.type);
    }
    return types;
  }

  it.each([
    ["stair", "δ.4 add_stair"],
    ["roof", "ε.1 add_roof"],
    ["balcony", "ε.1 add_balcony"],
    ["parapet", "ε.1 add_parapet"],
  ])("at least one brief contains a %s element (covers %s)", (type) => {
    const union = unionElementTypes();
    expect(union.has(type)).toBe(true);
  });
});
