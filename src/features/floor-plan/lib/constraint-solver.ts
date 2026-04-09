/**
 * Constraint-Based Layout Solver
 *
 * Replaces sequential BSP → patch → patch approach with holistic constraint
 * solving.  Generates many candidate layouts via Zone-Row placement, scores
 * each against ALL constraints simultaneously, refines the top candidates,
 * and returns the single best layout.
 *
 * Hard constraints (must satisfy):
 *   - Every room within footprint
 *   - Zero overlaps
 *   - Room minimums (width, depth, area) from NBC 2016
 *   - Aspect ratio caps
 *
 * Soft constraints (scored 0-100):
 *   - Adjacency satisfaction
 *   - Zone separation (public/private)
 *   - Space efficiency (≥93% target)
 *   - Room proportion quality
 *   - Area match to targets
 *   - Vastu compliance (when requested)
 *
 * Pure synchronous — no AI calls, runs in <1s.
 */

import type {
  EnhancedRoomProgram,
  RoomSpec,
  AdjacencyRequirement,
} from "@/features/floor-plan/lib/ai-room-programmer";
import type { PlacedRoom } from "@/features/floor-plan/lib/layout-engine";

// ── Grid snap (match layout-engine.ts) ──────────────────────────────────────

const GRID = 0.1;
function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function ar(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 999;
  return Math.max(w, h) / Math.min(w, h);
}

// ── Constants ───────────────────────────────────────────────────────────────

const CORRIDOR_DEPTH = 1.2;
const MIN_CORRIDOR = 1.0;
const DEFAULT_ASPECT = 1.33;
const MAX_ROOM_AR = 2.8;

// ── Room Standard Minimums (NBC 2016 + architectural best practice) ─────────

interface RoomMinimums {
  minWidth: number;   // meters
  minDepth: number;   // meters
  minArea: number;    // sqm
  maxAR: number;      // aspect ratio cap
  maxArea?: number;   // sqm (for bathrooms)
}

function getRoomMinimums(type: string, name: string): RoomMinimums {
  const n = name.toLowerCase();
  const t = type.toLowerCase();

  if (t === "bedroom" || n.includes("bedroom")) {
    if (n.includes("master")) return { minWidth: 3.0, minDepth: 3.0, minArea: 12.0, maxAR: 2.2 };
    return { minWidth: 3.0, minDepth: 2.7, minArea: 9.5, maxAR: 2.2 };
  }
  if (t === "living" || n.includes("living")) return { minWidth: 3.0, minDepth: 2.4, minArea: 9.5, maxAR: 2.0 };
  if (t === "dining" || n.includes("dining")) return { minWidth: 2.4, minDepth: 2.4, minArea: 7.0, maxAR: 2.0 };
  if (t === "kitchen" || n.includes("kitchen")) return { minWidth: 2.2, minDepth: 2.1, minArea: 5.5, maxAR: 2.0 };
  if (t === "bathroom" || n.includes("bath") || n.includes("toilet") || n.includes("wc"))
    return { minWidth: 1.5, minDepth: 1.2, minArea: 2.8, maxAR: 2.0, maxArea: 5.5 };
  if (t === "hallway" || n.includes("corridor") || n.includes("passage"))
    return { minWidth: 1.0, minDepth: 1.0, minArea: 1.5, maxAR: 15.0 };
  if (n.includes("study") || n.includes("office") || n.includes("cabin"))
    return { minWidth: 2.4, minDepth: 2.4, minArea: 6.0, maxAR: 2.0 };
  if (t === "balcony" || n.includes("balcony") || n.includes("sitout"))
    return { minWidth: 1.2, minDepth: 1.2, minArea: 2.0, maxAR: 4.0, maxArea: 10.0 };
  if (n.includes("utility") || n.includes("store") || t === "utility" || t === "storage")
    return { minWidth: 1.5, minDepth: 1.2, minArea: 2.0, maxAR: 2.5, maxArea: 6.0 };
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer"))
    return { minWidth: 1.5, minDepth: 1.5, minArea: 2.5, maxAR: 1.5, maxArea: 6.0 };
  if (n.includes("foyer") || n.includes("entrance") || n.includes("reception"))
    return { minWidth: 1.5, minDepth: 1.5, minArea: 2.5, maxAR: 2.5 };
  if (n.includes("staircase") || t === "staircase")
    return { minWidth: 2.5, minDepth: 2.5, minArea: 6.0, maxAR: 2.0 };
  if (n.includes("servant") || n.includes("maid") || n.includes("driver"))
    return { minWidth: 2.4, minDepth: 2.4, minArea: 7.0, maxAR: 1.8 };
  if (n.includes("conference") || n.includes("meeting"))
    return { minWidth: 3.0, minDepth: 3.0, minArea: 12.0, maxAR: 2.0 };
  if (n.includes("pantry") || n.includes("break"))
    return { minWidth: 2.0, minDepth: 2.0, minArea: 4.0, maxAR: 2.0 };
  if (n.includes("parking") || n.includes("garage"))
    return { minWidth: 2.5, minDepth: 5.0, minArea: 12.5, maxAR: 3.0 };

  // Default: habitable room
  return { minWidth: 2.4, minDepth: 2.0, minArea: 4.0, maxAR: 2.5 };
}

// ── Scoring types ───────────────────────────────────────────────────────────

export interface LayoutScore {
  total: number;
  hardViolations: number;
  adjacencyScore: number;
  efficiencyScore: number;
  proportionScore: number;
  areaMatchScore: number;
  zoneScore: number;
}

export interface SolverConfig {
  maxCandidates?: number;
  minScoreThreshold?: number;
  timeoutMs?: number;
}

export interface SolverResult {
  layout: PlacedRoom[];
  score: LayoutScore;
  candidatesEvaluated: number;
  strategy: string;
}

// ── Zone classification ─────────────────────────────────────────────────────

type ZoneType = "public" | "private" | "service" | "balcony" | "circulation";

function classifyRoom(r: RoomSpec): ZoneType {
  const n = r.name.toLowerCase();
  const t = r.type.toLowerCase();

  if (t === "hallway" || n.includes("corridor") || n.includes("passage")) return "circulation";
  if (t === "balcony" || n.includes("balcony") || n.includes("sitout") || n.includes("verandah")) return "balcony";
  if (t === "bedroom" || n.includes("bedroom") || n.includes("master")) return "private";
  if (t === "bathroom" || n.includes("bath") || n.includes("toilet") || n.includes("wc")) return "private";
  if (n.includes("study") || n.includes("pooja") || n.includes("puja") || n.includes("prayer")) return "private";
  if (n.includes("utility") || n.includes("store") || t === "utility" || t === "storage") return "private";
  if (n.includes("servant") || n.includes("maid") || n.includes("driver")) return "service";
  if (t === "kitchen" || n.includes("kitchen")) return "public";
  if (t === "dining" || n.includes("dining")) return "public";
  if (t === "living" || n.includes("living") || n.includes("drawing")) return "public";
  if (n.includes("foyer") || n.includes("entrance") || n.includes("reception") || n.includes("lobby")) return "public";

  // Default: place in public if zone says so, otherwise private
  if (r.zone === "public") return "public";
  if (r.zone === "private" || r.zone === "service") return "private";
  return "public";
}

function isBedroom(r: RoomSpec): boolean {
  return r.type === "bedroom" || r.name.toLowerCase().includes("bedroom") || r.name.toLowerCase().includes("master");
}

function isBathroom(r: RoomSpec): boolean {
  const n = r.name.toLowerCase();
  return r.type === "bathroom" || n.includes("bath") || n.includes("toilet") || n.includes("wc");
}

// ── Bedroom-Bathroom pairing ────────────────────────────────────────────────

interface BedBathPair {
  bedroom: RoomSpec;
  bathroom: RoomSpec | null;
}

function pairBedroomsBathrooms(
  rooms: RoomSpec[],
  adjacency: AdjacencyRequirement[],
): { pairs: BedBathPair[]; otherPrivate: RoomSpec[] } {
  const bedrooms = rooms.filter(isBedroom);
  const bathrooms = rooms.filter(isBathroom);
  const others = rooms.filter(r => !isBedroom(r) && !isBathroom(r));

  // Sort: master first, then by area desc
  bedrooms.sort((a, b) => {
    const am = a.name.toLowerCase().includes("master") ? 1 : 0;
    const bm = b.name.toLowerCase().includes("master") ? 1 : 0;
    if (am !== bm) return bm - am;
    return b.areaSqm - a.areaSqm;
  });

  const pairs: BedBathPair[] = [];
  const usedBaths = new Set<string>();

  for (const bed of bedrooms) {
    // Try adjacency-required bathroom first
    let match: RoomSpec | null = null;
    for (const adj of adjacency) {
      const bathName = adj.roomA === bed.name ? adj.roomB : adj.roomB === bed.name ? adj.roomA : null;
      if (bathName) {
        match = bathrooms.find(b => b.name === bathName && !usedBaths.has(b.name)) ?? null;
        if (match) break;
      }
    }
    // Fallback: first unused bathroom
    if (!match) match = bathrooms.find(b => !usedBaths.has(b.name)) ?? null;

    if (match) usedBaths.add(match.name);
    pairs.push({ bedroom: bed, bathroom: match });
  }

  // Unpaired bathrooms go to otherPrivate
  const unpairedBaths = bathrooms.filter(b => !usedBaths.has(b.name));
  return { pairs, otherPrivate: [...others, ...unpairedBaths] };
}

// ── Adjacency check ─────────────────────────────────────────────────────────

function areAdjacent(a: PlacedRoom, b: PlacedRoom, tol = 0.15, minWall = 0.5): boolean {
  // Horizontal adjacency (share vertical wall)
  const touchH =
    Math.abs((a.x + a.width) - b.x) < tol ||
    Math.abs((b.x + b.width) - a.x) < tol;
  if (touchH) {
    const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    if (overlapY >= minWall) return true;
  }
  // Vertical adjacency (share horizontal wall)
  const touchV =
    Math.abs((a.y + a.depth) - b.y) < tol ||
    Math.abs((b.y + b.depth) - a.y) < tol;
  if (touchV) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (overlapX >= minWall) return true;
  }
  return false;
}

// ── Hard constraint check ───────────────────────────────────────────────────

function countHardViolations(layout: PlacedRoom[], fpW: number, fpH: number): number {
  let v = 0;
  const TOL = 0.15;

  for (const room of layout) {
    // Within footprint
    if (room.x < -TOL || room.y < -TOL) v++;
    if (room.x + room.width > fpW + TOL) v++;
    if (room.y + room.depth > fpH + TOL) v++;

    // Minimum dimensions
    const mins = getRoomMinimums(room.type, room.name);
    if (room.width < mins.minWidth - TOL) v++;
    if (room.depth < mins.minDepth - TOL) v++;
    if (room.width * room.depth < mins.minArea * 0.8) v++; // 20% tolerance on area
    // AR check (skip corridors, allow 0.5 tolerance for solver flexibility)
    if (mins.maxAR < 10 && ar(room.width, room.depth) > mins.maxAR + 0.5) v++;
  }

  // Overlap check
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i], b = layout[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (ox > TOL && oy > TOL) v++;
    }
  }

  return v;
}

// ── Scoring engine ──────────────────────────────────────────────────────────

function scoreLayout(
  layout: PlacedRoom[],
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
): LayoutScore {
  const hardViolations = countHardViolations(layout, fpW, fpH);

  if (hardViolations > 0) {
    return { total: 0, hardViolations, adjacencyScore: 0, efficiencyScore: 0, proportionScore: 0, areaMatchScore: 0, zoneScore: 0 };
  }

  // ── Adjacency score (0-25) ──
  let adjScore = 0;
  const adjMax = Math.max(program.adjacency.length * 5, 1);
  for (const req of program.adjacency) {
    const a = layout.find(r => r.name === req.roomA);
    const b = layout.find(r => r.name === req.roomB);
    if (a && b && areAdjacent(a, b)) {
      adjScore += 5;
    }
  }
  // Also check implicit bedroom-bathroom adjacency
  const bedrooms = layout.filter(r => isBedroom(r as unknown as RoomSpec));
  const bathrooms = layout.filter(r => isBathroom(r as unknown as RoomSpec));
  let implicitAdj = 0;
  let implicitTotal = 0;
  for (const bed of bedrooms) {
    const pairedBath = bathrooms.find(b => {
      const bedNum = bed.name.match(/\d+/)?.[0] ?? "";
      const bathNum = b.name.match(/\d+/)?.[0] ?? "";
      return bedNum === bathNum || b.name.toLowerCase().includes("master") === bed.name.toLowerCase().includes("master");
    });
    if (pairedBath) {
      implicitTotal++;
      if (areAdjacent(bed, pairedBath)) implicitAdj++;
    }
  }
  if (implicitTotal > 0) adjScore += (implicitAdj / implicitTotal) * 10;

  const adjacencyScore = Math.min(25, (adjScore / Math.max(adjMax + 10, 1)) * 25);

  // ── Efficiency score (0-15) ──
  const totalRoomArea = layout.reduce((s, r) => s + r.width * r.depth, 0);
  const footprintArea = fpW * fpH;
  const efficiency = totalRoomArea / footprintArea;
  let efficiencyScore: number;
  if (efficiency >= 0.97) efficiencyScore = 15;
  else if (efficiency >= 0.95) efficiencyScore = 13;
  else if (efficiency >= 0.93) efficiencyScore = 11;
  else if (efficiency >= 0.90) efficiencyScore = 8;
  else if (efficiency >= 0.85) efficiencyScore = 5;
  else efficiencyScore = 2;

  // ── Proportion score (0-15) ──
  let propPoints = 0;
  for (const room of layout) {
    const mins = getRoomMinimums(room.type, room.name);
    const roomAR = ar(room.width, room.depth);
    if (roomAR <= mins.maxAR) propPoints += 1.5;
    else if (roomAR <= mins.maxAR + 0.5) propPoints += 0.5;
  }
  const proportionScore = Math.min(15, (propPoints / Math.max(layout.length, 1)) * 15);

  // ── Area accuracy score (0-20) — penalize oversized small rooms ──
  let areaAccPoints = 0;
  const numRooms = layout.filter(r => r.type !== "hallway").length;
  for (const room of layout) {
    if (room.type === "hallway") continue;
    const spec = program.rooms.find(s => s.name === room.name);
    if (!spec) continue;
    const actual = room.width * room.depth;
    const target = spec.areaSqm;
    const mins = getRoomMinimums(room.type, room.name);
    const maxArea = mins.maxArea ?? Infinity;
    const ratio = actual / target;

    if (actual > maxArea * 1.1) {
      // Oversized beyond type maximum — heavy penalty
      areaAccPoints -= 3;
    } else if (ratio >= 0.8 && ratio <= 1.3) {
      areaAccPoints += 2;   // within ±20-30% — excellent
    } else if (ratio > 1.3 && ratio <= 1.6) {
      areaAccPoints += 0.5; // slightly over — acceptable for large rooms
    } else if (ratio > 1.6) {
      // Significantly oversized
      const isSmallType = isBathroom(spec) || spec.type === "utility" || spec.type === "storage" ||
        spec.name.toLowerCase().includes("pooja") || spec.name.toLowerCase().includes("puja");
      areaAccPoints -= isSmallType ? 3 : 1;
    } else {
      areaAccPoints -= 0.5; // undersized
    }
  }
  const areaMatchScore = Math.max(0, Math.min(20, 10 + areaAccPoints));

  // ── Zone score (0-10) ──
  let zoneScore = 0;
  const midY = fpH / 2;
  let publicAbove = 0, publicBelow = 0, privateAbove = 0, privateBelow = 0;
  for (const room of layout) {
    const spec = program.rooms.find(s => s.name === room.name);
    if (!spec) continue;
    const zone = classifyRoom(spec);
    const center = room.y + room.depth / 2;
    if (zone === "public") { if (center > midY) publicBelow++; else publicAbove++; }
    if (zone === "private") { if (center < midY) privateAbove++; else privateBelow++; }
  }
  const sepA = privateAbove + publicBelow;
  const sepB = publicAbove + privateBelow;
  const totalClassified = publicAbove + publicBelow + privateAbove + privateBelow;
  if (totalClassified > 0) {
    const bestSep = Math.max(sepA, sepB);
    zoneScore = (bestSep / totalClassified) * 10;
  } else {
    zoneScore = 7;
  }

  // Total: adjacency(25) + efficiency(15) + proportion(15) + areaMatch(20) + zone(10) = 85 max
  // Normalize to ~100 scale
  const rawTotal = adjacencyScore + efficiencyScore + proportionScore + areaMatchScore + zoneScore;
  const total = Math.round(Math.min(100, rawTotal * (100 / 85)));

  return { total, hardViolations: 0, adjacencyScore, efficiencyScore, proportionScore, areaMatchScore, zoneScore };
}

// ── Bathroom area cap (Indian residential standards) ─────────────────────────

/** Maximum bathroom area based on paired bedroom type. */
function getMaxBathArea(bedroom: RoomSpec, bathroom: RoomSpec): number {
  const bedName = bedroom.name.toLowerCase();
  if (bedName.includes("master")) return 6.5;  // master bath: generous
  return 4.5;  // standard attached bath: 4.5 sqm
}

// ── Zone-Row Candidate Generator ────────────────────────────────────────────

interface CandidateConfig {
  privateRatio: number;    // fraction of footprint depth for private zone
  corridorDepth: number;   // corridor depth in meters
  flip: boolean;           // if true, public on top, private on bottom
  pairOrder: number[];     // indices into pairs array for ordering
  bathBelow: boolean;      // true = bathrooms below bedrooms in private strip
  publicOrder: number[];   // indices into public room array for ordering
}

function generateCandidate(
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
  config: CandidateConfig,
): PlacedRoom[] | null {
  const allRooms = program.rooms;
  const privateRooms = allRooms.filter(r => classifyRoom(r) === "private");
  const publicRooms = allRooms.filter(r =>
    classifyRoom(r) === "public" || classifyRoom(r) === "service"
  );
  const balconyRooms = allRooms.filter(r => classifyRoom(r) === "balcony");

  // Skip corridor from input (we generate our own)
  const corridorFromInput = allRooms.find(r =>
    r.type === "hallway" || r.name.toLowerCase().includes("corridor")
  );

  const { pairs, otherPrivate } = pairBedroomsBathrooms(privateRooms, program.adjacency);

  // ── Zone dimensions ──
  const needsCorridor = privateRooms.length > 0 && (publicRooms.length > 0 || balconyRooms.length > 0);
  const corDepth = needsCorridor ? grid(Math.max(config.corridorDepth, MIN_CORRIDOR)) : 0;

  // Calculate minimum private zone depth — depends on split strategy
  let minPrivateDepth = 0;
  if (privateRooms.length > 0) {
    minPrivateDepth = 2.4;
    if (pairs.length > 0) {
      const bedMinDepths = pairs.map(p => getRoomMinimums(p.bedroom.type, p.bedroom.name).minDepth);
      const maxBedMin = Math.max(...bedMinDepths, 2.7);
      // Check if vertical splits are feasible
      const vertMinW = 2.0 + 1.5; // verticalBedMinW + bathMinWidth
      const neededW = pairs.length * vertMinW + otherPrivate.length * 1.5;
      if (fpW >= neededW) {
        // Vertical splits — only need bedroom depth
        minPrivateDepth = maxBedMin;
      } else {
        // Horizontal stacking — need bed + bath
        const bathMinDepths = pairs.filter(p => p.bathroom).map(p => getRoomMinimums(p.bathroom!.type, p.bathroom!.name).minDepth);
        const maxBathMin = bathMinDepths.length > 0 ? Math.max(...bathMinDepths, 1.2) : 0;
        minPrivateDepth = maxBedMin + maxBathMin;
      }
    }
  }

  let privateDepth = privateRooms.length > 0
    ? grid(Math.max(fpH * config.privateRatio, minPrivateDepth))
    : 0;

  let remainingForPublic = grid(fpH - privateDepth - corDepth);
  if (remainingForPublic < 2.4 && privateDepth > 0) {
    const available = fpH - corDepth - 2.4;
    if (available < minPrivateDepth) return null;
    privateDepth = grid(Math.min(privateDepth, available));
    remainingForPublic = grid(fpH - privateDepth - corDepth);
  }

  if (privateDepth > 0 && (privateDepth < minPrivateDepth - 0.1 || remainingForPublic < 2.0)) return null;
  if (privateDepth === 0 && remainingForPublic < 2.0) return null;

  const pubDepth = remainingForPublic;

  // Zone Y positions
  let privateY: number, corY: number, publicY: number;
  if (config.flip && privateDepth > 0) {
    publicY = 0;
    corY = pubDepth;
    privateY = pubDepth + corDepth;
  } else {
    privateY = 0;
    corY = privateDepth;
    publicY = privateDepth + corDepth;
  }

  const result: PlacedRoom[] = [];

  // ── PRIVATE ZONE: multi-row layout for bed-bath pairs ──
  // Reorder pairs
  const orderedPairs = config.pairOrder
    .filter(i => i < pairs.length)
    .map(i => pairs[i]);
  for (let i = 0; i < pairs.length; i++) {
    if (!config.pairOrder.includes(i)) orderedPairs.push(pairs[i]);
  }

  // Build groups: bed-bath pairs + other private rooms
  const allPrivateGroups: { rooms: RoomSpec[]; totalArea: number }[] = [];
  for (const p of orderedPairs) {
    const rooms = p.bathroom ? [p.bedroom, p.bathroom] : [p.bedroom];
    allPrivateGroups.push({ rooms, totalArea: rooms.reduce((s, r) => s + r.areaSqm, 0) });
  }
  const smallOther: RoomSpec[] = [];
  for (const r of otherPrivate) {
    if (r.areaSqm < 6 && smallOther.reduce((s, x) => s + x.areaSqm, 0) + r.areaSqm < 12) {
      smallOther.push(r);
    } else {
      allPrivateGroups.push({ rooms: [r], totalArea: r.areaSqm });
    }
  }
  if (smallOther.length > 0) {
    allPrivateGroups.push({ rooms: smallOther, totalArea: smallOther.reduce((s, r) => s + r.areaSqm, 0) });
  }

  if (allPrivateGroups.length === 0 && publicRooms.length === 0) return null;

  // ── Split into multiple rows if one row can't fit all groups ──
  // Each bed-bath pair needs ~3.5m width. If total needed > fpW, use 2+ rows.
  // Allow tighter packing: 2.5m min strip width handles bed-bath vertical splits
  const MIN_STRIP_W = 2.5;
  const maxGroupsPerRow = Math.max(3, Math.floor(fpW / MIN_STRIP_W));
  const privateRows: typeof allPrivateGroups[] = [];

  // Distribute groups across rows
  let remaining = [...allPrivateGroups];
  while (remaining.length > 0) {
    const rowSize = Math.min(remaining.length, maxGroupsPerRow);
    privateRows.push(remaining.slice(0, rowSize));
    remaining = remaining.slice(rowSize);
  }

  // Each row gets a proportional share of the private zone depth
  const privateTotalArea = allPrivateGroups.reduce((s, g) => s + g.totalArea, 0);
  const rowAreas = privateRows.map(row => row.reduce((s, g) => s + g.totalArea, 0));
  const totalRowArea = rowAreas.reduce((s, a) => s + a, 0);

  let currentY = privateY;
  for (let rowIdx = 0; rowIdx < privateRows.length; rowIdx++) {
    const row = privateRows[rowIdx];
    const isLastRow = rowIdx === privateRows.length - 1;
    const rowDepth = isLastRow
      ? grid(privateY + privateDepth - currentY)
      : grid(Math.max(privateDepth * (rowAreas[rowIdx] / totalRowArea), 2.4));

    if (rowDepth < 1.2) continue; // absolute minimum

    // Place groups in this row as horizontal strips
    // Pre-allocate widths: each group gets minimum + proportional extra (same as public zone)
    const rowTotalArea = row.reduce((s, g) => s + g.totalArea, 0);
    const stripMinW = 1.5; // absolute minimum per strip
    const totalMinW = row.length * stripMinW;
    const extraW = Math.max(0, fpW - totalMinW);
    const rowWidths: number[] = [];
    for (let gi = 0; gi < row.length; gi++) {
      const ratio = rowTotalArea > 0 ? row[gi].totalArea / rowTotalArea : 1 / row.length;
      rowWidths.push(grid(stripMinW + extraW * ratio));
    }
    // Adjust last to absorb rounding
    if (rowWidths.length > 0) {
      const used = rowWidths.reduce((s, w) => s + w, 0);
      rowWidths[rowWidths.length - 1] = grid(rowWidths[rowWidths.length - 1] + (fpW - used));
    }

    let px = 0;

    for (let gi = 0; gi < row.length; gi++) {
      const group = row[gi];
      const stripW = rowWidths[gi];

    if (stripW < 1.0) return null;

    if (group.rooms.length === 1) {
      // Single room fills the strip
      result.push({
        name: group.rooms[0].name,
        type: group.rooms[0].type,
        x: grid(px), y: grid(currentY),
        width: grid(stripW), depth: grid(rowDepth),
        area: grid(stripW * rowDepth),
      });
    } else if (group.rooms.length === 2 && isBedroom(group.rooms[0]) && isBathroom(group.rooms[1])) {
      // Bedroom-bathroom pair — try vertical split (side-by-side) first,
      // fall back to horizontal (stacked) if strip is too narrow.
      const bed = group.rooms[0];
      const bath = group.rooms[1];
      const bedMins = getRoomMinimums(bed.type, bed.name);
      const bathMins = getRoomMinimums(bath.type, bath.name);
      const bathMaxAR = bathMins.maxAR || 2.0;

      // Cap bathroom area per architectural standards (Indian residential)
      const maxBathArea = getMaxBathArea(bed, bath);
      const bathTargetArea = Math.min(bath.areaSqm, maxBathArea);

      // ── Try vertical split (side-by-side, bathroom with capped depth) ──
      // For the vertical split, the bedroom can be narrower than its standalone minimum
      // because it compensates with full zone depth. The critical minimum is that the
      // bedroom's shorter dimension ≥ 2.4m (NBC habitable) not the full 3.0m (furniture).
      // In a vertical pair, the bedroom gets full zone depth (typically 3.9-5.2m),
      // so it can be narrower than the standalone minimum (3.0m). 2.0m width is the
      // absolute floor — below that even a single bed doesn't fit.
      const verticalBedMinW = 2.0;
      const canVertical = stripW >= verticalBedMinW + bathMins.minWidth;

      if (canVertical) {
        let bathW = grid(Math.max(bathMins.minWidth, Math.sqrt(bathTargetArea / bathMaxAR)));
        if (bathW > stripW - verticalBedMinW) bathW = grid(stripW - verticalBedMinW);
        const bedW = grid(stripW - bathW);

        let bathDepth = grid(Math.max(bathMins.minDepth,
          Math.min(bathTargetArea / bathW, bathW * bathMaxAR, rowDepth)));

        const bathY = config.bathBelow
          ? grid(currentY + rowDepth - bathDepth)
          : grid(currentY);

        result.push({
          name: bed.name, type: bed.type,
          x: grid(px), y: grid(currentY),
          width: grid(bedW), depth: grid(rowDepth),
          area: grid(bedW * rowDepth),
        });
        result.push({
          name: bath.name, type: bath.type,
          x: grid(px + bedW), y: grid(bathY),
          width: grid(bathW), depth: grid(bathDepth),
          area: grid(bathW * bathDepth),
        });
      } else {
        // ── Horizontal split (stacked) with area-capped bathroom ──
        let bathDepth = grid(Math.max(bathMins.minDepth,
          Math.min(bathTargetArea / stripW, stripW * bathMaxAR, rowDepth * 0.4)));
        let bedDepth = grid(rowDepth - bathDepth);

        if (bedDepth < bedMins.minDepth) {
          bedDepth = grid(bedMins.minDepth);
          bathDepth = grid(rowDepth - bedDepth);
        }
        if (bathDepth < bathMins.minDepth) {
          bathDepth = grid(bathMins.minDepth);
          bedDepth = grid(rowDepth - bathDepth);
        }
        if (bedDepth < 1.0 || bathDepth < 0.8) return null;

        if (config.bathBelow) {
          result.push({
            name: bed.name, type: bed.type,
            x: grid(px), y: grid(currentY),
            width: grid(stripW), depth: grid(bedDepth),
            area: grid(stripW * bedDepth),
          });
          result.push({
            name: bath.name, type: bath.type,
            x: grid(px), y: grid(currentY + bedDepth),
            width: grid(stripW), depth: grid(bathDepth),
            area: grid(stripW * bathDepth),
          });
        } else {
          result.push({
            name: bath.name, type: bath.type,
            x: grid(px), y: grid(currentY),
            width: grid(stripW), depth: grid(bathDepth),
            area: grid(stripW * bathDepth),
          });
          result.push({
            name: bed.name, type: bed.type,
            x: grid(px), y: grid(currentY + bathDepth),
            width: grid(stripW), depth: grid(bedDepth),
            area: grid(stripW * bedDepth),
          });
        }
      }
    } else {
      // Multiple rooms: stack vertically within strip
      const totalArea = group.rooms.reduce((s, r) => s + r.areaSqm, 0);
      let ry = currentY;
      for (let ri = 0; ri < group.rooms.length; ri++) {
        const room = group.rooms[ri];
        const isLastRoom = ri === group.rooms.length - 1;
        const roomDepth = isLastRoom
          ? grid(currentY + rowDepth - ry)
          : grid(Math.max(rowDepth * (room.areaSqm / totalArea), 1.2));

        result.push({
          name: room.name, type: room.type,
          x: grid(px), y: grid(ry),
          width: grid(stripW), depth: grid(roomDepth),
          area: grid(stripW * roomDepth),
        });
        ry = grid(ry + roomDepth);
      }
    }

      px = grid(px + stripW);
    } // end strip loop

    currentY = grid(currentY + rowDepth);
  } // end row loop

  // ── CORRIDOR (only when both zones exist) ──
  const hasPrivateContent = allPrivateGroups.length > 0 && allPrivateGroups.some(g => g.rooms.length > 0);
  const hasPublicContent = publicRooms.length > 0 || balconyRooms.length > 0;
  if (hasPrivateContent && hasPublicContent && corDepth > 0) {
    const corName = corridorFromInput?.name ?? "Corridor";
    result.push({
      name: corName, type: "hallway",
      x: 0, y: grid(corY),
      width: grid(fpW), depth: grid(corDepth),
      area: grid(fpW * corDepth),
    });
  }

  // ── PUBLIC ZONE: rooms placed left-to-right ──
  // Merge balconies into public zone (place at edge)
  const allPublic = [...publicRooms];
  // Reorder public rooms
  const orderedPublic: RoomSpec[] = [];
  for (const idx of config.publicOrder) {
    if (idx < allPublic.length) orderedPublic.push(allPublic[idx]);
  }
  for (let i = 0; i < allPublic.length; i++) {
    if (!config.publicOrder.includes(i)) orderedPublic.push(allPublic[i]);
  }

  // Add balconies at the end (right edge)
  orderedPublic.push(...balconyRooms);

  const publicTotalArea = orderedPublic.reduce((s, r) => s + r.areaSqm, 0);

  // Pre-calculate strip widths, enforcing minimum widths for ALL rooms
  const pubWidths: number[] = [];
  const pubMinWidths = orderedPublic.map(r => getRoomMinimums(r.type, r.name).minWidth);
  const totalMinW = pubMinWidths.reduce((s, w) => s + w, 0);
  const extraW = Math.max(0, fpW - totalMinW); // width beyond all minimums

  for (let pi = 0; pi < orderedPublic.length; pi++) {
    const room = orderedPublic[pi];
    const ratio = publicTotalArea > 0 ? room.areaSqm / publicTotalArea : 1 / orderedPublic.length;
    // Each room gets its minimum + a proportional share of the extra
    const w = grid(pubMinWidths[pi] + extraW * ratio);
    pubWidths.push(w);
  }
  // Adjust last room to absorb any rounding remainder
  if (pubWidths.length > 0) {
    const usedW = pubWidths.reduce((s, w) => s + w, 0);
    pubWidths[pubWidths.length - 1] = grid(pubWidths[pubWidths.length - 1] + (fpW - usedW));
  }

  let pubX = 0;

  for (let pi = 0; pi < orderedPublic.length; pi++) {
    const room = orderedPublic[pi];
    const roomW = pubWidths[pi];

    if (roomW < 0.5) return null;

    result.push({
      name: room.name, type: room.type,
      x: grid(pubX), y: grid(publicY),
      width: grid(roomW), depth: grid(pubDepth),
      area: grid(roomW * pubDepth),
    });
    pubX = grid(pubX + roomW);
  }

  return result;
}

// ── Permutation helper ──────────────────────────────────────────────────────

function permutations(n: number): number[][] {
  if (n <= 0) return [[]];
  if (n === 1) return [[0]];
  if (n === 2) return [[0, 1], [1, 0]];
  if (n === 3) return [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  // For n >= 4, limit to first few orderings to stay fast
  const result: number[][] = [];
  const base = Array.from({ length: n }, (_, i) => i);
  result.push([...base]);
  result.push([...base].reverse());
  // Shift by 1
  result.push([...base.slice(1), base[0]]);
  if (n >= 5) {
    result.push([...base.slice(2), ...base.slice(0, 2)]);
  }
  return result;
}

// ── Optimizer: micro-adjust top candidates ──────────────────────────────────

function optimize(layout: PlacedRoom[], program: EnhancedRoomProgram, fpW: number, fpH: number): PlacedRoom[] {
  // Work on a copy
  let best = layout.map(r => ({ ...r }));
  let bestScore = scoreLayout(best, program, fpW, fpH).total;

  // Try swapping pairs of same-zone rooms to improve adjacency
  for (let i = 0; i < best.length; i++) {
    for (let j = i + 1; j < best.length; j++) {
      const a = best[i], b = best[j];
      // Only swap if similar size (within 50%)
      const areaA = a.width * a.depth;
      const areaB = b.width * b.depth;
      if (Math.abs(areaA - areaB) / Math.max(areaA, areaB) > 0.5) continue;

      // Swap identities (not positions)
      const candidate = best.map(r => ({ ...r }));
      candidate[i] = { ...a, name: b.name, type: b.type };
      candidate[j] = { ...b, name: a.name, type: a.type };
      // Recalculate areas
      candidate[i].area = grid(candidate[i].width * candidate[i].depth);
      candidate[j].area = grid(candidate[j].width * candidate[j].depth);

      const score = scoreLayout(candidate, program, fpW, fpH);
      if (score.total > bestScore && score.hardViolations === 0) {
        best = candidate;
        bestScore = score.total;
      }
    }
  }

  return best;
}

// ── Public-only layout (for duplex ground floors, all-public/service rooms) ──

function generatePublicOnlyLayout(
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
): PlacedRoom[] | null {
  const rooms = program.rooms.filter(r =>
    r.type !== "hallway" && !r.name.toLowerCase().includes("corridor")
  );
  if (rooms.length === 0) return null;

  // Sort: largest first
  const sorted = [...rooms].sort((a, b) => b.areaSqm - a.areaSqm);
  const totalArea = sorted.reduce((s, r) => s + r.areaSqm, 0);

  // Simple 2-row grid: large rooms in row 1, small rooms in row 2
  const midIdx = Math.max(1, Math.ceil(sorted.length / 2));
  const row1 = sorted.slice(0, midIdx);
  const row2 = sorted.slice(midIdx);
  const row1Area = row1.reduce((s, r) => s + r.areaSqm, 0);
  const row2Area = row2.reduce((s, r) => s + r.areaSqm, 0);

  // Row depths proportional to area
  const row1Depth = grid(fpH * (row1Area / totalArea));
  const row2Depth = grid(fpH - row1Depth);
  if (row1Depth < 2.0 || (row2.length > 0 && row2Depth < 1.5)) return null;

  const result: PlacedRoom[] = [];

  // Row 1
  const row1Total = row1.reduce((s, r) => s + r.areaSqm, 0);
  let x1 = 0;
  for (let i = 0; i < row1.length; i++) {
    const room = row1[i];
    const isLast = i === row1.length - 1;
    const mins = getRoomMinimums(room.type, room.name);
    const ratio = row1Total > 0 ? room.areaSqm / row1Total : 1 / row1.length;
    const w = isLast ? grid(fpW - x1) : grid(Math.max(fpW * ratio, mins.minWidth));
    result.push({
      name: room.name, type: room.type,
      x: grid(x1), y: 0,
      width: grid(w), depth: grid(row1Depth),
      area: grid(w * row1Depth),
    });
    x1 = grid(x1 + w);
  }

  // Row 2
  if (row2.length > 0) {
    const row2Total = row2.reduce((s, r) => s + r.areaSqm, 0);
    let x2 = 0;
    for (let i = 0; i < row2.length; i++) {
      const room = row2[i];
      const isLast = i === row2.length - 1;
      const mins = getRoomMinimums(room.type, room.name);
      const ratio = row2Total > 0 ? room.areaSqm / row2Total : 1 / row2.length;
      const w = isLast ? grid(fpW - x2) : grid(Math.max(fpW * ratio, mins.minWidth));
      result.push({
        name: room.name, type: room.type,
        x: grid(x2), y: grid(row1Depth),
        width: grid(w), depth: grid(row2Depth),
        area: grid(w * row2Depth),
      });
      x2 = grid(x2 + w);
    }
  }

  return result;
}

// ── Main solver ─────────────────────────────────────────────────────────────

export function solveLayout(
  program: EnhancedRoomProgram,
  config?: SolverConfig,
): SolverResult {
  const maxCandidates = config?.maxCandidates ?? 300;
  const startTime = Date.now();
  const timeoutMs = config?.timeoutMs ?? 2000;

  const rooms = program.rooms.filter(r =>
    r.type !== "hallway" && !r.name.toLowerCase().includes("corridor")
  );

  if (rooms.length === 0) {
    return {
      layout: [],
      score: { total: 0, hardViolations: 0, adjacencyScore: 0, efficiencyScore: 0, proportionScore: 0, areaMatchScore: 0, zoneScore: 0 },
      candidatesEvaluated: 0,
      strategy: "empty",
    };
  }

  // ── Calculate footprint ──
  const roomAreaTotal = rooms.reduce((s, r) => s + r.areaSqm, 0);
  const corridorEstimate = CORRIDOR_DEPTH * Math.sqrt(Math.max(program.totalAreaSqm, roomAreaTotal) * DEFAULT_ASPECT);
  const corridorArea = Math.min(corridorEstimate, roomAreaTotal * 0.08, 12.0);
  const totalArea = Math.max(program.totalAreaSqm, roomAreaTotal + corridorArea);

  let fpW = grid(Math.sqrt(totalArea * DEFAULT_ASPECT));
  let fpH = grid(totalArea / fpW);

  // Ensure minimum footprint for room count
  if (rooms.length >= 10) {
    const minFP = rooms.length * 4.5;
    if (fpW * fpH < minFP) {
      const scale = Math.sqrt(minFP / (fpW * fpH));
      fpW = grid(fpW * scale);
      fpH = grid(fpH * scale);
    }
  }

  // Ensure footprint is WIDE enough for vertical bed-bath pairs
  const privateRoomsAll = rooms.filter(r => classifyRoom(r) === "private");
  const { pairs: tempPairs, otherPrivate: tempOther } = pairBedroomsBathrooms(privateRoomsAll, program.adjacency);
  // Each pair needs ~3.5m width (2.0 bed + 1.5 bath), other rooms need ~2.0m each
  const minFpW = tempPairs.length * 3.5 + Math.ceil(tempOther.length / 2) * 2.0;
  if (fpW < minFpW) {
    fpW = grid(minFpW);
    fpH = grid(totalArea / fpW);
  }

  // Ensure footprint is tall enough for the zone structure:
  // private zone (bed+bath minimums) + corridor + public zone minimum
  // Private zone min depth depends on split strategy:
  // - If footprint is wide enough for vertical splits (side-by-side), just bedroom depth
  // - Otherwise, need bedroom + bathroom stacked
  let minPrivateH = 2.4;
  if (tempPairs.length > 0) {
    const bedMins = tempPairs.map(p => getRoomMinimums(p.bedroom.type, p.bedroom.name).minDepth);
    const bathMinDepths = tempPairs.filter(p => p.bathroom).map(p => getRoomMinimums(p.bathroom!.type, p.bathroom!.name).minDepth);
    const maxBedMin = Math.max(...bedMins, 2.7);
    const maxBathMin = bathMinDepths.length > 0 ? Math.max(...bathMinDepths, 1.2) : 0;
    // Check if vertical splits are feasible at this footprint width
    const minWidthPerPair = 2.0 + 1.5; // verticalBedMinW + bathMinWidth
    const neededWidth = tempPairs.length * minWidthPerPair + Math.ceil(tempOther.length / 2) * 2.0;
    if (fpW >= neededWidth) {
      // Vertical splits feasible — private zone only needs bedroom depth
      minPrivateH = maxBedMin;
    } else {
      // Horizontal stacking needed — need bed + bath depth
      minPrivateH = maxBedMin + maxBathMin;
    }
  }
  const minFpH = minPrivateH + CORRIDOR_DEPTH + 2.4; // private + corridor + public min
  if (fpH < minFpH) {
    fpH = grid(minFpH);
    fpW = grid(totalArea / fpH);
    // Ensure width is also reasonable
    if (fpW < 5.0) fpW = grid(5.0);
  }

  // ── Generate candidates ──
  const privateRooms = rooms.filter(r => classifyRoom(r) === "private");
  const publicRooms = rooms.filter(r =>
    classifyRoom(r) === "public" || classifyRoom(r) === "service"
  );
  const balconyRooms = rooms.filter(r => classifyRoom(r) === "balcony");

  const { pairs } = pairBedroomsBathrooms(privateRooms, program.adjacency);

  // Zone ratios to try
  const privateArea = privateRooms.reduce((s, r) => s + r.areaSqm, 0);
  const publicArea = publicRooms.reduce((s, r) => s + r.areaSqm, 0) + balconyRooms.reduce((s, r) => s + r.areaSqm, 0);
  const totalRoomArea = privateArea + publicArea;

  // Calculate ideal ratio from actual room areas
  const idealPrivateRatio = totalRoomArea > 0
    ? (privateArea / totalRoomArea) * (1 - CORRIDOR_DEPTH / fpH)
    : 0.5;

  const privateRatios = [
    Math.max(0.25, Math.min(0.60, idealPrivateRatio)),
    Math.max(0.25, Math.min(0.60, idealPrivateRatio - 0.05)),
    Math.max(0.25, Math.min(0.60, idealPrivateRatio + 0.05)),
    // Also try lower ratios — shallower private zone makes wider strips
    Math.max(0.25, Math.min(0.60, idealPrivateRatio - 0.10)),
    0.35, // fixed low ratio — good for vertical bed-bath splits
  ];
  const corridorDepths = [CORRIDOR_DEPTH, 1.0];
  const flips = [false, true];
  const bathBelows = [true, false];
  const pairPerms = permutations(pairs.length);
  const publicPerms = permutations(publicRooms.length + balconyRooms.length);

  let bestLayout: PlacedRoom[] | null = null;
  let bestScore: LayoutScore = { total: -1, hardViolations: 999, adjacencyScore: 0, efficiencyScore: 0, proportionScore: 0, areaMatchScore: 0, zoneScore: 0 };
  let candidatesEvaluated = 0;

  for (const pr of privateRatios) {
    for (const cd of corridorDepths) {
      for (const flip of flips) {
        for (const bb of bathBelows) {
          for (const pairOrd of pairPerms) {
            for (const pubOrd of publicPerms) {
              if (candidatesEvaluated >= maxCandidates) break;
              if (Date.now() - startTime > timeoutMs) break;

              const candidate = generateCandidate(program, fpW, fpH, {
                privateRatio: pr,
                corridorDepth: cd,
                flip,
                pairOrder: pairOrd,
                bathBelow: bb,
                publicOrder: pubOrd,
              });

              if (!candidate) continue;
              candidatesEvaluated++;

              const score = scoreLayout(candidate, program, fpW, fpH);

              if (score.total > bestScore.total) {
                bestLayout = candidate;
                bestScore = score;
              }
            }
            if (candidatesEvaluated >= maxCandidates || Date.now() - startTime > timeoutMs) break;
          }
          if (candidatesEvaluated >= maxCandidates || Date.now() - startTime > timeoutMs) break;
        }
        if (candidatesEvaluated >= maxCandidates || Date.now() - startTime > timeoutMs) break;
      }
      if (candidatesEvaluated >= maxCandidates || Date.now() - startTime > timeoutMs) break;
    }
    if (candidatesEvaluated >= maxCandidates || Date.now() - startTime > timeoutMs) break;
  }

  // ── Optimize top candidate ──
  if (bestLayout && bestScore.hardViolations === 0) {
    const optimized = optimize(bestLayout, program, fpW, fpH);
    const optimizedScore = scoreLayout(optimized, program, fpW, fpH);
    if (optimizedScore.total >= bestScore.total) {
      bestLayout = optimized;
      bestScore = optimizedScore;
    }
  }

  // ── If zone-row failed, try public-only layout (e.g., duplex ground floor) ──
  if (!bestLayout || bestScore.total < 30) {
    const pubOnly = generatePublicOnlyLayout(program, fpW, fpH);
    if (pubOnly) {
      const pubScore = scoreLayout(pubOnly, program, fpW, fpH);
      if (pubScore.total > (bestScore?.total ?? 0) && pubScore.hardViolations === 0) {
        bestLayout = pubOnly;
        bestScore = pubScore;
      }
    }
  }

  if (!bestLayout) {
    return {
      layout: [],
      score: { total: 0, hardViolations: 999, adjacencyScore: 0, efficiencyScore: 0, proportionScore: 0, areaMatchScore: 0, zoneScore: 0 },
      candidatesEvaluated,
      strategy: "zone-row-failed",
    };
  }

  return {
    layout: bestLayout,
    score: bestScore,
    candidatesEvaluated,
    strategy: "zone-row",
  };
}
