/**
 * Stage 2 — deterministic prompt generation.
 *
 * Given a validated `BriefSpec`, produce one `ShotResult` per shot with
 * a fully-assembled image prompt + structural defaults (`aspectRatio`,
 * `templateVersion`). NO LLM calls. NO networking. NO randomness.
 *
 * Stage 2 cost is zero — we don't call `logger.recordCost` for stage 2.
 *
 * Idempotent: calling with the same `BriefSpec` produces the same
 * prompt strings byte-for-byte. The only field that varies between runs
 * is `createdAt` (ISO timestamp); the orchestrator handles that for
 * resume scenarios.
 *
 * `EmptyBriefSpecError` is thrown when the spec contains zero shots
 * across all apartments — there's nothing to prompt for, so we surface
 * this loudly rather than silently producing an empty `shots[]` and
 * letting the AWAITING_APPROVAL gate show "0 shots to approve".
 */

import type { BriefSpec, ShotResult } from "./types";
import type { BriefRenderLogger } from "./logger";
import {
  buildImagePrompt,
  PROMPT_LENGTH_OBSERVABILITY_THRESHOLD,
} from "./prompts/image-prompt-template";

/** Thrown when the BriefSpec contains no shots. */
export class EmptyBriefSpecError extends Error {
  readonly code = "EMPTY_BRIEF_SPEC";
  readonly userMessage =
    "The brief contains no shots to render. Please re-upload a brief with at least one shot listed.";
  constructor(readonly apartmentCount: number) {
    super(
      `BriefSpec has ${apartmentCount} apartment(s) but zero shots across all of them.`,
    );
    this.name = "EmptyBriefSpecError";
  }
}

/** Defensive sentinel — duplicate global shotIndex must never happen. */
export class DuplicateShotIndexError extends Error {
  readonly code = "DUPLICATE_SHOT_INDEX";
  readonly userMessage =
    "Internal error: duplicate shot index detected during prompt generation.";
  constructor(readonly duplicateIndex: number) {
    super(`Duplicate global shotIndex ${duplicateIndex} produced by Stage 2.`);
    this.name = "DuplicateShotIndexError";
  }
}

export interface Stage2Args {
  spec: BriefSpec;
  jobId: string;
  logger: BriefRenderLogger;
}

export interface Stage2Result {
  shots: ShotResult[];
  totalShots: number;
  totalApartments: number;
}

export function runStage2PromptGen(args: Stage2Args): Stage2Result {
  const { spec, logger } = args;

  logger.startStage(2, "Prompt Gen");

  try {
    const totalApartments = spec.apartments.length;
    const shots: ShotResult[] = [];
    const seenIndices = new Set<number>();

    // Single ISO timestamp captured at stage entry — every ShotResult in
    // this run shares the same `createdAt`. Avoids `Date.now()` being
    // called once per shot (still nondeterministic across runs, but the
    // determinism contract excludes `createdAt` by design).
    const createdAt = new Date().toISOString();

    let globalIndex = 0;
    for (
      let apartmentIndex = 0;
      apartmentIndex < spec.apartments.length;
      apartmentIndex++
    ) {
      const apartment = spec.apartments[apartmentIndex];
      for (
        let shotIndexInApartment = 0;
        shotIndexInApartment < apartment.shots.length;
        shotIndexInApartment++
      ) {
        const shot = apartment.shots[shotIndexInApartment];
        const built = buildImagePrompt({
          baseline: spec.baseline,
          apartment,
          shot,
        });

        if (seenIndices.has(globalIndex)) {
          throw new DuplicateShotIndexError(globalIndex);
        }
        seenIndices.add(globalIndex);

        shots.push({
          shotIndex: globalIndex,
          apartmentIndex,
          shotIndexInApartment,
          status: "pending",
          prompt: built.prompt,
          aspectRatio: built.aspectRatio,
          templateVersion: built.templateVersion,
          imageUrl: null,
          errorMessage: null,
          costUsd: null,
          createdAt,
          startedAt: null,
          completedAt: null,
        });

        globalIndex++;
      }
    }

    if (shots.length === 0) {
      throw new EmptyBriefSpecError(totalApartments);
    }

    const result: Stage2Result = {
      shots,
      totalShots: shots.length,
      totalApartments,
    };

    // Soft observability — surface prompt-length distribution so admins
    // can monitor whether the strict-faithfulness contract is producing
    // unusually long prompts, without ever blocking on it.
    const promptLengths = shots.map((s) => s.prompt.length);
    const maxPromptChars = promptLengths.reduce((m, n) => Math.max(m, n), 0);
    const longPrompts = promptLengths.filter(
      (n) => n > PROMPT_LENGTH_OBSERVABILITY_THRESHOLD,
    ).length;

    logger.endStage(2, "success", {
      totalShots: result.totalShots,
      totalApartments: result.totalApartments,
      maxPromptChars,
      longPrompts,
      promptLengthThreshold: PROMPT_LENGTH_OBSERVABILITY_THRESHOLD,
    });

    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unknown stage-2 failure";
    logger.endStage(2, "failed", undefined, message);
    throw err;
  }
}
