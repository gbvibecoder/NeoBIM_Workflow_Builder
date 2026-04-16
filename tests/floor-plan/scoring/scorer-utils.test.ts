import { describe, it, expect } from "vitest";
import { quadrantOf, projectBbox } from "./utils";
import type { FloorPlanProject, Room } from "@/types/floor-plan-cad";

function makeRoom(id: string, x: number, y: number, w: number, d: number): Room {
  return {
    id, name: id, type: "bedroom",
    boundary: {
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + d },
        { x, y: y + d },
      ],
    },
    area_sqm: (w * d) / 1_000_000 * 0.092903,
    perimeter_mm: 2 * (w + d),
    natural_light_required: true,
    ventilation_required: true,
    label_position: { x: x + w / 2, y: y + d / 2 },
    wall_ids: [],
  };
}

function makeProject(rooms: Room[], plotW: number, plotD: number): FloorPlanProject {
  return {
    id: "p1", name: "test", version: "1.0.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      project_type: "residential", building_type: "apt", num_floors: 1,
    },
    settings: {
      units: "metric", display_unit: "ft", scale: "1:100", grid_size_mm: 100,
      wall_thickness_mm: 150, paper_size: "A3", orientation: "landscape",
      north_angle_deg: 0, vastu_compliance: false, feng_shui_compliance: false,
      ada_compliance: false, nbc_compliance: false,
    },
    floors: [{
      id: "f0", name: "Ground", level: 0,
      floor_to_floor_height_mm: 3000, slab_thickness_mm: 150,
      boundary: {
        points: [
          { x: 0, y: 0 },
          { x: plotW, y: 0 },
          { x: plotW, y: plotD },
          { x: 0, y: plotD },
        ],
      },
      walls: [], rooms, doors: [], windows: [], stairs: [], columns: [],
      furniture: [], fixtures: [], annotations: [], dimensions: [], zones: [],
    }],
  };
}

describe("Scorer utils — plot-boundary quadrant classification", () => {
  it("single room in NE corner of 50x60 plot classifies as NE (Y-UP, plot-centered)", () => {
    // Y-UP world convention: high y = north. NE corner = high x, high y.
    const room = makeRoom("ne", 40, 50, 10, 10);
    const project = makeProject([room], 50, 60);
    expect(quadrantOf(room, project)).toBe("NE");
  });

  it("same NE room with OTHER rooms clustering SW still classifies as NE", () => {
    const ne = makeRoom("ne", 40, 50, 10, 10);
    const sw1 = makeRoom("sw1", 0, 0, 10, 10);
    const sw2 = makeRoom("sw2", 10, 0, 10, 10);
    const project = makeProject([ne, sw1, sw2], 50, 60);
    expect(quadrantOf(ne, project)).toBe("NE");
  });

  it("room centered on plot classifies as CENTER", () => {
    const room = makeRoom("c", 20, 25, 10, 10);
    const project = makeProject([room], 50, 60);
    expect(quadrantOf(room, project)).toBe("CENTER");
  });

  it("projectBbox prefers floor.boundary over rooms bbox", () => {
    const room = makeRoom("r", 10, 10, 5, 5);
    const project = makeProject([room], 100, 100);
    const b = projectBbox(project);
    expect(b?.minX).toBe(0);
    expect(b?.minY).toBe(0);
    expect(b?.maxX).toBe(100);
    expect(b?.maxY).toBe(100);
  });
});
