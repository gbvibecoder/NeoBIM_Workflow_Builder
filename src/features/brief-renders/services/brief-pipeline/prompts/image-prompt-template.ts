/**
 * Stage 2 — deterministic image-prompt template assembly.
 *
 * Pure function: same input → byte-identical output. The whole point
 * of running this stage outside the LLM is to make the prompt-gen
 * step *replayable* — Phase 4's per-shot retries must produce the
 * same prompt every time, or cost / quality observations break.
 *
 * STRICT FAITHFULNESS at the prompt layer:
 *   • Conditional clauses only. If a source field is `null`, the
 *     corresponding clause is OMITTED ENTIRELY. Never substitute
 *     defaults like "soft daylight" or "neutral palette".
 *   • No invented modifiers ("cinematic", "8K", "ultra-detailed").
 *   • Order is fixed. No Set / Map iteration; no Date.now; no random.
 *   • Bilingual room names: prompts use English (`roomNameEn`) only —
 *     the German name is for the Phase 5 PDF, not the image gen.
 *
 * Sole non-content default: `aspectRatio` falls back to `"3:2"` when
 * the source is silent, because the gpt-image-1.5 API requires an
 * aspect ratio. This is a STRUCTURAL default (the API has no
 * "let-the-model-pick" mode), not a content invention. Document this
 * exception clearly so future contributors understand why one default
 * exists in an otherwise default-free module.
 *
 * Caller must do reference-image guidance (Phase 4 wires that into
 * `images.edit()`); we do not include "consult the provided reference
 * imagery" boilerplate in the prompt because Stage 2 has no R2 URLs
 * yet — the persisted ones come from Stage 1's BriefSpec, but they're
 * passed as `image` content blocks alongside the prompt, not embedded
 * inside it.
 */

import type {
  ApartmentSpec,
  BaselineSpec,
  ShotSpec,
} from "../types";

/** Bumped when the template shape changes. Persisted on each ShotResult. */
export const IMAGE_PROMPT_TEMPLATE_VERSION = "v1";

/** Soft observability threshold — no longer enforced.
 *
 *  The previous design threw `PromptTooLongError` when the assembled
 *  prompt exceeded a hard cap (2k -> 8k -> removed). We now defer to
 *  the downstream model's actual limit: gpt-image-1.5 accepts very
 *  long prompts, the strict-faithfulness contract wants every source
 *  sentence preserved, and any real rejection from OpenAI surfaces
 *  verbatim per the specific-error rule.
 *
 *  This constant is kept only so Stage 2's summary line and the
 *  admin pipeline panel can tag prompts that cross the threshold for
 *  cost / quality monitoring. Crossing it is informational, never
 *  fatal. */
export const PROMPT_LENGTH_OBSERVABILITY_THRESHOLD = 8000;
/** @deprecated Use `PROMPT_LENGTH_OBSERVABILITY_THRESHOLD`. The value
 *  is no longer enforced - assembled prompts of any length pass. */
export const MAX_PROMPT_CHARS = PROMPT_LENGTH_OBSERVABILITY_THRESHOLD;

/** Fallback when `ShotSpec.aspectRatio` is null. See file header. */
export const DEFAULT_ASPECT_RATIO = "3:2";

export interface BuildImagePromptArgs {
  baseline: BaselineSpec;
  apartment: ApartmentSpec;
  shot: ShotSpec;
}

export interface BuiltImagePrompt {
  /** English-only prompt body, optimised for gpt-image-1.5. */
  prompt: string;
  /** Aspect ratio (`3:2`, `16:9`, …). Either source-provided or the structural default. */
  aspectRatio: string;
  /** Anti-invention hints — empty for now; Phase 4 may populate. */
  negativePromptHints: string[];
  /** Template version this prompt was assembled from. */
  templateVersion: string;
}

/** @deprecated The cap is no longer enforced (the downstream model's
 *  actual API limit is the only authority). This class is retained as
 *  a no-op stub so any importer continues to compile; it is never
 *  thrown by `buildImagePrompt`. Safe to delete in a future cleanup
 *  once all callers have migrated off it. */
export class PromptTooLongError extends Error {
  readonly code = "PROMPT_TOO_LONG";
  readonly userMessage =
    "The generated image prompt exceeded its length limit.";
  constructor(
    readonly assembled: string,
    readonly cap: number,
  ) {
    super(`Assembled prompt is ${assembled.length} chars (cap ${cap}).`);
    this.name = "PromptTooLongError";
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Check that a string field is non-null and non-empty post-trim. */
function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Check that a number field is non-null and finite. */
function presentNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Build the comma-separated baseline-materials clause from the non-null
 * fields of a `BaselineSpec`. Order is fixed (declaration order in the
 * type), so the same baseline always produces the same string.
 */
function buildBaselineClause(baseline: BaselineSpec): string | null {
  const parts: string[] = [];
  if (present(baseline.visualStyle)) parts.push(baseline.visualStyle.trim());
  if (present(baseline.materialPalette)) parts.push(baseline.materialPalette.trim());
  if (present(baseline.lightingBaseline)) parts.push(baseline.lightingBaseline.trim());
  if (present(baseline.cameraBaseline)) parts.push(baseline.cameraBaseline.trim());
  if (present(baseline.qualityTarget)) parts.push(baseline.qualityTarget.trim());
  if (present(baseline.additionalNotes)) parts.push(baseline.additionalNotes.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

// ─── Main entry point ──────────────────────────────────────────────

export function buildImagePrompt(args: BuildImagePromptArgs): BuiltImagePrompt {
  const { baseline, apartment, shot } = args;

  // Sentence list — each entry is an independent sentence we append in
  // order. `null` slots are filtered out, so empty conditions vanish.
  const sentences: Array<string | null> = [];

  // 1. Shot context — the spine of the prompt. Always present.
  const roomLabel = present(shot.roomNameEn) ? shot.roomNameEn.trim() : "interior space";
  sentences.push(`Photorealistic interior render of ${roomLabel}.`);

  // 2. Apartment context — only when we have a real label to attach to.
  if (present(apartment.label)) {
    sentences.push(`Apartment: ${apartment.label.trim()}.`);
  }

  // 3. Apartment description — verbatim from the brief.
  if (present(apartment.description)) {
    sentences.push(apartment.description.trim());
  }

  // 4. Apartment area context — only when stated in the source.
  if (presentNum(apartment.totalAreaSqm)) {
    sentences.push(`Total apartment area ${apartment.totalAreaSqm} m².`);
  }

  // 5. Shot area — only when stated.
  if (presentNum(shot.areaSqm)) {
    sentences.push(`Shot area ${shot.areaSqm} m².`);
  }

  // 6. Lighting — verbatim, never substituted.
  if (present(shot.lightingDescription)) {
    sentences.push(`Lighting: ${shot.lightingDescription.trim()}.`);
  }

  // 7. Camera — verbatim.
  if (present(shot.cameraDescription)) {
    sentences.push(`Camera: ${shot.cameraDescription.trim()}.`);
  }

  // 8. Material notes — verbatim.
  if (present(shot.materialNotes)) {
    sentences.push(`Materials: ${shot.materialNotes.trim()}.`);
  }

  // 9. Project-wide baseline — collated from non-null baseline leaves.
  const baselineClause = buildBaselineClause(baseline);
  if (baselineClause !== null) {
    sentences.push(`Baseline: ${baselineClause}.`);
  }

  // 10. Hero badge — only when source explicitly marks the shot as hero.
  if (shot.isHero === true) {
    sentences.push("Hero shot of the apartment.");
  }

  // 11. Closer — fixed editorial-photography style anchor. Always last.
  sentences.push(
    "Editorial photography style, magazine-quality, professional architectural visualization.",
  );

  const prompt = sentences.filter((s): s is string => s !== null).join(" ");

  // No length cap. The downstream model (gpt-image-1.5) is the only
  // authoritative limit; if it rejects, the OpenAI error surfaces
  // verbatim. See `PROMPT_LENGTH_OBSERVABILITY_THRESHOLD` for the soft
  // threshold used by Stage 2's summary line — informational only.

  const aspectRatio = present(shot.aspectRatio)
    ? shot.aspectRatio.trim()
    : DEFAULT_ASPECT_RATIO;

  return {
    prompt,
    aspectRatio,
    negativePromptHints: [],
    templateVersion: IMAGE_PROMPT_TEMPLATE_VERSION,
  };
}
