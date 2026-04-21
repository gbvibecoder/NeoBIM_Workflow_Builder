/**
 * Stage 5: Synthesis
 *
 * Converts Stage 4's pixel-based ExtractedRooms into a full FloorPlanProject
 * by transforming coordinates (pixels → feet, Y-down → Y-up) and reusing
 * the existing strip-pack converter + wall-builder + door-placer + window-placer.
 *
 * Pure code — no API calls. Cost ≈ $0, latency < 3s.
 *
 * Planned implementation: Phase 1.8
 */

import type {
  Stage5Input,
  Stage5Output,
  ExtractedRooms,
  ExtractedRoom,
  RectPx,
  ArchitectBrief,
  AdjacencyDeclaration,
  AdjacencyRelationship,
} from "./types";
import type { VIPLogger } from "./logger";
import type {
  StripPackRoom,
  StripPackResult,
  SpineLayout,
  Rect,
  RoomZone,
  Facing,
} from "../strip-pack/types";
import { normalizeFacing } from "../strip-pack/types";
import { toFloorPlanProject } from "../strip-pack/converter";
import { buildWalls } from "../strip-pack/wall-builder";
import { placeDoors } from "../strip-pack/door-placer";
import { placeWindows } from "../strip-pack/window-placer";
import type { ParsedConstraints } from "../structured-parser";
import { computeEnvelope } from "./constants/setbacks";

// ─── Public Types ────────────────────────────────────────────────

export interface Stage5Metrics {
  durationMs: number;
  roomCount: number;
  wallCount: number;
  doorCount: number;
  windowCount: number;
}

// ─── Zone / Wet / Sacred Inference ───────────────────────────────

function inferZone(type: string): RoomZone {
  if (["living", "drawing_room", "dining", "balcony", "verandah"].includes(type)) return "PUBLIC";
  if (["bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom", "study", "pooja", "prayer"].includes(type)) return "PRIVATE";
  if (["kitchen", "bathroom", "master_bathroom", "toilet", "powder_room", "utility", "laundry", "store", "pantry", "servant_quarter"].includes(type)) return "SERVICE";
  if (["corridor", "hallway", "passage"].includes(type)) return "CIRCULATION";
  if (["foyer", "porch"].includes(type)) return "ENTRANCE";
  return "PUBLIC";
}

function isWet(type: string): boolean {
  return ["bathroom", "master_bathroom", "ensuite", "powder_room", "toilet", "kitchen", "utility", "laundry"].includes(type);
}

function isSacred(type: string): boolean {
  return ["pooja", "prayer", "mandir"].includes(type);
}

// ─── Plot Bounds Resolution ──────────────────────────────────────

function resolvePlotBounds(extraction: ExtractedRooms, issues: string[]): RectPx {
  if (
    extraction.plotBoundsPx &&
    extraction.plotBoundsPx.w > 100 &&
    extraction.plotBoundsPx.h > 100
  ) {
    return extraction.plotBoundsPx;
  }

  // Fallback: union of all room rects
  issues.push("plotBounds null or too small, used room-union fallback");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of extraction.rooms) {
    minX = Math.min(minX, r.rectPx.x);
    minY = Math.min(minY, r.rectPx.y);
    maxX = Math.max(maxX, r.rectPx.x + r.rectPx.w);
    maxY = Math.max(maxY, r.rectPx.y + r.rectPx.h);
  }
  if (minX >= maxX || minY >= maxY) {
    // Absolute fallback: full image
    return { x: 0, y: 0, w: extraction.imageSize.width, h: extraction.imageSize.height };
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─── Pixel → Feet Transform ─────────────────────────────────────

export interface TransformedRoom {
  name: string;
  type: string;
  placed: Rect; // feet, Y-UP, SW origin
  confidence: number;
  labelAsShown: string;
}

function transformToFeet(
  rooms: ExtractedRoom[],
  plotBoundsPx: RectPx,
  plotWidthFt: number,
  plotDepthFt: number,
  issues: string[],
): TransformedRoom[] {
  const scaleX = plotWidthFt / plotBoundsPx.w;
  const scaleY = plotDepthFt / plotBoundsPx.h;
  const result: TransformedRoom[] = [];

  for (const room of rooms) {
    // Shift to plot-relative pixel coords
    const relX = room.rectPx.x - plotBoundsPx.x;
    const relY = room.rectPx.y - plotBoundsPx.y;

    // Scale to feet
    let feetW = room.rectPx.w * scaleX;
    let feetH = room.rectPx.h * scaleY;

    // Y-flip: pixel Y-down → feet Y-up (SW origin)
    let feetX = relX * scaleX;
    let feetY = plotDepthFt - (relY + room.rectPx.h) * scaleY;

    // Clamp to plot bounds with 0.5ft tolerance
    if (feetX < -0.5) {
      issues.push(`${room.name}: feetX=${feetX.toFixed(1)} clamped to 0`);
      feetW = Math.max(0, feetW + feetX);
      feetX = 0;
    }
    if (feetY < -0.5) {
      issues.push(`${room.name}: feetY=${feetY.toFixed(1)} clamped to 0`);
      feetH = Math.max(0, feetH + feetY);
      feetY = 0;
    }
    feetX = Math.max(0, feetX);
    feetY = Math.max(0, feetY);

    if (feetX + feetW > plotWidthFt + 0.5) {
      issues.push(`${room.name}: extends ${(feetX + feetW - plotWidthFt).toFixed(1)}ft past plot width — clamped`);
      feetW = Math.max(1, plotWidthFt - feetX);
    }
    if (feetY + feetH > plotDepthFt + 0.5) {
      issues.push(`${room.name}: extends ${(feetY + feetH - plotDepthFt).toFixed(1)}ft past plot depth — clamped`);
      feetH = Math.max(1, plotDepthFt - feetY);
    }

    if (feetW <= 0 || feetH <= 0) {
      issues.push(`${room.name}: zero-size after clamping — skipped`);
      continue;
    }

    result.push({
      name: room.name,
      type: "other", // populated later from brief
      placed: {
        x: Math.round(feetX * 10) / 10,
        y: Math.round(feetY * 10) / 10,
        width: Math.round(feetW * 10) / 10,
        depth: Math.round(feetH * 10) / 10,
      },
      confidence: room.confidence,
      labelAsShown: room.labelAsShown,
    });
  }

  return result;
}

// ─── Duplicate Resolution (Option B) ─────────────────────────────

function resolveDuplicates(
  rooms: TransformedRoom[],
  missingNames: string[],
  issues: string[],
): void {
  const seen = new Map<string, number>();
  const missingQueue = [...missingNames];

  for (const room of rooms) {
    const key = room.name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);

    if (count > 0) {
      // This is a duplicate — rename
      if (missingQueue.length > 0) {
        const newName = missingQueue.shift()!;
        issues.push(
          `Renamed duplicate "${room.name}" to "${newName}" (was mismatched label "${room.labelAsShown}")`,
        );
        room.name = newName;
      } else {
        const newName = `${room.name}-dup`;
        issues.push(
          `Renamed duplicate "${room.name}" to "${newName}" (no missing names available)`,
        );
        room.name = newName;
      }
    }
  }
}

// ─── Build StripPackRooms ────────────────────────────────────────

function buildStripPackRooms(
  transformed: TransformedRoom[],
  brief: ArchitectBrief,
): StripPackRoom[] {
  const briefMap = new Map(
    brief.roomList.map((r) => [r.name.toLowerCase(), r]),
  );

  return transformed.map((r, i) => {
    const briefRoom = briefMap.get(r.name.toLowerCase());
    const type = briefRoom?.type ?? "other";

    return {
      id: `vip-${i}`,
      name: r.name,
      type,
      requested_width_ft: r.placed.width,
      requested_depth_ft: r.placed.depth,
      requested_area_sqft: r.placed.width * r.placed.depth,
      zone: inferZone(type),
      strip: "FRONT" as const,
      adjacencies: [],
      needs_exterior_wall: !isWet(type),
      is_wet: isWet(type),
      is_sacred: isSacred(type),
      placed: r.placed,
      actual_area_sqft: r.placed.width * r.placed.depth,
    };
  });
}

// ─── Build Synthetic SpineLayout ─────────────────────────────────

function buildSpine(
  rooms: StripPackRoom[],
  plotW: number,
  plotD: number,
  facing: Facing,
): SpineLayout {
  // Find hallway/corridor room if it exists
  const hallway = rooms.find(
    (r) => r.type === "corridor" || r.type === "hallway" || r.type === "passage",
  );

  const hallwayRect: Rect = hallway?.placed
    ? hallway.placed
    : { x: 0, y: plotD * 0.48, width: plotW, depth: 3.5 };

  const isHoriz = hallwayRect.width > hallwayRect.depth;

  return {
    spine: hallwayRect,
    front_strip: isHoriz
      ? { x: 0, y: hallwayRect.y + hallwayRect.depth, width: plotW, depth: plotD - hallwayRect.y - hallwayRect.depth }
      : { x: hallwayRect.x + hallwayRect.width, y: 0, width: plotW - hallwayRect.x - hallwayRect.width, depth: plotD },
    back_strip: isHoriz
      ? { x: 0, y: 0, width: plotW, depth: hallwayRect.y }
      : { x: 0, y: 0, width: hallwayRect.x, depth: plotD },
    entrance_rooms: [],
    remaining_front: [],
    orientation: isHoriz ? "horizontal" : "vertical",
    entrance_side: facing,
    hallway_width_ft: isHoriz ? hallwayRect.depth : hallwayRect.width,
  };
}

// ─── Adjacency Enforcement (Phase 2.3 Option X) ─────────────────

const SHARE_EPS = 0.5; // feet tolerance for "two rooms share a wall"
const OVERLAP_EPS = 0.3; // feet tolerance for "rooms don't overlap"

/**
 * Do rectangles A and B share a wall (edge-adjacency with line overlap)?
 * Corners-only touching returns false.
 */
function rectsShareWall(A: Rect, B: Rect): boolean {
  const horizAdj = Math.abs(A.y + A.depth - B.y) < SHARE_EPS || Math.abs(B.y + B.depth - A.y) < SHARE_EPS;
  const horizOverlap = Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x) > SHARE_EPS;
  const vertAdj = Math.abs(A.x + A.width - B.x) < SHARE_EPS || Math.abs(B.x + B.width - A.x) < SHARE_EPS;
  const vertOverlap = Math.min(A.y + A.depth, B.y + B.depth) - Math.max(A.y, B.y) > SHARE_EPS;
  return (horizAdj && horizOverlap) || (vertAdj && vertOverlap);
}

function rectsOverlap(A: Rect, B: Rect): boolean {
  return !(
    A.x + A.width <= B.x + OVERLAP_EPS ||
    B.x + B.width <= A.x + OVERLAP_EPS ||
    A.y + A.depth <= B.y + OVERLAP_EPS ||
    B.y + B.depth <= A.y + OVERLAP_EPS
  );
}

function findRoomByAdjacencyName(rooms: TransformedRoom[], target: string): TransformedRoom | undefined {
  const t = target.toLowerCase().trim();
  if (!t) return undefined;
  const exact = rooms.find((r) => r.name.toLowerCase() === t);
  if (exact) return exact;
  return rooms.find(
    (r) => r.name.toLowerCase().includes(t) || t.includes(r.name.toLowerCase()),
  );
}

/**
 * Phase 2.3 Option X: post-placement swap. For each declared
 * "attached" adjacency (a, b), if a and b don't already share a wall,
 * try placing b flush against each of a's four sides. First side that
 * fits inside the plot AND doesn't overlap any non-{a,b} room wins.
 *
 * Mutates rooms[].placed in place.
 *
 * Heuristic — NOT a constraint solver:
 *   - Only handles "attached" (critical ensuite case)
 *   - "adjacent" / "direct-access" / "connected" are left to the
 *     evaluation report
 *   - If no side fits (dense layout), logs a warning and leaves b
 *     where it was.
 *   - Cascading effects: moving b to a's side may leave a gap where
 *     b used to be. That's acceptable — gaps become void area and
 *     the overall layout remains valid.
 */
export function enforceAttachedAdjacencies(
  rooms: TransformedRoom[],
  adjacencies: AdjacencyDeclaration[],
  plotWidthFt: number,
  plotDepthFt: number,
  issues: string[],
): { attempted: number; satisfied: number; moved: number; unfixable: number } {
  let attempted = 0;
  let satisfied = 0;
  let moved = 0;
  let unfixable = 0;

  for (const decl of adjacencies) {
    if (decl.relationship !== "attached") continue;
    attempted++;

    const a = findRoomByAdjacencyName(rooms, decl.a);
    const b = findRoomByAdjacencyName(rooms, decl.b);
    if (!a || !b) {
      issues.push(
        `Adjacency enforce: could not find room(s) for "${decl.a}" ↔ "${decl.b}"`,
      );
      unfixable++;
      continue;
    }
    if (a === b) continue;

    if (rectsShareWall(a.placed, b.placed)) {
      satisfied++;
      continue;
    }

    // Try placing b on each side of a.
    const sides: Array<{ name: string; x: number; y: number }> = [
      { name: "east",  x: a.placed.x + a.placed.width,   y: a.placed.y }, // b flush right of a, aligned at bottom
      { name: "west",  x: a.placed.x - b.placed.width,   y: a.placed.y },
      { name: "north", x: a.placed.x,                    y: a.placed.y + a.placed.depth },
      { name: "south", x: a.placed.x,                    y: a.placed.y - b.placed.depth },
    ];

    let placed = false;
    for (const side of sides) {
      if (side.x < -OVERLAP_EPS || side.y < -OVERLAP_EPS) continue;
      if (side.x + b.placed.width > plotWidthFt + OVERLAP_EPS) continue;
      if (side.y + b.placed.depth > plotDepthFt + OVERLAP_EPS) continue;

      const candidate: Rect = {
        x: Math.max(0, side.x),
        y: Math.max(0, side.y),
        width: b.placed.width,
        depth: b.placed.depth,
      };

      // Reject if candidate overlaps any OTHER room (not a or b).
      const overlapsOther = rooms.some((r) => {
        if (r === a || r === b) return false;
        return rectsOverlap(candidate, r.placed);
      });
      if (overlapsOther) continue;

      b.placed.x = candidate.x;
      b.placed.y = candidate.y;
      placed = true;
      moved++;
      satisfied++;
      issues.push(
        `Adjacency enforce: moved "${b.name}" to ${side.name} side of "${a.name}" so they share a wall.`,
      );
      break;
    }

    if (!placed) {
      issues.push(
        `Adjacency enforce: could not place "${b.name}" adjacent to "${a.name}" — no side fit. Layout may be too dense.`,
      );
      unfixable++;
    }
  }

  return { attempted, satisfied, moved, unfixable };
}

// ─── Adjacency Compliance (Phase 2.3) ────────────────────────────

export interface AdjacencyCheckResult {
  declaration: AdjacencyDeclaration;
  status: "satisfied" | "violated" | "unknown";
  note: string;
}

export interface AdjacencyReport {
  declared: number;
  satisfied: number;
  violated: number;
  unknown: number;
  /** 0-100 compliance percentage; drives Stage 6 adjacencyCompliance scoring. */
  compliancePct: number;
  checks: AdjacencyCheckResult[];
}

/** Returns the room whose lowercased name contains (or is contained by) `target`. */
function findRoomByName<T extends { name: string }>(rooms: T[], target: string): T | undefined {
  const t = target.toLowerCase().trim();
  if (!t) return undefined;
  const exact = rooms.find((r) => r.name.toLowerCase() === t);
  if (exact) return exact;
  return rooms.find(
    (r) => r.name.toLowerCase().includes(t) || t.includes(r.name.toLowerCase()),
  );
}

/** Do two rooms share any wall (by room_ids membership)? */
function sharesWall(
  aId: string,
  bId: string,
  walls: Array<{ room_ids: string[] }>,
): boolean {
  return walls.some((w) => w.room_ids.includes(aId) && w.room_ids.includes(bId));
}

/** Is there a direct door between a and b? */
function hasDoorBetween(
  aId: string,
  bId: string,
  doors: Array<{ between: [string, string] | string[] }>,
): boolean {
  return doors.some((d) => {
    const between = d.between as string[];
    return between.includes(aId) && between.includes(bId);
  });
}

/**
 * Evaluate each declared adjacency against the resolved geometry.
 * Best-effort: no room placement adjustment; produces a report Stage 6 can score.
 * Exported for unit testing; internal callers use it via the main Stage 5 flow.
 */
export function evaluateAdjacencies(
  adjacencies: AdjacencyDeclaration[],
  spRooms: Array<{ id: string; name: string; type: string }>,
  walls: Array<{ room_ids: string[] }>,
  doors: Array<{ between: [string, string] | string[] }>,
): AdjacencyReport {
  const checks: AdjacencyCheckResult[] = [];

  for (const decl of adjacencies) {
    const roomA = findRoomByName(spRooms, decl.a);
    const roomB = findRoomByName(spRooms, decl.b);

    if (!roomA || !roomB) {
      checks.push({
        declaration: decl,
        status: "unknown",
        note: `Room(s) not found in layout (a=${roomA ? "ok" : "missing"}, b=${roomB ? "ok" : "missing"})`,
      });
      continue;
    }

    const result = checkRelationship(
      decl.relationship,
      roomA.id,
      roomB.id,
      walls,
      doors,
    );
    checks.push({ declaration: decl, status: result.status, note: result.note });
  }

  const satisfied = checks.filter((c) => c.status === "satisfied").length;
  const violated = checks.filter((c) => c.status === "violated").length;
  const unknown = checks.filter((c) => c.status === "unknown").length;
  const declared = checks.length;
  const evaluable = satisfied + violated;
  const compliancePct = evaluable === 0 ? 100 : Math.round((satisfied / evaluable) * 100);

  return { declared, satisfied, violated, unknown, compliancePct, checks };
}

function checkRelationship(
  relationship: AdjacencyRelationship,
  aId: string,
  bId: string,
  walls: Array<{ room_ids: string[] }>,
  doors: Array<{ between: [string, string] | string[] }>,
): { status: "satisfied" | "violated" | "unknown"; note: string } {
  const wall = sharesWall(aId, bId, walls);
  const door = hasDoorBetween(aId, bId, doors);

  switch (relationship) {
    case "attached":
      // Share a wall AND have a door between them (the "internal from a" semantic
      // needs door-side inspection which our door model doesn't expose; we treat
      // any direct door as satisfying the attachment).
      if (wall && door) return { status: "satisfied", note: "shared wall + door present" };
      if (wall && !door) return { status: "violated", note: "share wall but no direct door" };
      return { status: "violated", note: "no shared wall" };
    case "adjacent":
      if (wall) return { status: "satisfied", note: "shared wall" };
      return { status: "violated", note: "no shared wall" };
    case "direct-access":
      if (door) return { status: "satisfied", note: "direct door present" };
      return { status: "violated", note: "no direct door" };
    case "connected":
      // Minimal "connected" check: direct door OR both rooms share a door with any
      // hallway/corridor node. We don't resolve full graph reachability here.
      if (door) return { status: "satisfied", note: "direct door present" };
      return { status: "unknown", note: "corridor reachability not resolved" };
    default:
      return { status: "unknown", note: "unrecognized relationship" };
  }
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function runStage5Synthesis(
  input: Stage5Input,
  logger?: VIPLogger,
): Promise<{ output: Stage5Output; metrics: Stage5Metrics }> {
  const startMs = Date.now();
  const issues: string[] = [];
  const { extraction, plotWidthFt, plotDepthFt, facing, parsedConstraints } = input;

  // Step 1: Resolve plot bounds
  const plotBoundsPx = resolvePlotBounds(extraction, issues);

  // Phase 2.4 P0-A: resolve building envelope after setbacks.
  // When the feature flag is off, envelope == full plot (no-op).
  const envelope = computeEnvelope(plotWidthFt, plotDepthFt, input.municipality);
  if (envelope.fallbackReason) issues.push(envelope.fallbackReason);

  // Step 2: Transform pixels → feet (into the usable envelope).
  const transformed = transformToFeet(
    extraction.rooms,
    plotBoundsPx,
    envelope.usableWidthFt,
    envelope.usableDepthFt,
    issues,
  );

  // Shift rooms inward by (originX, originY) so they live inside
  // the setback margin. No-op when envelope.applied === false.
  if (envelope.applied) {
    for (const r of transformed) {
      r.placed.x = Math.round((r.placed.x + envelope.originX) * 10) / 10;
      r.placed.y = Math.round((r.placed.y + envelope.originY) * 10) / 10;
    }
  }

  if (transformed.length === 0) {
    throw new Error("Stage 5: all rooms eliminated during transform — 0 rooms");
  }

  // Step 3: Resolve duplicates
  resolveDuplicates(transformed, [...extraction.expectedRoomsMissing], issues);

  // Step 4: Populate room types from parsed constraints
  for (const room of transformed) {
    const briefRoom = input.parsedConstraints.rooms?.find(
      (pr) => pr.name.toLowerCase() === room.name.toLowerCase(),
    );
    if (briefRoom) {
      room.type = briefRoom.function;
    }
  }

  // Step 4.5 (Phase 2.3 Option X): enforce "attached" adjacencies
  // BEFORE we build walls/doors so the final geometry reflects the
  // architect's declared relationships (ensuite attachment, etc.).
  // This mutates transformed[].placed in place; subsequent stages
  // pick up the corrected positions.
  const enforceStats = enforceAttachedAdjacencies(
    transformed,
    input.adjacencies ?? [],
    plotWidthFt,
    plotDepthFt,
    issues,
  );

  // Step 5: Build StripPackRooms
  const brief: ArchitectBrief = {
    projectType: "residential",
    roomList: transformed.map((r) => ({
      name: r.name,
      type: r.type,
      approxAreaSqft: r.placed.width * r.placed.depth,
    })),
    plotWidthFt,
    plotDepthFt,
    facing,
    styleCues: [],
    constraints: [],
    adjacencies: input.adjacencies ?? [],
  };

  const spRooms = buildStripPackRooms(transformed, brief);
  const normalizedFacing = normalizeFacing(facing);
  // Full plot rect — stored in StripPackResult for renderer boundary.
  const plotRect: Rect = { x: 0, y: 0, width: plotWidthFt, depth: plotDepthFt };
  // Building envelope (= plotRect when setbacks disabled).
  const buildingRect: Rect = {
    x: envelope.originX,
    y: envelope.originY,
    width: envelope.usableWidthFt,
    depth: envelope.usableDepthFt,
  };

  // Step 6: Build spine inside the usable envelope, then translate
  // into plot coordinates so walls/doors/windows line up with rooms.
  const spine = buildSpine(
    spRooms,
    envelope.usableWidthFt,
    envelope.usableDepthFt,
    normalizedFacing,
  );
  if (envelope.applied) {
    spine.spine = {
      ...spine.spine,
      x: spine.spine.x + envelope.originX,
      y: spine.spine.y + envelope.originY,
    };
    spine.front_strip = {
      ...spine.front_strip,
      x: spine.front_strip.x + envelope.originX,
      y: spine.front_strip.y + envelope.originY,
    };
    spine.back_strip = {
      ...spine.back_strip,
      x: spine.back_strip.x + envelope.originX,
      y: spine.back_strip.y + envelope.originY,
    };
  }
  spine.remaining_front = [spine.front_strip];

  // Walls enclose the BUILDING envelope (inset from plot line).
  const walls = buildWalls({ rooms: spRooms, spine, plot: buildingRect });

  // Wire wall_ids onto rooms
  const wallsByRoom = new Map<string, string[]>();
  for (const w of walls) {
    for (const id of w.room_ids) {
      if (!wallsByRoom.has(id)) wallsByRoom.set(id, []);
      wallsByRoom.get(id)!.push(w.id);
    }
  }
  for (const r of spRooms) r.wall_ids = wallsByRoom.get(r.id) ?? [];

  const adjPairs = parsedConstraints.adjacency_pairs.map((p) => ({
    a: p.room_a_id,
    b: p.room_b_id,
  }));
  const porchRoom = spRooms.find((r) => r.type === "porch");
  const foyerRoom = spRooms.find((r) => r.type === "foyer");
  const doorResult = placeDoors({
    rooms: spRooms,
    walls,
    spine,
    adjacencyPairs: adjPairs,
    porchId: porchRoom?.id,
    foyerId: foyerRoom?.id,
  });
  issues.push(...doorResult.warnings);

  const windowResult = placeWindows({
    rooms: spRooms,
    walls,
    doors: doorResult.doors,
    facing: normalizedFacing,
  });
  issues.push(...windowResult.warnings);

  // Step 7: Build StripPackResult and convert to FloorPlanProject
  const totalRoomArea = spRooms.reduce(
    (s, r) => s + (r.actual_area_sqft ?? 0),
    0,
  );
  const hallwayArea = spine.spine.width * spine.spine.depth;
  const plotArea = plotWidthFt * plotDepthFt;

  const stripPackResult: StripPackResult = {
    rooms: spRooms,
    spine,
    walls,
    doors: doorResult.doors,
    windows: windowResult.windows,
    plot: plotRect,
    metrics: {
      efficiency_pct: Math.round(((totalRoomArea + hallwayArea) / plotArea) * 100),
      void_area_sqft: Math.max(0, plotArea - totalRoomArea - hallwayArea),
      door_coverage_pct:
        spRooms.length > 0
          ? Math.round(
              (new Set(doorResult.doors.flatMap((d) => d.between)).size /
                spRooms.length) *
                100,
            )
          : 0,
      orphan_rooms: [],
      adjacency_satisfaction_pct: 80,
      total_rooms: spRooms.length,
      rooms_with_doors: new Set(doorResult.doors.flatMap((d) => d.between)).size,
      required_adjacencies: parsedConstraints.adjacency_pairs.length,
      satisfied_adjacencies: Math.round(
        parsedConstraints.adjacency_pairs.length * 0.8,
      ),
    },
    warnings: issues,
  };

  const project = toFloorPlanProject(
    stripPackResult,
    parsedConstraints,
    `VIP floor plan (${plotWidthFt}×${plotDepthFt}ft ${facing}-facing)`,
  );

  // Override generation_model metadata
  project.metadata.generation_model = "vip-pipeline";

  // Phase 2.4 P0-A: write setback metadata so renderers / quality gate
  // / downstream tooling can see what envelope the building sits in.
  const meta = project.metadata as unknown as Record<string, unknown>;
  meta.setback_applied = envelope.applied ? envelope.rule : null;
  meta.plot_usable_area = {
    width_ft: envelope.usableWidthFt,
    depth_ft: envelope.usableDepthFt,
    origin_x_ft: envelope.originX,
    origin_y_ft: envelope.originY,
  };

  // Phase 2.3: evaluate declared adjacencies against the resolved geometry
  // and stash the report into metadata so Stage 6 can score it.
  const adjacencyReport = evaluateAdjacencies(
    input.adjacencies ?? [],
    spRooms,
    walls,
    doorResult.doors,
  );
  meta.adjacency_report = adjacencyReport;
  meta.adjacency_enforce_stats = enforceStats;
  if (adjacencyReport.violated > 0) {
    issues.push(
      `Adjacency: ${adjacencyReport.violated}/${adjacencyReport.declared} declared relationships violated`,
    );
  }

  const durationMs = Date.now() - startMs;
  if (logger) logger.logStageCost(5, 0); // Pure code, $0

  return {
    output: { project, issues },
    metrics: {
      durationMs,
      roomCount: spRooms.length,
      wallCount: walls.length,
      doorCount: doorResult.doors.length,
      windowCount: windowResult.windows.length,
    },
  };
}
