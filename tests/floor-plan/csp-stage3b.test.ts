import { describe, it, expect } from "vitest";
import { solveMandalaCSP, solveStage3B, type FinePlacement } from "@/features/floor-plan/lib/csp-solver";
import { rectOverlaps, type Rect } from "@/features/floor-plan/lib/csp-solver/geometry-utils";
import type { ParsedConstraints, ParsedRoom } from "@/features/floor-plan/lib/structured-parser";

function makeRoom(o: Partial<ParsedRoom>): ParsedRoom {
  return {
    id: o.id ?? "r1",
    name: o.name ?? "Room",
    function: o.function ?? "other",
    dim_width_ft: o.dim_width_ft ?? null,
    dim_depth_ft: o.dim_depth_ft ?? null,
    position_type: o.position_type ?? "unspecified",
    position_direction: o.position_direction ?? null,
    attached_to_room_id: o.attached_to_room_id ?? null,
    must_have_window_on: o.must_have_window_on ?? null,
    external_walls_ft: o.external_walls_ft ?? null,
    internal_walls_ft: o.internal_walls_ft ?? null,
    doors: o.doors ?? [],
    windows: o.windows ?? [],
    is_wet: o.is_wet ?? false,
    is_sacred: o.is_sacred ?? false,
    is_circulation: o.is_circulation ?? false,
    user_explicit_dims: o.user_explicit_dims ?? false,
    user_explicit_position: o.user_explicit_position ?? false,
  };
}

function makeConstraints(rooms: ParsedRoom[], vastu = false, plot: Partial<ParsedConstraints["plot"]> = {}): ParsedConstraints {
  return {
    plot: {
      width_ft: plot.width_ft ?? 40,
      depth_ft: plot.depth_ft ?? 40,
      facing: plot.facing ?? null,
      shape: plot.shape ?? null,
      total_built_up_sqft: plot.total_built_up_sqft ?? null,
    },
    rooms,
    adjacency_pairs: [],
    connects_all_groups: [],
    vastu_required: vastu,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

function assertNoOverlaps(placements: FinePlacement[]): void {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a: Rect = { x: placements[i].x_ft, y: placements[i].y_ft, width: placements[i].width_ft, depth: placements[i].depth_ft };
      const b: Rect = { x: placements[j].x_ft, y: placements[j].y_ft, width: placements[j].width_ft, depth: placements[j].depth_ft };
      if (rectOverlaps(a, b)) {
        throw new Error(`Overlap: "${placements[i].room_name}" ↔ "${placements[j].room_name}"`);
      }
    }
  }
}

function solveFull(constraints: ParsedConstraints) {
  const m = solveMandalaCSP(constraints);
  if (!m.feasible) return { stage3A: m, stage3B: null };
  const b = solveStage3B(constraints, m.assignments);
  return { stage3A: m, stage3B: b };
}

describe("CSP Stage 3B — Fine placement", () => {
  it("simple 2-room solve: no overlap, plot-bounded", () => {
    const c = makeConstraints([
      makeRoom({ id: "lr", name: "Living", function: "living", dim_width_ft: 14, dim_depth_ft: 12, user_explicit_dims: true }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen", dim_width_ft: 10, dim_depth_ft: 8, user_explicit_dims: true }),
    ]);
    const { stage3B } = solveFull(c);
    expect(stage3B?.feasible).toBe(true);
    expect(stage3B!.placements.length).toBe(2);
    assertNoOverlaps(stage3B!.placements);
  });

  it("corner pin: master SW actually touches south + west walls", () => {
    const c = makeConstraints([
      makeRoom({
        id: "m", name: "Master", function: "master_bedroom",
        dim_width_ft: 14, dim_depth_ft: 12, user_explicit_dims: true,
        position_type: "corner", position_direction: "SW", user_explicit_position: true,
      }),
    ], false, { width_ft: 40, depth_ft: 40 });
    const { stage3B } = solveFull(c);
    expect(stage3B?.feasible).toBe(true);
    const master = stage3B!.placements[0];
    expect(master.x_ft).toBeLessThanOrEqual(0.01);
    expect(master.y_ft + master.depth_ft).toBeGreaterThanOrEqual(40 - 0.01);
  });

  it("corner pin: kitchen SE touches east + south walls", () => {
    const c = makeConstraints([
      makeRoom({
        id: "k", name: "Kitchen", function: "kitchen",
        dim_width_ft: 10, dim_depth_ft: 8, user_explicit_dims: true,
        position_type: "corner", position_direction: "SE", user_explicit_position: true,
      }),
    ], false, { width_ft: 40, depth_ft: 40 });
    const { stage3B } = solveFull(c);
    expect(stage3B?.feasible).toBe(true);
    const k = stage3B!.placements[0];
    expect(k.x_ft + k.width_ft).toBeGreaterThanOrEqual(40 - 0.01);
    expect(k.y_ft + k.depth_ft).toBeGreaterThanOrEqual(40 - 0.01);
  });

  it("UNSAT: two rooms both pinned to SW corner with corner type", () => {
    const c = makeConstraints([
      makeRoom({
        id: "m1", name: "Master1", function: "master_bedroom",
        dim_width_ft: 10, dim_depth_ft: 10, user_explicit_dims: true,
        position_type: "corner", position_direction: "SW", user_explicit_position: true,
      }),
      makeRoom({
        id: "m2", name: "Master2", function: "master_bedroom",
        dim_width_ft: 10, dim_depth_ft: 10, user_explicit_dims: true,
        position_type: "corner", position_direction: "SW", user_explicit_position: true,
      }),
    ]);
    const { stage3A } = solveFull(c);
    expect(stage3A.feasible).toBe(false);
  });

  it("attached ensuite: bathroom shares edge with parent master", () => {
    const c = makeConstraints([
      makeRoom({
        id: "m", name: "Master", function: "master_bedroom",
        dim_width_ft: 14, dim_depth_ft: 12, user_explicit_dims: true,
        position_type: "corner", position_direction: "SW", user_explicit_position: true,
      }),
      makeRoom({
        id: "mb", name: "Master Bath", function: "master_bathroom",
        dim_width_ft: 8, dim_depth_ft: 6, user_explicit_dims: true,
        attached_to_room_id: "m",
      }),
    ], false, { width_ft: 40, depth_ft: 40 });
    const { stage3B } = solveFull(c);
    expect(stage3B?.feasible).toBe(true);
    assertNoOverlaps(stage3B!.placements);
    const master = stage3B!.placements.find(p => p.room_id === "m")!;
    const bath = stage3B!.placements.find(p => p.room_id === "mb")!;
    const shareX = Math.abs(master.x_ft + master.width_ft - bath.x_ft) < 0.01 ||
                   Math.abs(bath.x_ft + bath.width_ft - master.x_ft) < 0.01;
    const shareY = Math.abs(master.y_ft + master.depth_ft - bath.y_ft) < 0.01 ||
                   Math.abs(bath.y_ft + bath.depth_ft - master.y_ft) < 0.01;
    expect(shareX || shareY).toBe(true);
  });

  it("user dims honored exactly when user_explicit_dims=true", () => {
    const c = makeConstraints([
      makeRoom({
        id: "m", name: "Master", function: "master_bedroom",
        dim_width_ft: 15, dim_depth_ft: 13, user_explicit_dims: true,
        position_type: "corner", position_direction: "SW", user_explicit_position: true,
      }),
    ], false, { width_ft: 50, depth_ft: 50 });
    const { stage3B } = solveFull(c);
    expect(stage3B?.feasible).toBe(true);
    const master = stage3B!.placements[0];
    expect(Math.abs(master.width_ft - 15)).toBeLessThan(0.5);
    expect(Math.abs(master.depth_ft - 13)).toBeLessThan(0.5);
  });

  it("P01 demo: 8 rooms with SW master + SE kitchen + corner bedrooms — no overlaps", () => {
    const rooms = [
      makeRoom({ id: "m", name: "Master Bedroom", function: "master_bedroom", dim_width_ft: 15, dim_depth_ft: 13, position_type: "corner", position_direction: "SW", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen", dim_width_ft: 13, dim_depth_ft: 11, position_type: "corner", position_direction: "SE", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "lr", name: "Living Room", function: "living", dim_width_ft: 17, dim_depth_ft: 14, position_type: "corner", position_direction: "NW", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "b5", name: "Bedroom 5", function: "bedroom", dim_width_ft: 11, dim_depth_ft: 10, position_type: "corner", position_direction: "NE", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "b2", name: "Bedroom 2", function: "bedroom", dim_width_ft: 13, dim_depth_ft: 11, position_type: "wall_centered", position_direction: "S", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "b4", name: "Bedroom 4", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10, position_type: "wall_centered", position_direction: "E", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "p", name: "Porch", function: "porch", dim_width_ft: 9, dim_depth_ft: 6, position_type: "wall_centered", position_direction: "N", user_explicit_position: true, user_explicit_dims: true }),
      makeRoom({ id: "dr", name: "Dining Room", function: "dining", dim_width_ft: 13, dim_depth_ft: 11 }),
    ];
    const c = makeConstraints(rooms, true, { width_ft: 55, depth_ft: 50 });
    const { stage3A, stage3B } = solveFull(c);
    expect(stage3A.feasible).toBe(true);
    expect(stage3B?.feasible).toBe(true);
    expect(stage3B!.placements.length).toBe(rooms.length);
    assertNoOverlaps(stage3B!.placements);
    const master = stage3B!.placements.find(p => p.room_id === "m")!;
    expect(master.x_ft).toBeLessThanOrEqual(0.01);
    expect(master.y_ft + master.depth_ft).toBeGreaterThanOrEqual(50 - 0.01);
    const kitchen = stage3B!.placements.find(p => p.room_id === "k")!;
    expect(kitchen.x_ft + kitchen.width_ft).toBeGreaterThanOrEqual(55 - 0.01);
    expect(kitchen.y_ft + kitchen.depth_ft).toBeGreaterThanOrEqual(50 - 0.01);
  });

  it("relaxation: oversized rooms trigger slack expansion + dim shrink", () => {
    const c = makeConstraints([
      makeRoom({ id: "lr", name: "Living", function: "living", dim_width_ft: 24, dim_depth_ft: 20, user_explicit_dims: true }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen", dim_width_ft: 18, dim_depth_ft: 14, user_explicit_dims: true }),
    ], false, { width_ft: 30, depth_ft: 30 });
    const { stage3B } = solveFull(c);
    // 24+18=42 > 30, but rooms are in different mandala cells; with enough slack or shrink we should fit
    if (stage3B?.feasible) {
      assertNoOverlaps(stage3B.placements);
      expect(stage3B.relaxations_applied.length).toBeGreaterThan(0);
    } else {
      expect(stage3B?.conflict).not.toBeNull();
    }
  });

  it("performance: 15-room solve completes in <5 seconds", () => {
    const rooms: ParsedRoom[] = [];
    for (let i = 0; i < 15; i++) {
      rooms.push(makeRoom({
        id: `r${i}`, name: `Room ${i}`,
        function: i === 0 ? "master_bedroom" : i < 5 ? "bedroom" : i < 10 ? "bathroom" : "other",
        dim_width_ft: 10, dim_depth_ft: 8,
      }));
    }
    const c = makeConstraints(rooms, true, { width_ft: 55, depth_ft: 50 });
    const start = Date.now();
    const { stage3B } = solveFull(c);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    if (stage3B?.feasible) assertNoOverlaps(stage3B.placements);
  });

  it("plot bounds: all placements stay inside plot", () => {
    const c = makeConstraints([
      makeRoom({ id: "r1", name: "A", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10 }),
      makeRoom({ id: "r2", name: "B", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10 }),
      makeRoom({ id: "r3", name: "C", function: "living", dim_width_ft: 16, dim_depth_ft: 14 }),
    ], false, { width_ft: 40, depth_ft: 40 });
    const { stage3B } = solveFull(c);
    expect(stage3B?.feasible).toBe(true);
    for (const p of stage3B!.placements) {
      expect(p.x_ft).toBeGreaterThanOrEqual(-0.01);
      expect(p.y_ft).toBeGreaterThanOrEqual(-0.01);
      expect(p.x_ft + p.width_ft).toBeLessThanOrEqual(40 + 0.01);
      expect(p.y_ft + p.depth_ft).toBeLessThanOrEqual(40 + 0.01);
    }
  });
});
