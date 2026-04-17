/**
 * Design Quality Checker
 *
 * Algorithmic checks for ARCHITECTURAL DESIGN quality — circulation flow,
 * privacy, room proportions, orientation, and livability. No LLM calls.
 *
 * Returns a structured report with scored issues and actionable fix suggestions
 * that the Coordinator can feed back into the Designer for re-layout.
 */

import type { FloorPlanProject, Floor, Room, Door, Wall, RoomType } from '@/types/floor-plan-cad';
import { wallLength } from '@/features/floor-plan/lib/geometry';

// ============================================================
// TYPES
// ============================================================

export type DesignCategory = 'circulation' | 'privacy' | 'proportion' | 'orientation' | 'livability';

export interface DesignFix {
  type: 'swap_rooms' | 'resize_room' | 'add_adjacency' | 'move_room_to_perimeter';
  params: Record<string, unknown>;
}

export interface DesignIssue {
  category: DesignCategory;
  severity: 'critical' | 'warning' | 'suggestion';
  message: string;
  affectedRooms: string[];
  fixAction?: DesignFix;
}

export interface DesignQualityReport {
  issues: DesignIssue[];
  score: number;   // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

// ============================================================
// ROOM CLASSIFICATION HELPERS
// ============================================================

const BEDROOM_TYPES: ReadonlySet<RoomType> = new Set([
  'bedroom', 'master_bedroom', 'guest_bedroom',
]);
const WET_TYPES: ReadonlySet<RoomType> = new Set([
  'bathroom', 'toilet', 'wc',
]);
const PUBLIC_TYPES: ReadonlySet<RoomType> = new Set([
  'living_room', 'dining_room', 'foyer', 'lobby',
]);
const CIRCULATION_TYPES: ReadonlySet<RoomType> = new Set([
  'corridor', 'lobby', 'foyer', 'staircase',
]);

function isBedroom(r: Room): boolean { return BEDROOM_TYPES.has(r.type); }
function isBathroom(r: Room): boolean { return WET_TYPES.has(r.type); }
function isPublic(r: Room): boolean { return PUBLIC_TYPES.has(r.type); }
function isCirculation(r: Room): boolean { return CIRCULATION_TYPES.has(r.type); }

function roomBounds(r: Room): { x0: number; y0: number; x1: number; y1: number } {
  const xs = r.boundary.points.map(p => p.x);
  const ys = r.boundary.points.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function roomCenter(r: Room): { x: number; y: number } {
  const b = roomBounds(r);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

/** Find which rooms a door connects by ID lookup */
function doorRooms(door: Door, rooms: Room[]): [Room | undefined, Room | undefined] {
  return [
    rooms.find(r => r.id === door.connects_rooms[0]),
    rooms.find(r => r.id === door.connects_rooms[1]),
  ];
}

/** Check if two rooms are adjacent (share a wall with a door) */
function areConnectedByDoor(a: Room, b: Room, doors: Door[]): boolean {
  return doors.some(d => {
    const [r1, r2] = [d.connects_rooms[0], d.connects_rooms[1]];
    return (r1 === a.id && r2 === b.id) || (r1 === b.id && r2 === a.id);
  });
}

/** Count how many doors open into a room */
function doorCountForRoom(room: Room, doors: Door[]): number {
  return doors.filter(d =>
    d.connects_rooms[0] === room.id || d.connects_rooms[1] === room.id
  ).length;
}

// ============================================================
// MAIN CHECKER
// ============================================================

/**
 * Check architectural design quality of a completed floor plan.
 * All checks are geometric/algorithmic — no LLM calls.
 */
export function checkDesignQuality(project: FloorPlanProject): DesignQualityReport {
  const issues: DesignIssue[] = [];

  for (const floor of project.floors) {
    if (floor.rooms.length === 0) continue;

    checkCorridorEfficiency(floor, issues);
    checkMasterBedroomSize(floor, issues);
    checkLivingRoomProportion(floor, issues);
    checkBathroomProportion(floor, issues);
    checkBathroomPrivacy(floor, issues);
    checkBedroomPrivacyFromEntrance(floor, issues);
    checkDoorSaturation(floor, issues);
    checkKitchenDiningAccess(floor, issues);
    checkBedroomIndependence(floor, issues);
    checkCrossVentilation(floor, issues);
    checkKitchenCounterSpace(floor, issues);
  }

  const score = computeDesignScore(issues);
  return { issues, score, grade: gradeFromScore(score) };
}

// ============================================================
// PROPORTION CHECKS
// ============================================================

/** Corridor area ≤ 15% of total floor area */
function checkCorridorEfficiency(floor: Floor, issues: DesignIssue[]): void {
  const totalArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
  if (totalArea <= 0) return;

  const corridorArea = floor.rooms
    .filter(r => isCirculation(r) && r.type !== 'foyer' && r.type !== 'staircase')
    .reduce((s, r) => s + r.area_sqm, 0);

  const ratio = corridorArea / totalArea;
  if (ratio > 0.20) {
    issues.push({
      category: 'proportion',
      severity: 'warning',
      message: `Corridor uses ${(ratio * 100).toFixed(0)}% of floor area (>${20}% is wasteful)`,
      affectedRooms: floor.rooms.filter(r => isCirculation(r)).map(r => r.name),
      fixAction: { type: 'resize_room', params: { room: 'Corridor', targetAreaRatio: 0.12 } },
    });
  }
}

/** Master bedroom should be ≥ every other bedroom */
function checkMasterBedroomSize(floor: Floor, issues: DesignIssue[]): void {
  const bedrooms = floor.rooms.filter(r => isBedroom(r));
  if (bedrooms.length < 2) return;

  const master = bedrooms.find(r => r.type === 'master_bedroom' || r.name.toLowerCase().includes('master'));
  if (!master) return;

  const otherBeds = bedrooms.filter(r => r.id !== master.id);
  const largerOther = otherBeds.find(r => r.area_sqm > master.area_sqm + 0.5);
  if (largerOther) {
    issues.push({
      category: 'proportion',
      severity: 'warning',
      message: `${largerOther.name} (${largerOther.area_sqm.toFixed(1)} sqm) is larger than ${master.name} (${master.area_sqm.toFixed(1)} sqm)`,
      affectedRooms: [master.name, largerOther.name],
      fixAction: { type: 'swap_rooms', params: { roomA: master.name, roomB: largerOther.name } },
    });
  }
}

/** Living room should be the largest non-parking, non-corridor room */
function checkLivingRoomProportion(floor: Floor, issues: DesignIssue[]): void {
  const living = floor.rooms.find(r => r.type === 'living_room');
  if (!living) return;

  const skip: ReadonlySet<RoomType> = new Set(['corridor', 'lobby', 'parking', 'garage', 'staircase', 'custom']);
  const habitable = floor.rooms.filter(r => !skip.has(r.type) && r.type !== 'living_room');
  const larger = habitable.find(r => r.area_sqm > living.area_sqm + 1);

  if (larger && !BEDROOM_TYPES.has(larger.type)) {
    issues.push({
      category: 'proportion',
      severity: 'suggestion',
      message: `${larger.name} (${larger.area_sqm.toFixed(1)} sqm) is larger than Living Room (${living.area_sqm.toFixed(1)} sqm) — living room should typically be the largest`,
      affectedRooms: [living.name, larger.name],
    });
  }
}

/** Total bathroom area ≤ 20% of total */
function checkBathroomProportion(floor: Floor, issues: DesignIssue[]): void {
  const totalArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
  if (totalArea <= 0) return;

  const bathArea = floor.rooms.filter(r => isBathroom(r)).reduce((s, r) => s + r.area_sqm, 0);
  const ratio = bathArea / totalArea;
  if (ratio > 0.20) {
    issues.push({
      category: 'proportion',
      severity: 'warning',
      message: `Bathrooms use ${(ratio * 100).toFixed(0)}% of floor area (>20% is disproportionate)`,
      affectedRooms: floor.rooms.filter(r => isBathroom(r)).map(r => r.name),
    });
  }
}

// ============================================================
// PRIVACY CHECKS
// ============================================================

/** No bathroom door should open directly into living/dining/kitchen */
function checkBathroomPrivacy(floor: Floor, issues: DesignIssue[]): void {
  for (const door of floor.doors) {
    const [r1, r2] = doorRooms(door, floor.rooms);
    if (!r1 || !r2) continue;

    const bath = isBathroom(r1) ? r1 : isBathroom(r2) ? r2 : null;
    const other = bath === r1 ? r2 : r1;
    if (!bath) continue;

    if (other.type === 'living_room' || other.type === 'dining_room' || other.type === 'kitchen') {
      issues.push({
        category: 'privacy',
        severity: 'warning',
        message: `${bath.name} door opens directly into ${other.name} — privacy concern`,
        affectedRooms: [bath.name, other.name],
        fixAction: { type: 'add_adjacency', params: { roomA: bath.name, roomB: 'Corridor', reason: 'privacy buffer' } },
      });
    }
  }
}

/** Bedrooms should not be directly visible from entrance */
function checkBedroomPrivacyFromEntrance(floor: Floor, issues: DesignIssue[]): void {
  const entrance = floor.doors.find(d => d.type === 'main_entrance');
  if (!entrance) return;

  // Find room the entrance opens into
  const [r1, r2] = doorRooms(entrance, floor.rooms);
  const entryRoom = r1 ?? r2;
  if (!entryRoom) return;

  // Check if any bedroom is directly connected to the entry room
  for (const door of floor.doors) {
    if (door.id === entrance.id) continue;
    const [a, b] = doorRooms(door, floor.rooms);
    if (!a || !b) continue;

    const isEntryDoor = a.id === entryRoom.id || b.id === entryRoom.id;
    const otherRoom = a.id === entryRoom.id ? b : a;

    if (isEntryDoor && isBedroom(otherRoom)) {
      issues.push({
        category: 'privacy',
        severity: 'suggestion',
        message: `${otherRoom.name} is directly accessible from entrance — consider adding a corridor buffer`,
        affectedRooms: [otherRoom.name, entryRoom.name],
      });
    }
  }
}

// ============================================================
// CIRCULATION CHECKS
// ============================================================

/** Kitchen should be reachable from dining without passing through bedrooms */
function checkKitchenDiningAccess(floor: Floor, issues: DesignIssue[]): void {
  const kitchen = floor.rooms.find(r => r.type === 'kitchen');
  const dining = floor.rooms.find(r => r.type === 'dining_room');
  if (!kitchen || !dining) return;

  // BFS from kitchen to dining through doors
  const visited = new Set<string>();
  const queue: Array<{ roomId: string; path: Room[] }> = [{ roomId: kitchen.id, path: [] }];
  visited.add(kitchen.id);

  while (queue.length > 0) {
    const { roomId, path } = queue.shift()!;
    if (roomId === dining.id) {
      // Check if path passes through a bedroom
      const bedroomInPath = path.find(r => isBedroom(r));
      if (bedroomInPath) {
        issues.push({
          category: 'circulation',
          severity: 'critical',
          message: `Path from Kitchen to Dining Room passes through ${bedroomInPath.name}`,
          affectedRooms: [kitchen.name, dining.name, bedroomInPath.name],
          fixAction: { type: 'add_adjacency', params: { roomA: 'Kitchen', roomB: 'Dining Room', reason: 'direct access' } },
        });
      }
      return; // Found path
    }

    for (const door of floor.doors) {
      const [c0, c1] = door.connects_rooms;
      let nextId: string | null = null;
      if (c0 === roomId && c1 && !visited.has(c1)) nextId = c1;
      if (c1 === roomId && c0 && !visited.has(c0)) nextId = c0;
      if (nextId) {
        visited.add(nextId);
        const nextRoom = floor.rooms.find(r => r.id === nextId);
        queue.push({ roomId: nextId, path: [...path, ...(nextRoom ? [nextRoom] : [])] });
      }
    }
  }
}

/** Every bedroom should be reachable from corridor without passing through another bedroom */
function checkBedroomIndependence(floor: Floor, issues: DesignIssue[]): void {
  const bedrooms = floor.rooms.filter(r => isBedroom(r));
  if (bedrooms.length < 2) return;

  const corridors = floor.rooms.filter(r => isCirculation(r));
  if (corridors.length === 0) return; // No corridor = small plan, skip

  const corridorIds = new Set(corridors.map(r => r.id));

  for (const bed of bedrooms) {
    // BFS from this bedroom to any corridor
    const visited = new Set<string>();
    const queue: Array<{ roomId: string; passedBedroom: boolean }> = [
      { roomId: bed.id, passedBedroom: false },
    ];
    visited.add(bed.id);
    let reachedCorridor = false;
    let passedOtherBedroom = false;

    while (queue.length > 0) {
      const { roomId, passedBedroom } = queue.shift()!;
      if (corridorIds.has(roomId)) {
        reachedCorridor = true;
        passedOtherBedroom = passedBedroom;
        break;
      }

      for (const door of floor.doors) {
        const [c0, c1] = door.connects_rooms;
        let nextId: string | null = null;
        if (c0 === roomId && c1 && !visited.has(c1)) nextId = c1;
        if (c1 === roomId && c0 && !visited.has(c0)) nextId = c0;
        if (nextId) {
          visited.add(nextId);
          const nextRoom = floor.rooms.find(r => r.id === nextId);
          const isOtherBed = nextRoom && isBedroom(nextRoom) && nextRoom.id !== bed.id;
          queue.push({ roomId: nextId, passedBedroom: passedBedroom || !!isOtherBed });
        }
      }
    }

    if (reachedCorridor && passedOtherBedroom) {
      issues.push({
        category: 'circulation',
        severity: 'warning',
        message: `${bed.name} can only reach corridor by passing through another bedroom`,
        affectedRooms: [bed.name],
      });
    }
  }
}

// ============================================================
// LIVABILITY CHECKS
// ============================================================

/** No room should have doors on 3+ walls (trapped feeling, no furniture wall) */
function checkDoorSaturation(floor: Floor, issues: DesignIssue[]): void {
  for (const room of floor.rooms) {
    if (isCirculation(room)) continue; // corridors naturally have many doors

    const doorCount = doorCountForRoom(room, floor.doors);
    // Find how many unique walls have doors
    const doorWallIds = new Set(
      floor.doors
        .filter(d => d.connects_rooms[0] === room.id || d.connects_rooms[1] === room.id)
        .map(d => d.wall_id)
    );

    if (doorWallIds.size >= 3) {
      issues.push({
        category: 'livability',
        severity: 'warning',
        message: `${room.name} has doors on ${doorWallIds.size} walls — limits furniture placement`,
        affectedRooms: [room.name],
      });
    }
  }
}

/** Kitchen needs at least 2 consecutive walls without doors/windows for counter placement */
function checkKitchenCounterSpace(floor: Floor, issues: DesignIssue[]): void {
  const kitchen = floor.rooms.find(r => r.type === 'kitchen');
  if (!kitchen) return;

  const kitchenWalls = floor.walls.filter(w =>
    w.left_room_id === kitchen.id || w.right_room_id === kitchen.id
  );

  // Count walls with openings (doors or windows on them)
  const wallsWithOpenings = new Set<string>();
  for (const d of floor.doors) {
    if (d.connects_rooms[0] === kitchen.id || d.connects_rooms[1] === kitchen.id) {
      wallsWithOpenings.add(d.wall_id);
    }
  }
  for (const w of floor.windows) {
    const wall = floor.walls.find(wl => wl.id === w.wall_id);
    if (wall && (wall.left_room_id === kitchen.id || wall.right_room_id === kitchen.id)) {
      wallsWithOpenings.add(w.wall_id);
    }
  }

  const freeWalls = kitchenWalls.filter(w => !wallsWithOpenings.has(w.id));
  if (freeWalls.length < 2) {
    issues.push({
      category: 'livability',
      severity: 'suggestion',
      message: `Kitchen has only ${freeWalls.length} wall(s) without openings — need ≥2 for counter + appliance placement`,
      affectedRooms: [kitchen.name],
    });
  }
}

/** Rooms with windows on only 1 wall lack cross-ventilation */
function checkCrossVentilation(floor: Floor, issues: DesignIssue[]): void {
  for (const room of floor.rooms) {
    if (isCirculation(room) || isBathroom(room)) continue;
    if (room.area_sqm < 12) continue; // Small rooms don't need cross-vent

    // Find walls with windows for this room
    const windowWallIds = new Set<string>();
    for (const w of floor.windows) {
      const wall = floor.walls.find(wl => wl.id === w.wall_id);
      if (wall && (wall.left_room_id === room.id || wall.right_room_id === room.id)) {
        windowWallIds.add(w.wall_id);
      }
    }

    if (windowWallIds.size === 1 && room.area_sqm > 15) {
      issues.push({
        category: 'livability',
        severity: 'suggestion',
        message: `${room.name} (${room.area_sqm.toFixed(0)} sqm) has windows on only 1 wall — cross-ventilation recommended for rooms >15 sqm`,
        affectedRooms: [room.name],
      });
    }
  }
}

// ============================================================
// SCORING
// ============================================================

/**
 * NOTE (Phase 1): this scorer measures *design quality* checks (corridor
 * efficiency, master-bedroom size, bathroom privacy, etc.) — it does NOT
 * measure plot-level fidelity. It has no term for void area, door coverage,
 * orphan rooms, or area shortfall. A layout that floats rooms with 56%
 * efficiency and 2 doors for 15 rooms can still score ~94/100 here. Use
 * `computeHonestScore` from `layout-metrics.ts` for the user-facing quality
 * banner; this score is reserved for the Coordinator's design-iteration loop.
 */
function computeDesignScore(issues: DesignIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': score -= 15; break;
      case 'warning': score -= 7; break;
      case 'suggestion': score -= 2; break;
    }
  }
  return Math.max(0, Math.min(100, score));
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}
