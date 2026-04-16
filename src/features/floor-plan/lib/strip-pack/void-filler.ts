/**
 * Step 9 — detect leftover voids inside the plot and absorb them into
 * adjacent rooms.
 *
 * Strategy:
 *   1. Rasterize the plot into a 0.5-ft occupancy grid. Cells covered by a
 *      placed room or by the hallway spine are marked OCCUPIED; others are
 *      marked EMPTY.
 *   2. Flood-fill connected EMPTY regions.
 *   3. For each region:
 *        - Compute bounding box (axis-aligned).
 *        - If small (< MIN_VOID_TO_LOG): expand the adjacent room whose union
 *          with the void produces the best aspect ratio.
 *        - If larger and absorbable in a single rectangular union: same.
 *        - If non-rectangular and too irregular: leave it (a Phase 4 hallway
 *          extension or extra utility room is the better fix). Log a warning.
 *
 * Note: the strip-packer's row-depth normalization eliminates 95% of voids
 * already. This module handles the residue (entrance carve-out gaps, last
 * row not reaching strip end, slight numerical drift around the spine).
 */
import type { Rect, StripPackRoom, SpineLayout } from "./types";
import { rectOverlap } from "./types";

const GRID_RESOLUTION_FT = 0.5;
const MIN_VOID_AREA_TO_FILL_SQFT = 1;       // ignore smaller than 1 sqft (numerical drift)
const MAX_VOID_TO_AUTO_FILL_SQFT = 200;     // larger than this: warn, don't try
const ASPECT_DISTORTION_THRESHOLD = 1.5;    // log() ratio diff above this — degraded

export interface FillInput {
  plot: Rect;
  rooms: StripPackRoom[];
  spine: SpineLayout;
}

export interface FillOutput {
  rooms: StripPackRoom[];
  warnings: string[];
  /** Net leftover void after filling, in sqft. */
  remainingVoidSqft: number;
}

interface Cell {
  ix: number;
  iy: number;
}

interface VoidRegion {
  bbox: Rect;
  area_sqft: number;
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINT
// ───────────────────────────────────────────────────────────────────────────

export function fillVoids(input: FillInput): FillOutput {
  const warnings: string[] = [];
  const rooms = input.rooms.map(r => ({ ...r, placed: r.placed ? { ...r.placed } : undefined }));

  const grid = buildOccupancyGrid(input.plot, rooms, input.spine);
  const regions = findEmptyRegions(grid, input.plot);

  let remainingVoid = 0;
  for (const region of regions) {
    if (region.area_sqft < MIN_VOID_AREA_TO_FILL_SQFT) continue;
    if (region.area_sqft > MAX_VOID_TO_AUTO_FILL_SQFT) {
      warnings.push(`void of ${region.area_sqft.toFixed(0)} sqft at (${region.bbox.x.toFixed(1)}, ${region.bbox.y.toFixed(1)}) — too large to auto-fill`);
      remainingVoid += region.area_sqft;
      continue;
    }
    const filled = absorbInto(region, rooms, input.plot);
    if (!filled) {
      warnings.push(`void of ${region.area_sqft.toFixed(0)} sqft at (${region.bbox.x.toFixed(1)}, ${region.bbox.y.toFixed(1)}) — no adjacent room could absorb it`);
      remainingVoid += region.area_sqft;
    }
  }

  // Recompute area_sqft on rooms whose placed changed.
  for (const r of rooms) {
    if (r.placed) r.actual_area_sqft = r.placed.width * r.placed.depth;
  }

  return { rooms, warnings, remainingVoidSqft: remainingVoid };
}

// ───────────────────────────────────────────────────────────────────────────
// OCCUPANCY GRID
// ───────────────────────────────────────────────────────────────────────────

function buildOccupancyGrid(plot: Rect, rooms: StripPackRoom[], spine: SpineLayout): boolean[][] {
  const cols = Math.ceil(plot.width / GRID_RESOLUTION_FT);
  const rowsCount = Math.ceil(plot.depth / GRID_RESOLUTION_FT);
  const grid: boolean[][] = Array.from({ length: rowsCount }, () => new Array(cols).fill(false));

  const fill = (rect: Rect) => {
    const x0 = Math.max(0, Math.floor((rect.x - plot.x) / GRID_RESOLUTION_FT));
    const y0 = Math.max(0, Math.floor((rect.y - plot.y) / GRID_RESOLUTION_FT));
    const x1 = Math.min(cols, Math.ceil((rect.x + rect.width  - plot.x) / GRID_RESOLUTION_FT));
    const y1 = Math.min(rowsCount, Math.ceil((rect.y + rect.depth  - plot.y) / GRID_RESOLUTION_FT));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        grid[y][x] = true;
      }
    }
  };

  for (const r of rooms) if (r.placed) fill(r.placed);
  fill(spine.spine);
  return grid;
}

// ───────────────────────────────────────────────────────────────────────────
// FLOOD-FILL EMPTY REGIONS
// ───────────────────────────────────────────────────────────────────────────

function findEmptyRegions(grid: boolean[][], plot: Rect): VoidRegion[] {
  const rowsCount = grid.length;
  const cols = grid[0]?.length ?? 0;
  const visited: boolean[][] = Array.from({ length: rowsCount }, () => new Array(cols).fill(false));
  const out: VoidRegion[] = [];

  for (let y = 0; y < rowsCount; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] || visited[y][x]) continue;
      const region = flood(x, y, grid, visited);
      if (region.length === 0) continue;
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const c of region) {
        if (c.ix < xMin) xMin = c.ix;
        if (c.ix > xMax) xMax = c.ix;
        if (c.iy < yMin) yMin = c.iy;
        if (c.iy > yMax) yMax = c.iy;
      }
      const bbox: Rect = {
        x: plot.x + xMin * GRID_RESOLUTION_FT,
        y: plot.y + yMin * GRID_RESOLUTION_FT,
        width: (xMax - xMin + 1) * GRID_RESOLUTION_FT,
        depth: (yMax - yMin + 1) * GRID_RESOLUTION_FT,
      };
      const area = region.length * GRID_RESOLUTION_FT * GRID_RESOLUTION_FT;
      out.push({ bbox, area_sqft: area });
    }
  }
  return out;
}

function flood(sx: number, sy: number, grid: boolean[][], visited: boolean[][]): Cell[] {
  const cells: Cell[] = [];
  const queue: Cell[] = [{ ix: sx, iy: sy }];
  visited[sy][sx] = true;
  const rowsCount = grid.length;
  const cols = grid[0].length;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    cells.push(cur);
    const neighbors = [
      { ix: cur.ix + 1, iy: cur.iy },
      { ix: cur.ix - 1, iy: cur.iy },
      { ix: cur.ix, iy: cur.iy + 1 },
      { ix: cur.ix, iy: cur.iy - 1 },
    ];
    for (const n of neighbors) {
      if (n.ix < 0 || n.ix >= cols || n.iy < 0 || n.iy >= rowsCount) continue;
      if (visited[n.iy][n.ix]) continue;
      if (grid[n.iy][n.ix]) continue;
      visited[n.iy][n.ix] = true;
      queue.push(n);
    }
  }
  return cells;
}

// ───────────────────────────────────────────────────────────────────────────
// ABSORB VOID INTO ADJACENT ROOM
// ───────────────────────────────────────────────────────────────────────────

function absorbInto(region: VoidRegion, rooms: StripPackRoom[], plot: Rect): boolean {
  const candidates = rooms
    .filter(r => r.placed && touchesEdge(r.placed, region.bbox))
    .map(r => {
      const expanded = unionRect(r.placed!, region.bbox);
      const distortion = aspectDistortion(r.placed!, expanded);
      return { room: r, expanded, distortion };
    })
    .filter(c => c.distortion < ASPECT_DISTORTION_THRESHOLD)
    .filter(c => isInside(c.expanded, plot))
    .filter(c => !overlapsAnyExcept(c.expanded, rooms, c.room.id));

  if (candidates.length === 0) return false;

  candidates.sort((a, b) => a.distortion - b.distortion);
  const winner = candidates[0];
  winner.room.placed = winner.expanded;
  return true;
}

function touchesEdge(room: Rect, region: Rect, eps = 1e-2): boolean {
  // The room shares any of its 4 edges with the region's bbox edges.
  const roomR = room.x + room.width;
  const roomT = room.y + room.depth;
  const regR  = region.x + region.width;
  const regT  = region.y + region.depth;
  // share vertical edge (touching X)
  if (Math.abs(roomR - region.x) < eps || Math.abs(regR - room.x) < eps) {
    if (overlapRange(room.y, roomT, region.y, regT) > eps) return true;
  }
  // share horizontal edge (touching Y)
  if (Math.abs(roomT - region.y) < eps || Math.abs(regT - room.y) < eps) {
    if (overlapRange(room.x, roomR, region.x, regR) > eps) return true;
  }
  return false;
}

function overlapRange(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.width, b.x + b.width);
  const t = Math.max(a.y + a.depth, b.y + b.depth);
  return { x, y, width: r - x, depth: t - y };
}

function aspectDistortion(orig: Rect, after: Rect): number {
  const oRatio = orig.width / Math.max(orig.depth, 0.01);
  const aRatio = after.width / Math.max(after.depth, 0.01);
  return Math.abs(Math.log(oRatio) - Math.log(aRatio));
}

function isInside(r: Rect, container: Rect): boolean {
  return r.x >= container.x - 1e-3 &&
         r.y >= container.y - 1e-3 &&
         r.x + r.width  <= container.x + container.width  + 1e-3 &&
         r.y + r.depth  <= container.y + container.depth  + 1e-3;
}

function overlapsAnyExcept(rect: Rect, rooms: StripPackRoom[], excludeId: string): boolean {
  for (const r of rooms) {
    if (r.id === excludeId) continue;
    if (!r.placed) continue;
    if (rectOverlap(rect, r.placed) > 1e-3) return true;
  }
  return false;
}
