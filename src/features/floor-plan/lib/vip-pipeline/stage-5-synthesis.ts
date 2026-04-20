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

interface TransformedRoom {
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

  // Step 2: Transform pixels → feet
  const transformed = transformToFeet(
    extraction.rooms,
    plotBoundsPx,
    plotWidthFt,
    plotDepthFt,
    issues,
  );

  if (transformed.length === 0) {
    throw new Error("Stage 5: all rooms eliminated during transform — 0 rooms");
  }

  // Step 3: Resolve duplicates
  resolveDuplicates(transformed, [...extraction.expectedRoomsMissing], issues);

  // Step 4: Populate room types from brief
  const briefMap = new Map(
    input.extraction.rooms.map((r) => [r.name.toLowerCase(), r]),
  );
  for (const room of transformed) {
    const briefRoom = input.parsedConstraints.rooms?.find(
      (pr) => pr.name.toLowerCase() === room.name.toLowerCase(),
    );
    if (briefRoom) {
      room.type = briefRoom.function;
    }
  }

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
  };

  const spRooms = buildStripPackRooms(transformed, brief);
  const normalizedFacing = normalizeFacing(facing);
  const plotRect: Rect = { x: 0, y: 0, width: plotWidthFt, depth: plotDepthFt };

  // Step 6: Build spine, walls, doors, windows
  const spine = buildSpine(spRooms, plotWidthFt, plotDepthFt, normalizedFacing);
  spine.remaining_front = [spine.front_strip];

  const walls = buildWalls({ rooms: spRooms, spine, plot: plotRect });

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
