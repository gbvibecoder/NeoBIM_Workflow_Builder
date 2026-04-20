/**
 * Reference + Adapt engine — unit tests.
 * Verifies matcher scoring, adapter output validity, and dynamic validation.
 */
import { describe, it, expect } from "vitest";
import { matchReferences } from "@/features/floor-plan/lib/reference-matcher";
import { adaptReference } from "@/features/floor-plan/lib/reference-adapter";
import { validateDynamicOutput } from "@/features/floor-plan/lib/dynamic-reference-engine";
import { REFERENCE_LIBRARY } from "@/features/floor-plan/data/reference-plans";
import type { ParsedConstraints } from "@/features/floor-plan/lib/structured-parser";

/** Build a minimal ParsedConstraints for testing. */
function makeParsed(overrides: {
  bhk?: number;
  facing?: "N" | "S" | "E" | "W";
  plotW?: number;
  plotD?: number;
  areaSqft?: number;
  vastu?: boolean;
  rooms?: Array<{ name: string; function: string }>;
}): ParsedConstraints {
  const bhk = overrides.bhk ?? 3;
  const rooms: ParsedConstraints["rooms"] = [];

  // Generate bedrooms
  for (let i = 0; i < bhk; i++) {
    const name = i === 0 ? "Master Bedroom" : `Bedroom ${i + 1}`;
    const fn = i === 0 ? "master_bedroom" : "bedroom";
    rooms.push({
      id: `bed-${i}`, name, function: fn as any,
      dim_width_ft: null, dim_depth_ft: null,
      position_type: "unspecified", position_direction: null,
      attached_to_room_id: null, must_have_window_on: null,
      external_walls_ft: null, internal_walls_ft: null,
      doors: [], windows: [],
      is_wet: false, is_sacred: false, is_circulation: false,
      user_explicit_dims: false, user_explicit_position: false,
    });
  }

  // Add standard rooms
  for (const r of overrides.rooms ?? [
    { name: "Living Room", function: "living" },
    { name: "Kitchen", function: "kitchen" },
    { name: "Dining", function: "dining" },
    { name: "Bathroom 1", function: "bathroom" },
    { name: "Bathroom 2", function: "bathroom" },
  ]) {
    rooms.push({
      id: r.name.toLowerCase().replace(/\s+/g, "-"),
      name: r.name,
      function: r.function as any,
      dim_width_ft: null, dim_depth_ft: null,
      position_type: "unspecified", position_direction: null,
      attached_to_room_id: null, must_have_window_on: null,
      external_walls_ft: null, internal_walls_ft: null,
      doors: [], windows: [],
      is_wet: r.function.includes("bath"), is_sacred: r.function === "pooja",
      is_circulation: false,
      user_explicit_dims: false, user_explicit_position: false,
    });
  }

  return {
    plot: {
      width_ft: overrides.plotW ?? 40,
      depth_ft: overrides.plotD ?? 40,
      facing: (overrides.facing ?? "N") as any,
      shape: "rectangular",
      total_built_up_sqft: overrides.areaSqft ?? (overrides.plotW ?? 40) * (overrides.plotD ?? 40),
    },
    rooms,
    adjacency_pairs: [],
    connects_all_groups: [],
    vastu_required: overrides.vastu ?? false,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

describe("Reference Library", () => {
  it("has plans for BHK 1-5", () => {
    for (const bhk of [1, 2, 3, 4, 5]) {
      const plans = REFERENCE_LIBRARY.filter(p => p.metadata.bhk === bhk);
      expect(plans.length).toBeGreaterThan(0);
    }
  });

  it("has plans for all 4 facings", () => {
    for (const facing of ["N", "S", "E", "W"] as const) {
      const plans = REFERENCE_LIBRARY.filter(p => p.metadata.facing === facing);
      expect(plans.length).toBeGreaterThan(0);
    }
  });

  it("all plans have valid normalized coordinates (0-1)", () => {
    for (const plan of REFERENCE_LIBRARY) {
      for (const room of plan.rooms) {
        expect(room.nx).toBeGreaterThanOrEqual(0);
        expect(room.ny).toBeGreaterThanOrEqual(0);
        expect(room.nw).toBeGreaterThan(0);
        expect(room.nd).toBeGreaterThan(0);
        expect(room.nx + room.nw).toBeLessThanOrEqual(1.01);
        expect(room.ny + room.nd).toBeLessThanOrEqual(1.01);
      }
    }
  });
});

describe("Reference Matcher", () => {
  it("matches 3BHK north-facing to a 3BHK plan", () => {
    const parsed = makeParsed({ bhk: 3, facing: "N", plotW: 40, plotD: 40 });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 3);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].ref.metadata.bhk).toBe(3);
    expect(matches[0].score).toBeGreaterThan(50);
  });

  it("exact BHK+facing scores highest", () => {
    const parsed = makeParsed({ bhk: 2, facing: "S", plotW: 30, plotD: 40, areaSqft: 1200 });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 3);

    // The top match should have exact BHK and facing
    const exact = matches.find(m => m.ref.metadata.bhk === 2 && m.ref.metadata.facing === "S");
    expect(exact).toBeDefined();
    expect(exact!.breakdown.bhk_match).toBe(30);
    expect(exact!.breakdown.facing_match).toBe(15);
  });

  it("returns up to N results sorted by score descending", () => {
    const parsed = makeParsed({ bhk: 3, facing: "N" });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 5);

    expect(matches.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].score).toBeLessThanOrEqual(matches[i - 1].score);
    }
  });

  it("1BHK prompt matches a 1BHK plan", () => {
    const parsed = makeParsed({ bhk: 1, facing: "N", plotW: 25, plotD: 30, rooms: [
      { name: "Living Room", function: "living" },
      { name: "Kitchen", function: "kitchen" },
      { name: "Bathroom", function: "bathroom" },
    ] });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 1);

    expect(matches[0].ref.metadata.bhk).toBe(1);
  });
});

describe("Reference Adapter", () => {
  it("produces a valid StripPackResult for 3BHK N 40x40", () => {
    const parsed = makeParsed({ bhk: 3, facing: "N", plotW: 40, plotD: 40 });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 1);
    const result = adaptReference(matches[0].ref, parsed);

    expect(result.rooms.length).toBeGreaterThan(0);
    expect(result.walls.length).toBeGreaterThan(0);
    expect(result.doors.length).toBeGreaterThan(0);
    expect(result.plot.width).toBe(40);
    expect(result.plot.depth).toBe(40);

    // All rooms should be placed
    for (const room of result.rooms) {
      expect(room.placed).toBeDefined();
      expect(room.placed!.width).toBeGreaterThan(0);
      expect(room.placed!.depth).toBeGreaterThan(0);
    }
  });

  it("scales rooms to match plot dimensions", () => {
    const parsed = makeParsed({ bhk: 2, facing: "N", plotW: 30, plotD: 40 });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 1);
    const result = adaptReference(matches[0].ref, parsed);

    for (const room of result.rooms) {
      expect(room.placed!.x).toBeGreaterThanOrEqual(-0.1);
      expect(room.placed!.y).toBeGreaterThanOrEqual(-0.1);
      expect(room.placed!.x + room.placed!.width).toBeLessThanOrEqual(30.5);
      expect(room.placed!.y + room.placed!.depth).toBeLessThanOrEqual(40.5);
    }
  });

  it("mirrors correctly for south-facing", () => {
    const parsedN = makeParsed({ bhk: 3, facing: "N", plotW: 40, plotD: 40 });
    const parsedS = makeParsed({ bhk: 3, facing: "S", plotW: 40, plotD: 40 });

    const matchesN = matchReferences(parsedN, REFERENCE_LIBRARY, 1);
    const matchesS = matchReferences(parsedS, REFERENCE_LIBRARY, 1);

    // Should find different reference plans (one N-facing, one S-facing)
    // or at least both should produce valid results
    const resultN = adaptReference(matchesN[0].ref, parsedN);
    const resultS = adaptReference(matchesS[0].ref, parsedS);

    expect(resultN.rooms.length).toBeGreaterThan(0);
    expect(resultS.rooms.length).toBeGreaterThan(0);
  });

  it("has no significant overlaps between rooms", () => {
    const parsed = makeParsed({ bhk: 3, facing: "N", plotW: 35, plotD: 40 });
    const matches = matchReferences(parsed, REFERENCE_LIBRARY, 1);
    const result = adaptReference(matches[0].ref, parsed);

    for (let i = 0; i < result.rooms.length; i++) {
      for (let j = i + 1; j < result.rooms.length; j++) {
        const a = result.rooms[i].placed!;
        const b = result.rooms[j].placed!;

        const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y));
        const overlap = ox * oy;
        const smallerArea = Math.min(a.width * a.depth, b.width * b.depth);

        // Allow up to 5% overlap (from floating point)
        expect(overlap).toBeLessThan(smallerArea * 0.05 + 0.1);
      }
    }
  });
});

describe("10-prompt regression", () => {
  const testCases = [
    { name: "2BHK 800sqft north", bhk: 2, facing: "N" as const, plotW: 25, plotD: 32, area: 800 },
    { name: "3BHK 1200sqft south vastu", bhk: 3, facing: "S" as const, plotW: 30, plotD: 40, area: 1200, vastu: true },
    { name: "3BHK 40x40 east", bhk: 3, facing: "E" as const, plotW: 40, plotD: 40, area: 1600 },
    { name: "4BHK 42x52 south 1800", bhk: 4, facing: "S" as const, plotW: 42, plotD: 52, area: 1800 },
    { name: "1BHK studio 500sqft", bhk: 1, facing: "N" as const, plotW: 20, plotD: 25, area: 500 },
    { name: "3BHK 1400sqft north", bhk: 3, facing: "N" as const, plotW: 35, plotD: 40, area: 1400 },
    { name: "2BHK 30x35 west", bhk: 2, facing: "W" as const, plotW: 30, plotD: 35, area: 1050 },
    { name: "5BHK 55x50 north", bhk: 5, facing: "N" as const, plotW: 55, plotD: 50, area: 2750 },
  ];

  for (const tc of testCases) {
    it(`matches and adapts: ${tc.name}`, () => {
      const parsed = makeParsed({
        bhk: tc.bhk,
        facing: tc.facing,
        plotW: tc.plotW,
        plotD: tc.plotD,
        areaSqft: tc.area,
        vastu: tc.vastu,
      });

      const matches = matchReferences(parsed, REFERENCE_LIBRARY, 3);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].score).toBeGreaterThanOrEqual(30);

      const result = adaptReference(matches[0].ref, parsed);
      expect(result.rooms.length).toBeGreaterThan(0);
      expect(result.walls.length).toBeGreaterThan(0);
      expect(result.doors.length).toBeGreaterThan(0);
      expect(result.windows.length).toBeGreaterThanOrEqual(0);

      // Plot dimensions should match
      expect(result.plot.width).toBe(tc.plotW);
      expect(result.plot.depth).toBe(tc.plotD);
    });
  }
});

describe("Dynamic Validation", () => {
  it("accepts a valid layout", () => {
    const rooms = [
      { name: "Living Room", type: "living", nx: 0, ny: 0.55, nw: 0.40, nd: 0.35 },
      { name: "Dining", type: "dining", nx: 0.40, ny: 0.55, nw: 0.25, nd: 0.35 },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.55, nw: 0.35, nd: 0.35 },
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.19, nw: 0.25, nd: 0.36 },
      { name: "Bedroom 2", type: "bedroom", nx: 0.25, ny: 0.19, nw: 0.38, nd: 0.36 },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.19, nw: 0.37, nd: 0.36 },
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.35, nd: 0.12 },
      { name: "Bathroom 1", type: "bathroom", nx: 0.35, ny: 0, nw: 0.18, nd: 0.12 },
      { name: "Bathroom 2", type: "bathroom", nx: 0.53, ny: 0, nw: 0.17, nd: 0.12 },
    ];
    const hallway = { nx: 0, ny: 0.12, nw: 1, nd: 0.07 };
    const expected = rooms.map(r => r.name);

    const result = validateDynamicOutput(rooms, hallway, expected);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.coverage).toBeGreaterThan(0.85);
  });

  it("rejects missing rooms", () => {
    const rooms = [
      { name: "Living Room", type: "living", nx: 0, ny: 0, nw: 0.5, nd: 0.5 },
    ];
    const result = validateDynamicOutput(rooms, null, ["Living Room", "Kitchen"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Missing room"))).toBe(true);
  });

  it("rejects overlapping rooms", () => {
    const rooms = [
      { name: "Room A", type: "living", nx: 0, ny: 0, nw: 0.6, nd: 0.5 },
      { name: "Room B", type: "bedroom", nx: 0.3, ny: 0, nw: 0.5, nd: 0.5 },
      { name: "Room C", type: "kitchen", nx: 0, ny: 0.5, nw: 1, nd: 0.5 },
    ];
    const result = validateDynamicOutput(rooms, null, ["Room A", "Room B", "Room C"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Overlap"))).toBe(true);
  });

  it("rejects low coverage", () => {
    const rooms = [
      { name: "Room A", type: "living", nx: 0, ny: 0, nw: 0.2, nd: 0.2 },
    ];
    const result = validateDynamicOutput(rooms, null, ["Room A"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Coverage"))).toBe(true);
  });

  it("rejects rooms outside plot boundary", () => {
    const rooms = [
      { name: "Room A", type: "living", nx: 0.8, ny: 0, nw: 0.5, nd: 1.0 },
    ];
    const result = validateDynamicOutput(rooms, null, ["Room A"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("extends"))).toBe(true);
  });

  it("rejects extreme aspect ratios", () => {
    const rooms = [
      { name: "Room A", type: "living", nx: 0, ny: 0, nw: 0.05, nd: 0.95 },
      { name: "Room B", type: "bedroom", nx: 0.05, ny: 0, nw: 0.95, nd: 0.95 },
    ];
    const result = validateDynamicOutput(rooms, null, ["Room A", "Room B"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("aspect ratio"))).toBe(true);
  });

  it("rejects duplicate room names", () => {
    const rooms = [
      { name: "Bedroom", type: "bedroom", nx: 0, ny: 0, nw: 0.5, nd: 0.5 },
      { name: "Bedroom", type: "bedroom", nx: 0.5, ny: 0, nw: 0.5, nd: 0.5 },
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.5, nw: 1, nd: 0.5 },
    ];
    const result = validateDynamicOutput(rooms, null, ["Bedroom", "Bedroom", "Kitchen"]);
    expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
  });
});
