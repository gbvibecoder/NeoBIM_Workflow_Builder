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
  const CORRIDOR_HEIGHT = 1.2;

  // Build a map of room specs by name
  const specMap = new Map(program.rooms.map(r => [r.name, r]));

  // Step 1: Calculate column widths
  // Each column's width is proportional to the max target area of rooms in it
  const colWeights = new Array(grid.cols).fill(1);
  for (const cell of grid.cells) {
    if (cell.type === "hallway") continue;
    const spec = specMap.get(cell.name);
    const weight = spec ? Math.sqrt(spec.areaSqm) : 2;
    const perCol = weight / cell.colSpan;
    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
      colWeights[c] = Math.max(colWeights[c], perCol);
    }
  }

  // Normalize column widths to sum to fpW
  const colTotal = colWeights.reduce((s, w) => s + w, 0);
  const colWidths = colWeights.map(w => snap(w / colTotal * fpW));
  // Fix rounding: adjust last column
  const colSum = colWidths.reduce((s, w) => s + w, 0);
  colWidths[colWidths.length - 1] = snap(colWidths[colWidths.length - 1] + (fpW - colSum));

  // Enforce minimum column width (2.4m for habitable rooms)
  for (let c = 0; c < colWidths.length; c++) {
    if (colWidths[c] < 2.0) colWidths[c] = 2.0;
  }
  // Re-normalize
  const colSum2 = colWidths.reduce((s, w) => s + w, 0);
  const colScale = fpW / colSum2;
  for (let c = 0; c < colWidths.length; c++) {
    colWidths[c] = snap(colWidths[c] * colScale);
  }

  // Step 2: Calculate row heights
  const rowHeights = new Array(grid.rows).fill(0);
  for (let r = 0; r < grid.rows; r++) {
    if (r === grid.corridorRow) {
      rowHeights[r] = CORRIDOR_HEIGHT;
      continue;
    }

    // Find rooms in this row and calculate needed height
    const roomsInRow = grid.cells.filter(c =>
      c.row <= r && r < c.row + c.rowSpan && c.type !== "hallway"
    );

    let maxHeight = 2.4; // minimum row height
    for (const cell of roomsInRow) {
      const spec = specMap.get(cell.name);
      if (!spec) continue;
      const cellWidth = colWidths.slice(cell.col, cell.col + cell.colSpan)
        .reduce((s, w) => s + w, 0);
      // Height needed to achieve target area
      const neededHeight = spec.areaSqm / Math.max(cellWidth, 1);
      maxHeight = Math.max(maxHeight, neededHeight);
    }
    rowHeights[r] = snap(Math.min(maxHeight, fpH * 0.45)); // cap at 45% of footprint
  }

  // Normalize row heights to sum to fpH
  const rowTotal = rowHeights.reduce((s, h) => s + h, 0);
  const rowScale = fpH / rowTotal;
  for (let r = 0; r < rowHeights.length; r++) {
    if (r === grid.corridorRow) continue; // keep corridor at 1.2m
    rowHeights[r] = snap(rowHeights[r] * rowScale);
  }
  // Fix: ensure corridor stays at 1.2m, adjust others
  const nonCorridorSum = rowHeights.reduce((s, h, i) => i === grid.corridorRow ? s : s + h, 0);
  const availableForRooms = fpH - CORRIDOR_HEIGHT;
  if (grid.corridorRow !== undefined && nonCorridorSum > 0) {
    const scale2 = availableForRooms / nonCorridorSum;
    for (let r = 0; r < rowHeights.length; r++) {
      if (r === grid.corridorRow) {
        rowHeights[r] = CORRIDOR_HEIGHT;
      } else {
        rowHeights[r] = snap(rowHeights[r] * scale2);
      }
    }
  }

  // Step 3: Convert to coordinates
  // Pre-compute cumulative positions
  const colX: number[] = [0];
  for (let c = 0; c < colWidths.length; c++) {
    colX.push(snap(colX[c] + colWidths[c]));
  }
  const rowY: number[] = [0];
  for (let r = 0; r < rowHeights.length; r++) {
    rowY.push(snap(rowY[r] + rowHeights[r]));
  }

  const placed: PlacedRoom[] = [];
  for (const cell of grid.cells) {
    const x = colX[cell.col];
    const y = rowY[cell.row];
    const width = snap(colX[cell.col + cell.colSpan] - x);
    const depth = snap(rowY[cell.row + cell.rowSpan] - y);

    placed.push({
      name: cell.name,
      type: cell.type,
      x, y, width, depth,
      area: snap(width * depth),
    });
  }

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

    console.log(`[GRID] Placed ${placed.length} rooms:`,
      placed.map(r => `${r.name}: ${r.width.toFixed(1)}×${r.depth.toFixed(1)}=${(r.width * r.depth).toFixed(1)}m²`).join(", ")
    );

    // Verify: check coverage
    const totalArea = placed.reduce((s, r) => s + r.width * r.depth, 0);
    const coverage = totalArea / (fpW * fpH) * 100;
    console.log(`[GRID] Coverage: ${coverage.toFixed(0)}%`);

    if (coverage < 70) {
      console.warn("[GRID] Coverage too low, falling back");
      return null;
    }

    return placed;
  } catch (err) {
    console.error("[GRID] Error:", err instanceof Error ? err.message : err);
    return null;
  }
}
