/**
 * Multi-Floor Coordinator
 *
 * Ensures structural continuity across floors in multi-story buildings:
 *   - Same structural grid on every floor
 *   - Staircase alignment (same cells on every floor)
 *   - Wet area stacking (plumbing riser alignment)
 *   - Lift shaft continuity
 *   - Consistent floor-to-floor heights
 *
 * Standards: IS:456 (concrete), NBC 2016 Part 6, IS:1893 (seismic).
 *
 * Pure function — no side effects.
 */

import type { EnhancedRoomProgram } from '@/features/floor-plan/lib/ai-room-programmer';
import type { StructuralGrid, GridCell } from '@/features/floor-plan/lib/grid-generator';
import { generateStructuralGrid, getCell } from '@/features/floor-plan/lib/grid-generator';
import type { RoomAssignment, AssignedRoom } from '@/features/floor-plan/lib/grid-room-assigner';
import { assignRoomsToGrid } from '@/features/floor-plan/lib/grid-room-assigner';
import { classifyRoom } from '@/features/floor-plan/lib/room-sizer';
import { requiresVerticalAlignment } from '@/features/floor-plan/lib/architectural-rules';

// ============================================================
// TYPES
// ============================================================

export interface FloorLayout {
  /** Floor level (0 = ground) */
  level: number;
  /** Floor name */
  name: string;
  /** Room assignments for this floor */
  assignment: RoomAssignment;
}

export interface FloorCoordination {
  /** Shared structural grid (identical on all floors) */
  grid: StructuralGrid;
  /** Per-floor room assignments */
  floors: FloorLayout[];
  /** Staircase cells (locked across all floors) */
  staircaseCells: GridCell[];
  /** Lift shaft cells (locked across all floors) */
  liftCells: GridCell[];
  /** Plumbing core cell */
  plumbingCore: GridCell | null;
  /** Floor-to-floor height in mm */
  floorToFloorHeight: number;
}

// ============================================================
// CONSTANTS
// ============================================================

/** Floor-to-floor heights (mm) */
const RESIDENTIAL_FLOOR_HEIGHT = 3000; // 2750mm clear + 250mm slab/finish
const COMMERCIAL_FLOOR_HEIGHT = 3600;  // 3000mm clear + 600mm slab/services
const STILT_HEIGHT = 3000;             // 2400mm clear + 600mm for services

/** Standard staircase dimensions */
const STAIR_MIN_CELLS = 2; // minimum cells for a staircase
const LIFT_CELLS = 1;      // typically 1 cell for residential lift

// ============================================================
// HELPERS
// ============================================================

function isCommercial(buildingType: string): boolean {
  return /office|commercial|retail|hospital|school|hotel|institutional/i.test(buildingType);
}

function getFloorName(level: number, numFloors: number): string {
  if (level === 0) return 'Ground Floor';
  if (level === numFloors - 1 && numFloors > 2) return 'Top Floor';
  const ordinals = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
  return `${ordinals[level] ?? `${level}th`} Floor`;
}

/**
 * Find the best grid cells for a staircase.
 * Prefers center or corner position accessible from all zones.
 */
function findStaircaseCells(grid: StructuralGrid): GridCell[] {
  // Prefer center of the grid for maximum accessibility
  const centerCol = Math.floor(grid.gridCols / 2);
  const centerRow = Math.floor(grid.gridRows / 2);

  const cells: GridCell[] = [];

  // Try 2 cells vertically (typical staircase orientation)
  const cell1 = getCell(grid, centerCol, centerRow);
  const cell2 = getCell(grid, centerCol, centerRow + 1) ?? getCell(grid, centerCol, centerRow - 1);

  if (cell1) cells.push(cell1);
  if (cell2) cells.push(cell2);

  // If we can only get 1 cell, that's still valid
  if (cells.length === 0 && grid.cells.length > 0) {
    cells.push(grid.cells[Math.floor(grid.cells.length / 2)]);
  }

  return cells;
}

/**
 * Find the best cell for a lift shaft.
 * Should be adjacent to staircase.
 */
function findLiftCell(grid: StructuralGrid, staircaseCells: GridCell[]): GridCell | null {
  if (staircaseCells.length === 0) return null;

  const stairCell = staircaseCells[0];
  const candidates = [
    getCell(grid, stairCell.col + 1, stairCell.row),
    getCell(grid, stairCell.col - 1, stairCell.row),
    getCell(grid, stairCell.col, stairCell.row - 1),
    getCell(grid, stairCell.col, stairCell.row + 1),
  ].filter((c): c is GridCell => c !== undefined);

  // Prefer cell NOT already used by staircase
  const stairKeys = new Set(staircaseCells.map(c => `${c.col},${c.row}`));
  const free = candidates.filter(c => !stairKeys.has(`${c.col},${c.row}`));

  return free[0] ?? candidates[0] ?? null;
}

/**
 * Find plumbing core cell — should be near staircase for utility stack alignment.
 */
function findPlumbingCore(grid: StructuralGrid, staircaseCells: GridCell[]): GridCell | null {
  if (staircaseCells.length === 0) {
    // Fallback: use a perimeter cell in the service zone
    const perimCells = grid.cells.filter(c => c.isPerimeter);
    return perimCells[0] ?? null;
  }

  // Place plumbing core adjacent to staircase
  const stairCell = staircaseCells[staircaseCells.length - 1]; // use last stair cell
  const stairKeys = new Set(staircaseCells.map(c => `${c.col},${c.row}`));

  const candidates = [
    getCell(grid, stairCell.col + 1, stairCell.row),
    getCell(grid, stairCell.col - 1, stairCell.row),
    getCell(grid, stairCell.col, stairCell.row - 1),
    getCell(grid, stairCell.col, stairCell.row + 1),
  ].filter((c): c is GridCell =>
    c !== undefined && !stairKeys.has(`${c.col},${c.row}`)
  );

  return candidates[0] ?? null;
}

// ============================================================
// MAIN COORDINATOR
// ============================================================

/**
 * Coordinate room assignments across multiple floors.
 *
 * @param program - Room program with floor assignments
 * @param plotConstraints - Optional plot dimensions
 * @returns Coordinated floor layouts with shared grid
 */
export function coordinateFloors(
  program: EnhancedRoomProgram,
  plotConstraints?: {
    plotWidth?: number;
    plotDepth?: number;
    frontSetback?: number;
    rearSetback?: number;
    sideSetbackLeft?: number;
    sideSetbackRight?: number;
  },
): FloorCoordination {
  const numFloors = Math.max(program.numFloors, 1);
  const commercial = isCommercial(program.buildingType);
  const floorHeight = commercial ? COMMERCIAL_FLOOR_HEIGHT : RESIDENTIAL_FLOOR_HEIGHT;

  // Step 1: Generate SHARED structural grid (same for all floors)
  const grid = generateStructuralGrid(program, plotConstraints);
  console.log(`[MULTI-FLOOR] Grid: ${grid.gridCols}×${grid.gridRows}, ${grid.totalWidth.toFixed(1)}m × ${grid.totalDepth.toFixed(1)}m, ${numFloors} floors`);

  // Step 2: Lock staircase position (if multi-floor)
  let staircaseCells: GridCell[] = [];
  let liftCells: GridCell[] = [];

  if (numFloors > 1) {
    staircaseCells = findStaircaseCells(grid);
    console.log(`[MULTI-FLOOR] Staircase locked at cells: ${staircaseCells.map(c => c.gridRef).join(', ')}`);

    // Lock lift if program has a lift room
    const hasLift = program.rooms.some(r => {
      const cls = classifyRoom(r.type, r.name);
      return cls === 'lift' || cls === 'elevator';
    });
    if (hasLift) {
      const liftCell = findLiftCell(grid, staircaseCells);
      if (liftCell) {
        liftCells = [liftCell];
        console.log(`[MULTI-FLOOR] Lift locked at cell: ${liftCell.gridRef}`);
      }
    }
  }

  // Step 3: Find plumbing core
  const plumbingCore = findPlumbingCore(grid, staircaseCells);

  // Step 4: Assign rooms per floor with locked cells
  const floors: FloorLayout[] = [];

  for (let level = 0; level < numFloors; level++) {
    const floorName = getFloorName(level, numFloors);

    // Build pre-locked cells for this floor
    const preLockedCells = new Map<string, GridCell[]>();

    // Lock staircase cells on every floor (except possibly ground floor parking)
    if (staircaseCells.length > 0) {
      const stairRoomId = `staircase-floor${level}`;
      preLockedCells.set(stairRoomId, staircaseCells);
    }

    // Lock lift cells on every floor
    if (liftCells.length > 0) {
      const liftRoomId = `lift-floor${level}`;
      preLockedCells.set(liftRoomId, liftCells);
    }

    // Create a floor-specific program
    const floorRooms = program.rooms.filter(r => (r.floor ?? 0) === level);

    // If no rooms assigned to this floor but multi-floor, distribute by type.
    // This handles cases where AI/fallback puts all rooms on floor 0 but the
    // building is multi-story.
    let roomsForFloor = floorRooms;
    if (level > 0 && roomsForFloor.length === 0 && numFloors > 1) {
      // Check if all rooms are on floor 0 — if so, redistribute by type
      const allOnGround = program.rooms.every(r => (r.floor ?? 0) === 0);
      if (allOnGround) {
        const UPPER_FLOOR_TYPES = new Set([
          'bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom',
          'bathroom', 'master_bathroom', 'toilet', 'powder_room',
          'study', 'home_office', 'pooja_room', 'walk_in_closet', 'dressing_room',
          'gym', 'home_theater', 'media_room', 'library',
          'utility', 'balcony', 'terrace',
        ]);
        roomsForFloor = program.rooms.filter(r => {
          const cls = classifyRoom(r.type, r.name);
          // Staircase is handled by pre-locked cells
          if (cls === 'staircase') return false;
          return UPPER_FLOOR_TYPES.has(cls);
        });
        console.log(`[MULTI-FLOOR] Redistributed ${roomsForFloor.length} rooms to floor ${level}: ${roomsForFloor.map(r => r.name).join(', ')}`);
      }
    }
    // For ground floor in redistribution mode: keep only public/service rooms
    if (level === 0 && numFloors > 1) {
      const allOnGround = program.rooms.every(r => (r.floor ?? 0) === 0);
      if (allOnGround && program.rooms.length > grid.cells.length * 0.8) {
        const GROUND_FLOOR_TYPES = new Set([
          'living_room', 'drawing_room', 'dining_room', 'kitchen', 'foyer',
          'entrance_lobby', 'parking', 'garage', 'car_porch', 'reception',
          'corridor', 'hallway', 'servant_quarter', 'servant_toilet',
          'verandah', 'garden',
        ]);
        roomsForFloor = program.rooms.filter(r => {
          const cls = classifyRoom(r.type, r.name);
          if (cls === 'staircase') return false;
          return GROUND_FLOOR_TYPES.has(cls);
        });
        console.log(`[MULTI-FLOOR] Ground floor limited to ${roomsForFloor.length} rooms: ${roomsForFloor.map(r => r.name).join(', ')}`);
      }
    }

    const floorProgram: EnhancedRoomProgram = {
      ...program,
      rooms: roomsForFloor,
    };

    const assignment = assignRoomsToGrid(grid, floorProgram, preLockedCells);

    floors.push({
      level,
      name: floorName,
      assignment,
    });

    const roomCount = assignment.roomOrder.length;
    console.log(`[MULTI-FLOOR] Floor ${level} (${floorName}): ${roomCount} rooms assigned`);
  }

  // Step 5: Validate vertical alignment of wet rooms
  validateVerticalAlignment(floors, grid);

  return {
    grid,
    floors,
    staircaseCells,
    liftCells,
    plumbingCore,
    floorToFloorHeight: floorHeight,
  };
}

/**
 * Validate that wet rooms align vertically across floors.
 * Logs warnings for misaligned wet stacks.
 */
function validateVerticalAlignment(floors: FloorLayout[], grid: StructuralGrid): void {
  if (floors.length < 2) return;

  for (let i = 1; i < floors.length; i++) {
    const prevFloor = floors[i - 1];
    const currFloor = floors[i];

    const prevWetRooms = prevFloor.assignment.roomOrder.filter(ar =>
      requiresVerticalAlignment(ar.classifiedType)
    );
    const currWetRooms = currFloor.assignment.roomOrder.filter(ar =>
      requiresVerticalAlignment(ar.classifiedType)
    );

    // Check if wet rooms on current floor align with those below
    for (const currWet of currWetRooms) {
      const currCellKeys = new Set(currWet.cells.map(c => `${c.col},${c.row}`));

      const hasAlignedBelow = prevWetRooms.some(prevWet =>
        prevWet.cells.some(pc => currCellKeys.has(`${pc.col},${pc.row}`))
      );

      if (!hasAlignedBelow && prevWetRooms.length > 0) {
        console.warn(
          `[MULTI-FLOOR] Wet room "${currWet.spec.name}" on floor ${i} does not align with any wet room on floor ${i - 1}`
        );
      }
    }
  }
}

/**
 * Generate staircase dimensions from floor height.
 * Returns riser count, riser height, tread depth.
 */
export function calculateStairDimensions(floorToFloorMm: number): {
  riserCount: number;
  riserHeight: number;
  treadDepth: number;
  flights: number;
  landingCount: number;
} {
  // NBC limits: max riser 190mm, min tread 250mm
  const maxRiser = 190;
  const minTread = 250;

  // Calculate riser count
  const riserCount = Math.ceil(floorToFloorMm / maxRiser);
  const riserHeight = Math.round(floorToFloorMm / riserCount);

  // 2R + T = 550-650mm (ergonomic formula)
  const treadDepth = Math.max(minTread, Math.round(600 - 2 * riserHeight));

  // Double-flight (U-turn) staircase: split into 2 flights with landing
  const flights = 2;
  const risersPerFlight = Math.ceil(riserCount / flights);
  const landingCount = flights - 1;

  return {
    riserCount,
    riserHeight,
    treadDepth,
    flights,
    landingCount,
  };
}
