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

export interface PromptExpectation {
  id: string;
  prompt: string;
  vastu_required: boolean;
  plot: { width_ft: number; depth_ft: number; facing: CompassDirection } | null;
  expected_rooms: ExpectedRoom[];
  forbidden_rooms: string[];
  expected_pipeline: "A" | "B";
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
  };
  details: {
    completeness: string[];
    vastu: string[];
    dims: string[];
    positions: string[];
    hallucinations: string[];
    gaps: string[];
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
