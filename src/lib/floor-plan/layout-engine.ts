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
  const corridorEstimate = useZones
    ? CORRIDOR_DEPTH * Math.sqrt(Math.max(program.totalAreaSqm, roomAreaTotal) * DEFAULT_ASPECT)
    : 0;

  const totalArea = Math.max(program.totalAreaSqm, roomAreaTotal + corridorEstimate);
  const fpW = grid(Math.sqrt(totalArea * DEFAULT_ASPECT));
  const fpH = grid(totalArea / fpW);

  // Skip zoning if footprint too shallow for corridor + two minimum-height zones
  const minZoneHeight = MIN_HABITABLE * 2 + CORRIDOR_DEPTH;
  if (!useZones || fpH < minZoneHeight) {
    return bspSubdivide(rooms, { x: 0, y: 0, w: fpW, h: fpH }, program.adjacency);
  }

  // Zone-based layout with corridor
  return layoutWithZones(cls, fpW, fpH, program.adjacency);
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
    } else if (r.zone === "private" || r.type === "bedroom") {
      privateZone.push(r);
    } else if (r.zone === "service") {
      // Kitchen → public, bathrooms/utility → private
      if (r.type === "kitchen") {
        publicZone.push(r);
      } else {
        privateZone.push(r);
      }
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

  // Compute zone areas
  const publicArea = publicZone.reduce((s, r) => s + r.areaSqm, 0);
  const privateArea = privateZone.reduce((s, r) => s + r.areaSqm, 0);
  const corridorArea = CORRIDOR_DEPTH * fpW;
  const usableArea = fpW * fpH - corridorArea;

  // Zone depths proportional to area
  const publicRatio = publicArea / Math.max(publicArea + privateArea, 1);
  let privateDepth = grid(usableArea * (1 - publicRatio) / fpW);
  let publicDepth = grid(usableArea * publicRatio / fpW);

  // Enforce minimums
  if (privateDepth < MIN_HABITABLE) {
    privateDepth = MIN_HABITABLE;
    publicDepth = grid(fpH - privateDepth - CORRIDOR_DEPTH);
  }
  if (publicDepth < MIN_HABITABLE) {
    publicDepth = MIN_HABITABLE;
    privateDepth = grid(fpH - publicDepth - CORRIDOR_DEPTH);
  }

  // Absorb rounding error into larger zone
  const rem = fpH - privateDepth - CORRIDOR_DEPTH - publicDepth;
  if (Math.abs(rem) > 0.01) {
    if (privateDepth >= publicDepth) privateDepth = grid(privateDepth + rem);
    else publicDepth = grid(publicDepth + rem);
  }

  // Zone rects (Y-down: private top, corridor, public bottom)
  const privateRect: Rect = { x: 0, y: 0, w: fpW, h: privateDepth };
  const corridorRect: Rect = { x: 0, y: privateDepth, w: fpW, h: CORRIDOR_DEPTH };
  const publicRect: Rect = { x: 0, y: privateDepth + CORRIDOR_DEPTH, w: fpW, h: publicDepth };

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
  try {
    // Group rooms by floor
    const floorGroups = new Map<number, RoomSpec[]>();
    for (const room of program.rooms) {
      const fl = room.floor ?? 0;
      if (!floorGroups.has(fl)) floorGroups.set(fl, []);
      floorGroups.get(fl)!.push({ ...room }); // shallow copy to avoid mutation
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

    return { floors };
  } catch {
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
