/**
 * Multi-Floor Generation Tests
 *
 * Tests for:
 * - programRoomsFallback() duplex/multi-story detection
 * - layoutMultiFloor() multi-floor BSP layout
 * - convertMultiFloorToProject() multi-floor CAD conversion
 */

import { describe, it, expect } from "vitest";
import { programRoomsFallback } from "@/features/floor-plan/lib/ai-room-programmer";
import { layoutMultiFloor } from "@/features/floor-plan/lib/layout-engine";
import { convertMultiFloorToProject, convertGeometryToProject } from "@/features/floor-plan/lib/pipeline-adapter";
import type { FloorPlanGeometry } from "@/features/floor-plan/types/floor-plan";

describe("Multi-Floor Generation", () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 1: programRoomsFallback duplex detection
  // ═══════════════════════════════════════════════════════════════════════════

  describe("programRoomsFallback — multi-floor detection", () => {

    it("detects 'duplex' keyword and sets numFloors=2", () => {
      const result = programRoomsFallback("3bhk duplex villa 200 sqm");
      expect(result.numFloors).toBe(2);
      expect(result.buildingType).toBe("Duplex");
    });

    it("detects '2-story' keyword", () => {
      const result = programRoomsFallback("4bhk 2-story house");
      expect(result.numFloors).toBe(2);
    });

    it("detects 'two floor' keyword", () => {
      const result = programRoomsFallback("3bhk two floor apartment");
      expect(result.numFloors).toBe(2);
    });

    it("detects 'ground floor + first floor' pattern", () => {
      const result = programRoomsFallback("3bhk with ground floor living and first floor bedrooms");
      expect(result.numFloors).toBe(2);
    });

    it("single floor prompt returns numFloors=1", () => {
      const result = programRoomsFallback("3bhk apartment 120 sqm");
      expect(result.numFloors).toBe(1);
    });

    it("duplex assigns floors to rooms correctly", () => {
      const result = programRoomsFallback("3bhk duplex");
      expect(result.numFloors).toBe(2);

      // Public rooms on ground floor
      const livingRoom = result.rooms.find(r => r.name.includes("Living"));
      expect(livingRoom?.floor).toBe(0);

      // Kitchen on ground floor
      const kitchen = result.rooms.find(r => r.type === "kitchen");
      expect(kitchen?.floor).toBe(0);

      // Bedrooms on first floor
      const masterBed = result.rooms.find(r => r.name === "Master Bedroom");
      expect(masterBed?.floor).toBe(1);

      // Staircases exist on both floors
      const stairs = result.rooms.filter(r => r.type === "staircase");
      expect(stairs.length).toBe(2);
      const stairFloors = stairs.map(s => s.floor).sort();
      expect(stairFloors).toEqual([0, 1]);
    });

    it("duplex rooms have no floor=undefined", () => {
      const result = programRoomsFallback("2bhk duplex");
      expect(result.numFloors).toBe(2);
      for (const room of result.rooms) {
        expect(room.floor).toBeDefined();
        expect(typeof room.floor).toBe("number");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Full pipeline: fallback → layoutMultiFloor → convertMultiFloorToProject
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Full multi-floor pipeline", () => {

    it("3BHK duplex: full pipeline produces valid multi-floor project", () => {
      const program = programRoomsFallback("3bhk duplex villa");
      expect(program.numFloors).toBe(2);

      const layout = layoutMultiFloor(program);
      expect(layout.floors.length).toBe(2);

      const project = convertMultiFloorToProject(
        layout.floors, "3BHK Duplex Villa", "3bhk duplex villa",
      );

      // Project has 2 floors
      expect(project.floors.length).toBe(2);
      expect(project.floors[0].name).toBe("Ground Floor");
      expect(project.floors[0].level).toBe(0);
      expect(project.floors[1].name).toBe("First Floor");
      expect(project.floors[1].level).toBe(1);

      // Each floor has rooms, walls, doors, windows
      for (const floor of project.floors) {
        expect(floor.rooms.length).toBeGreaterThan(0);
        expect(floor.walls.length).toBeGreaterThan(0);
        expect(floor.doors.length).toBeGreaterThan(0);
        expect(floor.windows.length).toBeGreaterThanOrEqual(0);
      }

      // Metadata reflects multi-floor
      expect(project.metadata.num_floors).toBe(2);
      expect(project.metadata.carpet_area_sqm).toBeGreaterThan(0);
      expect(project.metadata.original_prompt).toBe("3bhk duplex villa");
    });

    it("2BHK duplex: rooms are correctly distributed across floors", () => {
      const program = programRoomsFallback("2bhk duplex");
      const layout = layoutMultiFloor(program);
      const project = convertMultiFloorToProject(layout.floors, "Test", "2bhk duplex");

      // Ground floor should have living/kitchen
      const gfRoomNames = project.floors[0].rooms.map(r => r.name);
      const hasPublicOnGF = gfRoomNames.some(n =>
        n.toLowerCase().includes("living") || n.toLowerCase().includes("dining"),
      );
      expect(hasPublicOnGF).toBe(true);

      // First floor should have master bedroom
      const ffRoomNames = project.floors[1].rooms.map(r => r.name);
      const hasBedroomOnFF = ffRoomNames.some(n =>
        n.toLowerCase().includes("master") || n.toLowerCase().includes("bedroom"),
      );
      expect(hasBedroomOnFF).toBe(true);
    });

    it("all rooms have valid mm coordinates (Y-up)", () => {
      const program = programRoomsFallback("3bhk duplex");
      const layout = layoutMultiFloor(program);
      const project = convertMultiFloorToProject(layout.floors, "Test");

      for (const floor of project.floors) {
        for (const room of floor.rooms) {
          // All boundary points should be >= -1 (floating point tolerance)
          for (const pt of room.boundary.points) {
            expect(pt.x).toBeGreaterThanOrEqual(-1);
            expect(pt.y).toBeGreaterThanOrEqual(-1);
          }
          // Area should be positive
          expect(room.area_sqm).toBeGreaterThan(0);
        }
      }
    });

    it("walls reference valid room IDs", () => {
      const program = programRoomsFallback("2bhk duplex");
      const layout = layoutMultiFloor(program);
      const project = convertMultiFloorToProject(layout.floors, "Test");

      for (const floor of project.floors) {
        const roomIds = new Set(floor.rooms.map(r => r.id));
        for (const wall of floor.walls) {
          if (wall.left_room_id) {
            expect(roomIds.has(wall.left_room_id)).toBe(true);
          }
        }
      }
    });

    it("doors have valid wall references", () => {
      const program = programRoomsFallback("3bhk duplex");
      const layout = layoutMultiFloor(program);
      const project = convertMultiFloorToProject(layout.floors, "Test");

      for (const floor of project.floors) {
        const wallIds = new Set(floor.walls.map(w => w.id));
        for (const door of floor.doors) {
          expect(wallIds.has(door.wall_id)).toBe(true);
          expect(door.width_mm).toBeGreaterThan(0);
          expect(door.position_along_wall_mm).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-Furniture Placement
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Auto-furniture placement", () => {

    it("single floor plan gets furniture placed automatically", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 12, depth: 10 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living Room", type: "living", x: 0, y: 0, width: 6, depth: 5, center: [3, 2.5], area: 30 },
          { name: "Master Bedroom", type: "bedroom", x: 6, y: 0, width: 6, depth: 5, center: [9, 2.5], area: 30 },
          { name: "Kitchen", type: "kitchen", x: 0, y: 5, width: 5, depth: 5, center: [2.5, 7.5], area: 25 },
          { name: "Bathroom", type: "bathroom", x: 5, y: 5, width: 3, depth: 5, center: [6.5, 7.5], area: 15 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];

      // Furniture should be auto-placed
      expect(floor.furniture.length).toBeGreaterThan(0);

      // Each furniture item should have valid properties
      for (const f of floor.furniture) {
        expect(f.id).toBeTruthy();
        expect(f.catalog_id).toBeTruthy();
        expect(f.room_id).toBeTruthy();
        expect(typeof f.position.x).toBe("number");
        expect(typeof f.position.y).toBe("number");
      }
    });

    it("multi-floor duplex gets furniture on both floors", () => {
      const program = programRoomsFallback("3bhk duplex");
      const layout = layoutMultiFloor(program);
      const project = convertMultiFloorToProject(layout.floors, "Test");

      // Both floors should have furniture
      for (const floor of project.floors) {
        expect(floor.furniture.length).toBeGreaterThan(0);
      }
    });

    it("furniture references valid room IDs", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 10, depth: 8 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living Room", type: "living", x: 0, y: 0, width: 5, depth: 4, center: [2.5, 2], area: 20 },
          { name: "Bedroom", type: "bedroom", x: 5, y: 0, width: 5, depth: 4, center: [7.5, 2], area: 20 },
          { name: "Kitchen", type: "kitchen", x: 0, y: 4, width: 5, depth: 4, center: [2.5, 6], area: 20 },
          { name: "Bathroom", type: "bathroom", x: 5, y: 4, width: 5, depth: 4, center: [7.5, 6], area: 20 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];
      const roomIds = new Set(floor.rooms.map(r => r.id));

      for (const f of floor.furniture) {
        expect(roomIds.has(f.room_id)).toBe(true);
      }
    });

    it("living room gets sofa and coffee table", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 8, depth: 6 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living Room", type: "living", x: 0, y: 0, width: 8, depth: 6, center: [4, 3], area: 48 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];
      const livingFurn = floor.furniture.filter(f => {
        const room = floor.rooms.find(r => r.id === f.room_id);
        return room?.type === "living_room";
      });

      expect(livingFurn.length).toBeGreaterThan(0);
      const catalogIds = livingFurn.map(f => f.catalog_id);
      expect(catalogIds.some(id => id.includes("sofa"))).toBe(true);
    });

    it("no crash on empty geometry (graceful degradation)", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 5, depth: 5 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [],
      };

      const project = convertGeometryToProject(geometry, "Empty");
      expect(project.floors.length).toBe(1);
      expect(project.floors[0].furniture).toEqual([]);
    });

    it("bedroom gets bed and wardrobe", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 6, depth: 5 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Master Bedroom", type: "bedroom", x: 0, y: 0, width: 6, depth: 5, center: [3, 2.5], area: 30 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];
      const bedFurn = floor.furniture;

      expect(bedFurn.length).toBeGreaterThan(0);
      const catalogIds = bedFurn.map(f => f.catalog_id);
      expect(catalogIds.some(id => id.includes("bed"))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Staircase Generation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Staircase generation", () => {

    it("staircase room gets Stair object with treads", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 10, depth: 8 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living Room", type: "living", x: 0, y: 0, width: 7, depth: 8, center: [3.5, 4], area: 56 },
          { name: "Staircase", type: "staircase", x: 7, y: 0, width: 3, depth: 8, center: [8.5, 4], area: 24 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];

      expect(floor.stairs.length).toBeGreaterThan(0);

      const stair = floor.stairs[0];
      expect(stair.type).toBe("dog_leg");
      expect(stair.num_risers).toBeGreaterThan(10); // ~17 risers for 3m floor
      expect(stair.riser_height_mm).toBe(175);
      expect(stair.tread_depth_mm).toBe(250);
      expect(stair.width_mm).toBe(1200);
      expect(stair.treads.length).toBeGreaterThan(0);
      expect(stair.has_railing).toBe(true);
      expect(stair.connects_floors).toEqual([0, 1]);
    });

    it("staircase gets UP annotation on ground floor", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 8, depth: 6 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Room", type: "living", x: 0, y: 0, width: 5, depth: 6, center: [2.5, 3], area: 30 },
          { name: "Staircase", type: "staircase", x: 5, y: 0, width: 3, depth: 6, center: [6.5, 3], area: 18 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];

      const stairAnnotation = floor.annotations.find(a => a.text === "UP");
      expect(stairAnnotation).toBeDefined();
    });

    it("non-staircase rooms get no Stair objects", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 8, depth: 6 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living", type: "living", x: 0, y: 0, width: 8, depth: 6, center: [4, 3], area: 48 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      expect(project.floors[0].stairs.length).toBe(0);
    });

    it("duplex has stairs on both floors", () => {
      const program = programRoomsFallback("3bhk duplex");
      const layout = layoutMultiFloor(program);
      const project = convertMultiFloorToProject(layout.floors, "Test");

      // Both floors should have stair objects (since both have staircase rooms)
      for (const floor of project.floors) {
        const hasStaircaseRoom = floor.rooms.some(r =>
          r.type === "staircase" || r.name.toLowerCase().includes("staircase"),
        );
        if (hasStaircaseRoom) {
          expect(floor.stairs.length).toBeGreaterThan(0);
        }
      }
    });

    it("stair treads are within staircase room bounds", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 10, depth: 8 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Hall", type: "living", x: 0, y: 0, width: 7, depth: 8, center: [3.5, 4], area: 56 },
          { name: "Staircase", type: "staircase", x: 7, y: 0, width: 3, depth: 8, center: [8.5, 4], area: 24 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test");
      const floor = project.floors[0];
      const stair = floor.stairs[0];

      if (stair && stair.treads.length > 0) {
        const bounds = stair.boundary.points;
        const xs = bounds.map(p => p.x);
        const ys = bounds.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        for (const tread of stair.treads) {
          expect(tread.start.x).toBeGreaterThanOrEqual(minX - 1);
          expect(tread.end.x).toBeLessThanOrEqual(maxX + 1);
          expect(tread.start.y).toBeGreaterThanOrEqual(minY - 1);
          expect(tread.end.y).toBeLessThanOrEqual(maxY + 1);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Smart Annotations from Prompt
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Smart annotations from prompt", () => {

    it("adds 'Dbl Height' annotation for double height prompt", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 10, depth: 8 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living Room", type: "living", x: 0, y: 0, width: 10, depth: 8, center: [5, 4], area: 80 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test", "3bhk with double height living room");
      const ann = project.floors[0].annotations.find(a => a.text === "Dbl Height");
      expect(ann).toBeDefined();
      expect(ann!.type).toBe("leader");
    });

    it("adds 'Kitchen Island' annotation for island kitchen prompt", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 8, depth: 6 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Kitchen", type: "kitchen", x: 0, y: 0, width: 8, depth: 6, center: [4, 3], area: 48 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test", "4bhk with kitchen island and modular kitchen");
      const annotations = project.floors[0].annotations.filter(
        a => a.text === "Kitchen Island" || a.text === "Modular Kitchen",
      );
      expect(annotations.length).toBeGreaterThanOrEqual(1);
    });

    it("adds 'Western WC' for western toilet prompt", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 6, depth: 4 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Bathroom", type: "bathroom", x: 0, y: 0, width: 6, depth: 4, center: [3, 2], area: 24 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test", "2bhk with western toilet");
      const ann = project.floors[0].annotations.find(a => a.text === "Western WC");
      expect(ann).toBeDefined();
    });

    it("no annotations for plain prompt", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 8, depth: 6 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Living Room", type: "living", x: 0, y: 0, width: 8, depth: 6, center: [4, 3], area: 48 },
        ],
      };

      const project = convertGeometryToProject(geometry, "Test", "2bhk apartment");
      // Only staircase annotations should be present (none here since no staircase)
      const smartAnnotations = project.floors[0].annotations.filter(
        a => a.type === "leader",
      );
      expect(smartAnnotations.length).toBe(0);
    });

    it("no crash when prompt is undefined", () => {
      const geometry: FloorPlanGeometry = {
        footprint: { width: 6, depth: 5 },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: [
          { name: "Room", type: "living", x: 0, y: 0, width: 6, depth: 5, center: [3, 2.5], area: 30 },
        ],
      };

      // No originalPrompt
      const project = convertGeometryToProject(geometry, "Test");
      expect(project.floors.length).toBe(1);
    });
  });
});
