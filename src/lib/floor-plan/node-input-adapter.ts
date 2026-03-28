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

  // When GN-012 receives merged data from multiple upstream nodes (GN-004 + TR-003),
  // _raw comes from TR-003 (design brief) while geometry/roomList sit at top level
  // from GN-004. Don't let _raw shadow the actual room data.
  const hasDirectRoomData = !!inputData.geometry
    || Array.isArray(inputData.roomList)
    || Array.isArray(inputData.rooms)
    || Array.isArray(inputData.richRooms);
  const effective = (raw && !hasDirectRoomData) ? raw : inputData;

  // Strategy 1: Already a FloorPlanProject (re-edit or direct pass-through)
  if (isFloorPlanProject(effective)) {
    return {
      project: effective as unknown as FloorPlanProject,
      sourceType: "project",
      warnings,
    };
  }
  // Also check _raw for FloorPlanProject (in case it's nested)
  if (raw && raw !== effective && isFloorPlanProject(raw)) {
    return {
      project: raw as unknown as FloorPlanProject,
      sourceType: "project",
      warnings,
    };
  }

  // Strategy 2: TR-004 / GN-004 output — has geometry.rooms
  const geometry = extractGeometry(effective) ?? (raw && raw !== effective ? extractGeometry(raw) : null);
  if (geometry) {
    const name = designBrief
      ? designBrief.slice(0, 60).trim()
      : "AI-Generated Floor Plan";
    const project = convertGeometryToProject(geometry, name, designBrief);
    return { project, sourceType: "tr004", warnings };
  }

  // Strategy 3: Raw rooms array (from simplified AI output or GN-004 roomList)
  const rooms = extractRooms(effective) ?? (raw && raw !== effective ? extractRooms(raw) : null);
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
    const name = designBrief
      ? designBrief.slice(0, 60).trim()
      : "AI-Generated Floor Plan";
    const project = convertGeometryToProject(
      syntheticGeometry,
      name,
      designBrief
    );
    warnings.push("Walls auto-generated from room boundaries (no wall data in input)");
    return { project, sourceType: "raw-rooms", warnings };
  }

  // Strategy 4: Fallback — use realistic sample 2BHK so the editor is never blank
  warnings.push("No recognizable floor plan data in input. Using sample floor plan.");
  const fallbackGeometry: FloorPlanGeometry = {
    footprint: { width: 11.6, depth: 9.0 },
    wallHeight: 3.0,
    walls: [
      { start: [0, 0], end: [11.6, 0], thickness: 0.23, type: "exterior" as const },
      { start: [11.6, 0], end: [11.6, 9.0], thickness: 0.23, type: "exterior" as const },
      { start: [11.6, 9.0], end: [0, 9.0], thickness: 0.23, type: "exterior" as const },
      { start: [0, 9.0], end: [0, 0], thickness: 0.23, type: "exterior" as const },
      { start: [5.1, 0], end: [5.1, 7.0], thickness: 0.15, type: "interior" as const },
      { start: [9.1, 0], end: [9.1, 3.55], thickness: 0.15, type: "interior" as const },
      { start: [0, 5.0], end: [10.0, 5.0], thickness: 0.15, type: "interior" as const },
      { start: [4.0, 5.0], end: [4.0, 6.0], thickness: 0.15, type: "interior" as const },
    ],
    doors: [
      { position: [2.5, 5.0], width: 0.9, wallId: 6, type: "single" as const },
      { position: [5.1, 2.0], width: 0.9, wallId: 4, type: "single" as const },
      { position: [5.1, 5.5], width: 0.9, wallId: 4, type: "single" as const },
      { position: [9.1, 0.9], width: 0.75, wallId: 5, type: "single" as const },
      { position: [9.1, 2.7], width: 0.75, wallId: 5, type: "single" as const },
      { position: [2.0, 5.0], width: 0.9, wallId: 6, type: "single" as const },
      { position: [5.5, 0], width: 1.05, wallId: 0, type: "single" as const },
    ],
    windows: [
      { position: [2.5, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
      { position: [7.1, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
      { position: [0, 2.5], width: 1.5, height: 1.2, sillHeight: 0.9 },
      { position: [0, 6.5], width: 1.2, height: 1.2, sillHeight: 0.9 },
      { position: [11.6, 5.0], width: 1.2, height: 1.0, sillHeight: 1.0 },
      { position: [2.5, 9.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    ],
    rooms: [
      { name: "Living Room",  type: "living",   x: 0,   y: 0,   width: 5.1, depth: 5.0, center: [2.55, 2.5]  },
      { name: "Bedroom 1",    type: "bedroom",  x: 5.1, y: 0,   width: 4.0, depth: 4.0, center: [7.1, 2.0]   },
      { name: "Bathroom 1",   type: "bathroom", x: 9.1, y: 0,   width: 2.5, depth: 1.8, center: [10.35, 0.9] },
      { name: "Bathroom 2",   type: "bathroom", x: 9.1, y: 1.8, width: 2.0, depth: 1.75, center: [10.1, 2.675] },
      { name: "Bedroom 2",    type: "bedroom",  x: 5.1, y: 4.0, width: 4.0, depth: 3.0, center: [7.1, 5.5]   },
      { name: "Kitchen",      type: "kitchen",  x: 0,   y: 5.0, width: 4.0, depth: 3.0, center: [2.0, 6.5]   },
      { name: "Hallway",      type: "hallway",  x: 4.0, y: 5.0, width: 6.0, depth: 1.0, center: [7.0, 5.5]   },
      { name: "Balcony",      type: "balcony",  x: 0,   y: 8.0, width: 5.0, depth: 1.0, center: [2.5, 8.5]   },
    ],
  };
  const fallbackName = designBrief
    ? designBrief.slice(0, 60).trim()
    : "Sample Floor Plan";
  const project = convertGeometryToProject(fallbackGeometry, fallbackName, designBrief);
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
  // TR-004 / GN-004 nests geometry under data.geometry
  const geo = data.geometry as Record<string, unknown> | undefined;
  if (geo && Array.isArray(geo.rooms) && geo.rooms.length > 0) {
    const footprint = (geo.footprint as { width: number; depth: number }) ?? {
      width: (geo.buildingWidth as number) ?? 12,
      depth: (geo.buildingDepth as number) ?? 10,
    };

    // Prefer positionedRooms (has x/y) over rooms (may lack position data)
    const rawRooms = (Array.isArray(geo.positionedRooms) && geo.positionedRooms.length > 0)
      ? geo.positionedRooms as Array<Record<string, unknown>>
      : geo.rooms as Array<Record<string, unknown>>;

    // Ensure each room has center, x, y fields required by FloorPlanRoom
    const rooms: FloorPlanRoom[] = rawRooms.map((r) => {
      const name = (r.name as string) ?? "Room";
      const type = (r.type as FloorPlanRoom["type"]) ?? "other";
      const width = (r.width as number) ?? 4;
      const depth = (r.depth as number) ?? 3;
      const x = (r.x as number) ?? undefined;
      const y = (r.y as number) ?? undefined;
      const center = r.center as [number, number] | undefined;

      // Compute center from x/y if not provided
      const resolvedCenter: [number, number] = center
        ?? (x != null && y != null ? [x + width / 2, y + depth / 2] : [width / 2, depth / 2]);
      const resolvedX = x ?? (center ? center[0] - width / 2 : 0);
      const resolvedY = y ?? (center ? center[1] - depth / 2 : 0);

      return {
        name,
        center: resolvedCenter,
        width,
        depth,
        type,
        x: resolvedX,
        y: resolvedY,
        area: (r.area as number) ?? width * depth,
      };
    });

    return {
      footprint,
      wallHeight: (geo.wallHeight as number) ?? 3.0,
      walls: (geo.walls as FloorPlanGeometry["walls"]) ?? [],
      doors: (geo.doors as FloorPlanGeometry["doors"]) ?? [],
      windows: (geo.windows as FloorPlanGeometry["windows"]) ?? [],
      rooms,
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

  // GN-004 outputs roomList at top level (array of {name, area, type, ...})
  // Mock GN-004 includes x, y, width, depth; real GN-004 may only have name+area
  if (Array.isArray(data.roomList)) {
    const roomList = data.roomList as Array<Record<string, unknown>>;
    if (roomList.length > 0 && typeof roomList[0].name === "string") {
      return roomList.map((r, i) => {
        const name = (r.name as string) ?? `Room ${i + 1}`;
        const area = (r.area as number) ?? 16;
        // Use actual width/depth if provided, otherwise estimate from area
        const hasPosition = typeof r.width === "number" && typeof r.depth === "number";
        const w = hasPosition ? (r.width as number) : Math.round(Math.sqrt(area) * 10) / 10;
        const d = hasPosition ? (r.depth as number) : Math.round(Math.sqrt(area) * 10) / 10;
        const x = typeof r.x === "number" ? (r.x as number) : 0;
        const y = typeof r.y === "number" ? (r.y as number) : 0;
        return {
          name,
          center: [x + w / 2, y + d / 2] as [number, number],
          width: w,
          depth: d,
          type: (r.type as FloorPlanRoom["type"]) ?? guessRoomType(name),
          x,
          y,
          area,
        };
      });
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
