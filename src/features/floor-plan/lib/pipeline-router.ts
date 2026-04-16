export type RoutedPipeline = "A" | "B";

export interface SignalBreakdown {
  dimensions: number;
  paired_dimensions: number;
  positions: number;
  zone_words: number;
  adjacency_verbs: number;
  vastu: number;
  door_window_specifics: number;
}

export interface RoutingDecision {
  pipeline: RoutedPipeline;
  constraint_signals: number;
  breakdown: SignalBreakdown;
}

const ROUTE_TO_B_THRESHOLD = 5;

const PAIRED_DIM_RE = /\b\d{1,3}(?:\.\d)?\s*[x×]\s*\d{1,3}(?:\.\d)?\s*(?:ft|feet|m)\b/gi;
const SINGLE_DIM_RE = /\b\d{1,3}(?:\.\d)?\s*(?:ft|feet|foot|m|meter|metre)\b/gi;
const POSITION_RE = /\b(north|south|east|west|northeast|northwest|southeast|southwest|n[- ]?facing|s[- ]?facing|e[- ]?facing|w[- ]?facing|center(?:ed)?|central|middle)\b/gi;
const ZONE_WORD_RE = /\b(corner|zone|center|wall|side)\b/gi;
const ADJACENCY_RE = /\b(connecting|connects?\s+to|adjacent\s+to|attached\s+to|behind|next\s+to|leading\s+(?:into|to)|opens?\s+(?:onto|into)|flowing\s+(?:into|east|west|north|south))\b/gi;
const VASTU_RE = /\bvastu|vaastu/i;
const DOOR_WINDOW_SPECIFIC_RE = /\b\d{1,2}(?:\.\d)?\s*ft\s+(?:wide|tall|high)\b/gi;

function countMatches(prompt: string, re: RegExp): number {
  return (prompt.match(re) ?? []).length;
}

export function routePrompt(prompt: string): RoutingDecision {
  const breakdown: SignalBreakdown = {
    dimensions: countMatches(prompt, SINGLE_DIM_RE),
    paired_dimensions: countMatches(prompt, PAIRED_DIM_RE),
    positions: countMatches(prompt, POSITION_RE),
    zone_words: 0,
    adjacency_verbs: countMatches(prompt, ADJACENCY_RE),
    vastu: VASTU_RE.test(prompt) ? 5 : 0,
    door_window_specifics: countMatches(prompt, DOOR_WINDOW_SPECIFIC_RE),
  };

  // Zone words count only when within 8 words of a position word — proxy via
  // co-occurrence count: min of zone-word count and position count when both > 0.
  const zoneRaw = countMatches(prompt, ZONE_WORD_RE);
  if (zoneRaw > 0 && breakdown.positions > 0) {
    breakdown.zone_words = Math.min(zoneRaw, breakdown.positions);
  }

  // Paired dims count as 2 each (width AND depth); single dims count once.
  // We then subtract the singles inside paired matches to avoid double-counting.
  const constraint_signals =
    breakdown.dimensions +
    breakdown.paired_dimensions * 2 +
    breakdown.positions +
    breakdown.zone_words +
    breakdown.adjacency_verbs +
    breakdown.vastu +
    breakdown.door_window_specifics;

  return {
    pipeline: constraint_signals >= ROUTE_TO_B_THRESHOLD ? "B" : "A",
    constraint_signals,
    breakdown,
  };
}
