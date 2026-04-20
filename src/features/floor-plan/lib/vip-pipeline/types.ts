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
}

// ─── Stage 1: Prompt Intelligence ────────────────────────────────

export interface Stage1Input {
  prompt: string;
  parsedConstraints: ParsedConstraints;
}

export interface ArchitectBrief {
  projectType: string;
  roomList: Array<{ name: string; type: string; approxAreaSqft?: number }>;
  plotWidthFt: number;
  plotDepthFt: number;
  facing: string;
  styleCues: string[];
  constraints: string[];
}

export interface ImageGenPrompt {
  model: string; // e.g., "gpt-image-1.5", "imagen-4.0-generate-001"
  prompt: string;
  negativePrompt?: string;
  styleGuide: string;
}

export interface Stage1Output {
  brief: ArchitectBrief;
  /** Expected length 2–5. Orchestrator validates at runtime. */
  imagePrompts: ImageGenPrompt[];
}

// ─── Stage 2: Parallel Image Generation ──────────────────────────

export interface Stage2Input {
  /** Expected length 2–5. Orchestrator validates at runtime. */
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

export interface ExtractedRooms {
  imageSize: { width: number; height: number };
  plotBoundsPx: RectPx | null;
  rooms: ExtractedRoom[];
  issues: string[];
  expectedRoomsMissing: string[];
  unexpectedRoomsFound: string[];
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
  | "exteriorWindows";

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
