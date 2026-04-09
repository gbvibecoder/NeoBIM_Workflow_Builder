/**
 * Floor Plan Geometry Types
 *
 * Used by TR-004 (GPT-4o Vision) for room extraction
 * and GN-011 (Interactive 3D Viewer) for Three.js rendering.
 *
 * Strategy: GPT-4o outputs rooms with absolute x,y positions (meters from
 * building top-left corner). Rooms tile together with no gaps.
 * The GN-011 handler passes positions through; the builder uses them directly.
 */

export interface FloorPlanWall {
  start: [number, number];
  end: [number, number];
  thickness: number;
  type: "exterior" | "interior";
}

export interface FloorPlanDoor {
  position: [number, number];
  width: number;
  wallId: number;
  type: "single" | "double" | "sliding";
  connectsRooms?: [string, string];
}

export interface FloorPlanWindow {
  position: [number, number];
  width: number;
  height: number;
  sillHeight: number;
}

export type FloorPlanRoomType =
  | "living"
  | "bedroom"
  | "kitchen"
  | "dining"
  | "bathroom"
  | "veranda"
  | "hallway"
  | "storage"
  | "office"
  | "balcony"
  | "patio"
  | "entrance"
  | "utility"
  | "closet"
  | "passage"
  | "studio"
  | "staircase"
  | "other";

export interface FloorPlanRoom {
  name: string;
  center: [number, number];
  width: number;
  depth: number;
  type: FloorPlanRoomType;
  /** Absolute X: left edge in meters from building left wall */
  x?: number;
  /** Absolute Y: top edge in meters from building top wall */
  y?: number;
  /** @deprecated Use x,y instead. Grid row (0 = top, 1 = middle, 2 = bottom) */
  row?: number;
  /** @deprecated Use x,y instead. Grid column (0 = leftmost, 1, 2, ...) */
  col?: number;
  /** Names of adjacent rooms (for door openings) */
  adjacentRooms?: string[];
  /** Polygon vertices [[x,y], ...] for non-rectangular rooms (optional, used by editor) */
  polygon?: [number, number][];
  /** Area in m² */
  area?: number;
  /** Dimension text from plan labels, e.g. "3.2M × 3.6M" */
  dimensions?: string;
}

export interface FloorPlanGeometry {
  footprint: { width: number; depth: number };
  wallHeight: number;
  walls: FloorPlanWall[];
  doors: FloorPlanDoor[];
  windows: FloorPlanWindow[];
  rooms: FloorPlanRoom[];
  /** Building shape: "rectangular" | "triangular" | "L-shaped" | "curved" | "irregular" | "angled" */
  buildingShape?: string;
  /** For non-rectangular buildings: outline vertices in meters [[x,y], ...] clockwise */
  buildingOutline?: [number, number][];
}
