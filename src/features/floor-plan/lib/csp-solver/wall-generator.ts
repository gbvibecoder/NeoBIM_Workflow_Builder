import type { Wall, Point } from "@/types/floor-plan-cad";
import type { FinePlacement } from "./cell-csp";

const FT_TO_MM = 304.8;
const DEFAULT_EXTERNAL_WALL_FT = 0.75; // 9 inches
const DEFAULT_INTERNAL_WALL_FT = 0.33; // 4 inches
const MERGE_TOL = 0.01;

export interface WallGenOptions {
  external_walls_ft?: number | null;
  internal_walls_ft?: number | null;
  plot_width_ft: number;
  plot_depth_ft: number;
}

interface RawSeg {
  orientation: "horizontal" | "vertical";
  axis: number;        // y for horizontal, x for vertical
  start: number;       // x for horizontal, y for vertical
  end: number;
  rooms: string[];     // room ids touching this segment on this edge
}

function mergeSegments(segs: RawSeg[]): RawSeg[] {
  const byKey = new Map<string, RawSeg[]>();
  for (const s of segs) {
    const key = `${s.orientation}:${s.axis.toFixed(3)}`;
    const arr = byKey.get(key);
    if (arr) arr.push(s); else byKey.set(key, [s]);
  }
  const merged: RawSeg[] = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => a.start - b.start);
    let current: RawSeg | null = null;
    for (const s of group) {
      if (!current) {
        current = { ...s, rooms: [...s.rooms] };
        continue;
      }
      if (s.start <= current.end + MERGE_TOL) {
        current.end = Math.max(current.end, s.end);
        for (const r of s.rooms) if (!current.rooms.includes(r)) current.rooms.push(r);
      } else {
        merged.push(current);
        current = { ...s, rooms: [...s.rooms] };
      }
    }
    if (current) merged.push(current);
  }
  return merged;
}

function isOnPlotBoundary(s: RawSeg, plotW: number, plotD: number): boolean {
  if (s.orientation === "horizontal") {
    return Math.abs(s.axis) < MERGE_TOL || Math.abs(s.axis - plotD) < MERGE_TOL;
  }
  return Math.abs(s.axis) < MERGE_TOL || Math.abs(s.axis - plotW) < MERGE_TOL;
}

function segToPoints(s: RawSeg): { start: Point; end: Point } {
  if (s.orientation === "horizontal") {
    return {
      start: { x: s.start * FT_TO_MM, y: s.axis * FT_TO_MM },
      end: { x: s.end * FT_TO_MM, y: s.axis * FT_TO_MM },
    };
  }
  return {
    start: { x: s.axis * FT_TO_MM, y: s.start * FT_TO_MM },
    end: { x: s.axis * FT_TO_MM, y: s.end * FT_TO_MM },
  };
}

export function generateWalls(placements: FinePlacement[], options: WallGenOptions): Wall[] {
  const externalFt = options.external_walls_ft ?? DEFAULT_EXTERNAL_WALL_FT;
  const internalFt = options.internal_walls_ft ?? DEFAULT_INTERNAL_WALL_FT;
  const plotW = options.plot_width_ft;
  const plotD = options.plot_depth_ft;

  const raw: RawSeg[] = [];

  // Collect the 4 edges of each room
  for (const p of placements) {
    const x1 = p.x_ft;
    const y1 = p.y_ft;
    const x2 = p.x_ft + p.width_ft;
    const y2 = p.y_ft + p.depth_ft;

    raw.push({ orientation: "horizontal", axis: y1, start: x1, end: x2, rooms: [p.room_id] });
    raw.push({ orientation: "horizontal", axis: y2, start: x1, end: x2, rooms: [p.room_id] });
    raw.push({ orientation: "vertical", axis: x1, start: y1, end: y2, rooms: [p.room_id] });
    raw.push({ orientation: "vertical", axis: x2, start: y1, end: y2, rooms: [p.room_id] });
  }

  // Add plot perimeter as its own baseline segments (for rooms that don't reach the edge)
  raw.push({ orientation: "horizontal", axis: 0, start: 0, end: plotW, rooms: [] });
  raw.push({ orientation: "horizontal", axis: plotD, start: 0, end: plotW, rooms: [] });
  raw.push({ orientation: "vertical", axis: 0, start: 0, end: plotD, rooms: [] });
  raw.push({ orientation: "vertical", axis: plotW, start: 0, end: plotD, rooms: [] });

  const merged = mergeSegments(raw);

  const walls: Wall[] = [];
  let idx = 0;
  for (const s of merged) {
    const onBoundary = isOnPlotBoundary(s, plotW, plotD);
    const thicknessFt = onBoundary ? externalFt : internalFt;
    const { start, end } = segToPoints(s);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 1) continue; // skip zero-length
    walls.push({
      id: `wall-${idx++}`,
      type: onBoundary ? "exterior" : "interior",
      material: "brick",
      centerline: { start, end },
      thickness_mm: thicknessFt * FT_TO_MM,
      height_mm: 3000,
      left_room_id: s.rooms[0],
      right_room_id: s.rooms[1],
      openings: [],
      line_weight: onBoundary ? "thick" : "medium",
      is_load_bearing: onBoundary,
    });
  }

  return walls;
}
