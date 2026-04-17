import { describe, it, expect } from "vitest";
import { generateWalls } from "@/features/floor-plan/lib/csp-solver/wall-generator";
import type { FinePlacement } from "@/features/floor-plan/lib/csp-solver";
import { CELL_NW, type CellIdx } from "@/features/floor-plan/lib/csp-solver";

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

describe("Wall generator", () => {
  it("single room on a 20x20 plot produces 4 exterior walls when room spans plot", () => {
    const placements = [mk({ room_id: "a", x_ft: 0, y_ft: 0, width_ft: 20, depth_ft: 20 })];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });
    expect(walls.length).toBeGreaterThanOrEqual(4);
    const exterior = walls.filter(w => w.type === "exterior");
    expect(exterior.length).toBe(4);
  });

  it("two side-by-side rooms share an interior wall", () => {
    const placements = [
      mk({ room_id: "a", x_ft: 0, y_ft: 0, width_ft: 10, depth_ft: 20 }),
      mk({ room_id: "b", x_ft: 10, y_ft: 0, width_ft: 10, depth_ft: 20 }),
    ];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });
    const exterior = walls.filter(w => w.type === "exterior");
    const interior = walls.filter(w => w.type === "interior");
    expect(exterior.length).toBeGreaterThanOrEqual(4);
    expect(interior.length).toBeGreaterThanOrEqual(1);
    // The shared wall at x=10 should appear once in interior
    const sharedAtX10 = interior.find(w =>
      Math.abs(w.centerline.start.x - w.centerline.end.x) < 0.1 &&
      Math.abs(w.centerline.start.x - 10 * 304.8) < 1,
    );
    expect(sharedAtX10).toBeDefined();
  });

  it("4 quadrant rooms produce split walls at T-junctions", () => {
    const placements = [
      mk({ room_id: "a", x_ft: 0, y_ft: 0, width_ft: 10, depth_ft: 10 }),
      mk({ room_id: "b", x_ft: 10, y_ft: 0, width_ft: 10, depth_ft: 10 }),
      mk({ room_id: "c", x_ft: 0, y_ft: 10, width_ft: 10, depth_ft: 10 }),
      mk({ room_id: "d", x_ft: 10, y_ft: 10, width_ft: 10, depth_ft: 10 }),
    ];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });
    const exterior = walls.filter(w => w.type === "exterior");
    const interior = walls.filter(w => w.type === "interior");
    // With T-junction splitting at (10, 10):
    //   2 horizontal exterior (y=0) split at x=10 → 2 segments
    //   2 horizontal exterior (y=20) split at x=10 → 2 segments
    //   2 vertical exterior (x=0) split at y=10 → 2 segments
    //   2 vertical exterior (x=20) split at y=10 → 2 segments
    //   1 interior horizontal (y=10) split at x=10 → 2 segments
    //   1 interior vertical (x=10) split at y=10 → 2 segments
    expect(exterior.length).toBe(8);
    expect(interior.length).toBe(4);
  });

  it("T-junction: interior wall terminates at exterior — endpoints not dangling", () => {
    // Single room not spanning plot creates T-junctions where room walls
    // meet the plot perimeter on the interior side.
    const placements = [mk({ room_id: "a", x_ft: 5, y_ft: 5, width_ft: 10, depth_ft: 10 })];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });

    // Count endpoint occurrences across all walls
    const endpointCount = new Map<string, number>();
    for (const w of walls) {
      const k1 = `${w.centerline.start.x.toFixed(1)}|${w.centerline.start.y.toFixed(1)}`;
      const k2 = `${w.centerline.end.x.toFixed(1)}|${w.centerline.end.y.toFixed(1)}`;
      endpointCount.set(k1, (endpointCount.get(k1) ?? 0) + 1);
      endpointCount.set(k2, (endpointCount.get(k2) ?? 0) + 1);
    }
    // Every endpoint should be touched by ≥ 2 walls (T-junction or corner)
    const dangling = [...endpointCount.values()].filter(c => c < 2).length;
    expect(dangling).toBe(0);
  });

  it("no dangling zero-length segments", () => {
    const placements = [mk({ room_id: "a", x_ft: 5, y_ft: 5, width_ft: 10, depth_ft: 10 })];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });
    for (const w of walls) {
      const dx = w.centerline.end.x - w.centerline.start.x;
      const dy = w.centerline.end.y - w.centerline.start.y;
      const len = Math.hypot(dx, dy);
      expect(len).toBeGreaterThan(0);
    }
  });

  it("uses external wall thickness on plot perimeter, internal for interior", () => {
    const placements = [
      mk({ room_id: "a", x_ft: 0, y_ft: 0, width_ft: 10, depth_ft: 20 }),
      mk({ room_id: "b", x_ft: 10, y_ft: 0, width_ft: 10, depth_ft: 20 }),
    ];
    const walls = generateWalls(placements, {
      plot_width_ft: 20, plot_depth_ft: 20,
      external_walls_ft: 0.75, internal_walls_ft: 0.33,
    });
    const exterior = walls.filter(w => w.type === "exterior");
    const interior = walls.filter(w => w.type === "interior");
    for (const w of exterior) expect(Math.abs(w.thickness_mm - 0.75 * 304.8)).toBeLessThan(0.1);
    for (const w of interior) expect(Math.abs(w.thickness_mm - 0.33 * 304.8)).toBeLessThan(0.1);
  });
});
