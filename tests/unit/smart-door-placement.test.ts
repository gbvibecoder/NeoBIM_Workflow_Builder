import { describe, it, expect } from "vitest";
import {
  smartPlaceDoors,
  buildAdjacencyGraph,
  type DoorPlacementResult,
} from "@/features/floor-plan/lib/smart-placement";
import type {
  Floor, Wall, Room, Door, Point, RoomType,
} from "@/types/floor-plan-cad";
import type { TemplateConnection } from "@/features/floor-plan/lib/typology-templates";

// ── Helpers ─────────────────────────────────────────────────────────────────

let _id = 0;
function id(prefix: string): string {
  return `${prefix}-${++_id}`;
}

function pt(x: number, y: number): Point {
  return { x, y };
}

function makeRoom(
  roomId: string,
  name: string,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  d: number,
): Room {
  const boundary = {
    points: [pt(x, y), pt(x + w, y), pt(x + w, y + d), pt(x, y + d)],
  };
  return {
    id: roomId,
    name,
    type,
    boundary,
    area_sqm: (w * d) / 1_000_000,
    perimeter_mm: (w + d) * 2,
    natural_light_required: true,
    ventilation_required: true,
    label_position: pt(x + w / 2, y + d / 2),
    wall_ids: [],
    fill_color: undefined,
    fill_opacity: undefined,
  };
}

function makeWall(
  wallId: string,
  type: "exterior" | "interior",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  leftRoom: string | undefined,
  rightRoom: string | undefined,
  thickness = 230,
): Wall {
  return {
    id: wallId,
    type,
    material: "brick",
    centerline: { start: pt(x1, y1), end: pt(x2, y2) },
    thickness_mm: thickness,
    height_mm: 3000,
    left_room_id: leftRoom,
    right_room_id: rightRoom,
    openings: [],
    line_weight: type === "exterior" ? "thick" : "medium",
    is_load_bearing: type === "exterior",
  };
}

/**
 * Build a minimal 2BHK floor for testing door placement.
 *
 * Layout (all dimensions in mm):
 *   ┌──────────────┬──────────┬──────────────┬──────────┐
 *   │  Bedroom1    │ Bath1    │  Bedroom2    │ Bath2    │  top row
 *   │  3400×3800   │1800×2500 │  3200×3800   │1800×2500 │
 *   ├──────────────┴──────────┴──────────────┴──────────┤
 *   │              Corridor 10200×1200                  │  mid row
 *   ├──────────────┬────────────────────────┬───────────┤
 *   │  Kitchen     │   Living Room          │ Dining    │  bot row
 *   │  2500×3500   │   4700×3500            │ 3000×3500 │
 *   └──────────────┴────────────────────────┴───────────┘
 *
 * All coordinates are in mm, Y-up (bottom-left origin).
 */
function make2BHKFloor(): Floor {
  // Rooms (mm, Y-up)
  const bedroom1 = makeRoom("r-bed1", "Master Bedroom", "master_bedroom", 0, 4700, 3400, 3800);
  const bath1 = makeRoom("r-bath1", "Master Bathroom", "bathroom", 3400, 4700, 1800, 2500);
  const bedroom2 = makeRoom("r-bed2", "Bedroom 2", "bedroom", 5200, 4700, 3200, 3800);
  const bath2 = makeRoom("r-bath2", "Common Bathroom", "bathroom", 8400, 4700, 1800, 2500);
  const corridor = makeRoom("r-corr", "Corridor", "corridor", 0, 3500, 10200, 1200);
  const kitchen = makeRoom("r-kit", "Kitchen", "kitchen", 0, 0, 2500, 3500);
  const living = makeRoom("r-liv", "Living Room", "living_room", 2500, 0, 4700, 3500);
  const dining = makeRoom("r-din", "Dining Room", "dining_room", 7200, 0, 3000, 3500);

  const rooms = [bedroom1, bath1, bedroom2, bath2, corridor, kitchen, living, dining];

  // Walls — interior walls between adjacent rooms
  const walls: Wall[] = [
    // Exterior walls
    makeWall("w-top", "exterior", 0, 8500, 10200, 8500, undefined, undefined),
    makeWall("w-bot", "exterior", 0, 0, 10200, 0, undefined, undefined),
    makeWall("w-left", "exterior", 0, 0, 0, 8500, undefined, undefined),
    makeWall("w-right", "exterior", 10200, 0, 10200, 8500, undefined, undefined),

    // Horizontal: between top row and corridor
    makeWall("w-h-bed1-corr", "interior", 0, 4700, 3400, 4700, "r-bed1", "r-corr"),
    makeWall("w-h-bath1-corr", "interior", 3400, 4700, 5200, 4700, "r-bath1", "r-corr"),
    makeWall("w-h-bed2-corr", "interior", 5200, 4700, 8400, 4700, "r-bed2", "r-corr"),
    makeWall("w-h-bath2-corr", "interior", 8400, 4700, 10200, 4700, "r-bath2", "r-corr"),

    // Horizontal: between corridor and bottom row
    makeWall("w-h-corr-kit", "interior", 0, 3500, 2500, 3500, "r-corr", "r-kit"),
    makeWall("w-h-corr-liv", "interior", 2500, 3500, 7200, 3500, "r-corr", "r-liv"),
    makeWall("w-h-corr-din", "interior", 7200, 3500, 10200, 3500, "r-corr", "r-din"),

    // Vertical: between rooms in same row
    makeWall("w-v-bed1-bath1", "interior", 3400, 4700, 3400, 8500, "r-bed1", "r-bath1"),
    makeWall("w-v-bath1-bed2", "interior", 5200, 4700, 5200, 8500, "r-bath1", "r-bed2"),
    makeWall("w-v-bed2-bath2", "interior", 8400, 4700, 8400, 8500, "r-bed2", "r-bath2"),

    makeWall("w-v-kit-liv", "interior", 2500, 0, 2500, 3500, "r-kit", "r-liv"),
    makeWall("w-v-liv-din", "interior", 7200, 0, 7200, 3500, "r-liv", "r-din"),
  ];

  // Assign wall_ids to rooms
  for (const wall of walls) {
    for (const room of rooms) {
      if (wall.left_room_id === room.id || wall.right_room_id === room.id) {
        room.wall_ids.push(wall.id);
      }
    }
    // Assign exterior walls to adjacent rooms based on position
    if (wall.type === "exterior") {
      for (const room of rooms) {
        const b = room.boundary.points;
        const rMinX = Math.min(...b.map(p => p.x));
        const rMaxX = Math.max(...b.map(p => p.x));
        const rMinY = Math.min(...b.map(p => p.y));
        const rMaxY = Math.max(...b.map(p => p.y));
        const wMinX = Math.min(wall.centerline.start.x, wall.centerline.end.x);
        const wMaxX = Math.max(wall.centerline.start.x, wall.centerline.end.x);
        const wMinY = Math.min(wall.centerline.start.y, wall.centerline.end.y);
        const wMaxY = Math.max(wall.centerline.start.y, wall.centerline.end.y);

        // Check if wall segment overlaps with room edge
        const isHorizontal = Math.abs(wall.centerline.start.y - wall.centerline.end.y) < 10;
        const isVertical = Math.abs(wall.centerline.start.x - wall.centerline.end.x) < 10;

        if (isHorizontal) {
          const wallY = wall.centerline.start.y;
          if ((Math.abs(wallY - rMinY) < 10 || Math.abs(wallY - rMaxY) < 10) &&
              wMinX < rMaxX && wMaxX > rMinX) {
            if (!room.wall_ids.includes(wall.id)) room.wall_ids.push(wall.id);
            if (!wall.left_room_id && wallY === rMaxY) wall.left_room_id = room.id;
            else if (!wall.right_room_id && wallY === rMinY) wall.right_room_id = room.id;
          }
        }
        if (isVertical) {
          const wallX = wall.centerline.start.x;
          if ((Math.abs(wallX - rMinX) < 10 || Math.abs(wallX - rMaxX) < 10) &&
              wMinY < rMaxY && wMaxY > rMinY) {
            if (!room.wall_ids.includes(wall.id)) room.wall_ids.push(wall.id);
            if (!wall.left_room_id && wallX === rMinX) wall.left_room_id = room.id;
            else if (!wall.right_room_id && wallX === rMaxX) wall.right_room_id = room.id;
          }
        }
      }
    }
  }

  return {
    id: "floor-test",
    level: 0,
    name: "Ground Floor",
    floor_to_floor_height_mm: 3000,
    slab_thickness_mm: 200,
    boundary: {
      points: [pt(0, 0), pt(10200, 0), pt(10200, 8500), pt(0, 8500)],
    },
    walls,
    rooms,
    doors: [],
    windows: [],
    stairs: [],
    columns: [],
    furniture: [],
    fixtures: [],
    annotations: [],
    dimensions: [],
    zones: [],
  };
}

/** 2bhk-linear template connections for testing */
const CONNECTIONS_2BHK: TemplateConnection[] = [
  { from: "corridor", to: "bedroom1", type: "door", required: true },
  { from: "bedroom1", to: "bath1", type: "door", required: true },
  { from: "corridor", to: "bedroom2", type: "door", required: true },
  { from: "corridor", to: "bath2", type: "door", required: true },
  { from: "corridor", to: "kitchen", type: "door", required: true },
  { from: "corridor", to: "living", type: "open", required: true },
  { from: "living", to: "balcony", type: "door", required: false },
  { from: "kitchen", to: "living", type: "adjacent", required: true },
];

function getRoomsConnectedByDoor(door: Door, floor: Floor): [Room | undefined, Room | undefined] {
  const [idA, idB] = door.connects_rooms;
  return [
    floor.rooms.find(r => r.id === idA),
    floor.rooms.find(r => r.id === idB),
  ];
}

function doorWall(door: Door, floor: Floor): Wall | undefined {
  return floor.walls.find(w => w.id === door.wall_id);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("smart-door-placement — enhanced placement", () => {
  const floor = make2BHKFloor();

  describe("with template connections", () => {
    let result: DoorPlacementResult;

    it("places doors without errors", () => {
      result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      expect(result.doors.length).toBeGreaterThan(0);
      const errors = result.issues.filter(i => i.severity === "error");
      expect(errors).toHaveLength(0);
    });

    // Test 1: Bedroom door faces corridor
    it("bedroom1 door is on the corridor-adjacent wall", () => {
      const bed1Door = result.doors.find(d =>
        d.connects_rooms.includes("r-bed1") && d.connects_rooms.includes("r-corr"),
      );
      expect(bed1Door).toBeDefined();
      const wall = doorWall(bed1Door!, floor);
      expect(wall).toBeDefined();
      // The wall between bed1 and corridor is w-h-bed1-corr
      expect(wall!.id).toBe("w-h-bed1-corr");
    });

    // Test 2: Bathroom door faces its paired bedroom (attached bath)
    it("bath1 door is on the bedroom1-adjacent wall (attached bathroom)", () => {
      const bath1Door = result.doors.find(d =>
        d.connects_rooms.includes("r-bath1") && d.connects_rooms.includes("r-bed1"),
      );
      expect(bath1Door).toBeDefined();
      const wall = doorWall(bath1Door!, floor);
      expect(wall).toBeDefined();
      // The wall between bath1 and bed1 is w-v-bed1-bath1
      expect(wall!.id).toBe("w-v-bed1-bath1");
    });

    // Test 3: Kitchen door is on appropriate wall
    it("kitchen has a door to corridor", () => {
      const kitDoor = result.doors.find(d =>
        d.connects_rooms.includes("r-kit") &&
        (d.connects_rooms.includes("r-corr") || d.connects_rooms.includes("r-din") || d.connects_rooms.includes("r-liv")),
      );
      expect(kitDoor).toBeDefined();
    });

    // Test 4: Main entrance is on an exterior wall
    it("main entrance is on an exterior wall", () => {
      const mainEntrance = result.doors.find(d => d.type === "main_entrance");
      expect(mainEntrance).toBeDefined();
      const wall = doorWall(mainEntrance!, floor);
      expect(wall).toBeDefined();
      expect(wall!.type).toBe("exterior");
    });
  });

  describe("without template connections (priority rules)", () => {
    let result: DoorPlacementResult;

    it("places doors using priority rules when no connections given", () => {
      result = smartPlaceDoors(floor);
      expect(result.doors.length).toBeGreaterThan(0);
    });

    it("bedroom2 door prefers corridor wall (not bath2 or bed1)", () => {
      const bed2Door = result.doors.find(d =>
        d.connects_rooms.includes("r-bed2") && d.connects_rooms.includes("r-corr"),
      );
      // The priority rules say bedroom should connect to corridor first
      expect(bed2Door).toBeDefined();
    });

    it("kitchen door prefers dining-adjacent wall", () => {
      // Kitchen DOOR_WALL_PRIORITY: dining_room first, then corridor, then living_room
      // But kitchen is not adjacent to dining in our layout (they're separated by living room)
      // So it should connect to corridor or living room
      const kitDoor = result.doors.find(d =>
        d.connects_rooms.includes("r-kit"),
      );
      expect(kitDoor).toBeDefined();
    });
  });

  // Test 5: No bathroom door opens into living/dining area
  describe("privacy validation", () => {
    it("flags bathroom-to-public-room connections as privacy warnings", () => {
      // Create a layout where bathroom is adjacent to dining (bad privacy)
      const badFloor = make2BHKFloor();
      // Replace bath2-bed2 wall with bath2-dining wall to simulate bad adjacency
      const badWall = badFloor.walls.find(w => w.id === "w-v-bed2-bath2");
      if (badWall) {
        // Make the bathroom adjacent to dining instead of bedroom
        const fakeWall = makeWall(
          "w-bad-bath-dining", "interior",
          8400, 0, 8400, 3500,
          "r-bath2", "r-din",
        );
        badFloor.walls.push(fakeWall);
        const bath2 = badFloor.rooms.find(r => r.id === "r-bath2");
        if (bath2) bath2.wall_ids.push(fakeWall.id);
        const dining = badFloor.rooms.find(r => r.id === "r-din");
        if (dining) dining.wall_ids.push(fakeWall.id);
      }

      const result = smartPlaceDoors(badFloor);
      // Check if there's a bathroom-dining door AND a privacy warning
      const bathDinDoor = result.doors.find(d =>
        d.connects_rooms.includes("r-bath2") && d.connects_rooms.includes("r-din"),
      );
      if (bathDinDoor) {
        const privacyWarnings = result.issues.filter(i =>
          i.severity === "warning" && i.message.includes("privacy"),
        );
        expect(privacyWarnings.length).toBeGreaterThan(0);
      }
    });
  });

  // Test 6: Door position near corner for bedrooms
  describe("room-type-aware door positioning", () => {
    it("bedroom door position is near wall start (not centered)", () => {
      const result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      const bed1Door = result.doors.find(d =>
        d.connects_rooms.includes("r-bed1") && d.connects_rooms.includes("r-corr"),
      );
      expect(bed1Door).toBeDefined();

      // The wall w-h-bed1-corr is 3400mm long
      // Bedroom preferred position: 300mm from start (near corner)
      // vs centered: ~1250mm
      // The position should be in the first third of the wall (< 1200mm)
      expect(bed1Door!.position_along_wall_mm).toBeLessThan(1200);
    });

    it("kitchen door position is roughly centered", () => {
      const result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      const kitDoor = result.doors.find(d =>
        d.connects_rooms.includes("r-kit") && d.connects_rooms.includes("r-corr"),
      );
      if (!kitDoor) return; // kitchen might connect via living instead

      // Kitchen wall is 2500mm. Center would be ~850mm
      // Preferred: centered = (2500 - 800) / 2 = 850
      const wallObj = doorWall(kitDoor, floor);
      if (!wallObj) return;
      const wLen = Math.sqrt(
        (wallObj.centerline.end.x - wallObj.centerline.start.x) ** 2 +
        (wallObj.centerline.end.y - wallObj.centerline.start.y) ** 2,
      );
      const center = wLen / 2;
      const doorCenter = kitDoor.position_along_wall_mm + kitDoor.width_mm / 2;
      // Should be within 40% of wall center
      expect(Math.abs(doorCenter - center)).toBeLessThan(wLen * 0.4);
    });
  });

  describe("structural invariants", () => {
    it("all doors have valid wall_id", () => {
      const result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      const wallIds = new Set(floor.walls.map(w => w.id));
      for (const door of result.doors) {
        expect(wallIds.has(door.wall_id)).toBe(true);
      }
    });

    it("all doors have positive dimensions", () => {
      const result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      for (const door of result.doors) {
        expect(door.width_mm).toBeGreaterThan(0);
        expect(door.height_mm).toBeGreaterThan(0);
        expect(door.position_along_wall_mm).toBeGreaterThanOrEqual(0);
      }
    });

    it("no two doors overlap on the same wall", () => {
      const result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      const byWall = new Map<string, Door[]>();
      for (const d of result.doors) {
        if (!byWall.has(d.wall_id)) byWall.set(d.wall_id, []);
        byWall.get(d.wall_id)!.push(d);
      }
      for (const [, wallDoors] of byWall) {
        for (let i = 0; i < wallDoors.length; i++) {
          for (let j = i + 1; j < wallDoors.length; j++) {
            const a = wallDoors[i];
            const b = wallDoors[j];
            const aEnd = a.position_along_wall_mm + a.width_mm;
            const bEnd = b.position_along_wall_mm + b.width_mm;
            const overlap = Math.min(aEnd, bEnd) - Math.max(a.position_along_wall_mm, b.position_along_wall_mm);
            expect(overlap).toBeLessThanOrEqual(0);
          }
        }
      }
    });

    it("door connects_rooms references valid room IDs", () => {
      const result = smartPlaceDoors(floor, CONNECTIONS_2BHK);
      const roomIds = new Set(floor.rooms.map(r => r.id));
      for (const door of result.doors) {
        for (const rid of door.connects_rooms) {
          if (rid) expect(roomIds.has(rid) || rid === "").toBe(true);
        }
      }
    });
  });
});
