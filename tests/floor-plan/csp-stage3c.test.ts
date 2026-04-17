import { describe, it, expect } from "vitest";
import { alignBoundaries } from "@/features/floor-plan/lib/csp-solver/boundary-aligner";
import { CELL_SW, CELL_S, CELL_SE, CELL_N, CELL_NW, type CellIdx } from "@/features/floor-plan/lib/csp-solver";
import type { FinePlacement } from "@/features/floor-plan/lib/csp-solver";
import type { ParsedConstraints, ParsedRoom } from "@/features/floor-plan/lib/structured-parser";
import { rectOverlaps } from "@/features/floor-plan/lib/csp-solver/geometry-utils";

function makePlacement(o: Partial<FinePlacement>): FinePlacement {
  return {
    room_id: o.room_id ?? "r",
    room_name: o.room_name ?? "Room",
    function: o.function ?? "bedroom",
    mandala_cell: o.mandala_cell ?? (CELL_N as CellIdx),
    mandala_direction: o.mandala_direction ?? "N",
    x_ft: o.x_ft ?? 0,
    y_ft: o.y_ft ?? 0,
    width_ft: o.width_ft ?? 10,
    depth_ft: o.depth_ft ?? 10,
  };
}

function makeRoom(id: string, userExplicit = false): ParsedRoom {
  return {
    id, name: id, function: "bedroom",
    dim_width_ft: null, dim_depth_ft: null,
    position_type: userExplicit ? "corner" : "unspecified",
    position_direction: userExplicit ? "SW" : null,
    attached_to_room_id: null,
    must_have_window_on: null,
    external_walls_ft: null, internal_walls_ft: null,
    doors: [], windows: [],
    is_wet: false, is_sacred: false, is_circulation: false,
    user_explicit_dims: false,
    user_explicit_position: userExplicit,
  };
}

function makeConstraints(roomIds: string[], userExplicitIds: string[] = []): ParsedConstraints {
  return {
    plot: { width_ft: 40, depth_ft: 40, facing: null, shape: null, total_built_up_sqft: null },
    rooms: roomIds.map(id => makeRoom(id, userExplicitIds.includes(id))),
    adjacency_pairs: [],
    connects_all_groups: [],
    vastu_required: false,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

function noOverlapsIn(placements: FinePlacement[]): boolean {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i], b = placements[j];
      if (rectOverlaps(
        { x: a.x_ft, y: a.y_ft, width: a.width_ft, depth: a.depth_ft },
        { x: b.x_ft, y: b.y_ft, width: b.width_ft, depth: b.depth_ft },
      )) return false;
    }
  }
  return true;
}

describe("CSP Stage 3C — Boundary alignment", () => {
  it("snaps a room close to plot edge onto the edge", () => {
    const placements = [
      makePlacement({ room_id: "a", room_name: "A", x_ft: 1.0, y_ft: 0, width_ft: 10, depth_ft: 10, mandala_cell: CELL_NW, mandala_direction: "NW" }),
    ];
    const c = makeConstraints(["a"]);
    const res = alignBoundaries(placements, c, 40, 40);
    expect(res.placements[0].x_ft).toBe(0);
    expect(res.snaps_applied).toBeGreaterThanOrEqual(1);
  });

  it("does NOT snap a user-pinned room even if close to edge", () => {
    const placements = [
      makePlacement({ room_id: "a", x_ft: 2.5, y_ft: 0, width_ft: 10, depth_ft: 10 }),
    ];
    const c = makeConstraints(["a"], ["a"]);
    const res = alignBoundaries(placements, c, 40, 40);
    expect(res.placements[0].x_ft).toBe(2.5);
  });

  it("closes small gap between two rooms on south plot side", () => {
    const placements = [
      makePlacement({ room_id: "a", room_name: "A", x_ft: 0, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_SW, mandala_direction: "SW" }),
      makePlacement({ room_id: "b", room_name: "B", x_ft: 14, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_S, mandala_direction: "S" }),
    ];
    const c = makeConstraints(["a", "b"]);
    const res = alignBoundaries(placements, c, 40, 40);
    expect(noOverlapsIn(res.placements)).toBe(true);
    const A = res.placements.find(p => p.room_id === "a")!;
    const B = res.placements.find(p => p.room_id === "b")!;
    const aRight = A.x_ft + A.width_ft;
    expect(Math.abs(B.x_ft - aRight)).toBeLessThan(0.5);
  });

  it("does NOT move user-pinned rooms in inter-room snap", () => {
    const placements = [
      makePlacement({ room_id: "a", x_ft: 0, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_SW, mandala_direction: "SW" }),
      makePlacement({ room_id: "b", x_ft: 14, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_S, mandala_direction: "S" }),
    ];
    const c = makeConstraints(["a", "b"], ["a"]);
    const res = alignBoundaries(placements, c, 40, 40);
    const A = res.placements.find(p => p.room_id === "a")!;
    expect(A.x_ft).toBe(0);
  });

  it("preserves no-overlap after snap (rejects snap that would overlap third room)", () => {
    const placements = [
      makePlacement({ room_id: "a", x_ft: 0, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_SW, mandala_direction: "SW" }),
      makePlacement({ room_id: "b", x_ft: 14, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_S, mandala_direction: "S" }),
      makePlacement({ room_id: "c", x_ft: 12, y_ft: 30, width_ft: 2, depth_ft: 10, mandala_cell: CELL_S, mandala_direction: "S" }),
    ];
    const c = makeConstraints(["a", "b", "c"]);
    const res = alignBoundaries(placements, c, 40, 40);
    expect(noOverlapsIn(res.placements)).toBe(true);
  });

  it("does not push rooms out of plot bounds", () => {
    const placements = [
      makePlacement({ room_id: "a", x_ft: 0, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_SW, mandala_direction: "SW" }),
      makePlacement({ room_id: "b", x_ft: 14, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_S, mandala_direction: "S" }),
      makePlacement({ room_id: "c", x_ft: 28, y_ft: 30, width_ft: 12, depth_ft: 10, mandala_cell: CELL_SE, mandala_direction: "SE" }),
    ];
    const c = makeConstraints(["a", "b", "c"]);
    const res = alignBoundaries(placements, c, 40, 40);
    for (const p of res.placements) {
      expect(p.x_ft).toBeGreaterThanOrEqual(-0.01);
      expect(p.x_ft + p.width_ft).toBeLessThanOrEqual(40 + 0.01);
      expect(p.y_ft).toBeGreaterThanOrEqual(-0.01);
      expect(p.y_ft + p.depth_ft).toBeLessThanOrEqual(40 + 0.01);
    }
  });

  it("handles single-room input without errors", () => {
    const placements = [
      makePlacement({ room_id: "a", x_ft: 10, y_ft: 10, width_ft: 10, depth_ft: 10 }),
    ];
    const c = makeConstraints(["a"]);
    const res = alignBoundaries(placements, c, 40, 40);
    expect(res.placements.length).toBe(1);
  });

  it("no-op on empty placements", () => {
    const c = makeConstraints([]);
    const res = alignBoundaries([], c, 40, 40);
    expect(res.placements.length).toBe(0);
    expect(res.snaps_applied).toBe(0);
  });
});
