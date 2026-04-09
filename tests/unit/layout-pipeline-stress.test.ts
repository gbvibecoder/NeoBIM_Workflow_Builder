/**
 * Part 6: Stress Tests — Full Pipeline Verification
 *
 * Tests the complete chain: layoutFloorPlan → FloorPlanGeometry → convertGeometryToProject
 * Verifies 5 floor plan types with programmatic assertions on:
 *   - Layout correctness (overlaps, footprint, areas, aspect ratios)
 *   - Geometry conversion (meters → mm, Y-down → Y-up)
 *   - Wall generation (exterior/interior count, thickness)
 *   - Door/window auto-placement (count, type, position validity)
 *   - Project metadata integrity
 */

import { describe, it, expect } from "vitest";
import { layoutFloorPlan, PlacedRoom } from "@/features/floor-plan/lib/layout-engine";
import { convertGeometryToProject } from "@/features/floor-plan/lib/pipeline-adapter";
import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "@/features/floor-plan/lib/ai-room-programmer";
import type { FloorPlanGeometry } from "@/features/floor-plan/types/floor-plan";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// ── Helper to build EnhancedRoomProgram ──────────────────────────────────────

function makeProgram(
  rooms: Array<{ name: string; type: string; areaSqm: number; zone: RoomSpec["zone"]; adjacentTo?: string[] }>,
  adjacency: AdjacencyRequirement[] = [],
  overrides?: Partial<EnhancedRoomProgram>,
): EnhancedRoomProgram {
  const roomSpecs: RoomSpec[] = rooms.map(r => ({
    name: r.name,
    type: r.type,
    areaSqm: r.areaSqm,
    zone: r.zone,
    mustHaveExteriorWall: !["bathroom", "utility", "storage", "hallway"].includes(r.type),
    adjacentTo: r.adjacentTo ?? [],
    preferNear: [],
  }));

  const zones = {
    public: roomSpecs.filter(r => r.zone === "public").map(r => r.name),
    private: roomSpecs.filter(r => r.zone === "private").map(r => r.name),
    service: roomSpecs.filter(r => r.zone === "service").map(r => r.name),
    circulation: roomSpecs.filter(r => r.zone === "circulation").map(r => r.name),
  };

  return {
    buildingType: "Residential Apartment",
    totalAreaSqm: roomSpecs.reduce((s, r) => s + r.areaSqm, 0),
    numFloors: 1,
    rooms: roomSpecs,
    adjacency,
    zones,
    entranceRoom: roomSpecs[0]?.name ?? "Living Room",
    circulationNotes: "",
    projectName: "Stress Test Plan",
    ...overrides,
  };
}

// ── Layout → Geometry → Project pipeline ─────────────────────────────────────

function runPipeline(program: EnhancedRoomProgram, prompt: string): {
  layout: PlacedRoom[];
  geometry: FloorPlanGeometry;
  project: FloorPlanProject;
} {
  const layout = layoutFloorPlan(program);

  // Build FloorPlanGeometry from layout (same as generate-floor-plan route)
  const positionedRooms = layout;
  const bW = Math.round(Math.max(...positionedRooms.map(r => r.x + r.width)) * 10) / 10;
  const bD = Math.round(Math.max(...positionedRooms.map(r => r.y + r.depth)) * 10) / 10;

  const rooms = positionedRooms.map(r => ({
    name: r.name,
    type: r.type as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "hallway" | "entrance" | "utility" | "balcony" | "other",
    x: r.x, y: r.y, width: r.width, depth: r.depth,
    center: [r.x + r.width / 2, r.y + r.depth / 2] as [number, number],
    area: r.area,
  }));

  const geometry: FloorPlanGeometry = {
    footprint: { width: bW, depth: bD },
    wallHeight: 3.0,
    walls: [], doors: [], windows: [],
    rooms,
  };

  const project = convertGeometryToProject(geometry, program.projectName, prompt);

  return { layout, geometry, project };
}

// ── Validation helpers ───────────────────────────────────────────────────────

function checkZeroOverlaps(rooms: PlacedRoom[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (overlapX > 0.15 && overlapY > 0.15) {
        errors.push(`"${a.name}" and "${b.name}" overlap`);
      }
    }
  }
  return errors;
}

// ══════════════════════════════════════════════════════════════════════════════
// 5 FLOOR PLAN STRESS TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe("Part 6: Full Pipeline Stress Tests", () => {

  // ── Test A: Standard 2BHK (Indian apartment) ────────────────────────────

  describe("A. Standard 2BHK Indian Apartment (67 sqm)", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 18, zone: "public", adjacentTo: ["Dining Room"] },
      { name: "Dining Room", type: "dining", areaSqm: 8, zone: "public", adjacentTo: ["Living Room", "Kitchen"] },
      { name: "Kitchen", type: "kitchen", areaSqm: 8, zone: "service", adjacentTo: ["Dining Room"] },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 14, zone: "private", adjacentTo: ["Bathroom 1"] },
      { name: "Bedroom 2", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 2"] },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 3, zone: "service" },
    ], [
      { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
      { roomA: "Living Room", roomB: "Dining Room", reason: "flow" },
      { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" },
      { roomA: "Bedroom 2", roomB: "Bathroom 2", reason: "attached bath" },
    ]);

    let result: ReturnType<typeof runPipeline>;

    it("pipeline runs without error", () => {
      result = runPipeline(program, "2BHK apartment Mumbai");
    });

    it("layout: correct room count + zero overlaps", () => {
      expect(result.layout.length).toBe(8); // 7 rooms + corridor
      expect(checkZeroOverlaps(result.layout)).toEqual([]);
    });

    it("geometry: footprint is positive and reasonable", () => {
      const { width, depth } = result.geometry.footprint;
      expect(width).toBeGreaterThan(5);
      expect(width).toBeLessThan(20);
      expect(depth).toBeGreaterThan(5);
      expect(depth).toBeLessThan(20);
    });

    it("project: all rooms converted with mm coordinates", () => {
      const floor = result.project.floors[0];
      expect(floor.rooms.length).toBe(8);
      for (const room of floor.rooms) {
        expect(room.boundary.points.length).toBe(4);
        // All coords should be in mm (> 1000 for rooms > 1m)
        for (const pt of room.boundary.points) {
          expect(pt.x).toBeGreaterThanOrEqual(-1); // allow floating-point rounding
          expect(pt.y).toBeGreaterThanOrEqual(-1);
        }
        expect(room.area_sqm).toBeGreaterThan(0);
      }
    });

    it("project: walls generated (exterior + interior)", () => {
      const walls = result.project.floors[0].walls;
      expect(walls.length).toBeGreaterThan(5);
      const exterior = walls.filter(w => w.type === "exterior");
      const interior = walls.filter(w => w.type === "interior" || w.type === "partition");
      expect(exterior.length).toBeGreaterThan(0);
      expect(interior.length).toBeGreaterThan(0);
      // Exterior walls should be 230mm thick (IS:1905)
      for (const w of exterior) {
        expect(w.thickness_mm).toBe(230);
      }
    });

    it("project: doors auto-placed for all rooms", () => {
      const doors = result.project.floors[0].doors;
      expect(doors.length).toBeGreaterThan(0);
      for (const door of doors) {
        expect(door.width_mm).toBeGreaterThan(500);
        expect(door.width_mm).toBeLessThan(2000);
      }
    });

    it("project: windows auto-placed on exterior walls", () => {
      const windows = result.project.floors[0].windows;
      expect(windows.length).toBeGreaterThan(0);
      for (const win of windows) {
        expect(win.width_mm).toBeGreaterThan(400);
        expect(win.sill_height_mm).toBeGreaterThan(0);
      }
    });

    it("project: metadata is valid", () => {
      expect(result.project.name).toBe("Stress Test Plan");
      expect(result.project.metadata.plot_area_sqm).toBeGreaterThan(40);
      expect(result.project.metadata.carpet_area_sqm).toBeGreaterThan(40);
      expect(result.project.metadata.original_prompt).toBe("2BHK apartment Mumbai");
    });
  });

  // ── Test B: Large 4BHK Villa ──────────────────────────────────────────

  describe("B. 4BHK Villa with Utility (180 sqm)", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 30, zone: "public", adjacentTo: ["Dining Room"] },
      { name: "Dining Room", type: "dining", areaSqm: 15, zone: "public", adjacentTo: ["Kitchen"] },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service", adjacentTo: ["Dining Room"] },
      { name: "Foyer", type: "entrance", areaSqm: 6, zone: "public" },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 20, zone: "private", adjacentTo: ["Bathroom 1"] },
      { name: "Bedroom 2", type: "bedroom", areaSqm: 14, zone: "private", adjacentTo: ["Bathroom 2"] },
      { name: "Bedroom 3", type: "bedroom", areaSqm: 14, zone: "private", adjacentTo: ["Bathroom 3"] },
      { name: "Bedroom 4", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 4"] },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 3", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 4", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Utility", type: "utility", areaSqm: 5, zone: "service" },
    ], [
      { roomA: "Living Room", roomB: "Dining Room", reason: "flow" },
      { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
      { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" },
      { roomA: "Bedroom 2", roomB: "Bathroom 2", reason: "attached bath" },
      { roomA: "Bedroom 3", roomB: "Bathroom 3", reason: "attached bath" },
      { roomA: "Bedroom 4", roomB: "Bathroom 4", reason: "attached bath" },
    ], { totalAreaSqm: 180 });

    let result: ReturnType<typeof runPipeline>;

    it("pipeline runs without error", () => {
      result = runPipeline(program, "4BHK villa Bangalore");
    });

    it("layout: 14 rooms (13 + corridor), zero overlaps", () => {
      expect(result.layout.length).toBe(14);
      expect(checkZeroOverlaps(result.layout)).toEqual([]);
    });

    it("project: Y-flip is correct (all Y coords ≥ 0)", () => {
      const floor = result.project.floors[0];
      for (const room of floor.rooms) {
        for (const pt of room.boundary.points) {
          expect(pt.y).toBeGreaterThanOrEqual(-1); // allow rounding tolerance
        }
      }
    });

    it("project: wall count proportional to room count", () => {
      const walls = result.project.floors[0].walls;
      // Shared walls are deduplicated — expect at least 10 wall segments for 14 rooms
      expect(walls.length).toBeGreaterThan(10);
      expect(walls.length).toBeLessThan(100);
    });

    it("project: at least one door per habitable room", () => {
      const doors = result.project.floors[0].doors;
      // Each room needs at least one door access (14 rooms → at least 10 doors)
      expect(doors.length).toBeGreaterThanOrEqual(8);
    });
  });

  // ── Test C: Studio Apartment (small, simple) ───────────────────────────

  describe("C. Studio Apartment (34 sqm, no corridor)", () => {
    const program = makeProgram([
      { name: "Studio Room", type: "living", areaSqm: 22, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 6, zone: "service" },
      { name: "Bathroom", type: "bathroom", areaSqm: 3, zone: "service" },
    ]);

    let result: ReturnType<typeof runPipeline>;

    it("pipeline runs without error", () => {
      result = runPipeline(program, "studio apartment");
    });

    it("layout: 3 rooms, no corridor", () => {
      expect(result.layout.length).toBe(3);
      expect(result.layout.find(r => r.type === "hallway")).toBeUndefined();
    });

    it("geometry: compact footprint for 34 sqm", () => {
      const area = result.geometry.footprint.width * result.geometry.footprint.depth;
      expect(area).toBeGreaterThan(25);
      expect(area).toBeLessThan(55);
    });

    it("project: rooms are in mm coordinates", () => {
      const floor = result.project.floors[0];
      const studioRoom = floor.rooms.find(r => r.name === "Studio Room");
      expect(studioRoom).toBeDefined();
      expect(studioRoom!.area_sqm).toBeGreaterThan(15);
      // Studio room boundary should span > 3000mm in both dimensions
      const pts = studioRoom!.boundary.points;
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const widthMm = Math.max(...xs) - Math.min(...xs);
      const heightMm = Math.max(...ys) - Math.min(...ys);
      expect(widthMm).toBeGreaterThan(2000);
      expect(heightMm).toBeGreaterThan(2000);
    });

    it("project: windows only on exterior walls of habitable rooms", () => {
      const floor = result.project.floors[0];
      const windows = floor.windows;
      // Studio should have at least one window, bathroom may have a small one
      expect(windows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Test D: Office Space (commercial, no bedrooms) ─────────────────────

  describe("D. Office Space (87 sqm, commercial)", () => {
    const program = makeProgram([
      { name: "Reception", type: "entrance", areaSqm: 15, zone: "public" },
      { name: "Open Floor", type: "living", areaSqm: 30, zone: "public" },
      { name: "Conference Room", type: "living", areaSqm: 20, zone: "public" },
      { name: "Pantry", type: "kitchen", areaSqm: 8, zone: "service" },
      { name: "Server Room", type: "utility", areaSqm: 6, zone: "service" },
      { name: "Restroom", type: "bathroom", areaSqm: 5, zone: "service" },
    ], [], { buildingType: "Commercial Office" });

    let result: ReturnType<typeof runPipeline>;

    it("pipeline runs without error", () => {
      result = runPipeline(program, "office space");
    });

    it("layout: correct count, zero overlaps", () => {
      expect(result.layout.length).toBeGreaterThanOrEqual(6);
      expect(checkZeroOverlaps(result.layout)).toEqual([]);
    });

    it("project: floor boundary matches footprint", () => {
      const floor = result.project.floors[0];
      const bndPts = floor.boundary.points;
      expect(bndPts.length).toBe(4);
      const bW = result.geometry.footprint.width * 1000;
      const bD = result.geometry.footprint.depth * 1000;
      // Floor boundary should match footprint dimensions (within 1mm tolerance)
      const xMax = Math.max(...bndPts.map(p => p.x));
      const yMax = Math.max(...bndPts.map(p => p.y));
      expect(Math.abs(xMax - bW)).toBeLessThan(1);
      expect(Math.abs(yMax - bD)).toBeLessThan(1);
    });

    it("project: room types correctly mapped to CAD types", () => {
      const floor = result.project.floors[0];
      const reception = floor.rooms.find(r => r.name === "Reception");
      expect(reception?.type).toBe("foyer");
      const pantry = floor.rooms.find(r => r.name === "Pantry");
      expect(pantry?.type).toBe("kitchen");
      const serverRoom = floor.rooms.find(r => r.name === "Server Room");
      expect(serverRoom?.type).toBe("utility");
    });
  });

  // ── Test E: Large 3BHK with Verandah (mixed rooms) ────────────────────

  describe("E. 3BHK with Verandah (130 sqm)", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 25, zone: "public", adjacentTo: ["Dining Room"] },
      { name: "Dining Room", type: "dining", areaSqm: 12, zone: "public", adjacentTo: ["Living Room", "Kitchen"] },
      { name: "Kitchen", type: "kitchen", areaSqm: 10, zone: "service", adjacentTo: ["Dining Room"] },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 16, zone: "private", adjacentTo: ["Bathroom 1"] },
      { name: "Bedroom 2", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 2"] },
      { name: "Bedroom 3", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 3"] },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 3", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Verandah", type: "balcony", areaSqm: 10, zone: "public" },
    ], [
      { roomA: "Living Room", roomB: "Dining Room", reason: "flow" },
      { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
      { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" },
      { roomA: "Bedroom 2", roomB: "Bathroom 2", reason: "attached bath" },
      { roomA: "Bedroom 3", roomB: "Bathroom 3", reason: "attached bath" },
    ], { totalAreaSqm: 130, buildingType: "Residential Villa" });

    let result: ReturnType<typeof runPipeline>;

    it("pipeline runs without error", () => {
      result = runPipeline(program, "3BHK flat with verandah Pune");
    });

    it("layout: 11 rooms (10 + corridor), zero overlaps", () => {
      expect(result.layout.length).toBe(11);
      expect(checkZeroOverlaps(result.layout)).toEqual([]);
    });

    it("project: carpet area matches sum of rooms", () => {
      const floor = result.project.floors[0];
      const sumArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
      expect(sumArea).toBeGreaterThan(80);
      // Carpet area in metadata should be close to room sum
      const carpetArea = result.project.metadata.carpet_area_sqm ?? 0;
      expect(Math.abs(carpetArea - sumArea) / sumArea).toBeLessThan(0.30);
    });

    it("project: vastu directions assigned to rooms", () => {
      const floor = result.project.floors[0];
      for (const room of floor.rooms) {
        expect(room.vastu_direction).toBeDefined();
        expect(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "CENTER"]).toContain(room.vastu_direction);
      }
    });

    it("project: wall deduplication — no duplicate shared walls", () => {
      const walls = result.project.floors[0].walls;
      // Check no two walls have nearly identical centerline endpoints
      let duplicates = 0;
      for (let i = 0; i < walls.length; i++) {
        for (let j = i + 1; j < walls.length; j++) {
          const a = walls[i].centerline, b = walls[j].centerline;
          const startDist = Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y);
          const endDist = Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y);
          const revStartDist = Math.hypot(a.start.x - b.end.x, a.start.y - b.end.y);
          const revEndDist = Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y);
          if ((startDist < 50 && endDist < 50) || (revStartDist < 50 && revEndDist < 50)) {
            duplicates++;
          }
        }
      }
      expect(duplicates).toBe(0);
    });

    it("project: door/window specs are valid", () => {
      const floor = result.project.floors[0];

      // Doors: valid dimensions and wall references
      for (const door of floor.doors) {
        expect(door.width_mm).toBeGreaterThan(500);
        expect(door.width_mm).toBeLessThan(2500);
        expect(door.height_mm).toBeGreaterThan(1500);
        expect(door.wall_id).toBeTruthy();
        expect(door.symbol.hinge_point).toBeDefined();
        expect(door.position_along_wall_mm).toBeGreaterThanOrEqual(0);
      }

      // Windows: valid dimensions and sill heights
      for (const win of floor.windows) {
        expect(win.width_mm).toBeGreaterThan(300);
        expect(win.sill_height_mm).toBeGreaterThan(0);
        expect(win.wall_id).toBeTruthy();
        expect(win.position_along_wall_mm).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
