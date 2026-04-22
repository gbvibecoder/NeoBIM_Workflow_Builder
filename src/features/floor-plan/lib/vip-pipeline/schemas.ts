/**
 * Zod schemas for LLM tool_use output validation.
 *
 * Replaces unsafe `as Type` casts on Claude/GPT tool outputs.
 * On validation failure, throws ZodError which the orchestrator's
 * outer try/catch converts to { success: false, shouldFallThrough: true }.
 */

import { z } from "zod";

// ─── Stage 1: Architect Brief ───────────────────────────────────

const RoomItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  approxAreaSqft: z.number().optional(),
});

// Phase 2.3: declared adjacencies (Workstream A)
const AdjacencyDeclarationSchema = z.object({
  a: z.string(),
  b: z.string(),
  relationship: z.enum(["attached", "adjacent", "direct-access", "connected"]),
  reason: z.string().optional(),
});

const ArchitectBriefSchema = z.object({
  projectType: z.string(),
  roomList: z.array(RoomItemSchema),
  plotWidthFt: z.number(),
  plotDepthFt: z.number(),
  facing: z.string(),
  styleCues: z.array(z.string()),
  constraints: z.array(z.string()),
  // Phase 2.4 P0-A: optional city for setback resolution.
  municipality: z.string().optional(),
  // Phase 2.3: adjacency declarations emitted by Stage 1 brief.
  adjacencies: z.array(AdjacencyDeclarationSchema).default([]),
});

const ImageGenPromptSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  styleGuide: z.string(),
});

export const Stage1OutputSchema = z.object({
  brief: ArchitectBriefSchema,
  imagePrompts: z.array(ImageGenPromptSchema),
});

export type ValidatedStage1Output = z.infer<typeof Stage1OutputSchema>;

// ─── Stage 3: Jury Verdict ──────────────────────────────────────

const JuryDimensionsSchema = z.object({
  roomCountMatch: z.number(),
  labelLegibility: z.number(),
  noDuplicateLabels: z.number(),
  orientation: z.number(),
  vastuCompliance: z.number(),
  wallCompleteness: z.number(),
  proportionalHierarchy: z.number(),
  extractability: z.number(),
});

export const Stage3RawOutputSchema = z.object({
  dimensions: JuryDimensionsSchema,
  reasoning: z.string().default(""),
});

export type ValidatedStage3RawOutput = z.infer<typeof Stage3RawOutputSchema>;

// ─── Stage 6: Quality Verdict ───────────────────────────────────

const QualityDimensionsSchema = z.object({
  roomCountMatch: z.number(),
  noDuplicateNames: z.number(),
  dimensionPlausibility: z.number(),
  vastuCompliance: z.number(),
  orientationCorrect: z.number(),
  connectivity: z.number(),
  exteriorWindows: z.number(),
  // Phase 2.3: adjacency compliance. Default 8 (neutral) if adjacencyReport missing.
  adjacencyCompliance: z.number().default(8),
});

export const Stage6RawOutputSchema = z.object({
  dimensions: QualityDimensionsSchema,
  reasoning: z.string().default(""),
});

export type ValidatedStage6RawOutput = z.infer<typeof Stage6RawOutputSchema>;
