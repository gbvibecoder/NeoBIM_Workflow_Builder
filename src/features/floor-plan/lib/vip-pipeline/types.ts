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

import type { StripPackResult } from "../strip-pack/types";
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

// ─── Stage 3: Vision Jury ────────────────────────────────────────

export interface Stage3Input {
  images: GeneratedImage[];
  brief: ArchitectBrief;
}

export interface Stage3Output {
  winnerIndex: number;
  winnerImage: GeneratedImage;
  reasoning: string;
  scores: Array<{ index: number; score: number; rationale: string }>;
}

// ─── Stage 4: Room Extraction ────────────────────────────────────

export interface Stage4Input {
  image: GeneratedImage;
  brief: ArchitectBrief;
}

export interface ExtractedRoom {
  name: string;
  type: string;
  /** Normalized 0–1 coordinates (same convention as reference engine) */
  nx: number;
  ny: number;
  nw: number;
  nd: number;
}

export interface Stage4Output {
  rooms: ExtractedRoom[];
  hallway: { nx: number; ny: number; nw: number; nd: number } | null;
  confidenceScore: number;
}

// ─── Stage 5: Synthesis ──────────────────────────────────────────
// Output IS StripPackResult — reuses existing wall-builder/door-placer/window-placer

export interface Stage5Input {
  rooms: ExtractedRoom[];
  hallway: Stage4Output["hallway"];
  plotWidthFt: number;
  plotDepthFt: number;
  facing: string;
  parsedConstraints: ParsedConstraints;
}

// Stage5Output = StripPackResult (no wrapper needed)

// ─── Stage 6: Quality Gate ───────────────────────────────────────

export interface Stage6Input {
  result: StripPackResult;
  brief: ArchitectBrief;
}

export interface QualityIssue {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  suggestion?: string;
}

export interface Stage6Output {
  passed: boolean;
  score: number;
  issues: QualityIssue[];
  shouldRetry: boolean;
}

// ─── Stage 7: Delivery ──────────────────────────────────────────
// Converts StripPackResult → FloorPlanProject via existing converter

export interface Stage7Input {
  result: StripPackResult;
  parsedConstraints: ParsedConstraints;
}

// Stage7Output = FloorPlanProject (no wrapper needed)

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
