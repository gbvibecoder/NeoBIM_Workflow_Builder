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
    acceptable_directions: ["E", "S"],
    avoid_directions: ["NE", "SW", "N", "NW"],
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
    penalty_points: 0,
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
    severity: "critical",
    room_types: ["staircase"],
    preferred_directions: ["SW", "S", "W"],
    acceptable_directions: ["NW", "SE"],
    avoid_directions: ["CENTER", "NE", "N", "E"],
    penalty_points: 9,
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
// ADDITIONAL ROOM PLACEMENT RULES (Sprint 5 — expanded for 40+ rules)
// ============================================================

const ADDITIONAL_PLACEMENT_RULES: VastuRule[] = [
  {
    id: "V-RP-014",
    category: "room_placement",
    title: "Guest Room in NW/W",
    description: "Guest rooms should be in the North-West (Vayu direction) for transient occupancy.",
    severity: "minor",
    room_types: ["guest_bedroom"],
    preferred_directions: ["NW", "W"],
    acceptable_directions: ["N", "NE"],
    avoid_directions: ["SW", "SE"],
    penalty_points: 0,
    remedy: "Guest rooms in NW ensure visitors don't overstay — Vayu energy promotes movement.",
  },
  {
    id: "V-RP-015",
    category: "room_placement",
    title: "Drawing/Formal Room in N/NE",
    description: "The formal drawing room should face North or North-East for receiving guests.",
    severity: "minor",
    room_types: ["living_room"],
    preferred_directions: ["N", "NE"],
    acceptable_directions: ["E", "NW"],
    avoid_directions: ["SW", "SE"],
    penalty_points: 0,
    remedy: "Ensure the host seat faces North or East for positive energy during conversations.",
  },
  {
    id: "V-RP-016",
    category: "room_placement",
    title: "Septic Tank in NW",
    description: "Septic tank or sewage treatment should be in the North-West or West direction.",
    severity: "minor",
    room_types: ["utility", "mechanical_room"],
    preferred_directions: ["NW", "W"],
    acceptable_directions: ["N"],
    avoid_directions: ["NE", "SE", "E"],
    penalty_points: 4,
    remedy: "Avoid placing septic tank near water bore or in the Ishan (NE) corner.",
  },
  {
    id: "V-RP-017",
    category: "room_placement",
    title: "Water Tank / Bore Well in NE/N",
    description: "Overhead water tank and bore well should be in the North-East or North.",
    severity: "major",
    room_types: ["utility"],
    preferred_directions: ["NE", "N"],
    acceptable_directions: ["E"],
    avoid_directions: ["SW", "S", "SE"],
    penalty_points: 5,
    remedy: "Place underground water storage in NE. Overhead tank in the NW if NE is not possible.",
  },
  {
    id: "V-RP-018",
    category: "room_placement",
    title: "Home Gym in SW/S",
    description: "The gym or exercise area should be in the South-West for grounding energy.",
    severity: "minor",
    room_types: ["break_room", "custom"],
    preferred_directions: ["SW", "S"],
    acceptable_directions: ["W", "SE"],
    avoid_directions: ["NE", "N"],
    penalty_points: 3,
    remedy: "Face East while exercising for optimal energy alignment.",
  },
  {
    id: "V-RP-019",
    category: "room_placement",
    title: "Servant Quarter in SE/NW",
    description: "Servant quarters should be in the South-East or North-West direction.",
    severity: "minor",
    room_types: ["servant_quarter"],
    preferred_directions: ["SE", "NW"],
    acceptable_directions: ["S", "W"],
    avoid_directions: ["NE", "SW"],
    penalty_points: 2,
    remedy: "Ensure servant quarters have separate entrance from service side.",
  },
  {
    id: "V-RP-020",
    category: "room_placement",
    title: "Treasury/Safe in N/NE",
    description: "The safe or treasury should face North (Kubera — lord of wealth direction).",
    severity: "minor",
    room_types: ["store_room"],
    preferred_directions: ["N", "NE"],
    acceptable_directions: ["E"],
    avoid_directions: ["S", "SW", "SE"],
    penalty_points: 3,
    remedy: "Place the locker/safe against the South wall so it opens towards North.",
  },
  {
    id: "V-RP-021",
    category: "room_placement",
    title: "Meditation Room in NE",
    description: "Meditation and yoga spaces should be in the North-East for spiritual energy.",
    severity: "minor",
    room_types: ["puja_room"],
    preferred_directions: ["NE"],
    acceptable_directions: ["N", "E"],
    avoid_directions: ["S", "SW", "W"],
    penalty_points: 0,
    remedy: "Face East or North during meditation for maximum benefit.",
  },
  {
    id: "V-RP-022",
    category: "room_placement",
    title: "Home Theater in SW/W",
    description: "Entertainment rooms should be in the South-West or West direction.",
    severity: "minor",
    room_types: ["custom"],
    preferred_directions: ["SW", "W"],
    acceptable_directions: ["S", "NW"],
    avoid_directions: ["NE", "E"],
    penalty_points: 2,
    remedy: "Screen should face East, audience faces West for optimal relaxation.",
  },
  {
    id: "V-RP-023",
    category: "room_placement",
    title: "Elevator/Lift in S/SW",
    description: "Elevators should be placed in the South or South-West direction.",
    severity: "minor",
    room_types: ["elevator"],
    preferred_directions: ["S", "SW"],
    acceptable_directions: ["W", "SE"],
    avoid_directions: ["NE", "N"],
    penalty_points: 3,
    remedy: "Avoid placing elevators in the center (Brahmasthan) or North-East corner.",
  },
  {
    id: "V-RP-024",
    category: "room_placement",
    title: "Walk-in Closet in W/SW",
    description: "Walk-in closets and dressing rooms should be in the West or South-West.",
    severity: "minor",
    room_types: ["walk_in_closet", "dressing_room"],
    preferred_directions: ["W", "SW"],
    acceptable_directions: ["NW", "S"],
    avoid_directions: ["NE", "E"],
    penalty_points: 2,
    remedy: "Mirrors in the dressing room should be on the North or East wall.",
  },
  {
    id: "V-RP-025",
    category: "room_placement",
    title: "Swimming Pool in NE/N/E",
    description: "Swimming pools should be in the North-East, North, or East — water element directions.",
    severity: "minor",
    room_types: ["garden", "courtyard"],
    preferred_directions: ["NE", "N", "E"],
    acceptable_directions: ["NW"],
    avoid_directions: ["SW", "S", "SE"],
    penalty_points: 4,
    remedy: "Ensure pool depth increases towards South-West direction.",
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
    severity: "critical",
    room_types: [],
    preferred_directions: ["CENTER"],
    acceptable_directions: [],
    avoid_directions: [],
    penalty_points: 8,
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

// ============================================================
// GENERAL RULES (expanded)
// ============================================================

const GENERAL_RULES: VastuRule[] = [
  {
    id: "V-GN-001",
    category: "general",
    title: "Staircase turns clockwise going up",
    description: "Staircases should turn clockwise when ascending for positive energy flow.",
    severity: "minor",
    room_types: ["staircase"],
    preferred_directions: ["SW", "S", "W"],
    acceptable_directions: ["NW", "SE"],
    avoid_directions: ["NE", "CENTER"],
    penalty_points: 3,
    remedy: "If anti-clockwise, add a Vastu yantra below the first step.",
  },
  {
    id: "V-GN-002",
    category: "general",
    title: "Kitchen stove faces East",
    description: "The cooking stove should be placed so the cook faces East while cooking.",
    severity: "minor",
    room_types: ["kitchen"],
    preferred_directions: ["SE", "E"],
    acceptable_directions: ["S"],
    avoid_directions: ["N", "NE", "W"],
    penalty_points: 3,
    remedy: "Reposition the cooking platform on the East or South wall of the kitchen.",
  },
  {
    id: "V-GN-003",
    category: "general",
    title: "Bed head direction South/East",
    description: "Beds should be positioned with head towards South or East wall.",
    severity: "minor",
    room_types: ["master_bedroom", "bedroom", "guest_bedroom"],
    preferred_directions: ["SW", "S", "SE"],
    acceptable_directions: ["E", "W"],
    avoid_directions: ["N", "NE", "NW"],
    penalty_points: 3,
    remedy: "Reposition bed with headboard against South or East wall. Never sleep with head towards North.",
  },
  {
    id: "V-GN-004",
    category: "general",
    title: "Toilet seat on N-S axis",
    description: "Toilet seats should be oriented on the North-South axis (facing N or S).",
    severity: "info",
    room_types: ["bathroom", "toilet", "wc"],
    preferred_directions: ["NW", "W"],
    acceptable_directions: ["S", "SW"],
    avoid_directions: ["NE", "E"],
    penalty_points: 2,
    remedy: "Orient toilet seat to face North or South. Avoid East-facing toilet seats.",
  },
  {
    id: "V-GN-005",
    category: "general",
    title: "Puja room door — two shutters preferred",
    description: "The prayer room door should ideally have two shutters opening inward.",
    severity: "info",
    room_types: ["puja_room"],
    preferred_directions: ["NE", "N", "E"],
    acceptable_directions: [],
    avoid_directions: ["S", "SW"],
    penalty_points: 2,
    remedy: "Use a double-leaf door for the prayer room, opening towards North-East.",
  },
  {
    id: "V-GN-006",
    category: "general",
    title: "No mirror facing bed",
    description: "Mirrors in bedrooms should not directly face the bed.",
    severity: "info",
    room_types: ["master_bedroom", "bedroom"],
    preferred_directions: [],
    acceptable_directions: [],
    avoid_directions: [],
    penalty_points: 2,
    remedy: "Place dresser/mirror on a wall perpendicular to the bed, not opposite.",
  },
  {
    id: "V-GN-007",
    category: "general",
    title: "Open space in NE",
    description: "Maximum open space should be in the North-East quadrant of the building.",
    severity: "major",
    room_types: [],
    preferred_directions: ["NE"],
    acceptable_directions: ["N", "E"],
    avoid_directions: [],
    penalty_points: 5,
    remedy: "Keep NE corner less built-up. Use for gardens, courtyards, or low structures.",
  },
];

export const ALL_VASTU_RULES: VastuRule[] = [
  ...ROOM_PLACEMENT_RULES,
  ...ADDITIONAL_PLACEMENT_RULES,
  ...ENTRANCE_RULES,
  ...ELEMENT_RULES,
  ...ORIENTATION_RULES,
  ...GENERAL_RULES,
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
