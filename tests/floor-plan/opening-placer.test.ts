import { describe, it, expect } from "vitest";
import { placeOpenings } from "@/features/floor-plan/lib/csp-solver/opening-placer";
import { generateWalls } from "@/features/floor-plan/lib/csp-solver/wall-generator";
import type { FinePlacement } from "@/features/floor-plan/lib/csp-solver";
import { CELL_NW, type CellIdx } from "@/features/floor-plan/lib/csp-solver";
import type { ParsedConstraints, ParsedRoom } from "@/features/floor-plan/lib/structured-parser";

function mk(o: Partial<FinePlacement>): FinePlacement {
  return {
    room_id: o.room_id ?? "r",
    room_name: o.room_name ?? "Room",
    function: o.function ?? "bedroom",
    mandala_cell: o.mandala_cell ?? (CELL_NW as CellIdx),
    mandala_direction: o.mandala_direction ?? "NW",
    x_ft: o.x_ft ?? 0,
    y_ft: o.y_ft ?? 0,
    width_ft: o.width_ft ?? 10,
    depth_ft: o.depth_ft ?? 10,
  };
}

function mkRoom(o: Partial<ParsedRoom>): ParsedRoom {
  return {
    id: o.id ?? "r1",
    name: o.name ?? "Room",
    function: o.function ?? "bedroom",
    dim_width_ft: null, dim_depth_ft: null,
    position_type: "unspecified", position_direction: null,
    attached_to_room_id: o.attached_to_room_id ?? null,
    must_have_window_on: null,
    external_walls_ft: null, internal_walls_ft: null,
    doors: o.doors ?? [],
    windows: o.windows ?? [],
    is_wet: false, is_sacred: false, is_circulation: false,
    user_explicit_dims: false, user_explicit_position: false,
  };
}

function mkConstraints(rooms: ParsedRoom[], facing: ParsedConstraints["plot"]["facing"] = "N", pairs: ParsedConstraints["adjacency_pairs"] = []): ParsedConstraints {
  return {
    plot: { width_ft: 40, depth_ft: 40, facing, shape: null, total_built_up_sqft: null },
    rooms,
    adjacency_pairs: pairs,
    vastu_required: false,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

describe("Opening placer (Stage 3D)", () => {
  it("never throws and always returns an OpeningResult", () => {
    const placements: FinePlacement[] = [];
    const walls = generateWalls(placements, { plot_width_ft: 40, plot_depth_ft: 40 });
    const c = mkConstraints([]);
    expect(() => placeOpenings(c, placements, walls, 40, 40)).not.toThrow();
    const result = placeOpenings(c, placements, walls, 40, 40);
    expect(result.doors).toEqual([]);
    expect(result.windows).toEqual([]);
    expect(result.warnings).toBeDefined();
  });

  it("main entrance door placed on N wall when plot.facing=N and porch on N", () => {
    const porch = mk({ room_id: "porch", room_name: "Porch", function: "porch", x_ft: 10, y_ft: 0, width_ft: 8, depth_ft: 5 });
    const placements = [porch];
    const walls = generateWalls(placements, { plot_width_ft: 40, plot_depth_ft: 40 });
    const c = mkConstraints(
      [mkRoom({ id: "porch", name: "Porch", function: "porch", doors: [{ width_ft: 3, leads_to_room_id: null, is_main_entrance: true }] })],
      "N",
    );
    const result = placeOpenings(c, placements, walls, 40, 40);
    expect(result.doors.length).toBeGreaterThanOrEqual(1);
    const mainDoor = result.doors.find(d => d.type === "main_entrance");
    expect(mainDoor).toBeDefined();
    // Main door wall should be on y=0 (north)
    const mainWall = walls.find(w => w.id === mainDoor!.wall_id);
    expect(Math.abs(mainWall!.centerline.start.y)).toBeLessThan(1);
  });

  it("interior door placed on shared edge for attached_ensuite", () => {
    const master = mk({ room_id: "m", room_name: "Master", function: "master_bedroom", x_ft: 0, y_ft: 0, width_ft: 14, depth_ft: 12 });
    const bath = mk({ room_id: "b", room_name: "Bath", function: "master_bathroom", x_ft: 14, y_ft: 0, width_ft: 6, depth_ft: 8 });
    const placements = [master, bath];
    const walls = generateWalls(placements, { plot_width_ft: 40, plot_depth_ft: 40 });
    const c = mkConstraints(
      [
        mkRoom({ id: "m", function: "master_bedroom" }),
        mkRoom({ id: "b", function: "master_bathroom", attached_to_room_id: "m" }),
      ],
      "N",
      [{ room_a_id: "m", room_b_id: "b", relationship: "attached_ensuite", user_explicit: true }],
    );
    const result = placeOpenings(c, placements, walls, 40, 40);
    const interior = result.doors.filter(d => d.type === "single_swing");
    expect(interior.length).toBeGreaterThanOrEqual(1);
    const mb = interior.find(d => d.connects_rooms.includes("m") && d.connects_rooms.includes("b"));
    expect(mb).toBeDefined();
  });

  it("window on internal wall is dropped with warning", () => {
    const a = mk({ room_id: "a", room_name: "A", function: "bedroom", x_ft: 0, y_ft: 0, width_ft: 10, depth_ft: 10 });
    const b = mk({ room_id: "b", room_name: "B", function: "bedroom", x_ft: 10, y_ft: 0, width_ft: 10, depth_ft: 10 });
    const placements = [a, b];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });
    const c = mkConstraints(
      [
        // room a wants a window on east wall — but east of a is internal (shared with b)
        mkRoom({ id: "a", function: "bedroom", windows: [{ wall_direction: "E", is_large: false }] }),
        mkRoom({ id: "b", function: "bedroom" }),
      ],
      "N",
    );
    const result = placeOpenings(c, placements, walls, 20, 20);
    expect(result.windows.length).toBe(0);
    expect(result.warnings.some(w => w.toLowerCase().includes("window") && (w.includes("internal") || w.includes("dropped")))).toBe(true);
  });

  it("rooms with no shared edge get adjacency door skipped with warning", () => {
    const a = mk({ room_id: "a", room_name: "A", function: "bedroom", x_ft: 0, y_ft: 0, width_ft: 5, depth_ft: 5 });
    const b = mk({ room_id: "b", room_name: "B", function: "bedroom", x_ft: 20, y_ft: 20, width_ft: 5, depth_ft: 5 });
    const placements = [a, b];
    const walls = generateWalls(placements, { plot_width_ft: 40, plot_depth_ft: 40 });
    const c = mkConstraints(
      [mkRoom({ id: "a" }), mkRoom({ id: "b" })],
      "N",
      [{ room_a_id: "a", room_b_id: "b", relationship: "door_connects", user_explicit: true }],
    );
    const result = placeOpenings(c, placements, walls, 40, 40);
    const betweenAB = result.doors.find(d => d.connects_rooms.includes("a") && d.connects_rooms.includes("b"));
    expect(betweenAB).toBeUndefined();
    expect(result.warnings.some(w => w.includes("rooms not adjacent") || w.includes("skipped"))).toBe(true);
  });

  it("main entrance falls back to longest external wall when plot.facing has no room wall", () => {
    // Porch on SOUTH but facing=N — main door has no N wall on porch
    const porch = mk({ room_id: "porch", room_name: "Porch", function: "porch", x_ft: 10, y_ft: 35, width_ft: 8, depth_ft: 5 });
    const placements = [porch];
    const walls = generateWalls(placements, { plot_width_ft: 40, plot_depth_ft: 40 });
    const c = mkConstraints([mkRoom({ id: "porch", function: "porch" })], "N");
    const result = placeOpenings(c, placements, walls, 40, 40);
    expect(result.doors.length).toBeGreaterThanOrEqual(1);
    // Warning should note fallback
    expect(result.warnings.some(w => w.includes("longest external wall") || w.includes("has no wall"))).toBe(true);
  });

  it("never throws even with totally empty constraints + placements", () => {
    const c = mkConstraints([], null);
    const result = placeOpenings(c, [], [], 40, 40);
    expect(result.doors).toEqual([]);
    expect(result.windows).toEqual([]);
  });
});
