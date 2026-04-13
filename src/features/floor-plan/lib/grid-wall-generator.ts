/**
 * Grid-to-Walls Converter
 *
 * Generates walls directly from the structural grid + room assignments.
 * Walls ARE grid lines — always continuous, always intersect properly, never gaps.
 *
 * Standards: IS:1905 (masonry), NBC 2016 Part 6.
 *
 * Pure function — no side effects.
 */

import type { StructuralGrid, GridCell } from '@/features/floor-plan/lib/grid-generator';
import { getCell } from '@/features/floor-plan/lib/grid-generator';
import type { RoomAssignment, AssignedRoom } from '@/features/floor-plan/lib/grid-room-assigner';

// ============================================================
// TYPES
// ============================================================

export interface GridWall {
  /** Unique wall ID */
  id: string;
  /** Start point in meters (Y-down coordinate system) */
  start: { x: number; y: number };
  /** End point in meters */
  end: { x: number; y: number };
  /** Wall thickness in mm — IS:1905 */
  thickness: number;
  /** Exterior (perimeter) or interior */
  isExterior: boolean;
  /** Load-bearing (on structural grid lines) */
  isLoadBearing: boolean;
  /** Room ID on the left side of the wall (facing start→end) */
  leftRoomId: string | null;
  /** Room ID on the right side */
  rightRoomId: string | null;
  /** Orientation */
  direction: 'horizontal' | 'vertical';
}

export interface GridColumnMarker {
  /** Position in meters */
  x: number;
  y: number;
  /** Grid reference label */
  gridRef: string;
  /** Column size in mm (square) */
  size: number;
}

export interface WallJunction {
  /** Position */
  x: number;
  y: number;
  /** Type of junction */
  type: 'L' | 'T' | 'cross';
  /** Wall IDs meeting at this junction */
  wallIds: string[];
}

export interface DoorCandidate {
  /** The wall this door would be placed on */
  wallId: string;
  /** Position along wall in mm from wall start */
  positionAlongWall: number;
  /** Room IDs this door connects */
  connectsRooms: [string, string];
  /** Maximum door width that fits here in mm */
  maxWidth: number;
}

export interface WindowCandidate {
  /** The wall this window would be placed on */
  wallId: string;
  /** Position along wall in mm */
  positionAlongWall: number;
  /** Room ID this window belongs to */
  roomId: string;
  /** Maximum window width in mm */
  maxWidth: number;
}

export interface WallSystem {
  /** All wall segments */
  walls: GridWall[];
  /** Structural column positions */
  columns: GridColumnMarker[];
  /** Wall junctions */
  junctions: WallJunction[];
  /** Candidate locations for doors */
  doorCandidateLocations: DoorCandidate[];
  /** Candidate locations for windows */
  windowCandidateLocations: WindowCandidate[];
}

// ============================================================
// CONSTANTS — IS:1905 / NBC 2016
// ============================================================

/** Exterior wall: 230mm (9" brick or 200mm RCC + plaster) */
const EXTERIOR_WALL_THICKNESS = 230;
/** Interior load-bearing wall: 230mm */
const INTERIOR_LB_WALL_THICKNESS = 230;
/** Interior partition wall: 150mm (6" brick) */
const INTERIOR_PARTITION_THICKNESS = 150;
/** Structural column size: 300mm square (typical residential) */
const COLUMN_SIZE = 300;
/** Minimum wall segment length */
const MIN_WALL_LENGTH = 0.3; // meters
/** Minimum distance from corner for openings */
const MIN_FROM_CORNER = 200; // mm
/** Column width in meters for column clearance checks */
const COLUMN_WIDTH_M = COLUMN_SIZE / 1000;

// ============================================================
// ID GENERATOR
// ============================================================

let _wallIdCounter = 0;
function genWallId(): string {
  return `gw-${Date.now().toString(36)}-${(++_wallIdCounter).toString(36)}`;
}

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Generate walls from a structural grid and room assignments.
 *
 * @param grid - Structural grid
 * @param assignment - Room assignments to grid cells
 * @returns Complete wall system
 */
export function generateWallsFromGrid(
  grid: StructuralGrid,
  assignment: RoomAssignment,
): WallSystem {
  _wallIdCounter = 0;

  // Build lookup: cell key → room ID
  const cellToRoom = new Map<string, string>();
  for (const [roomId, cells] of assignment.assignments) {
    for (const cell of cells) {
      cellToRoom.set(`${cell.col},${cell.row}`, roomId);
    }
  }
  // Corridor cells
  for (const cell of assignment.corridorCells) {
    cellToRoom.set(`${cell.col},${cell.row}`, '__corridor__');
  }

  const rawWalls: GridWall[] = [];
  const wallMap = new Map<string, GridWall>(); // dedup key → wall

  // Step 1: Generate horizontal wall segments (along X axis)
  // For each horizontal grid line between rows
  for (let row = 0; row <= grid.gridRows; row++) {
    let segStart: number | null = null;
    let segLeftRoom: string | null = null;
    let segRightRoom: string | null = null;
    let isExterior = false;

    const y = row === 0 ? 0 :
      grid.bayDepths.slice(0, row).reduce((s, b) => s + b, 0);

    for (let col = 0; col < grid.gridCols; col++) {
      const cellAbove = row > 0 ? cellToRoom.get(`${col},${row - 1}`) ?? null : null;
      const cellBelow = row < grid.gridRows ? cellToRoom.get(`${col},${row}`) ?? null : null;

      const isPerimeterLine = row === 0 || row === grid.gridRows;
      const differentRooms = cellAbove !== cellBelow;
      const needsWall = isPerimeterLine || differentRooms;

      if (needsWall) {
        const xStart = col === 0 ? 0 :
          grid.bayWidths.slice(0, col).reduce((s, b) => s + b, 0);

        if (segStart === null) {
          segStart = xStart;
          segLeftRoom = cellAbove;
          segRightRoom = cellBelow;
          isExterior = isPerimeterLine;
        } else if (segLeftRoom !== cellAbove || segRightRoom !== cellBelow) {
          // Different rooms — close current segment and start new one
          const xEnd = xStart;
          if (xEnd - segStart >= MIN_WALL_LENGTH) {
            const wall = createHorizontalWall(segStart, xEnd, y, isExterior, segLeftRoom, segRightRoom);
            addWall(wall, rawWalls, wallMap);
          }
          segStart = xStart;
          segLeftRoom = cellAbove;
          segRightRoom = cellBelow;
          isExterior = isPerimeterLine;
        }
      } else {
        // No wall needed — close current segment if any
        if (segStart !== null) {
          const xEnd = col === 0 ? 0 :
            grid.bayWidths.slice(0, col).reduce((s, b) => s + b, 0);
          if (xEnd - segStart >= MIN_WALL_LENGTH) {
            const wall = createHorizontalWall(segStart, xEnd, y, isExterior, segLeftRoom, segRightRoom);
            addWall(wall, rawWalls, wallMap);
          }
          segStart = null;
        }
      }
    }

    // Close final segment
    if (segStart !== null) {
      const xEnd = grid.totalWidth;
      if (xEnd - segStart >= MIN_WALL_LENGTH) {
        const wall = createHorizontalWall(segStart, xEnd, y, isExterior, segLeftRoom, segRightRoom);
        addWall(wall, rawWalls, wallMap);
      }
    }
  }

  // Step 2: Generate vertical wall segments (along Y axis)
  for (let col = 0; col <= grid.gridCols; col++) {
    let segStart: number | null = null;
    let segLeftRoom: string | null = null;
    let segRightRoom: string | null = null;
    let isExterior = false;

    const x = col === 0 ? 0 :
      grid.bayWidths.slice(0, col).reduce((s, b) => s + b, 0);

    for (let row = 0; row < grid.gridRows; row++) {
      const cellLeft = col > 0 ? cellToRoom.get(`${col - 1},${row}`) ?? null : null;
      const cellRight = col < grid.gridCols ? cellToRoom.get(`${col},${row}`) ?? null : null;

      const isPerimeterLine = col === 0 || col === grid.gridCols;
      const differentRooms = cellLeft !== cellRight;
      const needsWall = isPerimeterLine || differentRooms;

      if (needsWall) {
        const yStart = row === 0 ? 0 :
          grid.bayDepths.slice(0, row).reduce((s, b) => s + b, 0);

        if (segStart === null) {
          segStart = yStart;
          segLeftRoom = cellLeft;
          segRightRoom = cellRight;
          isExterior = isPerimeterLine;
        } else if (segLeftRoom !== cellLeft || segRightRoom !== cellRight) {
          const yEnd = yStart;
          if (yEnd - segStart >= MIN_WALL_LENGTH) {
            const wall = createVerticalWall(x, segStart, yEnd, isExterior, segLeftRoom, segRightRoom);
            addWall(wall, rawWalls, wallMap);
          }
          segStart = yStart;
          segLeftRoom = cellLeft;
          segRightRoom = cellRight;
          isExterior = isPerimeterLine;
        }
      } else {
        if (segStart !== null) {
          const yEnd = row === 0 ? 0 :
            grid.bayDepths.slice(0, row).reduce((s, b) => s + b, 0);
          if (yEnd - segStart >= MIN_WALL_LENGTH) {
            const wall = createVerticalWall(x, segStart, yEnd, isExterior, segLeftRoom, segRightRoom);
            addWall(wall, rawWalls, wallMap);
          }
          segStart = null;
        }
      }
    }

    if (segStart !== null) {
      const yEnd = grid.totalDepth;
      if (yEnd - segStart >= MIN_WALL_LENGTH) {
        const wall = createVerticalWall(x, segStart, yEnd, isExterior, segLeftRoom, segRightRoom);
        addWall(wall, rawWalls, wallMap);
      }
    }
  }

  // Step 3: Generate columns at grid intersections
  const columns: GridColumnMarker[] = grid.columns.map(gc => ({
    x: gc.x,
    y: gc.y,
    gridRef: gc.gridRef,
    size: COLUMN_SIZE,
  }));

  // Step 4: Find junctions
  const junctions = findJunctions(rawWalls);

  // Step 5: Generate door and window candidate locations
  const doorCandidates = findDoorCandidates(rawWalls, assignment);
  const windowCandidates = findWindowCandidates(rawWalls, assignment);

  // Step 6: Wall integrity check
  checkWallIntegrity(rawWalls, grid);

  return {
    walls: rawWalls,
    columns,
    junctions,
    doorCandidateLocations: doorCandidates,
    windowCandidateLocations: windowCandidates,
  };
}

// ============================================================
// WALL CREATION HELPERS
// ============================================================

function createHorizontalWall(
  x1: number, x2: number, y: number,
  isExterior: boolean,
  leftRoom: string | null, rightRoom: string | null,
): GridWall {
  const thickness = isExterior ? EXTERIOR_WALL_THICKNESS : INTERIOR_PARTITION_THICKNESS;
  return {
    id: genWallId(),
    start: { x: x1, y },
    end: { x: x2, y },
    thickness,
    isExterior,
    isLoadBearing: isExterior, // exterior walls are always load-bearing
    leftRoomId: cleanRoomId(leftRoom),
    rightRoomId: cleanRoomId(rightRoom),
    direction: 'horizontal',
  };
}

function createVerticalWall(
  x: number, y1: number, y2: number,
  isExterior: boolean,
  leftRoom: string | null, rightRoom: string | null,
): GridWall {
  const thickness = isExterior ? EXTERIOR_WALL_THICKNESS : INTERIOR_PARTITION_THICKNESS;
  return {
    id: genWallId(),
    start: { x, y: y1 },
    end: { x, y: y2 },
    thickness,
    isExterior,
    isLoadBearing: isExterior,
    leftRoomId: cleanRoomId(leftRoom),
    rightRoomId: cleanRoomId(rightRoom),
    direction: 'vertical',
  };
}

function cleanRoomId(id: string | null): string | null {
  if (!id) return null;
  // Keep '__corridor__' — pipeline-adapter maps it to the actual corridor CAD ID.
  // Stripping it to null breaks the adjacency graph for door placement.
  return id;
}

function addWall(wall: GridWall, walls: GridWall[], wallMap: Map<string, GridWall>): void {
  const key = wallDedupeKey(wall);
  if (!wallMap.has(key)) {
    wallMap.set(key, wall);
    walls.push(wall);
  }
}

function wallDedupeKey(wall: GridWall): string {
  const sx = wall.start.x.toFixed(2);
  const sy = wall.start.y.toFixed(2);
  const ex = wall.end.x.toFixed(2);
  const ey = wall.end.y.toFixed(2);
  // Normalize: ensure start < end for consistent keys
  if (sx < ex || (sx === ex && sy < ey)) {
    return `${sx},${sy}-${ex},${ey}`;
  }
  return `${ex},${ey}-${sx},${sy}`;
}

function wallLengthM(wall: GridWall): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================
// JUNCTION DETECTION
// ============================================================

function findJunctions(walls: GridWall[]): WallJunction[] {
  const junctions: WallJunction[] = [];
  const TOL = 0.05; // 50mm tolerance

  // Collect all unique endpoints
  const endpointMap = new Map<string, { x: number; y: number; wallIds: string[] }>();

  for (const wall of walls) {
    for (const pt of [wall.start, wall.end]) {
      const key = `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, { x: pt.x, y: pt.y, wallIds: [] });
      }
      endpointMap.get(key)!.wallIds.push(wall.id);
    }

    // Also check if any wall's interior passes through another wall's endpoint
    // (T-junctions where one wall ends at the midpoint of another)
  }

  for (const [, ep] of endpointMap) {
    // Also find walls that pass through this point (not just endpoint)
    const passingWalls = walls.filter(w => {
      if (ep.wallIds.includes(w.id)) return false;
      return pointOnWallSegment(ep.x, ep.y, w, TOL);
    });

    const allWallIds = [...new Set([...ep.wallIds, ...passingWalls.map(w => w.id)])];

    if (allWallIds.length >= 2) {
      let type: 'L' | 'T' | 'cross' = 'L';
      if (allWallIds.length === 3) type = 'T';
      if (allWallIds.length >= 4) type = 'cross';

      junctions.push({
        x: ep.x,
        y: ep.y,
        type,
        wallIds: allWallIds,
      });
    }
  }

  return junctions;
}

function pointOnWallSegment(px: number, py: number, wall: GridWall, tol: number): boolean {
  if (wall.direction === 'horizontal') {
    if (Math.abs(py - wall.start.y) > tol) return false;
    const minX = Math.min(wall.start.x, wall.end.x) + tol;
    const maxX = Math.max(wall.start.x, wall.end.x) - tol;
    return px >= minX && px <= maxX;
  } else {
    if (Math.abs(px - wall.start.x) > tol) return false;
    const minY = Math.min(wall.start.y, wall.end.y) + tol;
    const maxY = Math.max(wall.start.y, wall.end.y) - tol;
    return py >= minY && py <= maxY;
  }
}

// ============================================================
// OPENING CANDIDATES
// ============================================================

function findDoorCandidates(walls: GridWall[], assignment: RoomAssignment): DoorCandidate[] {
  const candidates: DoorCandidate[] = [];

  for (const wall of walls) {
    // Doors go on interior walls between two different rooms
    if (wall.isExterior) continue;
    if (!wall.leftRoomId || !wall.rightRoomId) continue;
    if (wall.leftRoomId === wall.rightRoomId) continue;

    const lengthMm = wallLengthM(wall) * 1000;
    const maxDoorWidth = lengthMm - 2 * MIN_FROM_CORNER - COLUMN_SIZE;
    if (maxDoorWidth < 600) continue; // too narrow for any door

    candidates.push({
      wallId: wall.id,
      positionAlongWall: MIN_FROM_CORNER + COLUMN_SIZE / 2,
      connectsRooms: [wall.leftRoomId, wall.rightRoomId],
      maxWidth: Math.min(maxDoorWidth, 1500),
    });
  }

  // Also add main entrance door on exterior wall near entrance
  if (assignment.entranceCell) {
    const entranceWalls = walls.filter(w =>
      w.isExterior && w.direction === 'horizontal' &&
      Math.abs(w.start.y - (assignment.entranceCell!.y + assignment.entranceCell!.depth)) < 0.1
    );
    for (const wall of entranceWalls) {
      const lengthMm = wallLengthM(wall) * 1000;
      if (lengthMm < 1200) continue;
      candidates.push({
        wallId: wall.id,
        positionAlongWall: (lengthMm - 1050) / 2,
        connectsRooms: [wall.leftRoomId ?? '', wall.rightRoomId ?? ''],
        maxWidth: 1050,
      });
    }
  }

  return candidates;
}

function findWindowCandidates(walls: GridWall[], assignment: RoomAssignment): WindowCandidate[] {
  const candidates: WindowCandidate[] = [];

  for (const wall of walls) {
    // Windows go on exterior walls
    if (!wall.isExterior) continue;

    const roomId = wall.leftRoomId ?? wall.rightRoomId;
    if (!roomId) continue;

    const lengthMm = wallLengthM(wall) * 1000;
    const maxWindowWidth = lengthMm - 2 * 600; // 600mm from corners
    if (maxWindowWidth < 600) continue;

    candidates.push({
      wallId: wall.id,
      positionAlongWall: (lengthMm - Math.min(maxWindowWidth, 1500)) / 2,
      roomId,
      maxWidth: Math.min(maxWindowWidth, 1800),
    });
  }

  return candidates;
}

// ============================================================
// WALL INTEGRITY CHECK
// ============================================================

/**
 * Verify wall system integrity.
 * Logs warnings for any issues found.
 */
function checkWallIntegrity(walls: GridWall[], grid: StructuralGrid): void {
  const exteriorWalls = walls.filter(w => w.isExterior);

  // Check: exterior walls should form a closed polygon
  // Collect all exterior wall endpoints
  const endpoints = new Map<string, number>();
  for (const wall of exteriorWalls) {
    const sk = `${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)}`;
    const ek = `${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)}`;
    endpoints.set(sk, (endpoints.get(sk) ?? 0) + 1);
    endpoints.set(ek, (endpoints.get(ek) ?? 0) + 1);
  }

  // In a valid closed polygon, every endpoint appears exactly 2 times (one H wall + one V wall)
  const oddEndpoints = [...endpoints.entries()].filter(([, count]) => count % 2 !== 0);
  if (oddEndpoints.length > 0) {
    console.warn(
      `[WALL-INTEGRITY] ${oddEndpoints.length} exterior wall endpoints with odd connections — potential gaps`,
      oddEndpoints.map(([k]) => k),
    );
  }

  // Check: no wall shorter than minimum
  const shortWalls = walls.filter(w => wallLengthM(w) < MIN_WALL_LENGTH);
  if (shortWalls.length > 0) {
    console.warn(`[WALL-INTEGRITY] ${shortWalls.length} walls shorter than ${MIN_WALL_LENGTH}m minimum`);
  }

  // Check: interior walls connect to at least 1 other wall
  // (This is inherently satisfied by the grid-based generation)

  console.log(
    `[WALL-SYSTEM] Generated ${walls.length} walls (${exteriorWalls.length} exterior, ${walls.length - exteriorWalls.length} interior), ${grid.columns.length} columns`
  );
}
