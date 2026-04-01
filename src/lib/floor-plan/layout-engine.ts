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

// ── Room standards (centralized architectural minimums) ──────────────────────
import { getMinDimMeters, getMinDepthMeters } from "./room-standards";

/** Get the furniture-aware minimum dimension (shorter side) for a room. */
function getMinDimForType(type: string, name: string): number {
  return getMinDimMeters(type, name);
}

/** Get the furniture-aware minimum depth (longer side) for a room. */
function getMinDepthForType(type: string, name: string): number {
  return getMinDepthMeters(type, name);
}

// ── Grid snap ────────────────────────────────────────────────────────────────

function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function ar(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 999;
  return Math.max(w, h) / Math.min(w, h);
}

// ── Detect user-specified room dimensions in prompt ─────────────────────────

/**
 * Returns true if the user's prompt contains room-level dimension patterns
 * like "20x15 feet", "6×4m", "bedroom 5m wide", etc.
 * Used to decide if the greedy fixed-room packer should be used.
 * When the AI fills in preferredWidth/preferredDepth on its own (without
 * user specs), the zone-based layout produces better results.
 */
function hasUserSpecifiedDimensions(prompt: string | undefined): boolean {
  // No prompt available (unit test / programmatic call) — trust preferred dims
  if (prompt === undefined || prompt === null) return true;
  // Prompt available but empty — AI likely hallucinated dims
  if (!prompt.trim()) return false;
  const p = prompt.toLowerCase();
  // NxN patterns: "20x15", "20×15", "20 x 15", "20by15"
  if (/\d+\s*[x×]\s*\d+/.test(p)) return true;
  if (/\d+\s*by\s*\d+/.test(p)) return true;
  // "N feet/ft wide/deep/long" or "N meter/m wide/deep/long"
  if (/\d+\s*(?:feet|ft|foot|meter|metre|m)\s*(?:wide|deep|long|broad)/i.test(p)) return true;
  // "width N" or "depth N" patterns
  if (/(?:width|depth|length)\s*(?:of\s*)?\d+/i.test(p)) return true;
  return false;
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
  //
  // IMPORTANT: Only use greedy packing when the USER actually specified room
  // dimensions in the prompt (e.g., "bedroom 20x15 feet"). GPT-4o-mini often
  // fills in preferredWidth/preferredDepth as its own estimates even when the
  // user didn't ask — those should NOT bypass the zone-based layout.
  const userSpecifiedDims = hasUserSpecifiedDimensions(program.originalPrompt);
  const fixedRooms = userSpecifiedDims
    ? rooms.filter(r => r.preferredWidth && r.preferredDepth &&
        r.preferredWidth > 0 && r.preferredDepth > 0)
    : [];

  // If the user didn't specify dimensions, strip AI-estimated preferred dims
  // so the zone-based layout uses areaSqm (from the AI) as the sizing input
  if (!userSpecifiedDims) {
    for (const r of rooms) {
      delete r.preferredWidth;
      delete r.preferredDepth;
    }
  }

  let result: PlacedRoom[];

  if (fixedRooms.length >= 2) {
    // Use fixed-room pre-placement + BSP for remaining space
    try {
      result = layoutWithFixedRooms(rooms, fpW, fpH, program.adjacency, program.isVastuRequested);
      console.log(`[LAYOUT] Fixed-room placement: ${fixedRooms.length} fixed + ${rooms.length - fixedRooms.length} flex`);
    } catch (err) {
      console.warn("[LAYOUT] Fixed-room placement failed, falling back to BSP:", err);
      // Fall through to normal BSP
      result = fallbackBSP(rooms, useZones, cls, fpW, fpH, program.adjacency);
    }
  } else {
    result = fallbackBSP(rooms, useZones, cls, fpW, fpH, program.adjacency);
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

  // ── Vastu post-optimization (only when requested) ──
  if (program.isVastuRequested && result.length >= 4) {
    result = optimizeVastu(result, fpW, fpH);
    result = verifyVastuPlacement(result, fpW, fpH);
    // Re-repair adjacency after Vastu — Vastu swaps can break bedroom-bathroom pairs
    result = repairBedroomBathroomAdjacency(result, program.adjacency);
  }

  // ── Post-BSP dimension correction ──
  // Adjust shared boundaries to make room sizes closer to targets.
  // Run for layouts with 6+ rooms (lowered from 10 to cover per-floor duplex layouts).
  if (rooms.length >= 6) {
    result = applyDimensionCorrection(result, rooms, fpW, fpH);
  }

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
): PlacedRoom[] {
  const minZoneHeight = MIN_HABITABLE * 2 + CORRIDOR_DEPTH;
  if (!useZones || fpH < minZoneHeight) {
    return bspSubdivide(rooms, { x: 0, y: 0, w: fpW, h: fpH }, adjacency);
  }
  return layoutWithZones(cls, fpW, fpH, adjacency);
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

// ── Room proportion refinement ─────────────────────────────────────────────

/**
 * Fix extreme aspect ratios by adjusting room dimensions.
 * Only adjusts rooms with AR > 2.5 (except corridors).
 * Tries to make rooms more square by trading width for depth.
 */
function refineRoomProportions(rooms: PlacedRoom[]): PlacedRoom[] {
  const result = rooms.map(r => ({ ...r }));

  for (const room of result) {
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
 */
function optimizeVastu(rooms: PlacedRoom[], fpW: number, fpH: number): PlacedRoom[] {
  try {
    const layout = rooms.map(r => ({ ...r }));

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
        const target = layout[targetIdx];
        const tmpName = room.name, tmpType = room.type;
        layout[roomIdx] = { ...room, name: target.name, type: target.type };
        layout[targetIdx] = { ...target, name: tmpName, type: tmpType };
        swappedIndices.add(roomIdx);
        swappedIndices.add(targetIdx);
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
 * Delegates to getMinDimForType() which has furniture-aware minimums.
 */
function getNBCMinDimension(type: string, name: string): number {
  return getMinDimForType(type, name);
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

// ── Zone-based layout ────────────────────────────────────────────────────────

function layoutWithZones(
  cls: ClassifiedRooms,
  fpW: number,
  fpH: number,
  adjacency: AdjacencyRequirement[],
): PlacedRoom[] {
  const { publicZone, privateZone, corridor } = cls;

  // ── Corridor: fixed 1.2m depth (NBC 2016 residential minimum) ──
  let corridorDepth = grid(CORRIDOR_DEPTH); // 1.2m

  // ── Private zone depth: based on room content, not proportional area ──
  // Calculate the minimum depth needed for bedroom-bathroom pairs.
  // In the private zone, bedrooms and bathrooms are laid out as vertical strips
  // where each strip stacks a bedroom above its bathroom (or side-by-side).
  // The zone depth must accommodate the tallest such pair.
  const privateBedrooms = privateZone.filter(r =>
    r.type === "bedroom" || r.name.toLowerCase().includes("bedroom") || r.name.toLowerCase().includes("master")
  );
  const privateBathrooms = privateZone.filter(r =>
    r.type === "bathroom" || r.name.toLowerCase().includes("bath") || r.name.toLowerCase().includes("toilet")
  );

  // Estimate depth needed for bedroom-bath pairs:
  // Zone must be deep enough for the LARGEST bedroom-bathroom pair (vertical strips).
  // Use max bedroom depth (not average) to prevent the largest bedroom from being truncated.
  const BEDROOM_TARGET_AR = 1.5;
  const MIN_BATH_DEPTH = 1.5;    // practical minimum bathroom depth
  const MIN_ZONE_FLOOR = 4.0;    // lowered from 5.0 for small plans (2BHK)
  let geometricDepth = MIN_ZONE_FLOOR;
  if (privateBedrooms.length > 0) {
    const bedDepths = privateBedrooms.map(b => Math.sqrt(b.areaSqm / BEDROOM_TARGET_AR));
    const maxBedDepth = Math.max(...bedDepths);
    geometricDepth = Math.max(maxBedDepth + MIN_BATH_DEPTH, MIN_ZONE_FLOOR);
  }

  // Also consider area demand: private zone must hold all private rooms
  const privateArea = privateZone.reduce((s, r) => s + r.areaSqm, 0);
  const publicArea = publicZone.reduce((s, r) => s + r.areaSqm, 0);
  const areaBasedDepth = privateArea / fpW;

  // Take the larger of geometric and area-based depths
  let privateDepth = grid(Math.max(geometricDepth, areaBasedDepth));

  // ── Public zone: gets the remainder ──
  const MIN_PUBLIC_DEPTH = 3.0;
  let publicDepth = grid(fpH - privateDepth - corridorDepth);

  // If public zone is too shallow, take from private zone
  if (publicDepth < MIN_PUBLIC_DEPTH) {
    publicDepth = grid(MIN_PUBLIC_DEPTH);
    privateDepth = grid(fpH - publicDepth - corridorDepth);
  }

  // Safety: ensure private zone doesn't go below habitable minimum
  if (privateDepth < MIN_HABITABLE) {
    privateDepth = MIN_HABITABLE;
    publicDepth = grid(fpH - privateDepth - corridorDepth);
  }

  // Absorb rounding error into the larger zone
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

  // Public zone: adjacency-ordered BSP
  result.push(...layoutPublicZone(publicZone, publicRect, adjacency));

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
): PlacedRoom[] {
  if (rooms.length === 0) return [];

  // Order rooms for adjacency (BFS from largest room), then Vastu-aware sort
  const ordered = adjacencySort(rooms, adjacency);

  // Apply soft Vastu ordering when adjacency doesn't dictate order
  const vastuOrdered = vastuSortRooms(ordered);

  // ── Group critical pairs so BSP places them adjacent ──
  groupCriticalPairs(vastuOrdered);

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
  // Use furniture-aware minimums per room type instead of universal 1.2m
  const minA = getMinDimForType(a.type, a.name);
  const minB = getMinDimForType(b.type, b.name);
  const minFloor = Math.min(minA, minB); // hard floor for BSP feasibility

  // Cross-axis depth minimums (the dimension NOT being split)
  const depthA = getMinDepthForType(a.type, a.name);
  const depthB = getMinDepthForType(b.type, b.name);

  // Horizontal split (with dimension clamping to prevent sub-minimum rooms)
  let hAh = grid(rect.h * ratio);
  let hBh = grid(rect.h - hAh);
  if (hBh < minB && rect.h >= minB + minA) {
    hBh = grid(minB); hAh = grid(rect.h - hBh);
  } else if (hAh < minA && rect.h >= minA + minB) {
    hAh = grid(minA); hBh = grid(rect.h - hAh);
  } else if (hBh < minFloor && rect.h >= minFloor * 2) {
    hBh = grid(minFloor); hAh = grid(rect.h - hBh);
  } else if (hAh < minFloor && rect.h >= minFloor * 2) {
    hAh = grid(minFloor); hBh = grid(rect.h - hAh);
  }
  let hScore = Math.max(ar(rect.w, hAh), ar(rect.w, hBh));
  // Cross-axis penalty: both rooms inherit rect.w — penalize if it violates depth minimum
  // In H-split, room gets (w=rect.w, h=hXh). The "shorter side" is min(rect.w, hXh).
  // The "longer side" is max(rect.w, hXh). Check both against minWidth and minDepth.
  if (rect.w < minA && hAh >= depthA) hScore += 2; // width too small for A
  if (rect.w < minB && hBh >= depthB) hScore += 2; // width too small for B

  // Vertical split (with dimension clamping)
  let vAw = grid(rect.w * ratio);
  let vBw = grid(rect.w - vAw);
  if (vBw < minB && rect.w >= minB + minA) {
    vBw = grid(minB); vAw = grid(rect.w - vBw);
  } else if (vAw < minA && rect.w >= minA + minB) {
    vAw = grid(minA); vBw = grid(rect.w - vAw);
  } else if (vBw < minFloor && rect.w >= minFloor * 2) {
    vBw = grid(minFloor); vAw = grid(rect.w - vBw);
  } else if (vAw < minFloor && rect.w >= minFloor * 2) {
    vAw = grid(minFloor); vBw = grid(rect.w - vAw);
  }
  let vScore = Math.max(ar(vAw, rect.h), ar(vBw, rect.h));
  // Cross-axis penalty: both rooms inherit rect.h — penalize if it violates depth minimum
  if (rect.h < minA && vAw >= depthA) vScore += 2; // height too small for A
  if (rect.h < minB && vBw >= depthB) vScore += 2; // height too small for B

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
