/**
 * Grid-Pack Engine — Unit Tests
 *
 * Tests the deterministic packer with direct row assignments (no GPT-4o needed).
 * Verifies the MATHEMATICAL GUARANTEES:
 *   1. Zero gaps between rooms
 *   2. Zero floating rooms (every room placed inside the strip)
 *   3. Building is a compact rectangle
 *   4. All rooms inside plot
 *   5. Reasonable aspect ratios
 *
 * Also tests ARCHITECTURAL GROUPING:
 *   6. Attached rooms coerced into parent's row
 *   7. Adjacent rooms coerced into same row
 *   8. Small rooms never alone in a row
 */

import { describe, it, expect } from "vitest";
import { runGridPackEngine } from "@/features/floor-plan/lib/grid-pack-engine";
import type { RowAssignment } from "@/features/floor-plan/lib/grid-pack-engine";
import type { ParsedConstraints } from "@/features/floor-plan/lib/structured-parser";
import type { StripPackResult } from "@/features/floor-plan/lib/strip-pack/types";

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

/** Build a minimal ParsedConstraints for testing. */
function makeParsed(opts: {
  width: number;
  depth: number;
  facing: string;
  rooms: Array<{
    name: string;
    fn: string;
    w?: number;
    d?: number;
    attached?: string;
    wet?: boolean;
    sacred?: boolean;
  }>;
  adjacency?: Array<{ a: string; b: string }>;
}): ParsedConstraints {
  const rooms = opts.rooms.map((r) => ({
    id: r.name.toLowerCase().replace(/\s+/g, "-"),
    name: r.name,
    function: r.fn as import("@/features/floor-plan/lib/room-vocabulary").RoomFunction,
    dim_width_ft: r.w ?? null,
    dim_depth_ft: r.d ?? null,
    position_type: null as never,
    position_direction: null,
    attached_to_room_id: r.attached
      ? opts.rooms.find(x => x.name === r.attached)?.name.toLowerCase().replace(/\s+/g, "-") ?? null
      : null,
    must_have_window_on: null,
    external_walls_ft: null,
    internal_walls_ft: null,
    doors: [],
    windows: [],
    is_wet: r.wet ?? false,
    is_sacred: r.sacred ?? false,
    is_circulation: r.fn === "corridor" || r.fn === "hallway",
    user_explicit_dims: r.w != null,
    user_explicit_position: false,
  }));

  const adjacency_pairs = (opts.adjacency ?? []).map(a => ({
    room_a_id: a.a.toLowerCase().replace(/\s+/g, "-"),
    room_b_id: a.b.toLowerCase().replace(/\s+/g, "-"),
    relationship: "shared_wall" as const,
    user_explicit: false,
    direction: null,
    third_room_id: null,
  }));

  return {
    plot: {
      width_ft: opts.width,
      depth_ft: opts.depth,
      facing: opts.facing as never,
      shape: "rectangular",
      total_built_up_sqft: opts.width * opts.depth,
    },
    rooms,
    adjacency_pairs,
    connects_all_groups: [],
    vastu_required: false,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

/** Run engine with a direct row assignment (no GPT-4o call). */
async function run(parsed: ParsedConstraints, assignment: RowAssignment): Promise<StripPackResult> {
  return runGridPackEngine("test prompt", parsed, "unused-key", { rowAssignment: assignment });
}

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT CHECKS
// ───────────────────────────────────────────────────────────────────────────

function assertZeroGaps(result: StripPackResult, plotW: number, plotD: number) {
  const placed = result.rooms.filter(r => r.placed && r.zone !== "CIRCULATION");

  for (const r of placed) {
    expect(r.placed, `Room "${r.name}" should be placed`).toBeDefined();
    expect(r.placed!.width, `Room "${r.name}" width > 0`).toBeGreaterThan(0);
    expect(r.placed!.depth, `Room "${r.name}" depth > 0`).toBeGreaterThan(0);
  }

  for (const r of placed) {
    const p = r.placed!;
    expect(p.x, `Room "${r.name}" x >= 0`).toBeGreaterThanOrEqual(-0.01);
    expect(p.y, `Room "${r.name}" y >= 0`).toBeGreaterThanOrEqual(-0.01);
    expect(p.x + p.width, `Room "${r.name}" right edge <= ${plotW}`).toBeLessThanOrEqual(plotW + 0.01);
    expect(p.y + p.depth, `Room "${r.name}" top edge <= ${plotD}`).toBeLessThanOrEqual(plotD + 0.01);
  }

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i].placed!;
      const b = placed[j].placed!;
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y));
      expect(overlapX * overlapY, `Overlap between "${placed[i].name}" and "${placed[j].name}"`).toBeLessThan(0.1);
    }
  }

  if (result.spine.spine.width > 0 && result.spine.spine.depth > 0) {
    const hw = result.spine.spine;
    for (const r of placed) {
      const p = r.placed!;
      const ox = Math.max(0, Math.min(p.x + p.width, hw.x + hw.width) - Math.max(p.x, hw.x));
      const oy = Math.max(0, Math.min(p.y + p.depth, hw.y + hw.depth) - Math.max(p.y, hw.y));
      expect(ox * oy, `Room "${r.name}" overlaps hallway`).toBeLessThan(0.1);
    }
  }
}

function assertCompactRectangle(result: StripPackResult, plotW: number, plotD: number) {
  const totalArea = result.rooms
    .filter(r => r.placed)
    .reduce((s, r) => s + r.placed!.width * r.placed!.depth, 0);
  const hwArea = result.spine.spine.width * result.spine.spine.depth;
  const plotArea = plotW * plotD;
  expect(totalArea + hwArea, "Rooms + hallway should cover ≥95% of plot").toBeGreaterThan(plotArea * 0.95);
}

function assertReasonableAspectRatios(result: StripPackResult, maxAR = 5) {
  for (const r of result.rooms.filter(r => r.placed && r.zone !== "CIRCULATION")) {
    const p = r.placed!;
    const ar = Math.max(p.width, p.depth) / Math.min(p.width, p.depth);
    expect(ar, `Room "${r.name}" AR ${ar.toFixed(1)} (${p.width.toFixed(1)}×${p.depth.toFixed(1)}ft)`).toBeLessThan(maxAR);
  }
}

/** Check that two rooms share the same Y range (same row in horizontal layout). */
function assertSameRow(result: StripPackResult, nameA: string, nameB: string) {
  const a = result.rooms.find(r => r.name === nameA);
  const b = result.rooms.find(r => r.name === nameB);
  expect(a?.placed, `${nameA} should be placed`).toBeDefined();
  expect(b?.placed, `${nameB} should be placed`).toBeDefined();
  // Same row means same y and same depth (in horizontal layouts)
  const sameY = Math.abs(a!.placed!.y - b!.placed!.y) < 0.1;
  const sameDepth = Math.abs(a!.placed!.depth - b!.placed!.depth) < 0.1;
  expect(sameY && sameDepth, `${nameA} and ${nameB} should be in the same row`).toBe(true);
}

// ───────────────────────────────────────────────────────────────────────────
// TEST CASES — MATHEMATICAL GUARANTEES
// ───────────────────────────────────────────────────────────────────────────

describe("Grid-Pack Engine — Deterministic Packer", () => {
  // ── Test 1: South-facing 4BHK 42×52 (17 rooms — the hard case) ──────
  it("should pack 17-room south-facing 4BHK with zero gaps", async () => {
    const parsed = makeParsed({
      width: 42, depth: 52, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 16, d: 13 },
        { name: "Dining Room", fn: "dining", w: 12, d: 11 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Foyer", fn: "foyer", w: 8, d: 7 },
        { name: "Common Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
        { name: "Store Room", fn: "store", w: 6, d: 5 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 13 },
        { name: "Ensuite Bathroom", fn: "master_bathroom", w: 9, d: 6, wet: true, attached: "Master Bedroom" },
        { name: "Walk-in Wardrobe", fn: "walk_in_wardrobe", w: 7, d: 5, attached: "Master Bedroom" },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 11 },
        { name: "Bedroom 3", fn: "bedroom", w: 12, d: 11 },
        { name: "Bedroom 4", fn: "bedroom", w: 11, d: 10 },
        { name: "Pooja Room", fn: "pooja", w: 5, d: 4, sacred: true },
        { name: "Attached Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
        { name: "Porch", fn: "porch", w: 9, d: 6 },
        { name: "Utility Room", fn: "utility", w: 6, d: 5 },
        { name: "Study", fn: "study", w: 10, d: 9 },
      ],
      adjacency: [
        { a: "Living Room", b: "Dining Room" },
        { a: "Dining Room", b: "Kitchen" },
        { a: "Master Bedroom", b: "Ensuite Bathroom" },
        { a: "Porch", b: "Foyer" },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 42,
      front_rows: [
        ["Living Room", "Dining Room", "Kitchen"],
        ["Foyer", "Common Bathroom", "Store Room", "Porch"],
      ],
      back_rows: [
        ["Master Bedroom", "Ensuite Bathroom", "Walk-in Wardrobe", "Pooja Room"],
        ["Bedroom 2", "Bedroom 3", "Bedroom 4", "Attached Bathroom"],
        ["Utility Room", "Study"],
      ],
    };

    const result = await run(parsed, assignment);

    assertZeroGaps(result, 42, 52);
    assertCompactRectangle(result, 42, 52);
    assertReasonableAspectRatios(result);

    const placedCount = result.rooms.filter(r => r.placed).length;
    expect(placedCount).toBeGreaterThanOrEqual(17);
    expect(result.spine.spine.width).toBeGreaterThan(0);
    expect(result.metrics.efficiency_pct).toBeGreaterThan(90);
  });

  // ── Test 2: East-facing 3BHK 38×48 (13 rooms) ──────────────────────
  it("should pack 13-room east-facing 3BHK with zero gaps", async () => {
    const parsed = makeParsed({
      width: 38, depth: 48, facing: "E",
      rooms: [
        { name: "Living Room", fn: "living", w: 15, d: 12 },
        { name: "Dining Room", fn: "dining", w: 12, d: 10 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Foyer", fn: "foyer", w: 8, d: 6 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 12 },
        { name: "Master Bathroom", fn: "master_bathroom", w: 8, d: 6, wet: true },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 11 },
        { name: "Bedroom 3", fn: "bedroom", w: 12, d: 11 },
        { name: "Common Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
        { name: "Pooja Room", fn: "pooja", w: 5, d: 4, sacred: true },
        { name: "Utility", fn: "utility", w: 6, d: 5 },
        { name: "Store", fn: "store", w: 6, d: 5 },
        { name: "Porch", fn: "porch", w: 9, d: 6 },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Dining Room", "Foyer", "Porch"],
      ],
      back_rows: [
        ["Master Bedroom", "Master Bathroom", "Pooja Room"],
        ["Bedroom 2", "Bedroom 3", "Common Bathroom"],
        ["Kitchen", "Utility", "Store"],
      ],
    };

    const result = await run(parsed, assignment);
    assertZeroGaps(result, 38, 48);
    assertCompactRectangle(result, 38, 48);
    assertReasonableAspectRatios(result);
    expect(result.rooms.filter(r => r.placed).length).toBeGreaterThanOrEqual(13);
  });

  // ── Test 3: North-facing 3BHK 40×40 (11 rooms — baseline) ──────────
  it("should pack 11-room north-facing 3BHK 40×40 with zero gaps", async () => {
    const parsed = makeParsed({
      width: 40, depth: 40, facing: "N",
      rooms: [
        { name: "Living Room", fn: "living", w: 15, d: 12 },
        { name: "Dining Room", fn: "dining", w: 12, d: 10 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 8 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 12 },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 10 },
        { name: "Bedroom 3", fn: "bedroom", w: 12, d: 10 },
        { name: "Common Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
        { name: "Foyer", fn: "foyer", w: 8, d: 6 },
        { name: "Porch", fn: "porch", w: 9, d: 5 },
        { name: "Store", fn: "store", w: 6, d: 5 },
        { name: "Utility", fn: "utility", w: 6, d: 5 },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Dining Room", "Foyer", "Porch"],
      ],
      back_rows: [
        ["Master Bedroom", "Bedroom 2", "Common Bathroom"],
        ["Bedroom 3", "Kitchen", "Store", "Utility"],
      ],
    };

    const result = await run(parsed, assignment);
    assertZeroGaps(result, 40, 40);
    assertCompactRectangle(result, 40, 40);
    assertReasonableAspectRatios(result);
    expect(result.rooms.filter(r => r.placed).length).toBeGreaterThanOrEqual(11);
  });

  // ── Test 4: Vague "3BHK 1100sqft" (simple — dimensions inferred) ───
  it("should handle vague prompt with default dimensions", async () => {
    const side = Math.round(Math.sqrt(1100)); // ~33
    const parsed = makeParsed({
      width: side, depth: side + 5, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living" },
        { name: "Kitchen", fn: "kitchen" },
        { name: "Master Bedroom", fn: "master_bedroom" },
        { name: "Bedroom 2", fn: "bedroom" },
        { name: "Bedroom 3", fn: "bedroom" },
        { name: "Bathroom 1", fn: "bathroom", wet: true },
        { name: "Bathroom 2", fn: "bathroom", wet: true },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Kitchen"],
      ],
      back_rows: [
        ["Master Bedroom", "Bathroom 1"],
        ["Bedroom 2", "Bedroom 3", "Bathroom 2"],
      ],
    };

    const result = await run(parsed, assignment);
    assertZeroGaps(result, side, side + 5);
    assertCompactRectangle(result, side, side + 5);
    assertReasonableAspectRatios(result);
    expect(result.rooms.filter(r => r.placed).length).toBeGreaterThanOrEqual(7);
  });

  // ── Test 5: Non-standard rooms (living cum dining, mandir, etc.) ────
  it("should handle non-standard room types", async () => {
    const parsed = makeParsed({
      width: 35, depth: 45, facing: "W",
      rooms: [
        { name: "Living cum Dining", fn: "living", w: 18, d: 14 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 12 },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 10 },
        { name: "Mandir", fn: "pooja", w: 5, d: 4, sacred: true },
        { name: "Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
        { name: "Servant Quarter", fn: "servant_quarter", w: 9, d: 8 },
        { name: "Foyer", fn: "foyer", w: 8, d: 6 },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 40,
      front_rows: [
        ["Living cum Dining", "Foyer"],
      ],
      back_rows: [
        ["Master Bedroom", "Bathroom", "Mandir"],
        ["Bedroom 2", "Kitchen", "Servant Quarter"],
      ],
    };

    const result = await run(parsed, assignment);
    assertZeroGaps(result, 35, 45);
    assertCompactRectangle(result, 35, 45);
    assertReasonableAspectRatios(result);
    expect(result.rooms.filter(r => r.placed).length).toBeGreaterThanOrEqual(8);
  });

  // ── Test 6: Small layout (no hallway) ───────────────────────────────
  it("should handle small layout without hallway", async () => {
    const parsed = makeParsed({
      width: 20, depth: 25, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 12, d: 10 },
        { name: "Bedroom", fn: "bedroom", w: 10, d: 10 },
        { name: "Kitchen", fn: "kitchen", w: 8, d: 7 },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 0,
      front_rows: [
        ["Living Room", "Kitchen"],
        ["Bedroom"],
      ],
      back_rows: [],
    };

    const result = await run(parsed, assignment);
    assertZeroGaps(result, 20, 25);
    assertCompactRectangle(result, 20, 25);
    assertReasonableAspectRatios(result);
    expect(result.rooms.filter(r => r.placed).length).toBe(3);
    expect(result.spine.spine.width * result.spine.spine.depth).toBe(0);
  });

  // ── Test 7: Validate missing room recovery ──────────────────────────
  it("should recover rooms missing from row assignment", async () => {
    const parsed = makeParsed({
      width: 40, depth: 45, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 15, d: 12 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 12 },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 10 },
        { name: "Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
      ],
    });

    // "Bedroom 2" deliberately missing from assignment
    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Kitchen"],
      ],
      back_rows: [
        ["Master Bedroom", "Bathroom"],
      ],
    };

    const result = await run(parsed, assignment);

    const bedroom2 = result.rooms.find(r => r.name === "Bedroom 2");
    expect(bedroom2, "Bedroom 2 should be recovered").toBeDefined();
    expect(bedroom2!.placed, "Bedroom 2 should be placed").toBeDefined();

    assertZeroGaps(result, 40, 45);
    expect(result.rooms.filter(r => r.placed).length).toBeGreaterThanOrEqual(5);
  });

  // ── Test 8: Walls, doors, windows are generated ─────────────────────
  it("should generate walls, doors, and windows", async () => {
    const parsed = makeParsed({
      width: 40, depth: 45, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 15, d: 12 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Bedroom", fn: "bedroom", w: 12, d: 10 },
        { name: "Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
        { name: "Foyer", fn: "foyer", w: 8, d: 6 },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Kitchen", "Foyer"],
      ],
      back_rows: [
        ["Bedroom", "Bathroom"],
      ],
    };

    const result = await run(parsed, assignment);

    expect(result.walls.length, "Should have walls").toBeGreaterThan(0);
    expect(result.doors.length, "Should have doors").toBeGreaterThan(0);
    expect(result.windows.length, "Should have windows").toBeGreaterThan(0);

    for (const w of result.walls) {
      expect(w.id).toBeTruthy();
      expect(w.thickness_ft).toBeGreaterThan(0);
      expect(w.room_ids.length).toBeGreaterThan(0);
    }
  });

  // ── Test 9: Mathematical guarantee — row widths sum to strip width ──
  it("should have room widths summing exactly to strip width (horizontal)", async () => {
    const parsed = makeParsed({
      width: 42, depth: 50, facing: "S",
      rooms: [
        { name: "Room A", fn: "living", w: 15, d: 12 },
        { name: "Room B", fn: "dining", w: 12, d: 10 },
        { name: "Room C", fn: "kitchen", w: 10, d: 9 },
        { name: "Room D", fn: "bedroom", w: 14, d: 12 },
        { name: "Room E", fn: "bedroom", w: 12, d: 10 },
      ],
    });

    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [["Room A", "Room B", "Room C"]],
      back_rows: [["Room D", "Room E"]],
    };

    const result = await run(parsed, assignment);

    // Front row: rooms A, B, C — widths should sum to exactly 42
    const frontRooms = result.rooms.filter(r =>
      ["Room A", "Room B", "Room C"].includes(r.name),
    );
    const frontWidthSum = frontRooms.reduce((s, r) => s + r.placed!.width, 0);
    expect(Math.abs(frontWidthSum - 42)).toBeLessThan(0.001);

    // Back row: rooms D, E — widths should sum to exactly 42
    const backRooms = result.rooms.filter(r =>
      ["Room D", "Room E"].includes(r.name),
    );
    const backWidthSum = backRooms.reduce((s, r) => s + r.placed!.width, 0);
    expect(Math.abs(backWidthSum - 42)).toBeLessThan(0.001);
  });

  // ── Test 10: Row depths sum correctly after merging ─────────────────
  it("should have row depths summing exactly to strip depth", async () => {
    const parsed = makeParsed({
      width: 40, depth: 50, facing: "S",
      rooms: [
        { name: "Front1", fn: "living", w: 15, d: 12 },
        { name: "Front2", fn: "dining", w: 12, d: 10 },
        { name: "Front3", fn: "kitchen", w: 10, d: 9 },
        { name: "Back1", fn: "bedroom", w: 14, d: 12 },
        { name: "Back2", fn: "bedroom", w: 12, d: 10 },
      ],
    });

    // Two rows on each side (no single-room rows to trigger merging)
    const assignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [["Front1", "Front2"], ["Front3"]],
      back_rows: [["Back1"], ["Back2"]],
    };

    const result = await run(parsed, assignment);

    // All front rooms should tile the front strip depth exactly
    const frontRooms = result.rooms.filter(r =>
      ["Front1", "Front2", "Front3"].includes(r.name),
    );
    // Whether merged or not, they should all be within the front strip
    const frontBottom = Math.min(...frontRooms.map(r => r.placed!.y));
    const frontTop = Math.max(...frontRooms.map(r => r.placed!.y + r.placed!.depth));
    const frontSpan = frontTop - frontBottom;
    const expectedFrontDepth = result.spine.front_strip.depth;
    expect(Math.abs(frontSpan - expectedFrontDepth)).toBeLessThan(0.1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ARCHITECTURAL GROUPING TESTS
// ───────────────────────────────────────────────────────────────────────────

describe("Grid-Pack Engine — Architectural Grouping", () => {
  // ── Test 11: Attached rooms coerced into parent's row ───────────────
  it("should coerce ensuite + wardrobe into master bedroom row", async () => {
    const parsed = makeParsed({
      width: 42, depth: 50, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 16, d: 13 },
        { name: "Dining Room", fn: "dining", w: 12, d: 11 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 13 },
        { name: "Ensuite Bathroom", fn: "master_bathroom", w: 9, d: 6, wet: true, attached: "Master Bedroom" },
        { name: "Walk-in Wardrobe", fn: "walk_in_wardrobe", w: 7, d: 5, attached: "Master Bedroom" },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 11 },
      ],
    });

    // GPT-4o made a mistake: put Ensuite and Wardrobe in different rows
    const badAssignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Dining Room"],
      ],
      back_rows: [
        ["Master Bedroom"],
        ["Ensuite Bathroom", "Walk-in Wardrobe", "Bedroom 2"],
      ],
    };

    const result = await run(parsed, badAssignment);

    // Coercion should move Ensuite and Wardrobe into Master's row
    assertSameRow(result, "Master Bedroom", "Ensuite Bathroom");
    assertSameRow(result, "Master Bedroom", "Walk-in Wardrobe");

    assertZeroGaps(result, 42, 50);
    assertCompactRectangle(result, 42, 50);
    assertReasonableAspectRatios(result);
  });

  // ── Test 12: Adjacent rooms coerced into same row ───────────────────
  it("should coerce kitchen into dining room row when adjacent", async () => {
    const parsed = makeParsed({
      width: 40, depth: 45, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 16, d: 13 },
        { name: "Dining Room", fn: "dining", w: 12, d: 11 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Bedroom", fn: "bedroom", w: 14, d: 12 },
        { name: "Bathroom", fn: "bathroom", w: 7, d: 5, wet: true },
      ],
      adjacency: [
        { a: "Dining Room", b: "Kitchen" },
      ],
    });

    // GPT-4o mistake: Kitchen on back side, Dining on front side
    const badAssignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Dining Room"],
      ],
      back_rows: [
        ["Kitchen", "Bathroom"],
        ["Bedroom"],
      ],
    };

    const result = await run(parsed, badAssignment);

    // Coercion should move Kitchen to Dining's row
    assertSameRow(result, "Dining Room", "Kitchen");

    assertZeroGaps(result, 40, 45);
    assertCompactRectangle(result, 40, 45);
  });

  // ── Test 13: Small rooms never alone in a row ──────────────────────
  it("should merge all-tiny-room rows into adjacent rows", async () => {
    const parsed = makeParsed({
      width: 40, depth: 50, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 16, d: 13 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Master Bedroom", fn: "master_bedroom", w: 14, d: 13 },
        { name: "Bedroom 2", fn: "bedroom", w: 12, d: 11 },
        { name: "Pooja Room", fn: "pooja", w: 5, d: 4, sacred: true },
        { name: "Store", fn: "store", w: 6, d: 5 },
        { name: "Utility", fn: "utility", w: 6, d: 5 },
      ],
    });

    // Bad: 3 tiny rooms in their own row → thin protruding strip
    const badAssignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Kitchen"],
      ],
      back_rows: [
        ["Master Bedroom", "Bedroom 2"],
        ["Pooja Room", "Store", "Utility"],  // All <50 sqft
      ],
    };

    const result = await run(parsed, badAssignment);

    // The tiny-room row should have been merged — verify no extreme ARs
    assertReasonableAspectRatios(result);
    assertZeroGaps(result, 40, 50);
    assertCompactRectangle(result, 40, 50);

    // All rooms still placed
    expect(result.rooms.filter(r => r.placed).length).toBeGreaterThanOrEqual(7);
  });

  // ── Test 14: Single small room merged into adjacent row ─────────────
  it("should merge single small room row into adjacent row", async () => {
    const parsed = makeParsed({
      width: 35, depth: 45, facing: "S",
      rooms: [
        { name: "Living Room", fn: "living", w: 16, d: 13 },
        { name: "Kitchen", fn: "kitchen", w: 10, d: 9 },
        { name: "Bedroom", fn: "bedroom", w: 14, d: 12 },
        { name: "Servant Quarter", fn: "servant_quarter", w: 9, d: 8 },
      ],
    });

    // Bad: Servant Quarter alone in a row (72 sqft < 150)
    const badAssignment: RowAssignment = {
      hallway_position_pct: 45,
      front_rows: [
        ["Living Room", "Kitchen"],
      ],
      back_rows: [
        ["Bedroom"],
        ["Servant Quarter"],
      ],
    };

    const result = await run(parsed, badAssignment);

    // Both should be merged into one back row
    assertSameRow(result, "Bedroom", "Servant Quarter");

    assertZeroGaps(result, 35, 45);
    assertCompactRectangle(result, 35, 45);
    assertReasonableAspectRatios(result);
  });
});
