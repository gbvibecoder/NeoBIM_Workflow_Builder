import type { FloorPlanProject } from "@/types/floor-plan-cad";

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER";

export interface ExpectedRoom {
  function: string;
  name_substring: string;
  dim_width_ft?: number;
  dim_depth_ft?: number;
  position_direction?: CompassDirection;
  must_have_window_on?: "N" | "S" | "E" | "W";
}

export interface ExpectedRelationalAdjacency {
  /** Name substring of room A. */
  a: string;
  /** Name substring of room B. */
  b: string;
  /** Compass direction from A toward B (absolute). */
  direction: CompassDirection;
}

export interface ExpectedWindow {
  /** Name substring of the room. */
  room: string;
  wall: "N" | "S" | "E" | "W";
}

export interface PromptExpectation {
  id: string;
  prompt: string;
  vastu_required: boolean;
  plot: { width_ft: number; depth_ft: number; facing: CompassDirection } | null;
  expected_rooms: ExpectedRoom[];
  forbidden_rooms: string[];
  expected_pipeline: "A" | "B";
  /** Phase 7: directional adjacency expectations (A west of B, etc.). */
  expected_relational?: ExpectedRelationalAdjacency[];
  /** Phase 7: if set, main entrance door should be on this plot wall. */
  expected_main_entrance_side?: "N" | "S" | "E" | "W";
  /** Phase 7: hallway/corridor should share edge with each of these room name-substrings. */
  expected_hallway_connects?: string[];
  /** Phase 7: windows expected on specific room walls. */
  expected_windows?: ExpectedWindow[];
}

export interface MetricResult {
  score: number;
  max: number;
  details: string[];
}

export interface ScoreReport {
  total: number;
  components: {
    completeness: number;
    vastu: number;
    dims: number;
    positions: number;
    hallucinations: number;
    gaps: number;
    relational: number;
    main_entrance: number;
    hallway: number;
    windows: number;
  };
  details: {
    completeness: string[];
    vastu: string[];
    dims: string[];
    positions: string[];
    hallucinations: string[];
    gaps: string[];
    relational: string[];
    main_entrance: string[];
    hallway: string[];
    windows: string[];
  };
}

export interface PromptResult {
  id: string;
  prompt_summary: string;
  elapsed_ms: number;
  error: string | null;
  pipeline_used: string;
  score: ScoreReport | null;
  project: FloorPlanProject | null;
}

export interface SnapshotFile {
  snapshot_name: string;
  created_at: string;
  git_sha: string | null;
  results: PromptResult[];
  average: number;
}
