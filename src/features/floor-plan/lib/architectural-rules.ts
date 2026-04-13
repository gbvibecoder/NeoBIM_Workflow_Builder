/**
 * Unified Architectural Rules Table
 *
 * SINGLE SOURCE OF TRUTH for all room dimensions, placement constraints,
 * openings, furniture clearances, and structural requirements.
 *
 * Replaces the fragmented definitions in:
 *   - room-sizer.ts (hard caps)
 *   - room-standards.ts (furniture-derived minimums)
 *   - building-code-rules.ts (NBC 2016 room-size parameters)
 *
 * Every value is sourced from Indian building codes and international standards:
 *   - NBC 2016 (National Building Code of India) — room sizes, corridors, openings
 *   - IS:SP7 (NBC explanatory handbook)
 *   - IS:1905 (structural masonry) — wall thickness
 *   - IS:962 (doors) — door sizes and swing clearances
 *   - IS:1038 (windows) — window sizes and ventilation
 *   - IS:456 (reinforced concrete) — slab span limits
 *   - IS:1893 (seismic design) — shear wall requirements
 *   - Neufert Architects' Data (international) — furniture clearances, room proportions
 *   - NBC Part 4 (fire safety) — escape routes, travel distances
 *   - NBC Part 3 (development control) — setbacks, FAR, coverage
 *   - Harmonised Guidelines for PWD (accessibility) — wheelchair clearances
 */

// ============================================================
// TYPES
// ============================================================

export type RoomCategory = 'habitable' | 'wet' | 'circulation' | 'service' | 'outdoor' | 'parking';
export type RoomZone = 'public' | 'private' | 'service' | 'circulation' | 'outdoor';
export type ExteriorWallRequirement = 'required' | 'preferred' | 'not_required';
export type DoorSwingType = 'inward' | 'outward' | 'sliding' | 'any';
export type VerticalAlignmentType = 'strict' | 'preferred' | 'none';
export type LoadBearingType = 'required' | 'optional';

export interface RoomRule {
  /** Canonical room type identifier */
  type: string;
  /** Human-readable display name */
  displayName: string;
  /** Functional category */
  category: RoomCategory;
  /** Zoning classification */
  zone: RoomZone;

  /** Area constraints (sqm) — THE single source of truth */
  area: { min: number; max: number; default: number; unit: 'sqm' };
  /** Minimum clear internal width (m) */
  width: { min: number; unit: 'm' };
  /** Minimum clear internal depth (m) */
  depth: { min: number; unit: 'm' };
  /** Maximum width:depth aspect ratio */
  aspectRatio: { max: number };
  /** Minimum ceiling height — NBC §8.4 */
  ceilingHeight: { min: number; unit: 'mm' };

  /** Exterior wall placement constraint */
  exteriorWall: ExteriorWallRequirement;
  /** Required adjacencies (room types) */
  adjacentTo: string[];
  /** Preferred (soft) adjacencies */
  preferredAdjacent: string[];
  /** Should not be adjacent to these room types */
  awayFrom: string[];

  /** Door specification */
  doors: {
    minWidth: number;         // mm — clear opening
    preferredWidth: number;   // mm
    swing: DoorSwingType;
    minFromCorner: number;    // mm
    swingClearance: number;   // mm — clear arc radius
  };
  /** Window specification */
  windows: {
    required: boolean;
    minFloorAreaRatio: number;    // NBC: 1/10 for habitable
    targetFloorAreaRatio: number; // IS:1038 ideal: 1/6
    minSillHeight: number;        // mm from floor
    maxSillHeight: number;        // mm (egress: max 1000 in bedrooms)
    minFromCorner: number;        // mm
  };

  /** Furniture clearance requirements */
  furniture: {
    required: string[];
    clearances: Record<string, number>; // mm
  };

  /** Structural constraints */
  structural: {
    maxSpan: number;          // meters — max unsupported slab span
    canHaveColumns: boolean;
    loadBearing: LoadBearingType;
  };

  /** Multi-floor vertical alignment */
  verticalAlignment: VerticalAlignmentType;
  /** Room types allowed above this room */
  stackableAbove: string[];
  /** Room types allowed below this room */
  stackableBelow: string[];

  /** Code reference string */
  codeRef: string;
}

// ============================================================
// DEFAULT TEMPLATES (reduce repetition)
// ============================================================

const HABITABLE_DEFAULTS: Pick<RoomRule,
  'ceilingHeight' | 'doors' | 'windows' | 'structural' | 'verticalAlignment' | 'stackableAbove' | 'stackableBelow'
> = {
  ceilingHeight: { min: 2750, unit: 'mm' }, // NBC §8.4.1
  doors: {
    minWidth: 900, preferredWidth: 900,
    swing: 'inward', minFromCorner: 200, swingClearance: 900,
  },
  windows: {
    required: true,
    minFloorAreaRatio: 0.10,    // NBC §8.4.6
    targetFloorAreaRatio: 0.167, // IS:1038 ≈ 1/6
    minSillHeight: 600, maxSillHeight: 1000,
    minFromCorner: 600,
  },
  structural: { maxSpan: 5.0, canHaveColumns: false, loadBearing: 'optional' },
  verticalAlignment: 'none',
  stackableAbove: [],
  stackableBelow: [],
};

const WET_DEFAULTS: Pick<RoomRule,
  'ceilingHeight' | 'doors' | 'windows' | 'structural' | 'verticalAlignment' | 'stackableAbove' | 'stackableBelow'
> = {
  ceilingHeight: { min: 2400, unit: 'mm' }, // NBC §8.4.3 — can be lower
  doors: {
    minWidth: 600, preferredWidth: 750,
    swing: 'outward', minFromCorner: 200, swingClearance: 750,
  },
  windows: {
    required: false,
    minFloorAreaRatio: 0,
    targetFloorAreaRatio: 0,
    minSillHeight: 1200, maxSillHeight: 1800,
    minFromCorner: 600,
  },
  structural: { maxSpan: 5.0, canHaveColumns: false, loadBearing: 'optional' },
  verticalAlignment: 'strict', // wet stacks must align across floors
  stackableAbove: ['bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath', 'servant_toilet', 'kitchen', 'utility', 'laundry'],
  stackableBelow: ['bathroom', 'master_bathroom', 'toilet', 'powder_room', 'half_bath', 'servant_toilet', 'kitchen', 'utility', 'laundry'],
};

const CIRCULATION_DEFAULTS: Pick<RoomRule,
  'ceilingHeight' | 'doors' | 'windows' | 'structural' | 'verticalAlignment' | 'stackableAbove' | 'stackableBelow'
> = {
  ceilingHeight: { min: 2750, unit: 'mm' },
  doors: {
    minWidth: 900, preferredWidth: 1000,
    swing: 'any', minFromCorner: 200, swingClearance: 900,
  },
  windows: {
    required: false,
    minFloorAreaRatio: 0,
    targetFloorAreaRatio: 0,
    minSillHeight: 900, maxSillHeight: 1200,
    minFromCorner: 600,
  },
  structural: { maxSpan: 5.0, canHaveColumns: false, loadBearing: 'optional' },
  verticalAlignment: 'none',
  stackableAbove: [],
  stackableBelow: [],
};

// ============================================================
// ROOM RULES — RESIDENTIAL
// ============================================================

const RESIDENTIAL_RULES: RoomRule[] = [
  // ── BEDROOMS ──
  {
    type: 'master_bedroom', displayName: 'Master Bedroom',
    category: 'habitable', zone: 'private',
    area: { min: 12.0, max: 25.0, default: 15.0, unit: 'sqm' }, // NBC §8.4.1 — habitable min 9.5, master typically larger
    width: { min: 3.2, unit: 'm' },  // King bed(1950) + side(600×2) = 3150 → 3200
    depth: { min: 3.6, unit: 'm' },  // Bed(2050) + front(700) + wardrobe(600) + gap(200) = 3550 → 3600
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: ['master_bathroom'],
    preferredAdjacent: ['walk_in_closet', 'dressing_room', 'balcony'],
    awayFrom: ['kitchen', 'staircase', 'parking'],
    ...HABITABLE_DEFAULTS,
    windows: {
      ...HABITABLE_DEFAULTS.windows,
      maxSillHeight: 1000, // egress requirement — NBC
    },
    furniture: {
      required: ['king_bed', 'wardrobe', 'nightstand'],
      clearances: { bedSide: 600, bedFoot: 900, wardrobeFront: 700 },
    },
    codeRef: 'NBC 2016 §8.4.1, IS:SP7, Neufert Ch.32',
  },
  {
    type: 'bedroom', displayName: 'Bedroom',
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 20.0, default: 12.0, unit: 'sqm' }, // NBC §8.4.1
    width: { min: 2.8, unit: 'm' },  // Queen bed(1650) + side(600×2) = 2850
    depth: { min: 3.0, unit: 'm' },  // Bed(2050) + front(700) + wall = 3000
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['bathroom', 'corridor'],
    awayFrom: ['kitchen', 'parking'],
    ...HABITABLE_DEFAULTS,
    windows: {
      ...HABITABLE_DEFAULTS.windows,
      maxSillHeight: 1000,
    },
    furniture: {
      required: ['queen_bed', 'wardrobe'],
      clearances: { bedSide: 600, bedFoot: 700, wardrobeFront: 600 },
    },
    codeRef: 'NBC 2016 §8.4.1, Neufert Ch.32',
  },
  {
    type: 'guest_bedroom', displayName: 'Guest Bedroom',
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 16.0, default: 11.0, unit: 'sqm' },
    width: { min: 2.6, unit: 'm' },
    depth: { min: 2.8, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['bathroom', 'corridor'],
    awayFrom: ['kitchen', 'parking'],
    ...HABITABLE_DEFAULTS,
    windows: { ...HABITABLE_DEFAULTS.windows, maxSillHeight: 1000 },
    furniture: {
      required: ['single_bed', 'wardrobe'],
      clearances: { bedSide: 500, bedFoot: 600, wardrobeFront: 600 },
    },
    codeRef: 'NBC 2016 §8.4.1',
  },
  {
    type: 'children_bedroom', displayName: "Children's Bedroom",
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 16.0, default: 11.0, unit: 'sqm' },
    width: { min: 2.6, unit: 'm' },
    depth: { min: 2.8, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['bathroom', 'corridor'],
    awayFrom: ['kitchen', 'staircase'],
    ...HABITABLE_DEFAULTS,
    windows: { ...HABITABLE_DEFAULTS.windows, maxSillHeight: 1000 },
    furniture: {
      required: ['single_bed', 'study_desk', 'wardrobe'],
      clearances: { bedSide: 500, deskFront: 800 },
    },
    codeRef: 'NBC 2016 §8.4.1',
  },

  // ── PUBLIC / LIVING AREAS ──
  {
    type: 'living_room', displayName: 'Living Room',
    category: 'habitable', zone: 'public',
    area: { min: 12.0, max: 35.0, default: 16.0, unit: 'sqm' }, // NBC §8.4.1
    width: { min: 3.2, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },  // Sofa(900) + coffee table + TV viewing distance
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['dining_room'],
    preferredAdjacent: ['foyer', 'entrance_lobby', 'balcony'],
    awayFrom: ['servant_quarter', 'servant_toilet'],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 900, preferredWidth: 1000, swing: 'inward', minFromCorner: 200, swingClearance: 1000 },
    furniture: {
      required: ['sofa_3seat', 'coffee_table', 'tv_unit'],
      clearances: { sofaFront: 800, tvDistance: 2400 },
    },
    codeRef: 'NBC 2016 §8.4.1, Neufert Ch.31',
  },
  {
    type: 'dining_room', displayName: 'Dining Room',
    category: 'habitable', zone: 'public',
    area: { min: 9.5, max: 18.0, default: 10.0, unit: 'sqm' }, // NBC §8.4.1 — habitable room min 9.5 sqm
    width: { min: 2.8, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: ['kitchen'],
    preferredAdjacent: ['living_room'],
    awayFrom: ['bathroom', 'toilet'],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['dining_table_6seat'],
      clearances: { chairPullback: 800, sidePassage: 600 },
    },
    codeRef: 'NBC 2016 §8.4.1, Neufert Ch.33',
  },
  {
    type: 'drawing_room', displayName: 'Drawing Room',
    category: 'habitable', zone: 'public',
    area: { min: 12.0, max: 25.0, default: 15.0, unit: 'sqm' },
    width: { min: 3.2, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['foyer', 'dining_room'],
    awayFrom: ['kitchen', 'servant_quarter'],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['sofa_3seat', 'accent_chairs'],
      clearances: { sofaFront: 800, sidePassage: 600 },
    },
    codeRef: 'NBC 2016 §8.4.1',
  },
  {
    type: 'family_room', displayName: 'Family Room',
    category: 'habitable', zone: 'private',
    area: { min: 10.0, max: 22.0, default: 14.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.2, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['dining_room', 'kitchen'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['sofa_3seat', 'tv_unit'],
      clearances: { sofaFront: 800 },
    },
    codeRef: 'NBC 2016 §8.4.1',
  },

  // ── KITCHEN ──
  {
    type: 'kitchen', displayName: 'Kitchen',
    category: 'habitable', zone: 'service',
    area: { min: 5.0, max: 16.0, default: 8.0, unit: 'sqm' }, // NBC §8.4.2
    width: { min: 2.2, unit: 'm' },  // Counter(600) + aisle(1000) + opposite(600)
    depth: { min: 2.8, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required', // ventilation + exhaust
    adjacentTo: ['dining_room'],
    preferredAdjacent: ['utility', 'pantry_kitchen', 'store_room'],
    awayFrom: ['bathroom', 'toilet', 'bedroom'],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 800, preferredWidth: 900, swing: 'inward', minFromCorner: 200, swingClearance: 800 },
    windows: {
      required: true,
      minFloorAreaRatio: 0.10,
      targetFloorAreaRatio: 0.167,
      minSillHeight: 900, maxSillHeight: 1050, // above counter
      minFromCorner: 600,
    },
    furniture: {
      required: ['kitchen_counter', 'sink', 'stove'],
      clearances: { workingAisle: 1000, counterFront: 800 },
    },
    codeRef: 'NBC 2016 §8.4.2, IS:1038, Neufert Ch.34',
  },
  {
    type: 'modular_kitchen', displayName: 'Modular Kitchen',
    category: 'habitable', zone: 'service',
    area: { min: 6.0, max: 18.0, default: 9.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['dining_room'],
    preferredAdjacent: ['utility'],
    awayFrom: ['bathroom', 'toilet'],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 800, preferredWidth: 900, swing: 'inward', minFromCorner: 200, swingClearance: 800 },
    windows: {
      required: true, minFloorAreaRatio: 0.10, targetFloorAreaRatio: 0.167,
      minSillHeight: 900, maxSillHeight: 1050, minFromCorner: 600,
    },
    furniture: {
      required: ['kitchen_counter', 'sink', 'stove', 'chimney'],
      clearances: { workingAisle: 1000, counterFront: 800 },
    },
    codeRef: 'NBC 2016 §8.4.2',
  },
  {
    type: 'pantry_kitchen', displayName: 'Pantry / Kitchen Annex',
    category: 'service', zone: 'service',
    area: { min: 3.0, max: 8.0, default: 4.5, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'preferred',
    adjacentTo: ['kitchen'],
    preferredAdjacent: [],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 750, preferredWidth: 800, swing: 'inward', minFromCorner: 200, swingClearance: 750 },
    windows: {
      required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0,
      minSillHeight: 900, maxSillHeight: 1200, minFromCorner: 600,
    },
    furniture: { required: ['shelving'], clearances: { shelfFront: 600 } },
    codeRef: 'NBC 2016 §8.4.2',
  },

  // ── BATHROOMS / WET AREAS ──
  {
    type: 'bathroom', displayName: 'Bathroom',
    category: 'wet', zone: 'service',
    area: { min: 1.8, max: 5.5, default: 3.5, unit: 'sqm' }, // NBC §8.4.3 — combined bath+WC = 2.8 sqm min
    width: { min: 1.5, unit: 'm' },  // Toilet(400) + gap(200) + basin(600) + gap(300)
    depth: { min: 2.1, unit: 'm' },  // Shower(900) + clearance(500) + toilet(700)
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['bedroom', 'corridor'],
    awayFrom: ['kitchen', 'dining_room'],
    ...WET_DEFAULTS,
    furniture: {
      required: ['wc', 'wash_basin', 'shower'],
      clearances: { wcFront: 600, basinFront: 700, showerClear: 900 },
    },
    codeRef: 'NBC 2016 §8.4.3, IS:SP7',
  },
  {
    type: 'master_bathroom', displayName: 'Master Bathroom',
    category: 'wet', zone: 'service',
    area: { min: 3.5, max: 7.0, default: 4.5, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: ['master_bedroom'],
    preferredAdjacent: [],
    awayFrom: ['kitchen', 'dining_room'],
    ...WET_DEFAULTS,
    furniture: {
      required: ['wc', 'wash_basin', 'shower', 'bathtub'],
      clearances: { wcFront: 600, basinFront: 700, bathtubSide: 500 },
    },
    codeRef: 'NBC 2016 §8.4.3',
  },
  {
    type: 'toilet', displayName: 'Toilet / WC',
    category: 'wet', zone: 'service',
    area: { min: 1.1, max: 3.5, default: 1.5, unit: 'sqm' }, // NBC §8.4.3 — individual WC = 1.1 sqm
    width: { min: 1.0, unit: 'm' },
    depth: { min: 1.2, unit: 'm' },
    aspectRatio: { max: 2.2 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: ['kitchen', 'dining_room'],
    ...WET_DEFAULTS,
    furniture: {
      required: ['wc', 'wash_basin'],
      clearances: { wcFront: 600, basinFront: 600 },
    },
    codeRef: 'NBC 2016 §8.4.3',
  },
  {
    type: 'powder_room', displayName: 'Powder Room',
    category: 'wet', zone: 'service',
    area: { min: 1.5, max: 3.0, default: 2.0, unit: 'sqm' },
    width: { min: 1.0, unit: 'm' },
    depth: { min: 1.5, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['foyer', 'living_room', 'corridor'],
    awayFrom: ['kitchen'],
    ...WET_DEFAULTS,
    furniture: {
      required: ['wc', 'wash_basin'],
      clearances: { wcFront: 600, basinFront: 600 },
    },
    codeRef: 'NBC 2016 §8.4.3',
  },
  {
    type: 'half_bath', displayName: 'Half Bath',
    category: 'wet', zone: 'service',
    area: { min: 1.5, max: 3.0, default: 2.0, unit: 'sqm' },
    width: { min: 1.0, unit: 'm' },
    depth: { min: 1.5, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: ['kitchen'],
    ...WET_DEFAULTS,
    furniture: { required: ['wc', 'wash_basin'], clearances: { wcFront: 600 } },
    codeRef: 'NBC 2016 §8.4.3',
  },

  // ── CIRCULATION ──
  {
    type: 'corridor', displayName: 'Corridor',
    category: 'circulation', zone: 'circulation',
    area: { min: 2.0, max: 20.0, default: 5.0, unit: 'sqm' },
    width: { min: 1.05, unit: 'm' },  // NBC §8.5.1 residential min 1.0m + margin
    depth: { min: 1.2, unit: 'm' },
    aspectRatio: { max: 8.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    furniture: { required: [], clearances: { passageWidth: 1050 } },
    codeRef: 'NBC 2016 §8.5.1',
  },
  {
    type: 'hallway', displayName: 'Hallway',
    category: 'circulation', zone: 'circulation',
    area: { min: 2.0, max: 15.0, default: 4.0, unit: 'sqm' },
    width: { min: 1.05, unit: 'm' },
    depth: { min: 1.2, unit: 'm' },
    aspectRatio: { max: 8.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    furniture: { required: [], clearances: { passageWidth: 1050 } },
    codeRef: 'NBC 2016 §8.5.1',
  },
  {
    type: 'passage', displayName: 'Passage',
    category: 'circulation', zone: 'circulation',
    area: { min: 1.5, max: 10.0, default: 3.0, unit: 'sqm' },
    width: { min: 0.9, unit: 'm' },
    depth: { min: 1.0, unit: 'm' },
    aspectRatio: { max: 8.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    furniture: { required: [], clearances: { passageWidth: 900 } },
    codeRef: 'NBC 2016 §8.5.1',
  },
  {
    type: 'foyer', displayName: 'Foyer',
    category: 'circulation', zone: 'public',
    area: { min: 3.0, max: 10.0, default: 5.0, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['living_room'],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    doors: { minWidth: 1000, preferredWidth: 1050, swing: 'inward', minFromCorner: 300, swingClearance: 1050 },
    furniture: { required: ['shoe_cabinet'], clearances: { entrySpace: 1500 } },
    codeRef: 'NBC 2016 §8.5.1',
  },
  {
    type: 'entrance_lobby', displayName: 'Entrance Lobby',
    category: 'circulation', zone: 'public',
    area: { min: 3.0, max: 12.0, default: 5.0, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['living_room', 'drawing_room'],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    doors: { minWidth: 1000, preferredWidth: 1050, swing: 'inward', minFromCorner: 300, swingClearance: 1050 },
    furniture: { required: [], clearances: { entrySpace: 1500 } },
    codeRef: 'NBC 2016 §8.5.1',
  },
  {
    type: 'staircase', displayName: 'Staircase',
    category: 'circulation', zone: 'circulation',
    area: { min: 6.0, max: 14.0, default: 8.0, unit: 'sqm' },
    width: { min: 0.9, unit: 'm' },   // NBC §8.6.1 stair width min 900mm
    depth: { min: 2.4, unit: 'm' },   // Minimum for straight-run with landing
    aspectRatio: { max: 3.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor', 'foyer'],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    ceilingHeight: { min: 2200, unit: 'mm' }, // headroom
    structural: { maxSpan: 5.0, canHaveColumns: false, loadBearing: 'required' },
    verticalAlignment: 'strict', // MUST align across floors
    stackableAbove: ['staircase'],
    stackableBelow: ['staircase'],
    furniture: { required: [], clearances: { headroom: 2200, landingDepth: 900 } },
    codeRef: 'NBC 2016 §8.6.1-8.6.3',
  },
  {
    type: 'lift', displayName: 'Lift / Elevator',
    category: 'circulation', zone: 'circulation',
    area: { min: 3.0, max: 8.0, default: 4.0, unit: 'sqm' },
    width: { min: 1.6, unit: 'm' },  // Min 1600mm clear internal
    depth: { min: 1.4, unit: 'm' },  // Min 1400mm clear internal
    aspectRatio: { max: 1.5 },
    exteriorWall: 'not_required',
    adjacentTo: ['staircase'],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    structural: { maxSpan: 3.0, canHaveColumns: false, loadBearing: 'required' },
    verticalAlignment: 'strict',
    stackableAbove: ['lift'],
    stackableBelow: ['lift'],
    furniture: { required: [], clearances: { pitDepth: 2000, overheadClear: 3600 } },
    codeRef: 'NBC 2016 §8.6, IS:14665',
  },

  // ── OUTDOOR ──
  {
    type: 'balcony', displayName: 'Balcony',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 3.0, max: 12.0, default: 4.0, unit: 'sqm' },
    width: { min: 1.2, unit: 'm' },  // NBC min balcony depth 1200mm
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 4.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['living_room', 'master_bedroom'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    doors: { minWidth: 900, preferredWidth: 1800, swing: 'sliding', minFromCorner: 200, swingClearance: 900 },
    furniture: { required: [], clearances: { railingHeight: 1050 } },
    verticalAlignment: 'preferred',
    stackableAbove: ['balcony'],
    stackableBelow: ['balcony'],
    codeRef: 'NBC 2016 §4.5, Neufert',
  },
  {
    type: 'verandah', displayName: 'Verandah',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 4.0, max: 15.0, default: 6.0, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 4.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['living_room', 'foyer'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    doors: { minWidth: 900, preferredWidth: 1500, swing: 'sliding', minFromCorner: 200, swingClearance: 900 },
    furniture: { required: [], clearances: { railingHeight: 1050 } },
    codeRef: 'NBC 2016 §4.5',
  },
  {
    type: 'terrace', displayName: 'Terrace',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 6.0, max: 50.0, default: 12.0, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 4.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: [], clearances: { railingHeight: 1050 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'sit_out', displayName: 'Sit Out',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 2.0, max: 8.0, default: 3.5, unit: 'sqm' },
    width: { min: 1.2, unit: 'm' },
    depth: { min: 1.5, unit: 'm' },
    aspectRatio: { max: 3.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['bedroom', 'living_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: [], clearances: {} },
    codeRef: 'NBC 2016',
  },

  // ── SERVICE ROOMS ──
  {
    type: 'utility', displayName: 'Utility Room',
    category: 'service', zone: 'service',
    area: { min: 2.5, max: 6.0, default: 3.5, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 2.2 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['kitchen', 'bathroom'],
    awayFrom: [],
    ...WET_DEFAULTS,
    verticalAlignment: 'preferred',
    furniture: {
      required: ['washing_machine'],
      clearances: { machineFront: 800, dryingSpace: 600 },
    },
    codeRef: 'NBC 2016',
  },
  {
    type: 'laundry', displayName: 'Laundry',
    category: 'service', zone: 'service',
    area: { min: 2.5, max: 5.0, default: 3.5, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 2.2 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['kitchen', 'utility'],
    awayFrom: [],
    ...WET_DEFAULTS,
    furniture: {
      required: ['washing_machine'],
      clearances: { machineFront: 800 },
    },
    codeRef: 'NBC 2016',
  },
  {
    type: 'store_room', displayName: 'Store Room',
    category: 'service', zone: 'service',
    area: { min: 2.5, max: 6.0, default: 3.5, unit: 'sqm' },
    width: { min: 1.2, unit: 'm' },
    depth: { min: 1.5, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['kitchen', 'corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2400, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 900, maxSillHeight: 1200, minFromCorner: 600 },
    furniture: { required: ['shelving'], clearances: { shelfFront: 600 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'pooja_room', displayName: 'Pooja Room',
    category: 'habitable', zone: 'private',
    area: { min: 2.5, max: 6.0, default: 3.5, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 2.1, unit: 'm' },
    aspectRatio: { max: 1.5 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['kitchen', 'living_room'],
    awayFrom: ['bathroom', 'toilet'],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 750, preferredWidth: 900, swing: 'inward', minFromCorner: 200, swingClearance: 750 },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0.10, minSillHeight: 900, maxSillHeight: 1200, minFromCorner: 600 },
    furniture: {
      required: ['mandir'],
      clearances: { sittingSpace: 1200, mandirDepth: 600 },
    },
    codeRef: 'Indian Residential Practice, Vastu Shastra',
  },
  {
    type: 'walk_in_closet', displayName: 'Walk-in Closet',
    category: 'service', zone: 'private',
    area: { min: 3.0, max: 7.0, default: 4.0, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 1.8, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: ['master_bedroom'],
    preferredAdjacent: [],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2400, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 900, maxSillHeight: 1200, minFromCorner: 600 },
    doors: { minWidth: 750, preferredWidth: 900, swing: 'inward', minFromCorner: 200, swingClearance: 750 },
    furniture: { required: ['wardrobe_rack'], clearances: { aisleClear: 900 } },
    codeRef: 'Neufert Ch.32',
  },
  {
    type: 'dressing_room', displayName: 'Dressing Room',
    category: 'service', zone: 'private',
    area: { min: 3.5, max: 8.0, default: 5.0, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 2.1, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: ['master_bedroom'],
    preferredAdjacent: ['master_bathroom'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 900, maxSillHeight: 1200, minFromCorner: 600 },
    furniture: { required: ['wardrobe_rack', 'mirror'], clearances: { mirrorDistance: 900 } },
    codeRef: 'Neufert Ch.32',
  },
  {
    type: 'servant_quarter', displayName: 'Servant Quarter',
    category: 'habitable', zone: 'service',
    area: { min: 9.5, max: 12.0, default: 9.5, unit: 'sqm' }, // NBC §8.4.1 — habitable room min 9.5 sqm
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.7, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: ['servant_toilet'],
    preferredAdjacent: ['kitchen', 'utility'],
    awayFrom: ['living_room', 'master_bedroom'],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['single_bed', 'wardrobe'],
      clearances: { bedSide: 500 },
    },
    codeRef: 'NBC 2016 §8.4.1, Indian Residential Practice',
  },
  {
    type: 'servant_toilet', displayName: 'Servant Toilet',
    category: 'wet', zone: 'service',
    area: { min: 1.5, max: 3.0, default: 2.0, unit: 'sqm' },
    width: { min: 1.0, unit: 'm' },
    depth: { min: 1.2, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: ['servant_quarter'],
    preferredAdjacent: [],
    awayFrom: ['kitchen'],
    ...WET_DEFAULTS,
    furniture: { required: ['wc', 'wash_basin'], clearances: { wcFront: 600 } },
    codeRef: 'NBC 2016 §8.4.3',
  },
  {
    type: 'shoe_rack', displayName: 'Shoe Rack / Mud Room',
    category: 'service', zone: 'circulation',
    area: { min: 1.0, max: 3.0, default: 1.5, unit: 'sqm' },
    width: { min: 0.8, unit: 'm' },
    depth: { min: 1.0, unit: 'm' },
    aspectRatio: { max: 3.0 },
    exteriorWall: 'not_required',
    adjacentTo: ['foyer'],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    furniture: { required: ['shoe_cabinet'], clearances: { cabinetFront: 600 } },
    codeRef: 'Indian Residential Practice',
  },
  {
    type: 'mud_room', displayName: 'Mud Room',
    category: 'service', zone: 'circulation',
    area: { min: 1.5, max: 4.0, default: 2.5, unit: 'sqm' },
    width: { min: 1.0, unit: 'm' },
    depth: { min: 1.2, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['foyer'],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    furniture: { required: ['shoe_cabinet', 'coat_hooks'], clearances: { cabinetFront: 600 } },
    codeRef: 'Neufert',
  },

  // ── STUDY / WORK ──
  {
    type: 'home_office', displayName: 'Home Office',
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 16.0, default: 10.0, unit: 'sqm' }, // NBC §8.4.1 — habitable room min 9.5 sqm
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.8, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: ['kitchen', 'living_room'],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['desk', 'office_chair', 'bookshelf'],
      clearances: { deskFront: 800, chairRollback: 900 },
    },
    codeRef: 'NBC 2016 §8.4.1, Neufert Ch.38',
  },
  {
    type: 'study', displayName: 'Study',
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 14.0, default: 9.5, unit: 'sqm' }, // NBC §8.4.1 — habitable room min 9.5 sqm
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.7, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor', 'bedroom'],
    awayFrom: ['kitchen'],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['desk', 'chair', 'bookshelf'],
      clearances: { deskFront: 800, chairRollback: 900, bookshelfFront: 350 },
    },
    codeRef: 'NBC 2016 §8.4.1, Neufert Ch.38',
  },
  {
    type: 'library', displayName: 'Library',
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 16.0, default: 10.0, unit: 'sqm' }, // NBC §8.4.1 — habitable room min 9.5 sqm
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.7, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['study'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: {
      required: ['bookshelf', 'reading_chair'],
      clearances: { aisleWidth: 900, readingSpace: 800 },
    },
    codeRef: 'Neufert Ch.38',
  },

  // ── RECREATION ──
  {
    type: 'gym', displayName: 'Gym / Exercise Room',
    category: 'habitable', zone: 'private',
    area: { min: 9.5, max: 25.0, default: 12.0, unit: 'sqm' }, // NBC §8.4.1 — habitable room min 9.5 sqm
    width: { min: 2.4, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['bathroom'],
    awayFrom: ['bedroom'],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2750, unit: 'mm' },
    furniture: {
      required: ['exercise_mat'],
      clearances: { equipmentSpace: 1500, mirrorDistance: 1200 },
    },
    codeRef: 'Neufert',
  },
  {
    type: 'home_theater', displayName: 'Home Theater / Media Room',
    category: 'habitable', zone: 'private',
    area: { min: 12.0, max: 30.0, default: 18.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 4.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required', // sound isolation — no exterior windows preferred
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: ['bedroom'],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: {
      required: ['screen', 'seating'],
      clearances: { viewingDistance: 3000, seatSpacing: 900 },
    },
    codeRef: 'Neufert',
  },
  {
    type: 'media_room', displayName: 'Media Room',
    category: 'habitable', zone: 'private',
    area: { min: 10.0, max: 25.0, default: 15.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.5, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: ['bedroom'],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: ['sofa', 'screen'], clearances: { viewingDistance: 2500 } },
    codeRef: 'Neufert',
  },
  {
    type: 'wine_cellar', displayName: 'Wine Cellar',
    category: 'service', zone: 'private',
    area: { min: 4.0, max: 12.0, default: 6.0, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['dining_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2400, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: ['wine_rack'], clearances: { rackFront: 600 } },
    codeRef: 'Neufert',
  },

  // ── PARKING ──
  {
    type: 'garage', displayName: 'Garage',
    category: 'parking', zone: 'service',
    area: { min: 15.0, max: 40.0, default: 18.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 5.5, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['foyer'],
    awayFrom: ['bedroom', 'living_room'],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2400, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    doors: { minWidth: 2400, preferredWidth: 2700, swing: 'sliding', minFromCorner: 200, swingClearance: 2400 },
    furniture: { required: [], clearances: { carDoorClear: 900, carFront: 500 } },
    codeRef: 'NBC 2016 Part 3',
  },
  {
    type: 'parking', displayName: 'Parking / Car Porch',
    category: 'parking', zone: 'service',
    area: { min: 15.0, max: 40.0, default: 18.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 5.5, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['foyer', 'staircase'],
    awayFrom: ['bedroom'],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2400, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    doors: { minWidth: 2400, preferredWidth: 2700, swing: 'sliding', minFromCorner: 200, swingClearance: 2400 },
    furniture: { required: [], clearances: { carDoorClear: 900 } },
    codeRef: 'NBC 2016 Part 3',
  },
  {
    type: 'car_porch', displayName: 'Car Porch',
    category: 'parking', zone: 'outdoor',
    area: { min: 12.0, max: 30.0, default: 15.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 5.0, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['foyer'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: [], clearances: {} },
    codeRef: 'NBC 2016 Part 3',
  },

  // ── OUTDOOR — garden, courtyard, pool ──
  {
    type: 'garden', displayName: 'Garden',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 6.0, max: 200.0, default: 20.0, unit: 'sqm' },
    width: { min: 2.0, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 5.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['living_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: [], clearances: {} },
    codeRef: 'NBC 2016 Part 3',
  },
  {
    type: 'courtyard', displayName: 'Courtyard',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 6.0, max: 50.0, default: 12.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required', // it IS the open space
    adjacentTo: [],
    preferredAdjacent: ['living_room', 'corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: [], clearances: {} },
    codeRef: 'Indian Architectural Practice, Vastu Shastra',
  },
  {
    type: 'swimming_pool', displayName: 'Swimming Pool',
    category: 'outdoor', zone: 'outdoor',
    area: { min: 15.0, max: 100.0, default: 30.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 5.0, unit: 'm' },
    aspectRatio: { max: 3.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['garden'],
    awayFrom: ['bedroom'],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    structural: { maxSpan: 8.0, canHaveColumns: false, loadBearing: 'required' },
    furniture: { required: [], clearances: { poolDeckWidth: 1500 } },
    codeRef: 'NBC 2016 Part 9',
  },
];

// ============================================================
// ROOM RULES — COMMERCIAL
// ============================================================

const COMMERCIAL_RULES: RoomRule[] = [
  {
    type: 'reception', displayName: 'Reception',
    category: 'habitable', zone: 'public',
    area: { min: 8.0, max: 25.0, default: 14.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['waiting_area', 'corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: true, loadBearing: 'optional' },
    doors: { minWidth: 1000, preferredWidth: 1200, swing: 'inward', minFromCorner: 200, swingClearance: 1000 },
    furniture: {
      required: ['reception_desk', 'visitor_chairs'],
      clearances: { deskFront: 1200, waitingSpace: 1500 },
    },
    codeRef: 'NBC 2016 §8.4, Neufert Ch.40',
  },
  {
    type: 'waiting_area', displayName: 'Waiting Area',
    category: 'habitable', zone: 'public',
    area: { min: 6.0, max: 20.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: ['reception'],
    preferredAdjacent: [],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: true, loadBearing: 'optional' },
    furniture: { required: ['visitor_chairs'], clearances: { chairSpacing: 600 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'cabin', displayName: 'Cabin / Private Office',
    category: 'habitable', zone: 'private',
    area: { min: 8.0, max: 16.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor', 'reception'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['desk', 'office_chair', 'visitor_chairs'], clearances: { deskFront: 800 } },
    codeRef: 'NBC 2016, Neufert Ch.40',
  },
  {
    type: 'manager_cabin', displayName: 'Manager Cabin',
    category: 'habitable', zone: 'private',
    area: { min: 10.0, max: 20.0, default: 14.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.2, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['desk', 'office_chair', 'visitor_chairs', 'bookshelf'], clearances: { deskFront: 1000 } },
    codeRef: 'NBC 2016, Neufert Ch.40',
  },
  {
    type: 'director_cabin', displayName: 'Director Cabin',
    category: 'habitable', zone: 'private',
    area: { min: 14.0, max: 30.0, default: 20.0, unit: 'sqm' },
    width: { min: 3.6, unit: 'm' },
    depth: { min: 4.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['desk', 'office_chair', 'meeting_table', 'bookshelf'], clearances: { deskFront: 1200 } },
    codeRef: 'NBC 2016, Neufert Ch.40',
  },
  {
    type: 'conference_room', displayName: 'Conference Room',
    category: 'habitable', zone: 'public',
    area: { min: 12.0, max: 30.0, default: 18.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 4.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 900, preferredWidth: 1200, swing: 'outward', minFromCorner: 200, swingClearance: 900 },
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['conference_table', 'chairs'], clearances: { chairPullback: 800, projectorDistance: 2000 } },
    codeRef: 'NBC 2016, Neufert Ch.40',
  },
  {
    type: 'meeting_room', displayName: 'Meeting Room',
    category: 'habitable', zone: 'public',
    area: { min: 8.0, max: 20.0, default: 12.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['meeting_table', 'chairs'], clearances: { chairPullback: 800 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'board_room', displayName: 'Board Room',
    category: 'habitable', zone: 'public',
    area: { min: 20.0, max: 50.0, default: 30.0, unit: 'sqm' },
    width: { min: 4.0, unit: 'm' },
    depth: { min: 5.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['director_cabin'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    doors: { minWidth: 1200, preferredWidth: 1500, swing: 'outward', minFromCorner: 300, swingClearance: 1200 },
    structural: { maxSpan: 9.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['conference_table', 'executive_chairs'], clearances: { chairPullback: 1000 } },
    codeRef: 'NBC 2016, Neufert Ch.40',
  },
  {
    type: 'open_workspace', displayName: 'Open Workspace',
    category: 'habitable', zone: 'private',
    area: { min: 15.0, max: 100.0, default: 40.0, unit: 'sqm' },
    width: { min: 3.6, unit: 'm' },
    depth: { min: 4.0, unit: 'm' },
    aspectRatio: { max: 3.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['corridor', 'break_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 9.0, canHaveColumns: true, loadBearing: 'optional' },
    furniture: { required: ['workstations'], clearances: { aisleWidth: 1200, workstationDepth: 1500 } },
    codeRef: 'NBC 2016, Neufert Ch.40',
  },
  {
    type: 'cubicle_area', displayName: 'Cubicle Area',
    category: 'habitable', zone: 'private',
    area: { min: 12.0, max: 80.0, default: 30.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },
    aspectRatio: { max: 3.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 9.0, canHaveColumns: true, loadBearing: 'optional' },
    furniture: { required: ['cubicle_partitions'], clearances: { aisleWidth: 1200 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'break_room', displayName: 'Break Room',
    category: 'habitable', zone: 'service',
    area: { min: 6.0, max: 15.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['open_workspace', 'pantry'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['table', 'chairs', 'counter'], clearances: { tableClear: 800 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'server_room', displayName: 'Server Room',
    category: 'service', zone: 'service',
    area: { min: 4.0, max: 10.0, default: 6.0, unit: 'sqm' },
    width: { min: 2.0, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: ['bathroom', 'kitchen'],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 2750, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: ['server_rack'], clearances: { rackFront: 1200, rackRear: 900 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'pantry', displayName: 'Office Pantry',
    category: 'service', zone: 'service',
    area: { min: 4.0, max: 12.0, default: 6.0, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['break_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['counter', 'sink'], clearances: { counterFront: 800 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'commercial_toilet', displayName: 'Commercial Toilet',
    category: 'wet', zone: 'service',
    area: { min: 3.0, max: 12.0, default: 6.0, unit: 'sqm' },
    width: { min: 1.5, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 2.5 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: ['reception', 'conference_room'],
    ...WET_DEFAULTS,
    furniture: { required: ['wc', 'wash_basin', 'urinal'], clearances: { wcFront: 600, urinalFront: 600 } },
    codeRef: 'NBC 2016 §8.4.3',
  },
  {
    type: 'fire_escape_stair', displayName: 'Fire Escape Staircase',
    category: 'circulation', zone: 'circulation',
    area: { min: 6.0, max: 14.0, default: 8.0, unit: 'sqm' },
    width: { min: 1.2, unit: 'm' },  // NBC Part 4 — fire escape min 1200mm
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 3.0 },
    exteriorWall: 'required', // fire escape must have exterior access
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    structural: { maxSpan: 5.0, canHaveColumns: false, loadBearing: 'required' },
    verticalAlignment: 'strict',
    stackableAbove: ['fire_escape_stair'],
    stackableBelow: ['fire_escape_stair'],
    furniture: { required: [], clearances: { headroom: 2200 } },
    codeRef: 'NBC 2016 Part 4 (Fire Safety)',
  },
  {
    type: 'fire_lift', displayName: 'Fire Lift',
    category: 'circulation', zone: 'circulation',
    area: { min: 4.0, max: 8.0, default: 5.0, unit: 'sqm' },
    width: { min: 1.8, unit: 'm' },
    depth: { min: 2.0, unit: 'm' },
    aspectRatio: { max: 1.5 },
    exteriorWall: 'not_required',
    adjacentTo: ['fire_escape_stair'],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    structural: { maxSpan: 3.0, canHaveColumns: false, loadBearing: 'required' },
    verticalAlignment: 'strict',
    stackableAbove: ['fire_lift'],
    stackableBelow: ['fire_lift'],
    furniture: { required: [], clearances: {} },
    codeRef: 'NBC 2016 Part 4',
  },
  {
    type: 'refuge_area', displayName: 'Refuge Area',
    category: 'circulation', zone: 'circulation',
    area: { min: 6.0, max: 20.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['fire_escape_stair'],
    preferredAdjacent: [],
    awayFrom: [],
    ...CIRCULATION_DEFAULTS,
    furniture: { required: [], clearances: { wheelchairSpace: 1500 } },
    codeRef: 'NBC 2016 Part 4',
  },
];

// ============================================================
// ROOM RULES — EDUCATIONAL
// ============================================================

const EDUCATIONAL_RULES: RoomRule[] = [
  {
    type: 'classroom', displayName: 'Classroom',
    category: 'habitable', zone: 'public',
    area: { min: 30.0, max: 60.0, default: 45.0, unit: 'sqm' },
    width: { min: 5.4, unit: 'm' },
    depth: { min: 6.0, unit: 'm' },
    aspectRatio: { max: 1.5 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: ['auditorium'],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['desks', 'chairs', 'blackboard'], clearances: { aisleWidth: 900, deskSpacing: 600 } },
    codeRef: 'NBC 2016, Neufert Ch.42',
  },
  {
    type: 'lecture_hall', displayName: 'Lecture Hall',
    category: 'habitable', zone: 'public',
    area: { min: 60.0, max: 200.0, default: 100.0, unit: 'sqm' },
    width: { min: 7.2, unit: 'm' },
    depth: { min: 9.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 9.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['tiered_seating', 'podium'], clearances: { rowSpacing: 850 } },
    codeRef: 'NBC 2016, Neufert Ch.42',
  },
  {
    type: 'laboratory', displayName: 'Laboratory',
    category: 'habitable', zone: 'public',
    area: { min: 40.0, max: 80.0, default: 55.0, unit: 'sqm' },
    width: { min: 6.0, unit: 'm' },
    depth: { min: 7.0, unit: 'm' },
    aspectRatio: { max: 1.5 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['store_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: true, loadBearing: 'optional' },
    furniture: { required: ['lab_benches', 'sinks'], clearances: { benchAisle: 1200 } },
    codeRef: 'NBC 2016, Neufert Ch.42',
  },
  {
    type: 'staff_room', displayName: 'Staff Room',
    category: 'habitable', zone: 'private',
    area: { min: 15.0, max: 40.0, default: 25.0, unit: 'sqm' },
    width: { min: 3.6, unit: 'm' },
    depth: { min: 4.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: true, loadBearing: 'optional' },
    furniture: { required: ['desks', 'chairs', 'lockers'], clearances: { deskFront: 800 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'principal_office', displayName: "Principal's Office",
    category: 'habitable', zone: 'private',
    area: { min: 12.0, max: 25.0, default: 16.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['reception', 'staff_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['desk', 'office_chair', 'visitor_chairs'], clearances: { deskFront: 1000 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'library_room', displayName: 'Library Room',
    category: 'habitable', zone: 'public',
    area: { min: 30.0, max: 100.0, default: 50.0, unit: 'sqm' },
    width: { min: 5.4, unit: 'm' },
    depth: { min: 6.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: [],
    awayFrom: ['auditorium', 'canteen'],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: true, loadBearing: 'optional' },
    furniture: { required: ['bookshelves', 'reading_tables'], clearances: { aisleWidth: 1200 } },
    codeRef: 'NBC 2016, Neufert Ch.42',
  },
  {
    type: 'computer_lab', displayName: 'Computer Lab',
    category: 'habitable', zone: 'public',
    area: { min: 35.0, max: 70.0, default: 50.0, unit: 'sqm' },
    width: { min: 5.4, unit: 'm' },
    depth: { min: 6.0, unit: 'm' },
    aspectRatio: { max: 1.5 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['server_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    structural: { maxSpan: 6.0, canHaveColumns: false, loadBearing: 'optional' },
    furniture: { required: ['computer_desks'], clearances: { deskSpacing: 1200 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'auditorium', displayName: 'Auditorium',
    category: 'habitable', zone: 'public',
    area: { min: 80.0, max: 500.0, default: 150.0, unit: 'sqm' },
    width: { min: 8.0, unit: 'm' },
    depth: { min: 10.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['corridor', 'foyer'],
    awayFrom: ['classroom'],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 4500, unit: 'mm' },
    structural: { maxSpan: 12.0, canHaveColumns: false, loadBearing: 'optional' },
    doors: { minWidth: 1200, preferredWidth: 1800, swing: 'outward', minFromCorner: 300, swingClearance: 1200 },
    furniture: { required: ['fixed_seating', 'stage'], clearances: { rowSpacing: 850, exitAisle: 1200 } },
    codeRef: 'NBC 2016 Part 4, Neufert Ch.44',
  },
  {
    type: 'canteen', displayName: 'Canteen',
    category: 'habitable', zone: 'service',
    area: { min: 30.0, max: 100.0, default: 50.0, unit: 'sqm' },
    width: { min: 5.0, unit: 'm' },
    depth: { min: 6.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['kitchen'],
    preferredAdjacent: [],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['dining_tables', 'serving_counter'], clearances: { aisleWidth: 1200 } },
    codeRef: 'NBC 2016',
  },
];

// ============================================================
// ROOM RULES — MEDICAL
// ============================================================

const MEDICAL_RULES: RoomRule[] = [
  {
    type: 'consultation_room', displayName: 'Consultation Room',
    category: 'habitable', zone: 'public',
    area: { min: 10.0, max: 18.0, default: 12.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['waiting_area', 'corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['desk', 'examination_couch'], clearances: { deskFront: 800, couchSide: 600 } },
    codeRef: 'NBC 2016, Neufert Ch.46',
  },
  {
    type: 'examination_room', displayName: 'Examination Room',
    category: 'habitable', zone: 'public',
    area: { min: 12.0, max: 20.0, default: 14.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'preferred',
    adjacentTo: [],
    preferredAdjacent: ['consultation_room'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['examination_table', 'instrument_cabinet'], clearances: { tableSide: 900 } },
    codeRef: 'NBC 2016, Neufert Ch.46',
  },
  {
    type: 'ward', displayName: 'General Ward',
    category: 'habitable', zone: 'private',
    area: { min: 40.0, max: 80.0, default: 55.0, unit: 'sqm' },
    width: { min: 6.0, unit: 'm' },
    depth: { min: 7.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['nursing_station'],
    preferredAdjacent: ['bathroom'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['hospital_beds'], clearances: { bedSpacing: 1200, bedFoot: 1200 } },
    codeRef: 'NBC 2016, Neufert Ch.46',
  },
  {
    type: 'private_ward', displayName: 'Private Ward',
    category: 'habitable', zone: 'private',
    area: { min: 12.0, max: 20.0, default: 15.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: ['bathroom'],
    preferredAdjacent: ['nursing_station'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['hospital_bed', 'visitor_chair'], clearances: { bedSide: 900 } },
    codeRef: 'NBC 2016, Neufert Ch.46',
  },
  {
    type: 'icu', displayName: 'ICU',
    category: 'habitable', zone: 'private',
    area: { min: 15.0, max: 25.0, default: 18.0, unit: 'sqm' },
    width: { min: 3.6, unit: 'm' },
    depth: { min: 4.0, unit: 'm' },
    aspectRatio: { max: 1.5 },
    exteriorWall: 'preferred',
    adjacentTo: ['nursing_station'],
    preferredAdjacent: ['operation_theater'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['icu_bed', 'monitoring_equipment'], clearances: { bedAllSides: 1200 } },
    codeRef: 'NBC 2016, Neufert Ch.46',
  },
  {
    type: 'operation_theater', displayName: 'Operation Theater',
    category: 'habitable', zone: 'private',
    area: { min: 30.0, max: 50.0, default: 36.0, unit: 'sqm' },
    width: { min: 5.4, unit: 'm' },
    depth: { min: 6.0, unit: 'm' },
    aspectRatio: { max: 1.3 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['icu'],
    awayFrom: ['reception', 'corridor'],
    ...HABITABLE_DEFAULTS,
    ceilingHeight: { min: 3000, unit: 'mm' },
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: ['operating_table', 'surgical_lights'], clearances: { tableSurrounding: 1500 } },
    codeRef: 'NBC 2016, Neufert Ch.46',
  },
  {
    type: 'nursing_station', displayName: 'Nursing Station',
    category: 'habitable', zone: 'service',
    area: { min: 6.0, max: 15.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['ward', 'icu'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['nurse_desk', 'medicine_cabinet'], clearances: { deskFront: 1200 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'pharmacy', displayName: 'Pharmacy',
    category: 'habitable', zone: 'service',
    area: { min: 10.0, max: 25.0, default: 15.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['reception', 'corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['dispensing_counter', 'storage_shelves'], clearances: { counterFront: 1200 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'medical_store', displayName: 'Medical Store',
    category: 'service', zone: 'service',
    area: { min: 6.0, max: 15.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 2.4, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'not_required',
    adjacentTo: [],
    preferredAdjacent: ['pharmacy', 'nursing_station'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    windows: { required: false, minFloorAreaRatio: 0, targetFloorAreaRatio: 0, minSillHeight: 0, maxSillHeight: 0, minFromCorner: 0 },
    furniture: { required: ['storage_shelves'], clearances: { aisleWidth: 900 } },
    codeRef: 'NBC 2016',
  },
];

// ============================================================
// ROOM RULES — HOSTEL
// ============================================================

const HOSTEL_RULES: RoomRule[] = [
  {
    type: 'hostel_room', displayName: 'Hostel Room',
    category: 'habitable', zone: 'private',
    area: { min: 9.0, max: 14.0, default: 10.0, unit: 'sqm' },
    width: { min: 2.4, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['bed', 'desk', 'wardrobe'], clearances: { bedSide: 500, deskFront: 700 } },
    codeRef: 'NBC 2016 §8.4.1',
  },
  {
    type: 'common_room', displayName: 'Common Room',
    category: 'habitable', zone: 'public',
    area: { min: 12.0, max: 30.0, default: 20.0, unit: 'sqm' },
    width: { min: 3.0, unit: 'm' },
    depth: { min: 3.6, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['corridor'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['sofa', 'tv_unit', 'chairs'], clearances: { sofaFront: 800 } },
    codeRef: 'NBC 2016',
  },
  {
    type: 'warden_room', displayName: "Warden's Room",
    category: 'habitable', zone: 'private',
    area: { min: 9.0, max: 16.0, default: 12.0, unit: 'sqm' },
    width: { min: 2.7, unit: 'm' },
    depth: { min: 3.0, unit: 'm' },
    aspectRatio: { max: 1.8 },
    exteriorWall: 'required',
    adjacentTo: [],
    preferredAdjacent: ['corridor', 'foyer'],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['bed', 'desk', 'wardrobe'], clearances: { bedSide: 600 } },
    codeRef: 'NBC 2016 §8.4.1',
  },
  {
    type: 'mess_hall', displayName: 'Mess Hall / Dining',
    category: 'habitable', zone: 'service',
    area: { min: 30.0, max: 100.0, default: 50.0, unit: 'sqm' },
    width: { min: 5.0, unit: 'm' },
    depth: { min: 6.0, unit: 'm' },
    aspectRatio: { max: 2.0 },
    exteriorWall: 'required',
    adjacentTo: ['kitchen'],
    preferredAdjacent: [],
    awayFrom: [],
    ...HABITABLE_DEFAULTS,
    furniture: { required: ['dining_tables', 'chairs'], clearances: { aisleWidth: 1200 } },
    codeRef: 'NBC 2016',
  },
];

// ============================================================
// COMBINED RULES MAP
// ============================================================

const ALL_RULES: RoomRule[] = [
  ...RESIDENTIAL_RULES,
  ...COMMERCIAL_RULES,
  ...EDUCATIONAL_RULES,
  ...MEDICAL_RULES,
  ...HOSTEL_RULES,
];

/** Master lookup map — O(1) by room type */
export const ROOM_RULES: Record<string, RoomRule> = {};
for (const rule of ALL_RULES) {
  ROOM_RULES[rule.type] = rule;
}

// ============================================================
// LOOKUP HELPERS
// ============================================================

/** Default rule for unknown room types — uses habitable minimums */
const DEFAULT_RULE: RoomRule = {
  type: 'custom',
  displayName: 'Custom Room',
  category: 'habitable',
  zone: 'private',
  area: { min: 9.5, max: 30.0, default: 12.0, unit: 'sqm' },
  width: { min: 2.4, unit: 'm' },
  depth: { min: 2.4, unit: 'm' },
  aspectRatio: { max: 2.2 },
  ...HABITABLE_DEFAULTS,
  exteriorWall: 'preferred',
  adjacentTo: [],
  preferredAdjacent: [],
  awayFrom: [],
  furniture: { required: [], clearances: {} },
  codeRef: 'NBC 2016 §8.4.1 (default habitable)',
};

/**
 * Get the architectural rule for a room type.
 * Returns the default habitable rule if type is unknown.
 */
export function getRoomRule(type: string): RoomRule {
  return ROOM_RULES[type.toLowerCase()] ?? DEFAULT_RULE;
}

/**
 * Get area hard caps (min/max) for a room type — drop-in replacement for room-sizer.ts HARD_CAPS.
 */
export function getAreaCaps(type: string): { min: number; max: number } {
  const rule = getRoomRule(type);
  return { min: rule.area.min, max: rule.area.max };
}

/**
 * Get minimum dimensions in meters — drop-in replacement for room-standards.ts getMinDimMeters().
 */
export function getMinWidthMeters(type: string): number {
  return getRoomRule(type).width.min;
}

/**
 * Get minimum depth in meters — drop-in replacement for room-standards.ts getMinDepthMeters().
 */
export function getMinDepthMeters(type: string): number {
  return getRoomRule(type).depth.min;
}

/**
 * Get all room types in a category.
 */
export function getRoomTypesByCategory(category: RoomCategory): string[] {
  return ALL_RULES.filter(r => r.category === category).map(r => r.type);
}

/**
 * Get all room types in a zone.
 */
export function getRoomTypesByZone(zone: RoomZone): string[] {
  return ALL_RULES.filter(r => r.zone === zone).map(r => r.type);
}

/**
 * Check if a room type requires exterior wall access.
 */
export function requiresExteriorWall(type: string): boolean {
  return getRoomRule(type).exteriorWall === 'required';
}

/**
 * Check if a room type requires strict vertical alignment across floors.
 */
export function requiresVerticalAlignment(type: string): boolean {
  return getRoomRule(type).verticalAlignment === 'strict';
}

/**
 * Get all rules as an array (for iteration).
 */
export function getAllRoomRules(): RoomRule[] {
  return ALL_RULES;
}
