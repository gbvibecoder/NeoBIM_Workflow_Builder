/**
 * Snap-to-Grid — BSP → Structural Grid adapter
 *
 * Given BSP-produced room rectangles, compute a structural grid whose lines
 * align with room boundaries. This gives us:
 *   - BSP's natural room proportions (varied sizes, good flow)
 *   - Grid's perfect wall generation (no gaps, no floating segments)
 *
 * The grid is derived FROM the rooms (rooms → grid), not the other way around
 * (grid → rooms). Every room edge becomes a grid line.
 */

import type { StructuralGrid, GridCell, GridColumn } from '@/features/floor-plan/lib/grid-generator';
import type { RoomAssignment, AssignedRoom } from '@/features/floor-plan/lib/grid-room-assigner';
import { classifyRoom } from '@/features/floor-plan/lib/room-sizer';

/**
 * Minimal room shape accepted by snap-to-grid.
 *
 * Compatible with both layout-engine PlacedRoom (has `area`) and
 * optimizer PlacedRoom (has `targetArea`). When `area` is missing
 * it is computed as width × depth.
 */
export interface SnapRoom {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  area?: number;
}

// ============================================================
// MAIN FUNCTION
// ============================================================

/**
 * Compute a structural grid that fits BSP-placed rooms.
 *
 * Grid lines are placed at room edges so walls naturally fall on grid lines.
 * Rooms map 1:1 to grid cell regions (a room may span multiple cells if its
 * edges create sub-divisions).
 */
export function computeGridFromRooms(
  rooms: SnapRoom[],
  buildingWidth: number,
  buildingDepth: number,
): StructuralGrid {
  // 1. Collect all unique X and Y edge coordinates from room boundaries
  const xEdgesRaw = new Set<number>();
  const yEdgesRaw = new Set<number>();
  xEdgesRaw.add(0);
  xEdgesRaw.add(round(buildingWidth));
  yEdgesRaw.add(0);
  yEdgesRaw.add(round(buildingDepth));

  for (const room of rooms) {
    xEdgesRaw.add(round(room.x));
    xEdgesRaw.add(round(room.x + room.width));
    yEdgesRaw.add(round(room.y));
    yEdgesRaw.add(round(room.y + room.depth));
  }

  // 2. Merge edges that are very close (< 200mm = wall thickness tolerance)
  // Two room edges 50mm apart are really the same wall line.
  const xEdges = mergeCloseEdges([...xEdgesRaw].sort((a, b) => a - b), 0.2);
  const yEdges = mergeCloseEdges([...yEdgesRaw].sort((a, b) => a - b), 0.2);

  // 3. Compute bay dimensions from consecutive edges
  const bayWidths: number[] = [];
  for (let i = 1; i < xEdges.length; i++) {
    bayWidths.push(round(xEdges[i] - xEdges[i - 1]));
  }
  const bayDepths: number[] = [];
  for (let i = 1; i < yEdges.length; i++) {
    bayDepths.push(round(yEdges[i] - yEdges[i - 1]));
  }

  // 4. Build grid structure
  const gridCols = bayWidths.length;
  const gridRows = bayDepths.length;
  const totalWidth = round(xEdges[xEdges.length - 1]);
  const totalDepth = round(yEdges[yEdges.length - 1]);

  // Columns at every intersection
  const columns: GridColumn[] = [];
  for (let xi = 0; xi <= gridCols; xi++) {
    for (let yi = 0; yi <= gridRows; yi++) {
      columns.push({
        x: xEdges[xi],
        y: yEdges[yi],
        gridRef: `${colLabel(xi)}${yi + 1}`,
      });
    }
  }

  // Cells
  const cells: GridCell[] = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const exteriorEdges: Array<'top' | 'bottom' | 'left' | 'right'> = [];
      if (row === 0) exteriorEdges.push('top');
      if (row === gridRows - 1) exteriorEdges.push('bottom');
      if (col === 0) exteriorEdges.push('left');
      if (col === gridCols - 1) exteriorEdges.push('right');

      cells.push({
        col,
        row,
        gridRef: `${colLabel(col)}${row + 1}`,
        x: xEdges[col],
        y: yEdges[row],
        width: bayWidths[col],
        depth: bayDepths[row],
        isPerimeter: exteriorEdges.length > 0,
        exteriorEdges,
      });
    }
  }

  return { bayWidths, bayDepths, columns, cells, totalWidth, totalDepth, gridCols, gridRows };
}

/**
 * Map BSP-placed rooms to grid cells.
 *
 * Each room covers one or more grid cells (since grid lines are at room edges,
 * most rooms map to exactly their cell region). Returns a RoomAssignment
 * compatible with the existing wall generator and pipeline adapter.
 */
export function mapBSPRoomsToGridCells(
  grid: StructuralGrid,
  rooms: SnapRoom[],
): RoomAssignment {
  const assignments = new Map<string, GridCell[]>();
  const assignedRooms: AssignedRoom[] = [];
  const assignedCellKeys = new Set<string>();

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const roomId = `room-${i}`;
    const classifiedType = classifyRoom(room.type, room.name);

    // Find all grid cells that this room overlaps (> 50% overlap)
    const roomCells: GridCell[] = [];
    for (const cell of grid.cells) {
      const overlapX = Math.min(room.x + room.width, cell.x + cell.width) - Math.max(room.x, cell.x);
      const overlapY = Math.min(room.y + room.depth, cell.y + cell.depth) - Math.max(room.y, cell.y);
      if (overlapX > 0.05 && overlapY > 0.05) {
        const overlapArea = overlapX * overlapY;
        const cellArea = cell.width * cell.depth;
        // Cell belongs to this room if ≥ 40% of the cell is inside the room
        if (overlapArea / cellArea >= 0.4) {
          const key = `${cell.col},${cell.row}`;
          if (!assignedCellKeys.has(key)) {
            roomCells.push(cell);
            assignedCellKeys.add(key);
          }
        }
      }
    }

    if (roomCells.length === 0) continue; // Room didn't map to any cell

    assignments.set(roomId, roomCells);

    // Use the room's exact bounds (not the cell bounds) for accurate sizing
    const roomArea = room.area ?? room.width * room.depth;
    assignedRooms.push({
      id: roomId,
      spec: {
        name: room.name,
        type: room.type,
        areaSqm: roomArea,
        zone: inferZone(classifiedType),
        mustHaveExteriorWall: false,
        adjacentTo: [],
        preferNear: [],
      },
      classifiedType,
      cells: roomCells,
      bounds: { x: room.x, y: room.y, width: room.width, depth: room.depth },
      actualArea: roomArea,
    });
  }

  // Unassigned cells become corridor
  const corridorCells = grid.cells.filter(c => !assignedCellKeys.has(`${c.col},${c.row}`));

  // Entrance cell: bottom-center
  const bottomCells = grid.cells.filter(c => c.row === grid.gridRows - 1);
  const entranceCell = bottomCells[Math.floor(bottomCells.length / 2)] ?? null;

  return {
    assignments,
    corridorCells,
    entranceCell,
    plumbingCore: null,
    roomOrder: assignedRooms,
    placementRatio: rooms.length > 0 ? assignedRooms.length / rooms.length : 1,
  };
}

// ============================================================
// HELPERS
// ============================================================

function round(v: number, precision: number = 0.1): number {
  return Math.round(v / precision) * precision;
}

function colLabel(index: number): string {
  let label = '';
  let i = index;
  do {
    label = String.fromCharCode(65 + (i % 26)) + label;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return label;
}

/**
 * Merge edge values that are within tolerance of each other.
 * E.g., [0, 3.48, 3.52, 7.0] with tolerance 0.2 → [0, 3.5, 7.0]
 */
function mergeCloseEdges(sorted: number[], tolerance: number): number[] {
  if (sorted.length === 0) return [];
  const merged: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - merged[merged.length - 1] > tolerance) {
      merged.push(sorted[i]);
    } else {
      // Merge to the average of the two close edges
      merged[merged.length - 1] = round((merged[merged.length - 1] + sorted[i]) / 2);
    }
  }
  return merged;
}

function inferZone(classifiedType: string): 'public' | 'private' | 'service' | 'circulation' {
  if (['living_room', 'drawing_room', 'dining_room', 'foyer', 'entrance_lobby'].includes(classifiedType)) return 'public';
  if (['bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom', 'study', 'home_office'].includes(classifiedType)) return 'private';
  if (['corridor', 'hallway', 'passage', 'staircase', 'lift'].includes(classifiedType)) return 'circulation';
  return 'service';
}
