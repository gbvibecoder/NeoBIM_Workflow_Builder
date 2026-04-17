import type { Door, CadWindow, Wall, Point } from "@/types/floor-plan-cad";
import type { ParsedConstraints, ParsedRoom } from "../structured-parser";
import type { FinePlacement } from "./cell-csp";
import { logger } from "@/lib/logger";

const FT_TO_MM = 304.8;
const DEFAULT_DOOR_WIDTH_FT = 3.0;
const MAIN_DOOR_WIDTH_FT = 3.5;
const MIN_DOOR_WIDTH_FT = 2.0;
const DOOR_HEIGHT_MM = 2100;
const DOOR_THICKNESS_MM = 40;
const WINDOW_WIDTH_FT = 3.0;
const LARGE_WINDOW_WIDTH_FT = 4.5;
const WINDOW_HEIGHT_MM = 1500;
const WINDOW_SILL_MM = 900;
const CORNER_MARGIN_FT = 1.0;
const OPENING_SPACING_FT = 0.5;

type PlotSide = "N" | "S" | "E" | "W";

interface WallRef {
  wall: Wall;
  side: PlotSide | null;
  orientation: "horizontal" | "vertical";
  axisFt: number;
  startFt: number;
  endFt: number;
}

export interface OpeningResult {
  doors: Door[];
  windows: CadWindow[];
  warnings: string[];
}

function mmToFt(mm: number): number {
  return mm / FT_TO_MM;
}

function wallRefOf(wall: Wall, plotW: number, plotD: number): WallRef {
  const sx = mmToFt(wall.centerline.start.x);
  const sy = mmToFt(wall.centerline.start.y);
  const ex = mmToFt(wall.centerline.end.x);
  const ey = mmToFt(wall.centerline.end.y);
  const isHorizontal = Math.abs(sy - ey) < 0.01;

  let side: PlotSide | null = null;
  if (isHorizontal) {
    if (Math.abs(sy) < 0.01) side = "N";
    else if (Math.abs(sy - plotD) < 0.01) side = "S";
  } else {
    if (Math.abs(sx) < 0.01) side = "W";
    else if (Math.abs(sx - plotW) < 0.01) side = "E";
  }

  return {
    wall,
    side,
    orientation: isHorizontal ? "horizontal" : "vertical",
    axisFt: isHorizontal ? sy : sx,
    startFt: Math.min(isHorizontal ? sx : sy, isHorizontal ? ex : ey),
    endFt: Math.max(isHorizontal ? sx : sy, isHorizontal ? ex : ey),
  };
}

function wallLengthFt(w: WallRef): number {
  return w.endFt - w.startFt;
}

function rectEdgeOnWall(p: FinePlacement, w: WallRef, tol = 0.01): { start: number; end: number } | null {
  if (w.orientation === "horizontal") {
    const roomTop = p.y_ft;
    const roomBottom = p.y_ft + p.depth_ft;
    if (Math.abs(roomTop - w.axisFt) < tol || Math.abs(roomBottom - w.axisFt) < tol) {
      const start = Math.max(p.x_ft, w.startFt);
      const end = Math.min(p.x_ft + p.width_ft, w.endFt);
      if (end > start + tol) return { start, end };
    }
  } else {
    const roomLeft = p.x_ft;
    const roomRight = p.x_ft + p.width_ft;
    if (Math.abs(roomLeft - w.axisFt) < tol || Math.abs(roomRight - w.axisFt) < tol) {
      const start = Math.max(p.y_ft, w.startFt);
      const end = Math.min(p.y_ft + p.depth_ft, w.endFt);
      if (end > start + tol) return { start, end };
    }
  }
  return null;
}

function pointAtAlong(w: WallRef, alongFt: number): Point {
  if (w.orientation === "horizontal") {
    return { x: alongFt * FT_TO_MM, y: w.axisFt * FT_TO_MM };
  }
  return { x: w.axisFt * FT_TO_MM, y: alongFt * FT_TO_MM };
}

function findEntranceRoom(
  constraints: ParsedConstraints,
  placements: FinePlacement[],
  plotW: number,
  plotD: number,
): { placement: FinePlacement; room: ParsedRoom } | null {
  const byId = new Map(constraints.rooms.map(r => [r.id, r]));

  // 1. Explicit main-entrance door
  for (const r of constraints.rooms) {
    if (r.doors.some(d => d.is_main_entrance)) {
      const p = placements.find(pl => pl.room_id === r.id);
      if (p) return { placement: p, room: r };
    }
  }

  // 2. Function-based fallback
  const entranceFunctions = ["porch", "foyer", "verandah", "living"];
  const facing = constraints.plot.facing;

  const candidates = placements
    .map(p => ({ p, room: byId.get(p.room_id)! }))
    .filter(c => c.room && entranceFunctions.includes(c.room.function));

  if (candidates.length === 0) return null;

  // Prefer room closest to plot.facing edge
  if (facing) {
    candidates.sort((a, b) => distToFacingEdge(a.p, facing, plotW, plotD) - distToFacingEdge(b.p, facing, plotW, plotD));
  }
  // Prefer earlier entrance function (porch > foyer > verandah > living)
  candidates.sort((a, b) => {
    const ai = entranceFunctions.indexOf(a.room.function);
    const bi = entranceFunctions.indexOf(b.room.function);
    return ai - bi;
  });

  const winner = candidates[0];
  return { placement: winner.p, room: winner.room };
}

function distToFacingEdge(p: FinePlacement, facing: string, plotW: number, plotD: number): number {
  switch (facing) {
    case "N": return p.y_ft;
    case "S": return plotD - (p.y_ft + p.depth_ft);
    case "W": return p.x_ft;
    case "E": return plotW - (p.x_ft + p.width_ft);
    case "NW": return p.y_ft + p.x_ft;
    case "NE": return p.y_ft + (plotW - (p.x_ft + p.width_ft));
    case "SW": return (plotD - (p.y_ft + p.depth_ft)) + p.x_ft;
    case "SE": return (plotD - (p.y_ft + p.depth_ft)) + (plotW - (p.x_ft + p.width_ft));
    default: return 0;
  }
}

function makeDoorSymbol(p: Point): Door["symbol"] {
  return {
    hinge_point: p,
    arc_radius_mm: 900,
    arc_start_angle_deg: 0,
    arc_end_angle_deg: 90,
    leaf_end_point: { x: p.x + 900, y: p.y },
  };
}

function makeWindowSymbol(start: Point, end: Point): CadWindow["symbol"] {
  return {
    start_point: start,
    end_point: end,
    glass_lines: [],
  };
}

function placeMainEntrance(
  constraints: ParsedConstraints,
  placements: FinePlacement[],
  walls: Wall[],
  wallRefs: WallRef[],
  plotW: number,
  plotD: number,
  warnings: string[],
): Door | null {
  const entrance = findEntranceRoom(constraints, placements, plotW, plotD);
  if (!entrance) {
    warnings.push("Main entrance: no entrance room (porch/foyer/verandah/living) found; no main door placed");
    return null;
  }

  const facing = constraints.plot.facing as PlotSide | "NE" | "NW" | "SE" | "SW" | null;
  const facingSimple: PlotSide | null = facing === "N" || facing === "S" || facing === "E" || facing === "W" ? facing : null;

  // Find wall on the facing side of the entrance room that lies on plot perimeter
  let chosen: { wall: WallRef; edge: { start: number; end: number } } | null = null;

  if (facingSimple) {
    for (const w of wallRefs) {
      if (w.side !== facingSimple) continue;
      const edge = rectEdgeOnWall(entrance.placement, w);
      if (!edge) continue;
      chosen = { wall: w, edge };
      break;
    }
  }

  if (!chosen) {
    // Fall back to longest external wall of the entrance room
    let best: { wall: WallRef; edge: { start: number; end: number }; len: number } | null = null;
    for (const w of wallRefs) {
      if (!w.side) continue;
      const edge = rectEdgeOnWall(entrance.placement, w);
      if (!edge) continue;
      const len = edge.end - edge.start;
      if (!best || len > best.len) best = { wall: w, edge, len };
    }
    if (best) {
      warnings.push(`Main entrance: "${entrance.room.name}" has no wall on plot.facing — placed on longest external wall (${best.wall.side})`);
      chosen = { wall: best.wall, edge: best.edge };
    }
  }

  if (!chosen) {
    warnings.push(`Main entrance: "${entrance.room.name}" has no external wall at all; skipped`);
    return null;
  }

  const edgeLen = chosen.edge.end - chosen.edge.start;
  let doorWidth = Math.min(MAIN_DOOR_WIDTH_FT, Math.max(MIN_DOOR_WIDTH_FT, edgeLen - 2 * CORNER_MARGIN_FT));
  if (edgeLen < MIN_DOOR_WIDTH_FT + 2 * CORNER_MARGIN_FT) {
    doorWidth = Math.max(MIN_DOOR_WIDTH_FT, edgeLen * 0.5);
    warnings.push(`Main entrance: wall segment ${edgeLen.toFixed(1)}ft is short — door shrunk to ${doorWidth.toFixed(1)}ft`);
  }
  const midAlong = (chosen.edge.start + chosen.edge.end) / 2;
  const posAlongWallFt = midAlong - chosen.wall.startFt;

  const centerPt = pointAtAlong(chosen.wall, midAlong);
  return {
    id: `door-main-${Date.now()}`,
    type: "main_entrance",
    wall_id: chosen.wall.wall.id,
    width_mm: doorWidth * FT_TO_MM,
    height_mm: DOOR_HEIGHT_MM,
    thickness_mm: DOOR_THICKNESS_MM,
    position_along_wall_mm: posAlongWallFt * FT_TO_MM,
    swing_direction: "right",
    swing_angle_deg: 90,
    opens_to: "inside",
    symbol: makeDoorSymbol(centerPt),
    connects_rooms: [entrance.placement.room_id, "outside"],
  };
}

function findSharedEdgeWall(
  roomA: FinePlacement,
  roomB: FinePlacement,
  wallRefs: WallRef[],
): { wall: WallRef; overlap: { start: number; end: number } } | null {
  let best: { wall: WallRef; overlap: { start: number; end: number }; length: number } | null = null;
  for (const w of wallRefs) {
    const edgeA = rectEdgeOnWall(roomA, w);
    const edgeB = rectEdgeOnWall(roomB, w);
    if (!edgeA || !edgeB) continue;
    const start = Math.max(edgeA.start, edgeB.start);
    const end = Math.min(edgeA.end, edgeB.end);
    const len = end - start;
    if (len <= 0) continue;
    if (!best || len > best.length) best = { wall: w, overlap: { start, end }, length: len };
  }
  if (!best) return null;
  return { wall: best.wall, overlap: best.overlap };
}

function placeInteriorDoors(
  constraints: ParsedConstraints,
  placements: FinePlacement[],
  wallRefs: WallRef[],
  existingDoors: Door[],
  warnings: string[],
): Door[] {
  const doors: Door[] = [];
  const byId = new Map(placements.map(p => [p.room_id, p]));
  const INTERIOR_DOOR_RELATIONSHIPS = new Set(["door_connects", "attached_ensuite", "leads_to", "flowing_into"]);

  const seen = new Set<string>();
  for (const adj of constraints.adjacency_pairs) {
    if (!INTERIOR_DOOR_RELATIONSHIPS.has(adj.relationship)) continue;
    const key = [adj.room_a_id, adj.room_b_id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const A = byId.get(adj.room_a_id);
    const B = byId.get(adj.room_b_id);
    if (!A || !B) continue;

    const shared = findSharedEdgeWall(A, B, wallRefs);
    if (!shared) {
      warnings.push(`Interior door "${A.room_name}" <-> "${B.room_name}" (${adj.relationship}): rooms not adjacent, door skipped`);
      continue;
    }

    const overlapLen = shared.overlap.end - shared.overlap.start;
    let doorWidth = DEFAULT_DOOR_WIDTH_FT;
    if (overlapLen < MIN_DOOR_WIDTH_FT + 2 * OPENING_SPACING_FT) {
      if (adj.relationship === "attached_ensuite") {
        doorWidth = Math.max(MIN_DOOR_WIDTH_FT, overlapLen - 2 * OPENING_SPACING_FT);
        if (doorWidth < MIN_DOOR_WIDTH_FT) {
          warnings.push(`Attached ensuite "${A.room_name}" <-> "${B.room_name}": shared edge ${overlapLen.toFixed(1)}ft too short, door shrunk to ${doorWidth.toFixed(1)}ft`);
        }
      } else {
        warnings.push(`Interior door "${A.room_name}" <-> "${B.room_name}": shared edge ${overlapLen.toFixed(1)}ft too short, door skipped`);
        continue;
      }
    }

    const midAlong = (shared.overlap.start + shared.overlap.end) / 2;
    const posAlongWallFt = midAlong - shared.wall.startFt;

    // Check spacing with existing doors on same wall
    const conflict = [...existingDoors, ...doors].some(d => {
      if (d.wall_id !== shared.wall.wall.id) return false;
      const otherPos = d.position_along_wall_mm / FT_TO_MM;
      return Math.abs(otherPos - posAlongWallFt) < doorWidth + OPENING_SPACING_FT;
    });
    if (conflict) {
      warnings.push(`Interior door "${A.room_name}" <-> "${B.room_name}": conflicts with another opening on same wall, skipped`);
      continue;
    }

    const centerPt = pointAtAlong(shared.wall, midAlong);
    doors.push({
      id: `door-int-${doors.length}-${Date.now()}`,
      type: "single_swing",
      wall_id: shared.wall.wall.id,
      width_mm: doorWidth * FT_TO_MM,
      height_mm: DOOR_HEIGHT_MM,
      thickness_mm: DOOR_THICKNESS_MM,
      position_along_wall_mm: posAlongWallFt * FT_TO_MM,
      swing_direction: "right",
      swing_angle_deg: 90,
      opens_to: "inside",
      symbol: makeDoorSymbol(centerPt),
      connects_rooms: [A.room_id, B.room_id],
    });
  }

  return doors;
}

function placeWindows(
  constraints: ParsedConstraints,
  placements: FinePlacement[],
  wallRefs: WallRef[],
  doors: Door[],
  warnings: string[],
): CadWindow[] {
  const windows: CadWindow[] = [];
  const byPlacementId = new Map(placements.map(p => [p.room_id, p]));

  for (const room of constraints.rooms) {
    const p = byPlacementId.get(room.id);
    if (!p) continue;
    for (const win of room.windows) {
      const dir = win.wall_direction;
      const wallOnSide = wallRefs.find(w => {
        if (w.side !== dir) return false;
        return rectEdgeOnWall(p, w) !== null;
      });
      if (!wallOnSide) {
        const internalOnRoomSide = wallRefs.find(w => {
          if (dir === "E" || dir === "W") {
            if (w.orientation !== "vertical") return false;
            if (dir === "E" && Math.abs(w.axisFt - (p.x_ft + p.width_ft)) > 0.01) return false;
            if (dir === "W" && Math.abs(w.axisFt - p.x_ft) > 0.01) return false;
          } else {
            if (w.orientation !== "horizontal") return false;
            if (dir === "N" && Math.abs(w.axisFt - p.y_ft) > 0.01) return false;
            if (dir === "S" && Math.abs(w.axisFt - (p.y_ft + p.depth_ft)) > 0.01) return false;
          }
          return rectEdgeOnWall(p, w) !== null;
        });
        if (internalOnRoomSide && internalOnRoomSide.wall.type === "interior") {
          warnings.push(`Window on "${room.name}"/${dir}: wall is internal (shared with adjacent room), window dropped`);
          continue;
        }
        warnings.push(`Window on "${room.name}"/${dir}: no external wall on that side, window dropped`);
        continue;
      }

      const edge = rectEdgeOnWall(p, wallOnSide);
      if (!edge) continue;
      const edgeLen = edge.end - edge.start;
      const winWidth = Math.min(win.is_large ? LARGE_WINDOW_WIDTH_FT : WINDOW_WIDTH_FT, Math.max(1.5, edgeLen - 2 * CORNER_MARGIN_FT));
      if (winWidth < 1.5) {
        warnings.push(`Window on "${room.name}"/${dir}: wall ${edgeLen.toFixed(1)}ft too short, window dropped`);
        continue;
      }

      const midAlong = (edge.start + edge.end) / 2;
      const posAlongWallFt = midAlong - wallOnSide.startFt;

      const spacingConflict = doors.some(d => {
        if (d.wall_id !== wallOnSide.wall.id) return false;
        const otherPos = d.position_along_wall_mm / FT_TO_MM;
        const otherWidth = d.width_mm / FT_TO_MM;
        return Math.abs(otherPos - posAlongWallFt) < (otherWidth + winWidth) / 2 + OPENING_SPACING_FT;
      }) || windows.some(w => {
        if (w.wall_id !== wallOnSide.wall.id) return false;
        const otherPos = w.position_along_wall_mm / FT_TO_MM;
        const otherWidth = w.width_mm / FT_TO_MM;
        return Math.abs(otherPos - posAlongWallFt) < (otherWidth + winWidth) / 2 + OPENING_SPACING_FT;
      });
      if (spacingConflict) {
        warnings.push(`Window on "${room.name}"/${dir}: conflicts with existing opening on same wall, dropped`);
        continue;
      }

      const startPt = pointAtAlong(wallOnSide, midAlong - winWidth / 2);
      const endPt = pointAtAlong(wallOnSide, midAlong + winWidth / 2);

      windows.push({
        id: `win-${windows.length}-${Date.now()}`,
        type: "casement",
        wall_id: wallOnSide.wall.id,
        width_mm: winWidth * FT_TO_MM,
        height_mm: WINDOW_HEIGHT_MM,
        sill_height_mm: WINDOW_SILL_MM,
        position_along_wall_mm: posAlongWallFt * FT_TO_MM,
        symbol: makeWindowSymbol(startPt, endPt),
        glazing: "double",
        operable: true,
      });
    }
  }

  return windows;
}

/**
 * Stage 3D — graceful-degradation opening placement.
 *
 * Contract: NEVER throws UNSAT. Every failure case degrades (skips, shrinks,
 * picks alternate wall) and pushes a warning. Callers should surface warnings
 * to relaxationsApplied for transparency.
 */
export function placeOpenings(
  constraints: ParsedConstraints,
  placements: FinePlacement[],
  walls: Wall[],
  plotW: number,
  plotD: number,
): OpeningResult {
  const warnings: string[] = [];
  const wallRefs = walls.map(w => wallRefOf(w, plotW, plotD));

  const doors: Door[] = [];
  const mainDoor = placeMainEntrance(constraints, placements, walls, wallRefs, plotW, plotD, warnings);
  if (mainDoor) doors.push(mainDoor);

  const interiorDoors = placeInteriorDoors(constraints, placements, wallRefs, doors, warnings);
  doors.push(...interiorDoors);

  const windows = placeWindows(constraints, placements, wallRefs, doors, warnings);

  logger.debug(`[CSP-3D] openings: ${doors.length} doors, ${windows.length} windows, ${warnings.length} warnings`);

  return { doors, windows, warnings };
}
