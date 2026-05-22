/**
 * Phase δ.3 — pure decision logic + best-so-far + runaway guard.
 *
 * Asserts the three load-bearing invariants of the iteration chain:
 *   - termination: PASS / MAX_ITERATIONS / fail are independent stop conditions
 *   - best-so-far: a regression cannot replace an equally-good prior best
 *   - runaway guard: a logic bug cannot enqueue past MAX_ITERATIONS
 */

import { describe, it, expect } from "vitest";

import {
  assertSafeEnqueue,
  decideIteration,
  findBestIterationIdx,
} from "../iteration-decisions";
import type { IterationHistoryEntry } from "../types";

function makeEntry(iteration: number, qualityScore: number): IterationHistoryEntry {
  return {
    iteration,
    qualityScore,
    ifcUrl: `https://r2.example/iter-${iteration}.ifc`,
    entityCount: 1000 + iteration,
    costUsd: 0.5,
    durationMs: 60_000,
    turns: 50,
    verifierSource: "railway",
    finishedAt: new Date(2026, 4, 21, 12, 0, iteration).toISOString(),
  };
}

// ── decideIteration ─────────────────────────────────────────────────

describe("decideIteration — three stop conditions (Rule 3)", () => {
  it("PASS: quality >= threshold → completed with reason quality_passed", () => {
    const d = decideIteration({
      qualityScore: 80,
      iteration: 1,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d).toEqual({ kind: "completed", reason: "quality_passed" });
  });

  it("PASS at exact threshold → completed (>=, not >)", () => {
    const d = decideIteration({
      qualityScore: 75,
      iteration: 1,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d.kind).toBe("completed");
    if (d.kind === "completed") expect(d.reason).toBe("quality_passed");
  });

  it("MAX: iteration == max with low quality → completed reason max_iterations", () => {
    const d = decideIteration({
      qualityScore: 30,
      iteration: 3,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d).toEqual({ kind: "completed", reason: "max_iterations" });
  });

  it("MAX takes precedence over retry on the last iteration", () => {
    const d = decideIteration({
      qualityScore: 50,
      iteration: 3,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d.kind).toBe("completed");
  });

  it("RETRY: low quality + iterations remain → retry with nextIteration", () => {
    const d = decideIteration({
      qualityScore: 50,
      iteration: 1,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d).toEqual({ kind: "retry", nextIteration: 2 });
  });

  it("RETRY at iteration 2 → nextIteration = 3 (the last allowed)", () => {
    const d = decideIteration({
      qualityScore: 50,
      iteration: 2,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d).toEqual({ kind: "retry", nextIteration: 3 });
  });

  it("PASS at iteration > max (defensive) → still completed (PASS wins)", () => {
    const d = decideIteration({
      qualityScore: 99,
      iteration: 5,
      maxIterations: 3,
      qualityThreshold: 75,
    });
    expect(d).toEqual({ kind: "completed", reason: "quality_passed" });
  });
});

// ── findBestIterationIdx ────────────────────────────────────────────

describe("findBestIterationIdx — best-so-far with tie-to-earlier (Rule 5)", () => {
  it("empty history → -1", () => {
    expect(findBestIterationIdx([])).toBe(-1);
  });

  it("single entry → 0", () => {
    expect(findBestIterationIdx([makeEntry(1, 50)])).toBe(0);
  });

  it("strictly increasing → last index", () => {
    const h = [makeEntry(1, 50), makeEntry(2, 70), makeEntry(3, 85)];
    expect(findBestIterationIdx(h)).toBe(2);
    expect(h[findBestIterationIdx(h)].iteration).toBe(3);
  });

  it("regression scenario [70, 81, 68] → best is iteration 2 (index 1)", () => {
    const h = [makeEntry(1, 70), makeEntry(2, 81), makeEntry(3, 68)];
    expect(findBestIterationIdx(h)).toBe(1);
    expect(h[findBestIterationIdx(h)].iteration).toBe(2);
  });

  it("strict monotone decrease → first index (best is iteration 1)", () => {
    const h = [makeEntry(1, 80), makeEntry(2, 70), makeEntry(3, 60)];
    expect(findBestIterationIdx(h)).toBe(0);
    expect(h[findBestIterationIdx(h)].iteration).toBe(1);
  });

  it("tie at iteration 2 (same score as 1) → EARLIER wins (index 0)", () => {
    const h = [makeEntry(1, 75), makeEntry(2, 75)];
    expect(findBestIterationIdx(h)).toBe(0);
    expect(h[findBestIterationIdx(h)].iteration).toBe(1);
  });

  it("late tie [70, 80, 80] → iteration 2 wins (first to reach the max)", () => {
    const h = [makeEntry(1, 70), makeEntry(2, 80), makeEntry(3, 80)];
    expect(findBestIterationIdx(h)).toBe(1);
  });
});

// ── assertSafeEnqueue ───────────────────────────────────────────────

describe("assertSafeEnqueue — runaway-billing guard (Rule 3)", () => {
  it("allows iteration 2 with max 3", () => {
    expect(() => assertSafeEnqueue(2, 3)).not.toThrow();
  });

  it("allows iteration 3 (the ceiling) with max 3", () => {
    expect(() => assertSafeEnqueue(3, 3)).not.toThrow();
  });

  it("REFUSES iteration 4 with max 3", () => {
    expect(() => assertSafeEnqueue(4, 3)).toThrow(/RUNAWAY_GUARD/);
  });

  it("REFUSES iteration 100 with max 3 (gross overflow)", () => {
    expect(() => assertSafeEnqueue(100, 3)).toThrow(/RUNAWAY_GUARD/);
  });

  it("REFUSES iteration 0 (out of range below)", () => {
    expect(() => assertSafeEnqueue(0, 3)).toThrow(/RUNAWAY_GUARD/);
  });

  it("REFUSES iteration -1 (negative)", () => {
    expect(() => assertSafeEnqueue(-1, 3)).toThrow(/RUNAWAY_GUARD/);
  });

  it("REFUSES NaN", () => {
    expect(() => assertSafeEnqueue(NaN, 3)).toThrow(/RUNAWAY_GUARD/);
  });

  it("REFUSES Infinity", () => {
    expect(() => assertSafeEnqueue(Infinity, 3)).toThrow(/RUNAWAY_GUARD/);
  });
});
