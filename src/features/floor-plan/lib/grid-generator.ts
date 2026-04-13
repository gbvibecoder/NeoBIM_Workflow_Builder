/**
 * Structural Grid Generator
 *
 * Given a room program (total area, room count, building type), computes an
 * optimal structural column grid. This grid becomes the skeleton that all
 * rooms, walls, and openings snap to.
 *
 * The grid ensures:
 *  - Columns at every intersection (structurally sound)
 *  - Bay sizes within IS:456 slab span limits
 *  - Rooms fit as integer multiples of bays (no gaps, no overlaps)
 *  - Multi-floor alignment automatic (same grid on every floor)
 *
 * Standards: IS:456 (concrete), IS:1905 (masonry), NBC 2016 Part 6.
 *
 * Pure function — no side effects, no API calls.
 */

import type { EnhancedRoomProgram } from '@/features/floor-plan/lib/ai-room-programmer';
import { getRoomRule } from '@/features/floor-plan/lib/architectural-rules';

// ============================================================
// TYPES
// ============================================================

export interface GridColumn {
  /** X coordinate in meters from building left edge */
  x: number;
  /** Y coordinate in meters from building top edge */
  y: number;
  /** Grid reference label (e.g., "A1", "B3") */
  gridRef: string;
}

export interface GridCell {
  /** Column index (0-based, left to right) */
  col: number;
  /** Row index (0-based, top to bottom) */
  row: number;
  /** Grid reference label (e.g., "A1") */
  gridRef: string;
  /** X position of cell left edge (meters) */
  x: number;
  /** Y position of cell top edge (meters) */
  y: number;
  /** Cell width (meters) */
  width: number;
  /** Cell depth (meters) */
  depth: number;
  /** Whether this cell is on the building perimeter */
  isPerimeter: boolean;
  /** Which edges are on the exterior (for wall generation) */
  exteriorEdges: Array<'top' | 'bottom' | 'left' | 'right'>;
}

export interface StructuralGrid {
  /** Bay widths along X axis (left to right), in meters */
  bayWidths: number[];
  /** Bay depths along Y axis (top to bottom), in meters */
  bayDepths: number[];
  /** Column positions at every grid intersection */
  columns: GridColumn[];
  /** All grid cells */
  cells: GridCell[];
  /** Total building width (meters) */
  totalWidth: number;
  /** Total building depth (meters) */
  totalDepth: number;
  /** Number of cell columns */
  gridCols: number;
  /** Number of cell rows */
  gridRows: number;
}

// ============================================================
// CONSTANTS
// ============================================================

/** Standard structural bay dimensions (meters) — IS:456 compliant */
const RESIDENTIAL_BAYS = [3.0, 3.3, 3.6, 4.0, 4.2, 4.5, 4.8];
const COMMERCIAL_BAYS = [4.2, 4.8, 5.4, 6.0, 7.2, 8.4, 9.0];

/** Corridor bay widths — narrower bays for passages */
const CORRIDOR_BAY_WIDTHS = [1.2, 1.5, 1.8];

/** Maximum unsupported slab span — IS:456 */
const MAX_SPAN_RESIDENTIAL = 5.0; // meters
const MAX_SPAN_COMMERCIAL = 6.0;

/** Grid snapping resolution */
const GRID_SNAP = 0.1; // 100mm

/** Circulation overhead factors */
const CIRCULATION_FACTOR_RESIDENTIAL = 1.15;
const CIRCULATION_FACTOR_COMMERCIAL = 1.25;

/** Preferred footprint aspect ratio range */
const MIN_ASPECT = 1.0;
const MAX_ASPECT_RESIDENTIAL = 1.6;
const MAX_ASPECT_COMMERCIAL = 2.0;

// ============================================================
// HELPERS
// ============================================================

function snap(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

/** Generate column label: A, B, C, ... Z, AA, AB ... */
function colLabel(index: number): string {
  let label = '';
  let i = index;
  do {
    label = String.fromCharCode(65 + (i % 26)) + label;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return label;
}

function isCommercial(buildingType: string): boolean {
  const t = buildingType.toLowerCase();
  return /office|commercial|retail|showroom|hospital|school|college|hotel|institutional/i.test(t);
}

// ============================================================
// GRID SCORING
// ============================================================

interface GridCandidate {
  bayWidths: number[];
  bayDepths: number[];
  score: number;
}

/**
 * Score a candidate grid configuration.
 * Higher is better.
 */
function scoreGrid(
  bayWidths: number[],
  bayDepths: number[],
  targetWidth: number,
  targetDepth: number,
  targetArea: number,
  roomCount: number,
  minCellCount: number = 4,
): number {
  const totalW = bayWidths.reduce((s, b) => s + b, 0);
  const totalD = bayDepths.reduce((s, b) => s + b, 0);
  const totalArea = totalW * totalD;
  const cellCount = bayWidths.length * bayDepths.length;

  let score = 0;

  // 0. HARD PENALTY: grid has fewer cells than minimum needed for room count
  if (cellCount < minCellCount) {
    score -= (minCellCount - cellCount) * 15;
  }

  // 1. Area efficiency: total grid area close to required (waste < 10% ideal)
  const waste = Math.abs(totalArea - targetArea) / targetArea;
  if (waste <= 0.10) score += 30;
  else if (waste <= 0.20) score += 20;
  else if (waste <= 0.30) score += 10;
  else score -= waste * 20;

  // 2. Aspect ratio: prefer footprint close to target
  const aspect = totalW / totalD;
  if (aspect >= MIN_ASPECT && aspect <= 1.8) score += 15;
  else if (aspect >= 0.8 && aspect <= 2.2) score += 8;
  else score -= 5;

  // 3. Cell count matches room count well (cells should be >= rooms, but not >> rooms)
  const cellRatio = cellCount / Math.max(roomCount, 1);
  if (cellRatio >= 1.0 && cellRatio <= 1.5) score += 20;
  else if (cellRatio >= 0.8 && cellRatio <= 2.0) score += 10;
  else if (cellRatio < 0.8) score -= 15; // too few cells
  else score -= 5;

  // 4. Prefer fewer bay sizes (uniform grid is structurally simpler)
  const uniqueWidths = new Set(bayWidths).size;
  const uniqueDepths = new Set(bayDepths).size;
  score += Math.max(0, 10 - (uniqueWidths - 1) * 3);
  score += Math.max(0, 10 - (uniqueDepths - 1) * 3);

  // 5. Grid columns and rows in sweet spot (3-8 per axis)
  const cols = bayWidths.length;
  const rows = bayDepths.length;
  if (cols >= 3 && cols <= 8) score += 10;
  if (rows >= 2 && rows <= 6) score += 10;

  // 6. Dimension proximity to targets
  const wProx = 1 - Math.abs(totalW - targetWidth) / Math.max(targetWidth, 1);
  const dProx = 1 - Math.abs(totalD - targetDepth) / Math.max(targetDepth, 1);
  score += Math.max(0, wProx * 10);
  score += Math.max(0, dProx * 10);

  return score;
}

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Generate a structural column grid from a room program.
 *
 * @param program - Room program from ai-room-programmer
 * @param plotConstraints - Optional plot dimensions (meters) + setbacks
 * @returns Optimized structural grid
 */
export function generateStructuralGrid(
  program: EnhancedRoomProgram,
  plotConstraints?: {
    plotWidth?: number;
    plotDepth?: number;
    frontSetback?: number;
    rearSetback?: number;
    sideSetbackLeft?: number;
    sideSetbackRight?: number;
  },
): StructuralGrid {
  const commercial = isCommercial(program.buildingType);
  const maxSpan = commercial ? MAX_SPAN_COMMERCIAL : MAX_SPAN_RESIDENTIAL;
  const circulationFactor = commercial ? CIRCULATION_FACTOR_COMMERCIAL : CIRCULATION_FACTOR_RESIDENTIAL;
  const bayOptions = commercial ? COMMERCIAL_BAYS : RESIDENTIAL_BAYS;
  const maxAspect = commercial ? MAX_ASPECT_COMMERCIAL : MAX_ASPECT_RESIDENTIAL;

  // Step 1: Determine target footprint
  // Use actual room area sum as the source of truth — NOT totalAreaSqm which
  // may have been inflated by retries or circulation factors.
  const roomAreaTotal = program.rooms
    .filter(r => (r.floor ?? 0) === 0)
    .reduce((s, r) => s + r.areaSqm, 0);
  // Don't multiply by circulation factor — corridor is already a room in the program.
  // Only add a small wall-thickness overhead (~5%).
  const floorArea = roomAreaTotal * 1.05;

  // Cap footprint for building types — prevents oversized grids
  const bt = program.buildingType.toLowerCase();
  let maxFootprint = 300;
  if (/apartment|flat/.test(bt)) maxFootprint = 150;
  else if (/studio/.test(bt)) maxFootprint = 55;
  else if (/villa/.test(bt)) maxFootprint = 400;
  else if (/office|commercial/.test(bt)) maxFootprint = 600;
  const cappedArea = Math.min(floorArea, maxFootprint);

  let targetWidth: number;
  let targetDepth: number;

  if (plotConstraints?.plotWidth && plotConstraints?.plotDepth) {
    const front = plotConstraints.frontSetback ?? 0;
    const rear = plotConstraints.rearSetback ?? 0;
    const left = plotConstraints.sideSetbackLeft ?? 0;
    const right = plotConstraints.sideSetbackRight ?? 0;
    targetWidth = plotConstraints.plotWidth - left - right;
    targetDepth = plotConstraints.plotDepth - front - rear;
  } else {
    const aspect = Math.min(1.4, maxAspect);
    targetWidth = snap(Math.sqrt(cappedArea * aspect));
    targetDepth = snap(cappedArea / targetWidth);
  }

  // Ensure reasonable minimum dimensions
  targetWidth = Math.max(targetWidth, 6.0);
  targetDepth = Math.max(targetDepth, 5.0);

  // Step 2: Generate candidate grids
  const roomCount = program.rooms.filter(r => (r.floor ?? 0) === 0).length;

  // Minimum cell count: each room needs ≥1 cell. With non-uniform bay
  // optimization, cells get right-sized so we don't need 2 cells for large
  // rooms. Just ensure 1 cell per room + a small margin.
  const minCells = Math.max(4, roomCount + 1);

  // If the target footprint can't provide enough cells with the largest bay,
  // expand the footprint. E.g., 10 rooms → 13 cells → at least 4×4 or 5×3.
  const smallestBay = bayOptions[0]; // e.g., 3.0m for residential
  const minColsForCells = Math.ceil(Math.sqrt(minCells * (targetWidth / Math.max(targetDepth, 1))));
  const minRowsForCells = Math.ceil(minCells / minColsForCells);
  const neededWidth = minColsForCells * smallestBay;
  const neededDepth = minRowsForCells * smallestBay;
  if (neededWidth > targetWidth) targetWidth = snap(neededWidth);
  if (neededDepth > targetDepth) targetDepth = snap(neededDepth);

  // For 8+ rooms, prefer smaller bays to get more cells
  const highRoomCount = roomCount > 8;

  const candidates: GridCandidate[] = [];

  // Try uniform grids with each bay size
  for (const bay of bayOptions) {
    if (bay > maxSpan) continue;

    // Uniform grid: same bay size on both axes
    const cols = Math.max(2, Math.round(targetWidth / bay));
    const rows = Math.max(2, Math.round(targetDepth / bay));

    const bayWidths = Array<number>(cols).fill(bay);
    const bayDepths = Array<number>(rows).fill(bay);

    const score = scoreGrid(bayWidths, bayDepths, targetWidth, targetDepth, floorArea, roomCount, minCells);
    candidates.push({ bayWidths, bayDepths, score });

    // Try with corridor bay inserted in the middle
    if (cols >= 3) {
      for (const corrBay of CORRIDOR_BAY_WIDTHS) {
        const midCol = Math.floor(cols / 2);
        const bw = [...bayWidths];
        bw.splice(midCol, 0, corrBay);
        const s = scoreGrid(bw, bayDepths, targetWidth, targetDepth, floorArea, roomCount, minCells);
        candidates.push({ bayWidths: bw, bayDepths, score: s });
      }
    }

    // Try asymmetric: different bay on depth axis
    for (const bayD of bayOptions) {
      if (bayD > maxSpan || bayD === bay) continue;
      const rowsD = Math.max(2, Math.round(targetDepth / bayD));
      const bdp = Array<number>(rowsD).fill(bayD);
      const s = scoreGrid(bayWidths, bdp, targetWidth, targetDepth, floorArea, roomCount, minCells);
      candidates.push({ bayWidths, bayDepths: bdp, score: s });
    }
  }

  // For high room counts, also try finer grids with smaller bays
  if (highRoomCount) {
    const smallBays = commercial ? [4.2, 4.8] : [3.0, 3.3, 3.6];
    for (const bay of smallBays) {
      // Force higher column/row counts to meet minCells
      for (let extraCols = 0; extraCols <= 3; extraCols++) {
        for (let extraRows = 0; extraRows <= 2; extraRows++) {
          const cols2 = Math.max(3, Math.round(targetWidth / bay) + extraCols);
          const rows2 = Math.max(3, Math.round(targetDepth / bay) + extraRows);
          if (cols2 * rows2 < minCells) continue;
          if (cols2 > 10 || rows2 > 8) continue; // sanity limit
          const bw2 = Array<number>(cols2).fill(bay);
          const bd2 = Array<number>(rows2).fill(bay);
          const s = scoreGrid(bw2, bd2, targetWidth, targetDepth, floorArea, roomCount, minCells);
          candidates.push({ bayWidths: bw2, bayDepths: bd2, score: s });
        }
      }
    }
  }

  // Try mixed-width grids (one axis has 2 different bay sizes)
  for (let i = 0; i < bayOptions.length; i++) {
    for (let j = i + 1; j < bayOptions.length; j++) {
      const a = bayOptions[i];
      const b = bayOptions[j];
      if (a > maxSpan || b > maxSpan) continue;

      // 2 bays of `a` + 1 bay of `b` etc.
      const colsA = Math.round(targetWidth / a) - 1;
      if (colsA < 1) continue;
      const remainingW = targetWidth - colsA * a;
      const colsB = Math.max(1, Math.round(remainingW / b));
      const bw = [...Array<number>(colsA).fill(a), ...Array<number>(colsB).fill(b)];

      const rowsA = Math.max(2, Math.round(targetDepth / a));
      const bd = Array<number>(rowsA).fill(a);

      const s = scoreGrid(bw, bd, targetWidth, targetDepth, floorArea, roomCount, minCells);
      candidates.push({ bayWidths: bw, bayDepths: bd, score: s });
    }
  }

  // Sort by score (descending) and pick the best
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    // Fallback: simple uniform grid
    const fallbackBay = commercial ? 4.8 : 3.6;
    const cols = Math.max(2, Math.round(targetWidth / fallbackBay));
    const rows = Math.max(2, Math.round(targetDepth / fallbackBay));
    return buildGrid(
      Array<number>(cols).fill(fallbackBay),
      Array<number>(rows).fill(fallbackBay),
    );
  }

  return buildGrid(best.bayWidths, best.bayDepths);
}

// ============================================================
// GRID CONSTRUCTION
// ============================================================

/**
 * Build the full StructuralGrid from bay dimensions.
 */
function buildGrid(bayWidths: number[], bayDepths: number[]): StructuralGrid {
  const gridCols = bayWidths.length;
  const gridRows = bayDepths.length;
  const totalWidth = snap(bayWidths.reduce((s, b) => s + b, 0));
  const totalDepth = snap(bayDepths.reduce((s, b) => s + b, 0));

  // Generate column positions (at every grid intersection)
  const columns: GridColumn[] = [];
  const xPositions: number[] = [0];
  for (let i = 0; i < bayWidths.length; i++) {
    xPositions.push(snap(xPositions[i] + bayWidths[i]));
  }
  const yPositions: number[] = [0];
  for (let i = 0; i < bayDepths.length; i++) {
    yPositions.push(snap(yPositions[i] + bayDepths[i]));
  }

  // Columns at every x/y intersection
  for (let xi = 0; xi <= gridCols; xi++) {
    for (let yi = 0; yi <= gridRows; yi++) {
      columns.push({
        x: xPositions[xi],
        y: yPositions[yi],
        gridRef: `${colLabel(xi)}${yi + 1}`,
      });
    }
  }

  // Generate cells
  const cells: GridCell[] = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const x = xPositions[col];
      const y = yPositions[row];
      const width = bayWidths[col];
      const depth = bayDepths[row];

      const exteriorEdges: Array<'top' | 'bottom' | 'left' | 'right'> = [];
      if (row === 0) exteriorEdges.push('top');
      if (row === gridRows - 1) exteriorEdges.push('bottom');
      if (col === 0) exteriorEdges.push('left');
      if (col === gridCols - 1) exteriorEdges.push('right');

      cells.push({
        col,
        row,
        gridRef: `${colLabel(col)}${row + 1}`,
        x,
        y,
        width,
        depth,
        isPerimeter: exteriorEdges.length > 0,
        exteriorEdges,
      });
    }
  }

  return {
    bayWidths,
    bayDepths,
    columns,
    cells,
    totalWidth,
    totalDepth,
    gridCols,
    gridRows,
  };
}

/**
 * Get a cell at a specific grid position.
 */
export function getCell(grid: StructuralGrid, col: number, row: number): GridCell | undefined {
  return grid.cells.find(c => c.col === col && c.row === row);
}

/**
 * Get all cells adjacent to a given cell (4-connected: up, down, left, right).
 */
export function getAdjacentCells(grid: StructuralGrid, col: number, row: number): GridCell[] {
  const neighbors: GridCell[] = [];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dc, dr] of directions) {
    const cell = getCell(grid, col + dc, row + dr);
    if (cell) neighbors.push(cell);
  }
  return neighbors;
}

/**
 * Get all perimeter cells (those with at least one exterior edge).
 */
export function getPerimeterCells(grid: StructuralGrid): GridCell[] {
  return grid.cells.filter(c => c.isPerimeter);
}

/**
 * Calculate the total area of a set of cells.
 */
export function cellGroupArea(cells: GridCell[]): number {
  return cells.reduce((s, c) => s + c.width * c.depth, 0);
}

/**
 * Check if a set of cells forms a contiguous group (4-connected).
 */
export function areCellsContiguous(cells: GridCell[]): boolean {
  if (cells.length <= 1) return true;

  const cellSet = new Set(cells.map(c => `${c.col},${c.row}`));
  const visited = new Set<string>();
  const queue = [`${cells[0].col},${cells[0].row}`];
  visited.add(queue[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const [col, row] = current.split(',').map(Number);
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dc, dr] of directions) {
      const key = `${col + dc},${row + dr}`;
      if (cellSet.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(key);
      }
    }
  }

  return visited.size === cells.length;
}

/**
 * Get the bounding box aspect ratio of a cell group.
 */
export function cellGroupAspectRatio(cells: GridCell[]): number {
  if (cells.length === 0) return 1;
  const minX = Math.min(...cells.map(c => c.x));
  const maxX = Math.max(...cells.map(c => c.x + c.width));
  const minY = Math.min(...cells.map(c => c.y));
  const maxY = Math.max(...cells.map(c => c.y + c.depth));
  const w = maxX - minX;
  const d = maxY - minY;
  if (w <= 0 || d <= 0) return 1;
  return Math.max(w, d) / Math.min(w, d);
}

// ============================================================
// BAY DIMENSION OPTIMIZATION — non-uniform grid
// ============================================================

import type { RoomAssignment, AssignedRoom } from '@/features/floor-plan/lib/grid-room-assigner';
import { classifyRoom } from '@/features/floor-plan/lib/room-sizer';

/** Circulation room types that should use narrow bays */
const NARROW_TYPES = new Set([
  'corridor', 'hallway', 'passage', 'foyer', 'entrance_lobby',
  'shoe_rack', 'mud_room',
]);

/** Small room types that need less width/depth */
const SMALL_TYPES = new Set([
  'bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath',
  'servant_toilet', 'utility', 'laundry', 'store_room', 'pooja_room',
  'walk_in_closet', 'shoe_rack',
]);

/**
 * Optimize bay dimensions after room assignment.
 *
 * Takes a uniform grid + assignment and resizes each column/row to fit
 * the rooms it contains. Bathrooms get narrow bays, bedrooms get wider
 * bays, corridors get thin strips.
 *
 * Returns a new StructuralGrid with non-uniform bays and updated cell positions.
 * Also updates the assignment's room bounds to match the new cell sizes.
 */
export function optimizeBayDimensions(
  grid: StructuralGrid,
  assignment: RoomAssignment,
): StructuralGrid {
  const isComm = grid.bayWidths.some(b => b > 5.0);
  const maxBay = isComm ? 6.0 : 5.0;
  const minBay = 1.2; // absolute minimum for a corridor/toilet

  // Build a lookup: which rooms are in each column and row
  const roomsByCol: Map<number, AssignedRoom[]> = new Map();
  const roomsByRow: Map<number, AssignedRoom[]> = new Map();

  for (let c = 0; c < grid.gridCols; c++) roomsByCol.set(c, []);
  for (let r = 0; r < grid.gridRows; r++) roomsByRow.set(r, []);

  for (const ar of assignment.roomOrder) {
    for (const cell of ar.cells) {
      roomsByCol.get(cell.col)?.push(ar);
      roomsByRow.get(cell.row)?.push(ar);
    }
  }
  // Corridor cells
  for (const cell of assignment.corridorCells) {
    // Create a pseudo-room for corridor
    roomsByCol.get(cell.col); // just ensure it's counted
    roomsByRow.get(cell.row);
  }

  // ── Compute optimal column widths ──
  const newBayWidths: number[] = [];
  for (let col = 0; col < grid.gridCols; col++) {
    const rooms = dedupRooms(roomsByCol.get(col) ?? []);
    const colWidth = computeOptimalDimension(rooms, 'width', minBay, maxBay, grid.bayWidths[col], assignment, col, 'col');
    newBayWidths.push(snap(colWidth));
  }

  // ── Compute optimal row depths ──
  const newBayDepths: number[] = [];
  for (let row = 0; row < grid.gridRows; row++) {
    const rooms = dedupRooms(roomsByRow.get(row) ?? []);
    const rowDepth = computeOptimalDimension(rooms, 'depth', minBay, maxBay, grid.bayDepths[row], assignment, row, 'row');
    newBayDepths.push(snap(rowDepth));
  }

  // ── Rebuild the grid with new bay dimensions ──
  const newGrid = buildGrid(newBayWidths, newBayDepths);

  // ── Update assignment room bounds to match new cell sizes ──
  for (const ar of assignment.roomOrder) {
    if (ar.cells.length === 0) continue;
    // Find corresponding cells in the new grid
    const newCells = ar.cells.map(c => {
      const nc = newGrid.cells.find(nc2 => nc2.col === c.col && nc2.row === c.row);
      return nc ?? c;
    });
    // Update cells reference
    ar.cells = newCells;
    // Recompute bounds from new cells
    const minX = Math.min(...newCells.map(c => c.x));
    const maxX = Math.max(...newCells.map(c => c.x + c.width));
    const minY = Math.min(...newCells.map(c => c.y));
    const maxY = Math.max(...newCells.map(c => c.y + c.depth));
    ar.bounds = { x: minX, y: minY, width: maxX - minX, depth: maxY - minY };
    ar.actualArea = ar.bounds.width * ar.bounds.depth;
  }

  // Update corridor cells
  for (let i = 0; i < assignment.corridorCells.length; i++) {
    const old = assignment.corridorCells[i];
    const nc = newGrid.cells.find(c => c.col === old.col && c.row === old.row);
    if (nc) assignment.corridorCells[i] = nc;
  }

  return newGrid;
}

/** Deduplicate rooms (a room spanning 2 cells appears twice) */
function dedupRooms(rooms: AssignedRoom[]): AssignedRoom[] {
  const seen = new Set<string>();
  return rooms.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/**
 * Compute the optimal dimension (width or depth) for a column or row.
 *
 * Strategy: use the LARGEST room's architectural minimum as the base,
 * but clamp narrow types to their minimum and don't exceed maxBay.
 */
function computeOptimalDimension(
  rooms: AssignedRoom[],
  axis: 'width' | 'depth',
  minBay: number,
  maxBay: number,
  currentBay: number,
  assignment: RoomAssignment,
  index: number,
  indexType: 'col' | 'row',
): number {
  if (rooms.length === 0) {
    // Column/row with only corridor cells → use corridor width
    const hasCorridor = assignment.corridorCells.some(c =>
      indexType === 'col' ? c.col === index : c.row === index
    );
    return hasCorridor ? Math.max(minBay, 1.5) : currentBay;
  }

  // Check if ALL rooms in this column/row are narrow types
  const allNarrow = rooms.every(r => NARROW_TYPES.has(r.classifiedType));
  if (allNarrow) {
    // Corridor/passage column → 1.2-1.8m
    return Math.max(minBay, 1.5);
  }

  // Check if ALL rooms are small types (bathroom, utility, etc.)
  const allSmall = rooms.every(r => SMALL_TYPES.has(r.classifiedType));

  // Get the architectural minimums for all rooms
  const mins = rooms.map(r => {
    const rule = getRoomRule(r.classifiedType);
    return axis === 'width' ? rule.width.min : rule.depth.min;
  });

  // Compute ideal dimension per room: use area / other_dimension
  // This is more accurate than sqrt(area) because it accounts for
  // the actual other dimension of the room's cell.
  const targets = rooms.map(r => {
    const rule = getRoomRule(r.classifiedType);
    const minDim = axis === 'width' ? rule.width.min : rule.depth.min;
    // For single-cell rooms, ideal dim = area / (bay in the other axis)
    // Fall back to sqrt-based estimate if we don't know the other axis yet
    const idealFromArea = Math.sqrt(r.spec.areaSqm);
    return Math.min(maxBay, Math.max(minDim, idealFromArea));
  });

  if (allSmall) {
    // Small rooms: use their minimum + small margin, don't over-allocate
    const smallDim = Math.max(...mins) * 1.15;
    return Math.max(minBay, Math.min(smallDim, maxBay));
  }

  // For mixed columns (bedroom + bathroom), use the DOMINANT room's need
  // The dominant room is the one with the largest area request
  const dominantRoom = rooms.reduce((best, r) => r.spec.areaSqm > best.spec.areaSqm ? r : best);
  const dominantRule = getRoomRule(dominantRoom.classifiedType);
  const dominantMin = axis === 'width' ? dominantRule.width.min : dominantRule.depth.min;
  const dominantTarget = Math.max(dominantMin, Math.sqrt(dominantRoom.spec.areaSqm));

  // Multi-cell rooms: each column gets a fair share
  for (const r of rooms) {
    const cellsInThisAxis = indexType === 'col'
      ? new Set(r.cells.map(c => c.col)).size
      : new Set(r.cells.map(c => c.row)).size;
    if (cellsInThisAxis > 1) {
      const rule = getRoomRule(r.classifiedType);
      const totalNeeded = axis === 'width' ? rule.width.min : rule.depth.min;
      return Math.max(dominantTarget, totalNeeded / cellsInThisAxis, minBay);
    }
  }

  return Math.max(minBay, Math.min(dominantTarget, maxBay));
}
