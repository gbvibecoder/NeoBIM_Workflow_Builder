/* ─── Panorama feature — building-type resolver ───────────────────────────
   Decides which panorama bucket to default to for the loaded IFC. Strict
   first-match-wins pipeline:

     1. NBC India occupancy group from IfcRelAssociatesClassification
     2. OmniClass / CSI division dominance heuristic
     3. IfcSpace name keyword scan
     4. Default → residential-apartment

   The resolver is pure: same input → same output. All signals are pulled
   from a `ParseResultLike` projection so the resolver is stable even as the
   underlying parser evolves; missing signals just fall through. */

import type { PanoramaBucket } from "../constants";
import type { BuildingTypeResolution, ParseResultLike } from "../types";

const DEFAULT_BUCKET: PanoramaBucket = "residential-apartment";

/* ── 1. NBC India occupancy group decoding ─────────────────────────────────
   Group   Occupancy            Panorama bucket
   ──────  ───────────────────  ──────────────────────────
   A-1     Lodging              residential-apartment
   A-2     One/two-family       residential-villa
   A-3+    Apartments / dorms   residential-apartment
   B       Educational          office
   C       Institutional        office
   D       Assembly             office
   E       Business             office
   F       Mercantile           retail
   G       Industrial           industrial
   H       Storage              industrial
   I       Hazardous            industrial
   J       Hospital             office */

interface NBCMatch {
  bucket: PanoramaBucket;
  reason: string;
}

const NBC_PATTERNS: Array<{ rx: RegExp; pick: NBCMatch }> = [
  { rx: /\bgroup\s*a-?2\b/i, pick: { bucket: "residential-villa", reason: "NBC Group A-2 (one/two-family residential)" } },
  { rx: /\bgroup\s*a-?\d/i, pick: { bucket: "residential-apartment", reason: "NBC Group A (residential)" } },
  { rx: /\bgroup\s*a\b/i, pick: { bucket: "residential-apartment", reason: "NBC Group A (residential)" } },
  { rx: /\bgroup\s*b\b/i, pick: { bucket: "office", reason: "NBC Group B (educational → office bucket)" } },
  { rx: /\bgroup\s*c\b/i, pick: { bucket: "office", reason: "NBC Group C (institutional → office bucket)" } },
  { rx: /\bgroup\s*d\b/i, pick: { bucket: "office", reason: "NBC Group D (assembly → office bucket)" } },
  { rx: /\bgroup\s*e\b/i, pick: { bucket: "office", reason: "NBC Group E (business)" } },
  { rx: /\bgroup\s*f\b/i, pick: { bucket: "retail", reason: "NBC Group F (mercantile)" } },
  { rx: /\bgroup\s*g\b/i, pick: { bucket: "industrial", reason: "NBC Group G (industrial)" } },
  { rx: /\bgroup\s*h\b/i, pick: { bucket: "industrial", reason: "NBC Group H (storage → industrial bucket)" } },
  { rx: /\bgroup\s*i\b/i, pick: { bucket: "industrial", reason: "NBC Group I (hazardous → industrial bucket)" } },
  { rx: /\bgroup\s*j\b/i, pick: { bucket: "office", reason: "NBC Group J (hospital → office bucket)" } },
];

function tryNBC(parse: ParseResultLike): BuildingTypeResolution | null {
  const refs = parse.classifications?.nbc ?? [];
  if (refs.length === 0) return null;
  for (const ref of refs) {
    for (const { rx, pick } of NBC_PATTERNS) {
      if (rx.test(ref)) {
        return {
          bucket: pick.bucket,
          confidence: "high",
          source: "nbc",
          reasoning: pick.reason,
        };
      }
    }
  }
  return null;
}

/* ── 2. CSI division dominance heuristic ───────────────────────────────────
   When NBC is absent we look at which CSI divisions dominate the model.
   This is a coarse signal: divisions {06,09} → finishing-heavy → residential;
   {05,03} large skeleton → office/industrial. Confidence: medium. */

function tryDivisions(parse: ParseResultLike): BuildingTypeResolution | null {
  const divs = parse.divisions ?? [];
  if (divs.length === 0) return null;
  const set = new Set(divs);
  /* Industrial signals win when present. */
  if (set.has("23") || set.has("21") || set.has("11")) {
    return {
      bucket: "industrial",
      confidence: "medium",
      source: "omniclass",
      reasoning: `CSI divisions present (${divs.join(", ")}) include MEP/equipment-heavy 11/21/23 — industrial`,
    };
  }
  if (set.has("06") || set.has("09")) {
    return {
      bucket: "residential-apartment",
      confidence: "medium",
      source: "omniclass",
      reasoning: `CSI divisions ${divs.join(", ")} are finishing/wood-heavy — residential default`,
    };
  }
  if (set.has("05") && set.has("03")) {
    return {
      bucket: "office",
      confidence: "medium",
      source: "omniclass",
      reasoning: `CSI divisions ${divs.join(", ")} include steel + concrete frame — office default`,
    };
  }
  return null;
}

/* ── 3. IfcSpace name keyword scan ────────────────────────────────────────
   Last-resort heuristic. Tokenises every space name; the bucket whose
   keyword set captures the most tokens wins. Tie-breaks favour residential
   (documented rule in the test suite). */

interface KeywordTable {
  bucket: PanoramaBucket;
  keywords: string[];
}

const KEYWORD_TABLES: KeywordTable[] = [
  {
    bucket: "residential-apartment",
    keywords: [
      "bedroom",
      "kitchen",
      "living",
      "bath",
      "master",
      "study",
      "balcony",
      "wardrobe",
      "drawing",
    ],
  },
  {
    bucket: "office",
    keywords: ["office", "conference", "cubicle", "workstation", "meeting", "boardroom"],
  },
  {
    /* Includes commercial guest-facing rooms (lobby, restaurant, bar,
       lounge, etc.) — they read as retail-frontage rather than office. */
    bucket: "retail",
    keywords: [
      "shop", "store", "display", "checkout", "boutique", "stall",
      "lobby", "suite", "restaurant", "bar", "pool", "spa", "reception", "lounge",
    ],
  },
  {
    bucket: "industrial",
    keywords: ["warehouse", "factory", "plant", "loading", "machine", "assembly", "yard"],
  },
];

const VILLA_TOKENS = ["garage", "garden", "terrace"];

function tryKeywords(parse: ParseResultLike): BuildingTypeResolution | null {
  const names = parse.spaceNames ?? [];
  if (names.length === 0) return null;

  const lowered = names.map((n) => n.toLowerCase());
  const score: Record<PanoramaBucket, number> = {
    "residential-apartment": 0,
    "residential-villa": 0,
    office: 0,
    retail: 0,
    industrial: 0,
  };

  for (const name of lowered) {
    for (const table of KEYWORD_TABLES) {
      for (const kw of table.keywords) {
        if (name.includes(kw)) {
          score[table.bucket] += 1;
          break; /* one hit per name per bucket */
        }
      }
    }
  }

  /* Find the highest-scoring bucket. Ties resolve to residential-apartment
     per the documented rule (mixed-use favours residential). */
  let best: PanoramaBucket = "residential-apartment";
  let bestScore = 0;
  for (const table of KEYWORD_TABLES) {
    if (score[table.bucket] > bestScore) {
      best = table.bucket;
      bestScore = score[table.bucket];
    }
  }

  if (bestScore === 0) return null;

  /* Villa nudge: residential + low-storey + garage/garden/terrace token
     present anywhere in the space-name list. */
  if (best === "residential-apartment" && (parse.storeyCount ?? Infinity) <= 2) {
    const hasVillaToken = lowered.some((n) =>
      VILLA_TOKENS.some((t) => n.includes(t)),
    );
    if (hasVillaToken) {
      return {
        bucket: "residential-villa",
        confidence: "low",
        source: "space-keywords",
        reasoning: `Space-name keywords matched residential and storey count ≤2 with villa token — villa`,
      };
    }
  }

  const sample = lowered.slice(0, 3).join(", ");
  return {
    bucket: best,
    confidence: "low",
    source: "space-keywords",
    reasoning: `Space-name keywords (${sample}${lowered.length > 3 ? "…" : ""}) matched ${best}`,
  };
}

/**
 * Resolve the most likely panorama bucket for the loaded model.
 *
 * Pure function: deterministic, no side effects, no I/O.
 *
 * Pass `null` or an empty `ParseResultLike` when no model is loaded — the
 * resolver returns the default bucket with a "No model loaded" reasoning
 * so the UI can render a sensible placeholder.
 */
export function resolveBuildingType(
  parseResult: ParseResultLike | null | undefined,
): BuildingTypeResolution {
  if (!parseResult) {
    return {
      bucket: DEFAULT_BUCKET,
      confidence: "low",
      source: "default",
      reasoning: "No model loaded yet.",
    };
  }

  const empty =
    !parseResult.classifications?.nbc?.length &&
    !parseResult.divisions?.length &&
    !parseResult.spaceNames?.length;
  if (empty) {
    return {
      bucket: DEFAULT_BUCKET,
      confidence: "low",
      source: "default",
      reasoning: "No model loaded yet.",
    };
  }

  return (
    tryNBC(parseResult) ??
    tryDivisions(parseResult) ??
    tryKeywords(parseResult) ?? {
      bucket: DEFAULT_BUCKET,
      confidence: "low",
      source: "default",
      reasoning: "No classification or space-name signal — defaulting to residential apartment.",
    }
  );
}
