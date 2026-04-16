/**
 * Strip-pack engine — internal types.
 *
 * Coordinate system: origin (0, 0) at the SW corner of the plot.
 *   X grows EAST.
 *   Y grows NORTH.
 *   This matches the FloorPlanProject renderer convention (Y-UP), so the
 *   converter at the end of the pipeline can write project geometry directly
 *   without a Y flip.
 *
 * Units: feet throughout the engine. The converter multiplies by FT_TO_MM
 *   exactly once when emitting the FloorPlanProject.
 */

// ───────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ───────────────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;       // left edge in ft from plot origin (SW)
  y: number;       // bottom edge in ft from plot origin (SW)
  width: number;   // east-west dimension in ft
  depth: number;   // north-south dimension in ft
}

export type Facing = "north" | "south" | "east" | "west";

export type RoomZone =
  | "PUBLIC"
  | "PRIVATE"
  | "SERVICE"
  | "WET"
  | "WORSHIP"
  | "CIRCULATION"
  | "OUTDOOR"
  | "ENTRANCE";

export type StripAssignment = "FRONT" | "BACK" | "ENTRANCE" | "ATTACHED" | "SPINE";

// ───────────────────────────────────────────────────────────────────────────
// ROOMS
// ───────────────────────────────────────────────────────────────────────────

export interface StripPackRoom {
  /** Stable id — taken from the parser output when available, else generated. */
  id: string;
  /** Display name shown in the room schedule. */
  name: string;
  /** Snake-case function from the parser ("master_bedroom", "kitchen", …). */
  type: string;
  /** Asked-for dimensions (may be defaulted from room-standards if user omitted). */
  requested_width_ft: number;
  requested_depth_ft: number;
  requested_area_sqft: number;
  /** Coarse zone classification — drives strip routing + colors. */
  zone: RoomZone;
  /** Which strip the room belongs to. ATTACHED = handled by sub-room-attacher. */
  strip: StripAssignment;
  /** Free-form preference from the parser ("southwest", "north_center", …). */
  position_preference?: string;
  /** Names (or ids) of rooms this room must be adjacent to. */
  adjacencies: string[];
  /** Parent room name when this is an attached ensuite / wardrobe. */
  is_attached_to?: string;
  /** True if the room must touch an exterior wall (per parser flags). */
  needs_exterior_wall: boolean;
  /** Cached parser flag — bathrooms & similar. Used by door/window placers. */
  is_wet: boolean;
  /** Cached parser flag — pooja and similar. */
  is_sacred: boolean;
  /**
   * Phase 3B fix #5 — within-row anchor edge derived from position_preference.
   * 'west' = pack toward x=0 of the canonical strip; 'east' = pack toward
   * x=strip.width; 'none' = unanchored, fills the middle. The translation
   * from compass direction → canonical anchor depends on facing (handled
   * by the classifier).
   */
  anchor_edge?: "west" | "east" | "none";
  /**
   * Phase 3B fix #6 — adjacency group id. Set by the orchestrator after
   * union-find over parsed.adjacency_pairs. Group members get coerced to
   * the same strip (largest room with a position preference wins) and
   * sorted contiguously so the greedy packer places them in the same row
   * whenever it fits. Singleton groups stay undefined.
   */
  group_id?: string;

  // ── Filled in by the placer ───────────────────────────────────────────
  placed?: Rect;
  actual_area_sqft?: number;
  /** Set after wall-builder runs. */
  wall_ids?: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// SPINE
// ───────────────────────────────────────────────────────────────────────────

export interface SpineLayout {
  spine: Rect;
  /** Strip on the entrance-side of the spine. May be empty after entrance carve-out. */
  front_strip: Rect;
  /** Strip on the far-side of the spine. */
  back_strip: Rect;
  /** Cutout(s) for porch+foyer. Removed from the front strip. */
  entrance_rooms: Rect[];
  /** Front strip after removing entrance cutouts. May be 1–3 rectangles (L-shape). */
  remaining_front: Rect[];
  orientation: "horizontal" | "vertical";
  /** Which side of the plot is the front (entrance side). */
  entrance_side: Facing;
  hallway_width_ft: number;
}

// ───────────────────────────────────────────────────────────────────────────
// OPENINGS
// ───────────────────────────────────────────────────────────────────────────

export interface DoorPlacement {
  /** Endpoints of the door span on the wall, in feet. The door is the segment
   *  between these two points. Always axis-aligned. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Names of the two sides — second may be "hallway" or "exterior". */
  between: [string, string];
  width_ft: number;
  /** Which axis the door is parallel to. */
  orientation: "horizontal" | "vertical";
  /** Set by door-placer once wall-builder has assigned ids. */
  wall_id?: string;
  /** Tagged so the converter can mark the main entry. */
  is_main_entrance?: boolean;
}

export type WindowKind = "standard" | "large" | "ventilation";

export interface WindowPlacement {
  on_room: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Which exterior side of the plot the window faces. */
  wall_side: Facing;
  width_ft: number;
  kind: WindowKind;
  /** Set by window-placer once wall-builder has assigned ids. */
  wall_id?: string;
  /** Sill height — relevant for converter metadata; default 3ft, bath = 6ft. */
  sill_height_ft: number;
}

// ───────────────────────────────────────────────────────────────────────────
// WALLS
// ───────────────────────────────────────────────────────────────────────────

export type WallType = "external" | "internal";

export interface WallSegment {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  thickness_ft: number;
  type: WallType;
  /** Room ids that share this wall. Two for internal, one for external. */
  room_ids: string[];
  /** "horizontal" if Y is constant, "vertical" if X is constant. */
  orientation: "horizontal" | "vertical";
}

// ───────────────────────────────────────────────────────────────────────────
// METRICS + RESULT
// ───────────────────────────────────────────────────────────────────────────

export interface StripPackMetrics {
  efficiency_pct: number;
  void_area_sqft: number;
  door_coverage_pct: number;
  orphan_rooms: string[];
  adjacency_satisfaction_pct: number;
  total_rooms: number;
  rooms_with_doors: number;
  required_adjacencies: number;
  satisfied_adjacencies: number;
}

export interface StripPackResult {
  rooms: StripPackRoom[];
  spine: SpineLayout;
  walls: WallSegment[];
  doors: DoorPlacement[];
  windows: WindowPlacement[];
  /** Plot bounds in feet — origin at SW. */
  plot: Rect;
  metrics: StripPackMetrics;
  warnings: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ───────────────────────────────────────────────────────────────────────────

export const FT_TO_MM = 304.8;
export const SQM_PER_SQFT = 0.092903;
export const SQFT_PER_SQM = 10.7639;

/** External brick wall — 9" / 230mm / 0.75ft. */
export const WALL_THICKNESS_EXT_FT = 0.75;
/** Internal partition — 5" / 125mm / 0.42ft. */
export const WALL_THICKNESS_INT_FT = 0.42;

/** Snap helper to avoid floating-point drift comparing edges. */
export function feq(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) < eps;
}

export function rectArea(r: Rect): number {
  return r.width * r.depth;
}

export function rectOverlap(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.depth, b.y + b.depth);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

export function rectsShareEdge(a: Rect, b: Rect, eps = 1e-3): { axis: "x" | "y"; length: number } | null {
  // Vertical shared edge: a.right == b.left or a.left == b.right
  if (feq(a.x + a.width, b.x, eps) || feq(b.x + b.width, a.x, eps)) {
    const overlapStart = Math.max(a.y, b.y);
    const overlapEnd = Math.min(a.y + a.depth, b.y + b.depth);
    const len = overlapEnd - overlapStart;
    if (len > eps) return { axis: "y", length: len };
  }
  // Horizontal shared edge: a.top == b.bottom or a.bottom == b.top
  if (feq(a.y + a.depth, b.y, eps) || feq(b.y + b.depth, a.y, eps)) {
    const overlapStart = Math.max(a.x, b.x);
    const overlapEnd = Math.min(a.x + a.width, b.x + b.width);
    const len = overlapEnd - overlapStart;
    if (len > eps) return { axis: "x", length: len };
  }
  return null;
}
