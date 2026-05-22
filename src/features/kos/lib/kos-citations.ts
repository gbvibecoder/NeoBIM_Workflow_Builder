/**
 * Reconstruct the `[N]` marker → citation mapping on the client.
 *
 * The backend's `mapCitationMarkers` (bot-orchestrator.ts) builds the
 * citations array by walking the *unique* `[N]` markers in the final
 * answer text in FIRST-APPEARANCE order, and for each pushes the chunk
 * at `perTurnRetrievals[n - 1]`. Critically, the resulting array drops
 * the `n` value — citation `i` simply corresponds to the i-th unique
 * marker encountered.
 *
 * So given the same answer text plus the ordered citations array, we
 * can replay that exact walk to recover which `[N]` each citation
 * belongs to. This must mirror the backend regex (`/\[(\d+)\]/g`) and
 * its `n >= 1` filter precisely, or the mapping drifts.
 */

import type { KosCitation } from "@/features/kos/types/chat";

const MARKER_RE = /\[(\d+)\]/g;

/**
 * Returns a map from the 1-based marker number to its citation. Markers
 * with no corresponding citation (e.g. the bot wrote `[4]` but only 3
 * sources came back) are simply absent from the map — callers render
 * those as non-clickable plain text.
 */
export function buildCitationIndex(
  text: string,
  citations: KosCitation[],
): Map<number, KosCitation> {
  const seen = new Set<number>();
  const ordered: number[] = [];

  for (const match of text.matchAll(MARKER_RE)) {
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n >= 1 && !seen.has(n)) {
      seen.add(n);
      ordered.push(n);
    }
  }

  const map = new Map<number, KosCitation>();
  ordered.forEach((n, i) => {
    const citation = citations[i];
    if (citation) map.set(n, citation);
  });
  return map;
}
