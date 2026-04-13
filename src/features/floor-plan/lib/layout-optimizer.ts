/**
 * Layout Optimizer — Simulated Annealing
 *
 * Takes a set of placed rooms (from the typology matcher) and optimizes
 * their positions and dimensions by minimizing the energy function.
 *
 * Algorithm: Simulated annealing with 6 move types, seeded PRNG for
 * determinism, and configurable restarts for escaping local minima.
 *
 * Performance target: 5000 iterations × 10-15 rooms in < 1.5 seconds.
 */

import { computeEnergy, roomsShareWall, type PlacedRoom, type EnergyResult } from './energy-function';
import { getRoomRule } from './architectural-rules';
import type { EnhancedRoomProgram } from './ai-room-programmer';

// ============================================================
// TYPES
// ============================================================

export interface OptimizerConfig {
  maxIterations: number;
  initialTemperature: number;
  coolingRate: number;
  minTemperature: number;
  restarts: number;
}

export interface OptimizationResult {
  rooms: PlacedRoom[];
  energy: EnergyResult;
  initialEnergy: number;
  iterations: number;
  improvements: number;
  timeMs: number;
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_CONFIG: OptimizerConfig = {
  maxIterations: 5000,
  initialTemperature: 1.0,
  coolingRate: 0.997,
  minTemperature: 0.001,
  restarts: 2,
};

/** Move type probabilities (must sum to 1.0) */
const MOVE_PROBS = {
  nudge: 0.30,
  resize: 0.20,
  swap: 0.15,
  shiftBoundary: 0.20,
  rotate: 0.05,
  corridorAdjust: 0.10,
};

/** Cumulative probability thresholds for move selection */
const MOVE_THRESHOLDS = (() => {
  const t: number[] = [];
  let cum = 0;
  for (const p of Object.values(MOVE_PROBS)) {
    cum += p;
    t.push(cum);
  }
  return t;
})();

const CORRIDOR_TYPES = new Set(['corridor', 'hallway', 'passage']);

// ============================================================
// SEEDED PRNG — mulberry32
// ============================================================

function mulberry32(seed: number): () => number {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Simple hash from a string (for seeding) */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return h >>> 0;
}

// ============================================================
// MAIN API
// ============================================================

/**
 * Optimize a placed room layout using simulated annealing.
 *
 * @param initialRooms - Starting room positions (typically from typology matcher)
 * @param footprint - Building footprint { width, depth } in meters
 * @param program - The room program (for adjacency constraints)
 * @param config - Optional optimizer configuration overrides
 * @returns Optimized layout with energy scores and timing
 */
export function optimizeLayout(
  initialRooms: PlacedRoom[],
  footprint: { width: number; depth: number },
  program: EnhancedRoomProgram,
  config?: Partial<OptimizerConfig>,
): OptimizationResult {
  const cfg: OptimizerConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = performance.now();

  const initialEnergy = computeEnergy(initialRooms, footprint, program).total;

  // Seed PRNG from program content for determinism
  const seedStr = program.rooms.map(r => `${r.name}:${r.areaSqm}`).join(',')
    + `:${footprint.width}:${footprint.depth}`;
  const baseSeed = hashString(seedStr);

  let globalBestRooms = deepCloneRooms(initialRooms);
  let globalBestEnergy = initialEnergy;
  let totalIterations = 0;
  let totalImprovements = 0;

  for (let restart = 0; restart < cfg.restarts; restart++) {
    const rng = mulberry32(baseSeed + restart * 7919);
    let currentRooms = deepCloneRooms(initialRooms);
    let currentEnergy = initialEnergy;
    let T = cfg.initialTemperature;
    let iters = 0;

    for (let i = 0; i < cfg.maxIterations; i++) {
      if (T < cfg.minTemperature) break;

      // Generate and apply a random move
      const candidateRooms = generateAndApplyMove(currentRooms, footprint, rng);
      if (!candidateRooms) {
        T *= cfg.coolingRate;
        iters++;
        continue;
      }

      const candidateEnergy = computeEnergy(candidateRooms, footprint, program).total;
      const delta = candidateEnergy - currentEnergy;

      // Acceptance criterion
      if (delta < 0 || rng() < Math.exp(-delta / (T * 100))) {
        currentRooms = candidateRooms;
        currentEnergy = candidateEnergy;
        if (delta < 0) totalImprovements++;
      }

      // Track global best
      if (currentEnergy < globalBestEnergy) {
        globalBestRooms = deepCloneRooms(currentRooms);
        globalBestEnergy = currentEnergy;
      }

      T *= cfg.coolingRate;
      iters++;
    }

    totalIterations += iters;
  }

  const finalEnergy = computeEnergy(globalBestRooms, footprint, program);
  const timeMs = performance.now() - startTime;

  return {
    rooms: globalBestRooms,
    energy: finalEnergy,
    initialEnergy,
    iterations: totalIterations,
    improvements: totalImprovements,
    timeMs,
  };
}

// ============================================================
// MOVE GENERATION
// ============================================================

/**
 * Generate a random move and apply it, returning the new rooms array.
 * Returns null if the move is invalid (revert).
 */
function generateAndApplyMove(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  const roll = rng();
  let moveType: number;
  for (moveType = 0; moveType < MOVE_THRESHOLDS.length; moveType++) {
    if (roll < MOVE_THRESHOLDS[moveType]) break;
  }

  const candidate = deepCloneRooms(rooms);

  switch (moveType) {
    case 0: return moveNudge(candidate, fp, rng);
    case 1: return moveResize(candidate, fp, rng);
    case 2: return moveSwap(candidate, fp, rng);
    case 3: return moveShiftBoundary(candidate, fp, rng);
    case 4: return moveRotate(candidate, fp, rng);
    case 5: return moveCorridorAdjust(candidate, fp, rng);
    default: return moveNudge(candidate, fp, rng);
  }
}

/** Move 1: Nudge — move a room by 0.1-0.3m */
function moveNudge(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  const idx = Math.floor(rng() * rooms.length);
  const room = rooms[idx];
  const axis = rng() < 0.5 ? 'x' : 'y';
  const amount = snap((rng() * 0.4 - 0.2)); // -0.2 to +0.2, snapped to 0.1

  if (axis === 'x') {
    room.x = snap(room.x + amount);
    room.x = clamp(room.x, 0, fp.width - room.width);
  } else {
    room.y = snap(room.y + amount);
    room.y = clamp(room.y, 0, fp.depth - room.depth);
  }
  return rooms;
}

/** Move 2: Resize — grow/shrink a room and adjust neighbor */
function moveResize(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  // Skip corridors for resize
  const nonCorridor = rooms.filter(r => !CORRIDOR_TYPES.has(r.type));
  if (nonCorridor.length === 0) return null;
  const room = nonCorridor[Math.floor(rng() * nonCorridor.length)];
  const idx = rooms.indexOf(room);
  const dimAxis = rng() < 0.5 ? 'width' : 'depth';
  const amount = snap((rng() * 0.4 - 0.2));

  const oldDim = room[dimAxis];
  room[dimAxis] = snap(oldDim + amount);

  // Clamp to minimum
  const rule = getRoomRule(room.type);
  const minDim = dimAxis === 'width' ? rule.width.min : rule.depth.min;
  if (room[dimAxis] < minDim) {
    room[dimAxis] = oldDim; // revert
    return null;
  }

  // Keep within footprint
  const maxExtent = dimAxis === 'width' ? fp.width : fp.depth;
  const pos = dimAxis === 'width' ? room.x : room.y;
  if (pos + room[dimAxis] > maxExtent) {
    room[dimAxis] = oldDim;
    return null;
  }

  // Try to find and adjust a neighbor on the affected side
  if (dimAxis === 'width' && amount > 0) {
    // Grew right — push right neighbor
    const neighbor = findNeighborOnSide(rooms, rooms[idx], 'right');
    if (neighbor) {
      neighbor.x = snap(neighbor.x + amount);
      neighbor.width = snap(neighbor.width - amount);
      const nRule = getRoomRule(neighbor.type);
      if (neighbor.width < nRule.width.min) {
        // Revert everything
        room[dimAxis] = oldDim;
        neighbor.x = snap(neighbor.x - amount);
        neighbor.width = snap(neighbor.width + amount);
        return null;
      }
    }
  } else if (dimAxis === 'depth' && amount > 0) {
    const neighbor = findNeighborOnSide(rooms, rooms[idx], 'bottom');
    if (neighbor) {
      neighbor.y = snap(neighbor.y + amount);
      neighbor.depth = snap(neighbor.depth - amount);
      const nRule = getRoomRule(neighbor.type);
      if (neighbor.depth < nRule.depth.min) {
        room[dimAxis] = oldDim;
        neighbor.y = snap(neighbor.y - amount);
        neighbor.depth = snap(neighbor.depth + amount);
        return null;
      }
    }
  }

  return rooms;
}

/** Move 3: Swap — swap positions of two rooms in the same zone */
function moveSwap(
  rooms: PlacedRoom[],
  _fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  // Group by zone
  const zoneRooms = new Map<string, number[]>();
  for (let i = 0; i < rooms.length; i++) {
    const z = rooms[i].zone;
    if (z === 'circulation') continue; // don't swap corridors
    if (!zoneRooms.has(z)) zoneRooms.set(z, []);
    zoneRooms.get(z)!.push(i);
  }

  // Find a zone with ≥2 rooms
  const eligibleZones = [...zoneRooms.entries()].filter(([, ids]) => ids.length >= 2);
  if (eligibleZones.length === 0) return null;

  const [, indices] = eligibleZones[Math.floor(rng() * eligibleZones.length)];
  const iA = indices[Math.floor(rng() * indices.length)];
  let iB = iA;
  let attempts = 0;
  while (iB === iA && attempts < 10) {
    iB = indices[Math.floor(rng() * indices.length)];
    attempts++;
  }
  if (iA === iB) return null;

  const a = rooms[iA];
  const b = rooms[iB];

  // Swap positions and dimensions
  const tmpX = a.x, tmpY = a.y, tmpW = a.width, tmpD = a.depth;
  a.x = b.x; a.y = b.y; a.width = b.width; a.depth = b.depth;
  b.x = tmpX; b.y = tmpY; b.width = tmpW; b.depth = tmpD;

  return rooms;
}

/** Move 4: Shift boundary — move a shared wall between adjacent rooms */
function moveShiftBoundary(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  // Find adjacent pairs
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (roomsShareWall(rooms[i], rooms[j], 0.15, 0.3)) {
        pairs.push([i, j]);
      }
    }
  }
  if (pairs.length === 0) return null;

  const [iA, iB] = pairs[Math.floor(rng() * pairs.length)];
  const a = rooms[iA];
  const b = rooms[iB];
  const amount = snap(rng() * 0.4 - 0.2);
  if (amount === 0) return null;

  // Determine shared edge direction
  const hGap = Math.abs((a.x + a.width) - b.x);
  const hGap2 = Math.abs((b.x + b.width) - a.x);
  const vGap = Math.abs((a.y + a.depth) - b.y);
  const vGap2 = Math.abs((b.y + b.depth) - a.y);

  const isVerticalWall = Math.min(hGap, hGap2) < Math.min(vGap, vGap2);

  if (isVerticalWall) {
    // a is left, b is right (or vice versa)
    if (a.x + a.width <= b.x + 0.2) {
      // a is left of b
      a.width = snap(a.width + amount);
      b.x = snap(b.x + amount);
      b.width = snap(b.width - amount);
    } else {
      // b is left of a
      b.width = snap(b.width + amount);
      a.x = snap(a.x + amount);
      a.width = snap(a.width - amount);
    }
  } else {
    // Horizontal wall: a is above b or vice versa
    if (a.y + a.depth <= b.y + 0.2) {
      a.depth = snap(a.depth + amount);
      b.y = snap(b.y + amount);
      b.depth = snap(b.depth - amount);
    } else {
      b.depth = snap(b.depth + amount);
      a.y = snap(a.y + amount);
      a.depth = snap(a.depth - amount);
    }
  }

  // Validate minimums
  const ruleA = getRoomRule(a.type);
  const ruleB = getRoomRule(b.type);
  if (a.width < ruleA.width.min || a.depth < ruleA.depth.min ||
      b.width < ruleB.width.min || b.depth < ruleB.depth.min ||
      a.x < -0.01 || b.x < -0.01 || a.y < -0.01 || b.y < -0.01 ||
      a.x + a.width > fp.width + 0.01 || b.x + b.width > fp.width + 0.01 ||
      a.y + a.depth > fp.depth + 0.01 || b.y + b.depth > fp.depth + 0.01) {
    return null; // invalid — caller will discard
  }

  return rooms;
}

/** Move 5: Rotate — swap width and depth of a room */
function moveRotate(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  const nonCorridor = rooms.filter(r => !CORRIDOR_TYPES.has(r.type));
  if (nonCorridor.length === 0) return null;
  const room = nonCorridor[Math.floor(rng() * nonCorridor.length)];

  const tmp = room.width;
  room.width = room.depth;
  room.depth = tmp;

  // Check if rotated room still fits
  if (room.x + room.width > fp.width + 0.01 || room.y + room.depth > fp.depth + 0.01) {
    // Revert
    room.depth = room.width;
    room.width = tmp;
    return null;
  }

  return rooms;
}

/** Move 6: Corridor adjust — widen/narrow corridor and shift rooms below */
function moveCorridorAdjust(
  rooms: PlacedRoom[],
  fp: { width: number; depth: number },
  rng: () => number,
): PlacedRoom[] | null {
  const corridorIdx = rooms.findIndex(r => CORRIDOR_TYPES.has(r.type));
  if (corridorIdx === -1) return null;

  const corridor = rooms[corridorIdx];
  const amount = snap(rng() * 0.2 - 0.1); // ±0.1m
  if (amount === 0) return null;

  const newDepth = snap(corridor.depth + amount);
  if (newDepth < 0.8 || newDepth > 2.0) return null;

  const corridorBottom = corridor.y + corridor.depth;
  corridor.depth = newDepth;

  // Shift all rooms below the corridor
  for (let i = 0; i < rooms.length; i++) {
    if (i === corridorIdx) continue;
    if (rooms[i].y >= corridorBottom - 0.1) {
      rooms[i].y = snap(rooms[i].y + amount);
      // Check bounds
      if (rooms[i].y + rooms[i].depth > fp.depth + 0.01) return null;
    }
  }

  return rooms;
}

// ============================================================
// HELPERS
// ============================================================

/** Deep clone an array of rooms (no shared references) */
function deepCloneRooms(rooms: PlacedRoom[]): PlacedRoom[] {
  const out: PlacedRoom[] = new Array(rooms.length);
  for (let i = 0; i < rooms.length; i++) {
    out[i] = { ...rooms[i] };
  }
  return out;
}

/** Find a neighbor sharing a wall on a specific side of a room */
function findNeighborOnSide(
  rooms: PlacedRoom[],
  room: PlacedRoom,
  side: 'left' | 'right' | 'top' | 'bottom',
): PlacedRoom | null {
  const tol = 0.2;
  const minContact = 0.3;
  let best: PlacedRoom | null = null;
  let bestDist = Infinity;

  for (const r of rooms) {
    if (r.id === room.id) continue;

    if (side === 'right') {
      const gap = Math.abs(r.x - (room.x + room.width));
      const vOverlap = Math.min(room.y + room.depth, r.y + r.depth) - Math.max(room.y, r.y);
      if (gap < tol && vOverlap > minContact && gap < bestDist) {
        best = r;
        bestDist = gap;
      }
    } else if (side === 'left') {
      const gap = Math.abs(room.x - (r.x + r.width));
      const vOverlap = Math.min(room.y + room.depth, r.y + r.depth) - Math.max(room.y, r.y);
      if (gap < tol && vOverlap > minContact && gap < bestDist) {
        best = r;
        bestDist = gap;
      }
    } else if (side === 'bottom') {
      const gap = Math.abs(r.y - (room.y + room.depth));
      const hOverlap = Math.min(room.x + room.width, r.x + r.width) - Math.max(room.x, r.x);
      if (gap < tol && hOverlap > minContact && gap < bestDist) {
        best = r;
        bestDist = gap;
      }
    } else { // top
      const gap = Math.abs(room.y - (r.y + r.depth));
      const hOverlap = Math.min(room.x + room.width, r.x + r.width) - Math.max(room.x, r.x);
      if (gap < tol && hOverlap > minContact && gap < bestDist) {
        best = r;
        bestDist = gap;
      }
    }
  }

  return best;
}

/** Snap a value to 0.1m grid */
function snap(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
