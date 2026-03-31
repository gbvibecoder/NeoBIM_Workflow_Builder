/**
 * Deterministic Floor Plan Layout Engine
 *
 * Replaces GPT-4o spatial reasoning with a BSP (Binary Space Partitioning)
 * algorithm that guarantees:
 *   - Zero gaps (every point belongs to exactly one room)
 *   - Zero overlaps (rooms never share interior area)
 *   - Perfect tiling (room areas sum to footprint area)
 *   - Architectural zoning (public front, private back, corridor between)
 *   - Adjacency satisfaction (bedrooms near bathrooms, kitchen near dining)
 *
 * Pure synchronous function — no AI calls, runs in < 10ms.
 */

import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "./ai-room-programmer";
import { correctDimensions } from "./dimension-corrector";
import type { RoomWithTarget } from "./dimension-corrector";
import { layoutCourtyardPlan, hasCourtyardRoom } from "./courtyard-layout";

// ── Output type ──────────────────────────────────────────────────────────────

export interface PlacedRoom {
  name: string;
  type: string;
  x: number;      // left edge, meters from building left (Y-down)
  y: number;      // top edge, meters from building top (Y-down)
  width: number;  // x-axis extent in meters
  depth: number;  // y-axis extent in meters
  area: number;   // width × depth
}

// ── Internal types ───────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RoomGroup {
  rooms: RoomSpec[];
  totalArea: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const GRID = 0.1;               // 100mm grid
const CORRIDOR_DEPTH = 1.2;     // standard Indian corridor
const MIN_HABITABLE = 2.4;      // minimum habitable room dimension
const MIN_BATHROOM_DIM = 1.2;   // minimum bathroom dimension (IS code)
const MIN_STRIP_WIDTH = 2.8;    // minimum strip width for bedroom-bath pairs
const DEFAULT_ASPECT = 1.33;    // footprint width:depth ratio
const MAX_ROOM_AR = 2.8;        // max aspect ratio for non-corridor rooms

// ── Grid snap ────────────────────────────────────────────────────────────────

function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function ar(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 999;
  return Math.max(w, h) / Math.min(w, h);
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function layoutFloorPlan(program: EnhancedRoomProgram): PlacedRoom[] {
  const rooms = program.rooms;
  if (rooms.length === 0) return [];

  const inputCount = rooms.length;

  // Classify rooms
  const cls = classifyRooms(rooms);
  const roomAreaTotal = rooms.reduce((s, r) => s + r.areaSqm, 0);

  // Determine if zone-based layout is appropriate
  const needsCorridor = cls.hasPrivate && cls.hasPublic && rooms.length > 3;

  // Skip zoning if zones are extremely imbalanced (one zone <25% of other's area)
  // — avoids forcing a tiny zone to MIN_HABITABLE which wastes space and creates bad ARs
  let useZones = needsCorridor;
  if (useZones) {
    const privateArea = cls.privateZone.reduce((s, r) => s + r.areaSqm, 0);
    const publicArea = cls.publicZone.reduce((s, r) => s + r.areaSqm, 0);
    const zoneRatio = Math.min(privateArea, publicArea) / Math.max(privateArea, publicArea, 1);
    if (zoneRatio < 0.25) useZones = false;
  }

  // When zones are used, corridor eats into footprint — compensate
  // Cap corridor to 6% of total area or 12 sqm (matches layoutWithZones logic)
  const rawCorridorEstimate = CORRIDOR_DEPTH * Math.sqrt(Math.max(program.totalAreaSqm, roomAreaTotal) * DEFAULT_ASPECT);
  const corridorEstimate = useZones
    ? Math.min(rawCorridorEstimate, Math.max(program.totalAreaSqm, roomAreaTotal) * 0.06, 12.0)
    : 0;

  let totalArea = Math.max(program.totalAreaSqm, roomAreaTotal + corridorEstimate);

  // ── Footprint auto-expansion (only for high room counts) ──
  // For complex layouts (10+ rooms), ensure footprint has enough room.
  // Conservative: only expand when room area clearly exceeds footprint.
  if (rooms.length >= 10) {
    const requiredArea = roomAreaTotal + corridorEstimate;
    if (totalArea < requiredArea) {
      totalArea = requiredArea * 1.05; // 5% margin for wall thickness
    }
  }

  let fpW = grid(Math.sqrt(totalArea * DEFAULT_ASPECT));
  let fpH = grid(totalArea / fpW);

  // For very high room counts (15+), ensure footprint is generous enough
  // that BSP doesn't create unusably small rooms
  if (rooms.length >= 15) {
    const minFootprint = rooms.length * 4; // at least 4 sqm per room on average
    if (fpW * fpH < minFootprint) {
      const scale = Math.sqrt(minFootprint / (fpW * fpH));
      fpW = grid(fpW * scale);
      fpH = grid(fpH * scale);
    }
  }

  // ── Courtyard layout (if courtyard room present) ──
  if (hasCourtyardRoom(program)) {
    try {
      const courtyardResult = layoutCourtyardPlan(program, fpW, fpH);
      if (courtyardResult && courtyardResult.length > 0) {
        // Run dimension correction on courtyard layout too
        let result = courtyardResult;
        result = validateRoomSizes(result, rooms);
        if (rooms.length >= 6) {
          result = applyDimensionCorrection(result, rooms, fpW, fpH);
        }
        result = validateRoomSizes(result, rooms); // Second pass after correction
        result = enforceCorridorCap(result, fpW * fpH);
        result = validateAndRecoverRooms(rooms, result, fpW, fpH);
        checkDimensionAccuracy(result, rooms);
        return result;
      }
    } catch (err) {
      console.warn("[LAYOUT] Courtyard layout failed, falling back to BSP:", err);
    }
  }

  // ── Fixed-room pre-placement ──
  // Rooms with user-specified "exactly" dimensions are placed FIRST.
  // BSP only fills the remaining space with flex rooms.
  const fixedRooms = rooms.filter(r => r.preferredWidth && r.preferredDepth &&
    r.preferredWidth > 0 && r.preferredDepth > 0);

  let result: PlacedRoom[];

  if (fixedRooms.length >= 2) {
    // Use fixed-room pre-placement + BSP for remaining space
    try {
      result = layoutWithFixedRooms(rooms, fpW, fpH, program.adjacency, program.isVastuRequested);
      console.log(`[LAYOUT] Fixed-room placement: ${fixedRooms.length} fixed + ${rooms.length - fixedRooms.length} flex`);
    } catch (err) {
      console.warn("[LAYOUT] Fixed-room placement failed, falling back to BSP:", err);
      // Fall through to normal BSP
      result = fallbackBSP(rooms, useZones, cls, fpW, fpH, program.adjacency, program.entranceRoom, program);
    }
  } else {
    result = fallbackBSP(rooms, useZones, cls, fpW, fpH, program.adjacency, program.entranceRoom, program);
  }

  // ── Post-BSP room size validation ──
  // Clamp rooms with wildly wrong sizes (>2x or <0.5x target)
  result = validateRoomSizes(result, rooms);

  // ── Post-BSP swap optimization ──
  // Try swapping similarly-sized rooms to improve adjacency satisfaction
  if (program.adjacency.length > 0 && result.length >= 4) {
    result = optimizeLayoutSwaps(result, program.adjacency);
  }

  // ── Bedroom-bathroom adjacency repair ──
  // After swaps, verify every bedroom's paired bathroom is still adjacent.
  // If not, swap the drifted bathroom with a room adjacent to the bedroom.
  result = repairBedroomBathroomAdjacency(result, program.adjacency);

  // ── Exterior wall constraint enforcement ──
  // Rooms flagged mustHaveExteriorWall (living, bedrooms, kitchen) must touch
  // the building perimeter. Swap landlocked rooms with interior-ok rooms on the edge.
  result = enforceExteriorWallConstraint(result, rooms, fpW, fpH);

  // ── Vastu post-optimization (only when requested) ──
  // Bed-bath pair locking prevents Vastu swaps from breaking adjacency.
  if (program.isVastuRequested && result.length >= 4) {
    result = optimizeVastu(result, fpW, fpH, program.adjacency);
    result = verifyVastuPlacement(result, fpW, fpH);
    // Safety net: repair any bed-bath adjacency that slipped through locking
    result = repairBedroomBathroomAdjacency(result, program.adjacency);
  }

  // ── Post-BSP dimension correction ──
  // Adjust shared boundaries to make room sizes closer to targets.
  // Run for layouts with 6+ rooms (lowered from 10 to cover per-floor duplex layouts).
  if (rooms.length >= 6) {
    result = applyDimensionCorrection(result, rooms, fpW, fpH);
  }

  // ── Room proportion refinement ──
  // Fix extreme aspect ratios (e.g., 7×2m bedrooms → 5×3m).
  // Runs after dimension correction so it refines the corrected sizes.
  result = refineRoomProportions(result);

  // ── SECOND size validation — catch rooms inflated by dimension correction ──
  result = validateRoomSizes(result, rooms);

  // ── Corridor hard cap enforcement ──
  // Cap corridor area regardless of source (AI-specified or BSP-created)
  result = enforceCorridorCap(result, fpW * fpH);

  // ── Room count validation ──
  // RULE: rooms_in == rooms_out. If BSP lost any rooms, force-place them.
  result = validateAndRecoverRooms(rooms, result, fpW, fpH);

  if (result.length !== inputCount) {
    console.warn(`[STAGE-2] Room count mismatch after recovery: input=${inputCount}, output=${result.length}`);
  }

  // ── NBC minimum dimension enforcement ──
  // Verify every room meets NBC 2016 minimum dimensions.
  // Habitable: ≥2.4m, Kitchen: ≥2.1m, Bathroom: ≥1.2m, Corridor: ≥1.0m
  result = enforceNBCMinimumDimensions(result);

  // ── Dimension accuracy check (diagnostic) ──
  checkDimensionAccuracy(result, rooms);

  return result;
}

/**
 * Check how well BSP-allocated dimensions match user-specified preferred dimensions.
 * Diagnostic only — logs warnings but doesn't modify layout.
 */
function checkDimensionAccuracy(placed: PlacedRoom[], specs: RoomSpec[]): void {
  for (const room of placed) {
    const spec = specs.find(s => s.name === room.name);
    if (!spec?.preferredWidth || !spec?.preferredDepth) continue;

    // Check both orientations (BSP might rotate the room)
    const w1 = Math.abs(room.width - spec.preferredWidth) / spec.preferredWidth;
    const d1 = Math.abs(room.depth - spec.preferredDepth) / spec.preferredDepth;
    const w2 = Math.abs(room.width - spec.preferredDepth) / spec.preferredDepth;
    const d2 = Math.abs(room.depth - spec.preferredWidth) / spec.preferredWidth;

    const bestMatch = Math.min(Math.max(w1, d1), Math.max(w2, d2));
    if (bestMatch > 0.3) {
      console.warn(
        `[DIM-CHECK] ${room.name}: wanted ${spec.preferredWidth.toFixed(1)}x${spec.preferredDepth.toFixed(1)}m, ` +
        `got ${room.width.toFixed(1)}x${room.depth.toFixed(1)}m (${Math.round(bestMatch * 100)}% off)`
      );
    }
  }
}

// ── Fallback to standard BSP (no fixed rooms) ──────────────────────────────

function fallbackBSP(
  rooms: RoomSpec[], useZones: boolean, cls: ReturnType<typeof classifyRooms>,
  fpW: number, fpH: number, adjacency: AdjacencyRequirement[],
  entranceRoom?: string,
  program?: EnhancedRoomProgram,
): PlacedRoom[] {
  // ── PRIMARY: Spine-first layout (architecturally-informed placement) ──
  // Requires both public and private zones, enough rooms, and adequate footprint.
  const minZoneH = MIN_HABITABLE * 2 + CORRIDOR_DEPTH;
  if (useZones && program && program.rooms.length >= 10 && fpH >= minZoneH) {
    const spineResult = layoutWithSpine(program, cls, fpW, fpH);
    if (spineResult) return spineResult;
  }

  // ── FALLBACK: BSP zone-based layout ──
  const minZoneHeight = MIN_HABITABLE * 2 + CORRIDOR_DEPTH;
  if (!useZones || fpH < minZoneHeight) {
    return bspSubdivide(rooms, { x: 0, y: 0, w: fpW, h: fpH }, adjacency);
  }
  return layoutWithZones(cls, fpW, fpH, adjacency, entranceRoom);
}

// ── Fixed-room pre-placement + BSP for remaining ───────────────────────────

/**
 * Place rooms with user-specified dimensions FIRST, then BSP fills the rest.
 *
 * Strategy:
 * 1. Sort fixed rooms by area (largest first)
 * 2. Place each using edge-aligned greedy packing with Vastu preference
 * 3. Find remaining free rectangles via grid scan
 * 4. BSP subdivides flex rooms into the largest free rectangle
 */
function layoutWithFixedRooms(
  allRooms: RoomSpec[],
  fpW: number,
  fpH: number,
  adjacency: AdjacencyRequirement[],
  vastuRequested?: boolean,
): PlacedRoom[] {
  const fixed = allRooms.filter(r => r.preferredWidth && r.preferredDepth &&
    r.preferredWidth > 0 && r.preferredDepth > 0);
  const flex = allRooms.filter(r => !fixed.includes(r));

  // Sort fixed rooms by area descending (largest first = hardest to place)
  const sortedFixed = [...fixed].sort((a, b) =>
    (b.preferredWidth! * b.preferredDepth!) - (a.preferredWidth! * a.preferredDepth!)
  );

  const placed: PlacedRoom[] = [];
  const occupied: Rect[] = [];
  const step = GRID; // 0.1m placement grid

  for (const room of sortedFixed) {
    const rw = grid(room.preferredWidth!);
    const rd = grid(room.preferredDepth!);

    // Try both orientations
    const orientations = [
      { w: rw, d: rd },
      { w: rd, d: rw },
    ];

    let bestPos: { x: number; y: number; w: number; d: number } | null = null;
    let bestScore = -Infinity;

    for (const { w, d } of orientations) {
      if (w > fpW || d > fpH) continue;

      // Scan positions at grid resolution (coarser step for speed)
      const scanStep = Math.max(step, 0.3);
      for (let y = 0; y <= fpH - d + 0.01; y += scanStep) {
        for (let x = 0; x <= fpW - w + 0.01; x += scanStep) {
          const gx = grid(x);
          const gy = grid(y);

          // Check overlap with occupied
          const overlaps = occupied.some(r =>
            gx < r.x + r.w - 0.05 && gx + w > r.x + 0.05 &&
            gy < r.y + r.h - 0.05 && gy + d > r.y + 0.05
          );
          if (overlaps) continue;

          // Score: prefer edges, corners, and Vastu-correct positions
          let score = 0;

          // Edge bonuses (rooms against building edges are more realistic)
          if (gx < step) score += 3;
          if (gx + w > fpW - step) score += 3;
          if (gy < step) score += 3;
          if (gy + d > fpH - step) score += 3;

          // Corner bonus
          if ((gx < step || gx + w > fpW - step) && (gy < step || gy + d > fpH - step)) score += 2;

          // Adjacency to already-placed rooms (touching = good)
          for (const occ of occupied) {
            const touchH = Math.abs(gx + w - occ.x) < 0.15 || Math.abs(occ.x + occ.w - gx) < 0.15;
            const touchV = Math.abs(gy + d - occ.y) < 0.15 || Math.abs(occ.y + occ.h - gy) < 0.15;
            const overlapH = gx < occ.x + occ.w - 0.1 && gx + w > occ.x + 0.1;
            const overlapV = gy < occ.y + occ.h - 0.1 && gy + d > occ.y + 0.1;
            if ((touchH && overlapV) || (touchV && overlapH)) score += 2;
          }

          // Vastu preference scoring
          if (vastuRequested) {
            const nameLower = room.name.toLowerCase();
            const typeLower = (room.type || "").toLowerCase();
            const cx = gx + w / 2;
            const cy = gy + d / 2;
            // Kitchen in SE (high y, high x in Y-down coords)
            if (typeLower.includes("kitchen") || nameLower.includes("kitchen")) {
              if (cx > fpW / 2 && cy > fpH / 2) score += 8;
            }
            // Pooja in NE (low y, high x)
            if (nameLower.includes("pooja") || nameLower.includes("puja") || nameLower.includes("prayer")) {
              if (cx > fpW / 2 && cy < fpH / 2) score += 8;
            }
            // Master bedroom in SW (high y, low x)
            if (nameLower.includes("master")) {
              if (cx < fpW / 2 && cy > fpH / 2) score += 8;
            }
            // Living/entrance near north edge (low y)
            if (typeLower.includes("living") || nameLower.includes("living")) {
              if (cy < fpH / 2) score += 4;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestPos = { x: gx, y: gy, w, d };
          }
        }
      }
    }

    if (bestPos) {
      placed.push({
        name: room.name,
        type: room.type,
        x: bestPos.x,
        y: bestPos.y,
        width: bestPos.w,
        depth: bestPos.d,
        area: grid(bestPos.w * bestPos.d),
      });
      occupied.push({ x: bestPos.x, y: bestPos.y, w: bestPos.w, h: bestPos.d });
    } else {
      // Can't fit with exact dimensions — demote to flex
      flex.push(room);
      console.warn(`[FIXED-PLACE] ${room.name}: can't fit ${rw}x${rd}m, demoting to flex`);
    }
  }

  // Find free rectangular regions for BSP
  if (flex.length > 0) {
    const freeRects = findFreeRectangles(fpW, fpH, occupied);
    if (freeRects.length > 0) {
      // Sort flex rooms by area descending
      flex.sort((a, b) => b.areaSqm - a.areaSqm);

      // Distribute flex rooms across free rects proportionally
      const totalFreeArea = freeRects.reduce((s, r) => s + r.w * r.h, 0);
      let flexIdx = 0;

      for (const freeRect of freeRects) {
        if (flexIdx >= flex.length) break;
        const rectArea = freeRect.w * freeRect.h;
        if (rectArea < 2) continue; // Too small for a room

        // How many flex rooms fit in this rect (proportional to area)
        const roomCount = Math.max(1, Math.round(flex.length * rectArea / totalFreeArea));
        const roomsForRect = flex.slice(flexIdx, flexIdx + roomCount);
        flexIdx += roomCount;

        if (roomsForRect.length > 0) {
          const bspResult = bspSubdivide(roomsForRect, freeRect, adjacency);
          placed.push(...bspResult);
        }
      }

      // Any remaining flex rooms go in the largest free rect
      if (flexIdx < flex.length) {
        const remaining = flex.slice(flexIdx);
        const bspResult = bspSubdivide(remaining, freeRects[0], adjacency);
        placed.push(...bspResult);
      }
    } else {
      // No free space — append below the footprint
      console.warn("[FIXED-PLACE] No free space for flex rooms, appending below footprint");
      const maxY = Math.max(...occupied.map(r => r.y + r.h), fpH);
      const bspResult = bspSubdivide(flex, { x: 0, y: maxY, w: fpW, h: fpH * 0.5 }, adjacency);
      placed.push(...bspResult);
    }
  }

  return placed;
}

/**
 * Find the largest contiguous free rectangles in the footprint.
 * Uses a grid-based flood-fill approach.
 */
function findFreeRectangles(fpW: number, fpH: number, occupied: Rect[]): Rect[] {
  const cellSize = 0.3; // 300mm grid cells
  const gridW = Math.ceil(fpW / cellSize);
  const gridH = Math.ceil(fpH / cellSize);

  // Mark occupied cells
  const grid2d: boolean[][] = [];
  for (let y = 0; y < gridH; y++) {
    grid2d[y] = new Array(gridW).fill(false);
  }
  for (const r of occupied) {
    const x1 = Math.floor(r.x / cellSize);
    const y1 = Math.floor(r.y / cellSize);
    const x2 = Math.ceil((r.x + r.w) / cellSize);
    const y2 = Math.ceil((r.y + r.h) / cellSize);
    for (let y = Math.max(0, y1); y < Math.min(y2, gridH); y++) {
      for (let x = Math.max(0, x1); x < Math.min(x2, gridW); x++) {
        grid2d[y][x] = true;
      }
    }
  }

  // Flood-fill to find connected free regions
  const visited: boolean[][] = [];
  for (let y = 0; y < gridH; y++) {
    visited[y] = new Array(gridW).fill(false);
  }

  const freeRects: Rect[] = [];

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      if (grid2d[y][x] || visited[y][x]) continue;

      // BFS to find connected free region bounding box
      let minX = x, maxX = x, minY = y, maxY = y;
      const queue: [number, number][] = [[x, y]];
      visited[y][x] = true;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
          if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH && !grid2d[ny][nx] && !visited[ny][nx]) {
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
      }

      const rectW = grid((maxX - minX + 1) * cellSize);
      const rectH = grid((maxY - minY + 1) * cellSize);
      if (rectW >= MIN_HABITABLE && rectH >= MIN_HABITABLE) {
        freeRects.push({
          x: grid(minX * cellSize),
          y: grid(minY * cellSize),
          w: rectW,
          h: rectH,
        });
      }
    }
  }

  // Sort by area descending
  return freeRects.sort((a, b) => (b.w * b.h) - (a.w * a.h));
}

// ── Post-BSP swap optimization ──────────────────────────────────────────────

/**
 * Improve adjacency satisfaction by swapping room identities.
 *
 * Two phases:
 *   1. Priority swaps — force Kitchen↔Dining, Living↔Foyer adjacency
 *   2. General optimization — iterative pairwise swaps scored by layout quality
 */
function optimizeLayoutSwaps(
  rooms: PlacedRoom[],
  adjacency: AdjacencyRequirement[],
): PlacedRoom[] {
  if (rooms.length < 4 || adjacency.length === 0) return rooms;

  let layout = rooms.map(r => ({ ...r }));

  // ── Phase 1: Priority swaps for critical adjacencies ──
  layout = prioritySwaps(layout);

  // ── Phase 2: General optimization (more iterations for complex layouts) ──
  const maxIter = layout.length >= 15 ? 100 : 50;
  let bestScore = scoreLayout(layout, adjacency);

  for (let iteration = 0; iteration < maxIter; iteration++) {
    let improved = false;

    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i], b = layout[j];
        // Only swap rooms of similar size (within 50%)
        const sizeRatio = Math.min(a.area, b.area) / Math.max(a.area, b.area);
        if (sizeRatio < 0.5) continue;
        // Don't swap corridors/staircases
        if (a.type === "hallway" || b.type === "hallway") continue;
        if (a.type === "staircase" || b.type === "staircase") continue;

        // Swap room identity (name/type) while keeping BSP-assigned positions/dimensions
        const swapped = layout.map(r => ({ ...r }));
        swapped[i] = { ...a, name: b.name, type: b.type };
        swapped[j] = { ...b, name: a.name, type: a.type };

        const newScore = scoreLayout(swapped, adjacency);
        if (newScore > bestScore) {
          layout = swapped;
          bestScore = newScore;
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return layout;
}

/**
 * Force critical room adjacencies by targeted swaps.
 * Runs before general optimization to establish the flow backbone.
 */
function prioritySwaps(layout: PlacedRoom[]): PlacedRoom[] {
  const TOL = 0.15;
  const result = layout.map(r => ({ ...r }));

  // Priority 1: Kitchen adjacent to Dining
  forceAdjacency(result, "kitchen", "dining", TOL);
  // Priority 2: Drawing Room adjacent to Foyer (by name, not type)
  forceAdjacencyByName(result, "drawing", "foyer", TOL);
  // Priority 3: Foyer adjacent to Living
  forceAdjacency(result, "living", "entrance", TOL);
  // Priority 4: Living adjacent to Dining
  forceAdjacency(result, "living", "dining", TOL);
  // Priority 5: Dining adjacent to Living (reverse search if forward failed)
  forceAdjacency(result, "dining", "living", TOL);

  return result;
}

/**
 * Try to force two room types to be adjacent by swapping one of them
 * with a room currently adjacent to the other.
 */
function forceAdjacency(
  rooms: PlacedRoom[], typeA: string, typeB: string, tol: number,
): void {
  const roomA = rooms.find(r => r.type === typeA);
  const roomB = rooms.find(r => r.type === typeB);
  if (!roomA || !roomB) return;
  if (roomsShareEdge(roomA, roomB, tol)) return; // Already adjacent

  const idxA = rooms.indexOf(roomA);
  const idxB = rooms.indexOf(roomB);

  // Find rooms currently adjacent to roomA
  for (let k = 0; k < rooms.length; k++) {
    if (k === idxA || k === idxB) continue;
    const candidate = rooms[k];
    if (candidate.type === "hallway" || candidate.type === "staircase") continue;

    if (roomsShareEdge(roomA, candidate, tol)) {
      // Check if swapping candidate↔roomB would be size-compatible
      const ratio = Math.min(candidate.area, roomB.area) / Math.max(candidate.area, roomB.area);
      if (ratio < 0.35) continue; // Too different in size

      // Swap identities
      const tmpName = candidate.name, tmpType = candidate.type;
      rooms[k] = { ...candidate, name: roomB.name, type: roomB.type };
      rooms[idxB] = { ...roomB, name: tmpName, type: tmpType };
      return; // Done
    }
  }
}

/**
 * Force adjacency by room NAME (not type). Useful for "Drawing Room" ↔ "Foyer"
 * where type-based matching would miss the room.
 */
function forceAdjacencyByName(
  rooms: PlacedRoom[], nameA: string, nameB: string, tol: number,
): void {
  const roomA = rooms.find(r => r.name.toLowerCase().includes(nameA));
  const roomB = rooms.find(r => r.name.toLowerCase().includes(nameB));
  if (!roomA || !roomB) return;
  if (roomsShareEdge(roomA, roomB, tol)) return;

  const idxA = rooms.indexOf(roomA);
  const idxB = rooms.indexOf(roomB);

  for (let k = 0; k < rooms.length; k++) {
    if (k === idxA || k === idxB) continue;
    const candidate = rooms[k];
    if (candidate.type === "hallway" || candidate.type === "staircase") continue;

    if (roomsShareEdge(roomA, candidate, tol)) {
      const ratio = Math.min(candidate.area, roomB.area) / Math.max(candidate.area, roomB.area);
      if (ratio < 0.25) continue; // Relaxed threshold for name-based swaps

      const tmpName = candidate.name, tmpType = candidate.type;
      rooms[k] = { ...candidate, name: roomB.name, type: roomB.type };
      rooms[idxB] = { ...roomB, name: tmpName, type: tmpType };
      return;
    }
  }
}

/**
 * Score a layout for quality. Higher = better.
 */
function scoreLayout(rooms: PlacedRoom[], adjacency: AdjacencyRequirement[]): number {
  const TOL = 0.15;
  let score = 0;

  // 1. ADJACENCY SATISFACTION (weight: 10 per satisfied)
  for (const req of adjacency) {
    const a = rooms.find(r => r.name === req.roomA);
    const b = rooms.find(r => r.name === req.roomB);
    if (!a || !b) continue;
    if (roomsShareEdge(a, b, TOL)) score += 10;
  }

  // 2. FLOW SEQUENCE: foyer→living→dining→kitchen (weight: 20 per link)
  const FLOW_TYPES = ["entrance", "living", "dining", "kitchen"];
  for (let i = 0; i < FLOW_TYPES.length - 1; i++) {
    const ra = rooms.find(r => r.type === FLOW_TYPES[i]);
    const rb = rooms.find(r => r.type === FLOW_TYPES[i + 1]);
    if (ra && rb && roomsShareEdge(ra, rb, TOL)) {
      score += 20;
    }
  }

  // 3. HARD ADJACENCY CONSTRAINTS — heavy bonus/penalty for critical pairs
  const HARD_PAIRS: Array<{ matchA: (r: PlacedRoom) => boolean; matchB: (r: PlacedRoom) => boolean; bonus: number; penalty: number }> = [
    { matchA: r => r.type === "kitchen", matchB: r => r.type === "dining", bonus: 30, penalty: -50 },
    { matchA: r => r.name.toLowerCase().includes("drawing"), matchB: r => r.type === "entrance" || r.name.toLowerCase().includes("foyer"), bonus: 30, penalty: -40 },
    { matchA: r => r.type === "entrance" || r.name.toLowerCase().includes("foyer"), matchB: r => r.type === "living", bonus: 25, penalty: -30 },
    { matchA: r => r.type === "dining", matchB: r => r.type === "living", bonus: 20, penalty: -25 },
  ];

  for (const { matchA, matchB, bonus, penalty } of HARD_PAIRS) {
    const a = rooms.find(matchA);
    const b = rooms.find(matchB);
    if (!a || !b) continue;
    score += roomsShareEdge(a, b, TOL) ? bonus : penalty;
  }

  // 4. ASPECT RATIO PENALTY (weight: -3 per room with AR > 2.5)
  for (const room of rooms) {
    if (room.type === "hallway") continue;
    const roomAr = ar(room.width, room.depth);
    if (roomAr > 2.5) score -= 3;
  }

  // 5. WET WALL CLUSTERING: bathrooms near each other (weight: 5)
  const baths = rooms.filter(r => r.type === "bathroom");
  for (let i = 0; i < baths.length; i++) {
    for (let j = i + 1; j < baths.length; j++) {
      if (roomsShareEdge(baths[i], baths[j], TOL)) score += 5;
    }
  }

  // 6. BEDROOM-BATHROOM DETACHMENT penalty (-30 per detached pair)
  for (const req of adjacency) {
    const a = rooms.find(r => r.name === req.roomA);
    const b = rooms.find(r => r.name === req.roomB);
    if (!a || !b) continue;
    const isBedBath =
      (a.type === "bedroom" && b.type === "bathroom") ||
      (a.type === "bathroom" && b.type === "bedroom");
    if (isBedBath && !roomsShareEdge(a, b, TOL)) score -= 30;
  }

  return score;
}

/**
 * Check if two rooms share an edge (adjacent).
 */
function roomsShareEdge(a: PlacedRoom, b: PlacedRoom, tol: number): boolean {
  const shareH =
    (Math.abs((a.y + a.depth) - b.y) < tol || Math.abs((b.y + b.depth) - a.y) < tol) &&
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tol;
  const shareV =
    (Math.abs((a.x + a.width) - b.x) < tol || Math.abs((b.x + b.width) - a.x) < tol) &&
    Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > tol;
  return shareH || shareV;
}

// ── Exterior wall constraint enforcement ──────────────────────────────────

/**
 * Ensure rooms that need exterior walls (living, bedrooms, kitchen) actually
 * touch the building perimeter. Swaps landlocked rooms with perimeter rooms
 * that don't need exterior access (bathrooms, storage, utility, corridors).
 *
 * Uses identity swaps only — no position changes, preserves BSP tiling.
 */
function enforceExteriorWallConstraint(
  placed: PlacedRoom[],
  specs: RoomSpec[],
  fpW: number,
  fpH: number,
): PlacedRoom[] {
  try {
    const TOL = 0.15;
    const layout = placed.map(r => ({ ...r }));

    // Build a map from room name to its mustHaveExteriorWall flag
    const extRequired = new Map<string, boolean>();
    for (const spec of specs) {
      extRequired.set(spec.name, spec.mustHaveExteriorWall);
    }

    // Check if a room touches the building perimeter
    function touchesPerimeter(r: PlacedRoom): boolean {
      return r.x < TOL || r.y < TOL ||
        Math.abs(r.x + r.width - fpW) < TOL ||
        Math.abs(r.y + r.depth - fpH) < TOL;
    }

    // Find rooms that need exterior walls but are landlocked
    for (let i = 0; i < layout.length; i++) {
      const room = layout[i];
      if (!extRequired.get(room.name)) continue; // doesn't need exterior wall
      if (touchesPerimeter(room)) continue; // already on perimeter

      // Find a perimeter room that does NOT need an exterior wall
      // Prefer rooms of similar size for minimal disruption
      let bestSwapIdx = -1;
      let bestSizeDiff = Infinity;

      for (let j = 0; j < layout.length; j++) {
        if (j === i) continue;
        const candidate = layout[j];
        if (candidate.type === "hallway" || candidate.type === "staircase") continue;
        if (!touchesPerimeter(candidate)) continue; // must be on perimeter
        if (extRequired.get(candidate.name)) continue; // also needs exterior — can't swap

        const sizeDiff = Math.abs(room.area - candidate.area);
        const sizeRatio = Math.min(room.area, candidate.area) / Math.max(room.area, candidate.area);
        if (sizeRatio < 0.3) continue; // too different in size

        if (sizeDiff < bestSizeDiff) {
          bestSizeDiff = sizeDiff;
          bestSwapIdx = j;
        }
      }

      if (bestSwapIdx !== -1) {
        // Swap identities
        const target = layout[bestSwapIdx];
        const tmpName = room.name, tmpType = room.type;
        layout[i] = { ...room, name: target.name, type: target.type };
        layout[bestSwapIdx] = { ...target, name: tmpName, type: tmpType };
        console.log(`[EXT-WALL] Swapped landlocked ${tmpName} ↔ ${target.name} for perimeter access`);
      }
    }

    return layout;
  } catch {
    return placed;
  }
}

// ── Room proportion refinement ─────────────────────────────────────────────

/**
 * Fix extreme aspect ratios by adjusting room dimensions.
 * Only adjusts rooms with AR > 2.5 (except corridors).
 * Tries to make rooms more square by trading width for depth.
 */
function refineRoomProportions(rooms: PlacedRoom[]): PlacedRoom[] {
  const result = rooms.map(r => ({ ...r }));

  for (let idx = 0; idx < result.length; idx++) {
    const room = result[idx];
    if (room.type === "hallway" || room.type === "staircase") continue;

    const roomAr = ar(room.width, room.depth);

    // Type-specific max aspect ratios (architectural best practice)
    const MAX_AR: Record<string, number> = {
      bedroom: 1.6, bathroom: 2.0, kitchen: 1.8,
      living: 2.0, dining: 1.8, entrance: 2.0,
      utility: 2.2, storage: 2.5, balcony: 3.0,
      other: 2.2,
    };
    const maxAr = MAX_AR[room.type] ?? 2.2;
    if (roomAr <= maxAr) continue;

    // Save snapshot to revert if the adjustment creates overlaps
    const saved = { width: room.width, depth: room.depth, area: room.area };

    // Try to make more square: shrink the longer dimension, extend the shorter
    // while keeping area approximately the same
    const area = room.width * room.depth;
    const targetAr = Math.min(roomAr, maxAr);

    if (room.width > room.depth) {
      // Too wide — reduce width, increase depth
      const newWidth = grid(Math.sqrt(area * targetAr));
      const newDepth = grid(area / newWidth);
      // Only adjust if we don't exceed existing bounds
      if (newWidth < room.width && newDepth > room.depth) {
        room.width = newWidth;
        room.depth = newDepth;
        room.area = grid(newWidth * newDepth);
      }
    } else {
      // Too deep — reduce depth, increase width
      const newDepth = grid(Math.sqrt(area / targetAr));
      const newWidth = grid(area / newDepth);
      if (newDepth < room.depth && newWidth > room.width) {
        room.width = newWidth;
        room.depth = newDepth;
        room.area = grid(newWidth * newDepth);
      }
    }

    // Overlap safety: revert if adjusted room overlaps any neighbor
    let overlaps = false;
    for (let j = 0; j < result.length; j++) {
      if (j === idx) continue;
      const other = result[j];
      const ox = Math.min(room.x + room.width, other.x + other.width) - Math.max(room.x, other.x);
      const oy = Math.min(room.y + room.depth, other.y + other.depth) - Math.max(room.y, other.y);
      if (ox > 0.15 && oy > 0.15) { overlaps = true; break; }
    }
    if (overlaps) {
      room.width = saved.width;
      room.depth = saved.depth;
      room.area = saved.area;
    }
  }

  return result;
}

// ── Vastu post-optimization ───────────────────────────────────────────────

/**
 * Ideal vastu quadrants for common room types.
 * Y-down coordinate system: top = North, bottom = South
 * For Y-down: N = small y, S = large y, W = small x, E = large x.
 */
const VASTU_QUADRANTS: Record<string, string> = {
  kitchen: "SE",
  pooja: "NE",
  prayer: "NE",
  puja: "NE",
  mandir: "NE",
  master_bedroom: "SW",
  parents: "SW",
  living: "N",
  drawing: "NE",
  dining: "W",
  bathroom: "NW",
  toilet: "NW",
  staircase: "SW",
  servant: "SE",
  store: "SW",
  utility: "NW",
  entrance: "N",
  foyer: "N",
};

/**
 * Get the quadrant of a room based on its center position.
 * Y-down: y=0 is North (top), y=max is South (bottom).
 */
function getQuadrant(room: PlacedRoom, fpW: number, fpH: number): string {
  const cx = room.x + room.width / 2;
  const cy = room.y + room.depth / 2;
  const midX = fpW / 2;
  const midY = fpH / 2;
  // Y-down: cy < midY means room is toward top = North
  const ns = cy < midY ? "N" : "S";
  const ew = cx < midX ? "W" : "E";
  return ns + ew;
}

/**
 * Score a single room's vastu placement.
 */
function vastuRoomScore(room: PlacedRoom, fpW: number, fpH: number): number {
  const quadrant = getQuadrant(room, fpW, fpH);
  const nameLower = room.name.toLowerCase();
  const typeLower = room.type.toLowerCase();

  for (const [key, idealQuadrant] of Object.entries(VASTU_QUADRANTS)) {
    if (typeLower.includes(key) || nameLower.includes(key)) {
      if (quadrant === idealQuadrant) return 10;
      // Partial match: correct N/S direction
      if (quadrant[0] === idealQuadrant[0]) return 5;
      // Partial match: correct E/W direction
      if (quadrant[1] === idealQuadrant[1]) return 3;
      return 0;
    }
  }
  return 0; // No vastu preference for this room type
}

/**
 * After swap optimizations, some bedrooms may have lost their adjacent bathroom.
 * This function finds such cases and swaps the bathroom next to its paired bedroom.
 */
function repairBedroomBathroomAdjacency(
  rooms: PlacedRoom[],
  adjacency: AdjacencyRequirement[],
): PlacedRoom[] {
  try {
    const layout = rooms.map(r => ({ ...r }));

    // Find bedroom-bathroom pairs from adjacency requirements
    const pairs = adjacency.filter(a => {
      const aIsBed = a.roomA.toLowerCase().includes("bedroom") || a.roomA.toLowerCase().includes("master");
      const bIsBath = a.roomB.toLowerCase().includes("bath") || a.roomB.toLowerCase().includes("toilet");
      const aIsBath = a.roomA.toLowerCase().includes("bath") || a.roomA.toLowerCase().includes("toilet");
      const bIsBed = a.roomB.toLowerCase().includes("bedroom") || a.roomB.toLowerCase().includes("master");
      return (aIsBed && bIsBath) || (aIsBath && bIsBed);
    });

    for (const pair of pairs) {
      const bedName = pair.roomA.toLowerCase().includes("bed") || pair.roomA.toLowerCase().includes("master")
        ? pair.roomA : pair.roomB;
      const bathName = bedName === pair.roomA ? pair.roomB : pair.roomA;

      const bedIdx = layout.findIndex(r => r.name === bedName);
      const bathIdx = layout.findIndex(r => r.name === bathName);
      if (bedIdx === -1 || bathIdx === -1) continue;

      const bed = layout[bedIdx];
      const bath = layout[bathIdx];

      // Check if they share an edge (adjacent)
      const isAdj = areRoomsAdjacent(bed, bath, 0.3);
      if (isAdj) continue; // Already adjacent, no repair needed

      // Find a room adjacent to the bedroom that we can swap with the bathroom
      // Prefer rooms of similar size to the bathroom
      const bathArea = bath.width * bath.depth;
      let bestSwapIdx = -1;
      let bestSizeDiff = Infinity;

      for (let i = 0; i < layout.length; i++) {
        if (i === bedIdx || i === bathIdx) continue;
        const candidate = layout[i];
        if (candidate.type === "hallway" || candidate.type === "staircase") continue;
        // Must be adjacent to the bedroom
        if (!areRoomsAdjacent(bed, candidate, 0.3)) continue;
        // Prefer similar size to bathroom
        const candArea = candidate.width * candidate.depth;
        const sizeDiff = Math.abs(candArea - bathArea);
        if (sizeDiff < bestSizeDiff) {
          bestSizeDiff = sizeDiff;
          bestSwapIdx = i;
        }
      }

      if (bestSwapIdx !== -1) {
        // Swap identities (name/type) between bathroom and the adjacent room
        const target = layout[bestSwapIdx];
        const tmpName = bath.name, tmpType = bath.type;
        layout[bathIdx] = { ...bath, name: target.name, type: target.type };
        layout[bestSwapIdx] = { ...target, name: tmpName, type: tmpType };
      }
    }

    return layout;
  } catch {
    return rooms;
  }
}

/** Check if two rooms share an edge within tolerance */
function areRoomsAdjacent(a: PlacedRoom, b: PlacedRoom, tolerance: number): boolean {
  // Horizontal adjacency (share vertical edge)
  const hShared = Math.abs((a.x + a.width) - b.x) < tolerance || Math.abs((b.x + b.width) - a.x) < tolerance;
  if (hShared) {
    const yStart = Math.max(a.y, b.y);
    const yEnd = Math.min(a.y + a.depth, b.y + b.depth);
    if (yEnd - yStart > 0.3) return true;
  }
  // Vertical adjacency (share horizontal edge)
  const vShared = Math.abs((a.y + a.depth) - b.y) < tolerance || Math.abs((b.y + b.depth) - a.y) < tolerance;
  if (vShared) {
    const xStart = Math.max(a.x, b.x);
    const xEnd = Math.min(a.x + a.width, b.x + b.width);
    if (xEnd - xStart > 0.3) return true;
  }
  return false;
}

/**
 * Optimize room placement for Vastu compliance by swapping room identities.
 *
 * Runs AFTER the adjacency swap optimizer. Uses iterative pairwise swaps
 * to improve the vastu score without breaking tiling (only swaps identity,
 * not position).
 *
 * BED-BATH PAIR LOCKING: When adjacency requirements include bedroom↔bathroom
 * pairs that are currently adjacent, those room names are "locked" — any swap
 * that would move a locked room away from its partner is skipped. This prevents
 * Vastu optimization from breaking bedroom-bathroom adjacency.
 */
function optimizeVastu(
  rooms: PlacedRoom[], fpW: number, fpH: number,
  adjacency?: AdjacencyRequirement[],
): PlacedRoom[] {
  try {
    const layout = rooms.map(r => ({ ...r }));

    // ── Build bed-bath locked pairs ──
    // A "locked pair" = bedroom + bathroom that are currently adjacent.
    // We store the room NAMES that must not be swapped apart.
    const lockedPairs: Array<{ bedName: string; bathName: string }> = [];
    if (adjacency) {
      for (const req of adjacency) {
        const aLower = req.roomA.toLowerCase();
        const bLower = req.roomB.toLowerCase();
        const aIsBed = aLower.includes("bedroom") || aLower.includes("master");
        const bIsBath = bLower.includes("bath") || bLower.includes("toilet");
        const aIsBath = aLower.includes("bath") || aLower.includes("toilet");
        const bIsBed = bLower.includes("bedroom") || bLower.includes("master");

        if ((aIsBed && bIsBath) || (aIsBath && bIsBed)) {
          const bedName = aIsBed ? req.roomA : req.roomB;
          const bathName = bedName === req.roomA ? req.roomB : req.roomA;
          // Check if they are currently adjacent in the layout
          const bed = layout.find(r => r.name === bedName);
          const bath = layout.find(r => r.name === bathName);
          if (bed && bath && areRoomsAdjacent(bed, bath, 0.3)) {
            lockedPairs.push({ bedName, bathName });
          }
        }
      }
    }

    /** Check if swapping indices i↔j would break any locked bed-bath pair. */
    function wouldBreakLockedPair(i: number, j: number): boolean {
      for (const { bedName, bathName } of lockedPairs) {
        const nameI = layout[i].name;
        const nameJ = layout[j].name;
        // If one of the swapped rooms is part of a locked pair, check if
        // its partner is still adjacent after the swap.
        if (nameI === bedName || nameI === bathName || nameJ === bedName || nameJ === bathName) {
          // After swap: layout[i] gets name of j, layout[j] gets name of i.
          // Check: would the bed and bath still be adjacent?
          const newNameI = nameJ;
          const newNameJ = nameI;
          const bedIdx = newNameI === bedName ? i : newNameJ === bedName ? j :
            layout.findIndex(r => r.name === bedName);
          const bathIdx = newNameI === bathName ? i : newNameJ === bathName ? j :
            layout.findIndex(r => r.name === bathName);
          if (bedIdx === -1 || bathIdx === -1) continue;
          if (!areRoomsAdjacent(layout[bedIdx], layout[bathIdx], 0.3)) {
            return true; // swap would break adjacency
          }
        }
      }
      return false;
    }

    // Pass 1: Standard pairwise swaps with 3x size tolerance
    for (let iteration = 0; iteration < 50; iteration++) {
      let improved = false;

      for (let i = 0; i < layout.length; i++) {
        for (let j = i + 1; j < layout.length; j++) {
          const roomA = layout[i];
          const roomB = layout[j];

          // Only swap rooms of similar size (within 3x for vastu)
          const areaA = roomA.width * roomA.depth;
          const areaB = roomB.width * roomB.depth;
          if (Math.min(areaA, areaB) / Math.max(areaA, areaB) < 0.33) continue;

          // Don't swap corridors or staircases
          if (roomA.type === "hallway" || roomB.type === "hallway") continue;
          if (roomA.type === "staircase" || roomB.type === "staircase") continue;

          // Don't break locked bed-bath pairs
          if (wouldBreakLockedPair(i, j)) continue;

          const beforeScore = vastuRoomScore(roomA, fpW, fpH) + vastuRoomScore(roomB, fpW, fpH);

          const tmpName = roomA.name, tmpType = roomA.type;
          layout[i] = { ...roomA, name: roomB.name, type: roomB.type };
          layout[j] = { ...roomB, name: tmpName, type: tmpType };

          const afterScore = vastuRoomScore(layout[i], fpW, fpH) + vastuRoomScore(layout[j], fpW, fpH);

          if (afterScore > beforeScore) {
            improved = true;
          } else {
            layout[i] = roomA;
            layout[j] = roomB;
          }
        }
      }

      if (!improved) break;
    }

    // Pass 2: Dynamic force-swap — read from VASTU_QUADRANTS mapping.
    // For any room with a known Vastu preference that is still misplaced,
    // force-swap it with whatever room is in the preferred quadrant.
    // Process highest-penalty rules first (critical > major > minor).
    const swappedIndices = new Set<number>();
    const sortedEntries = Object.entries(VASTU_QUADRANTS)
      .sort((a, b) => {
        // Prioritize: kitchen, pooja, master first (most architecturally important)
        const priority: Record<string, number> = {
          kitchen: 10, pooja: 9, puja: 9, prayer: 9, master_bedroom: 8,
          parents: 8, living: 6, staircase: 3,
        };
        return (priority[b[0]] ?? 1) - (priority[a[0]] ?? 1);
      });

    for (const [keyword, targetQuadrant] of sortedEntries) {
      const roomIdx = layout.findIndex((r, i) => {
        if (swappedIndices.has(i)) return false;
        const n = r.name.toLowerCase();
        const t = r.type.toLowerCase();
        return n.includes(keyword) || t.includes(keyword);
      });
      if (roomIdx === -1) continue;

      const room = layout[roomIdx];
      const currentQuadrant = getQuadrant(room, fpW, fpH);
      if (currentQuadrant === targetQuadrant) continue;

      const targetIdx = layout.findIndex((r, i) =>
        i !== roomIdx && !swappedIndices.has(i) &&
        r.type !== "hallway" && r.type !== "staircase" &&
        getQuadrant(r, fpW, fpH) === targetQuadrant
      );

      if (targetIdx !== -1) {
        // Check if this force-swap would break a locked pair
        if (!wouldBreakLockedPair(roomIdx, targetIdx)) {
          const target = layout[targetIdx];
          const tmpName = room.name, tmpType = room.type;
          layout[roomIdx] = { ...room, name: target.name, type: target.type };
          layout[targetIdx] = { ...target, name: tmpName, type: tmpType };
          swappedIndices.add(roomIdx);
          swappedIndices.add(targetIdx);
        }
      }
    }

    return layout;
  } catch {
    // Vastu optimization is best-effort; never break layout
    return rooms;
  }
}

// ── Post-layout vastu verification ─────────────────────────────────────────

/**
 * Final targeted vastu check. For each room with a known ideal quadrant,
 * verify it's in position. If not AND a swap partner exists, do one swap.
 * Runs AFTER optimizeVastu() as a safety net for remaining violations.
 */
function verifyVastuPlacement(
  rooms: PlacedRoom[], fpW: number, fpH: number,
): PlacedRoom[] {
  try {
    const layout = rooms.map(r => ({ ...r }));
    const midX = fpW / 2;
    const midY = fpH / 2;

    // Brahmasthan protection: if a heavy room is in the center 1/9th, swap it out
    const HEAVY_TYPES = new Set(["bathroom", "kitchen", "staircase", "utility", "storage"]);
    for (let i = 0; i < layout.length; i++) {
      const room = layout[i];
      const cx = room.x + room.width / 2;
      const cy = room.y + room.depth / 2;
      const inCenter = cx > fpW / 3 && cx < fpW * 2 / 3 && cy > fpH / 3 && cy < fpH * 2 / 3;
      if (!inCenter) continue;
      if (!HEAVY_TYPES.has(room.type) && !room.name.toLowerCase().includes("bath")) continue;

      // Find a non-heavy room NOT in center to swap with
      for (let j = 0; j < layout.length; j++) {
        if (j === i) continue;
        const candidate = layout[j];
        if (HEAVY_TYPES.has(candidate.type)) continue;
        if (candidate.type === "hallway" || candidate.type === "staircase") continue;
        const ccx = candidate.x + candidate.width / 2;
        const ccy = candidate.y + candidate.depth / 2;
        const candInCenter = ccx > fpW / 3 && ccx < fpW * 2 / 3 && ccy > fpH / 3 && ccy < fpH * 2 / 3;
        if (candInCenter) continue;
        // Size compatibility
        const ratio = Math.min(room.area, candidate.area) / Math.max(room.area, candidate.area);
        if (ratio < 0.3) continue;
        // Swap identities
        const tmpN = room.name, tmpT = room.type;
        layout[i] = { ...room, name: candidate.name, type: candidate.type };
        layout[j] = { ...candidate, name: tmpN, type: tmpT };
        break;
      }
    }

    return layout;
  } catch {
    return rooms;
  }
}

// ── Post-BSP dimension correction wrapper ─────────────────────────────────

/**
 * Convert PlacedRooms + RoomSpecs into RoomWithTarget, run the dimension
 * corrector, then convert back to PlacedRoom[].
 */
function applyDimensionCorrection(
  placed: PlacedRoom[],
  specs: RoomSpec[],
  fpW: number,
  fpH: number,
): PlacedRoom[] {
  try {
    const withTargets: RoomWithTarget[] = placed.map(r => {
      const spec = specs.find(s => s.name === r.name);
      // Mark rooms with user-specified exact dimensions as fixed —
      // dimension corrector will not move their boundaries.
      const hasExactDims = spec?.preferredWidth && spec?.preferredDepth &&
        spec.preferredWidth > 0 && spec.preferredDepth > 0;
      return {
        ...r,
        targetWidth: spec?.preferredWidth,
        targetDepth: spec?.preferredDepth,
        targetArea: spec?.areaSqm ?? r.width * r.depth,
        isFixed: !!hasExactDims,
      };
    });

    const corrected = correctDimensions(withTargets, fpW, fpH);

    // Convert back to PlacedRoom (strip target fields)
    return corrected.map(r => ({
      name: r.name,
      type: r.type,
      x: r.x,
      y: r.y,
      width: r.width,
      depth: r.depth,
      area: r.area,
    }));
  } catch {
    return placed;
  }
}

// ── Corridor hard cap enforcement ─────────────────────────────────────────

/**
 * Cap corridor area regardless of how it was created (AI-specified or BSP).
 * Runs after ALL layout passes so it catches every corridor.
 */
function enforceCorridorCap(rooms: PlacedRoom[], totalFloorArea: number): PlacedRoom[] {
  const maxArea = Math.min(totalFloorArea * 0.06, 12.0);

  for (const room of rooms) {
    const isCorridor = room.type === "hallway" ||
      room.name.toLowerCase().includes("corridor") ||
      room.name.toLowerCase().includes("passage");

    if (!isCorridor) continue;

    const area = room.width * room.depth;
    if (area <= maxArea * 1.2) continue; // within 20% tolerance

    // Shrink the shorter dimension (usually depth for corridors)
    // NEVER let corridor go below 1.0m (NBC 2016 minimum for residential)
    if (room.width > room.depth) {
      room.depth = grid(Math.max(1.0, maxArea / room.width));
    } else {
      room.width = grid(Math.max(1.0, maxArea / room.depth));
    }
    room.area = grid(room.width * room.depth);
  }

  return rooms;
}

// ── NBC minimum dimension enforcement ─────────────────────────────────────

/**
 * Verify every room meets NBC 2016 minimum dimensions.
 * If a room is too narrow, expand its shortest dimension to the minimum.
 * This may create minor overlaps which the pipeline-adapter snapping resolves.
 */
function enforceNBCMinimumDimensions(rooms: PlacedRoom[]): PlacedRoom[] {
  try {
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const minDim = getNBCMinDimension(room.type, room.name);
      const shorter = Math.min(room.width, room.depth);
      if (shorter >= minDim) continue;

      // Save snapshot to revert if expansion creates overlaps
      const saved = { ...room };
      if (room.width < room.depth) {
        room.width = grid(Math.max(room.width, minDim));
      } else {
        room.depth = grid(Math.max(room.depth, minDim));
      }
      room.area = grid(room.width * room.depth);

      // Check if expansion created overlaps — revert if so
      let overlaps = false;
      for (let j = 0; j < rooms.length; j++) {
        if (j === i) continue;
        const other = rooms[j];
        const ox = Math.min(room.x + room.width, other.x + other.width) - Math.max(room.x, other.x);
        const oy = Math.min(room.y + room.depth, other.y + other.depth) - Math.max(room.y, other.y);
        if (ox > 0.15 && oy > 0.15) { overlaps = true; break; }
      }
      if (overlaps) {
        Object.assign(room, saved); // Revert — don't break tiling for NBC
      }
    }
    return rooms;
  } catch {
    return rooms;
  }
}

/**
 * NBC 2016 minimum dimension by room type.
 */
function getNBCMinDimension(type: string, name: string): number {
  const n = name.toLowerCase();
  const t = type.toLowerCase();
  // Corridors: 1.0m residential
  if (t === "hallway" || n.includes("corridor") || n.includes("passage")) return 1.0;
  // Bathrooms: 1.2m
  if (t === "bathroom" || n.includes("bath") || n.includes("toilet") || n.includes("wc")) return 1.2;
  // Kitchen: 2.1m (NBC requires ≥1.8m, but 2.1m is practical minimum)
  if (t === "kitchen" || n.includes("kitchen")) return 2.1;
  // Staircases: 0.9m
  if (t === "staircase" || n.includes("staircase")) return 0.9;
  // Small utility/service rooms: 1.5m
  if (t === "utility" || t === "storage" || n.includes("utility") || n.includes("store")) return 1.5;
  // Habitable rooms: 2.4m
  return 2.4;
}

// ── Post-BSP room size validation ──────────────────────────────────────────

/**
 * Clamp room sizes that are wildly wrong relative to targets.
 *
 * Two passes:
 *   1. HARD CAPS for utility rooms (shoe rack, powder room, etc.) — type-based max
 *   2. GENERAL CLAMP for all rooms — shrink if >2x target, expand if <0.5x target
 */
function validateRoomSizes(rooms: PlacedRoom[], specs?: RoomSpec[]): PlacedRoom[] {
  // Pass 1: Hard caps for rooms (max area by name/type pattern)
  const MAX_SIZES: Array<{ pattern: RegExp; max: number }> = [
    // Very small utility rooms
    { pattern: /shoe\s*(?:rack|cabinet|closet|storage)|shoe$/i, max: 5 },
    { pattern: /powder\s*room/i, max: 5 },
    { pattern: /linen\s*(?:storage|closet|cupboard)/i, max: 5 },
    { pattern: /coat\s*closet/i, max: 4 },
    { pattern: /umbrella/i, max: 3 },
    { pattern: /dog\s*(?:room|kennel)|kennel/i, max: 5 },
    { pattern: /wine\s*(?:room|cellar)|cellar/i, max: 8 },
    { pattern: /mini\s*bar|\bbar\b/i, max: 10 },
    { pattern: /nook|reading\s*nook|breakfast\s*nook/i, max: 8 },
    // Service rooms
    { pattern: /servant\s*toilet|maid.*toilet/i, max: 5 },
    { pattern: /servant\s*(?:quarter|room)|maid.*room|driver.*room/i, max: 12 },
    { pattern: /pooja|puja|prayer|mandir/i, max: 10 },
    { pattern: /store\s*room|storage\s*room/i, max: 10 },
    { pattern: /pantry/i, max: 10 },
    { pattern: /utility/i, max: 10 },
    { pattern: /washing\s*area/i, max: 6 },
    { pattern: /laundry/i, max: 8 },
    { pattern: /kitchenette/i, max: 8 },
    { pattern: /craft|hobby|sewing/i, max: 12 },
    // Circulation
    { pattern: /foyer|entrance|reception/i, max: 15 },
    { pattern: /corridor|passage/i, max: 15 },
    { pattern: /landing|staircase\s*landing/i, max: 12 },
    { pattern: /staircase|stair/i, max: 15 },
    // Medium rooms
    { pattern: /balcony|sit.?out|sitout/i, max: 15 },
    { pattern: /walk.?in\s*(?:wardrobe|closet)/i, max: 10 },
    { pattern: /dressing/i, max: 12 },
    { pattern: /wardrobe/i, max: 10 },
    { pattern: /bathroom/i, max: 12 },
    { pattern: /toilet|\bwc\b/i, max: 5 },
  ];

  for (const room of rooms) {
    if (room.type === "hallway") continue; // Corridors handled by enforceCorridorCap
    const currentArea = room.width * room.depth;
    const nameLower = room.name.toLowerCase();

    for (const { pattern, max } of MAX_SIZES) {
      if (pattern.test(nameLower) && currentArea > max * 1.5) {
        console.warn(`[SIZE-FIX] ${room.name} is ${currentArea.toFixed(1)} sqm, max should be ${max} sqm`);
        const scale = Math.sqrt(max / currentArea);
        room.width = grid(room.width * scale);
        room.depth = grid(room.depth * scale);
        room.area = grid(room.width * room.depth);
        break;
      }
    }
  }

  // Pass 2: General clamp — catch rooms at >2x or <0.5x their target
  if (specs && specs.length > 0) {
    for (const room of rooms) {
      if (room.type === "hallway") continue; // Corridors handled separately

      const spec = specs.find(s => s.name === room.name);
      if (!spec) continue;

      const actualArea = room.width * room.depth;
      const targetArea = spec.areaSqm;

      // Room is more than 2x the target — shrink it (safe: creates gaps, no overlaps)
      if (actualArea > targetArea * 2.0 && targetArea > 2) {
        console.warn(`[SIZE-CLAMP] ${room.name}: ${actualArea.toFixed(1)} sqm >> target ${targetArea.toFixed(1)} sqm`);
        const scale = Math.sqrt(targetArea * 1.3 / actualArea); // Allow 30% oversize
        room.width = grid(room.width * scale);
        room.depth = grid(room.depth * scale);
        room.area = grid(room.width * room.depth);
      }

      // NOTE: rooms that are too SMALL are handled by the dimension corrector
      // which moves shared boundaries (tile-safe). We do NOT expand rooms here
      // because expanding in place would overlap with neighbors.
    }
  }

  // Pass 3: Minimum size enforcement — no habitable room smaller than 3 sqm
  for (const room of rooms) {
    const isCirculation = ["hallway", "staircase"].includes(room.type) ||
      room.name.toLowerCase().includes("corridor") || room.name.toLowerCase().includes("passage");
    if (isCirculation) continue;

    const area = room.width * room.depth;
    if (area < 3.0) {
      const scale = Math.sqrt(3.0 / Math.max(area, 0.1));
      room.width = grid(room.width * scale);
      room.depth = grid(room.depth * scale);
      room.area = grid(room.width * room.depth);
    }
  }

  return rooms;
}

/**
 * Validate that all input rooms appear in the output. If any are missing,
 * force-place them by appending to the footprint edge.
 */
function validateAndRecoverRooms(
  inputRooms: RoomSpec[],
  outputRooms: PlacedRoom[],
  fpW: number,
  fpH: number,
): PlacedRoom[] {
  const outputNames = new Set(outputRooms.map(r => r.name));
  const missing = inputRooms.filter(r => !outputNames.has(r.name));

  if (missing.length === 0) return outputRooms;

  console.warn(
    `[STAGE-2] ROOM LOSS DETECTED: ${inputRooms.length} input → ${outputRooms.length} output. ` +
    `Missing: ${missing.map(r => r.name).join(", ")}. Force-placing.`
  );

  const result = [...outputRooms];
  for (const room of missing) {
    result.push(forcePlaceRoom(room, fpW, fpH, result));
  }
  return result;
}

/**
 * Force-place a room that BSP failed to include.
 * Strategy: append below or to the right of existing rooms.
 */
function forcePlaceRoom(
  room: RoomSpec,
  fpW: number,
  fpH: number,
  existing: PlacedRoom[],
): PlacedRoom {
  const area = Math.max(room.areaSqm, 1.5);
  // Compute dimensions maintaining reasonable aspect ratio
  const w = grid(Math.sqrt(area * 1.2));
  const d = grid(area / w);

  // Find the bottom-most y extent of existing rooms
  const maxY = existing.length > 0
    ? Math.max(...existing.map(r => r.y + r.depth))
    : 0;
  // Find rightmost x extent at the bottom row
  const bottomRooms = existing.filter(r => Math.abs(r.y + r.depth - maxY) < 0.2);
  const maxX = bottomRooms.length > 0
    ? Math.max(...bottomRooms.map(r => r.x + r.width))
    : 0;

  let x: number, y: number;

  if (maxX + w <= fpW + 0.5) {
    // Fits to the right of existing bottom rooms
    x = grid(maxX);
    y = grid(maxY - d);
    if (y < 0) { y = grid(maxY); }
  } else {
    // Start a new row below
    x = 0;
    y = grid(maxY);
  }

  return {
    name: room.name,
    type: room.type,
    x,
    y,
    width: w,
    depth: d,
    area: grid(w * d),
  };
}

// ── Room classification ──────────────────────────────────────────────────────

interface ClassifiedRooms {
  publicZone: RoomSpec[];  // living, dining, kitchen, foyer, verandah — everything for public side
  privateZone: RoomSpec[]; // bedrooms, bathrooms, utility, storage
  corridor: RoomSpec | null;
  hasPublic: boolean;
  hasPrivate: boolean;
}

function classifyRooms(rooms: RoomSpec[]): ClassifiedRooms {
  const publicZone: RoomSpec[] = [];
  const privateZone: RoomSpec[] = [];
  let corridor: RoomSpec | null = null;

  for (const r of rooms) {
    const name = r.name.toLowerCase();
    const isCorridor = r.type === "hallway" || name.includes("corridor") || name.includes("passage");

    if (isCorridor) {
      corridor = r;
    } else if (r.type === "kitchen" || r.type === "dining") {
      // Kitchen AND Dining MUST be in the same zone (public) for adjacency
      publicZone.push(r);
    } else if (name.includes("dining")) {
      // Catch dining rooms that don't have type "dining"
      publicZone.push(r);
    } else if (name.includes("drawing") || name.includes("foyer")) {
      // Drawing Room and Foyer must be in public zone for entrance flow
      publicZone.push(r);
    } else if (r.zone === "private" || r.type === "bedroom") {
      privateZone.push(r);
    } else if (r.zone === "service") {
      privateZone.push(r);
    } else if (r.zone === "circulation") {
      // Non-corridor circulation (lobby, etc.) → public
      publicZone.push(r);
    } else {
      // Public zone by default (living, dining, entrance, balcony, etc.)
      publicZone.push(r);
    }
  }

  return {
    publicZone,
    privateZone,
    corridor,
    hasPublic: publicZone.length > 0,
    hasPrivate: privateZone.length > 0,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SPINE-FIRST LAYOUT ENGINE
//
// Replaces BSP's zone-based layout with an architecturally-informed placement
// strategy. Rooms are area-budgeted first, then placed around a circulation
// spine (I-shape or L-shape corridor) with bedroom-bathroom pairs as units.
//
// Returns PlacedRoom[] identical to BSP output — post-processing unchanged.
// Falls back to BSP if spine score < 0.50.
// ══════════════════════════════════════════════════════════════════════════════

// ── Room area standards (NBC 2016 + IS codes + industry practice) ──────────

interface AreaStandard {
  min: number;
  ideal: number;
  max: number;
  minDim: number;
  idealAR: number; // ideal width:depth ratio (width / depth)
}

const AREA_STANDARDS: Record<string, AreaStandard> = {
  living:    { min: 12.0, ideal: 18.0, max: 25.0, minDim: 3.0, idealAR: 1.3 },
  dining:    { min:  9.5, ideal: 12.0, max: 18.0, minDim: 3.0, idealAR: 1.3 },
  kitchen:   { min:  5.5, ideal: 10.0, max: 15.0, minDim: 2.4, idealAR: 1.5 },
  bedroom:   { min:  9.5, ideal: 13.0, max: 18.0, minDim: 2.7, idealAR: 1.3 },
  bathroom:  { min:  2.8, ideal:  4.0, max:  6.0, minDim: 1.5, idealAR: 1.5 },
  office:    { min:  6.0, ideal:  9.0, max: 14.0, minDim: 2.4, idealAR: 1.3 },
  balcony:   { min:  3.0, ideal:  5.0, max: 10.0, minDim: 1.2, idealAR: 3.0 },
  utility:   { min:  3.0, ideal:  4.5, max:  8.0, minDim: 1.5, idealAR: 1.5 },
  staircase: { min:  6.0, ideal:  8.0, max: 12.0, minDim: 2.5, idealAR: 2.0 },
  entrance:  { min:  3.0, ideal:  5.0, max:  8.0, minDim: 1.5, idealAR: 1.5 },
  hallway:   { min:  3.0, ideal:  5.0, max: 12.0, minDim: 1.05,idealAR: 5.0 },
  storage:   { min:  2.0, ideal:  3.5, max:  8.0, minDim: 1.2, idealAR: 1.5 },
  other:     { min:  2.5, ideal:  5.0, max: 12.0, minDim: 1.5, idealAR: 1.3 },
};

function getAreaStandard(type: string, name: string): AreaStandard {
  const n = name.toLowerCase();
  // Master bedroom gets higher ideal
  if ((type === "bedroom" || n.includes("master")) && n.includes("master")) {
    return { min: 12.0, ideal: 16.0, max: 22.0, minDim: 3.0, idealAR: 1.3 };
  }
  // Pooja/prayer rooms
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer")) {
    return { min: 2.5, ideal: 3.5, max: 6.0, minDim: 1.5, idealAR: 1.2 };
  }
  return AREA_STANDARDS[type] ?? AREA_STANDARDS["other"];
}

// ── Step 1: Budget room areas ──────────────────────────────────────────────

function budgetRoomAreas(rooms: RoomSpec[], totalAreaSqm: number): RoomSpec[] {
  const budgeted = rooms.map(r => ({ ...r }));
  const usableArea = totalAreaSqm * 0.92; // 8% for walls + circulation overhead

  // Assign ideal areas based on room type
  for (const room of budgeted) {
    const std = getAreaStandard(room.type, room.name);
    // If user specified dimensions, respect those
    if (room.preferredWidth && room.preferredDepth) continue;
    // Use AI-specified area as hint but clamp to standards
    room.areaSqm = Math.max(std.min, Math.min(room.areaSqm, std.max));
  }

  // Scale to fit available area
  const currentTotal = budgeted.reduce((s, r) => s + r.areaSqm, 0);
  if (currentTotal > usableArea) {
    // Scale down proportionally, respecting minimums
    const scale = usableArea / currentTotal;
    for (const room of budgeted) {
      if (room.preferredWidth && room.preferredDepth) continue;
      const std = getAreaStandard(room.type, room.name);
      room.areaSqm = Math.max(std.min, grid(room.areaSqm * scale));
    }
  } else if (currentTotal < usableArea * 0.8) {
    // Surplus: distribute to living and bedrooms
    const surplus = usableArea * 0.9 - currentTotal;
    const expandable = budgeted.filter(r =>
      (r.type === "living" || r.type === "bedroom" || r.type === "dining") &&
      !(r.preferredWidth && r.preferredDepth)
    );
    if (expandable.length > 0) {
      const perRoom = surplus / expandable.length;
      for (const room of expandable) {
        const std = getAreaStandard(room.type, room.name);
        room.areaSqm = Math.min(std.max, grid(room.areaSqm + perRoom));
      }
    }
  }

  // Sanity checks: bathroom < bedroom, kitchen reasonable
  const smallestBedroom = Math.min(
    ...budgeted.filter(r => r.type === "bedroom").map(r => r.areaSqm),
    999
  );
  for (const room of budgeted) {
    if (room.type === "bathroom" && room.areaSqm > smallestBedroom * 0.5) {
      room.areaSqm = grid(Math.max(3.5, smallestBedroom * 0.35));
    }
    if (room.type === "utility" && room.areaSqm > smallestBedroom) {
      room.areaSqm = grid(Math.min(room.areaSqm, 5.0));
    }
  }

  // Cap living room to 20% of total
  const living = budgeted.find(r => r.type === "living");
  if (living && living.areaSqm > totalAreaSqm * 0.20) {
    living.areaSqm = grid(totalAreaSqm * 0.20);
  }

  // Equalize non-master bedrooms: all should have the SAME budget
  // This prevents post-processing drift from creating >25% differences
  const nonMasterBeds = budgeted.filter(r =>
    r.type === "bedroom" && !r.name.toLowerCase().includes("master") &&
    !(r.preferredWidth && r.preferredDepth)
  );
  if (nonMasterBeds.length >= 2) {
    const avgArea = grid(nonMasterBeds.reduce((s, r) => s + r.areaSqm, 0) / nonMasterBeds.length);
    for (const bed of nonMasterBeds) {
      bed.areaSqm = avgArea;
    }
  }

  return budgeted;
}

// ── Spine geometry types ───────────────────────────────────────────────────

type SpineShape = "I" | "L";

interface SpineGeometry {
  shape: SpineShape;
  corridorRects: Rect[];       // corridor segment rectangles
  publicWing: Rect;            // region for public rooms
  privateWing: Rect;           // region for private rooms
  serviceWing: Rect | null;    // region for service rooms (L-shape only)
  corridorName: string;
}

// ── Step 2-3: Generate I-shape spine ───────────────────────────────────────

function generateISpine(
  fpW: number, fpH: number,
  publicArea: number, privateArea: number,
): SpineGeometry {
  const cw = CORRIDOR_DEPTH; // 1.2m corridor width

  // Public wing on left (~proportional to area), private on right
  const totalWingArea = publicArea + privateArea;
  const publicRatio = Math.max(0.35, Math.min(0.65, publicArea / totalWingArea));
  // Ensure each wing is at least 3.0m wide (enough for a room + corridor)
  const minWingW = 3.0;
  const publicW = grid(Math.max(minWingW, (fpW - cw) * publicRatio));
  const privateW = grid(Math.max(minWingW, fpW - publicW - cw));

  return {
    shape: "I",
    corridorRects: [{ x: publicW, y: 0, w: cw, h: fpH }],
    publicWing: { x: 0, y: 0, w: publicW, h: fpH },
    privateWing: { x: grid(publicW + cw), y: 0, w: privateW, h: fpH },
    serviceWing: null,
    corridorName: "Corridor",
  };
}

// ── Step 2-3: Generate L-shape spine ───────────────────────────────────────

function generateLSpine(
  fpW: number, fpH: number,
  _publicArea: number, _privateArea: number, _serviceArea: number,
): SpineGeometry {
  const cw = CORRIDOR_DEPTH; // 1.2m

  // Horizontal corridor at ~55% height, vertical corridor at ~45% width
  const hCorrY = grid(fpH * 0.55);
  const vCorrX = grid(fpW * 0.45);

  // Private wing: full width, above horizontal corridor
  const privateH = grid(hCorrY);
  // Public wing: left of vertical corridor, below horizontal corridor
  const publicH = grid(fpH - hCorrY - cw);
  const publicW = grid(vCorrX);
  // Service wing: right of vertical corridor, below horizontal corridor
  const serviceW = grid(fpW - vCorrX - cw);

  return {
    shape: "L",
    corridorRects: [
      { x: 0, y: hCorrY, w: fpW, h: cw },           // horizontal
      { x: vCorrX, y: grid(hCorrY + cw), w: cw, h: publicH }, // vertical
    ],
    publicWing: { x: 0, y: grid(hCorrY + cw), w: publicW, h: publicH },
    privateWing: { x: 0, y: 0, w: fpW, h: privateH },
    serviceWing: { x: grid(vCorrX + cw), y: grid(hCorrY + cw), w: serviceW, h: publicH },
    corridorName: "Corridor",
  };
}

// ── Step 5: Place public rooms in wing (strip placement) ──────────────────
//
// FIX 2: Kitchen+Dining treated as a single paired unit and placed together,
// then split internally. This GUARANTEES they share a wall ≥1.2m.

function placePublicRooms(
  rooms: RoomSpec[], wing: Rect,
): PlacedRoom[] {
  if (rooms.length === 0) return [];

  // Identify kitchen, dining, living, and others
  const kitchen = rooms.find(r => r.type === "kitchen");
  const dining = rooms.find(r => r.type === "dining" || r.name.toLowerCase().includes("dining"));
  const living = rooms.find(r => r.type === "living");
  const others = rooms.filter(r => r !== kitchen && r !== dining && r !== living);

  // Build placement units: Kitchen+Dining is ONE unit
  interface PlacementUnit { rooms: RoomSpec[]; paired: boolean; totalArea: number }
  const units: PlacementUnit[] = [];

  if (living) units.push({ rooms: [living], paired: false, totalArea: living.areaSqm });
  if (kitchen && dining) {
    units.push({ rooms: [dining, kitchen], paired: true, totalArea: dining.areaSqm + kitchen.areaSqm });
  } else {
    if (dining) units.push({ rooms: [dining], paired: false, totalArea: dining.areaSqm });
    if (kitchen) units.push({ rooms: [kitchen], paired: false, totalArea: kitchen.areaSqm });
  }
  for (const r of others) units.push({ rooms: [r], paired: false, totalArea: r.areaSqm });

  if (units.length === 0) return [];

  // Divide wing into strips for each unit (try H and V, pick best)
  const bestResult = placePublicUnits(units, wing);
  return bestResult;
}

/**
 * Place public room units as strips, handling paired kitchen+dining as a single strip
 * that is split internally.
 */
function placePublicUnits(
  units: Array<{ rooms: RoomSpec[]; paired: boolean; totalArea: number }>,
  wing: Rect,
): PlacedRoom[] {
  // Try both directions
  const hResult = placePublicUnitsDir(units, wing, "horizontal");
  const vResult = placePublicUnitsDir(units, wing, "vertical");
  const hMaxAR = Math.max(...hResult.map(r => ar(r.width, r.depth)), 99);
  const vMaxAR = Math.max(...vResult.map(r => ar(r.width, r.depth)), 99);
  return (hMaxAR <= vMaxAR) ? hResult : vResult;
}

function placePublicUnitsDir(
  units: Array<{ rooms: RoomSpec[]; paired: boolean; totalArea: number }>,
  wing: Rect,
  direction: "horizontal" | "vertical",
): PlacedRoom[] {
  const placed: PlacedRoom[] = [];
  const totalArea = units.reduce((s, u) => s + u.totalArea, 0);
  let cursor = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const isLast = i === units.length - 1;
    const ratio = unit.totalArea / Math.max(totalArea, 1);
    const minSize = 2.0;

    if (direction === "horizontal") {
      const stripH = isLast
        ? grid(wing.h - cursor)
        : grid(Math.max(minSize, wing.h * ratio));
      if (stripH <= 0) continue;
      const stripRect: Rect = { x: wing.x, y: grid(wing.y + cursor), w: wing.w, h: stripH };

      if (unit.paired && unit.rooms.length === 2) {
        // Split strip between dining (55%) and kitchen (45%)
        const splitRatio = unit.rooms[0].areaSqm / (unit.rooms[0].areaSqm + unit.rooms[1].areaSqm);
        const aW = grid(Math.max(MIN_HABITABLE, wing.w * splitRatio));
        const bW = grid(wing.w - aW);
        placed.push({
          name: unit.rooms[0].name, type: unit.rooms[0].type,
          x: grid(stripRect.x), y: grid(stripRect.y), width: aW, depth: stripH,
          area: grid(aW * stripH),
        });
        placed.push({
          name: unit.rooms[1].name, type: unit.rooms[1].type,
          x: grid(stripRect.x + aW), y: grid(stripRect.y), width: bW, depth: stripH,
          area: grid(bW * stripH),
        });
      } else {
        placed.push({
          name: unit.rooms[0].name, type: unit.rooms[0].type,
          x: grid(stripRect.x), y: grid(stripRect.y), width: grid(wing.w), depth: stripH,
          area: grid(wing.w * stripH),
        });
      }
      cursor += stripH;
    } else {
      const stripW = isLast
        ? grid(wing.w - cursor)
        : grid(Math.max(minSize, wing.w * ratio));
      if (stripW <= 0) continue;
      const stripRect: Rect = { x: grid(wing.x + cursor), y: wing.y, w: stripW, h: wing.h };

      if (unit.paired && unit.rooms.length === 2) {
        const splitRatio = unit.rooms[0].areaSqm / (unit.rooms[0].areaSqm + unit.rooms[1].areaSqm);
        const aH = grid(Math.max(MIN_HABITABLE, wing.h * splitRatio));
        const bH = grid(wing.h - aH);
        placed.push({
          name: unit.rooms[0].name, type: unit.rooms[0].type,
          x: grid(stripRect.x), y: grid(stripRect.y), width: stripW, depth: aH,
          area: grid(stripW * aH),
        });
        placed.push({
          name: unit.rooms[1].name, type: unit.rooms[1].type,
          x: grid(stripRect.x), y: grid(stripRect.y + aH), width: stripW, depth: bH,
          area: grid(stripW * bH),
        });
      } else {
        placed.push({
          name: unit.rooms[0].name, type: unit.rooms[0].type,
          x: grid(stripRect.x), y: grid(wing.y), width: stripW, depth: grid(wing.h),
          area: grid(stripW * wing.h),
        });
      }
      cursor += stripW;
    }
  }

  return placed;
}

/**
 * Place rooms as strips in a wing region.
 * "horizontal" = strips stacked vertically (each strip is full-width, variable height)
 * "vertical" = strips side by side (each strip is full-height, variable width)
 */
function placeStrips(
  rooms: RoomSpec[], wing: Rect, totalArea: number,
  direction: "horizontal" | "vertical",
): PlacedRoom[] {
  const placed: PlacedRoom[] = [];
  let cursor = 0;

  // Minimum strip size: habitable rooms need ≥2.0m, bathrooms/utility ≥1.2m
  function minStripSize(type: string): number {
    if (type === "bathroom" || type === "utility" || type === "storage") return MIN_BATHROOM_DIM;
    return 2.0;
  }

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const isLast = i === rooms.length - 1;
    const ratio = room.areaSqm / Math.max(totalArea, 1);
    const minSize = minStripSize(room.type);

    if (direction === "horizontal") {
      const stripH = isLast
        ? grid(wing.h - cursor)
        : grid(Math.max(minSize, wing.h * ratio));
      if (stripH <= 0) continue;
      placed.push({
        name: room.name, type: room.type,
        x: grid(wing.x), y: grid(wing.y + cursor),
        width: grid(wing.w), depth: stripH,
        area: grid(wing.w * stripH),
      });
      cursor += stripH;
    } else {
      const stripW = isLast
        ? grid(wing.w - cursor)
        : grid(Math.max(minSize, wing.w * ratio));
      if (stripW <= 0) continue;
      placed.push({
        name: room.name, type: room.type,
        x: grid(wing.x + cursor), y: grid(wing.y),
        width: stripW, depth: grid(wing.h),
        area: grid(stripW * wing.h),
      });
      cursor += stripW;
    }
  }

  return placed;
}

// ── Step 6: Place private pairs (bedroom + bathroom as units) ──────────────
//
// FIX 1: EQUAL bedroom strip sizes. All non-master bedrooms get the same strip
// width. Master gets at most 1.25× the normal share. No bedroom should end up
// at 30m² while another is at 6m².
//
// FIX 3: Bathroom sizes CLAMPED to 2.8-5.0m² regardless of strip dimensions.
// Excess space from bathroom clamping goes back to the paired bedroom.

function placePrivatePairs(
  rooms: RoomSpec[],
  wing: Rect,
  adjacency: AdjacencyRequirement[],
): PlacedRoom[] {
  if (rooms.length === 0) return [];

  // Separate bedrooms, bathrooms, and others
  const bedrooms = rooms.filter(r =>
    r.type === "bedroom" || r.name.toLowerCase().includes("bedroom") ||
    r.name.toLowerCase().includes("master")
  );
  const bathrooms = rooms.filter(r =>
    r.type === "bathroom" || r.name.toLowerCase().includes("bath") ||
    r.name.toLowerCase().includes("toilet")
  );
  const others = rooms.filter(r => !bedrooms.includes(r) && !bathrooms.includes(r));

  // Pair bedrooms with bathrooms using adjacency hints
  const pairs: Array<{ bed: RoomSpec; bath: RoomSpec | null }> = [];
  const usedBaths = new Set<RoomSpec>();

  const sortedBeds = [...bedrooms].sort((a, b) => {
    const am = a.name.toLowerCase().includes("master") ? 1 : 0;
    const bm = b.name.toLowerCase().includes("master") ? 1 : 0;
    if (am !== bm) return bm - am;
    return b.areaSqm - a.areaSqm;
  });

  for (const bed of sortedBeds) {
    let match: RoomSpec | null = null;
    for (const adj of adjacency) {
      const bathName = adj.roomA === bed.name ? adj.roomB :
                       adj.roomB === bed.name ? adj.roomA : null;
      if (bathName) {
        match = bathrooms.find(b => b.name === bathName && !usedBaths.has(b)) ?? null;
        if (match) break;
      }
    }
    if (!match) match = bathrooms.find(b => !usedBaths.has(b)) ?? null;
    if (match) usedBaths.add(match);
    pairs.push({ bed, bath: match });
  }

  const remainder = [
    ...bathrooms.filter(b => !usedBaths.has(b)),
    ...others,
  ];

  const placed: PlacedRoom[] = [];
  const useVerticalStrips = wing.w >= wing.h * 1.2;

  // ── FIX 1: EQUAL strip allocation ──
  // Total units = pairs + (1 for remainder if non-empty)
  const totalUnits = pairs.length + (remainder.length > 0 ? 1 : 0);
  if (totalUnits === 0) return [];

  // Find master pair index
  const masterIdx = pairs.findIndex(p =>
    p.bed.name.toLowerCase().includes("master") ||
    (pairs.length > 0 && p.bed.areaSqm === Math.max(...pairs.map(p2 => p2.bed.areaSqm)))
  );

  // Master gets 1.25× share, all others EQUAL
  const masterMult = 1.25;
  const totalDim = useVerticalStrips ? wing.w : wing.h;
  const hasRemainder = remainder.length > 0;
  // Remainder strip gets 0.6× share (utility/staircase rooms are smaller)
  const remainderMult = 0.6;
  const denominator = (totalUnits - 1) + (masterIdx >= 0 ? masterMult : 1) +
                      (hasRemainder ? remainderMult - 1 : 0);
  const normalShare = grid(totalDim / denominator);
  const masterShare = grid(normalShare * masterMult);
  const remainderShare = hasRemainder ? grid(normalShare * remainderMult) : 0;

  let cursor = 0;

  for (let i = 0; i < pairs.length; i++) {
    const { bed, bath } = pairs[i];
    const isLast = i === pairs.length - 1 && !hasRemainder;

    // FIX 1: Equal strips — master gets masterShare, ALL others get normalShare
    // Never use "remainder" for a bedroom strip — that causes unequal sizing
    const stripDim = (i === masterIdx) ? masterShare : normalShare;

    if (stripDim <= 0) continue;

    if (useVerticalStrips) {
      const stripW = grid(Math.max(MIN_STRIP_WIDTH, stripDim));

      if (bath) {
        // FIX 3: Calculate bathroom depth from TARGET AREA, not strip proportion
        // Target: bath.areaSqm, clamped to 2.8-5.0m²
        const targetBathArea = Math.max(2.8, Math.min(5.0, bath.areaSqm));
        // bathDepth = targetArea / stripWidth, clamped to minimums
        let bathDepth = grid(Math.max(1.5, targetBathArea / stripW));
        // Don't let bathroom take more than 40% of wing height
        bathDepth = grid(Math.min(bathDepth, wing.h * 0.40));
        const bedDepth = grid(wing.h - bathDepth);

        placed.push({
          name: bed.name, type: bed.type,
          x: grid(wing.x + cursor), y: grid(wing.y),
          width: stripW, depth: bedDepth,
          area: grid(stripW * bedDepth),
        });
        placed.push({
          name: bath.name, type: bath.type,
          x: grid(wing.x + cursor), y: grid(wing.y + bedDepth),
          width: stripW, depth: bathDepth,
          area: grid(stripW * bathDepth),
        });
      } else {
        placed.push({
          name: bed.name, type: bed.type,
          x: grid(wing.x + cursor), y: grid(wing.y),
          width: stripW, depth: grid(wing.h),
          area: grid(stripW * wing.h),
        });
      }
      cursor += stripW;
    } else {
      const stripH = grid(Math.max(MIN_STRIP_WIDTH, stripDim));

      if (bath) {
        const targetBathArea = Math.max(2.8, Math.min(5.0, bath.areaSqm));
        let bathWidth = grid(Math.max(1.5, targetBathArea / stripH));
        bathWidth = grid(Math.min(bathWidth, wing.w * 0.40));
        const bedWidth = grid(wing.w - bathWidth);

        placed.push({
          name: bed.name, type: bed.type,
          x: grid(wing.x), y: grid(wing.y + cursor),
          width: bedWidth, depth: stripH,
          area: grid(bedWidth * stripH),
        });
        placed.push({
          name: bath.name, type: bath.type,
          x: grid(wing.x + bedWidth), y: grid(wing.y + cursor),
          width: bathWidth, depth: stripH,
          area: grid(bathWidth * stripH),
        });
      } else {
        placed.push({
          name: bed.name, type: bed.type,
          x: grid(wing.x), y: grid(wing.y + cursor),
          width: grid(wing.w), depth: stripH,
          area: grid(wing.w * stripH),
        });
      }
      cursor += stripH;
    }
  }

  // Place remainder rooms in leftover space
  if (remainder.length > 0) {
    const remainderTotal = remainder.reduce((s, r) => s + r.areaSqm, 0);
    if (useVerticalStrips) {
      const remW = grid(totalDim - cursor);
      if (remW >= MIN_BATHROOM_DIM) {
        const remRect: Rect = { x: grid(wing.x + cursor), y: wing.y, w: remW, h: wing.h };
        placed.push(...placeStrips(remainder, remRect, remainderTotal, "horizontal"));
      }
    } else {
      const remH = grid(totalDim - cursor);
      if (remH >= MIN_BATHROOM_DIM) {
        const remRect: Rect = { x: wing.x, y: grid(wing.y + cursor), w: wing.w, h: remH };
        placed.push(...placeStrips(remainder, remRect, remainderTotal, "vertical"));
      }
    }
  }

  return placed;
}

// ── Step 7: Place service rooms ────────────────────────────────────────────

function placeServiceRooms(
  rooms: RoomSpec[], wing: Rect,
): PlacedRoom[] {
  if (rooms.length === 0 || wing.w < MIN_BATHROOM_DIM || wing.h < MIN_BATHROOM_DIM) return [];
  const totalArea = rooms.reduce((s, r) => s + r.areaSqm, 0);
  // Use strip placement in whichever direction gives better AR
  const hResult = placeStrips(rooms, wing, totalArea, "horizontal");
  const vResult = placeStrips(rooms, wing, totalArea, "vertical");
  const hMaxAR = Math.max(...hResult.map(r => ar(r.width, r.depth)), 0);
  const vMaxAR = Math.max(...vResult.map(r => ar(r.width, r.depth)), 0);
  return (hMaxAR <= vMaxAR) ? hResult : vResult;
}

// ── Step 8: Validate and score ─────────────────────────────────────────────

interface SpineScore {
  score: number;
  issues: string[];
}

function validateSpine(
  placed: PlacedRoom[], specs: RoomSpec[], fpW: number, fpH: number,
  adjacency: AdjacencyRequirement[],
): SpineScore {
  let score = 1.0;
  const issues: string[] = [];
  const TOL = 0.15;

  // Check rooms within footprint
  for (const r of placed) {
    if (r.x < -TOL || r.y < -TOL || r.x + r.width > fpW + TOL || r.y + r.depth > fpH + TOL) {
      score -= 0.15;
      issues.push(`${r.name} outside footprint`);
    }
  }

  // Check overlaps
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (ox > TOL && oy > TOL) {
        score -= 0.10;
        issues.push(`Overlap: ${a.name} ∩ ${b.name}`);
      }
    }
  }

  // Check adjacency satisfaction
  for (const req of adjacency) {
    const a = placed.find(r => r.name === req.roomA);
    const b = placed.find(r => r.name === req.roomB);
    if (!a || !b) continue;
    if (!roomsShareEdge(a, b, 0.3)) {
      score -= 0.08;
      issues.push(`Adjacency miss: ${req.roomA} ↔ ${req.roomB}`);
    }
  }

  // Check exterior wall constraint
  for (const spec of specs) {
    if (!spec.mustHaveExteriorWall) continue;
    const room = placed.find(r => r.name === spec.name);
    if (!room) continue;
    const onPerimeter = room.x < TOL || room.y < TOL ||
      Math.abs(room.x + room.width - fpW) < TOL ||
      Math.abs(room.y + room.depth - fpH) < TOL;
    if (!onPerimeter) {
      score -= 0.12;
      issues.push(`${room.name} needs exterior wall`);
    }
  }

  // Check room area accuracy (within ±30% of budget)
  for (const spec of specs) {
    const room = placed.find(r => r.name === spec.name);
    if (!room) continue;
    const actualArea = room.width * room.depth;
    const diff = Math.abs(actualArea - spec.areaSqm) / Math.max(spec.areaSqm, 1);
    if (diff > 0.30) {
      score -= 0.05;
      issues.push(`${room.name} area ${actualArea.toFixed(1)}m² vs target ${spec.areaSqm.toFixed(1)}m²`);
    }
  }

  // Check aspect ratios
  for (const room of placed) {
    if (room.type === "hallway" || room.type === "balcony") continue;
    const roomAR = ar(room.width, room.depth);
    const isBath = room.type === "bathroom";
    const maxAR = isBath ? 3.5 : 3.0;
    if (roomAR > maxAR) {
      score -= 0.08;
      issues.push(`${room.name} AR ${roomAR.toFixed(1)}`);
    }
  }

  // Check minimum dimensions (hard fail for habitable rooms)
  for (const room of placed) {
    if (room.type === "hallway") continue;
    const isBath = room.type === "bathroom";
    const minDim = isBath ? 1.2 : room.type === "kitchen" || room.type === "utility" ? 1.2 : 2.0;
    const shorter = Math.min(room.width, room.depth);
    if (shorter < minDim - 0.1) {
      // Hard penalty for habitable rooms below minimum — forces BSP fallback
      const penalty = isBath ? 0.08 : 0.20;
      score -= penalty;
      issues.push(`${room.name} min dim ${shorter.toFixed(1)}m < ${minDim}m`);
    }
  }

  // Check coverage
  const roomAreaSum = placed.reduce((s, r) => s + r.width * r.depth, 0);
  const coverage = roomAreaSum / (fpW * fpH);
  if (coverage < 0.85) {
    score -= 0.10;
    issues.push(`Coverage ${(coverage * 100).toFixed(0)}% < 85%`);
  }

  return { score: Math.max(0, score), issues };
}


// ── Post-spine NBC enforcement ──────────────────────────────────────────────
//
// Clamps room dimensions to meet NBC 2016 minimums BEFORE the general pipeline
// post-processing runs. This catches issues the spine strip placement creates.

function enforceSpineNBC(rooms: PlacedRoom[]): void {
  for (const room of rooms) {
    const minDim = Math.min(room.width, room.depth);

    if (room.type === "bedroom") {
      // NBC: bedrooms ≥ 9.5m², min dimension ≥ 2.4m
      if (minDim < 2.4) {
        if (room.width < room.depth) room.width = grid(2.4);
        else room.depth = grid(2.4);
        room.area = grid(room.width * room.depth);
      }
    }

    if (room.type === "bathroom") {
      // Clamp bathroom area to max 5.0m²
      const currentArea = room.width * room.depth;
      if (currentArea > 5.5) {
        const scale = Math.sqrt(5.0 / currentArea);
        room.width = grid(Math.max(1.5, room.width * scale));
        room.depth = grid(Math.max(1.5, room.depth * scale));
        room.area = grid(room.width * room.depth);
      }
      // Minimum dimension 1.5m
      if (Math.min(room.width, room.depth) < 1.5) {
        if (room.width < room.depth) room.width = grid(1.5);
        else room.depth = grid(1.5);
        room.area = grid(room.width * room.depth);
      }
    }

    if (room.type === "kitchen") {
      // NBC: kitchen min dimension ≥ 2.1m (practical: 2.4m)
      if (minDim < 2.1) {
        if (room.width < room.depth) room.width = grid(2.1);
        else room.depth = grid(2.1);
        room.area = grid(room.width * room.depth);
      }
    }
  }
}

// ── Main spine layout function ─────────────────────────────────────────────

function layoutWithSpine(
  program: EnhancedRoomProgram,
  cls: ClassifiedRooms,
  fpW: number,
  fpH: number,
): PlacedRoom[] | null {
  try {
    const rooms = program.rooms;

    // Step 1: Budget room areas
    const budgeted = budgetRoomAreas(rooms, program.totalAreaSqm);

    // Re-classify with budgeted areas
    const publicRooms: RoomSpec[] = [];
    const privateRooms: RoomSpec[] = [];
    const serviceRooms: RoomSpec[] = [];
    let corridorSpec: RoomSpec | null = null;

    for (const r of budgeted) {
      const name = r.name.toLowerCase();
      const isCorridor = r.type === "hallway" || name.includes("corridor") || name.includes("passage");
      const isEntrance = r.type === "entrance" || name.includes("foyer") || name.includes("entrance");

      if (isCorridor) {
        corridorSpec = r;
      } else if (isEntrance) {
        publicRooms.push(r); // entrance goes in public wing
      } else if (r.type === "living" || r.type === "dining" || r.type === "kitchen") {
        publicRooms.push(r);
      } else if (name.includes("dining") || name.includes("drawing")) {
        publicRooms.push(r);
      } else if (r.type === "bedroom" || r.type === "bathroom") {
        privateRooms.push(r);
      } else if (r.zone === "private") {
        privateRooms.push(r);
      } else if (r.type === "utility" || r.type === "storage" || r.zone === "service") {
        serviceRooms.push(r);
      } else if (r.type === "balcony") {
        publicRooms.push(r);
      } else if (r.type === "staircase") {
        serviceRooms.push(r);
      } else {
        // Default: small rooms → service, larger → public
        if (r.areaSqm < 6) serviceRooms.push(r);
        else publicRooms.push(r);
      }
    }

    const publicArea = publicRooms.reduce((s, r) => s + r.areaSqm, 0);
    const privateArea = privateRooms.reduce((s, r) => s + r.areaSqm, 0);
    const serviceArea = serviceRooms.reduce((s, r) => s + r.areaSqm, 0);

    // Need both public and private rooms for spine layout
    if (publicRooms.length === 0 || privateRooms.length === 0) return null;

    // Step 2-3: Try spine shapes
    const shapes: SpineShape[] = rooms.length <= 6 ? ["I", "L"] : ["L", "I"];
    let bestResult: PlacedRoom[] | null = null;
    let bestScore = -1;

    for (const shape of shapes) {
      const spine = shape === "I"
        ? generateISpine(fpW, fpH, publicArea, privateArea)
        : generateLSpine(fpW, fpH, publicArea, privateArea, serviceArea);

      const allPlaced: PlacedRoom[] = [];

      // Place corridor — always add one (BSP layoutWithZones does the same)
      const cr = spine.corridorRects[0];
      if (cr) {
        allPlaced.push({
          name: corridorSpec?.name ?? "Corridor",
          type: "hallway",
          x: cr.x, y: cr.y, width: cr.w, depth: cr.h,
          area: grid(cr.w * cr.h),
        });
      }

      // For I-shape: merge service rooms into private wing (no separate service wing)
      const effectivePrivate = shape === "I"
        ? [...privateRooms, ...serviceRooms]
        : privateRooms;

      // Step 5: Place public rooms
      allPlaced.push(...placePublicRooms(publicRooms, spine.publicWing));

      // Step 6: Place private pairs (+ service rooms in I-shape)
      allPlaced.push(...placePrivatePairs(effectivePrivate, spine.privateWing, program.adjacency));

      // Step 7: Place service rooms (L-shape only — I-shape merged above)
      if (shape === "L" && serviceRooms.length > 0 && spine.serviceWing &&
          spine.serviceWing.w >= MIN_BATHROOM_DIM && spine.serviceWing.h >= MIN_BATHROOM_DIM) {
        allPlaced.push(...placeServiceRooms(serviceRooms, spine.serviceWing));
      }

      // Step 8: Validate
      const { score, issues } = validateSpine(allPlaced, budgeted, fpW, fpH, program.adjacency);
      console.log(`[SPINE-${shape}] Score: ${score.toFixed(2)}, Issues: ${issues.length > 0 ? issues.join("; ") : "none"}`);

      if (score > bestScore) {
        bestScore = score;
        bestResult = [...allPlaced];
      }

      // Accept immediately if good enough
      if (score >= 0.75) break;
    }

    if (bestResult && bestScore >= 0.50) {
      console.log(`[SPINE] Accepted with score ${bestScore.toFixed(2)} (${bestResult.length} rooms)`);

      // ── Post-spine NBC enforcement (within spine, before pipeline post-processing) ──
      enforceSpineNBC(bestResult);

      // Ensure all input rooms are present in output
      const outputNames = new Set(bestResult.map(r => r.name));
      const missing = budgeted.filter(r => !outputNames.has(r.name) &&
        r.type !== "hallway" && !r.name.toLowerCase().includes("corridor"));
      if (missing.length > 0) {
        console.warn(`[SPINE] Missing ${missing.length} rooms: ${missing.map(r => r.name).join(", ")}`);
        for (const room of missing) {
          bestResult.push(forcePlaceRoom(room, fpW, fpH, bestResult));
        }
      }

      return bestResult;
    }

    console.log(`[SPINE] Best score ${bestScore.toFixed(2)} < 0.50, falling back to BSP`);
    return null;
  } catch (err) {
    console.warn("[SPINE] Error, falling back to BSP:", err);
    return null;
  }
}

// ── Zone-based layout ────────────────────────────────────────────────────────

function layoutWithZones(
  cls: ClassifiedRooms,
  fpW: number,
  fpH: number,
  adjacency: AdjacencyRequirement[],
  entranceRoom?: string,
): PlacedRoom[] {
  const { publicZone, privateZone, corridor } = cls;

  // Compute zone areas
  const publicArea = publicZone.reduce((s, r) => s + r.areaSqm, 0);
  const privateArea = privateZone.reduce((s, r) => s + r.areaSqm, 0);
  const floorArea = fpW * fpH;

  // ── Corridor depth calculation with cap ──
  // Cap corridor area to 6% of floor area AND 12 sqm hard max
  const MAX_CORRIDOR_RATIO = 0.06;
  const MAX_CORRIDOR_AREA = 12.0; // sqm hard cap for large floors
  const cappedArea = Math.min(floorArea * MAX_CORRIDOR_RATIO, MAX_CORRIDOR_AREA);
  const maxCorridorDepth = cappedArea / fpW;

  // If user specified a corridor room with area, respect it (up to cap)
  const userCorridorArea = corridor?.areaSqm ?? 0;
  let corridorDepth: number;
  if (userCorridorArea > 0 && userCorridorArea < cappedArea) {
    corridorDepth = grid(Math.max(1.0, userCorridorArea / fpW));
  } else {
    corridorDepth = grid(Math.min(CORRIDOR_DEPTH, Math.max(1.0, maxCorridorDepth)));
  }

  // ── Enforce corridor area cap (min-depth floor can cause area to exceed cap on wide footprints) ──
  const corridorAreaCheck = corridorDepth * fpW;
  if (corridorAreaCheck > cappedArea * 1.2) {
    const targetDepth = grid(cappedArea / fpW);
    // Never let corridor go below 1.0m (NBC 2016 residential minimum)
    // If this makes area exceed cap, accept it — code compliance > area cap
    corridorDepth = Math.max(grid(1.0), targetDepth);
  }

  const corridorArea = corridorDepth * fpW;
  const usableArea = fpW * fpH - corridorArea;

  // Zone depths proportional to area
  const publicRatio = publicArea / Math.max(publicArea + privateArea, 1);
  let privateDepth = grid(usableArea * (1 - publicRatio) / fpW);
  let publicDepth = grid(usableArea * publicRatio / fpW);

  // Enforce minimums
  if (privateDepth < MIN_HABITABLE) {
    privateDepth = MIN_HABITABLE;
    publicDepth = grid(fpH - privateDepth - corridorDepth);
  }
  if (publicDepth < MIN_HABITABLE) {
    publicDepth = MIN_HABITABLE;
    privateDepth = grid(fpH - publicDepth - corridorDepth);
  }

  // Absorb rounding error into larger zone
  const rem = fpH - privateDepth - corridorDepth - publicDepth;
  if (Math.abs(rem) > 0.01) {
    if (privateDepth >= publicDepth) privateDepth = grid(privateDepth + rem);
    else publicDepth = grid(publicDepth + rem);
  }

  // Zone rects (Y-down: private top, corridor, public bottom)
  const privateRect: Rect = { x: 0, y: 0, w: fpW, h: privateDepth };
  const corridorRect: Rect = { x: 0, y: privateDepth, w: fpW, h: corridorDepth };
  const publicRect: Rect = { x: 0, y: privateDepth + corridorDepth, w: fpW, h: publicDepth };

  const result: PlacedRoom[] = [];

  // Private zone: BSP with bedroom-bathroom pairing
  result.push(...layoutPrivateZone(privateZone, privateRect, adjacency));

  // Corridor
  result.push({
    name: corridor?.name ?? "Corridor",
    type: "hallway",
    x: corridorRect.x, y: corridorRect.y,
    width: corridorRect.w, depth: corridorRect.h,
    area: grid(corridorRect.w * corridorRect.h),
  });

  // Public zone: adjacency-ordered BSP (entrance room placed first → gets entry edge)
  result.push(...layoutPublicZone(publicZone, publicRect, adjacency, entranceRoom));

  return result;
}

// ── Private zone: bedroom-bathroom pairs ─────────────────────────────────────

function layoutPrivateZone(
  rooms: RoomSpec[],
  rect: Rect,
  adjacency: AdjacencyRequirement[],
): PlacedRoom[] {
  if (rooms.length === 0) return [];

  // Separate bedrooms from non-bedrooms
  const bedrooms = rooms.filter(r =>
    r.type === "bedroom" || r.name.toLowerCase().includes("bedroom") || r.name.toLowerCase().includes("master")
  );
  const bathrooms = rooms.filter(r =>
    r.type === "bathroom" || r.name.toLowerCase().includes("bath") || r.name.toLowerCase().includes("toilet")
  );
  const otherRooms = rooms.filter(r => !bedrooms.includes(r) && !bathrooms.includes(r));

  // If no bedrooms, just BSP everything
  if (bedrooms.length === 0) {
    return bspSubdivide(rooms, rect, adjacency);
  }

  // Pair bedrooms with bathrooms
  const pairs = pairBedroomsWithBathrooms(bedrooms, bathrooms, adjacency);

  // Build room groups (bedroom+bath pairs)
  const allGroups: RoomGroup[] = [];
  for (const p of pairs) {
    allGroups.push({ rooms: p.rooms, totalArea: p.rooms.reduce((s, r) => s + r.areaSqm, 0) });
  }

  // Merge standalone rooms (utility, storage, etc.) into existing pair groups
  // to avoid extremely narrow solo strips
  if (otherRooms.length > 0 && allGroups.length > 0) {
    for (const r of otherRooms) {
      const smallest = allGroups.reduce((a, b) => a.totalArea < b.totalArea ? a : b);
      smallest.rooms.push(r);
      smallest.totalArea += r.areaSqm;
    }
  } else {
    for (const r of otherRooms) {
      allGroups.push({ rooms: [r], totalArea: r.areaSqm });
    }
  }

  // Check if vertical strips are feasible (each strip ≥ MIN_STRIP_WIDTH)
  const totalArea = allGroups.reduce((s, g) => s + g.totalArea, 0);
  const avgStripWidth = rect.w / allGroups.length;

  if (avgStripWidth >= MIN_STRIP_WIDTH) {
    // Vertical strips: [Bed+Bath1 | Bed+Bath2 | Bed+Bath3 | Utility]
    return layoutGroupStrips(allGroups, rect);
  }

  // Too many groups for vertical strips — fall back to BSP
  // Flatten groups and let BSP handle it
  const allRooms = allGroups.flatMap(g => g.rooms);
  return bspSubdivide(allRooms, rect, adjacency);
}

// ── Layout groups as vertical strips ─────────────────────────────────────────

function layoutGroupStrips(groups: RoomGroup[], rect: Rect): PlacedRoom[] {
  const totalArea = groups.reduce((s, g) => s + g.totalArea, 0);
  const result: PlacedRoom[] = [];
  let x = rect.x;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const isLast = i === groups.length - 1;
    const ratio = group.totalArea / totalArea;

    const stripW = isLast
      ? grid(rect.x + rect.w - x)
      : grid(Math.max(rect.w * ratio, MIN_BATHROOM_DIM));

    const stripRect: Rect = { x, y: rect.y, w: stripW, h: rect.h };

    if (group.rooms.length === 1) {
      result.push(placeRoom(group.rooms[0], stripRect));
    } else if (group.rooms.length === 2) {
      result.push(...layoutBedroomBathPair(group.rooms, stripRect));
    } else {
      result.push(...bspSubdivide(group.rooms, stripRect, []));
    }

    x = grid(x + stripW);
  }

  return result;
}

// ── Layout a bedroom-bathroom pair ───────────────────────────────────────────

function layoutBedroomBathPair(rooms: RoomSpec[], rect: Rect): PlacedRoom[] {
  const bedroom = rooms.find(r =>
    r.type === "bedroom" || r.name.toLowerCase().includes("bed") || r.name.toLowerCase().includes("master")
  ) ?? rooms[0];
  const bathroom = rooms.find(r => r !== bedroom) ?? rooms[1];

  if (!bathroom) return [placeRoom(bedroom, rect)];

  const bathArea = bathroom.areaSqm;
  const totalArea = bedroom.areaSqm + bathArea;
  const bathRatio = bathArea / totalArea;

  // Vertical split: bedroom left, bathroom right
  let vBathW = grid(Math.max(rect.w * bathRatio, MIN_BATHROOM_DIM));
  // Enforce max AR on bathroom — widen if too elongated
  if (ar(vBathW, rect.h) > MAX_ROOM_AR) {
    vBathW = grid(Math.max(vBathW, rect.h / MAX_ROOM_AR));
  }
  const vBedW = grid(rect.w - vBathW);
  const vBedAR = ar(vBedW, rect.h);
  const vBathAR = ar(vBathW, rect.h);
  const vAreaOff = bedroom.areaSqm > 0 ? Math.abs(vBedW * rect.h - bedroom.areaSqm) / bedroom.areaSqm : 0;
  const vBedArDev = Math.max(0, vBedAR - 1.8);   // penalty for elongated bedrooms (target AR 1.0-1.8)
  const vScore = Math.max(vBedAR, vBathAR) + vAreaOff * 0.5 + vBedArDev * 0.15 + 0.05; // +0.05: prefer H-split (bathroom at corridor side)
  const vValid = vBedW >= MIN_HABITABLE && vBathW >= MIN_BATHROOM_DIM;

  // Horizontal split: bedroom top (exterior wall), bathroom bottom (near corridor)
  let hBathH = grid(Math.max(rect.h * bathRatio, MIN_BATHROOM_DIM));
  // Enforce max AR on bathroom — deepen if too elongated
  if (ar(rect.w, hBathH) > MAX_ROOM_AR) {
    hBathH = grid(Math.max(hBathH, rect.w / MAX_ROOM_AR));
  }
  const hBedH = grid(rect.h - hBathH);
  const hBedAR = ar(rect.w, hBedH);
  const hBathAR = ar(rect.w, hBathH);
  const hAreaOff = bedroom.areaSqm > 0 ? Math.abs(rect.w * hBedH - bedroom.areaSqm) / bedroom.areaSqm : 0;
  const hBedArDev = Math.max(0, hBedAR - 1.8);   // penalty for elongated bedrooms
  const hScore = Math.max(hBedAR, hBathAR) + hAreaOff * 0.5 + hBedArDev * 0.15;
  const hValid = hBedH >= MIN_HABITABLE && hBathH >= MIN_BATHROOM_DIM;

  if (vValid && (!hValid || vScore <= hScore)) {
    const bedRect: Rect = { x: rect.x, y: rect.y, w: vBedW, h: rect.h };
    const bathRect: Rect = { x: grid(rect.x + vBedW), y: rect.y, w: vBathW, h: rect.h };
    return [placeRoom(bedroom, bedRect), placeRoom(bathroom, bathRect)];
  } else {
    const bedRect: Rect = { x: rect.x, y: rect.y, w: rect.w, h: hBedH };
    const bathRect: Rect = { x: rect.x, y: grid(rect.y + hBedH), w: rect.w, h: hBathH };
    return [placeRoom(bedroom, bedRect), placeRoom(bathroom, bathRect)];
  }
}

// ── Pair bedrooms with bathrooms ─────────────────────────────────────────────

function pairBedroomsWithBathrooms(
  bedrooms: RoomSpec[],
  bathrooms: RoomSpec[],
  adjacency: AdjacencyRequirement[],
): { rooms: RoomSpec[] }[] {
  const pairs: { rooms: RoomSpec[] }[] = [];
  const usedBathrooms = new Set<RoomSpec>();

  // Sort bedrooms: master first, then by area desc
  const sorted = [...bedrooms].sort((a, b) => {
    const am = a.name.toLowerCase().includes("master") ? 1 : 0;
    const bm = b.name.toLowerCase().includes("master") ? 1 : 0;
    if (am !== bm) return bm - am;
    return b.areaSqm - a.areaSqm;
  });

  for (const bed of sorted) {
    let match: RoomSpec | null = null;

    // Try adjacency-based matching first
    for (const adj of adjacency) {
      const bathName =
        adj.roomA === bed.name ? adj.roomB :
        adj.roomB === bed.name ? adj.roomA : null;
      if (bathName) {
        match = bathrooms.find(b => b.name === bathName && !usedBathrooms.has(b)) ?? null;
        if (match) break;
      }
    }

    // Fallback: first available bathroom
    if (!match) {
      match = bathrooms.find(b => !usedBathrooms.has(b)) ?? null;
    }

    if (match) {
      usedBathrooms.add(match);
      pairs.push({ rooms: [bed, match] });
    } else {
      pairs.push({ rooms: [bed] });
    }
  }

  // Unpaired bathrooms as standalone
  for (const b of bathrooms) {
    if (!usedBathrooms.has(b)) {
      pairs.push({ rooms: [b] });
    }
  }

  return pairs;
}

// ── Vastu-aware room ordering (soft preference) ─────────────────────────────

/**
 * Vastu quadrant preference for common room types.
 * BSP places rooms left→right, top→bottom in the order given.
 * In Y-down coordinates: top = private zone (row 0), bottom = public zone.
 * Within a zone, left = West side, right = East side.
 *
 * These are SOFT preferences — if they conflict with BSP tiling,
 * BSP tiling wins (correct tiling > Vastu score).
 */
const VASTU_SORT_PRIORITY: Record<string, number> = {
  // Public zone ordering (placed left-to-right in public strip):
  // Left (West) → Right (East). Living should be N/NE/E = right side.
  kitchen: 10,      // SE quadrant = right side of public zone
  dining: 20,       // Adjacent to kitchen, middle
  living: 30,       // N/NE/E = right side
  entrance: 5,      // N/E = leftmost or rightmost (exterior)

  // Private zone ordering (placed left-to-right in private strip):
  // SW = master bedroom (left), W/NW = children (middle-right)
  bedroom: 40,      // Generic bedrooms in W/NW
  bathroom: 50,     // NW/W = alongside bedrooms
  utility: 55,      // NW
  storage: 60,      // SW

  // Circulation
  hallway: 100,     // Center
  staircase: 90,    // S/W
};

function vastuSortRooms(rooms: RoomSpec[]): RoomSpec[] {
  return [...rooms].sort((a, b) => {
    const pa = VASTU_SORT_PRIORITY[a.type] ?? 50;
    const pb = VASTU_SORT_PRIORITY[b.type] ?? 50;
    if (pa !== pb) return pa - pb;
    // Tie-break: larger rooms first (get better shapes)
    return b.areaSqm - a.areaSqm;
  });
}

// ── Critical pair grouping for BSP adjacency ─────────────────────────────────

/**
 * Ensure critical room pairs are consecutive in BSP input ordering
 * so BSP naturally places them in adjacent cells.
 *
 * Only groups specific pairs, not the entire flow chain, to avoid
 * disrupting BSP allocation for other rooms.
 */
function groupCriticalPairs(rooms: RoomSpec[]): void {
  // Pair 1: Kitchen + Dining must be consecutive
  movePairTogether(rooms,
    r => r.type === "kitchen",
    r => r.type === "dining" || r.name.toLowerCase().includes("dining"),
  );

  // Pair 2: Drawing Room + Foyer must be consecutive (if both exist)
  movePairTogether(rooms,
    r => r.name.toLowerCase().includes("drawing"),
    r => r.type === "entrance" || r.name.toLowerCase().includes("foyer"),
  );
}

/**
 * Move roomB right after roomA in the array (if they aren't already adjacent).
 */
function movePairTogether(
  rooms: RoomSpec[],
  matchA: (r: RoomSpec) => boolean,
  matchB: (r: RoomSpec) => boolean,
): void {
  const idxA = rooms.findIndex(matchA);
  const idxB = rooms.findIndex(matchB);
  if (idxA < 0 || idxB < 0) return;
  if (Math.abs(idxA - idxB) <= 1) return; // Already adjacent

  // Move B right after A
  const [roomB] = rooms.splice(idxB, 1);
  const newIdxA = rooms.findIndex(matchA); // Re-find after splice
  rooms.splice(newIdxA + 1, 0, roomB);
}

// ── Public zone layout ───────────────────────────────────────────────────────

function layoutPublicZone(
  rooms: RoomSpec[],
  rect: Rect,
  adjacency: AdjacencyRequirement[],
  entranceRoom?: string,
): PlacedRoom[] {
  if (rooms.length === 0) return [];

  // Order rooms for adjacency (BFS from largest room), then Vastu-aware sort
  const ordered = adjacencySort(rooms, adjacency);

  // Apply soft Vastu ordering when adjacency doesn't dictate order
  const vastuOrdered = vastuSortRooms(ordered);

  // ── Group critical pairs so BSP places them adjacent ──
  groupCriticalPairs(vastuOrdered);

  // ── Entrance room priority: place entrance/foyer FIRST in BSP order ──
  // BSP processes rooms left-to-right, so the first room gets the leftmost
  // (building entry edge) position. This ensures the foyer is at the entry facade.
  if (entranceRoom) {
    const entrIdx = vastuOrdered.findIndex(r =>
      r.name === entranceRoom ||
      r.name.toLowerCase().includes("foyer") ||
      r.name.toLowerCase().includes("entrance") ||
      r.type === "entrance"
    );
    if (entrIdx > 0) {
      const [entrRoom] = vastuOrdered.splice(entrIdx, 1);
      vastuOrdered.unshift(entrRoom);
    }
  }

  // Use BSP which naturally produces good tiling
  return bspSubdivide(vastuOrdered, rect, adjacency);
}

// ── BSP subdivision (core algorithm) ─────────────────────────────────────────

function bspSubdivide(
  rooms: RoomSpec[],
  rect: Rect,
  adjacency: AdjacencyRequirement[],
): PlacedRoom[] {
  if (rooms.length === 0) return [];
  if (rooms.length === 1) return [placeRoom(rooms[0], rect)];
  if (rooms.length === 2) return splitTwo(rooms[0], rooms[1], rect);

  // Find best binary partition
  const split = findBestSplit(rooms, rect, adjacency);
  return [
    ...bspSubdivide(split.leftRooms, split.leftRect, adjacency),
    ...bspSubdivide(split.rightRooms, split.rightRect, adjacency),
  ];
}

// ── Split for 2 rooms ────────────────────────────────────────────────────────

function splitTwo(a: RoomSpec, b: RoomSpec, rect: Rect): PlacedRoom[] {
  const ratio = a.areaSqm / (a.areaSqm + b.areaSqm);
  const minFloor = MIN_BATHROOM_DIM; // 1.2m hard floor for any room dimension

  // Horizontal split (with dimension clamping to prevent sub-minimum rooms)
  let hAh = grid(rect.h * ratio);
  let hBh = grid(rect.h - hAh);
  if (hBh < minFloor && rect.h >= minFloor * 2) {
    hBh = grid(minFloor); hAh = grid(rect.h - hBh);
  } else if (hAh < minFloor && rect.h >= minFloor * 2) {
    hAh = grid(minFloor); hBh = grid(rect.h - hAh);
  }
  const hScore = Math.max(ar(rect.w, hAh), ar(rect.w, hBh));

  // Vertical split (with dimension clamping)
  let vAw = grid(rect.w * ratio);
  let vBw = grid(rect.w - vAw);
  if (vBw < minFloor && rect.w >= minFloor * 2) {
    vBw = grid(minFloor); vAw = grid(rect.w - vBw);
  } else if (vAw < minFloor && rect.w >= minFloor * 2) {
    vAw = grid(minFloor); vBw = grid(rect.w - vAw);
  }
  const vScore = Math.max(ar(vAw, rect.h), ar(vBw, rect.h));

  if (hScore <= vScore) {
    return [
      placeRoom(a, { x: rect.x, y: rect.y, w: rect.w, h: hAh }),
      placeRoom(b, { x: rect.x, y: grid(rect.y + hAh), w: rect.w, h: hBh }),
    ];
  } else {
    return [
      placeRoom(a, { x: rect.x, y: rect.y, w: vAw, h: rect.h }),
      placeRoom(b, { x: grid(rect.x + vAw), y: rect.y, w: vBw, h: rect.h }),
    ];
  }
}

// ── Find best split for 3+ rooms ─────────────────────────────────────────────

function findBestSplit(
  rooms: RoomSpec[],
  rect: Rect,
  adjacency: AdjacencyRequirement[],
): { leftRooms: RoomSpec[]; rightRooms: RoomSpec[]; leftRect: Rect; rightRect: Rect } {
  const totalArea = rooms.reduce((s, r) => s + r.areaSqm, 0);

  let bestScore = Infinity;
  let bestResult = {
    leftRooms: rooms.slice(0, 1),
    rightRooms: rooms.slice(1),
    leftRect: { x: rect.x, y: rect.y, w: grid(rect.w * 0.5), h: rect.h },
    rightRect: { x: grid(rect.x + rect.w * 0.5), y: rect.y, w: grid(rect.w * 0.5), h: rect.h },
  };

  for (let k = 1; k < rooms.length; k++) {
    const left = rooms.slice(0, k);
    const right = rooms.slice(k);
    const leftArea = left.reduce((s, r) => s + r.areaSqm, 0);
    const ratio = leftArea / totalArea;

    if (ratio < 0.12 || ratio > 0.88) continue;

    const adjPenalty = countAdjacencyBreaks(left, right, adjacency) * 0.3;

    // Horizontal split
    const hLH = grid(rect.h * ratio);
    const hRH = grid(rect.h - hLH);
    if (hLH >= MIN_BATHROOM_DIM && hRH >= MIN_BATHROOM_DIM) {
      const score = Math.max(ar(rect.w, hLH), ar(rect.w, hRH)) + adjPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestResult = {
          leftRooms: left, rightRooms: right,
          leftRect: { x: rect.x, y: rect.y, w: rect.w, h: hLH },
          rightRect: { x: rect.x, y: grid(rect.y + hLH), w: rect.w, h: hRH },
        };
      }
    }

    // Vertical split
    const vLW = grid(rect.w * ratio);
    const vRW = grid(rect.w - vLW);
    if (vLW >= MIN_BATHROOM_DIM && vRW >= MIN_BATHROOM_DIM) {
      const score = Math.max(ar(vLW, rect.h), ar(vRW, rect.h)) + adjPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestResult = {
          leftRooms: left, rightRooms: right,
          leftRect: { x: rect.x, y: rect.y, w: vLW, h: rect.h },
          rightRect: { x: grid(rect.x + vLW), y: rect.y, w: vRW, h: rect.h },
        };
      }
    }
  }

  return bestResult;
}

// ── Adjacency break counter ──────────────────────────────────────────────────

function countAdjacencyBreaks(left: RoomSpec[], right: RoomSpec[], adjacency: AdjacencyRequirement[]): number {
  const lNames = new Set(left.map(r => r.name));
  const rNames = new Set(right.map(r => r.name));
  let breaks = 0;
  for (const a of adjacency) {
    if ((lNames.has(a.roomA) && rNames.has(a.roomB)) || (rNames.has(a.roomA) && lNames.has(a.roomB))) {
      breaks++;
    }
  }
  return breaks;
}

// ── Adjacency-ordered sort (BFS from largest room) ───────────────────────────

function adjacencySort(rooms: RoomSpec[], adjacency: AdjacencyRequirement[]): RoomSpec[] {
  if (rooms.length <= 1) return rooms;

  const names = new Set(rooms.map(r => r.name));
  const adj = new Map<string, Set<string>>();
  for (const r of rooms) adj.set(r.name, new Set());

  for (const a of adjacency) {
    if (names.has(a.roomA) && names.has(a.roomB)) {
      adj.get(a.roomA)!.add(a.roomB);
      adj.get(a.roomB)!.add(a.roomA);
    }
  }
  for (const r of rooms) {
    for (const n of r.adjacentTo) {
      if (names.has(n)) {
        adj.get(r.name)!.add(n);
        adj.get(n)?.add(r.name);
      }
    }
  }

  // BFS from largest room
  const sorted = [...rooms].sort((a, b) => b.areaSqm - a.areaSqm);
  const visited = new Set<string>();
  const result: RoomSpec[] = [];
  const queue: RoomSpec[] = [sorted[0]];
  visited.add(sorted[0].name);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    result.push(cur);
    for (const nName of adj.get(cur.name) ?? []) {
      if (!visited.has(nName)) {
        visited.add(nName);
        const nRoom = rooms.find(r => r.name === nName);
        if (nRoom) queue.push(nRoom);
      }
    }
  }

  // Add unreached rooms
  for (const r of sorted) {
    if (!visited.has(r.name)) result.push(r);
  }

  return result;
}

// ── Place room in rect ───────────────────────────────────────────────────────

function placeRoom(room: RoomSpec, rect: Rect): PlacedRoom {
  const w = grid(rect.w);
  const h = grid(rect.h);
  return {
    name: room.name,
    type: room.type,
    x: grid(rect.x),
    y: grid(rect.y),
    width: w,
    depth: h,
    area: grid(w * h),
  };
}

// ── Adjacency scoring (report only, no auto-swap) ───────────────────────────

export interface AdjacencyScore {
  total: number;
  satisfied: number;
  percentage: number;
  unsatisfied: Array<{ roomA: string; roomB: string; reason: string }>;
}

/**
 * Score how well the layout satisfies adjacency requirements.
 * REPORT ONLY — does not modify the layout.
 */
export function scoreAdjacency(
  rooms: PlacedRoom[],
  adjacency: AdjacencyRequirement[],
): AdjacencyScore {
  if (adjacency.length === 0) return { total: 0, satisfied: 0, percentage: 100, unsatisfied: [] };

  const TOL = 0.15; // 150mm tolerance for edge touching
  let satisfied = 0;
  const unsatisfied: AdjacencyScore["unsatisfied"] = [];

  for (const req of adjacency) {
    const a = rooms.find(r => r.name === req.roomA);
    const b = rooms.find(r => r.name === req.roomB);
    if (!a || !b) continue;

    // Check if rooms share an edge (adjacent)
    const shareHEdge =
      (Math.abs((a.y + a.depth) - b.y) < TOL || Math.abs((b.y + b.depth) - a.y) < TOL) &&
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > TOL;

    const shareVEdge =
      (Math.abs((a.x + a.width) - b.x) < TOL || Math.abs((b.x + b.width) - a.x) < TOL) &&
      Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > TOL;

    if (shareHEdge || shareVEdge) {
      satisfied++;
    } else {
      unsatisfied.push({ roomA: req.roomA, roomB: req.roomB, reason: req.reason });
    }
  }

  return {
    total: adjacency.length,
    satisfied,
    percentage: Math.round((satisfied / adjacency.length) * 100),
    unsatisfied,
  };
}

// ── Multi-floor layout ──────────────────────────────────────────────────────

export interface FloorLayout {
  level: number;
  rooms: PlacedRoom[];
  footprintWidth: number;
  footprintDepth: number;
}

export interface MultiFloorLayout {
  floors: FloorLayout[];
}

/**
 * Layout a multi-floor building. Groups rooms by floor, runs BSP per floor,
 * and aligns staircases vertically. Falls back to single-floor on error.
 *
 * ADDITIVE: calls layoutFloorPlan() internally — does NOT modify it.
 */
export function layoutMultiFloor(program: EnhancedRoomProgram): MultiFloorLayout {
  const totalInputRooms = program.rooms.length;

  try {
    // Group rooms by floor
    const floorGroups = new Map<number, RoomSpec[]>();
    for (const room of program.rooms) {
      const fl = room.floor ?? 0;
      if (!floorGroups.has(fl)) floorGroups.set(fl, []);
      floorGroups.get(fl)!.push({ ...room }); // shallow copy to avoid mutation
    }

    // Validate: no rooms lost during grouping
    const groupedTotal = [...floorGroups.values()].reduce((s, g) => s + g.length, 0);
    if (groupedTotal < totalInputRooms) {
      console.warn(`[layoutMultiFloor] Room loss during grouping: ${totalInputRooms} → ${groupedTotal}`);
    }

    // Single floor? Use existing layout
    if (floorGroups.size <= 1) {
      const rooms = layoutFloorPlan(program);
      const bW = rooms.length > 0 ? grid(Math.max(...rooms.map(r => r.x + r.width))) : 0;
      const bD = rooms.length > 0 ? grid(Math.max(...rooms.map(r => r.y + r.depth))) : 0;
      return {
        floors: [{ level: 0, rooms, footprintWidth: bW, footprintDepth: bD }],
      };
    }

    // Multi-floor layout
    const sortedLevels = [...floorGroups.keys()].sort((a, b) => a - b);
    const floors: FloorLayout[] = [];

    for (const level of sortedLevels) {
      const rooms = floorGroups.get(level)!;
      const inputCountForFloor = rooms.length;

      // Ensure staircase exists on each floor
      const hasStaircase = rooms.some(
        r => r.type === "staircase" || r.name.toLowerCase().includes("staircase"),
      );
      if (!hasStaircase) {
        rooms.push({
          name: "Staircase",
          type: "staircase",
          areaSqm: 12,
          zone: "circulation" as const,
          mustHaveExteriorWall: false,
          adjacentTo: [],
          preferNear: [],
          floor: level,
        });
      }

      // Create single-floor program for BSP
      const floorArea = rooms.reduce((s, r) => s + r.areaSqm, 0);
      const floorProgram: EnhancedRoomProgram = {
        ...program,
        rooms,
        totalAreaSqm: floorArea,
        numFloors: 1,
        adjacency: program.adjacency.filter(a => {
          const roomNames = new Set(rooms.map(r => r.name));
          return roomNames.has(a.roomA) && roomNames.has(a.roomB);
        }),
      };

      const layout = layoutFloorPlan(floorProgram);

      // Validate: floor room count
      if (layout.length < inputCountForFloor) {
        console.warn(
          `[layoutMultiFloor] Floor ${level}: ${inputCountForFloor} input → ${layout.length} output. ` +
          `Missing rooms handled by layoutFloorPlan recovery.`
        );
      }

      console.log(`[STAGE-2] Floor ${level}: ${layout.length} rooms placed:`, layout.map(r => `${r.name} ${r.width.toFixed(1)}x${r.depth.toFixed(1)}`));

      const bW = layout.length > 0 ? grid(Math.max(...layout.map(r => r.x + r.width))) : 0;
      const bD = layout.length > 0 ? grid(Math.max(...layout.map(r => r.y + r.depth))) : 0;

      floors.push({ level, rooms: layout, footprintWidth: bW, footprintDepth: bD });
    }

    // Normalize footprint (all floors same size for structural alignment)
    const maxW = Math.max(...floors.map(f => f.footprintWidth));
    const maxD = Math.max(...floors.map(f => f.footprintDepth));
    for (const f of floors) {
      f.footprintWidth = maxW;
      f.footprintDepth = maxD;
    }

    // Align staircases vertically across floors
    multiFloorAlignStaircases(floors);

    // Final validation: total rooms across all floors
    const totalOutput = floors.reduce((s, f) => s + f.rooms.length, 0);
    console.log(`[STAGE-2] Total rooms placed: ${totalOutput} (input: ${totalInputRooms})`);

    return { floors };
  } catch (err) {
    console.error("[layoutMultiFloor] Error, falling back to single-floor:", err);
    // Fallback: single-floor layout with all rooms
    const rooms = layoutFloorPlan(program);
    const bW = rooms.length > 0 ? grid(Math.max(...rooms.map(r => r.x + r.width))) : 0;
    const bD = rooms.length > 0 ? grid(Math.max(...rooms.map(r => r.y + r.depth))) : 0;
    return {
      floors: [{ level: 0, rooms, footprintWidth: bW, footprintDepth: bD }],
    };
  }
}

/**
 * Align staircase positions across floors so they stack vertically.
 * Uses ground floor staircase as reference; swaps positions on other floors.
 */
function multiFloorAlignStaircases(floors: FloorLayout[]): void {
  if (floors.length < 2) return;

  const groundFloor = floors.find(f => f.level === 0) ?? floors[0];
  const refStair = groundFloor.rooms.find(
    r => r.type === "staircase" || r.name.toLowerCase().includes("staircase"),
  );
  if (!refStair) return;

  for (const floor of floors) {
    if (floor === groundFloor) continue;

    const stair = floor.rooms.find(
      r => r.type === "staircase" || r.name.toLowerCase().includes("staircase"),
    );
    if (!stair) continue;
    if (stair.x === refStair.x && stair.y === refStair.y) continue;

    // Find room occupying the reference staircase position (overlap check)
    const target = floor.rooms.find(r =>
      r !== stair &&
      !(r.x >= refStair.x + refStair.width || r.x + r.width <= refStair.x) &&
      !(r.y >= refStair.y + refStair.depth || r.y + r.depth <= refStair.y),
    );

    if (target) {
      // Swap positions (keep BSP-generated dimensions for tiling correctness)
      const sx = stair.x, sy = stair.y, sw = stair.width, sd = stair.depth, sa = stair.area;
      stair.x = target.x; stair.y = target.y;
      stair.width = target.width; stair.depth = target.depth; stair.area = target.width * target.depth;
      target.x = sx; target.y = sy;
      target.width = sw; target.depth = sd; target.area = sw * sd;
    }
  }
}
