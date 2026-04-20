/**
 * Reference + Adapt engine — type definitions.
 *
 * A ReferenceFloorPlan encodes a real architect-designed layout using
 * NORMALIZED coordinates (0-1 range). This makes scaling to ANY plot
 * size a trivial multiplication — no LLM, no algorithm, just math.
 */

// ───────────────────────────────────────────────────────────────────────────
// REFERENCE PLAN
// ───────────────────────────────────────────────────────────────────────────

export type RefStyle = "apartment" | "villa" | "bungalow" | "row_house" | "duplex";

export interface ReferenceMetadata {
  bhk: number;
  plot_width_ft: number;
  plot_depth_ft: number;
  total_area_sqft: number;
  facing: "N" | "S" | "E" | "W";
  vastu_compliant: boolean;
  room_count: number;
  has_parking: boolean;
  has_pooja: boolean;
  has_utility: boolean;
  has_balcony: boolean;
  has_servant_quarter: boolean;
  style: RefStyle;
}

export type RefRoomZone = "PUBLIC" | "PRIVATE" | "SERVICE" | "CIRCULATION" | "ENTRANCE";

export interface ReferenceRoom {
  /** Display name, e.g. "Master Bedroom" */
  name: string;
  /** Snake-case function, e.g. "master_bedroom" */
  type: string;
  /** Normalized position 0-1 (fraction of plot width). 0 = left. */
  nx: number;
  /** Normalized position 0-1 (fraction of plot depth). 0 = bottom. */
  ny: number;
  /** Width as fraction of plot width. */
  nw: number;
  /** Depth as fraction of plot depth. */
  nd: number;
  /** Original designed width in feet (informational). */
  original_width_ft: number;
  /** Original designed depth in feet (informational). */
  original_depth_ft: number;
  /** Parent room if this is an ensuite/attached room. */
  attached_to?: string;
  /** Coarse zone for color coding + logic. */
  zone: RefRoomZone;
}

export interface ReferenceHallway {
  nx: number;
  ny: number;
  nw: number;
  nd: number;
  orientation: "horizontal" | "vertical";
}

export interface ReferenceFloorPlan {
  id: string;
  metadata: ReferenceMetadata;
  rooms: ReferenceRoom[];
  hallway: ReferenceHallway | null;
  /** Pairs of room names that share a wall in the original design. */
  adjacency: [string, string][];
}

// ───────────────────────────────────────────────────────────────────────────
// MATCH RESULT
// ───────────────────────────────────────────────────────────────────────────

export interface MatchBreakdown {
  bhk_match: number;
  facing_match: number;
  area_match: number;
  plot_ratio_match: number;
  room_overlap: number;
  vastu_bonus: number;
  special_bonus: number;
}

export interface MatchScore {
  ref: ReferenceFloorPlan;
  score: number;
  breakdown: MatchBreakdown;
}
