import type { Room, FloorPlanProject, Point } from "@/types/floor-plan-cad";
import type { CompassDirection } from "../types";

const FT_PER_MM = 1 / 304.8;

export function mmToFt(mm: number): number {
  return mm * FT_PER_MM;
}

export function bbox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function roomDimsFt(room: Room): { width_ft: number; depth_ft: number } {
  const b = bbox(room.boundary.points);
  return { width_ft: mmToFt(b.width), depth_ft: mmToFt(b.height) };
}

export function roomCentroid(room: Room): { x: number; y: number } {
  const b = bbox(room.boundary.points);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function projectBbox(project: FloorPlanProject) {
  const floor = project.floors[0];
  if (!floor) return null;
  // Prefer the plot boundary (floor.boundary) — matches what the solver was
  // targeting. Falls back to rooms bbox for legacy projects without a floor
  // boundary (Pipeline A paths may omit it).
  if (floor.boundary && floor.boundary.points.length > 0) {
    return bbox(floor.boundary.points);
  }
  if (floor.rooms.length === 0) return null;
  const allPoints: Point[] = floor.rooms.flatMap(r => r.boundary.points);
  return bbox(allPoints);
}

export function quadrantOf(room: Room, project: FloorPlanProject): CompassDirection {
  const pb = projectBbox(project);
  if (!pb) return "CENTER";
  const c = roomCentroid(room);
  const nx = (c.x - pb.minX) / Math.max(pb.width, 1);
  const ny = (c.y - pb.minY) / Math.max(pb.height, 1);

  const xBand = nx < 1 / 3 ? "W" : nx < 2 / 3 ? "M" : "E";
  const yBand = ny < 1 / 3 ? "N" : ny < 2 / 3 ? "M" : "S";

  if (yBand === "N") {
    if (xBand === "W") return "NW";
    if (xBand === "E") return "NE";
    return "N";
  }
  if (yBand === "S") {
    if (xBand === "W") return "SW";
    if (xBand === "E") return "SE";
    return "S";
  }
  if (xBand === "W") return "W";
  if (xBand === "E") return "E";
  return "CENTER";
}

export function findMatchingRoom(rooms: Room[], nameSubstring: string, fnHint?: string): Room | null {
  const sub = nameSubstring.toLowerCase();
  for (const r of rooms) {
    if (r.name.toLowerCase().includes(sub)) return r;
  }
  if (fnHint) {
    for (const r of rooms) {
      if (r.type.toLowerCase().includes(fnHint.toLowerCase())) return r;
    }
  }
  return null;
}

export function getAllRooms(project: FloorPlanProject): Room[] {
  return project.floors.flatMap(f => f.rooms);
}
