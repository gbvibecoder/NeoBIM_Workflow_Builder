/**
 * Bilingual + monolingual label helpers for the editorial PDF.
 *
 * Per execution-plan decision #10, the deliverable is English-primary
 * with German room subtitles sourced per-shot from the brief. This file
 * holds the chrome strings (cover headers, table headings, footer
 * confidentiality text) — none of these are sourced from the brief.
 *
 * **No hardcoded `12`.** Per-N-shots labels accept a count and fall
 * back to numeric for N > 20 via `numberToWord`.
 */

// ─── Number-to-word helper (1-20) ───────────────────────────────────
//
// Used by `LABEL_BASELINE_HEADER(n)` to produce "TWELVE" for Marx12
// without baking the literal into the chrome. Falls back to the digit
// representation for N > 20 — anything beyond 20 shots is unusual
// enough that "BASELINE — APPLIED TO ALL 21 RENDERINGS" reads cleanly.

const NUMBER_WORDS: readonly string[] = [
  "ZERO",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN",
  "TWENTY",
];

export function numberToWord(n: number): string {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return String(n);
  }
  if (n <= 20) return NUMBER_WORDS[n];
  return String(n);
}

// ─── Chrome strings ─────────────────────────────────────────────────

// HERO_SHOT is rendered as a filled gold square + the label "HERO SHOT".
// We don't ship the diamond glyph in the label string itself because
// U+25C6 (◆) is outside WinAnsi, so it falls back to "%Æ" or worse on
// jspdf's bundled Helvetica when Inter TTFs are missing. The glyph is
// drawn as geometry by `per-shot-page.ts` instead.
export const LABEL_HERO_SHOT = "HERO SHOT";

export function LABEL_SHOT_N_OF_M(n: number, m: number): string {
  return `Shot ${n} of ${m}`;
}

export const LABEL_ROOM_AREA = "ROOM AREA";
export const LABEL_ASPECT = "ASPECT";
export const LABEL_LIGHTING = "LIGHTING";

export const LABEL_FILENAME_PREFIX = "FILENAME (PER BRIEF §3.2)";

/** Apartment summary table headers. */
export const LABEL_TABLE_APARTMENT = "APARTMENT";
export const LABEL_TABLE_LAYOUT = "LAYOUT";
export const LABEL_TABLE_AREA = "AREA";
export const LABEL_TABLE_PERSONA = "PERSONA";
export const LABEL_TABLE_SHOTS = "SHOTS";

export const LABEL_FOOTER_LEFT = "Confidential — for client review";

/**
 * Right-side footer label with version. Defensive: strips a leading
 * `v` if the caller already prefixed (so `LABEL_FOOTER_RIGHT("v01")`
 * doesn't render `vv01 — M3 Full Draft`).
 */
export function LABEL_FOOTER_RIGHT(version: string): string {
  const trimmed = version.replace(/^v/i, "");
  return `v${trimmed} — M3 Full Draft`;
}

/**
 * Cover-line baseline header. Pluralised numerically — never hardcoded.
 *
 * Examples:
 *   N=12 → "BASELINE — APPLIED TO ALL TWELVE RENDERINGS"
 *   N=4  → "BASELINE — APPLIED TO ALL FOUR RENDERINGS"
 *   N=25 → "BASELINE — APPLIED TO ALL 25 RENDERINGS"
 *   N=0  → "BASELINE — APPLIED TO ALL 0 RENDERINGS"
 */
export function LABEL_BASELINE_HEADER(totalShots: number): string {
  return `BASELINE — APPLIED TO ALL ${numberToWord(totalShots)} RENDERINGS`;
}

/**
 * Cover-line "N PHOTOREALISTIC INTERIOR RENDERINGS" — same pattern.
 */
export function LABEL_PHOTOREALISTIC_COUNT(totalShots: number): string {
  return `${numberToWord(totalShots)} PHOTOREALISTIC INTERIOR RENDERINGS`;
}
