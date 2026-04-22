/**
 * Phase 2.8 — discriminator-weighted matcher for Stage 4 room names.
 *
 * The legacy `wordOverlapScore` treated every word equally, so a label
 * "Master Bath" tied at 0.5 against both "Master Bedroom" and "Master
 * Bathroom" — list order broke the tie and "Master Bath" frequently
 * got rewritten as "Master Bedroom", producing the "Master Bedroom 2"
 * duplicate observed in prod on 2026-04-22.
 *
 * This module fixes that by:
 *   (a) classifying words as DISCRIMINATORS (type-defining: bath,
 *       bedroom, kitchen, pooja, living, …) vs MODIFIERS (qualifiers:
 *       master, common, guest, kids, …).
 *   (b) weighting discriminators 3× higher than modifiers.
 *   (c) returning a HARD ZERO when both label and expected contain a
 *       discriminator and they don't overlap even through synonyms
 *       (bath ↔ bathroom OK; bath ↔ bedroom NOT OK).
 *   (d) recognising synonym families — "puja"/"pooja"/"prayer"/"mandir"
 *       all route to the same discriminator class.
 *
 * The caller (stage-4-extract) should still TRUST GPT-4o's own
 * `matchedName` when it already exactly matches an expected room
 * name — the weighted matcher is only a fallback for novel labels.
 */

/** Tokens that unambiguously define a room's type. */
const DISCRIMINATORS = new Set<string>([
  "bath", "bathroom", "bathrooms",
  "bed", "bedroom", "bedrooms",
  "kitchen", "kitchens",
  "pooja", "puja", "prayer", "mandir",
  "living", "lounge",
  "dining",
  "hall", "hallway", "corridor", "passage",
  "study", "office",
  "store", "storage", "pantry",
  "utility", "laundry",
  "foyer", "vestibule",
  "porch", "verandah", "veranda",
  "balcony", "terrace", "deck",
  "garden",
  "garage", "parking",
  "closet", "wardrobe",
  "toilet", "wc", "powder",
  "mudroom", "mud",
  "ensuite",
]);

/** Qualifier words — non-discriminating. */
const MODIFIERS = new Set<string>([
  "master", "common", "main", "guest", "small", "large", "family",
  "attached", "kids", "kid", "children", "child", "parents", "parent",
  "front", "back", "side", "upper", "lower", "private", "public",
  "formal", "informal",
]);

/** Ignored entirely during token comparison. */
const STOPWORDS = new Set<string>([
  "room", "the", "a", "an", "of", "and", "or",
  "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

/**
 * Synonym / root groups for discriminators. A label token maps to the
 * set of discriminator tokens it's considered equivalent with. Used to
 * say "bath" matches "bathroom" but not "bedroom", and that "puja"
 * matches "pooja" / "prayer" / "mandir".
 */
const DISCRIMINATOR_EQUIVALENTS: Record<string, string[]> = {
  bath:      ["bath", "bathroom", "bathrooms"],
  bathroom:  ["bath", "bathroom", "bathrooms"],
  bathrooms: ["bath", "bathroom", "bathrooms"],
  bed:       ["bed", "bedroom", "bedrooms"],
  bedroom:   ["bed", "bedroom", "bedrooms"],
  bedrooms:  ["bed", "bedroom", "bedrooms"],
  kitchen:   ["kitchen", "kitchens"],
  kitchens:  ["kitchen", "kitchens"],
  pooja:     ["pooja", "puja", "prayer", "mandir"],
  puja:      ["pooja", "puja", "prayer", "mandir"],
  prayer:    ["pooja", "puja", "prayer", "mandir"],
  mandir:    ["pooja", "puja", "prayer", "mandir"],
  living:    ["living", "lounge", "hall"],
  lounge:    ["living", "lounge"],
  hall:      ["hall", "living"],
  dining:    ["dining"],
  hallway:   ["hallway", "corridor", "passage"],
  corridor:  ["hallway", "corridor", "passage"],
  passage:   ["hallway", "corridor", "passage"],
  study:     ["study", "office"],
  office:    ["study", "office"],
  store:     ["store", "storage"],
  storage:   ["store", "storage"],
  pantry:    ["pantry", "storage"],
  utility:   ["utility", "laundry"],
  laundry:   ["utility", "laundry"],
  foyer:     ["foyer", "vestibule"],
  vestibule: ["foyer", "vestibule"],
  porch:     ["porch", "verandah", "veranda"],
  verandah:  ["porch", "verandah", "veranda"],
  veranda:   ["porch", "verandah", "veranda"],
  balcony:   ["balcony", "terrace", "deck"],
  terrace:   ["balcony", "terrace", "deck"],
  deck:      ["balcony", "terrace", "deck"],
  garden:    ["garden"],
  garage:    ["garage", "parking"],
  parking:   ["garage", "parking"],
  closet:    ["closet", "wardrobe"],
  wardrobe:  ["closet", "wardrobe"],
  mudroom:   ["mudroom", "mud"],
  mud:       ["mudroom", "mud"],
  toilet:    ["toilet", "wc", "bathroom", "bath", "powder"],
  wc:        ["toilet", "wc", "bathroom", "bath"],
  powder:    ["powder", "toilet", "bathroom"],
  ensuite:   ["ensuite", "bathroom", "bath"],
};

const DISCRIMINATOR_WEIGHT = 3;
const MODIFIER_WEIGHT = 1;
/** Score discount when a discriminator matches via synonym (e.g. "bath" ↔ "bathroom"). */
const SYNONYM_DISCOUNT = 0.9;

/**
 * Split a room name into lowercase tokens, stripping stopwords and
 * non-alphanumeric separators.
 */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

export function classify(token: string): "discriminator" | "modifier" | "other" {
  if (DISCRIMINATORS.has(token)) return "discriminator";
  if (MODIFIERS.has(token)) return "modifier";
  return "other";
}

/**
 * Score how well `label` matches `expected`. Returns a value in [0, 1].
 * Hard-zero if both contain discriminators and none overlap via the
 * equivalence table.
 */
export function weightedMatchScore(label: string, expected: string): number {
  const labelTokens = tokenize(label);
  const expectedTokens = tokenize(expected);
  if (labelTokens.length === 0 || expectedTokens.length === 0) return 0;

  const expectedTokenSet = new Set(expectedTokens);
  const labelDiscriminators = labelTokens.filter((w) => classify(w) === "discriminator");
  const expectedDiscriminators = expectedTokens.filter((w) => classify(w) === "discriminator");

  // Hard disjoint check — if both sides have discriminators but none
  // of the label's discriminators are equivalent to any of the expected's,
  // return zero. This is what prevents "Master Bath" (disc=bath) from
  // matching "Master Bedroom" (disc=bedroom) despite sharing "master".
  if (labelDiscriminators.length > 0 && expectedDiscriminators.length > 0) {
    let anyOverlap = false;
    outer: for (const ld of labelDiscriminators) {
      const equivs = new Set(DISCRIMINATOR_EQUIVALENTS[ld] ?? [ld]);
      for (const ed of expectedDiscriminators) {
        if (equivs.has(ed)) {
          anyOverlap = true;
          break outer;
        }
      }
    }
    if (!anyOverlap) return 0;
  }

  let matched = 0;
  let possible = 0;
  for (const w of labelTokens) {
    const cls = classify(w);
    const weight = cls === "discriminator" ? DISCRIMINATOR_WEIGHT : MODIFIER_WEIGHT;
    possible += weight;
    if (expectedTokenSet.has(w)) {
      matched += weight;
      continue;
    }
    if (cls === "discriminator") {
      const equivs = new Set(DISCRIMINATOR_EQUIVALENTS[w] ?? [w]);
      const synonymHit = expectedTokens.some((ew) => equivs.has(ew));
      if (synonymHit) matched += weight * SYNONYM_DISCOUNT;
    }
  }

  return possible === 0 ? 0 : matched / possible;
}

/**
 * Pick the best-matching expected name for a given label.
 *
 * Phase 2.8: prefer GPT-4o's `matchedName` when it's an exact match to
 * an expected room (even case-insensitive). Only fall back to weighted
 * matching against `labelAsShown` when GPT-4o's match is novel.
 */
export function pickBestMatch(
  labelAsShown: string,
  matchedName: string,
  expectedNames: string[],
): { name: string; score: number; source: "gpt-exact" | "weighted" | "fallback" } {
  const expectedSetLower = new Set(expectedNames.map((n) => n.toLowerCase()));
  // (a) Trust GPT-4o when its matchedName exactly matches an expected.
  if (expectedSetLower.has(matchedName.toLowerCase())) {
    // Preserve the canonical casing from the expected list.
    const canonical =
      expectedNames.find((n) => n.toLowerCase() === matchedName.toLowerCase()) ?? matchedName;
    return { name: canonical, score: 1, source: "gpt-exact" };
  }
  // (b) Fuzzy match against labelAsShown using discriminator-weighted scoring.
  let best: { name: string; score: number } = { name: labelAsShown, score: 0 };
  for (const expected of expectedNames) {
    const s = weightedMatchScore(labelAsShown, expected);
    if (s > best.score) best = { name: expected, score: s };
  }
  if (best.score >= 0.5) return { ...best, source: "weighted" };
  // (c) No good match — return labelAsShown as-is.
  return { name: labelAsShown, score: 0, source: "fallback" };
}
