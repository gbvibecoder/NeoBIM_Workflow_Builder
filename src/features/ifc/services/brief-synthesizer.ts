/**
 * Brief synthesizer — Hybrid input-UX path for the design-agent pipeline.
 *
 * The `/api/v1/design/generate` endpoint takes a free-form brief (PDF
 * URL, PDF text, or plain text). The EX-001 handler historically has
 * only structured params (buildingType, floors, BHK count, plot size,
 * region, programme). This module bridges the two:
 *
 *   1. If an upstream node has already produced rich brief text (the
 *      `textContent` field in the handler input chain), use it
 *      verbatim — that's the user's own brief, the highest-fidelity
 *      signal.
 *   2. Otherwise, synthesize a single English sentence from the
 *      structured params. The LLM matcher tolerates terse briefs
 *      (the diagnostic dry-run used a 60-word brief; a 10-word one
 *      also matches), but more signal → better template match.
 *
 * This is intentionally a pure function with no side effects so it's
 * cheap to call on every EX-001 invocation and trivially testable.
 */

export interface BriefSynthesisInputs {
  /** Free-form brief from an upstream workflow node, if any. */
  textContent?: string;

  /** Building type label resolved earlier in EX-001 (e.g., "Residential"). */
  buildingType?: string;

  /** Floors-above-ground count. */
  floors?: number;

  /** Bedroom-Hall-Kitchen count (1/2/3/4...). */
  bhkCount?: number;

  /** Footprint in square metres. */
  footprintM2?: number;

  /** Plot width × depth in metres, if known. */
  plotWidthM?: number;
  plotDepthM?: number;

  /** Region / city, if known. */
  region?: string;

  /** Total Gross Floor Area in square metres. */
  gfaM2?: number;

  /** Total height in metres. */
  heightM?: number;

  /** Programme entries (rooms list) — optional richer detail. */
  programme?: Array<{ space?: string; area_m2?: number }>;
}

const MIN_USER_BRIEF_LENGTH = 24; // shorter than this is probably a stray "untitled" caption


/**
 * Produce a brief string suitable for `/api/v1/design/generate`'s
 * `brief_text` field.
 *
 * Strategy: prefer the user's own brief from upstream when non-trivial;
 * otherwise compose a single sentence from structured params.
 */
export function synthesizeBrief(inputs: BriefSynthesisInputs): {
  briefText: string;
  source: "upstream-text" | "synthesized" | "fallback";
} {
  // Path 1: user-provided brief from upstream nodes.
  if (inputs.textContent && inputs.textContent.trim().length >= MIN_USER_BRIEF_LENGTH) {
    return { briefText: inputs.textContent.trim(), source: "upstream-text" };
  }

  // Path 2: synthesize from structured params.
  const parts: string[] = [];

  const occupancy = inputs.buildingType ?? "Residential";
  const bhk = inputs.bhkCount && inputs.bhkCount > 0 ? `${inputs.bhkCount}BHK ` : "";
  const formFactor = inferFormFactor(inputs.floors);
  parts.push(`${occupancy} ${bhk}${formFactor}`.trim());

  // Plot dimensions
  if (inputs.plotWidthM && inputs.plotDepthM) {
    parts.push(
      `on a ${round1(inputs.plotWidthM)}m × ${round1(inputs.plotDepthM)}m plot`,
    );
  } else if (inputs.footprintM2 && inputs.footprintM2 > 0) {
    parts.push(`with ${Math.round(inputs.footprintM2)} m² footprint`);
  }

  // Region
  if (inputs.region && inputs.region.trim().length > 0) {
    parts.push(`in ${inputs.region.trim()}`);
  }

  // Floors / height
  if (inputs.floors && inputs.floors > 0) {
    const storeyWord = inputs.floors === 1 ? "storey" : "storeys";
    parts.push(`${inputs.floors} ${storeyWord} above ground`);
  } else if (inputs.heightM && inputs.heightM > 0) {
    parts.push(`approximately ${Math.round(inputs.heightM)} m tall`);
  }

  // Programme — list distinct room names if available (gives matcher
  // strong signal: "kitchen + living + master-bedroom" → 3BHK family).
  if (inputs.programme && inputs.programme.length > 0) {
    const distinctRooms = Array.from(
      new Set(
        inputs.programme
          .map((p) => p.space?.toLowerCase())
          .filter((s): s is string => !!s),
      ),
    );
    if (distinctRooms.length > 0) {
      parts.push(`with ${distinctRooms.slice(0, 8).join(", ")}`);
    }
  }

  // GFA as the closer (helps matcher decide tower vs house family).
  if (inputs.gfaM2 && inputs.gfaM2 > 0) {
    parts.push(`(~${Math.round(inputs.gfaM2)} m² total GFA)`);
  }

  const briefText = parts.join(", ").replace(/, \(/, " (");
  if (briefText.trim().length >= MIN_USER_BRIEF_LENGTH) {
    return { briefText, source: "synthesized" };
  }

  // Path 3: terminal fallback. Even with no structured params we still
  // pass *something* so the matcher doesn't blow up on empty input.
  return {
    briefText: "Residential building, design-development fidelity, India.",
    source: "fallback",
  };
}


function inferFormFactor(floors?: number): string {
  if (!floors || floors <= 0) return "building";
  if (floors === 1) return "single-storey house";
  if (floors === 2) return "duplex";
  if (floors <= 4) return "low-rise apartment building";
  if (floors <= 11) return "mid-rise tower";
  return "high-rise tower";
}


function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
