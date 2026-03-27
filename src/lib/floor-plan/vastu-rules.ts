/**
 * Vastu Shastra Compliance Rules
 *
 * Complete ruleset for Vastu Shastra — the ancient Indian science of architecture
 * and spatial arrangement. Rules are based on the 3×3 directional grid (Vastu Purusha Mandala).
 *
 * Directions: NW, N, NE, W, CENTER, E, SW, S, SE
 */

export type VastuDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER";

export type VastuSeverity = "critical" | "major" | "minor" | "info";

export interface VastuRule {
  id: string;
  category: "room_placement" | "entrance" | "orientation" | "element" | "general";
  title: string;
  description: string;
  severity: VastuSeverity;
  /** Room types this rule applies to. Empty = applies to all. */
  room_types: string[];
  /** Preferred directions for this room type */
  preferred_directions: VastuDirection[];
  /** Acceptable (not ideal but okay) directions */
  acceptable_directions: VastuDirection[];
  /** Strictly avoid these directions */
  avoid_directions: VastuDirection[];
  /** Points deducted for violation (0-10 scale) */
  penalty_points: number;
  /** Remedial suggestion if violated */
  remedy: string;
}

// ============================================================
// ROOM PLACEMENT RULES
// ============================================================

const ROOM_PLACEMENT_RULES: VastuRule[] = [
  {
    id: "V-RP-001",
    category: "room_placement",
    title: "Master Bedroom in SW",
    description: "The master bedroom should be in the South-West direction for stability and grounding energy.",
    severity: "critical",
    room_types: ["master_bedroom"],
    preferred_directions: ["SW"],
    acceptable_directions: ["S", "W"],
    avoid_directions: ["NE", "SE", "N"],
    penalty_points: 8,
    remedy: "If relocation isn't possible, place the bed with head towards South wall.",
  },
  {
    id: "V-RP-002",
    category: "room_placement",
    title: "Kitchen in SE",
    description: "The kitchen should be in the South-East (Agni corner) as it represents the fire element.",
    severity: "critical",
    room_types: ["kitchen"],
    preferred_directions: ["SE"],
    acceptable_directions: ["NW", "E"],
    avoid_directions: ["NE", "SW", "N"],
    penalty_points: 8,
    remedy: "Ensure the cooking stove faces East. Use warm colors and proper ventilation.",
  },
  {
    id: "V-RP-003",
    category: "room_placement",
    title: "Living Room in N/NE/E",
    description: "The living room should face North, North-East, or East to receive positive solar energy.",
    severity: "major",
    room_types: ["living_room", "dining_room"],
    preferred_directions: ["N", "NE", "E"],
    acceptable_directions: ["NW", "CENTER"],
    avoid_directions: ["SW", "SE"],
    penalty_points: 6,
    remedy: "Place seating facing North or East. Use light colors and ensure ample natural light.",
  },
  {
    id: "V-RP-004",
    category: "room_placement",
    title: "Bathroom/Toilet in NW/W",
    description: "Bathrooms and toilets should ideally be in the North-West or West direction.",
    severity: "major",
    room_types: ["bathroom", "toilet", "wc"],
    preferred_directions: ["NW", "W"],
    acceptable_directions: ["S", "SW"],
    avoid_directions: ["NE", "E", "N", "CENTER"],
    penalty_points: 6,
    remedy: "Ensure toilet seat faces North-South axis. Keep the area well-ventilated.",
  },
  {
    id: "V-RP-005",
    category: "room_placement",
    title: "Puja Room in NE",
    description: "The prayer/puja room should be in the North-East (Ishan corner) — the most sacred direction.",
    severity: "critical",
    room_types: ["puja_room"],
    preferred_directions: ["NE"],
    acceptable_directions: ["N", "E"],
    avoid_directions: ["S", "SW", "SE", "W"],
    penalty_points: 9,
    remedy: "Face East while praying. Keep the space clean and clutter-free.",
  },
  {
    id: "V-RP-006",
    category: "room_placement",
    title: "Study/Office in N/NE/E/W",
    description: "Study rooms should be in the North, North-East, East, or West for concentration.",
    severity: "minor",
    room_types: ["study", "home_office", "office"],
    preferred_directions: ["N", "NE", "E"],
    acceptable_directions: ["W", "NW"],
    avoid_directions: ["S", "SW", "SE"],
    penalty_points: 4,
    remedy: "Face North or East while studying. Avoid sitting under a beam.",
  },
  {
    id: "V-RP-007",
    category: "room_placement",
    title: "Children's Bedroom in W/NW/N",
    description: "Children's bedrooms are best placed in the West, North-West, or North direction.",
    severity: "minor",
    room_types: ["bedroom", "guest_bedroom"],
    preferred_directions: ["W", "NW", "N"],
    acceptable_directions: ["E", "S"],
    avoid_directions: ["SW", "SE"],
    penalty_points: 4,
    remedy: "Place the bed with head towards South or East wall.",
  },
  {
    id: "V-RP-008",
    category: "room_placement",
    title: "Store Room in SW/NW/W",
    description: "Store rooms should be in the South-West (heavy items) or North-West direction.",
    severity: "minor",
    room_types: ["store_room", "pantry", "walk_in_closet"],
    preferred_directions: ["SW", "NW"],
    acceptable_directions: ["W", "S"],
    avoid_directions: ["NE", "E"],
    penalty_points: 3,
    remedy: "Keep heavy items in the South-West corner of the storage area.",
  },
  {
    id: "V-RP-009",
    category: "room_placement",
    title: "Utility/Laundry in NW",
    description: "Utility and laundry areas should be in the North-West (Vayu corner — wind element).",
    severity: "minor",
    room_types: ["utility", "laundry"],
    preferred_directions: ["NW"],
    acceptable_directions: ["W", "SE"],
    avoid_directions: ["NE", "SW"],
    penalty_points: 3,
    remedy: "Ensure good ventilation in utility areas regardless of placement.",
  },
  {
    id: "V-RP-010",
    category: "room_placement",
    title: "Dining in W/E/N",
    description: "The dining area should be in the West, East, or North portion of the home.",
    severity: "minor",
    room_types: ["dining_room"],
    preferred_directions: ["W", "E"],
    acceptable_directions: ["N", "NW"],
    avoid_directions: ["S", "SE", "SW"],
    penalty_points: 4,
    remedy: "Face East while eating. Place the dining table in the center of the dining area.",
  },
  {
    id: "V-RP-011",
    category: "room_placement",
    title: "Garage in NW/SE",
    description: "The garage or parking should be in the North-West or South-East direction.",
    severity: "minor",
    room_types: ["garage", "parking"],
    preferred_directions: ["NW", "SE"],
    acceptable_directions: ["W", "S"],
    avoid_directions: ["NE", "SW"],
    penalty_points: 3,
    remedy: "Ensure the garage entrance faces North or East if possible.",
  },
  {
    id: "V-RP-012",
    category: "room_placement",
    title: "Staircase not in CENTER/NE",
    description: "Staircases should NOT be in the center (Brahmasthan) or North-East of the building.",
    severity: "major",
    room_types: ["staircase"],
    preferred_directions: ["SW", "S", "W"],
    acceptable_directions: ["NW", "SE"],
    avoid_directions: ["CENTER", "NE", "N", "E"],
    penalty_points: 7,
    remedy: "Stairs should always turn clockwise while going up.",
  },
  {
    id: "V-RP-013",
    category: "room_placement",
    title: "Balcony/Terrace in N/E/NE",
    description: "Balconies and terraces should preferably open towards North, East, or North-East.",
    severity: "minor",
    room_types: ["balcony", "terrace", "verandah"],
    preferred_directions: ["N", "E", "NE"],
    acceptable_directions: ["NW", "SE"],
    avoid_directions: ["SW", "S"],
    penalty_points: 3,
    remedy: "Place plants and water features in the North-East of the balcony.",
  },
];

// ============================================================
// ENTRANCE RULES
// ============================================================

const ENTRANCE_RULES: VastuRule[] = [
  {
    id: "V-EN-001",
    category: "entrance",
    title: "Main Entrance in N/E/NE",
    description: "The main entrance should face North, East, or North-East for maximum positive energy.",
    severity: "critical",
    room_types: [],
    preferred_directions: ["N", "E", "NE"],
    acceptable_directions: ["NW", "SE"],
    avoid_directions: ["S", "SW", "W"],
    penalty_points: 9,
    remedy: "If the entrance faces South/West, use a Vastu pyramid or Swastik symbol at the entrance.",
  },
];

// ============================================================
// GENERAL / ELEMENT RULES
// ============================================================

const ELEMENT_RULES: VastuRule[] = [
  {
    id: "V-EL-001",
    category: "element",
    title: "Water elements in NE",
    description: "Water tanks, fountains, and water bodies should be in the North-East direction.",
    severity: "major",
    room_types: [],
    preferred_directions: ["NE", "N"],
    acceptable_directions: ["E"],
    avoid_directions: ["SW", "SE", "S"],
    penalty_points: 5,
    remedy: "Move water features towards the North-East area of the floor plan.",
  },
  {
    id: "V-EL-002",
    category: "element",
    title: "Heavy structures in SW",
    description: "Heavy furniture, columns, and elevated structures should be in the South-West.",
    severity: "minor",
    room_types: [],
    preferred_directions: ["SW"],
    acceptable_directions: ["S", "W"],
    avoid_directions: ["NE", "N", "E"],
    penalty_points: 3,
    remedy: "Ensure the South-West area has more mass than the North-East.",
  },
  {
    id: "V-EL-003",
    category: "general",
    title: "Center (Brahmasthan) should be open",
    description: "The center of the floor plan (Brahmasthan) should be kept open and free of heavy structures.",
    severity: "major",
    room_types: [],
    preferred_directions: ["CENTER"],
    acceptable_directions: [],
    avoid_directions: [],
    penalty_points: 6,
    remedy: "Remove pillars, heavy walls, or toilets from the center. Keep it as a courtyard or open space.",
  },
];

// ============================================================
// ORIENTATION RULES
// ============================================================

const ORIENTATION_RULES: VastuRule[] = [
  {
    id: "V-OR-001",
    category: "orientation",
    title: "Building aligned to cardinal directions",
    description: "The building should be aligned along the North-South/East-West axis.",
    severity: "minor",
    room_types: [],
    preferred_directions: [],
    acceptable_directions: [],
    avoid_directions: [],
    penalty_points: 4,
    remedy: "If the building is tilted, use interior walls aligned to cardinal directions.",
  },
  {
    id: "V-OR-002",
    category: "orientation",
    title: "North-East should be lowest/lightest",
    description: "The North-East quadrant should have the lowest ground level and least built-up mass.",
    severity: "major",
    room_types: [],
    preferred_directions: ["NE"],
    acceptable_directions: [],
    avoid_directions: [],
    penalty_points: 5,
    remedy: "Avoid heavy structures in the NE. Use this corner for open/garden spaces.",
  },
];

// ============================================================
// EXPORT ALL RULES
// ============================================================

export const ALL_VASTU_RULES: VastuRule[] = [
  ...ROOM_PLACEMENT_RULES,
  ...ENTRANCE_RULES,
  ...ELEMENT_RULES,
  ...ORIENTATION_RULES,
];

/** Get rules applicable to a specific room type */
export function getRulesForRoom(roomType: string): VastuRule[] {
  return ALL_VASTU_RULES.filter(
    (r) => r.room_types.length === 0 || r.room_types.includes(roomType)
  );
}

/** Get rules by category */
export function getRulesByCategory(category: VastuRule["category"]): VastuRule[] {
  return ALL_VASTU_RULES.filter((r) => r.category === category);
}

/** Max possible penalty points */
export const MAX_PENALTY_POINTS = ALL_VASTU_RULES.reduce((sum, r) => sum + r.penalty_points, 0);

/** Direction labels for display */
export const DIRECTION_LABELS: Record<VastuDirection, string> = {
  N: "North",
  NE: "North-East",
  E: "East",
  SE: "South-East",
  S: "South",
  SW: "South-West",
  W: "West",
  NW: "North-West",
  CENTER: "Center",
};

/** Direction angles for compass rendering (0° = North, clockwise) */
export const DIRECTION_ANGLES: Record<VastuDirection, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
  CENTER: -1,
};
