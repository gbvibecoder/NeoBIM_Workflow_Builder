/**
 * Grid-Cell Room Assigner
 *
 * Assigns rooms to structural grid cells using constraint satisfaction.
 * Each room occupies 1+ adjacent cells. This guarantees:
 *   - Rooms NEVER overlap (each cell belongs to exactly one room)
 *   - No gaps (all cells are assigned)
 *   - Walls are grid lines (always continuous)
 *   - Room dimensions are multiples of bay size
 *
 * Replaces BSP layout + dimension corrector for the grid-first pipeline.
 *
 * Pure function — no side effects, no API calls.
 */

import type { EnhancedRoomProgram, RoomSpec } from '@/features/floor-plan/lib/ai-room-programmer';
import type { StructuralGrid, GridCell } from '@/features/floor-plan/lib/grid-generator';
import {
  getCell,
  getAdjacentCells,
  getPerimeterCells,
  cellGroupArea,
  areCellsContiguous,
  cellGroupAspectRatio,
} from '@/features/floor-plan/lib/grid-generator';
import { getRoomRule } from '@/features/floor-plan/lib/architectural-rules';
import { classifyRoom } from '@/features/floor-plan/lib/room-sizer';

// ============================================================
// TYPES
// ============================================================

export interface RoomAssignment {
  /** Map of roomId → assigned grid cells */
  assignments: Map<string, GridCell[]>;
  /** Cells assigned as corridor / circulation */
  corridorCells: GridCell[];
  /** The cell nearest the building entrance */
  entranceCell: GridCell | null;
  /** The cell where wet stacks align (plumbing core) */
  plumbingCore: GridCell | null;
  /** Room specs in priority order (as assigned) */
  roomOrder: AssignedRoom[];
  /** Fraction of requested rooms successfully placed (0-1) */
  placementRatio: number;
}

export interface AssignedRoom {
  /** Unique ID for this room */
  id: string;
  /** Room spec from program */
  spec: RoomSpec;
  /** Canonical room type (classified) */
  classifiedType: string;
  /** Assigned grid cells */
  cells: GridCell[];
  /** Bounding box in meters */
  bounds: { x: number; y: number; width: number; depth: number };
  /** Actual area from cells (sqm) */
  actualArea: number;
}

// ============================================================
// CONSTANTS
// ============================================================

/** Maximum constraint-satisfaction attempts before fallback */
const MAX_ATTEMPTS = 500;

/** Priority weights for placement scoring */
const SCORE_EXTERIOR_WALL = 50;
const SCORE_REQUIRED_ADJACENCY = 30;
const SCORE_CORRECT_ZONE = 20;
const SCORE_AWAY_FROM = 15;
const SCORE_PLUMBING_PROXIMITY = 25;
const SCORE_GOOD_ASPECT_RATIO = 10;
const SCORE_PREFERRED_ADJACENCY = 15;

// ============================================================
// ROOM PRIORITY
// ============================================================

/**
 * Sort rooms by placement priority.
 * High-priority rooms (stairs, wet) are placed first to lock critical positions.
 */
function sortByPriority(rooms: RoomSpec[]): Array<RoomSpec & { priority: number }> {
  return rooms.map(r => {
    const cls = classifyRoom(r.type, r.name);
    let priority = 50; // default

    if (cls === 'staircase') priority = 10;
    else if (cls === 'lift') priority = 12;
    else if (cls === 'kitchen') priority = 15;
    else if (['bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath', 'servant_toilet'].includes(cls)) priority = 18;
    else if (cls === 'master_bedroom') priority = 20;
    else if (['living_room', 'drawing_room'].includes(cls)) priority = 22;
    else if (cls === 'dining_room') priority = 25;
    else if (['bedroom', 'guest_bedroom', 'children_bedroom'].includes(cls)) priority = 30;
    else if (['pooja_room', 'study', 'home_office'].includes(cls)) priority = 35;
    else if (['utility', 'store_room', 'servant_quarter', 'laundry'].includes(cls)) priority = 40;
    else if (['corridor', 'hallway', 'passage', 'foyer', 'entrance_lobby'].includes(cls)) priority = 60;
    else if (['balcony', 'verandah', 'terrace', 'sit_out'].includes(cls)) priority = 70;

    return { ...r, priority };
  }).sort((a, b) => a.priority - b.priority);
}

// ============================================================
// ZONE CLASSIFICATION
// ============================================================

type ZoneType = 'public' | 'private' | 'service' | 'circulation';

/**
 * Classify grid cells into zones based on entrance position.
 * Public zone: near entrance. Private zone: away from entrance.
 * Service zone: adjacent to plumbing core.
 */
function classifyZones(
  grid: StructuralGrid,
  entranceEdge: 'top' | 'bottom' | 'left' | 'right' = 'bottom',
): Map<string, ZoneType> {
  const zones = new Map<string, ZoneType>();

  for (const cell of grid.cells) {
    const key = `${cell.col},${cell.row}`;

    // Determine distance from entrance edge
    let distFromEntrance: number;
    switch (entranceEdge) {
      case 'bottom': distFromEntrance = (grid.gridRows - 1 - cell.row) / Math.max(grid.gridRows - 1, 1); break;
      case 'top': distFromEntrance = cell.row / Math.max(grid.gridRows - 1, 1); break;
      case 'left': distFromEntrance = cell.col / Math.max(grid.gridCols - 1, 1); break;
      case 'right': distFromEntrance = (grid.gridCols - 1 - cell.col) / Math.max(grid.gridCols - 1, 1); break;
    }

    if (distFromEntrance <= 0.35) zones.set(key, 'public');
    else if (distFromEntrance >= 0.65) zones.set(key, 'private');
    else zones.set(key, 'circulation');
  }

  return zones;
}

// ============================================================
// PLACEMENT FINDING
// ============================================================

/**
 * Find all valid contiguous cell groups of a given count.
 * Uses BFS expansion from each starting cell.
 */
function findPlacements(
  grid: StructuralGrid,
  cellCount: number,
  availableCells: Set<string>,
): GridCell[][] {
  if (cellCount <= 0) return [];

  const placements: GridCell[][] = [];
  const seen = new Set<string>(); // dedup

  for (const startKey of availableCells) {
    const [sc, sr] = startKey.split(',').map(Number);
    const startCell = getCell(grid, sc, sr);
    if (!startCell) continue;

    // BFS expansion to find all contiguous groups of exactly cellCount
    const queue: Array<{ cells: GridCell[]; frontier: string[] }> = [
      { cells: [startCell], frontier: [] },
    ];

    // Initialize frontier
    const initialFrontier: string[] = [];
    for (const adj of getAdjacentCells(grid, sc, sr)) {
      const adjKey = `${adj.col},${adj.row}`;
      if (availableCells.has(adjKey) && adjKey !== startKey) {
        initialFrontier.push(adjKey);
      }
    }
    queue[0].frontier = initialFrontier;

    if (cellCount === 1) {
      const sig = startKey;
      if (!seen.has(sig)) {
        seen.add(sig);
        placements.push([startCell]);
      }
      continue;
    }

    // BFS to grow cell groups
    const maxExpansions = 50; // limit per start cell for performance
    let expansions = 0;

    while (queue.length > 0 && expansions < maxExpansions) {
      const { cells, frontier } = queue.shift()!;
      if (cells.length === cellCount) {
        const sig = cells.map(c => `${c.col},${c.row}`).sort().join('|');
        if (!seen.has(sig)) {
          seen.add(sig);
          placements.push([...cells]);
        }
        continue;
      }

      for (const fKey of frontier) {
        const [fc, fr] = fKey.split(',').map(Number);
        const fCell = getCell(grid, fc, fr);
        if (!fCell) continue;

        const newCells = [...cells, fCell];
        const cellKeys = new Set(newCells.map(c => `${c.col},${c.row}`));

        // Expand frontier
        const newFrontier: string[] = [];
        for (const c of newCells) {
          for (const adj of getAdjacentCells(grid, c.col, c.row)) {
            const adjKey = `${adj.col},${adj.row}`;
            if (availableCells.has(adjKey) && !cellKeys.has(adjKey) && !newFrontier.includes(adjKey)) {
              newFrontier.push(adjKey);
            }
          }
        }

        queue.push({ cells: newCells, frontier: newFrontier });
        expansions++;
      }
    }
  }

  // Filter to rectangular placements only — L-shapes create bounding-box overlaps
  // with adjacent rooms and produce non-rectangular room outlines.
  const rectangular = placements.filter(cells => {
    if (cells.length <= 1) return true;
    const cols = new Set(cells.map(c => c.col));
    const rows = new Set(cells.map(c => c.row));
    // Rectangular = every combination of col×row in the bounding box is present
    return cells.length === cols.size * rows.size;
  });

  // Fall back to all placements if no rectangular ones found
  const result = rectangular.length > 0 ? rectangular : placements;

  // Limit total placements for performance
  return result.slice(0, 200);
}

// ============================================================
// SCORING
// ============================================================

/**
 * Score a placement for a room.
 */
function scorePlacement(
  cells: GridCell[],
  spec: RoomSpec,
  classifiedType: string,
  grid: StructuralGrid,
  zoneMap: Map<string, ZoneType>,
  assignedRooms: AssignedRoom[],
  plumbingCore: GridCell | null,
): number {
  let score = 0;
  const rule = getRoomRule(classifiedType);

  // 1. Exterior wall access
  const hasExterior = cells.some(c => c.isPerimeter);
  if (rule.exteriorWall === 'required') {
    score += hasExterior ? SCORE_EXTERIOR_WALL : -100; // hard penalty
  } else if (rule.exteriorWall === 'preferred') {
    score += hasExterior ? SCORE_EXTERIOR_WALL / 2 : 0;
  }

  // 2. Zone matching
  const specZone = spec.zone as ZoneType;
  const cellZones = cells.map(c => zoneMap.get(`${c.col},${c.row}`) ?? 'circulation');
  const matchingZone = cellZones.filter(z => z === specZone).length;
  score += (matchingZone / Math.max(cells.length, 1)) * SCORE_CORRECT_ZONE;

  // 3. Required adjacency satisfaction
  for (const adjType of rule.adjacentTo) {
    const adjRoom = assignedRooms.find(ar => {
      const arType = classifyRoom(ar.spec.type, ar.spec.name);
      return arType === adjType;
    });
    if (adjRoom) {
      // Check if any of our cells are adjacent to any of their cells
      const isAdj = cells.some(c =>
        getAdjacentCells(grid, c.col, c.row).some(ac =>
          adjRoom.cells.some(rc => rc.col === ac.col && rc.row === ac.row)
        )
      );
      score += isAdj ? SCORE_REQUIRED_ADJACENCY : -20;
    }
  }

  // 4. Preferred adjacency
  for (const prefType of rule.preferredAdjacent) {
    const prefRoom = assignedRooms.find(ar => {
      const arType = classifyRoom(ar.spec.type, ar.spec.name);
      return arType === prefType;
    });
    if (prefRoom) {
      const isAdj = cells.some(c =>
        getAdjacentCells(grid, c.col, c.row).some(ac =>
          prefRoom.cells.some(rc => rc.col === ac.col && rc.row === ac.row)
        )
      );
      if (isAdj) score += SCORE_PREFERRED_ADJACENCY;
    }
  }

  // 5. Away-from constraint
  for (const awayType of rule.awayFrom) {
    const awayRoom = assignedRooms.find(ar => {
      const arType = classifyRoom(ar.spec.type, ar.spec.name);
      return arType === awayType;
    });
    if (awayRoom) {
      const isAdj = cells.some(c =>
        getAdjacentCells(grid, c.col, c.row).some(ac =>
          awayRoom.cells.some(rc => rc.col === ac.col && rc.row === ac.row)
        )
      );
      score += isAdj ? -SCORE_AWAY_FROM : SCORE_AWAY_FROM;
    }
  }

  // 6. Plumbing proximity for wet rooms
  if (rule.category === 'wet' && plumbingCore) {
    const minDist = Math.min(...cells.map(c =>
      Math.abs(c.col - plumbingCore.col) + Math.abs(c.row - plumbingCore.row)
    ));
    score += Math.max(0, SCORE_PLUMBING_PROXIMITY - minDist * 5);
  }

  // 7. Aspect ratio
  const ar = cellGroupAspectRatio(cells);
  score += ar <= rule.aspectRatio.max ? SCORE_GOOD_ASPECT_RATIO : -5;

  // 8. Name-based adjacency from program
  for (const adjName of spec.adjacentTo) {
    const adjRoom = assignedRooms.find(ar => ar.spec.name.toLowerCase() === adjName.toLowerCase());
    if (adjRoom) {
      const isAdj = cells.some(c =>
        getAdjacentCells(grid, c.col, c.row).some(ac =>
          adjRoom.cells.some(rc => rc.col === ac.col && rc.row === ac.row)
        )
      );
      score += isAdj ? SCORE_REQUIRED_ADJACENCY : -15;
    }
  }

  return score;
}

// ============================================================
// APARTMENT LAYOUT STRATEGY
// ============================================================

/**
 * Structured layout for apartments/flats:
 *   Row 0 (top): Private zone — bedrooms + attached bathrooms
 *   Row 1 (middle): Corridor strip — spans full width
 *   Row 2 (bottom): Public zone — living, dining, kitchen + service rooms
 *
 * This produces a typical Indian apartment layout with clear zone separation.
 */
function assignApartmentLayout(
  grid: StructuralGrid,
  program: EnhancedRoomProgram,
  preLockedCells?: Map<string, GridCell[]>,
): RoomAssignment | null {
  const floorRooms = program.rooms;
  const assignments = new Map<string, GridCell[]>();
  const assignedRooms: AssignedRoom[] = [];
  const availableCells = new Set<string>(grid.cells.map(c => `${c.col},${c.row}`));
  let roomIdx = 0;

  // Apply pre-locked cells
  if (preLockedCells) {
    for (const [roomId, cells] of preLockedCells) {
      for (const c of cells) availableCells.delete(`${c.col},${c.row}`);
      assignments.set(roomId, cells);
    }
  }

  // Classify rooms
  const bedrooms: RoomSpec[] = [];
  const bathrooms: RoomSpec[] = [];
  const publicRooms: RoomSpec[] = []; // living, dining, kitchen
  const serviceRooms: RoomSpec[] = []; // utility, balcony, etc.
  const corridorRooms: RoomSpec[] = [];

  for (const r of floorRooms) {
    const cls = classifyRoom(r.type, r.name);
    if (['bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom'].includes(cls)) {
      bedrooms.push(r);
    } else if (['bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath', 'servant_toilet'].includes(cls)) {
      bathrooms.push(r);
    } else if (['living_room', 'drawing_room', 'dining_room', 'kitchen'].includes(cls)) {
      publicRooms.push(r);
    } else if (CIRCULATION_TYPES.has(cls)) {
      corridorRooms.push(r);
    } else {
      serviceRooms.push(r);
    }
  }

  // Determine rows: corridor gets the middle row
  const corridorRow = Math.floor(grid.gridRows / 2);
  const topRows = Array.from({ length: corridorRow }, (_, i) => i);
  const bottomRows = Array.from({ length: grid.gridRows - corridorRow - 1 }, (_, i) => corridorRow + 1 + i);

  // ── Step 1: Assign corridor to middle row ──
  const corridorSpec = corridorRooms[0];
  if (corridorSpec) {
    const corridorCellsList: GridCell[] = [];
    for (let col = 0; col < grid.gridCols; col++) {
      const cell = getCell(grid, col, corridorRow);
      if (cell && availableCells.has(`${col},${corridorRow}`)) {
        corridorCellsList.push(cell);
        availableCells.delete(`${col},${corridorRow}`);
      }
    }
    if (corridorCellsList.length > 0) {
      const id = `room-${roomIdx++}`;
      markAssigned(corridorCellsList, id, corridorSpec, classifyRoom(corridorSpec.type, corridorSpec.name), availableCells, assignments, assignedRooms);
    }
  }

  // ── Step 2: Place bedrooms + attached bathrooms in top rows ──
  // Build bedroom-bathroom pairs from adjacency
  const bedBathPairs: Array<{ bed: RoomSpec; bath: RoomSpec | null }> = [];
  const usedBaths = new Set<string>();
  for (const bed of bedrooms) {
    // Find attached bathroom via adjacency
    const adj = program.adjacency.find(a =>
      (a.roomA === bed.name || a.roomB === bed.name) && a.reason.includes('bath')
    );
    let pairedBath: RoomSpec | null = null;
    if (adj) {
      const bathName = adj.roomA === bed.name ? adj.roomB : adj.roomA;
      pairedBath = bathrooms.find(b => b.name === bathName && !usedBaths.has(b.name)) ?? null;
      if (pairedBath) usedBaths.add(pairedBath.name);
    }
    // Also check room's adjacentTo
    if (!pairedBath) {
      for (const adjName of bed.adjacentTo) {
        pairedBath = bathrooms.find(b => b.name === adjName && !usedBaths.has(b.name)) ?? null;
        if (pairedBath) { usedBaths.add(pairedBath.name); break; }
      }
    }
    bedBathPairs.push({ bed, bath: pairedBath });
  }

  // Place pairs in top rows: each pair takes 2 adjacent columns (bed + bath)
  let topCol = 0;
  for (const pair of bedBathPairs) {
    for (const row of topRows) {
      if (topCol >= grid.gridCols) break;
      const bedCell = getCell(grid, topCol, row);
      if (bedCell && availableCells.has(`${topCol},${row}`)) {
        const bedId = `room-${roomIdx++}`;
        availableCells.delete(`${topCol},${row}`);
        assignments.set(bedId, [bedCell]);
        assignedRooms.push({
          id: bedId, spec: pair.bed, classifiedType: classifyRoom(pair.bed.type, pair.bed.name),
          cells: [bedCell], bounds: { x: bedCell.x, y: bedCell.y, width: bedCell.width, depth: bedCell.depth },
          actualArea: bedCell.width * bedCell.depth,
        });

        // Place bath in adjacent column (same row)
        if (pair.bath && topCol + 1 < grid.gridCols) {
          const bathCell = getCell(grid, topCol + 1, row);
          if (bathCell && availableCells.has(`${topCol + 1},${row}`)) {
            const bathId = `room-${roomIdx++}`;
            availableCells.delete(`${topCol + 1},${row}`);
            assignments.set(bathId, [bathCell]);
            assignedRooms.push({
              id: bathId, spec: pair.bath, classifiedType: classifyRoom(pair.bath.type, pair.bath.name),
              cells: [bathCell], bounds: { x: bathCell.x, y: bathCell.y, width: bathCell.width, depth: bathCell.depth },
              actualArea: bathCell.width * bathCell.depth,
            });
            topCol += 2; // Skip past both bed + bath columns
            continue;
          }
        }
        topCol += 1;
      }
    }
    if (topCol >= grid.gridCols) {
      topCol = 0; // Wrap to next row if needed
    }
  }

  // ── Step 3: Place public rooms in bottom rows ──
  // Order: kitchen, dining, living (left to right — kitchen near service, living at entrance)
  const publicOrder = ['kitchen', 'dining_room', 'living_room', 'drawing_room'];
  const sortedPublic = [...publicRooms].sort((a, b) => {
    const ai = publicOrder.indexOf(classifyRoom(a.type, a.name));
    const bi = publicOrder.indexOf(classifyRoom(b.type, b.name));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  let bottomCol = 0;
  for (const room of sortedPublic) {
    for (const row of bottomRows) {
      if (bottomCol >= grid.gridCols) break;
      const cell = getCell(grid, bottomCol, row);
      if (cell && availableCells.has(`${bottomCol},${row}`)) {
        const id = `room-${roomIdx++}`;
        availableCells.delete(`${bottomCol},${row}`);
        assignments.set(id, [cell]);
        assignedRooms.push({
          id, spec: room, classifiedType: classifyRoom(room.type, room.name),
          cells: [cell], bounds: { x: cell.x, y: cell.y, width: cell.width, depth: cell.depth },
          actualArea: cell.width * cell.depth,
        });
        bottomCol++;
        break;
      }
    }
  }

  // ── Step 4: Place remaining rooms (unattached baths, service, etc.) in available cells ──
  const unplacedBaths = bathrooms.filter(b => !usedBaths.has(b.name));
  const remaining = [...unplacedBaths, ...serviceRooms, ...corridorRooms.slice(1)];
  for (const room of remaining) {
    // Find first available cell
    for (const key of availableCells) {
      const [col, row] = key.split(',').map(Number);
      const cell = getCell(grid, col, row);
      if (cell) {
        const id = `room-${roomIdx++}`;
        availableCells.delete(key);
        assignments.set(id, [cell]);
        assignedRooms.push({
          id, spec: room, classifiedType: classifyRoom(room.type, room.name),
          cells: [cell], bounds: { x: cell.x, y: cell.y, width: cell.width, depth: cell.depth },
          actualArea: cell.width * cell.depth,
        });
        break;
      }
    }
  }

  // Remaining cells become corridor
  const corridorCells: GridCell[] = [];
  for (const key of availableCells) {
    const [col, row] = key.split(',').map(Number);
    const cell = getCell(grid, col, row);
    if (cell) corridorCells.push(cell);
  }

  const bottomCells = grid.cells.filter(c => c.row === grid.gridRows - 1);
  const entranceCell = bottomCells.length > 0 ? bottomCells[Math.floor(bottomCells.length / 2)] : null;
  const placementRatio = floorRooms.length > 0 ? assignedRooms.length / floorRooms.length : 1;

  if (assignedRooms.length < floorRooms.length) {
    console.warn(`[APARTMENT-LAYOUT] Placed ${assignedRooms.length} of ${floorRooms.length} rooms`);
  }

  return {
    assignments,
    corridorCells,
    entranceCell,
    plumbingCore: null,
    roomOrder: assignedRooms,
    placementRatio,
  };
}

// ============================================================
// MAIN ASSIGNER
// ============================================================

/**
 * Assign rooms to grid cells via constraint satisfaction.
 *
 * @param grid - Structural grid from grid-generator
 * @param program - Room program from ai-room-programmer
 * @param preLockedCells - Map of roomId → pre-locked cells (e.g., staircase across floors)
 * @returns Room assignments
 */
export function assignRoomsToGrid(
  grid: StructuralGrid,
  program: EnhancedRoomProgram,
  preLockedCells?: Map<string, GridCell[]>,
): RoomAssignment {
  const floorRooms = program.rooms;

  // For apartments/flats with a corridor, use the structured layout strategy
  const isApartment = /apartment|flat/i.test(program.buildingType);
  const hasCorridorRoom = floorRooms.some(r => {
    const cls = classifyRoom(r.type, r.name);
    return CIRCULATION_TYPES.has(cls);
  });
  if (isApartment && hasCorridorRoom && grid.gridRows >= 3) {
    const result = assignApartmentLayout(grid, program, preLockedCells);
    if (result && result.placementRatio >= 0.8) {
      return result;
    }
    // Fall through to generic if apartment layout didn't work
  }

  const sortedRooms = sortByPriority(floorRooms);
  const zoneMap = classifyZones(grid, 'bottom');
  const availableCells = new Set<string>(grid.cells.map(c => `${c.col},${c.row}`));
  const assignedRooms: AssignedRoom[] = [];
  const assignments = new Map<string, GridCell[]>();

  // Apply pre-locked cells (e.g., staircase shared across floors)
  if (preLockedCells) {
    for (const [roomId, cells] of preLockedCells) {
      for (const c of cells) {
        availableCells.delete(`${c.col},${c.row}`);
      }
      assignments.set(roomId, cells);
    }
  }

  // Determine plumbing core location — prefer a service-zone perimeter cell
  let plumbingCore: GridCell | null = null;
  const perimCells = getPerimeterCells(grid);
  const serviceCells = perimCells.filter(c => {
    const zone = zoneMap.get(`${c.col},${c.row}`);
    return zone === 'circulation' || zone === 'private';
  });
  plumbingCore = serviceCells[0] ?? perimCells[0] ?? null;

  // Assign rooms in priority order
  for (let roomIdx = 0; roomIdx < sortedRooms.length; roomIdx++) {
    const roomSpec = sortedRooms[roomIdx];
    const roomId = `room-${roomIdx}`;
    const classifiedType = classifyRoom(roomSpec.type, roomSpec.name);

    // Calculate how many cells this room needs.
    // Use ceil for rooms larger than 70% of a cell — prevents living rooms
    // from being rounded down to 1 cell when they need 1.4 cells.
    // Use round for small rooms — prevents bathrooms from claiming 2 cells.
    // Cap: never claim so many cells that remaining rooms can't each get at least 1.
    const avgCellArea = grid.totalWidth * grid.totalDepth / grid.cells.length;
    const rawCells = roomSpec.areaSqm / avgCellArea;
    const remainingRoomsAfterThis = sortedRooms.length - roomIdx - 1;
    const maxClaimable = Math.max(1, availableCells.size - remainingRoomsAfterThis);
    const neededCells = Math.min(maxClaimable, Math.max(1,
      rawCells > 0.7 ? Math.ceil(rawCells) : Math.round(rawCells)
    ));

    // Find all valid placements
    const placements = findPlacements(grid, neededCells, availableCells);

    if (placements.length === 0) {
      // Try with fewer cells (room will be smaller than target)
      const reducedCells = Math.max(1, neededCells - 1);
      const reducedPlacements = findPlacements(grid, reducedCells, availableCells);

      if (reducedPlacements.length === 0) {
        // Last resort: place in any single available cell
        const singlePlacements = findPlacements(grid, 1, availableCells);
        if (singlePlacements.length > 0) {
          const best = singlePlacements.reduce((bestP, p) => {
            const s = scorePlacement(p, roomSpec, classifiedType, grid, zoneMap, assignedRooms, plumbingCore);
            const bs = scorePlacement(bestP, roomSpec, classifiedType, grid, zoneMap, assignedRooms, plumbingCore);
            return s > bs ? p : bestP;
          });
          markAssigned(best, roomId, roomSpec, classifiedType, availableCells, assignments, assignedRooms);
          continue;
        }
        // Cannot place via normal path — try packing into an oversized room's cell
        const packed = packIntoOversizedCell(roomId, roomSpec, classifiedType, grid, assignedRooms, assignments);
        if (!packed) {
          console.warn(`[GRID-ASSIGN] Cannot place room "${roomSpec.name}" — no available cells and no oversized cell to share`);
        }
        continue;
      }

      const best = pickBestPlacement(reducedPlacements, roomSpec, classifiedType, grid, zoneMap, assignedRooms, plumbingCore);
      markAssigned(best, roomId, roomSpec, classifiedType, availableCells, assignments, assignedRooms);
      continue;
    }

    const best = pickBestPlacement(placements, roomSpec, classifiedType, grid, zoneMap, assignedRooms, plumbingCore);
    markAssigned(best, roomId, roomSpec, classifiedType, availableCells, assignments, assignedRooms);

    // Set plumbing core to first wet room assigned
    if (getRoomRule(classifiedType).category === 'wet' && !plumbingCore) {
      plumbingCore = best[0];
    }
  }

  // Remaining cells become corridor
  const corridorCells: GridCell[] = [];
  for (const key of availableCells) {
    const [col, row] = key.split(',').map(Number);
    const cell = getCell(grid, col, row);
    if (cell) corridorCells.push(cell);
  }

  // Sub-cell splitting removed — bay dimension optimization in grid-generator
  // now sizes each column/row to fit its rooms, making cells right-sized.

  // Find entrance cell (bottom-center perimeter cell)
  const bottomCells = grid.cells.filter(c => c.row === grid.gridRows - 1);
  const entranceCell = bottomCells.length > 0
    ? bottomCells[Math.floor(bottomCells.length / 2)]
    : null;

  // Validate corridor connectivity
  validateCorridorConnectivity(grid, assignedRooms, corridorCells);

  // Check contiguity: all occupied cells must form one connected group
  ensureContiguousLayout(grid, assignedRooms, corridorCells);

  // Log placement completeness
  const programRoomCount = floorRooms.length;
  const placementRatio = programRoomCount > 0 ? assignedRooms.length / programRoomCount : 1;
  if (assignedRooms.length < programRoomCount) {
    console.warn(`[GRID-ASSIGN] Only placed ${assignedRooms.length} of ${programRoomCount} rooms — grid may be too small (${grid.gridCols}×${grid.gridRows}=${grid.cells.length} cells for ${programRoomCount} rooms)`);
  }

  return {
    assignments,
    corridorCells,
    entranceCell,
    plumbingCore,
    roomOrder: assignedRooms,
    placementRatio,
  };
}

// ============================================================
// HELPERS
// ============================================================

// ============================================================
// PACK UNPLACED ROOMS INTO OVERSIZED CELLS
// ============================================================

/**
 * When all grid cells are occupied but rooms remain, pack the unplaced room
 * into an existing oversized room's cell via sub-cell sharing.
 * A 3m×4m cell (12 sqm) can hold a 4 sqm bathroom + leave 8 sqm for the host.
 */
function packIntoOversizedCell(
  roomId: string,
  spec: RoomSpec,
  classifiedType: string,
  grid: StructuralGrid,
  assignedRooms: AssignedRoom[],
  assignments: Map<string, GridCell[]>,
): boolean {
  const rule = getRoomRule(classifiedType);
  const minW = rule.width.min;
  const minD = rule.depth.min;

  // Find the most oversized room that can donate space
  let bestHost: AssignedRoom | null = null;
  let bestExcess = 0;

  for (const ar of assignedRooms) {
    if (ar.cells.length !== 1) continue; // only split single-cell rooms
    const excess = ar.actualArea - ar.spec.areaSqm;
    if (excess < spec.areaSqm * 0.6) continue; // not enough excess to donate
    const cell = ar.cells[0];
    // Check that splitting leaves both rooms with valid dimensions
    const splitOk = cell.width >= minW + 1.2 || cell.depth >= minD + 1.2;
    if (splitOk && excess > bestExcess) {
      bestExcess = excess;
      bestHost = ar;
    }
  }

  if (!bestHost) return false;

  const cell = bestHost.cells[0];
  const splitHorizontal = cell.depth >= cell.width;

  // Calculate split: new room gets its target area, host keeps the rest
  let newDim: number;
  if (splitHorizontal) {
    newDim = Math.max(minD, Math.min(spec.areaSqm / cell.width, cell.depth - 1.2));
    newDim = Math.round(newDim * 10) / 10;
  } else {
    newDim = Math.max(minW, Math.min(spec.areaSqm / cell.depth, cell.width - 1.2));
    newDim = Math.round(newDim * 10) / 10;
  }

  // Create the new room with sub-cell bounds
  let newBounds: { x: number; y: number; width: number; depth: number };
  if (splitHorizontal) {
    // New room at bottom of cell
    newBounds = { x: cell.x, y: cell.y + cell.depth - newDim, width: cell.width, depth: newDim };
    // Shrink host
    bestHost.bounds = { x: cell.x, y: cell.y, width: cell.width, depth: cell.depth - newDim };
    bestHost.actualArea = bestHost.bounds.width * bestHost.bounds.depth;
  } else {
    // New room at right of cell
    newBounds = { x: cell.x + cell.width - newDim, y: cell.y, width: newDim, depth: cell.depth };
    bestHost.bounds = { x: cell.x, y: cell.y, width: cell.width - newDim, depth: cell.depth };
    bestHost.actualArea = bestHost.bounds.width * bestHost.bounds.depth;
  }

  // Register the new room (shares the same cell but with different bounds)
  const newArea = newBounds.width * newBounds.depth;
  assignments.set(roomId, [cell]); // shares cell reference
  assignedRooms.push({
    id: roomId,
    spec,
    classifiedType,
    cells: [cell], // structural cell is shared
    bounds: newBounds,
    actualArea: newArea,
  });

  console.log(`[GRID-ASSIGN] Packed "${spec.name}" (${newArea.toFixed(1)} sqm) into cell ${cell.gridRef} with "${bestHost.spec.name}" (${bestHost.actualArea.toFixed(1)} sqm remaining)`);
  return true;
}

// ============================================================
// CONTIGUITY CHECK — no disconnected building sections
// ============================================================

/**
 * Ensure all occupied cells form a single connected group.
 * If disconnected, log a warning. The building must be one shape.
 */
function ensureContiguousLayout(
  grid: StructuralGrid,
  assignedRooms: AssignedRoom[],
  corridorCells: GridCell[],
): void {
  // Collect all occupied cell keys
  const occupiedKeys = new Set<string>();
  for (const ar of assignedRooms) {
    for (const c of ar.cells) occupiedKeys.add(`${c.col},${c.row}`);
  }
  for (const c of corridorCells) {
    occupiedKeys.add(`${c.col},${c.row}`);
  }

  if (occupiedKeys.size === 0) return;

  // BFS from first occupied cell
  const firstKey = occupiedKeys.values().next().value as string;
  const visited = new Set<string>();
  const queue = [firstKey];
  visited.add(firstKey);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const [col, row] = current.split(',').map(Number);
    for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const key = `${col+dc},${row+dr}`;
      if (occupiedKeys.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(key);
      }
    }
  }

  const disconnected = occupiedKeys.size - visited.size;
  if (disconnected > 0) {
    console.warn(`[GRID-ASSIGN] DISCONNECTED LAYOUT: ${disconnected} cells not connected to main group — building would have gaps`);
  }
}

// ============================================================
// PLACEMENT HELPERS
// ============================================================

function pickBestPlacement(
  placements: GridCell[][],
  spec: RoomSpec,
  classifiedType: string,
  grid: StructuralGrid,
  zoneMap: Map<string, ZoneType>,
  assignedRooms: AssignedRoom[],
  plumbingCore: GridCell | null,
): GridCell[] {
  let bestPlacement = placements[0];
  let bestScore = -Infinity;

  for (const placement of placements) {
    const score = scorePlacement(placement, spec, classifiedType, grid, zoneMap, assignedRooms, plumbingCore);
    if (score > bestScore) {
      bestScore = score;
      bestPlacement = placement;
    }
  }

  return bestPlacement;
}

function markAssigned(
  cells: GridCell[],
  roomId: string,
  spec: RoomSpec,
  classifiedType: string,
  availableCells: Set<string>,
  assignments: Map<string, GridCell[]>,
  assignedRooms: AssignedRoom[],
): void {
  for (const c of cells) {
    availableCells.delete(`${c.col},${c.row}`);
  }
  assignments.set(roomId, cells);

  const bounds = cellGroupBounds(cells);
  assignedRooms.push({
    id: roomId,
    spec,
    classifiedType,
    cells,
    bounds,
    actualArea: cellGroupArea(cells),
  });
}

function cellGroupBounds(cells: GridCell[]): { x: number; y: number; width: number; depth: number } {
  if (cells.length === 0) return { x: 0, y: 0, width: 0, depth: 0 };
  const minX = Math.min(...cells.map(c => c.x));
  const maxX = Math.max(...cells.map(c => c.x + c.width));
  const minY = Math.min(...cells.map(c => c.y));
  const maxY = Math.max(...cells.map(c => c.y + c.depth));
  return { x: minX, y: minY, width: maxX - minX, depth: maxY - minY };
}

/** Room types that function as circulation (doors can open onto them). */
const CIRCULATION_TYPES = new Set([
  'corridor', 'hallway', 'passage', 'foyer', 'entrance_lobby', 'lobby',
]);

/**
 * Validate that all rooms can be reached from the entrance via corridor.
 * Named corridor/hallway/foyer rooms count as circulation paths — not just
 * the leftover `corridorCells`.
 */
function validateCorridorConnectivity(
  grid: StructuralGrid,
  assignedRooms: AssignedRoom[],
  corridorCells: GridCell[],
): void {
  if (assignedRooms.length === 0) return;

  // Collect all cells that serve as circulation:
  //  - explicit corridorCells (unassigned leftover)
  //  - cells of named corridor / hallway / foyer rooms
  const circulationCellKeys = new Set(corridorCells.map(c => `${c.col},${c.row}`));
  const circulationRoomIds = new Set<string>();
  for (const ar of assignedRooms) {
    if (CIRCULATION_TYPES.has(ar.classifiedType)) {
      circulationRoomIds.add(ar.id);
      for (const c of ar.cells) {
        circulationCellKeys.add(`${c.col},${c.row}`);
      }
    }
  }

  // Seed: rooms that touch any circulation cell
  const roomsTouchingCirculation = new Set<string>();
  for (const ar of assignedRooms) {
    if (circulationRoomIds.has(ar.id)) {
      // Circulation rooms are always reachable from themselves
      roomsTouchingCirculation.add(ar.id);
      continue;
    }
    for (const cell of ar.cells) {
      const adj = getAdjacentCells(grid, cell.col, cell.row);
      if (adj.some(a => circulationCellKeys.has(`${a.col},${a.row}`))) {
        roomsTouchingCirculation.add(ar.id);
        break;
      }
    }
  }

  // BFS: rooms touching a reachable room are also reachable (door chain)
  const reachable = new Set(roomsTouchingCirculation);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ar of assignedRooms) {
      if (reachable.has(ar.id)) continue;
      for (const cell of ar.cells) {
        const adj = getAdjacentCells(grid, cell.col, cell.row);
        for (const ac of adj) {
          const adjacentRoom = assignedRooms.find(
            other => other.id !== ar.id && other.cells.some(c => c.col === ac.col && c.row === ac.row)
          );
          if (adjacentRoom && reachable.has(adjacentRoom.id)) {
            reachable.add(ar.id);
            changed = true;
            break;
          }
        }
        if (reachable.has(ar.id)) break;
      }
    }
  }

  // If no circulation cells at all (small plans), all rooms touching each other
  // are inherently connected — only warn if there are genuinely isolated rooms.
  if (circulationCellKeys.size === 0) {
    // In plans without corridors (studios, small apartments), rooms connect
    // directly via doors. Check connected components instead.
    const components = findConnectedComponents(grid, assignedRooms);
    if (components > 1) {
      console.warn(`[GRID-ASSIGN] ${components} disconnected room groups found — some rooms may be unreachable`);
    }
    return;
  }

  const unreachable = assignedRooms.filter(ar => !reachable.has(ar.id));
  if (unreachable.length > 0) {
    console.warn(
      `[GRID-ASSIGN] ${unreachable.length} rooms not corridor-connected:`,
      unreachable.map(r => r.spec.name).join(', ')
    );
  }
}

/**
 * Count connected components among assigned rooms (rooms sharing a cell edge).
 */
function findConnectedComponents(grid: StructuralGrid, assignedRooms: AssignedRoom[]): number {
  if (assignedRooms.length === 0) return 0;

  const visited = new Set<string>();
  let components = 0;

  for (const ar of assignedRooms) {
    if (visited.has(ar.id)) continue;
    components++;
    // BFS from this room
    const queue = [ar.id];
    visited.add(ar.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = assignedRooms.find(r => r.id === currentId);
      if (!current) continue;
      for (const cell of current.cells) {
        const adj = getAdjacentCells(grid, cell.col, cell.row);
        for (const ac of adj) {
          const neighbor = assignedRooms.find(
            other => other.id !== currentId && !visited.has(other.id) &&
            other.cells.some(c => c.col === ac.col && c.row === ac.row)
          );
          if (neighbor) {
            visited.add(neighbor.id);
            queue.push(neighbor.id);
          }
        }
      }
    }
  }

  return components;
}

/**
 * Assign rooms for a specific floor, with pre-locked cells for vertical alignment.
 */
export function assignRoomsToGridForFloor(
  grid: StructuralGrid,
  program: EnhancedRoomProgram,
  floorLevel: number,
  preLockedCells?: Map<string, GridCell[]>,
): RoomAssignment {
  const floorProgram: EnhancedRoomProgram = {
    ...program,
    rooms: program.rooms.filter(r => (r.floor ?? 0) === floorLevel),
  };
  return assignRoomsToGrid(grid, floorProgram, preLockedCells);
}
