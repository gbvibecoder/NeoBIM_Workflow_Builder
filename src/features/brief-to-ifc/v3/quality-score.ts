/**
 * Phase δ.2 — composite quality scoring.
 *
 * Replaces the broken legacy formula
 *   `score = parts_coverage * 80 + (verified ? 20 : 0)`
 * which measured one narrow dimension (decomposed-furniture
 * IfcRelAggregates fidelity) and defaulted to 1.0 when the brief had
 * no decomposed parts — so a gray-box building scored 100 while a
 * visually-perfect furnished building scored 45-55.
 *
 * The new metric is a weighted composite over four independent
 * sub-signals; each signal can be present or absent per build. Missing
 * signals drop out and the remaining weights renormalize to sum to 1.0
 * so the score is always interpretable and never NaN.
 *
 *   structural_completeness (0.40) — spaces and elements built vs spec
 *   geometric_sanity        (0.25) — world bbox + origin + load + refs
 *   vision_quality          (0.25) — Opus visual review (optional input)
 *   parts_decomposition     (0.10) — legacy parts coverage, ONLY when
 *                                    expected_parts > 0
 *
 * Calibrated thresholds (see PHASE_DELTA_2_2026-05-21.md §0.4):
 *   Truly perfect build → 96
 *   Good with minor issues → 82-91
 *   Borderline good → 70-79
 *   Gray box → 45-50
 *   Broken (bbox/load fails) → 0-25
 *
 * Pure function: no I/O, no side effects, no module-level state.
 * Unit-testable without mocking. Score is always integer 0-100.
 */

import type {
  BriefSpec,
  SandboxValidateResult,
  VerifierReport,
  VisionReport,
} from "./types";

// ─── Weights (sum to 1.0 when all signals available) ─────────────────

const WEIGHT_STRUCTURAL = 0.4;
const WEIGHT_SANITY = 0.25;
const WEIGHT_VISION = 0.25;
const WEIGHT_PARTS = 0.1;

/** Formula version baked into the breakdown for telemetry — bump when
 *  the weights / signals change so old runs can be distinguished. */
export const QUALITY_SCORE_FORMULA_VERSION = "delta.2-v1" as const;

// ─── Inputs ──────────────────────────────────────────────────────────

export interface QualityScoreInputs {
  briefSpec: BriefSpec;
  /** From the sandbox validate endpoint. Carries spaces_missing,
   *  element_coverage, world_bbox, origin_collapse, web_ifc_load_test,
   *  refs_resolve. Null when validation didn't run or failed loudly. */
  finalValidation: SandboxValidateResult | null;
  /** From the hard-verifier (Railway endpoint or pessimistic
   *  fallback). Used for the parts_decomposition sub-signal only;
   *  the other sub-signals derive from finalValidation. Null when
   *  verifier was not called. */
  verifierReport: VerifierReport | null;
  /** From the vision-inspector. Optional this phase — the worker does
   *  not yet wire a post-finalize vision call; when null, the vision
   *  sub-signal drops out and the remaining weights renormalize. */
  visionReport: VisionReport | null;
}

// ─── Breakdown (returned alongside the score for telemetry) ──────────

export interface SubScore {
  /** Did this signal contribute to the final score? */
  available: boolean;
  /** Raw value in [0, 1] — the un-weighted sub-signal score. Always
   *  present; on `available: false` it's 0 and unused. */
  rawValue: number;
  /** The weight actually applied after renormalization (so sum across
   *  available signals = 1.0). */
  weight: number;
  /** rawValue × weight — the signal's contribution to the composite. */
  contribution: number;
  /** Human-readable explainer (e.g. "spaces 4/5 built; elements
   *  78/120 built"). Used in telemetry to answer "why did this build
   *  score X". */
  notes: string;
}

export interface QualityScoreBreakdown {
  /** Final integer 0-100 — matches the legacy score's range so it's a
   *  drop-in replacement at the gate point in agent-job/route.ts. */
  score: number;
  formulaVersion: typeof QUALITY_SCORE_FORMULA_VERSION;
  structuralCompleteness: SubScore;
  geometricSanity: SubScore;
  visionQuality: SubScore;
  partsDecomposition: SubScore;
  /** Count of sub-signals that contributed. 4 = all available; 0 =
   *  every signal missing (score = 0 in that case). */
  signalsAvailable: number;
  /** Pretty single-line explainer for log messages — e.g.
   *  "structural 0.95×0.53 + sanity 1.0×0.33 + parts 0.7×0.13 = 93". */
  summary: string;
}

// ─── Pure helpers (sub-signals) ──────────────────────────────────────

const NEVER_AVAILABLE: SubScore = {
  available: false,
  rawValue: 0,
  weight: 0,
  contribution: 0,
  notes: "",
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Round to integer 0-100. Always finite. */
function round100(x: number): number {
  const n = Math.round(x * 100);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Structural completeness — average of:
 *   spaces_ratio   = built spaces / spec spaces (clamped to [0,1])
 *   elements_ratio = built elements / expected elements (clamped)
 *
 * If either sub-metric is undefined (no spaces in spec, or no
 * element_coverage), the available one carries the signal; if both
 * are undefined the signal drops out.
 *
 * Coverage > 1.0 is clamped to 1.0 — over-build is not penalized but
 * is not rewarded (prevents reward-gaming via spam-built elements).
 */
function computeStructuralCompleteness(
  briefSpec: BriefSpec,
  validation: SandboxValidateResult | null,
): SubScore {
  if (!validation) {
    return {
      ...NEVER_AVAILABLE,
      notes: "validation unavailable — structural completeness skipped",
    };
  }

  const specSpaces = (briefSpec.spaces ?? []).length;
  const builtSpaces = (validation.spaces_present ?? []).length;
  const hasSpacesSignal = specSpaces > 0;
  const spacesRatio = hasSpacesSignal ? clamp01(builtSpaces / specSpaces) : null;

  const cov = validation.element_coverage;
  const hasElementsSignal =
    cov !== null && cov !== undefined && (cov.total_expected ?? 0) > 0;
  const elementsRatio = hasElementsSignal
    ? clamp01((cov!.total_actual_in_expected_classes ?? 0) / cov!.total_expected)
    : null;

  if (spacesRatio === null && elementsRatio === null) {
    return {
      ...NEVER_AVAILABLE,
      notes: "neither spaces nor element_coverage available",
    };
  }

  const parts: number[] = [];
  const notes: string[] = [];
  if (spacesRatio !== null) {
    parts.push(spacesRatio);
    notes.push(`spaces ${builtSpaces}/${specSpaces}`);
  }
  if (elementsRatio !== null) {
    parts.push(elementsRatio);
    notes.push(
      `elements ${cov!.total_actual_in_expected_classes ?? 0}/${cov!.total_expected}`,
    );
  }
  const rawValue = parts.reduce((s, n) => s + n, 0) / parts.length;

  return {
    available: true,
    rawValue,
    weight: WEIGHT_STRUCTURAL,
    contribution: rawValue * WEIGHT_STRUCTURAL,
    notes: notes.join("; "),
  };
}

/**
 * Geometric sanity — mean of 4 binary gates:
 *   - world_bbox.verdict === "OK"          (or null = unknown → skip)
 *   - origin_collapse.collapsed === false  (or null = skip)
 *   - web_ifc_load_test === "PASS"         (or "SKIP" = unknown → skip)
 *   - refs_resolve === true                (always present)
 *
 * Each gate that is unavailable drops out of the mean. If ALL are
 * unavailable the signal drops entirely (validation is null).
 */
function computeGeometricSanity(
  validation: SandboxValidateResult | null,
): SubScore {
  if (!validation) {
    return {
      ...NEVER_AVAILABLE,
      notes: "validation unavailable — sanity signal skipped",
    };
  }

  const gates: Array<{ name: string; value: number; available: boolean }> = [];

  if (validation.world_bbox && validation.world_bbox.verdict) {
    gates.push({
      name: "bbox",
      value: validation.world_bbox.verdict === "OK" ? 1 : 0,
      available: true,
    });
  }
  if (validation.origin_collapse && validation.origin_collapse.collapsed !== undefined) {
    gates.push({
      name: "origin",
      value: validation.origin_collapse.collapsed ? 0 : 1,
      available: true,
    });
  }
  if (validation.web_ifc_load_test && validation.web_ifc_load_test !== "SKIP") {
    gates.push({
      name: "load",
      value: validation.web_ifc_load_test === "PASS" ? 1 : 0,
      available: true,
    });
  }
  // refs_resolve is always present (boolean), no null-check needed.
  gates.push({
    name: "refs",
    value: validation.refs_resolve ? 1 : 0,
    available: true,
  });

  if (gates.length === 0) {
    return {
      ...NEVER_AVAILABLE,
      notes: "no sanity gates available",
    };
  }

  const rawValue = gates.reduce((s, g) => s + g.value, 0) / gates.length;
  const notes = gates.map((g) => `${g.name}=${g.value ? "ok" : "FAIL"}`).join(" ");

  return {
    available: true,
    rawValue,
    weight: WEIGHT_SANITY,
    contribution: rawValue * WEIGHT_SANITY,
    notes,
  };
}

/**
 * Vision quality — Opus's 0-100 visual review, normalized to 0-1.
 *
 * Failure modes that vision-inspector itself produces:
 *   - quality_score = 0 with high-sev "Vision inspector unavailable"
 *     issue → treat as signal-unavailable (signal drops out rather
 *     than zeroing the metric)
 *   - quality_score = 0 with real high-sev issues → genuine low score,
 *     keep it (the build IS bad)
 *
 * Distinguishing the two: if the only issue is a "Vision inspector
 * unavailable" / "Inspection failed" message, the score is 0 by
 * infrastructure failure, not by the build being bad. Mark
 * unavailable so the structural+sanity signals can carry.
 */
function computeVisionQuality(report: VisionReport | null): SubScore {
  if (!report) {
    return {
      ...NEVER_AVAILABLE,
      notes: "vision report absent (post-finalize vision not wired)",
    };
  }

  // Detect the vision-inspector's degraded-failure shape.
  const isInfraFailure =
    report.quality_score === 0 &&
    report.issues.length === 1 &&
    report.issues[0].severity === "high" &&
    report.issues[0].type === "other" &&
    /vision inspector|inspection (failed|could not)/i.test(
      report.issues[0].description ?? "",
    );

  if (isInfraFailure) {
    return {
      ...NEVER_AVAILABLE,
      notes: `vision infrastructure failure: ${report.issues[0].description?.slice(0, 80) ?? "unknown"}`,
    };
  }

  const rawValue = clamp01(report.quality_score / 100);
  const highCount = report.issues.filter((i) => i.severity === "high").length;
  const medCount = report.issues.filter((i) => i.severity === "med").length;

  return {
    available: true,
    rawValue,
    weight: WEIGHT_VISION,
    contribution: rawValue * WEIGHT_VISION,
    notes:
      `score=${report.quality_score}` +
      (highCount > 0 ? `, ${highCount} high-sev` : "") +
      (medCount > 0 ? `, ${medCount} med-sev` : ""),
  };
}

/**
 * Parts decomposition — the legacy formula's sole signal, now demoted
 * to one of four and made CONDITIONAL: only contributes when the brief
 * actually has decomposed furniture (expected_parts > 0). When no parts
 * were expected the signal carries no information (the verifier
 * defaults to 1.0 in that case) so it drops out instead of artificially
 * boosting the composite.
 */
function computePartsDecomposition(
  briefSpec: BriefSpec,
  verifier: VerifierReport | null,
): SubScore {
  const expectedPartsCount = (briefSpec.furniture ?? []).reduce(
    (s, f) => s + (f.parts?.length ?? 0),
    0,
  );

  if (expectedPartsCount === 0) {
    return {
      ...NEVER_AVAILABLE,
      notes: "no decomposed furniture in spec — parts signal not applicable",
    };
  }

  if (!verifier) {
    return {
      ...NEVER_AVAILABLE,
      notes: "verifier unavailable — parts signal skipped",
    };
  }

  // Verifier from heuristic-fallback returns parts_coverage=0
  // pessimistically. Treat that as signal-unavailable too — we don't
  // want a Railway outage to tank otherwise-good builds.
  if (verifier.source !== "railway") {
    return {
      ...NEVER_AVAILABLE,
      notes: `verifier source=${verifier.source} (not Railway) — parts signal skipped`,
    };
  }

  const rawValue = clamp01(verifier.parts_coverage);
  return {
    available: true,
    rawValue,
    weight: WEIGHT_PARTS,
    contribution: rawValue * WEIGHT_PARTS,
    notes: `parts_coverage=${(rawValue * 100).toFixed(0)}% (${expectedPartsCount} expected)`,
  };
}

// ─── Main entry — pure composite ─────────────────────────────────────

export function computeQualityScore(
  inputs: QualityScoreInputs,
): QualityScoreBreakdown {
  const structural = computeStructuralCompleteness(
    inputs.briefSpec,
    inputs.finalValidation,
  );
  const sanity = computeGeometricSanity(inputs.finalValidation);
  const vision = computeVisionQuality(inputs.visionReport);
  const parts = computePartsDecomposition(inputs.briefSpec, inputs.verifierReport);

  const available = [structural, sanity, vision, parts].filter(
    (s) => s.available,
  );
  const signalsAvailable = available.length;

  // If NO signals contributed, the composite is undefined. Return 0
  // — the loop will treat this as below-threshold (retry or
  // accept-best-so-far). Never NaN, never throws.
  if (signalsAvailable === 0) {
    return {
      score: 0,
      formulaVersion: QUALITY_SCORE_FORMULA_VERSION,
      structuralCompleteness: structural,
      geometricSanity: sanity,
      visionQuality: vision,
      partsDecomposition: parts,
      signalsAvailable: 0,
      summary: "no signals available — score 0",
    };
  }

  // Renormalize weights across available signals so they sum to 1.0.
  const totalWeight = available.reduce((s, sig) => s + sig.weight, 0);
  const renormalize = (sub: SubScore): SubScore => {
    if (!sub.available || totalWeight === 0) return sub;
    const renormalizedWeight = sub.weight / totalWeight;
    return {
      ...sub,
      weight: renormalizedWeight,
      contribution: sub.rawValue * renormalizedWeight,
    };
  };

  const structuralR = renormalize(structural);
  const sanityR = renormalize(sanity);
  const visionR = renormalize(vision);
  const partsR = renormalize(parts);

  const rawScore =
    structuralR.contribution +
    sanityR.contribution +
    visionR.contribution +
    partsR.contribution;
  const score = round100(rawScore);

  const summaryParts: string[] = [];
  if (structuralR.available)
    summaryParts.push(`structural=${structuralR.rawValue.toFixed(2)}×${structuralR.weight.toFixed(2)}`);
  if (sanityR.available)
    summaryParts.push(`sanity=${sanityR.rawValue.toFixed(2)}×${sanityR.weight.toFixed(2)}`);
  if (visionR.available)
    summaryParts.push(`vision=${visionR.rawValue.toFixed(2)}×${visionR.weight.toFixed(2)}`);
  if (partsR.available)
    summaryParts.push(`parts=${partsR.rawValue.toFixed(2)}×${partsR.weight.toFixed(2)}`);

  return {
    score,
    formulaVersion: QUALITY_SCORE_FORMULA_VERSION,
    structuralCompleteness: structuralR,
    geometricSanity: sanityR,
    visionQuality: visionR,
    partsDecomposition: partsR,
    signalsAvailable,
    summary: `${summaryParts.join(" + ")} = ${score}`,
  };
}

// ─── Backward-compat: the legacy score (Rule 6 — log side-by-side) ──

/**
 * The pre-δ.2 score: `round(parts_coverage * 80 + (verified ? 20 : 0))`.
 * Preserved verbatim so the worker can log BOTH scores per build for
 * real-run validation that the new metric is better than the old one.
 *
 * Returns 0 when no verifier report is available — matches the old
 * worker's behaviour (which also returned 0 on verifier failure).
 */
export function computeLegacyQualityScore(
  verifier: VerifierReport | null,
): number {
  if (!verifier) return 0;
  const raw = verifier.parts_coverage * 80 + (verifier.verified ? 20 : 0);
  return round100(raw / 100);
}
