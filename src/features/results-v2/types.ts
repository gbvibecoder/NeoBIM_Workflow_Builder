/**
 * results-v2 — shared types
 *
 * Deliberately self-contained: v2 owns its own normalized shape so the
 * legacy result-showcase selectors can keep evolving without breaking us.
 */

export type HeroVariant =
  | "video"
  | "image"
  | "viewer3d"
  | "floorPlan"
  | "kpi"
  | "skeleton";

export type AccentKind = "video" | "image" | "ifc" | "boq" | "default";

export interface AccentGradient {
  kind: AccentKind;
  start: string;
  end: string;
}

export interface ResultMetric {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "primary" | "secondary";
}

export interface ResultVideoSegment {
  label: string;
  videoUrl: string;
  downloadUrl: string;
  durationSeconds: number;
}

export interface ResultVideo {
  nodeId: string;
  videoUrl: string;
  downloadUrl: string;
  name: string;
  durationSeconds: number;
  shotCount: number;
  pipeline?: string;
  segments?: ResultVideoSegment[];
  videoJobId?: string;
  status: "pending" | "rendering" | "complete" | "failed";
  progress?: number;
  phase?: string;
  failureMessage?: string;
}

export type Result3DKind = "procedural" | "glb" | "html-iframe";

export interface Result3D {
  kind: Result3DKind;
  glbUrl?: string;
  ifcUrl?: string;
  thumbnailUrl?: string;
  iframeUrl?: string;
  iframeContent?: string;
  floors?: number;
  height?: number;
  footprint?: number;
  gfa?: number;
  buildingType?: string;
  polycount?: number;
}

export interface ResultFloorPlan {
  kind: "editor" | "interactive" | "svg";
  svg?: string;
  sourceImageUrl?: string;
  aiRenderUrl?: string;
  roomCount?: number;
  wallCount?: number;
  totalArea?: number;
  buildingType?: string;
  label: string;
}

export interface ResultTable {
  label: string;
  headers: string[];
  rows: (string | number)[][];
  isBoq?: boolean;
}

export interface ResultDownload {
  name: string;
  kind: "video" | "model3d" | "document" | "drawing" | "data" | "other";
  sizeBytes: number;
  downloadUrl?: string;
}

export type PipelineNodeStatus = "idle" | "running" | "success" | "error" | "skipped";

export interface PipelineStepView {
  nodeId: string;
  label: string;
  category: "input" | "transform" | "generate" | "export";
  catalogueId: string;
  status: PipelineNodeStatus;
  artifactType?: string;
  durationMs?: number;
}

export interface ModelAttribution {
  /** Display name, e.g. "GPT-4o", "DALL-E 3", "Kling 3.0". */
  name: string;
  /** Which family — drives the color chip. */
  family: "openai" | "anthropic" | "kling" | "replicate" | "other";
}

export interface ResultStatus {
  state: "pending" | "running" | "success" | "partial" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

/**
 * Normalized result — single read model the V2 surface consumes.
 *
 * Built once per execution by `useExecutionResult`, either from the live
 * Zustand store or from a prefetched `/api/executions/[id]` response. All
 * `costUsd` / `price` / `$` fields are scrubbed by `stripPrice()` before
 * they land in this shape.
 */
export interface ExecutionResult {
  executionId: string;
  workflowId: string | null;
  workflowName: string;
  status: ResultStatus;

  video: ResultVideo | null;
  images: string[];
  model3d: Result3D | null;
  floorPlan: ResultFloorPlan | null;
  tables: ResultTable[];
  metrics: ResultMetric[];
  boqTotalGfa: number | null;
  boqCurrencySymbol: string | null;

  downloads: ResultDownload[];
  pipeline: PipelineStepView[];
  models: ModelAttribution[];

  /** Textual summary from any `text` artifact. */
  summaryText: string | null;
}

export interface PanelDescriptor {
  id: "overview" | "assets" | "pipeline" | "downloads" | "notes";
  label: string;
}
