/**
 * Energy Function for Layout Optimization
 *
 * Computes a single scalar "energy" for a floor plan layout. Lower = better.
 * The layout optimizer (simulated annealing) minimizes this energy.
 *
 * 14 constraint terms, each with a weight:
 *   HARD constraints (weight ≥ 100): overlap, boundary, min dimension
 *   SOFT constraints (weight 10-80): adjacency, area, aspect ratio, zones, etc.
 *
 * Performance: designed for 5000+ calls per optimization run.
 * Typical rooms: 8-15, so O(n²) pairwise checks are ~100-225 iterations.
 * Target: < 0.1ms per call on modern hardware.
 */

import type { EnhancedRoomProgram } from './ai-room-programmer';
import { getRoomRule } from './architectural-rules';

// ============================================================
// TYPES
// ============================================================

export interface PlacedRoom {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  zone: 'public' | 'private' | 'service' | 'circulation' | 'outdoor';
  targetArea: number;
  mustHaveExteriorWall: boolean;
}

export interface EnergyBreakdown {
  overlap: number;
  boundary: number;
  areaError: number;
  aspectRatio: number;
  minDimension: number;
  adjacencyRequired: number;
  adjacencyPreferred: number;
  awayFrom: number;
  zoneViolation: number;
  corridorWidth: number;
  exteriorWall: number;
  entranceFlow: number;
  deadSpace: number;
  plumbingScatter: number;
}

export interface EnergyResult {
  total: number;
  breakdown: EnergyBreakdown;
}

// ============================================================
// WEIGHTS
// ============================================================

export const ENERGY_WEIGHTS = {
  overlap: 1000,
  boundary: 500,
  areaError: 50,
  aspectRatio: 40,
  minDimension: 100,
  adjacencyRequired: 30,
  adjacencyPreferred: 10,
  awayFrom: 20,
  zoneViolation: 25,
  corridorWidth: 80,
  exteriorWall: 35,
  entranceFlow: 30,
  deadSpace: 15,
  plumbingScatter: 20,
} as const;

// ============================================================
// WET ROOM TYPES (for plumbing scatter)
// ============================================================

const WET_TYPES = new Set([
  'bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath',
  'servant_toilet', 'commercial_toilet', 'kitchen', 'utility', 'laundry',
]);

const CORRIDOR_TYPES = new Set(['corridor', 'hallway', 'passage']);

const ENTRANCE_TYPES = new Set(['foyer', 'entrance_lobby', 'living_room', 'drawing_room']);

// ============================================================
// MAIN API
// ============================================================

/**
 * Compute the total energy of a placed room layout.
 *
 * @param rooms - Array of rooms with positions and dimensions
 * @param footprint - Building footprint { width, depth } in meters
 * @param program - The room program (for adjacency constraints)
 * @returns Energy result with total score and per-term breakdown
 */
export function computeEnergy(
  rooms: PlacedRoom[],
  footprint: { width: number; depth: number },
  program: EnhancedRoomProgram,
): EnergyResult {
  // Build name→room lookup for adjacency checks
  const byName = new Map<string, PlacedRoom>();
  for (const r of rooms) {
    byName.set(r.name, r);
  }

  const breakdown: EnergyBreakdown = {
    overlap: penaltyOverlap(rooms),
    boundary: penaltyBoundary(rooms, footprint),
    areaError: penaltyAreaError(rooms),
    aspectRatio: penaltyAspectRatio(rooms),
    minDimension: penaltyMinDimension(rooms),
    adjacencyRequired: penaltyAdjacencyRequired(rooms, program, byName),
    adjacencyPreferred: penaltyAdjacencyPreferred(rooms, program, byName),
    awayFrom: penaltyAwayFrom(rooms),
    zoneViolation: penaltyZoneViolation(rooms, footprint),
    corridorWidth: penaltyCorridorWidth(rooms),
    exteriorWall: penaltyExteriorWall(rooms, footprint),
    entranceFlow: penaltyEntranceFlow(rooms, footprint, program),
    deadSpace: penaltyDeadSpace(rooms, footprint),
    plumbingScatter: penaltyPlumbingScatter(rooms),
  };

  let total = 0;
  for (const key of Object.keys(breakdown) as Array<keyof EnergyBreakdown>) {
    total += ENERGY_WEIGHTS[key] * breakdown[key];
  }

  return { total, breakdown };
}

// ============================================================
// HELPER FUNCTIONS (exported for optimizer use)
// ============================================================

/**
 * Check if two rooms share a wall (are adjacent within tolerance).
 *
 * Rooms share a wall if they touch/overlap within `tolerance` on one axis
 * AND overlap at least `minContact` on the perpendicular axis.
 */
export function roomsShareWall(
  a: PlacedRoom,
  b: PlacedRoom,
  tolerance = 0.3,
  minContact = 0.5,
): boolean {
  // Check horizontal adjacency (a to right of b or b to right of a)
  const hGap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const vOverlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
  if (hGap >= -tolerance && hGap <= tolerance && vOverlap >= minContact) return true;

  // Check vertical adjacency (a below b or b below a)
  const vGap = Math.max(a.y, b.y) - Math.min(a.y + a.depth, b.y + b.depth);
  const hOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  if (vGap >= -tolerance && vGap <= tolerance && hOverlap >= minContact) return true;

  return false;
}

/**
 * Check if a room touches the perimeter of the building footprint.
 */
export function roomTouchesPerimeter(
  room: PlacedRoom,
  footprint: { width: number; depth: number },
  tolerance = 0.1,
): boolean {
  if (room.x <= tolerance) return true;
  if (room.y <= tolerance) return true;
  if (room.x + room.width >= footprint.width - tolerance) return true;
  if (room.y + room.depth >= footprint.depth - tolerance) return true;
  return false;
}

/**
 * Compute edge-to-edge distance between two rooms.
 * Returns 0 if rooms overlap or touch.
 */
export function roomDistance(a: PlacedRoom, b: PlacedRoom): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.depth, b.y + b.depth));
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================
// PENALTY FUNCTIONS
// ============================================================

/** Term 1: Overlap — sum of pairwise overlap areas */
function penaltyOverlap(rooms: PlacedRoom[]): number {
  let penalty = 0;
  for (let i = 0; i < rooms.length; i++) {
    const ri = rooms[i];
    for (let j = i + 1; j < rooms.length; j++) {
      const rj = rooms[j];
      const ox = Math.max(0, Math.min(ri.x + ri.width, rj.x + rj.width) - Math.max(ri.x, rj.x));
      const oy = Math.max(0, Math.min(ri.y + ri.depth, rj.y + rj.depth) - Math.max(ri.y, rj.y));
      penalty += ox * oy;
    }
  }
  return penalty;
}

/** Term 2: Boundary violation — how far rooms extend outside footprint */
function penaltyBoundary(rooms: PlacedRoom[], fp: { width: number; depth: number }): number {
  let penalty = 0;
  for (const r of rooms) {
    if (r.x < 0) penalty += -r.x;
    if (r.y < 0) penalty += -r.y;
    if (r.x + r.width > fp.width) penalty += r.x + r.width - fp.width;
    if (r.y + r.depth > fp.depth) penalty += r.y + r.depth - fp.depth;
  }
  return penalty;
}

/** Term 3: Area error — relative difference between actual and target area */
function penaltyAreaError(rooms: PlacedRoom[]): number {
  let penalty = 0;
  for (const r of rooms) {
    if (r.targetArea > 0) {
      const actual = r.width * r.depth;
      penalty += Math.abs(actual - r.targetArea) / r.targetArea;
    }
  }
  return penalty;
}

/** Term 4: Aspect ratio — penalty for exceeding max AR (skip corridors) */
function penaltyAspectRatio(rooms: PlacedRoom[]): number {
  let penalty = 0;
  for (const r of rooms) {
    if (CORRIDOR_TYPES.has(r.type)) continue;
    const longer = Math.max(r.width, r.depth);
    const shorter = Math.min(r.width, r.depth);
    if (shorter <= 0) continue;
    const ar = longer / shorter;
    const rule = getRoomRule(r.type);
    const maxAR = rule.aspectRatio.max;
    if (ar > maxAR) {
      penalty += ar - maxAR;
    }
  }
  return penalty;
}

/** Term 5: Minimum dimension — rooms below code-minimum width or depth */
function penaltyMinDimension(rooms: PlacedRoom[]): number {
  let penalty = 0;
  const tolerance = 0.1; // 100mm tolerance
  for (const r of rooms) {
    const rule = getRoomRule(r.type);
    if (r.width < rule.width.min - tolerance) {
      penalty += rule.width.min - r.width;
    }
    if (r.depth < rule.depth.min - tolerance) {
      penalty += rule.depth.min - r.depth;
    }
  }
  return penalty;
}

/** Term 6: Required adjacency — program-specified adjacencies not met */
function penaltyAdjacencyRequired(
  rooms: PlacedRoom[],
  program: EnhancedRoomProgram,
  byName: Map<string, PlacedRoom>,
): number {
  let penalty = 0;
  for (const adj of program.adjacency) {
    const a = byName.get(adj.roomA);
    const b = byName.get(adj.roomB);
    if (!a || !b) continue;
    if (!roomsShareWall(a, b)) {
      penalty += roomDistance(a, b);
    }
  }
  return penalty;
}

/** Term 7: Preferred adjacency — from room rules (soft) */
function penaltyAdjacencyPreferred(
  rooms: PlacedRoom[],
  _program: EnhancedRoomProgram,
  _byName: Map<string, PlacedRoom>,
): number {
  let penalty = 0;
  // Check architectural-rules preferredAdjacent for each room
  for (const r of rooms) {
    const rule = getRoomRule(r.type);
    if (rule.preferredAdjacent.length === 0) continue;
    for (const prefType of rule.preferredAdjacent) {
      // Find any room of that type
      const neighbor = rooms.find(n => n.type === prefType && n.id !== r.id);
      if (!neighbor) continue;
      const cx = r.x + r.width / 2;
      const cy = r.y + r.depth / 2;
      const nx = neighbor.x + neighbor.width / 2;
      const ny = neighbor.y + neighbor.depth / 2;
      const dist = Math.sqrt((cx - nx) ** 2 + (cy - ny) ** 2);
      penalty += dist / 10;
    }
  }
  return penalty;
}

/** Term 8: Away-from — rooms that shouldn't be adjacent but are */
function penaltyAwayFrom(rooms: PlacedRoom[]): number {
  let penalty = 0;
  for (const r of rooms) {
    const rule = getRoomRule(r.type);
    if (rule.awayFrom.length === 0) continue;
    for (const avoidType of rule.awayFrom) {
      for (const other of rooms) {
        if (other.id === r.id) continue;
        if (other.type !== avoidType) continue;
        if (roomsShareWall(r, other)) {
          penalty += 1;
        }
      }
    }
  }
  // Each pair counted twice (a→b and b→a), halve
  return penalty / 2;
}

/** Term 9: Zone violation — rooms placed in the wrong zone area */
function penaltyZoneViolation(rooms: PlacedRoom[], fp: { width: number; depth: number }): number {
  let penalty = 0;
  const midY = fp.depth * 0.5;
  for (const r of rooms) {
    // Circulation and service rooms are zone-flexible
    if (r.zone === 'circulation' || r.zone === 'service' || r.zone === 'outdoor') continue;
    const centerY = r.y + r.depth / 2;
    // Private rooms should be in the back (low y = row 0 = north/back)
    if (r.zone === 'private' && centerY > midY) penalty += 1;
    // Public rooms should be in the front (high y = south/entrance)
    if (r.zone === 'public' && centerY < midY) penalty += 1;
  }
  return penalty;
}

/** Term 10: Corridor width — too narrow or too wide */
function penaltyCorridorWidth(rooms: PlacedRoom[]): number {
  let penalty = 0;
  for (const r of rooms) {
    if (!CORRIDOR_TYPES.has(r.type)) continue;
    const shortDim = Math.min(r.width, r.depth);
    if (shortDim < 1.0) {
      penalty += (1.0 - shortDim) * 5;
    }
    if (shortDim > 1.8) {
      penalty += shortDim - 1.8;
    }
  }
  return penalty;
}

/** Term 11: Exterior wall — rooms needing perimeter access but placed interior */
function penaltyExteriorWall(rooms: PlacedRoom[], fp: { width: number; depth: number }): number {
  let penalty = 0;
  for (const r of rooms) {
    if (!r.mustHaveExteriorWall) {
      // Also check architectural-rules
      const rule = getRoomRule(r.type);
      if (rule.exteriorWall !== 'required') continue;
    }
    if (!roomTouchesPerimeter(r, fp)) {
      penalty += 1;
    }
  }
  return penalty;
}

/** Term 12: Entrance flow — entrance→living connection and position */
function penaltyEntranceFlow(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  program: EnhancedRoomProgram,
): number {
  let penalty = 0;

  // Find entrance room (closest to south/entrance edge, which is high y)
  let entrance: PlacedRoom | undefined;
  const entranceName = program.entranceRoom;
  if (entranceName) {
    entrance = rooms.find(r => r.name === entranceName);
  }
  if (!entrance) {
    // Find any entrance-type room closest to south edge
    let bestY = -Infinity;
    for (const r of rooms) {
      if (ENTRANCE_TYPES.has(r.type)) {
        const bottom = r.y + r.depth;
        if (bottom > bestY) {
          bestY = bottom;
          entrance = r;
        }
      }
    }
  }
  if (!entrance) return 0;

  // Find living room
  const living = rooms.find(r => r.type === 'living_room' || r.type === 'drawing_room');
  if (living && living.id !== entrance.id) {
    // Living should be adjacent to entrance
    if (!roomsShareWall(entrance, living)) {
      penalty += 1;
    }
  }

  // Living room should be in front half (high y)
  if (living) {
    const livingCenterY = living.y + living.depth / 2;
    if (livingCenterY < fp.depth * 0.5) {
      penalty += 0.5;
    }
  }

  return penalty;
}

/** Term 13: Dead space — unaccounted area in the footprint */
function penaltyDeadSpace(rooms: PlacedRoom[], fp: { width: number; depth: number }): number {
  const fpArea = fp.width * fp.depth;
  if (fpArea <= 0) return 0;
  let totalRoomArea = 0;
  for (const r of rooms) {
    totalRoomArea += r.width * r.depth;
  }
  const deadRatio = 1 - totalRoomArea / fpArea;
  if (deadRatio > 0.15) {
    return (deadRatio - 0.15) * 10;
  }
  return 0;
}

/** Term 14: Plumbing scatter — wet rooms should cluster near a plumbing core */
function penaltyPlumbingScatter(rooms: PlacedRoom[]): number {
  const wetRooms = rooms.filter(r => WET_TYPES.has(r.type));
  if (wetRooms.length <= 1) return 0;

  // Compute centroid
  let cx = 0;
  let cy = 0;
  for (const r of wetRooms) {
    cx += r.x + r.width / 2;
    cy += r.y + r.depth / 2;
  }
  cx /= wetRooms.length;
  cy /= wetRooms.length;

  let penalty = 0;
  for (const r of wetRooms) {
    const rx = r.x + r.width / 2;
    const ry = r.y + r.depth / 2;
    const dist = Math.sqrt((rx - cx) ** 2 + (ry - cy) ** 2);
    penalty += dist / 5;
  }
  return penalty;
}
