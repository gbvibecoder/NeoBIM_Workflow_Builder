/**
 * Brief-to-IFC v3 — shared constants.
 *
 * Phase gamma.1: Direct Agent Mode introduced higher turn budgets and
 * render-preview cost guardrails. All magic numbers live here so tests
 * can import and assert against them.
 *
 * @module
 */

// ─── Agent turn budget ─────────────────────────────────────────────

/** Direct Agent Mode default — 4x the legacy budget. The agent needs
 *  turns to plan, build incrementally, render_preview its work, and
 *  self-correct. 200 turns with the $5.00 cost cap rarely exceeds 120
 *  in practice; the ceiling exists for complex briefs. */
export const AGENT_MAX_TURNS_DIRECT_MODE = 200;

/** Legacy budget preserved for backwards-compat reference and tests. */
export const AGENT_MAX_TURNS_LEGACY = 50;

// ─── Cost caps ─────────────────────────────────────────────────────

/** Default per-run cost cap in USD. Raised from $2.50 to $5.00 for
 *  Direct Agent Mode — more turns = more tokens, but the agent
 *  self-corrects instead of requiring pipeline re-runs. */
export const AGENT_DEFAULT_COST_CAP_USD = 5.0;

// ─── render_preview budget ─────────────────────────────────────────

/** Maximum render_preview calls per single agent build. Each call
 *  costs ~$0.01 and takes 2-5 seconds. Cap prevents runaway render
 *  loops while giving the agent enough visual checkpoints. */
export const RENDER_PREVIEW_BUDGET = 10;

// ─── Retry / iteration ────────────────────────────────────────────

/**
 * Quality threshold below which the δ.3 iteration loop retries.
 *
 * Pre-δ.2 value: 75, tuned to the broken legacy formula
 *   `parts_coverage * 80 + (verified ? 20 : 0)`
 * which defaulted to 1.0 when the brief had no decomposed furniture
 * — so the loop almost always passed on iteration 1 regardless of
 * build quality.
 *
 * δ.2 value: 80. Re-derived against the new composite metric in
 * `quality-score.ts` (PHASE_DELTA_2_2026-05-21.md §0.4). The new
 * formula's natural distribution:
 *   - Truly perfect build → 96
 *   - Good with minor issues → 82-91
 *   - Borderline good → 70-79  ← threshold sits at the top of this band
 *   - Gray box → 45-50
 *   - Broken → 0-25
 * Threshold 80 lets unambiguously-good builds pass on iteration 1
 * (no wasted spend) and forces borderline cases to retry once with the
 * retry hint — they either improve to ≥80 or get accepted as
 * best-so-far at MAX_ITERATIONS=3.
 */
export const QUALITY_THRESHOLD = 80;

/** Maximum total iterations (initial build + retries). */
export const MAX_ITERATIONS = 3;
