/**
 * Room Sizer — Simple Hard Caps
 *
 * The AI (with few-shot examples) handles room sizing.
 * This module ONLY enforces absolute min/max caps per room type.
 *
 * No normalization. No scaling formulas. No sqrt/linear calculations.
 * Just: if room > max, set to max. If room < min, set to min.
 *
 * The AI gets sizing right ~90% of the time via examples.
 * Hard caps catch the remaining 10% outliers.
 */

// ── Comprehensive fuzzy name classification ─────────────────────────────────

/**
 * Classify a room by its type and name into a canonical room category.
 * Handles every natural language variation an AI might generate.
 */
export function classifyRoom(type: string, name: string): string {
  const t = (type || "").toLowerCase().trim();
  const n = (name || "").toLowerCase().trim();
  const c = `${t} ${n}`;

  // ── BEDROOMS ──
  if (/master\s*(bed|suite|room)|main\s*bed/i.test(c)) return "master_bedroom";
  if (/guest\s*(bed|room|suite)/i.test(c)) return "guest_bedroom";
  if (/kid|child|boy|girl|son|daughter/i.test(c) && /bed|room/i.test(c)) return "bedroom";
  if (/bed\s*room|bedroom/i.test(c) || t === "bedroom") return "bedroom";

  // ── BATHROOMS ──
  if (/master\s*(bath|toilet|wash)/i.test(c)) return "master_bathroom";
  if (/servant\s*(bath|toilet|wash|wc)/i.test(c) || /maid.*toilet/i.test(c) || /staff.*toilet/i.test(c)) return "servant_toilet";
  if (/guest\s*(bath|toilet|powder|wash)/i.test(c) || /powder\s*room|half\s*bath/i.test(c)) return "powder_room";
  if (/bath\s*room|bathroom|toilet|washroom|\bwc\b|restroom|lavatory/i.test(c) || t === "bathroom" || t === "toilet") return "bathroom";

  // ── KITCHEN ──
  if (/kitchen|modular\s*kitchen|pantry\s*kitchen|cook\s*room|kitchenette/i.test(c) || t === "kitchen") return "kitchen";

  // ── LIVING / PUBLIC ──
  if (/living|lounge|sitting\s*(room|area)|family\s*(room|sitting|area|lounge)/i.test(c) || t === "living" || t === "living_room") return "living_room";
  if (/drawing\s*room|formal\s*living/i.test(c)) return "drawing_room";
  if (/dining/i.test(c) || t === "dining" || t === "dining_room") return "dining_room";

  // ── SERVICE (name-specific checks FIRST, type fallback LAST) ──
  if (/servant\s*quarter|maid\s*(room|quarter)|domestic\s*help|staff\s*room|driver\s*room/i.test(c)) return "servant_quarter";
  if (/pooja|puja|prayer|mandir|temple/i.test(c) || t === "puja_room") return "pooja_room";
  if (/shoe\s*(rack|area|cabinet|closet|room)|cloak\s*room/i.test(n)) return "shoe_rack";
  if (/walk.in\s*(closet|wardrobe)|wardrobe\s*room|dressing\s*room/i.test(n)) return "walk_in_closet";
  if (/utility|wash\s*area|washing\s*area/i.test(c) || t === "utility") return "utility";
  if (/laundry/i.test(c)) return "laundry";
  if (/store\s*room|storage\s*room|lumber|box\s*room/i.test(n) || (t === "storage" && !/shoe|closet|wardrobe|walk/i.test(n)) || t === "store_room") return "store_room";

  // ── CIRCULATION ──
  // ── COMMERCIAL (check BEFORE circulation — "Reception" with type "entrance" must not become "foyer") ──
  if (/reception|front\s*desk|waiting/i.test(n)) return "reception";

  if (/corridor|hallway|passage|lobby/i.test(c) || t === "hallway" || t === "corridor") return "corridor";
  if (/foyer|entrance\s*(hall|area)|entry\s*hall/i.test(c) || t === "foyer" || t === "entrance") return "foyer";
  if (/stair|staircase|stairwell/i.test(c) || t === "staircase") return "staircase";

  // ── OUTDOOR ──
  if (/balcony|sit\s*out|sitout/i.test(c) || t === "balcony") return "balcony";
  if (/verandah|veranda|porch|portico/i.test(c)) return "verandah";
  if (/terrace|roof\s*top|roof\s*garden/i.test(c)) return "terrace";
  if (/car\s*park|parking|garage|car\s*port/i.test(c)) return "parking";

  // ── SPECIALTY ──
  if (/study|home\s*office|work\s*room/i.test(c) || t === "study" || t === "home_office") return "study";
  if (/gym|exercise|workout|fitness/i.test(c)) return "gym";
  if (/theater|theatre|media\s*room|home\s*theater/i.test(c)) return "home_theater";
  if (/library|reading\s*room/i.test(c)) return "library";

  // ── COMMERCIAL ──
  if (/reception|front\s*desk|waiting/i.test(c)) return "reception";
  if (/open\s*(work|office|floor|plan|space)|workstation/i.test(c)) return "open_workspace";
  if (/cabin|private\s*office|director/i.test(c) || t === "office") return "cabin";
  if (/conference|meeting|board\s*room/i.test(c)) return "conference_room";
  if (/server\s*room|data\s*center|it\s*room/i.test(c)) return "server_room";
  if (/pantry|break\s*room|cafeteria|canteen/i.test(c)) return "pantry";

  // ── HOSTEL ──
  if (/hostel\s*room|pg\s*room|dorm/i.test(c)) return "hostel_room";
  if (/common\s*room|tv\s*room|recreation/i.test(c)) return "common_room";
  if (/warden/i.test(c)) return "warden_room";

  // ── Last-resort keyword matching ──
  if (/bed/i.test(n)) return "bedroom";
  if (/bath|toilet|wc/i.test(n)) return "bathroom";
  if (/kitchen|cook/i.test(n)) return "kitchen";
  if (/living|lounge|sitting/i.test(n)) return "living_room";
  if (/dining/i.test(n)) return "dining_room";

  return "custom";
}

// ── Hard caps: absolute min/max per room type ───────────────────────────────

const HARD_CAPS: Record<string, { min: number; max: number }> = {
  // Bathrooms (STRICT)
  bathroom:          { min: 2.5, max: 5.5 },
  master_bathroom:   { min: 3.5, max: 7.0 },
  toilet:            { min: 1.5, max: 3.5 },
  powder_room:       { min: 1.5, max: 3.0 },
  servant_toilet:    { min: 1.5, max: 3.0 },

  // Bedrooms
  master_bedroom:    { min: 12.0, max: 25.0 },
  bedroom:           { min: 9.5, max: 20.0 },
  guest_bedroom:     { min: 9.5, max: 16.0 },

  // Public
  living_room:       { min: 12.0, max: 35.0 },
  dining_room:       { min: 8.0, max: 18.0 },
  drawing_room:      { min: 12.0, max: 25.0 },
  family_room:       { min: 10.0, max: 22.0 },
  kitchen:           { min: 5.0, max: 16.0 },

  // Service (STRICT)
  pooja_room:        { min: 2.5, max: 6.0 },
  utility:           { min: 2.5, max: 6.0 },
  store_room:        { min: 2.5, max: 6.0 },
  servant_quarter:   { min: 7.0, max: 12.0 },
  laundry:           { min: 2.5, max: 5.0 },
  shoe_rack:         { min: 1.0, max: 3.0 },
  walk_in_closet:    { min: 3.0, max: 7.0 },

  // Circulation
  corridor:          { min: 4.0, max: 20.0 },
  foyer:             { min: 3.0, max: 10.0 },
  staircase:         { min: 6.0, max: 14.0 },

  // Outdoor
  balcony:           { min: 3.0, max: 12.0 },
  verandah:          { min: 4.0, max: 15.0 },
  terrace:           { min: 6.0, max: 50.0 },

  // Study / Office
  study:             { min: 6.0, max: 14.0 },
  home_office:       { min: 7.0, max: 16.0 },
  gym:               { min: 8.0, max: 25.0 },
  home_theater:      { min: 12.0, max: 30.0 },
  library:           { min: 6.0, max: 16.0 },

  // Commercial
  reception:         { min: 8.0, max: 25.0 },
  cabin:             { min: 8.0, max: 16.0 },
  conference_room:   { min: 12.0, max: 30.0 },
  open_workspace:    { min: 15.0, max: 100.0 },
  server_room:       { min: 4.0, max: 10.0 },
  pantry:            { min: 4.0, max: 12.0 },

  // Hostel
  hostel_room:       { min: 9.0, max: 14.0 },
  common_room:       { min: 12.0, max: 30.0 },
  warden_room:       { min: 9.0, max: 16.0 },
};

/**
 * Enforce absolute min/max caps on room areas.
 * This is the ONLY post-AI validation. No normalization, no scaling.
 * If AI got it right (it should, with few-shot examples), this is a no-op.
 * If AI hallucinated, this catches it.
 */
export function enforceHardCaps(
  rooms: Array<{ name: string; type: string; areaSqm: number }>
): void {
  for (const room of rooms) {
    const classified = classifyRoom(room.type, room.name);
    const caps = HARD_CAPS[classified];
    if (!caps) continue;

    if (room.areaSqm > caps.max) {
      console.warn(`[HARD-CAP] ${room.name}: ${room.areaSqm.toFixed(1)} sqm → capped to ${caps.max} sqm`);
      room.areaSqm = caps.max;
    }
    if (room.areaSqm < caps.min) {
      console.warn(`[HARD-CAP] ${room.name}: ${room.areaSqm.toFixed(1)} sqm → raised to ${caps.min} sqm`);
      room.areaSqm = caps.min;
    }
  }
}

// ── Legacy exports (kept for backward compatibility with tests) ─────────────

export type BuildingType =
  | "apartment" | "villa" | "bungalow" | "duplex" | "row_house"
  | "penthouse" | "studio" | "hostel" | "office" | "farmhouse" | "default";

export function detectBuildingType(prompt: string): BuildingType {
  const p = prompt.toLowerCase();
  if (/\bstudio\b/.test(p)) return "studio";
  if (/\bhostel\b|\bpg\b|\bpaying\s*guest\b/.test(p)) return "hostel";
  if (/\boffice\b|\bcommercial\b|\bworkspace\b/.test(p)) return "office";
  if (/\bfarmhouse\b|\bfarm\s*house\b/.test(p)) return "farmhouse";
  if (/\bpenthouse\b/.test(p)) return "penthouse";
  if (/\brow\s*house\b|\btownhouse\b/.test(p)) return "row_house";
  if (/\bduplex\b|\bg\+1\b|\bground\s*\+\s*first\b/.test(p)) return "duplex";
  if (/\bbungalow\b/.test(p)) return "bungalow";
  if (/\bvilla\b/.test(p)) return "villa";
  if (/\bapartment\b|\bflat\b/.test(p)) return "apartment";
  return "default";
}

export function detectFloorCount(prompt: string): number {
  const p = prompt.toLowerCase();
  if (/\bg\+2\b|\b3\s*(?:floor|stor(?:e?)y)\b/.test(p)) return 3;
  if (/\bduplex\b|\bg\+1\b|\b2\s*(?:floor|stor(?:e?)y)\b/.test(p)) return 2;
  return 1;
}

export function detectBHKCount(rooms: Array<{ name: string; type: string }>): number {
  return rooms.filter(r => {
    const cls = classifyRoom(r.type, r.name);
    return cls === "bedroom" || cls === "master_bedroom" || cls === "guest_bedroom";
  }).length;
}

export function extractTotalAreaSqm(prompt: string): number | null {
  const p = prompt.toLowerCase();
  const sqftMatch = p.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|square\s*feet|sqft|sft)/);
  if (sqftMatch) return parseFloat(sqftMatch[1].replace(/,/g, "")) * 0.0929;
  const sqmMatch = p.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*m|square\s*met(?:er|re)s?|sqm)/);
  if (sqmMatch) return parseFloat(sqmMatch[1].replace(/,/g, ""));
  return null;
}

// Legacy function — now just calls enforceHardCaps
export function applyDeterministicSizing(
  rooms: Array<{ name: string; type: string; areaSqm: number; zone?: string; preferredWidth?: number; preferredDepth?: number }>,
  _totalAreaSqm: number,
  _prompt: string,
): void {
  enforceHardCaps(rooms);
}
