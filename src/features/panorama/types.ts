/* ─── Panorama feature — shared types ────────────────────────────────────── */

import type { PanoramaBucket } from "./constants";

/**
 * What signal drove the building-type detection. Surfaced in the UI tooltip
 * so users understand WHY the panel chose a particular bucket and can
 * override with confidence.
 */
export type DetectionSource = "nbc" | "omniclass" | "space-keywords" | "default";

export interface BuildingTypeResolution {
  bucket: PanoramaBucket;
  confidence: "high" | "medium" | "low";
  source: DetectionSource;
  /** Human-readable rationale, e.g. "NBC Group A-2 → villa". */
  reasoning: string;
}

/**
 * Lightweight projection of an IFC parse result that the resolver consumes.
 * Each field is optional because the live parser does not surface every
 * signal today (NBC chain + space names are forward-compatible). When a
 * field is absent the resolver simply moves to the next step in the chain.
 */
export interface ParseResultLike {
  /** NBC India occupancy classifications — typically the chain attached to
   *  IfcBuilding. Each entry is the textual classification reference name,
   *  e.g. "Group A-2" or "Group F". */
  classifications?: {
    nbc?: string[];
  };
  /** OmniClass / CSI division summary — list of two-digit CSI divisions
   *  present in the model (e.g. ["03", "04", "06", "08"]). */
  divisions?: string[];
  /** Names of IfcSpace entities. Used for keyword fallback when no
   *  formal classification is present. */
  spaceNames?: string[];
  /** Storey count — used to nudge residential into "villa" for low-storey
   *  buildings with garage/garden tokens in space names. */
  storeyCount?: number;
}
