/**
 * Courtyard Layout Engine
 *
 * Creates rooms arranged AROUND a central void instead of BSP bands.
 * Traditional in South Indian, Rajasthani, and Kerala architecture.
 *
 *   ┌──────────────────────────┐
 *   │    South strip rooms     │  (entrance side)
 *   ├────┬──────────────┬──────┤
 *   │West│              │ East │
 *   │    │  COURTYARD   │      │
 *   │    │  (open void) │      │
 *   ├────┴──────────────┴──────┤
 *   │    North strip rooms     │  (private side)
 *   └──────────────────────────┘
 *
 * The building footprint is rectangular. The courtyard is an inner
 * rectangle. Rooms fill the ring between outer and inner boundaries.
 * Each strip is BSP-subdivided independently.
 *
 * Pure synchronous function — no AI calls.
 */

import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "@/features/floor-plan/lib/ai-room-programmer";
import type { PlacedRoom } from "@/features/floor-plan/lib/layout-engine";

// ── Grid snap (match layout-engine) ─────────────────────────────────────────

const GRID = 0.1;
const MIN_STRIP = 3.0; // minimum strip width for rooms around courtyard
const MIN_DIM = 1.2;   // minimum room dimension

function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Layout rooms around a central courtyard.
 *
 * @returns PlacedRoom[] if courtyard layout succeeds, null if fallback to BSP needed
 */
export function layoutCourtyardPlan(
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
): PlacedRoom[] | null {
  try {
    // Find the courtyard room
    const courtyardRoom = program.rooms.find(r =>
      r.name.toLowerCase().includes("courtyard") ||
      r.type === "courtyard",
    );
    if (!courtyardRoom) return null;

    // Calculate courtyard dimensions
    let cyW = courtyardRoom.preferredWidth || Math.sqrt(courtyardRoom.areaSqm);
    let cyH = courtyardRoom.preferredDepth || Math.sqrt(courtyardRoom.areaSqm);

    // Center the courtyard
    let innerX = (fpW - cyW) / 2;
    let innerY = (fpH - cyH) / 2;

    // Validate strip widths — courtyard can't be so big there's no room for rooms
    if (innerX < MIN_STRIP) {
      cyW = fpW - MIN_STRIP * 2;
      innerX = MIN_STRIP;
    }
    if (innerY < MIN_STRIP) {
      cyH = fpH - MIN_STRIP * 2;
      innerY = MIN_STRIP;
    }

    // If courtyard can't fit, fall back
    if (cyW < 2.0 || cyH < 2.0) return null;

    // Snap to grid
    cyW = grid(cyW);
    cyH = grid(cyH);
    innerX = grid(innerX);
    innerY = grid(innerY);

    const result: PlacedRoom[] = [];

    // Place courtyard
    result.push({
      name: courtyardRoom.name,
      type: courtyardRoom.type || "other",
      x: innerX,
      y: innerY,
      width: cyW,
      depth: cyH,
      area: grid(cyW * cyH),
    });

    // Remaining rooms (excluding courtyard)
    const otherRooms = program.rooms.filter(r => r !== courtyardRoom);

    // Classify rooms into 4 strips
    const { south, north, east, west } = classifyForStrips(otherRooms, program.adjacency);

    // Define 4 strip rectangles
    const southStrip: Rect = { x: 0, y: 0, w: fpW, h: innerY };
    const northStrip: Rect = { x: 0, y: innerY + cyH, w: fpW, h: fpH - innerY - cyH };
    const westStrip: Rect = { x: 0, y: innerY, w: innerX, h: cyH };
    const eastStrip: Rect = { x: innerX + cyW, y: innerY, w: fpW - innerX - cyW, h: cyH };

    // BSP each strip independently
    if (south.length > 0) result.push(...bspStrip(south, southStrip));
    if (north.length > 0) result.push(...bspStrip(north, northStrip));
    if (west.length > 0) result.push(...bspStrip(west, westStrip));
    if (east.length > 0) result.push(...bspStrip(east, eastStrip));

    // Verify all rooms placed
    const placedNames = new Set(result.map(r => r.name));
    const missing = program.rooms.filter(r => !placedNames.has(r.name));
    if (missing.length > 0) {
      console.warn(`[COURTYARD] Missing ${missing.length} rooms: ${missing.map(r => r.name).join(", ")}. Force-placing.`);
      for (const room of missing) {
        const area = Math.max(room.areaSqm, 2);
        const w = grid(Math.sqrt(area * 1.2));
        const d = grid(area / w);
        const maxY = Math.max(...result.map(r => r.y + r.depth));
        result.push({
          name: room.name,
          type: room.type,
          x: 0,
          y: grid(maxY),
          width: w,
          depth: d,
          area: grid(w * d),
        });
      }
    }

    return result;
  } catch (err) {
    console.warn("[COURTYARD] Layout failed, falling back to BSP:", err);
    return null;
  }
}

// ── Classify rooms into strips ──────────────────────────────────────────────

function classifyForStrips(
  rooms: RoomSpec[],
  _adjacency: AdjacencyRequirement[],
): { south: RoomSpec[]; north: RoomSpec[]; east: RoomSpec[]; west: RoomSpec[] } {
  const south: RoomSpec[] = [];
  const north: RoomSpec[] = [];
  const east: RoomSpec[] = [];
  const west: RoomSpec[] = [];

  for (const room of rooms) {
    const name = room.name.toLowerCase();
    const type = room.type?.toLowerCase() || "";

    // SOUTH strip (front/entrance side): public-facing rooms
    if (name.includes("foyer") || name.includes("entrance") || name.includes("thinnai") ||
        name.includes("drawing") || name.includes("formal") || name.includes("parking") ||
        name.includes("verandah") || name.includes("porch") || type === "entrance") {
      south.push(room);
    }
    // NORTH strip (back/private side): bedrooms, bathrooms
    else if (type === "bedroom" || name.includes("bedroom") || name.includes("master") ||
             name.includes("guest") || name.includes("grandfather") || name.includes("mother")) {
      north.push(room);
    }
    // EAST strip: pooja (NE corner), kitchen (SE corner), dining
    else if (name.includes("pooja") || name.includes("prayer") || name.includes("puja") ||
             name.includes("kitchen") || name.includes("dining") || type === "kitchen" ||
             type === "dining") {
      east.push(room);
    }
    // WEST strip: service rooms
    else if (name.includes("servant") || name.includes("washing") || name.includes("store") ||
             name.includes("utility") || name.includes("laundry") || name.includes("staircase") ||
             type === "staircase") {
      west.push(room);
    }
    // Default: put in the strip with least total area
    else {
      const areas = [
        south.reduce((s, r) => s + r.areaSqm, 0),
        north.reduce((s, r) => s + r.areaSqm, 0),
        east.reduce((s, r) => s + r.areaSqm, 0),
        west.reduce((s, r) => s + r.areaSqm, 0),
      ];
      const minIdx = areas.indexOf(Math.min(...areas));
      [south, north, east, west][minIdx].push(room);
    }
  }

  // Handle empty strips by redistributing from the largest.
  // Loop until no empty strip can be filled (handles multiple empty strips).
  const strips = [south, north, east, west];
  let redistributed = true;
  while (redistributed) {
    redistributed = false;
    const emptyIdx = strips.findIndex(s => s.length === 0);
    if (emptyIdx === -1) break;

    // Find largest strip that can donate a room
    let largestIdx = 0;
    for (let i = 1; i < strips.length; i++) {
      if (strips[i].length > strips[largestIdx].length) largestIdx = i;
    }
    if (strips[largestIdx].length <= 1) break; // Can't redistribute further

    // Move the smallest room from the largest strip
    const sorted = [...strips[largestIdx]].sort((a, b) => a.areaSqm - b.areaSqm);
    const moved = sorted[0];
    strips[largestIdx].splice(strips[largestIdx].indexOf(moved), 1);
    strips[emptyIdx].push(moved);
    redistributed = true;
  }

  return { south, north, east, west };
}

// ── BSP subdivision for a single strip ──────────────────────────────────────

function bspStrip(rooms: RoomSpec[], rect: Rect): PlacedRoom[] {
  if (rooms.length === 0) return [];
  if (rooms.length === 1) return [placeRoom(rooms[0], rect)];
  if (rooms.length === 2) return splitTwo(rooms[0], rooms[1], rect);

  // Recursive BSP split
  const totalArea = rooms.reduce((s, r) => s + r.areaSqm, 0);
  let bestScore = Infinity;
  let bestSplit = { left: rooms.slice(0, 1), right: rooms.slice(1), leftRect: rect, rightRect: rect };

  for (let k = 1; k < rooms.length; k++) {
    const left = rooms.slice(0, k);
    const right = rooms.slice(k);
    const leftArea = left.reduce((s, r) => s + r.areaSqm, 0);
    const ratio = leftArea / totalArea;

    if (ratio < 0.15 || ratio > 0.85) continue;

    // Horizontal split
    const hLH = grid(rect.h * ratio);
    const hRH = grid(rect.h - hLH);
    if (hLH >= MIN_DIM && hRH >= MIN_DIM) {
      const score = Math.max(rect.w / hLH, rect.w / hRH, hLH / rect.w, hRH / rect.w);
      if (score < bestScore) {
        bestScore = score;
        bestSplit = {
          left, right,
          leftRect: { x: rect.x, y: rect.y, w: rect.w, h: hLH },
          rightRect: { x: rect.x, y: grid(rect.y + hLH), w: rect.w, h: hRH },
        };
      }
    }

    // Vertical split
    const vLW = grid(rect.w * ratio);
    const vRW = grid(rect.w - vLW);
    if (vLW >= MIN_DIM && vRW >= MIN_DIM) {
      const score = Math.max(vLW / rect.h, rect.h / vLW, vRW / rect.h, rect.h / vRW);
      if (score < bestScore) {
        bestScore = score;
        bestSplit = {
          left, right,
          leftRect: { x: rect.x, y: rect.y, w: vLW, h: rect.h },
          rightRect: { x: grid(rect.x + vLW), y: rect.y, w: vRW, h: rect.h },
        };
      }
    }
  }

  return [
    ...bspStrip(bestSplit.left, bestSplit.leftRect),
    ...bspStrip(bestSplit.right, bestSplit.rightRect),
  ];
}

// ── Place room in rect ──────────────────────────────────────────────────────

function placeRoom(room: RoomSpec, rect: Rect): PlacedRoom {
  return {
    name: room.name,
    type: room.type,
    x: grid(rect.x),
    y: grid(rect.y),
    width: grid(rect.w),
    depth: grid(rect.h),
    area: grid(rect.w * rect.h),
  };
}

// ── Split two rooms ─────────────────────────────────────────────────────────

function splitTwo(a: RoomSpec, b: RoomSpec, rect: Rect): PlacedRoom[] {
  const ratio = a.areaSqm / (a.areaSqm + b.areaSqm);

  // Horizontal split
  const hAh = grid(rect.h * ratio);
  const hBh = grid(rect.h - hAh);
  const hScore = Math.max(rect.w / Math.max(hAh, 0.1), rect.w / Math.max(hBh, 0.1));

  // Vertical split
  const vAw = grid(rect.w * ratio);
  const vBw = grid(rect.w - vAw);
  const vScore = Math.max(rect.h / Math.max(vAw, 0.1), rect.h / Math.max(vBw, 0.1));

  if (hScore <= vScore && hAh >= MIN_DIM && hBh >= MIN_DIM) {
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

// ── Detection helper ────────────────────────────────────────────────────────

/**
 * Check if a room program contains a courtyard layout.
 */
export function hasCourtyardRoom(program: EnhancedRoomProgram): boolean {
  return program.rooms.some(r =>
    r.name.toLowerCase().includes("courtyard") ||
    r.type === "courtyard",
  );
}
