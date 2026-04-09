export type ExecutionStatus = "pending" | "running" | "success" | "partial" | "failed";

export type ArtifactType = "text" | "json" | "image" | "3d" | "file" | "table" | "kpi" | "svg" | "video" | "html";

export interface ExecutionArtifact {
  id: string;
  executionId: string;
  tileInstanceId: string;
  type: ArtifactType;
  dataUri?: string;
  data?: unknown;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface TileExecutionResult {
  tileInstanceId: string;
  catalogueId: string;
  status: "success" | "error" | "skipped";
  startedAt: Date;
  completedAt: Date;
  artifact?: ExecutionArtifact;
  errorMessage?: string;
}

/** Per-execution UI/state metadata persisted in Execution.metadata JSONB.
 *  Each field is optional so older executions without metadata stay valid. */
export interface ExecutionMetadata {
  /** Per-tile, per-row quantity overrides set by the user via the BOQ data
   *  table. Outer key is tileInstanceId, inner key is the row index as a
   *  string (JSON keys can't be numbers). Mirrors the shape of
   *  useExecutionStore.quantityOverrides serialized for JSON. Used to
   *  rehydrate the in-memory Map on result-showcase mount so edits survive
   *  page reloads. Persisted via PATCH /api/executions/[id]/metadata. */
  quantityOverrides?: Record<string, Record<string, number>>;
}

export interface Execution {
  id: string;
  workflowId: string;
  userId: string;
  status: ExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  tileResults: TileExecutionResult[];
  errorMessage?: string;
  metadata?: ExecutionMetadata;
  createdAt: Date;
}

// Mock data types for realistic execution previews

export interface TextArtifactData {
  content: string;
  label?: string;
}

export interface JsonArtifactData {
  json: Record<string, unknown>;
  label?: string;
}

export interface ImageArtifactData {
  url: string;
  width?: number;
  height?: number;
  label?: string;
  style?: string;
}

export interface KpiArtifactData {
  metrics: Array<{
    label: string;
    value: string | number;
    unit?: string;
    trend?: "up" | "down" | "neutral";
  }>;
}

export interface TableArtifactData {
  headers: string[];
  rows: Array<string | number>[];
  label?: string;
}

export interface FileArtifactData {
  name: string;
  type: string;
  size: number;
  downloadUrl: string;
  label?: string;
}

export interface VideoSegment {
  videoUrl: string;
  downloadUrl: string;
  durationSeconds: number;
  label: string;
}

export interface VideoArtifactData {
  videoUrl: string;
  downloadUrl: string;
  name: string;
  durationSeconds: number;
  shotCount?: number;
  pipeline?: string;
  costUsd?: number;
  label?: string;
  /** Multi-segment videos (e.g., 5s exterior + 10s interior) */
  segments?: VideoSegment[];
  /** Background generation status */
  videoGenerationStatus?: "processing" | "complete" | "failed" | "client-rendering";
  /** Building config for client-side Three.js rendering */
  _buildingConfig?: {
    floors: number;
    floorHeight: number;
    footprint: number;
    buildingType?: string;
    style?: string;
  };
  exteriorTaskId?: string;
  interiorTaskId?: string;
  generationProgress?: number;
  usedOmni?: boolean;
}
