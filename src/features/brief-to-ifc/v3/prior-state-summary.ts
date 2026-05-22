/**
 * Phase δ.3 — compressed prior-iteration state forward.
 *
 * The agent receives `previousFeedback` on iteration 2+ (driver.ts
 * wires it into the user message under "## PREVIOUS ITERATION
 * FEEDBACK"). Pre-δ.3 that was just the retry hint — a colleague's
 * note about what to fix. The agent had no concrete signal of what
 * was actually built, so iteration 2 sometimes re-did iteration 1's
 * work from scratch, wasting a fresh 800s budget on duplicate
 * geometry instead of building on it.
 *
 * This module compresses the prior iteration's validation results
 * (element counts by IFC class, world bbox, storey count, missing
 * elements flagged by the brief-aware validator) into a short
 * structured block. Combined with the retry hint, the agent gets
 * BOTH "here is what you built" AND "here is what to improve".
 *
 * Pure deterministic function. No LLM call. No I/O. Safe to call from
 * any code path. The output is plain text — folded into the
 * previousFeedback string as a prefix block so no new driver param is
 * needed.
 */

import type {
  SandboxValidateResult,
  VerifierReport,
  VisionReport,
} from "./types";

// ─── Caps ────────────────────────────────────────────────────────────

/** Cap on the total compressed summary length. The agent has 200 turns
 *  to spend; a 2 KB block at the top of its user message is cheap
 *  ($0.01 input-token cost) and high-signal. */
const MAX_SUMMARY_CHARS = 2000;

/** How many class-counts to surface in the inline table. The long tail
 *  is summarised as "+N other classes". */
const TOP_CLASS_COUNT = 10;

/** How many specific element ids to list per "missing" call-out. */
const MAX_MISSING_IDS_INLINE = 6;

// ─── Input bundle ────────────────────────────────────────────────────

export interface PriorIterationData {
  /** 1-based iteration number that just completed. */
  iteration: number;
  /** The verifier's quality score for that iteration (the existing
   *  known-broken formula's output — δ.2 will swap the formula later;
   *  δ.3 chains around whatever score it returns). */
  qualityScore: number;
  /** Validation result from the Python sandbox. Optional because
   *  validation can fail loudly (Railway timeout, etc.); in that case
   *  the summary degrades gracefully. */
  finalValidation: SandboxValidateResult | null;
  /** Hard-verifier report — its mismatches drive the "what to fix"
   *  bullets. Optional for the same reason. */
  verifierReport: VerifierReport | null;
  /** Vision inspector's findings. Optional. */
  visionReport: VisionReport | null;
  /** The retry hint generated for this iteration's failure (the
   *  colleague's plain-English note). */
  retryHint: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function formatExpectedByClass(
  validation: SandboxValidateResult | null,
): string {
  if (!validation) return "  (validation unavailable)";
  const cov = validation.element_coverage;
  if (!cov) return "  (element coverage not computed)";
  const expected = cov.by_class_expected ?? {};
  const actual = cov.by_class_actual ?? {};
  const classes = new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ]);
  if (classes.size === 0) return "  (no class breakdown)";
  const rows = [...classes]
    .map((cls) => ({
      cls,
      built: actual[cls] ?? 0,
      expected: expected[cls] ?? 0,
    }))
    .filter((r) => r.built > 0 || r.expected > 0)
    .sort((a, b) => b.expected - a.expected || b.built - a.built);
  const top = rows.slice(0, TOP_CLASS_COUNT);
  const rest = rows.length - top.length;
  const lines = top.map(
    (r) => `  - ${r.cls}: built ${r.built}/${r.expected}`,
  );
  if (rest > 0) {
    const restBuilt = rows.slice(TOP_CLASS_COUNT).reduce((s, r) => s + r.built, 0);
    const restExpected = rows.slice(TOP_CLASS_COUNT).reduce((s, r) => s + r.expected, 0);
    lines.push(
      `  - (+${rest} other classes, built ${restBuilt}/${restExpected})`,
    );
  }
  return lines.join("\n");
}

function formatBbox(
  bbox: SandboxValidateResult["world_bbox"],
): string {
  if (!bbox) return "  (world bbox not validated)";
  const verdict = bbox.verdict ?? "UNKNOWN";
  const extent = bbox.actual_extent;
  if (!extent) return `  verdict=${verdict}, extent=(unavailable)`;
  const [x, y, z] = extent;
  return (
    `  verdict=${verdict}, ` +
    `extent ≈ ${x.toFixed(1)}m × ${y.toFixed(1)}m × ${z.toFixed(1)}m`
  );
}

function formatMissingElements(
  validation: SandboxValidateResult | null,
): string {
  if (!validation) return "";
  const cov = validation.element_coverage;
  if (!cov || cov.verdict === "OK") return "";
  const total = cov.total_expected ?? 0;
  const built = cov.total_actual_in_expected_classes ?? 0;
  const missing = cov.missing_id_count ?? cov.missing_ids?.length ?? 0;
  if (total === 0) return "";
  const sampleIds = (cov.missing_ids ?? [])
    .slice(0, MAX_MISSING_IDS_INLINE)
    .map((m) => `${m.id} (${m.expected_class})`)
    .join(", ");
  const overflow =
    (cov.missing_ids?.length ?? 0) > MAX_MISSING_IDS_INLINE
      ? ` …+${cov.missing_ids!.length - MAX_MISSING_IDS_INLINE} more`
      : "";
  return (
    `\n### Element coverage: ${built}/${total} built, ${missing} missing\n` +
    (sampleIds
      ? `Missing (sample): ${sampleIds}${overflow}\n`
      : "")
  );
}

function formatSpacesMissing(
  validation: SandboxValidateResult | null,
): string {
  if (!validation) return "";
  const missing = validation.spaces_missing ?? [];
  if (missing.length === 0) return "";
  return (
    `\n### Spaces missing from IFC: ${missing.length}\n` +
    `IDs: ${missing.slice(0, 8).join(", ")}` +
    (missing.length > 8 ? ` …+${missing.length - 8} more` : "") +
    "\n"
  );
}

function formatVerifierMismatches(
  report: VerifierReport | null,
): string {
  if (!report || report.mismatches.length === 0) return "";
  const highMed = report.mismatches.filter(
    (m) => m.severity === "high" || m.severity === "med",
  );
  if (highMed.length === 0) return "";
  return (
    `\n### Hard-verifier findings (${highMed.length} high/med severity)\n` +
    highMed
      .slice(0, 8)
      .map(
        (m) =>
          `  - [${m.severity}] ${m.type} on ${m.item_id}: ${m.description}`,
      )
      .join("\n") +
    (highMed.length > 8 ? `\n  …+${highMed.length - 8} more` : "") +
    "\n"
  );
}

function formatVisionIssues(report: VisionReport | null): string {
  if (!report || report.issues.length === 0) return "";
  const highMed = report.issues.filter(
    (i) => i.severity === "high" || i.severity === "med",
  );
  if (highMed.length === 0) return "";
  return (
    `\n### Vision inspector findings (${highMed.length} high/med severity)\n` +
    highMed
      .slice(0, 8)
      .map(
        (i) =>
          `  - [${i.severity}] ${i.type}: ${i.description}` +
          (i.affected_element ? ` (element: ${i.affected_element})` : ""),
      )
      .join("\n") +
    (highMed.length > 8 ? `\n  …+${highMed.length - 8} more` : "") +
    "\n"
  );
}

// ─── Main entry — build the compressed forward-state block ───────────

/**
 * Build the compressed prior-state block for iteration N+1's user
 * message. The block tells the agent:
 *
 *   1. Which iteration just completed and its score.
 *   2. What was built (element counts by IFC class, world bbox,
 *      storey count) — concrete state, not adjectives.
 *   3. What's missing or wrong (verifier mismatches, vision issues,
 *      spec elements absent from the IFC).
 *   4. The colleague's retry hint (the plain-English note).
 *
 * The result is a single string ready to be passed to driver.ts as
 * `previousFeedback`. The agent's existing slot at
 * driver.ts:391-396 carries it under "## PREVIOUS ITERATION FEEDBACK".
 *
 * Edge cases:
 *   - All optional inputs absent (cold-state failure mode) → returns
 *     just the retry hint, prefixed with a short header.
 *   - Total length > MAX_SUMMARY_CHARS → truncated with a "..."
 *     marker. Counts in the inline class table remain authoritative
 *     because they sit near the top.
 *   - Numeric fields are coerced via `?? 0` so a malformed
 *     validation result doesn't NaN-poison the output.
 */
export function buildPriorStateSummary(data: PriorIterationData): string {
  const { iteration, qualityScore, finalValidation, retryHint } = data;

  const parts: string[] = [];

  parts.push(
    `## ITERATION ${iteration} RESULT — quality ${qualityScore}/100\n` +
      `\nYou just finished iteration ${iteration}. This is iteration ${
        iteration + 1
      } of up to 3. ` +
      `**Address the issues from your prior iteration listed below; rebuild ` +
      `the model incorporating these fixes.** The sandbox you start with ` +
      `is fresh — the prior IFC has been finalized to R2 and the agent ` +
      `session was destroyed. Re-author every \`bf.add_*\` call as if this ` +
      `were a new build, but use the diagnostic data below to make ` +
      `different choices this time.`,
  );

  if (finalValidation) {
    parts.push(
      `### What you built (iteration ${iteration})\n` +
        `Entity count: ${finalValidation.entity_count}\n` +
        `Spaces present: ${(finalValidation.spaces_present ?? []).length}\n` +
        `World bbox:\n${formatBbox(finalValidation.world_bbox)}\n` +
        `Built vs expected by IFC class:\n${formatExpectedByClass(finalValidation)}`,
    );
    parts.push(formatSpacesMissing(finalValidation));
    parts.push(formatMissingElements(finalValidation));
  } else {
    parts.push(
      `### Prior IFC state\n` +
        `(validation result unavailable for iteration ${iteration} — the ` +
        `previous IFC may have failed to validate. Proceed with the retry ` +
        `hint below.)`,
    );
  }

  parts.push(formatVerifierMismatches(data.verifierReport));
  parts.push(formatVisionIssues(data.visionReport));

  if (retryHint && retryHint.trim().length > 0) {
    parts.push(`### Retry hint from reviewer\n\n${retryHint}`);
  }

  const joined = parts.filter((p) => p.trim().length > 0).join("\n\n");
  return truncate(joined, MAX_SUMMARY_CHARS);
}
