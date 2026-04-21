/**
 * Phase 2.4 P0-B — tests for the two deterministic Stage 6 evaluators.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateBedroomPrivacy,
  evaluateEntranceDoor,
} from "../quality-evaluators";
import type {
  FloorPlanProject,
  Room,
  Door,
  Wall,
  RoomType,
} from "@/types/floor-plan-cad";
import type { ArchitectBrief } from "../types";

// ─── fixture helpers ─────────────────────────────────────────────

function makeRoom(id: string, name: string, type: RoomType): Room {
  return {
    id,
    name,
    type,
    boundary: { points: [] },
    area_sqm: 12,
    perimeter_mm: 0,
    natural_light_required: true,
    ventilation_required: true,
    label_position: { x: 0, y: 0 },
    wall_ids: [],
  };
}

function makeDoor(
  id: string,
  roomA: string,
  roomB: string,
  opts: Partial<Door> = {},
): Door {
  return {
    id,
    type: "single_swing",
    wall_id: "w_x",
    width_mm: 900,
    height_mm: 2000,
    thickness_mm: 40,
    position_along_wall_mm: 500,
    swing_direction: "right",
    swing_angle_deg: 90,
    opens_to: "inside",
    symbol: {
      hinge_point: { x: 0, y: 0 },
      arc_radius_mm: 900,
      arc_start_angle_deg: 0,
      arc_end_angle_deg: 90,
      leaf_end_point: { x: 900, y: 0 },
    },
    connects_rooms: [roomA, roomB],
    ...opts,
  };
}

function makeProject(rooms: Room[], doors: Door[], walls: Wall[] = []): FloorPlanProject {
  return {
    id: "p1",
    name: "test",
    version: "1",
    created_at: "",
    updated_at: "",
    metadata: { project_type: "residential", building_type: "villa", num_floors: 1 },
    settings: {
      units: "imperial",
      display_unit: "ft",
      scale: "1:100",
      grid_size_mm: 305,
      wall_thickness_mm: 115,
      paper_size: "A3",
      orientation: "landscape",
      north_angle_deg: 0,
      vastu_compliance: false,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: false,
    },
    floors: [
      {
        id: "f1",
        name: "Ground",
        level: 0,
        floor_to_floor_height_mm: 3000,
        slab_thickness_mm: 150,
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: 12000, y: 0 },
            { x: 12000, y: 12000 },
            { x: 0, y: 12000 },
          ],
        },
        walls,
        rooms,
        doors,
        windows: [],
        stairs: [],
        columns: [],
        furniture: [],
        fixtures: [],
        annotations: [],
        dimensions: [],
        zones: [],
      },
    ],
  };
}

function makeBrief(facing: string): ArchitectBrief {
  return {
    projectType: "villa",
    roomList: [],
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing,
    styleCues: [],
    constraints: [],
  };
}

// ─── bedroomPrivacy ──────────────────────────────────────────────

describe("evaluateBedroomPrivacy", () => {
  it("returns 10 when all bedrooms private", () => {
    const rooms = [
      makeRoom("hall", "Hall", "corridor"),
      makeRoom("br1", "Bedroom 1", "bedroom"),
      makeRoom("br2", "Bedroom 2", "bedroom"),
      makeRoom("liv", "Living", "living_room"),
    ];
    const doors = [
      makeDoor("d1", "br1", "hall"),
      makeDoor("d2", "br2", "hall"),
      makeDoor("d3", "liv", "hall"),
    ];
    const r = evaluateBedroomPrivacy(makeProject(rooms, doors));
    expect(r.score).toBe(10);
  });

  it("returns 7 when 1 bedroom opens to living", () => {
    const rooms = [
      makeRoom("hall", "Hall", "corridor"),
      makeRoom("br1", "Bedroom 1", "bedroom"),
      makeRoom("br2", "Bedroom 2", "bedroom"),
      makeRoom("liv", "Living", "living_room"),
    ];
    const doors = [
      makeDoor("d1", "br1", "liv"), // leaky
      makeDoor("d2", "br2", "hall"),
    ];
    const r = evaluateBedroomPrivacy(makeProject(rooms, doors));
    expect(r.score).toBe(7);
    expect(r.reason).toContain("Bedroom 1");
  });

  it("returns 1 when 2+ bedrooms open to common areas", () => {
    const rooms = [
      makeRoom("hall", "Hall", "corridor"),
      makeRoom("br1", "Bedroom 1", "bedroom"),
      makeRoom("br2", "Bedroom 2", "bedroom"),
      makeRoom("kit", "Kitchen", "kitchen"),
      makeRoom("din", "Dining", "dining_room"),
    ];
    const doors = [
      makeDoor("d1", "br1", "kit"),
      makeDoor("d2", "br2", "din"),
    ];
    const r = evaluateBedroomPrivacy(makeProject(rooms, doors));
    expect(r.score).toBe(1);
  });

  it("returns 10 (N/A) when there are no bedrooms", () => {
    const rooms = [makeRoom("liv", "Living", "living_room")];
    const r = evaluateBedroomPrivacy(makeProject(rooms, []));
    expect(r.score).toBe(10);
    expect(r.reason).toMatch(/No bedrooms/i);
  });
});

// ─── entranceDoor ────────────────────────────────────────────────

describe("evaluateEntranceDoor", () => {
  function wallOnSide(side: "N" | "S" | "E" | "W"): Wall {
    // Plot 0..12000 x 0..12000 (mm). Walls of length 5m flush against the edge.
    const edges: Record<"N" | "S" | "E" | "W", Wall["centerline"]> = {
      S: { start: { x: 2000, y: 0 }, end: { x: 7000, y: 0 } },
      N: { start: { x: 2000, y: 12000 }, end: { x: 7000, y: 12000 } },
      W: { start: { x: 0, y: 2000 }, end: { x: 0, y: 7000 } },
      E: { start: { x: 12000, y: 2000 }, end: { x: 12000, y: 7000 } },
    };
    return {
      id: "w_main",
      type: "exterior",
      material: "brick",
      centerline: edges[side],
      thickness_mm: 230,
      height_mm: 3000,
      openings: [],
      line_weight: "thick",
      is_load_bearing: true,
    };
  }

  function projectWithMainDoor(wallSide: "N" | "S" | "E" | "W"): FloorPlanProject {
    const wall = wallOnSide(wallSide);
    const rooms = [makeRoom("foy", "Foyer", "foyer")];
    const door = makeDoor("d_main", "foy", "foy", {
      id: "d_main",
      type: "main_entrance",
      wall_id: wall.id,
    });
    return makeProject(rooms, [door], [wall]);
  }

  it("returns 10 when entrance on declared facing", () => {
    const r = evaluateEntranceDoor(projectWithMainDoor("N"), makeBrief("N"));
    expect(r.score).toBe(10);
  });

  it("returns 5 when entrance on adjacent side", () => {
    const r = evaluateEntranceDoor(projectWithMainDoor("E"), makeBrief("N"));
    expect(r.score).toBe(5);
    expect(r.reason).toMatch(/adjacent/i);
  });

  it("returns 1 when entrance on opposite side", () => {
    const r = evaluateEntranceDoor(projectWithMainDoor("S"), makeBrief("N"));
    expect(r.score).toBe(1);
    expect(r.reason).toMatch(/opposite/i);
  });

  it("returns 5 (neutral) when no main_entrance door is present", () => {
    const rooms = [makeRoom("liv", "Living", "living_room")];
    const r = evaluateEntranceDoor(makeProject(rooms, []), makeBrief("N"));
    expect(r.score).toBe(5);
    expect(r.reason).toMatch(/No main_entrance/i);
  });

  // ─── Phase 2.5 P0-B: envelope-aware cardinal-side tolerance ──────
  //
  // When setbacks are applied, the main door sits on the building wall
  // (inset from the plot edge by setback_ft). Reading floor.boundary
  // gave a distance > tolerance, so the dim collapsed to neutral 5/10
  // on every urban plot with setbacks. The fix reads
  // project.metadata.plot_usable_area when present.

  function wallAtMmY(yMm: number, xStart = 2000, xEnd = 7000): Wall {
    return {
      id: "w_main",
      type: "exterior",
      material: "brick",
      centerline: {
        start: { x: xStart, y: yMm },
        end: { x: xEnd, y: yMm },
      },
      thickness_mm: 230,
      height_mm: 3000,
      openings: [],
      line_weight: "thick",
      is_load_bearing: true,
    };
  }

  function mumbaiProjectWithSouthDoor(
    withEnvelopeMeta: boolean,
  ): FloorPlanProject {
    const FT_TO_MM = 304.8;
    // Mumbai 40x40 plot: side setback 4.9ft, front 9.8ft.
    const originXMm = 4.9 * FT_TO_MM; // 1493.5
    const originYMm = 9.8 * FT_TO_MM; // 2987.04
    // South wall of the BUILDING (inset from plot's south edge).
    const wall = wallAtMmY(originYMm);
    const rooms = [makeRoom("foy", "Foyer", "foyer")];
    const door = makeDoor("d_main", "foy", "foy", {
      id: "d_main",
      type: "main_entrance",
      wall_id: wall.id,
    });
    const project = makeProject(rooms, [door], [wall]);
    if (withEnvelopeMeta) {
      (project.metadata as unknown as Record<string, unknown>).plot_usable_area =
        {
          width_ft: 30.2,
          depth_ft: 20.4,
          origin_x_ft: 4.9,
          origin_y_ft: 9.8,
        };
    }
    return project;
  }

  it("P0-B: envelope metadata present → south-inset main door identified as S (10/10)", () => {
    const project = mumbaiProjectWithSouthDoor(true);
    const r = evaluateEntranceDoor(project, makeBrief("S"));
    // With envelope-aware bounds, the inset south wall is at envelope minY.
    expect(r.score).toBe(10);
    expect(r.reason).toMatch(/on S/i);
  });

  it("P0-B: envelope metadata absent → falls back to floor.boundary (neutral 5/10)", () => {
    const project = mumbaiProjectWithSouthDoor(false);
    const r = evaluateEntranceDoor(project, makeBrief("S"));
    // Without envelope metadata, the 2987mm inset is > 12000*0.15=1800mm
    // tolerance, so wallCardinalSide returns null → neutral 5/10.
    // (This captures the pre-fix behavior when setbacks are off.)
    expect(r.score).toBe(5);
    expect(r.reason).toMatch(/not on a cardinal edge/i);
  });

  it("P0-B: envelope metadata present + mismatch — opposite facing → 1/10", () => {
    // Same Mumbai inset south wall, but brief declares "N" — should
    // detect "S" correctly (via envelope) and mark opposite.
    const project = mumbaiProjectWithSouthDoor(true);
    const r = evaluateEntranceDoor(project, makeBrief("N"));
    expect(r.score).toBe(1);
    expect(r.reason).toMatch(/opposite/i);
  });
});
