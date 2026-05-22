/**
 * Phase δ.3 — pure decision logic for the per-iteration QStash chain.
 *
 * Extracted from `agent-job/route.ts` so the loop-termination rules
 * (Rule 3), runaway guard (Rule 3), and best-so-far selection
 * (Rule 5) are unit-testable without spinning up Prisma + QStash mocks.
 *
 * Pure functions only — no I/O, no side effects, no shared state.
 */

import type { IterationHistoryEntry } from "./types";

/** The decision the worker reaches after a successful iteration. */
export type IterationDecision =
  | {
      kind: "completed";
      /** Why we stopped chaining — surfaced in the chain summary log. */
      reason: "quality_passed" | "max_iterations";
    }
  | {
      kind: "retry";
      /** 1-based iteration number to enqueue next. Always
       *  `iteration + 1`. */
      nextIteration: number;
    };

export interface DecideIterationArgs {
  qualityScore: number;
  /** 1-based iteration that just completed. */
  iteration: number;
  /** Inclusive ceiling (e.g. MAX_ITERATIONS=3 ⇒ iteration 3 is the
   *  last one). */
  maxIterations: number;
  qualityThreshold: number;
}

/**
 * Decide whether this iteration was the last (PASS or MAX_ITERATIONS
 * reached) or whether to enqueue another.
 *
 * Three independent stop conditions per Rule 3:
 *   - PASS: `qualityScore >= qualityThreshold` → completed
 *   - MAX:  `iteration >= maxIterations`     → completed
 *   - else → retry with iteration+1
 *
 * Hard failures (generator throws, atomic counter mismatch, etc.)
 * never reach this function — they short-circuit before the verifier
 * runs and the worker handles them separately.
 */
export function decideIteration(args: DecideIterationArgs): IterationDecision {
  if (args.qualityScore >= args.qualityThreshold) {
    return { kind: "completed", reason: "quality_passed" };
  }
  if (args.iteration >= args.maxIterations) {
    return { kind: "completed", reason: "max_iterations" };
  }
  return { kind: "retry", nextIteration: args.iteration + 1 };
}

/**
 * Best-so-far index across an iteration history (Rule 5).
 *
 *   - Highest `qualityScore` wins.
 *   - Ties go to the EARLIER iteration: a later iteration must
 *     STRICTLY improve to replace an earlier best. This protects
 *     against regression — if iteration 3 scores the same as
 *     iteration 2, we keep iteration 2's IFC.
 *   - Empty history → -1 (caller's responsibility to handle).
 *
 * Returns the array index (NOT the iteration number — those are
 * unrelated in general, though they coincide when the array is
 * append-only from iteration 1).
 */
export function findBestIterationIdx(
  history: ReadonlyArray<IterationHistoryEntry>,
): number {
  if (history.length === 0) return -1;
  let bestIdx = 0;
  for (let i = 1; i < history.length; i += 1) {
    if (history[i].qualityScore > history[bestIdx].qualityScore) {
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Runaway-billing assertion (Rule 3). Throws if a logic bug ever asks
 * to enqueue past the MAX_ITERATIONS ceiling. The worker catches the
 * throw at the call site and degrades to `finalizeWithBest` instead
 * of billing an infinite QStash chain.
 *
 * Distinct from `decideIteration` because the assertion is paranoid
 * defense: even if `decideIteration` had a bug and returned
 * `{ kind: "retry", nextIteration: 4 }` for MAX=3, this gate refuses.
 */
export function assertSafeEnqueue(
  nextIteration: number,
  maxIterations: number,
): void {
  if (
    !Number.isFinite(nextIteration) ||
    nextIteration < 1 ||
    nextIteration > maxIterations
  ) {
    throw new Error(
      `RUNAWAY_GUARD: refusing to enqueue iteration ${nextIteration} ` +
        `(max=${maxIterations}). This indicates a logic bug — the chain ` +
        `loop must terminate at iteration ${maxIterations}.`,
    );
  }
}
