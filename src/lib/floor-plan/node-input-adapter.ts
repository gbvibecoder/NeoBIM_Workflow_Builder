/**
 * Node Input Adapter — Converts various upstream node outputs into FloorPlanProject.
 *
 * Supports inputs from:
 *   - TR-004 (Floor Plan Analyzer) — geometry JSON with rooms/walls
 *   - GN-011 (3D Viewer) — floorPlanGeometry embedded in html artifact
 *   - Raw FloorPlanProject JSON (re-editing saved projects)
 *   - Raw FloorPlanGeometry JSON (from any geometry-producing node)
 */

import type { FloorPlanGeometry, FloorPlanRoom } from "@/types/floor-plan";
import type { FloorPlanProject, Floor } from "@/types/floor-plan-cad";
import { convertGeometryToProject } from "./pipeline-adapter";

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface AdaptedInput {
  project: FloorPlanProject;
  sourceType: "tr004" | "geometry" | "project" | "raw-rooms" | "fallback";
  warnings: string[];
}

/**
 * Convert arbitrary upstream node output into a validated FloorPlanProject.
 * Tries multiple strategies in priority order.
 */
export function adaptNodeInput(
  inputData: Record<string, unknown>,
  designBrief?: string
): AdaptedInput {
  const warnings: string[] = [];
  const raw = inputData._raw as Record<string, unknown> | undefined;
  const effective = raw ?? inputData;

  // Strategy 1: Already a FloorPlanProject (re-edit or direct pass-through)
  if (isFloorPlanProject(effective)) {
    return {
      project: effective as unknown as FloorPlanProject,
      sourceType: "project",
      warnings,
    };
  }

  // Strategy 2: TR-004 output — has geometry.rooms + geometry.walls
  const geometry = extractGeometry(effective);
  if (geometry) {
    const name = designBrief
      ? designBrief.slice(0, 60).trim()
      : "AI-Generated Floor Plan";
    const project = convertGeometryToProject(geometry, name, designBrief);
    return { project, sourceType: "tr004", warnings };
  }

  // Strategy 3: Raw rooms array (from simplified AI output)
  const rooms = extractRooms(effective);
  if (rooms && rooms.length > 0) {
    const footprint = estimateFootprint(rooms);
    const syntheticGeometry: FloorPlanGeometry = {
      footprint,
      wallHeight: 3.0,
      walls: [],
      doors: [],
      windows: [],
      rooms,
    };
    const project = convertGeometryToProject(
      syntheticGeometry,
      "AI-Generated Floor Plan",
      designBrief
    );
    warnings.push("Walls auto-generated from room boundaries (no wall data in input)");
    return { project, sourceType: "raw-rooms", warnings };
  }

  // Strategy 4: Fallback — create a blank project
  warnings.push("No recognizable floor plan data in input. Created blank project.");
  const blankGeometry: FloorPlanGeometry = {
    footprint: { width: 12, depth: 10 },
    wallHeight: 3.0,
    walls: [],
    doors: [],
    windows: [],
    rooms: [
      {
        name: "Room 1",
        center: [6, 5],
        width: 12,
        depth: 10,
        type: "living",
        x: 0,
        y: 0,
      },
    ],
  };
  const project = convertGeometryToProject(blankGeometry, "Untitled Floor Plan", designBrief);
  return { project, sourceType: "fallback", warnings };
}

// ────────────────────────────────────────────────────────────────────────────
// Detection helpers
// ────────────────────────────────────────────────────────────────────────────

function isFloorPlanProject(data: Record<string, unknown>): boolean {
  return (
    typeof data.id === "string" &&
    typeof data.name === "string" &&
    Array.isArray(data.floors) &&
    (data.floors as unknown[]).length > 0 &&
    typeof (data as Record<string, unknown>).settings === "object"
  );
}

function extractGeometry(data: Record<string, unknown>): FloorPlanGeometry | null {
  // TR-004 nests geometry under data.geometry
  const geo = data.geometry as Record<string, unknown> | undefined;
  if (geo && Array.isArray(geo.rooms) && geo.rooms.length > 0) {
    const footprint = (geo.footprint as { width: number; depth: number }) ?? {
      width: (geo.buildingWidth as number) ?? 12,
      depth: (geo.buildingDepth as number) ?? 10,
    };
    return {
      footprint,
      wallHeight: (geo.wallHeight as number) ?? 3.0,
      walls: (geo.walls as FloorPlanGeometry["walls"]) ?? [],
      doors: (geo.doors as FloorPlanGeometry["doors"]) ?? [],
      windows: (geo.windows as FloorPlanGeometry["windows"]) ?? [],
      rooms: geo.rooms as FloorPlanRoom[],
    };
  }

  // Direct FloorPlanGeometry at top level
  if (Array.isArray(data.rooms) && (data.rooms as unknown[]).length > 0 && data.footprint) {
    return data as unknown as FloorPlanGeometry;
  }

  // GN-011 stores geometry in floorPlanGeometry
  const fpGeo = data.floorPlanGeometry as Record<string, unknown> | undefined;
  if (fpGeo && Array.isArray(fpGeo.rooms)) {
    return fpGeo as unknown as FloorPlanGeometry;
  }

  return null;
}

function extractRooms(data: Record<string, unknown>): FloorPlanRoom[] | null {
  // richRooms from TR-004
  const richRooms = data.richRooms as Array<Record<string, unknown>> | undefined;
  if (richRooms && richRooms.length > 0) {
    return richRooms.map((r, i) => {
      const name = (r.name as string) ?? `Room ${i + 1}`;
      const dims = (r.dimensions as string) ?? "";
      const [wStr, dStr] = dims.split(/[x×]/i).map((s) => parseFloat(s));
      const w = isNaN(wStr) ? 4 : wStr;
      const d = isNaN(dStr) ? 3 : dStr;
      return {
        name,
        center: [w / 2, d / 2] as [number, number],
        width: w,
        depth: d,
        type: guessRoomType(name),
        x: 0,
        y: 0,
      };
    });
  }

  // Direct rooms array
  if (Array.isArray(data.rooms)) {
    const rooms = data.rooms as FloorPlanRoom[];
    if (rooms.length > 0 && typeof rooms[0].name === "string") {
      return rooms;
    }
  }

  return null;
}

function estimateFootprint(rooms: FloorPlanRoom[]): { width: number; depth: number } {
  const totalArea = rooms.reduce((s, r) => s + r.width * r.depth, 0);
  const side = Math.sqrt(totalArea * 1.15); // ~15% circulation overhead
  return { width: Math.ceil(side), depth: Math.ceil(side * 0.85) };
}

function guessRoomType(name: string): FloorPlanRoom["type"] {
  const n = name.toLowerCase();
  if (n.includes("living") || n.includes("drawing")) return "living";
  if (n.includes("master") || n.includes("bed")) return "bedroom";
  if (n.includes("kitchen")) return "kitchen";
  if (n.includes("dining")) return "dining";
  if (n.includes("bath") || n.includes("toilet") || n.includes("wc")) return "bathroom";
  if (n.includes("balcon") || n.includes("verand")) return "balcony";
  if (n.includes("corrid") || n.includes("hall") || n.includes("passage")) return "hallway";
  if (n.includes("store") || n.includes("storage")) return "storage";
  if (n.includes("utility") || n.includes("laundry")) return "utility";
  if (n.includes("stair")) return "staircase";
  if (n.includes("study") || n.includes("office")) return "office";
  if (n.includes("pooja") || n.includes("prayer")) return "other";
  return "other";
}
