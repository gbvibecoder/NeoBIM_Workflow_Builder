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

  it("4 quadrant rooms produce 4 ext + 2 int walls (cross pattern)", () => {
    const placements = [
      mk({ room_id: "a", x_ft: 0, y_ft: 0, width_ft: 10, depth_ft: 10 }),
      mk({ room_id: "b", x_ft: 10, y_ft: 0, width_ft: 10, depth_ft: 10 }),
      mk({ room_id: "c", x_ft: 0, y_ft: 10, width_ft: 10, depth_ft: 10 }),
      mk({ room_id: "d", x_ft: 10, y_ft: 10, width_ft: 10, depth_ft: 10 }),
    ];
    const walls = generateWalls(placements, { plot_width_ft: 20, plot_depth_ft: 20 });
    const exterior = walls.filter(w => w.type === "exterior");
    const interior = walls.filter(w => w.type === "interior");
    // 4 exterior walls (merged across matching room edges)
    expect(exterior.length).toBe(4);
    // Interior: one full vertical at x=10, one full horizontal at y=10
    expect(interior.length).toBe(2);
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
