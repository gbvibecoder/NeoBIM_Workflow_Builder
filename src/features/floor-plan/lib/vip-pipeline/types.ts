/**
 * Visual Intelligence Pipeline (VIP) — Approach #17
 *
 * Type definitions for all 7 stages of the pipeline.
 * Image models decide WHERE rooms go (as rectangles).
 * Existing code (wall-builder, door-placer, window-placer) synthesizes the rest.
 *
 * Coordinate convention: stays in feet, Y-UP, SW origin through Stages 1–6.
 * Stage 7 (Delivery) converts via toFloorPlanProject() → millimeters for the renderer.
 */

import type { ParsedConstraints } from "../structured-parser";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// ─── Pipeline Config ─────────────────────────────────────────────

export interface VIPPipelineConfig {
  prompt: string;
  parsedConstraints: ParsedConstraints;
  /** Observability context — grouped for clean extensibility (experiment IDs, trace IDs, etc.) */
  logContext: {
    requestId: string;
    userId: string;
  };
  /** Optional progress callback for background job progress reporting. Fire-and-forget — errors are logged, not thrown. */
  onProgress?: (progress: number, stage: string) => Promise<void>;
  /**
   * Phase 2.6: called after every stage lifecycle event (start/success/failure).
   * Receives the full accumulated stage-log array so the caller can replace
   * the persisted value atomically. Fire-and-forget — errors are swallowed
   * by the logger.
   */
  onStageLog?: (entries: StageLogEntry[]) => Promise<void> | void;
  /**
   * Phase 2.6: seed entries to prepend to the in-memory stage log. Used
   * when resuming in a fresh worker invocation (Phase B / regenerate)
   * so new events extend the existing timeline instead of replacing it.
   */
  existingStageLog?: StageLogEntry[];
}

// ─── Phase 2.6: Stage Log Entry ──────────────────────────────────
// One entry per VIP pipeline stage, written incrementally by the
// VIPLogger as the orchestrator progresses. Persisted to
// vip_jobs.stageLog and surfaced in the Pipeline Logs Panel UI.

export type StageLogStatus = "running" | "success" | "failed" | "skipped";

export interface StageLogEntry {
  /** Stage number — 0 = parse (pre-orchestrator), 1-7 = VIP pipeline stages. */
  stage: number;
  name: string;
  status: StageLogStatus;
  /** ISO timestamp of logStageStart (or equivalent). */
  startedAt: string;
  /** ISO timestamp of logStageSuccess / logStageFailure. Unset while running. */
  completedAt?: string;
  durationMs?: number;
  costUsd?: number;
  /** Short human-readable summary for the collapsed log row. */
  summary?: string;
  /** Structured stage output / metadata for the expanded row. */
  output?: Record<string, unknown>;
  /** Present when status === "failed". */
  error?: string;
}

// ─── Stage 1: Prompt Intelligence ────────────────────────────────

export interface Stage1Input {
  prompt: string;
  parsedConstraints: ParsedConstraints;
}

/**
 * Phase 2.3: Declared room-to-room relationships the architect wants
 * Stage 5 to honor during synthesis. Stage 6 scores compliance.
 */
export type AdjacencyRelationship =
  | "attached"        // share a wall, internal door from a (e.g. Master ↔ ensuite)
  | "adjacent"        // share a wall, door OK from either side (e.g. Kitchen ↔ Dining)
  | "direct-access"   // b's door opens into a (e.g. Pooja into Living)
  | "connected";      // reachable via direct corridor (no bedroom-through-bedroom)

export interface AdjacencyDeclaration {
  a: string;                      // room name from roomList
  b: string;                      // room name from roomList
  relationship: AdjacencyRelationship;
  reason?: string;
}

export interface ArchitectBrief {
  projectType: string;
  roomList: Array<{ name: string; type: string; approxAreaSqft?: number }>;
  plotWidthFt: number;
  plotDepthFt: number;
  facing: string;
  styleCues: string[];
  constraints: string[];
  /** Phase 2.4 P0-A: city name for setback resolution (e.g., "MUMBAI", "BENGALURU"). */
  municipality?: string;
  /** Phase 2.3: declared adjacencies. Defaults to []. */
  adjacencies: AdjacencyDeclaration[];
}

export interface ImageGenPrompt {
  model: string; // e.g., "gpt-image-1.5"
  prompt: string;
  negativePrompt?: string;
  styleGuide: string;
}

export interface Stage1Output {
  brief: ArchitectBrief;
  /** Expected length 1 (gpt-image-1.5 only). Orchestrator validates at runtime. */
  imagePrompts: ImageGenPrompt[];
}

// ─── Stage 2: Image Generation ───────────────────────────────────

export interface Stage2Input {
  /** Expected length 1 (gpt-image-1.5 only). Orchestrator validates at runtime. */
  imagePrompts: ImageGenPrompt[];
}

export interface GeneratedImage {
  model: string;
  url?: string;
  base64?: string;
  width: number;
  height: number;
  generationTimeMs: number;
}

export interface Stage2Output {
  images: GeneratedImage[];
}

// ─── Stage 3: Extraction Readiness Jury ──────────────────────────

export type JuryDimension =
  | "roomCountMatch"
  | "labelLegibility"
  | "noDuplicateLabels"
  | "orientation"
  | "vastuCompliance"
  | "wallCompleteness"
  | "proportionalHierarchy"
  | "extractability";

export interface JuryVerdict {
  score: number; // 0-100 weighted average
  dimensions: Record<JuryDimension, number>; // each 1-10
  reasoning: string;
  recommendation: "pass" | "retry" | "fail";
  /** Dimension names scoring < 6/10 — used by retry prompt amendment */
  weakAreas: string[];
}

export interface Stage3Input {
  gptImage: GeneratedImage;
  brief: ArchitectBrief;
}

export interface Stage3Output {
  verdict: JuryVerdict;
}

// ─── Stage 4: Room Extraction ────────────────────────────────────

export interface RectPx {
  x: number; // left edge, pixels from image left
  y: number; // top edge, pixels from image top (Y grows DOWN)
  w: number; // width in pixels
  h: number; // height in pixels
}

export interface ExtractedRoom {
  name: string; // canonical name matched to brief.roomList
  rectPx: RectPx;
  confidence: number; // 0-1, Vision's self-assessed confidence
  labelAsShown: string; // text as visible in image (may differ from name)
}

/**
 * Phase 2.10.2 — image-drift metrics attached to every Stage 4 output
 * where the Stage 2 image was available. `driftRatio` is the symmetric-
 * difference area (image-content bbox XOR rooms-union bbox) divided by
 * the image-content bbox area. `severity` buckets it per the documented
 * gate (0.20 / 0.35 thresholds).
 */
export type DriftSeverity = "none" | "moderate" | "severe";

export interface ExtractedRoomsDriftMetrics {
  imageBboxPx: RectPx;
  roomsUnionBboxPx: RectPx | null;
  driftRatio: number;
  driftFlagged: boolean;
  severity: DriftSeverity;
}

/**
 * Phase 2.10.3 — structured record of a duplicate-label auto-rename.
 * The human-readable log lives in `issues`; this field carries the
 * structured data for downstream consumers (Stage 6, Pipeline Logs).
 */
export interface DedupRename {
  from: string;
  to: string;
  reason: string;
}

export interface ExtractedRooms {
  imageSize: { width: number; height: number };
  plotBoundsPx: RectPx | null;
  rooms: ExtractedRoom[];
  issues: string[];
  expectedRoomsMissing: string[];
  unexpectedRoomsFound: string[];
  /** Phase 2.10.2 — present when the Stage 2 image buffer was available for drift analysis. */
  driftMetrics?: ExtractedRoomsDriftMetrics;
  /** Phase 2.10.3 — set when the dedup validator rewrote any duplicate room names. */
  dedupRenames?: DedupRename[];
}

export interface Stage4Input {
  image: GeneratedImage;
  brief: ArchitectBrief;
}

export interface Stage4Output {
  extraction: ExtractedRooms;
}

// ─── Stage 5: Synthesis ──────────────────────────────────────────
// Output IS StripPackResult — reuses existing wall-builder/door-placer/window-placer

export interface Stage5Input {
  extraction: ExtractedRooms;
  plotWidthFt: number;
  plotDepthFt: number;
  facing: string;
  parsedConstraints: ParsedConstraints;
  /** Phase 2.4 P0-A: municipality for setback resolution (from Stage 1 brief). */
  municipality?: string;
  /** Phase 2.3: adjacencies passed from Stage 1 brief. */
  adjacencies?: AdjacencyDeclaration[];
  /**
   * Phase 2.9: Stage 1 brief — used by the scenario classifier (room-
   * type lookup) and the dimension enhancer (target areas). When absent
   * the fidelity runner skips the adaptive enhancement path.
   */
  brief?: ArchitectBrief;
  /**
   * Phase 2.9: original user prompt — used by the classifier to detect
   * commercial vs. residential intent. Absent → treated as residential
   * (conservative).
   */
  userPrompt?: string;
}

export interface Stage5Output {
  project: FloorPlanProject;
  issues: string[];
}

// ─── Stage 6: Quality Gate ───────────────────────────────────────

export type QualityDimension =
  | "roomCountMatch"
  | "noDuplicateNames"
  | "dimensionPlausibility"
  | "vastuCompliance"
  | "orientationCorrect"
  | "connectivity"
  | "exteriorWindows"
  | "adjacencyCompliance"
  | "bedroomPrivacy"
  | "entranceDoor";

export interface QualityVerdict {
  score: number; // 0-100 weighted average
  dimensions: Record<QualityDimension, number>; // each 1-10
  reasoning: string;
  recommendation: "pass" | "retry" | "fail";
  weakAreas: string[];
}

export interface Stage6Input {
  project: FloorPlanProject;
  brief: ArchitectBrief;
  parsedConstraints: ParsedConstraints;
  /**
   * Phase 2.10.3 — optional drift signal propagated from Stage 4's
   * extraction. When present and severity !== "none", Stage 6 applies
   * a penalty to dimensionPlausibility: moderate = -5, severe = -10.
   * Severe also escalates the recommendation to "retry" (unless the
   * score already recommends "fail").
   */
  driftMetrics?: ExtractedRoomsDriftMetrics;
}

export interface Stage6Output {
  verdict: QualityVerdict;
}

// ─── Stage 7: Delivery ──────────────────────────────────────────

export interface Stage7Input {
  project: FloorPlanProject;
  qualityScore: number;
  totalCostUsd: number;
  totalMs: number;
  retried: boolean;
  weakAreas: string[];
}

export interface Stage7Output {
  project: FloorPlanProject;
}

// ─── Pipeline Timing ─────────────────────────────────────────────

export interface VIPTiming {
  stage1Ms?: number;
  stage2Ms?: number;
  stage3Ms?: number;
  stage4Ms?: number;
  stage5Ms?: number;
  stage6Ms?: number;
  stage7Ms?: number;
  totalMs: number;
}

// ─── Pipeline Result (orchestrator return type) ──────────────────
// Discriminated union — route.ts checks `success` to decide
// whether to return the project or fall through to PIPELINE_REF.

export type VIPPipelineResult =
  | {
      success: true;
      project: FloorPlanProject;
      qualityScore: number;
      retried: boolean;
      timing: VIPTiming;
      warnings: string[];
    }
  | {
      success: false;
      error: string;
      shouldFallThrough: true;
      stage?: string;
      timing?: Partial<VIPTiming>;
    };
