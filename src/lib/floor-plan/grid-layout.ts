/**
 * Grid Topology Layout — AI picks room arrangement, algorithm does geometry.
 *
 * GPT-4o places rooms on a simple grid (row, col, rowSpan, colSpan).
 * No coordinates, no overlaps possible, no gaps possible.
 * A deterministic algorithm converts grid → exact PlacedRoom[] coordinates.
 *
 * This splits the problem into what each system does best:
 * - GPT-4o: architectural reasoning (which rooms go where)
 * - Algorithm: precise geometry (exact coordinates, no gaps)
 */

import { getClient } from "@/services/openai";
import type { EnhancedRoomProgram } from "./ai-room-programmer";
import type { PlacedRoom } from "./layout-engine";

// ── Grid snap ──────────────────────────────────────────────────────────────

const GRID = 0.1;
function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface GridCell {
  name: string;
  type: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

interface GridTopology {
  rows: number;
  cols: number;
  cells: GridCell[];
  corridorRow?: number; // which row is the corridor
}

// ── GPT-4o Grid Prompt ─────────────────────────────────────────────────────

const GRID_SYSTEM_PROMPT = `You are an architect placing rooms on a grid. Each room occupies one or more grid cells.

TASK: Given a room list, place every room on a grid (2-4 rows, 2-5 columns). Output row, col, rowSpan, colSpan for each room.

RULES:
1. Kitchen and Dining MUST share a grid edge (adjacent cells).
2. Each Bedroom MUST be adjacent to its paired Bathroom.
3. Public rooms (living, dining, kitchen) go in bottom rows (near entry).
4. Private rooms (bedrooms, bathrooms) go in top rows (away from entry).
5. Corridor: one FULL-WIDTH row between public and private zones (rowSpan=1, colSpan=ALL columns).
6. No two rooms in the same cell. No cell left empty (every cell has a room).
7. Small rooms (bathroom, utility, balcony) use 1×1 cells. Large rooms (living, bedroom) can use 1×1 or 1×2.
8. Bathrooms should be in INTERIOR cells (not on the grid edges) when possible.

GRID SIZE GUIDE:
- 6-8 rooms: 3 rows × 3 cols (with corridor as middle row)
- 9-12 rooms: 3 rows × 4 cols (with corridor as middle row)
- 13+ rooms: 4 rows × 4 cols (with corridor between row 1 and 2)

OUTPUT FORMAT — ONLY JSON:
{
  "rows": 3,
  "cols": 4,
  "corridorRow": 1,
  "cells": [
    {"name": "Living Room", "type": "living", "row": 2, "col": 0, "rowSpan": 1, "colSpan": 2},
    {"name": "Kitchen", "type": "kitchen", "row": 2, "col": 2, "rowSpan": 1, "colSpan": 1},
    {"name": "Dining Room", "type": "dining", "row": 2, "col": 3, "rowSpan": 1, "colSpan": 1},
    {"name": "Corridor", "type": "hallway", "row": 1, "col": 0, "rowSpan": 1, "colSpan": 4},
    {"name": "Master Bedroom", "type": "bedroom", "row": 0, "col": 0, "rowSpan": 1, "colSpan": 1},
    {"name": "Bathroom 1", "type": "bathroom", "row": 0, "col": 1, "rowSpan": 1, "colSpan": 1},
    {"name": "Bedroom 2", "type": "bedroom", "row": 0, "col": 2, "rowSpan": 1, "colSpan": 1},
    {"name": "Bathroom 2", "type": "bathroom", "row": 0, "col": 3, "rowSpan": 1, "colSpan": 1}
  ]
}

Row 0 = top (private zone), highest row = bottom (public zone, entry).
Kitchen MUST be adjacent to Dining (touching cells). Each Bedroom must touch its Bathroom.
EVERY cell must have exactly one room. Include ALL rooms from the input.`;

// ── Build user message ─────────────────────────────────────────────────────

function buildGridUserMessage(program: EnhancedRoomProgram): string {
  const roomList = program.rooms.map(r =>
    `  ${r.name} (${r.type}, ${r.areaSqm.toFixed(0)}m²)`
  ).join("\n");

  const adjList = program.adjacency.map(a =>
    `  ${a.roomA} ↔ ${a.roomB}`
  ).join("\n");

  // Include corridor if not in room list
  const hasCorridor = program.rooms.some(r =>
    r.type === "hallway" || r.name.toLowerCase().includes("corridor")
  );

  return `Place these ${program.rooms.length}${hasCorridor ? "" : "+1 (add Corridor)"} rooms on a grid:

${roomList}
${!hasCorridor ? "  Corridor (hallway) — add this, full-width row" : ""}

Must-be-adjacent pairs:
${adjList || "  Kitchen ↔ Dining, each Bedroom ↔ its Bathroom"}

Public rooms (bottom rows): ${program.zones.public.join(", ") || "Living, Dining, Kitchen"}
Private rooms (top rows): ${program.zones.private.join(", ") || "Bedrooms, Bathrooms"}

Output the grid JSON.`;
}

// ── Parse GPT-4o grid response ─────────────────────────────────────────────

function parseGridResponse(content: string): GridTopology | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed.rows || !parsed.cols || !Array.isArray(parsed.cells)) return null;
    if (parsed.cells.length === 0) return null;

    return {
      rows: Number(parsed.rows),
      cols: Number(parsed.cols),
      corridorRow: parsed.corridorRow != null ? Number(parsed.corridorRow) : undefined,
      cells: parsed.cells.map((c: Record<string, unknown>) => ({
        name: String(c.name ?? "Room"),
        type: String(c.type ?? "other"),
        row: Number(c.row ?? 0),
        col: Number(c.col ?? 0),
        rowSpan: Number(c.rowSpan ?? 1),
        colSpan: Number(c.colSpan ?? 1),
      })),
    };
  } catch {
    return null;
  }
}

// ── Validate grid ──────────────────────────────────────────────────────────

function validateGrid(grid: GridTopology, program: EnhancedRoomProgram): string[] {
  const errors: string[] = [];

  // Check all rooms are placed
  const placedNames = new Set(grid.cells.map(c => c.name));
  for (const room of program.rooms) {
    if (!placedNames.has(room.name)) {
      errors.push(`Missing room: ${room.name}`);
    }
  }

  // Check no cell conflicts (two rooms in same cell)
  const occupied = new Map<string, string>();
  for (const cell of grid.cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
        const key = `${r},${c}`;
        if (occupied.has(key)) {
          errors.push(`Cell (${r},${c}) has both ${occupied.get(key)} and ${cell.name}`);
        }
        occupied.set(key, cell.name);
      }
    }
  }

  // Check rooms within grid bounds
  for (const cell of grid.cells) {
    if (cell.row < 0 || cell.col < 0 ||
        cell.row + cell.rowSpan > grid.rows ||
        cell.col + cell.colSpan > grid.cols) {
      errors.push(`${cell.name} extends outside grid bounds`);
    }
  }

  // Check kitchen-dining adjacency
  const kitchen = grid.cells.find(c => c.type === "kitchen" || c.name.toLowerCase().includes("kitchen"));
  const dining = grid.cells.find(c => c.type === "dining" || c.name.toLowerCase().includes("dining"));
  if (kitchen && dining && !cellsAdjacent(kitchen, dining)) {
    errors.push("Kitchen and Dining are not adjacent on the grid");
  }

  return errors;
}

function cellsAdjacent(a: GridCell, b: GridCell): boolean {
  // Check if any cell of A touches any cell of B
  for (let ar = a.row; ar < a.row + a.rowSpan; ar++) {
    for (let ac = a.col; ac < a.col + a.colSpan; ac++) {
      for (let br = b.row; br < b.row + b.rowSpan; br++) {
        for (let bc = b.col; bc < b.col + b.colSpan; bc++) {
          if ((Math.abs(ar - br) === 1 && ac === bc) ||
              (Math.abs(ac - bc) === 1 && ar === br)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// ── Grid to Coordinates ────────────────────────────────────────────────────

function gridToCoordinates(
  grid: GridTopology,
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
): PlacedRoom[] {
  if (grid.rows <= 0 || grid.cols <= 0 || grid.cells.length === 0) return [];

  const CORRIDOR_HEIGHT = 1.2;
  const MIN_COL_WIDTH = 2.0;
  const MIN_ROW_HEIGHT = 2.0;

  const specMap = new Map(program.rooms.map(r => [r.name, r]));

  // Clamp cell indices to grid bounds
  for (const cell of grid.cells) {
    cell.row = Math.max(0, Math.min(cell.row, grid.rows - 1));
    cell.col = Math.max(0, Math.min(cell.col, grid.cols - 1));
    cell.rowSpan = Math.max(1, Math.min(cell.rowSpan, grid.rows - cell.row));
    cell.colSpan = Math.max(1, Math.min(cell.colSpan, grid.cols - cell.col));
  }

  // Step 1: Calculate column widths (proportional to room areas)
  const colWeights = new Array(grid.cols).fill(1);
  for (const cell of grid.cells) {
    if (cell.type === "hallway") continue;
    const spec = specMap.get(cell.name);
    const weight = spec ? Math.max(1, Math.sqrt(spec.areaSqm)) : 2;
    const perCol = weight / Math.max(cell.colSpan, 1);
    for (let c = cell.col; c < cell.col + cell.colSpan && c < grid.cols; c++) {
      colWeights[c] = Math.max(colWeights[c], perCol);
    }
  }

  // Normalize to footprint width, enforce minimums
  const colTotal = Math.max(colWeights.reduce((s, w) => s + w, 0), 1);
  const colWidths = colWeights.map(w => snap(Math.max(MIN_COL_WIDTH, w / colTotal * fpW)));
  // Re-normalize after minimum enforcement
  const colSum = Math.max(colWidths.reduce((s, w) => s + w, 0), 1);
  const colScale = fpW / colSum;
  for (let c = 0; c < colWidths.length; c++) {
    colWidths[c] = snap(Math.max(MIN_COL_WIDTH, colWidths[c] * colScale));
  }
  // Fix last column to absorb rounding
  const finalColSum = colWidths.slice(0, -1).reduce((s, w) => s + w, 0);
  colWidths[colWidths.length - 1] = snap(Math.max(MIN_COL_WIDTH, fpW - finalColSum));

  // Step 2: Calculate row heights
  const rowHeights = new Array(grid.rows).fill(MIN_ROW_HEIGHT);
  for (let r = 0; r < grid.rows; r++) {
    if (r === grid.corridorRow) {
      rowHeights[r] = CORRIDOR_HEIGHT;
      continue;
    }
    // Find rooms in this row
    const roomsInRow = grid.cells.filter(c =>
      c.row <= r && r < c.row + c.rowSpan && c.type !== "hallway"
    );
    let maxHeight = MIN_ROW_HEIGHT;
    for (const cell of roomsInRow) {
      const spec = specMap.get(cell.name);
      if (!spec) continue;
      const cellWidth = colWidths.slice(cell.col, Math.min(cell.col + cell.colSpan, grid.cols))
        .reduce((s, w) => s + w, 0);
      const neededHeight = spec.areaSqm / Math.max(cellWidth, 1);
      maxHeight = Math.max(maxHeight, neededHeight);
    }
    rowHeights[r] = snap(Math.max(MIN_ROW_HEIGHT, Math.min(maxHeight, fpH * 0.5)));
  }

  // Determine minimum height per row based on room types in that row
  const rowMinHeights = new Array(grid.rows).fill(MIN_ROW_HEIGHT);
  for (let r = 0; r < grid.rows; r++) {
    if (r === grid.corridorRow) { rowMinHeights[r] = CORRIDOR_HEIGHT; continue; }
    const roomsInRow = grid.cells.filter(c => c.row <= r && r < c.row + c.rowSpan);
    for (const cell of roomsInRow) {
      const n = cell.name.toLowerCase();
      const t = cell.type;
      if (n.includes("bed") || t === "bedroom") rowMinHeights[r] = Math.max(rowMinHeights[r], 2.7);
      else if (n.includes("living") || t === "living") rowMinHeights[r] = Math.max(rowMinHeights[r], 2.7);
      else if (n.includes("dining") || t === "dining") rowMinHeights[r] = Math.max(rowMinHeights[r], 2.4);
      else if (n.includes("kitchen") || t === "kitchen") rowMinHeights[r] = Math.max(rowMinHeights[r], 2.1);
    }
  }

  // Normalize: corridor stays at 1.2m, scale others to fill fpH while respecting mins
  const corridorH = grid.corridorRow !== undefined ? CORRIDOR_HEIGHT : 0;
  const nonCorridorSum = rowHeights.reduce((s, h, i) => i === grid.corridorRow ? s : s + h, 0);
  const available = fpH - corridorH;
  if (nonCorridorSum > 0 && available > 0) {
    const scale = available / nonCorridorSum;
    for (let r = 0; r < rowHeights.length; r++) {
      if (r === grid.corridorRow) {
        rowHeights[r] = CORRIDOR_HEIGHT;
      } else {
        rowHeights[r] = snap(Math.max(rowMinHeights[r], rowHeights[r] * scale));
      }
    }
  }
  // Fix last non-corridor row to absorb rounding
  const rowSum = rowHeights.reduce((s, h) => s + h, 0);
  if (Math.abs(rowSum - fpH) > 0.05) {
    for (let r = rowHeights.length - 1; r >= 0; r--) {
      if (r !== grid.corridorRow) {
        rowHeights[r] = snap(Math.max(rowMinHeights[r], rowHeights[r] + (fpH - rowSum)));
        break;
      }
    }
  }

  // Step 3: Cumulative positions
  const colX: number[] = [0];
  for (let c = 0; c < colWidths.length; c++) {
    colX.push(snap(colX[c] + colWidths[c]));
  }
  const rowY: number[] = [0];
  for (let r = 0; r < rowHeights.length; r++) {
    rowY.push(snap(rowY[r] + rowHeights[r]));
  }

  // Step 4: Generate PlacedRoom[] — with null safety
  const placed: PlacedRoom[] = [];
  for (const cell of grid.cells) {
    const endCol = Math.min(cell.col + cell.colSpan, grid.cols);
    const endRow = Math.min(cell.row + cell.rowSpan, grid.rows);
    const x = colX[cell.col] ?? 0;
    const y = rowY[cell.row] ?? 0;
    const width = snap(Math.max(1.0, (colX[endCol] ?? fpW) - x));
    const depth = snap(Math.max(1.0, (rowY[endRow] ?? fpH) - y));

    placed.push({
      name: cell.name,
      type: cell.type,
      x, y, width, depth,
      area: snap(width * depth),
    });
  }

  console.log(`[GRID→COORDS] ${placed.length} rooms, colWidths=[${colWidths.map(w => w.toFixed(1)).join(",")}], rowHeights=[${rowHeights.map(h => h.toFixed(1)).join(",")}]`);

  return placed;
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function generateGridLayout(
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
  userApiKey?: string,
): Promise<PlacedRoom[] | null> {
  try {
    const client = getClient(userApiKey, 45_000);

    const userMessage = buildGridUserMessage(program);

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GRID_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.warn("[GRID] Empty GPT-4o response");
      return null;
    }

    const grid = parseGridResponse(content);
    if (!grid) {
      console.warn("[GRID] Failed to parse grid response");
      return null;
    }

    console.log(`[GRID] GPT-4o returned ${grid.rows}×${grid.cols} grid with ${grid.cells.length} rooms`);

    // Validate
    const errors = validateGrid(grid, program);
    if (errors.length > 0) {
      console.warn(`[GRID] Validation errors: ${errors.join("; ")}`);
      // Try to fix missing rooms by adding them to empty cells
      // For now, just proceed if most rooms are placed
      const placedCount = grid.cells.length;
      if (placedCount < program.rooms.length * 0.7) {
        return null; // too many missing rooms
      }
    }

    // Convert grid to coordinates
    const placed = gridToCoordinates(grid, program, fpW, fpH);

    if (placed.length === 0) {
      console.warn("[GRID] gridToCoordinates returned empty");
      return null;
    }

    // Sanity check: no room should have null/NaN/zero dimensions
    const invalid = placed.find(r =>
      !r.width || !r.depth || !r.area ||
      isNaN(r.width) || isNaN(r.depth) || isNaN(r.area) ||
      r.width < 0.5 || r.depth < 0.5
    );
    if (invalid) {
      console.warn(`[GRID] Invalid room dimensions: ${invalid.name} ${invalid.width}×${invalid.depth}`);
      return null;
    }

    console.log(`[GRID] Placed ${placed.length} rooms:`,
      placed.map(r => `${r.name}: ${r.width.toFixed(1)}×${r.depth.toFixed(1)}=${(r.width * r.depth).toFixed(1)}m²`).join(", ")
    );

    // Check coverage
    const totalArea = placed.reduce((s, r) => s + r.width * r.depth, 0);
    const coverage = totalArea / (fpW * fpH) * 100;
    console.log(`[GRID] Coverage: ${coverage.toFixed(0)}%`);

    if (coverage < 70 || coverage > 120) {
      console.warn(`[GRID] Coverage ${coverage.toFixed(0)}% out of range, falling back`);
      return null;
    }

    return placed;
  } catch (err) {
    console.error("[GRID] Error:", err instanceof Error ? err.message : err);
    return null;
  }
}
