import type { RoomFunction } from "./room-vocabulary";

export const FUNCTION_ALIASES: Array<{ pattern: RegExp; canonical: RoomFunction }> = [
  { pattern: /\bm\.?\s?bed(?:room)?\b/i, canonical: "master_bedroom" },
  { pattern: /\bowner('?s)?\s+(suite|bedroom|room)\b/i, canonical: "master_bedroom" },
  { pattern: /\b(?:children|kids?)\s+(?:bed)?room\b/i, canonical: "kids_bedroom" },
  { pattern: /\bguest\s+(?:bed)?room\b/i, canonical: "guest_bedroom" },
  { pattern: /\bdrawing(?:\s+room)?\b/i, canonical: "living" },
  { pattern: /\b(?:family|tv)\s+(?:room|lounge)\b/i, canonical: "living" },
  { pattern: /\b(?:wet|dry|modular|open)\s+kitchen\b/i, canonical: "kitchen" },
  { pattern: /\b(?:guest|powder|half)\s+(?:bath|toilet|wc)\b/i, canonical: "powder_room" },
  { pattern: /\bensuite\s+(?:bath(?:room)?)?\b/i, canonical: "master_bathroom" },
  { pattern: /\bcommon\s+bath(?:room)?\b/i, canonical: "bathroom" },
  { pattern: /\b(?:walk[- ]?in|walkin)\s+wardrobe\b/i, canonical: "walk_in_wardrobe" },
  { pattern: /\b(?:walk[- ]?in|walkin)\s+closet\b/i, canonical: "walk_in_closet" },
  { pattern: /\balmirah\b/i, canonical: "walk_in_wardrobe" },
  { pattern: /\bdressing\s+room\b/i, canonical: "walk_in_wardrobe" },
  { pattern: /\b(?:car\s+)?porch\b/i, canonical: "porch" },
  { pattern: /\bportico\b/i, canonical: "porch" },
  { pattern: /\bverandah?\b/i, canonical: "verandah" },
  { pattern: /\bsit[- ]?out\b/i, canonical: "verandah" },
  { pattern: /\b(?:internal\s+)?stair(?:case|s)?\b/i, canonical: "staircase" },
  { pattern: /\b(?:laundry|washing\s+area|dhobi|wash\s+area)\b/i, canonical: "utility" },
  { pattern: /\b(?:pooja|puja|prayer|mandir)(?:\s+room)?\b/i, canonical: "pooja" },
  { pattern: /\b(?:home\s+office|study(?:\s+room)?|library|reading\s+room|den)\b/i, canonical: "study" },
  { pattern: /\b(?:servant|maid'?s?|staff|help)\s+(?:room|quarter)s?\b/i, canonical: "servant_quarter" },
  { pattern: /\b(?:car\s+park(?:ing)?|garage)\b/i, canonical: "other" },
];

export function inferFunctionFromText(text: string): RoomFunction | null {
  for (const a of FUNCTION_ALIASES) {
    if (a.pattern.test(text)) return a.canonical;
  }
  return null;
}
