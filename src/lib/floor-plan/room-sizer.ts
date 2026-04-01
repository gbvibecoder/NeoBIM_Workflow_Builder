/**
 * Deterministic Room Sizer
 *
 * Overrides AI-estimated room areas with formula-based sizing.
 * AI decides WHAT rooms to create; this module decides HOW BIG each should be.
 *
 * Based on: NBC 2016, Neufert Architects' Data, Indian residential practice.
 *
 * Key principles:
 * 1. Bathrooms/utility/pooja are FIXED-size (don't scale with total area)
 * 2. Bedrooms/living/dining SCALE with total area (with diminishing returns)
 * 3. After normalization, HARD CAPS are enforced — no room exceeds its max EVER
 * 4. Comprehensive fuzzy name matching handles any AI-generated room name
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type BuildingType =
  | "apartment" | "villa" | "bungalow" | "duplex" | "row_house"
  | "penthouse" | "studio" | "hostel" | "office" | "farmhouse" | "default";

export interface BuildingContext {
  totalAreaSqm: number;
  bhkCount: number;
  buildingType: BuildingType;
  floorCount: number;
  isVastu: boolean;
}

// ── Area allocation rules ───────────────────────────────────────────────────

interface AreaRule {
  basePct: number;
  min: number;
  max: number;
  scale: "linear" | "sqrt" | "fixed";
}

const RULES: Record<string, AreaRule> = {
  // ── Bedrooms ──
  master_bedroom:    { basePct: 0.15, min: 12.0, max: 22.0, scale: "sqrt" },
  bedroom:           { basePct: 0.12, min: 10.0, max: 18.0, scale: "sqrt" },
  guest_bedroom:     { basePct: 0.10, min: 9.5,  max: 16.0, scale: "sqrt" },

  // ── Bathrooms (FIXED — NEVER scales) ──
  master_bathroom:   { basePct: 0.04, min: 4.0,  max: 6.5,  scale: "fixed" },
  bathroom:          { basePct: 0.03, min: 3.0,  max: 5.5,  scale: "fixed" },
  toilet:            { basePct: 0.02, min: 1.8,  max: 3.5,  scale: "fixed" },
  powder_room:       { basePct: 0.015,min: 1.5,  max: 2.5,  scale: "fixed" },

  // ── Public rooms ──
  living_room:       { basePct: 0.18, min: 14.0, max: 30.0, scale: "sqrt" },
  dining_room:       { basePct: 0.09, min: 8.0,  max: 16.0, scale: "sqrt" },
  drawing_room:      { basePct: 0.12, min: 12.0, max: 22.0, scale: "sqrt" },
  family_room:       { basePct: 0.10, min: 10.0, max: 18.0, scale: "sqrt" },

  // ── Kitchen ──
  kitchen:           { basePct: 0.07, min: 5.5,  max: 12.0, scale: "sqrt" },

  // ── Service (FIXED) ──
  pooja_room:        { basePct: 0.03, min: 3.0,  max: 6.0,  scale: "fixed" },
  utility:           { basePct: 0.03, min: 2.5,  max: 6.0,  scale: "fixed" },
  store_room:        { basePct: 0.02, min: 2.5,  max: 5.0,  scale: "fixed" },
  servant_quarter:   { basePct: 0.04, min: 7.0,  max: 12.0, scale: "fixed" },
  servant_toilet:    { basePct: 0.015,min: 1.8,  max: 3.0,  scale: "fixed" },
  laundry:           { basePct: 0.02, min: 2.5,  max: 5.0,  scale: "fixed" },
  shoe_rack:         { basePct: 0.01, min: 1.0,  max: 3.0,  scale: "fixed" },
  walk_in_closet:    { basePct: 0.03, min: 3.0,  max: 7.0,  scale: "fixed" },

  // ── Circulation ──
  corridor:          { basePct: 0.08, min: 5.0,  max: 18.0, scale: "linear" },
  foyer:             { basePct: 0.04, min: 3.0,  max: 8.0,  scale: "sqrt" },
  lobby:             { basePct: 0.04, min: 4.0,  max: 10.0, scale: "sqrt" },

  // ── Outdoor ──
  balcony:           { basePct: 0.05, min: 3.0,  max: 10.0, scale: "sqrt" },
  verandah:          { basePct: 0.06, min: 5.0,  max: 12.0, scale: "sqrt" },
  terrace:           { basePct: 0.10, min: 8.0,  max: 30.0, scale: "linear" },

  // ── Staircase (FIXED) ──
  staircase:         { basePct: 0.06, min: 6.0,  max: 12.0, scale: "fixed" },

  // ── Parking (excluded from normalization) ──
  parking:           { basePct: 0.00, min: 13.0, max: 18.0, scale: "fixed" },
  garage:            { basePct: 0.00, min: 13.0, max: 18.0, scale: "fixed" },

  // ── Study / Office ──
  study:             { basePct: 0.05, min: 6.0,  max: 10.0, scale: "sqrt" },
  home_office:       { basePct: 0.06, min: 8.0,  max: 14.0, scale: "sqrt" },

  // ── Commercial ──
  reception:         { basePct: 0.08, min: 8.0,  max: 20.0, scale: "sqrt" },
  cabin:             { basePct: 0.06, min: 8.0,  max: 14.0, scale: "sqrt" },
  conference_room:   { basePct: 0.10, min: 12.0, max: 25.0, scale: "sqrt" },
  open_workspace:    { basePct: 0.30, min: 20.0, max: 80.0, scale: "linear" },
  server_room:       { basePct: 0.03, min: 4.0,  max: 8.0,  scale: "fixed" },
  pantry:            { basePct: 0.04, min: 4.0,  max: 10.0, scale: "sqrt" },
  break_room:        { basePct: 0.05, min: 6.0,  max: 12.0, scale: "sqrt" },

  // ── Hostel ──
  hostel_room:       { basePct: 0.00, min: 9.0,  max: 14.0, scale: "fixed" },
  common_room:       { basePct: 0.10, min: 15.0, max: 25.0, scale: "sqrt" },
  warden_room:       { basePct: 0.06, min: 10.0, max: 14.0, scale: "fixed" },

  // ── Specialty ──
  gym:               { basePct: 0.05, min: 8.0,  max: 20.0, scale: "sqrt" },
  home_theater:      { basePct: 0.06, min: 12.0, max: 25.0, scale: "sqrt" },
  library:           { basePct: 0.04, min: 6.0,  max: 14.0, scale: "sqrt" },

  // ── Fallback ──
  custom:            { basePct: 0.05, min: 4.0,  max: 15.0, scale: "sqrt" },
};

// ── Comprehensive fuzzy name classification ─────────────────────────────────

/**
 * Classify a room by its type and name into a canonical room category.
 * Handles every natural language variation an AI might generate.
 */
export function classifyRoom(type: string, name: string): string {
  const t = (type || "").toLowerCase().trim();
  const n = (name || "").toLowerCase().trim();
  const c = `${t} ${n}`; // combined for matching

  // ── BEDROOMS (master/guest first, then generic) ──
  if (/master\s*(bed|suite|room)|main\s*bed/i.test(c)) return "master_bedroom";
  if (/guest\s*(bed|room|suite)/i.test(c)) return "guest_bedroom";
  if (/kid|child|boy|girl|son|daughter/i.test(c) && /bed|room/i.test(c)) return "bedroom";
  if (/bed\s*room|bedroom/i.test(c) || t === "bedroom") return "bedroom";

  // ── BATHROOMS (master/servant/guest first) ──
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

  // ── SERVICE ──
  if (/servant\s*quarter|maid\s*(room|quarter)|domestic\s*help|staff\s*room|driver\s*room/i.test(c)) return "servant_quarter";
  if (/pooja|puja|prayer|mandir|temple/i.test(c) || t === "puja_room") return "pooja_room";
  if (/utility|wash\s*area|washing\s*area/i.test(c) || t === "utility") return "utility";
  if (/laundry/i.test(c)) return "laundry";
  if (/store\s*room|storage\s*room|lumber|box\s*room/i.test(c) || t === "storage" || t === "store_room") return "store_room";
  if (/shoe\s*(rack|area|cabinet|closet|room)|cloak\s*room/i.test(c)) return "shoe_rack";
  if (/walk.in\s*(closet|wardrobe)|wardrobe\s*room|dressing\s*room/i.test(c)) return "walk_in_closet";

  // ── CIRCULATION ──
  if (/corridor|hallway|passage|lobby/i.test(c) || t === "hallway" || t === "corridor") return "corridor";
  if (/foyer|entrance\s*(hall|area)|entry\s*hall/i.test(c) || t === "foyer" || t === "entrance") return "foyer";
  if (/stair|staircase|stairwell/i.test(c) || t === "staircase") return "staircase";

  // ── OUTDOOR ──
  if (/balcony|sit\s*out|sitout/i.test(c) || t === "balcony") return "balcony";
  if (/verandah|veranda|porch|portico/i.test(c)) return "verandah";
  if (/terrace|roof\s*top|roof\s*garden/i.test(c)) return "terrace";
  if (/car\s*park|parking|garage|car\s*port/i.test(c)) return "parking";
  if (/garden|lawn|landscape/i.test(c)) return "parking"; // outdoor, not built-up

  // ── SPECIALTY ──
  if (/study|home\s*office|work\s*room/i.test(c) || t === "study" || t === "home_office") return "study";
  if (/gym|exercise|workout|fitness/i.test(c)) return "gym";
  if (/theater|theatre|media\s*room|home\s*theater/i.test(c)) return "home_theater";
  if (/library|reading\s*room/i.test(c)) return "library";

  // ── COMMERCIAL ──
  if (/reception|front\s*desk|waiting/i.test(c)) return "reception";
  if (/cabin|private\s*office|director/i.test(c) || t === "office") return "cabin";
  if (/conference|meeting|board\s*room/i.test(c)) return "conference_room";
  if (/open\s*(work|office)|workstation/i.test(c)) return "open_workspace";
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

function findRule(type: string, name: string): AreaRule {
  const classified = classifyRoom(type, name);
  return RULES[classified] ?? RULES.custom;
}

// ── Core sizing function ────────────────────────────────────────────────────

function calculateArea(
  type: string,
  name: string,
  perFloorArea: number,
  bhkCount: number,
): number {
  const rule = findRule(type, name);

  let area: number;

  if (rule.scale === "fixed") {
    const t = Math.min(1, Math.max(0, (perFloorArea - 40) / 160));
    area = rule.min + (rule.max - rule.min) * t * 0.5;
  } else if (rule.scale === "sqrt") {
    const refArea = 100;
    const scaledPct = rule.basePct * Math.sqrt(refArea / Math.max(perFloorArea, 30));
    const effectivePct = Math.max(rule.basePct * 0.5, Math.min(rule.basePct, scaledPct));
    area = perFloorArea * effectivePct;
  } else {
    area = perFloorArea * rule.basePct;
  }

  // BHK adjustment for non-master bedrooms
  const classified = classifyRoom(type, name);
  if (classified === "bedroom" && bhkCount > 3) {
    area *= (3 / bhkCount) * 1.1;
  }

  // Master bedroom boost
  if (classified === "master_bedroom") {
    area = Math.max(area, rule.min * 1.1);
  }

  // Clamp to min/max
  area = Math.max(rule.min, Math.min(rule.max, area));

  return Math.round(area * 10) / 10;
}

// ── Normalization: respect fixed/flexible split ─────────────────────────────

function normalizeAreas(
  rooms: Array<{ name: string; type: string; areaSqm: number }>,
  targetTotal: number,
): void {
  // Separate into fixed and flexible
  const isFixed = (r: { name: string; type: string }) => {
    const rule = findRule(r.type, r.name);
    return rule.scale === "fixed";
  };
  const isParking = (r: { name: string; type: string }) => {
    const cls = classifyRoom(r.type, r.name);
    return cls === "parking" || cls === "garage";
  };

  // Exclude parking from target (not counted in built-up area)
  const parkingArea = rooms.filter(isParking).reduce((s, r) => s + r.areaSqm, 0);
  const adjustedTarget = targetTotal - parkingArea;

  const fixedTotal = rooms.filter(r => isFixed(r) && !isParking(r)).reduce((s, r) => s + r.areaSqm, 0);
  const flexRooms = rooms.filter(r => !isFixed(r) && !isParking(r));
  const flexTotal = flexRooms.reduce((s, r) => s + r.areaSqm, 0);

  const flexTarget = adjustedTarget - fixedTotal;
  if (flexTarget <= 0 || flexTotal <= 0) return;

  if (Math.abs(flexTotal - flexTarget) > 2.0) {
    const ratio = flexTarget / flexTotal;
    for (const room of flexRooms) {
      const rule = findRule(room.type, room.name);
      room.areaSqm = Math.max(rule.min, Math.min(rule.max,
        Math.round(room.areaSqm * ratio * 10) / 10
      ));
    }
  }

  // Absorb remainder into the largest flexible room
  const newFlexTotal = flexRooms.reduce((s, r) => s + r.areaSqm, 0);
  const diff = flexTarget - newFlexTotal;
  if (Math.abs(diff) > 1.0 && flexRooms.length > 0) {
    const largest = flexRooms.reduce((a, b) => a.areaSqm > b.areaSqm ? a : b);
    const rule = findRule(largest.type, largest.name);
    largest.areaSqm = Math.max(rule.min, Math.min(rule.max,
      Math.round((largest.areaSqm + diff) * 10) / 10
    ));
  }
}

// ── HARD VALIDATION: absolute caps that NOTHING can override ────────────────

function enforceHardCaps(rooms: Array<{ name: string; type: string; areaSqm: number }>): void {
  for (const room of rooms) {
    const rule = findRule(room.type, room.name);
    // Always enforce min and max from the rule table
    if (room.areaSqm > rule.max) room.areaSqm = rule.max;
    if (room.areaSqm < rule.min) room.areaSqm = rule.min;
    room.areaSqm = Math.round(room.areaSqm * 10) / 10;
  }
}

// ── Building type detection ─────────────────────────────────────────────────

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

// ── Total area extraction from prompt ───────────────────────────────────────

export function extractTotalAreaSqm(prompt: string): number | null {
  const p = prompt.toLowerCase();
  const sqftMatch = p.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|square\s*feet|sqft|sft)/);
  if (sqftMatch) return parseFloat(sqftMatch[1].replace(/,/g, "")) * 0.0929;
  const sqmMatch = p.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*m|square\s*met(?:er|re)s?|sqm)/);
  if (sqmMatch) return parseFloat(sqmMatch[1].replace(/,/g, ""));
  return null;
}

// ── Main entry point ────────────────────────────────────────────────────────

export function applyDeterministicSizing(
  rooms: Array<{ name: string; type: string; areaSqm: number; zone?: string; preferredWidth?: number; preferredDepth?: number }>,
  totalAreaSqm: number,
  prompt: string,
): void {
  if (rooms.length === 0 || totalAreaSqm <= 0) return;

  const bhkCount = detectBHKCount(rooms);
  const floorCount = detectFloorCount(prompt);
  const perFloorArea = totalAreaSqm / Math.max(floorCount, 1);

  // Step 1: Calculate area for each room using formulas
  for (const room of rooms) {
    if (room.preferredWidth && room.preferredWidth > 0 && room.preferredDepth && room.preferredDepth > 0) {
      continue; // user specified exact dimensions
    }
    room.areaSqm = calculateArea(room.type, room.name, perFloorArea, bhkCount);
  }

  // Step 2: Normalize flexible rooms so total matches target
  normalizeAreas(rooms, totalAreaSqm);

  // Step 3: HARD CAPS — enforce absolute min/max regardless of normalization
  enforceHardCaps(rooms);
}
