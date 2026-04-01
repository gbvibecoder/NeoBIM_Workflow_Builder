/**
 * Architectural Room Standards
 *
 * Furniture-aware minimum dimensions per room type.
 * Based on: IS:7933 (Ergonomics), NBC 2016 Part 3, Neufert Architects' Data (metric),
 * and the furniture catalog dimensions in furniture-catalog.ts.
 *
 * minWidth = minimum of the SHORTER wall (mm)
 * minDepth = minimum of the LONGER wall (mm)
 * Both must be satisfied for a room to be considered architecturally usable.
 */

export interface RoomStandard {
  /** Room type key (matches RoomType from floor-plan-cad.ts) */
  type: string;
  /** Minimum shorter dimension (mm) */
  minWidth: number;
  /** Minimum longer dimension (mm) */
  minDepth: number;
  /** NBC 2016 minimum area (sqm) */
  minArea: number;
  /** Maximum aspect ratio (longer / shorter) */
  maxAspectRatio: number;
  /** Preferred window wall: "longest" | "opposite_door" | "exterior_any" */
  preferredWindowWall: "longest" | "opposite_door" | "exterior_any";
}

/**
 * All room standards indexed by type.
 *
 * Dimension derivations (from furniture-catalog.ts):
 * - King bed: 1950×2050mm + 600mm sides + 700mm front = 3150w × 2750d
 * - Queen bed: 1650×2050mm + 600mm sides + 700mm front = 2850w × 2750d
 * - Single bed: 1000×2000mm + 500mm sides + 600mm front = 2000w × 2600d
 * - 3-seat sofa: 2200×900mm + 800mm front = 2200w × 1700d
 * - 6-seat dining table: 1800×900mm + 800mm all sides = 3400w × 2500d
 * - Kitchen counter: 2400×600mm + 1000mm working aisle
 * - Toilet: 400×700mm + 600mm front, basin: 600×450mm + 700mm front
 */
const STANDARDS: RoomStandard[] = [
  // ── Bedrooms ──
  {
    type: "master_bedroom",
    minWidth: 3200,   // bed(1950) + side clearance(600×2) = 3150 → 3200
    minDepth: 3600,   // bed(2050) + front(700) + wardrobe(600) + gap(200) = 3550 → 3600
    minArea: 12.0,
    maxAspectRatio: 1.8,
    preferredWindowWall: "opposite_door",
  },
  {
    type: "bedroom",
    minWidth: 2800,   // bed(1650) + side clearance(600×2) = 2850 → 2800 (slightly tight but functional)
    minDepth: 3000,   // bed(2050) + front(700) + wall gap = 2750 → 3000 (with wardrobe)
    minArea: 9.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "opposite_door",
  },
  {
    type: "guest_bedroom",
    minWidth: 2600,   // single bed(1000) + clearance(500×2) + nightstand(500) = 2500 → 2600
    minDepth: 2800,   // bed(2000) + front(600) + gap = 2600 → 2800
    minArea: 9.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "opposite_door",
  },
  // ── Living/Dining ──
  {
    type: "living_room",
    minWidth: 3200,   // sofa(2200) + side gaps = 2400 min, but need TV viewing distance
    minDepth: 3600,   // sofa(900) + coffee table + gap + TV unit = 3500+
    minArea: 12.0,
    maxAspectRatio: 2.0,
    preferredWindowWall: "longest",
  },
  {
    type: "dining_room",
    minWidth: 2800,   // table(900) + chair pullback(800×2) = 2500 → 2800
    minDepth: 3000,   // table(1800) + end clearance(600×2) = 3000
    minArea: 9.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "longest",
  },
  // ── Kitchen ──
  {
    type: "kitchen",
    minWidth: 2200,   // counter(600) + working aisle(1000) + opposite counter/wall(600) = 2200
    minDepth: 2800,   // counter run(2400) + fridge(700) side = 2800 with L-layout margin
    minArea: 5.0,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  // ── Bathrooms ──
  {
    type: "bathroom",
    minWidth: 1500,   // toilet(400) + gap(200) + basin(600) + gap(300) = 1500
    minDepth: 2100,   // shower(900) + clearance(500) + toilet depth(700) = 2100
    minArea: 2.5,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "toilet",
    minWidth: 1000,   // toilet(400) + clearance(300×2) = 1000
    minDepth: 1500,   // toilet(700) + front clearance(600) + door swing(200) = 1500
    minArea: 1.5,
    maxAspectRatio: 2.2,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "wc",
    minWidth: 1000,
    minDepth: 1500,
    minArea: 1.5,
    maxAspectRatio: 2.2,
    preferredWindowWall: "exterior_any",
  },
  // ── Study/Office ──
  {
    type: "study",
    minWidth: 2400,   // desk(1500) + chair space = 2000, with bookshelf = 2400
    minDepth: 2700,   // desk depth(750) + chair rollback(900) + bookshelf(350) + gaps = 2600
    minArea: 7.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "opposite_door",
  },
  {
    type: "home_office",
    minWidth: 2400,
    minDepth: 2800,
    minArea: 7.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "opposite_door",
  },
  {
    type: "office",
    minWidth: 2400,
    minDepth: 2800,
    minArea: 7.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "opposite_door",
  },
  // ── Service rooms ──
  {
    type: "utility",
    minWidth: 1500,   // washing machine(600) + clearance(800) + gap
    minDepth: 1800,
    minArea: 3.0,
    maxAspectRatio: 2.2,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "laundry",
    minWidth: 1500,
    minDepth: 1800,
    minArea: 3.0,
    maxAspectRatio: 2.2,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "store_room",
    minWidth: 1200,
    minDepth: 1500,
    minArea: 1.8,
    maxAspectRatio: 2.5,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "pantry",
    minWidth: 1200,
    minDepth: 1500,
    minArea: 1.8,
    maxAspectRatio: 2.5,
    preferredWindowWall: "exterior_any",
  },
  // ── Indian-specific ──
  {
    type: "puja_room",
    minWidth: 1800,   // mandir(600) + space(1200)
    minDepth: 2100,   // sitting depth + mandir depth
    minArea: 3.5,
    maxAspectRatio: 1.5,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "servant_quarter",
    minWidth: 2400,
    minDepth: 2700,
    minArea: 7.5,
    maxAspectRatio: 1.8,
    preferredWindowWall: "exterior_any",
  },
  // ── Circulation ──
  {
    type: "corridor",
    minWidth: 1050,   // NBC residential corridor
    minDepth: 1200,   // short corridor segment
    minArea: 2.0,
    maxAspectRatio: 8.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "lobby",
    minWidth: 1800,
    minDepth: 1800,
    minArea: 3.5,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "foyer",
    minWidth: 1800,
    minDepth: 1800,
    minArea: 3.5,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "entrance",
    minWidth: 1800,
    minDepth: 1800,
    minArea: 3.5,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  // ── Outdoor ──
  {
    type: "balcony",
    minWidth: 1200,   // NBC minimum balcony depth
    minDepth: 1800,
    minArea: 2.0,
    maxAspectRatio: 4.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "terrace",
    minWidth: 1500,
    minDepth: 2000,
    minArea: 3.0,
    maxAspectRatio: 4.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "verandah",
    minWidth: 1500,
    minDepth: 2000,
    minArea: 3.0,
    maxAspectRatio: 4.0,
    preferredWindowWall: "exterior_any",
  },
  // ── Stairs ──
  {
    type: "staircase",
    minWidth: 900,    // NBC minimum stair width
    minDepth: 2400,   // minimum for straight-run with landing
    minArea: 3.0,
    maxAspectRatio: 3.0,
    preferredWindowWall: "exterior_any",
  },
  // ── Misc ──
  {
    type: "walk_in_closet",
    minWidth: 1500,
    minDepth: 1800,
    minArea: 2.5,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "dressing_room",
    minWidth: 1800,
    minDepth: 2100,
    minArea: 3.5,
    maxAspectRatio: 2.0,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "garage",
    minWidth: 2700,   // car width(1800) + door clearance(900)
    minDepth: 5500,   // car length(4500) + front/back gap(500×2)
    minArea: 15.0,
    maxAspectRatio: 2.5,
    preferredWindowWall: "exterior_any",
  },
  {
    type: "parking",
    minWidth: 2700,
    minDepth: 5500,
    minArea: 15.0,
    maxAspectRatio: 2.5,
    preferredWindowWall: "exterior_any",
  },
];

/** Lookup map for O(1) access */
const STANDARDS_MAP = new Map<string, RoomStandard>();
for (const s of STANDARDS) STANDARDS_MAP.set(s.type, s);

/**
 * Get the architectural standard for a room type.
 * Falls back to a default habitable room standard if type is unknown.
 */
export function getRoomStandard(type: string): RoomStandard {
  return STANDARDS_MAP.get(type.toLowerCase()) ?? DEFAULT_STANDARD;
}

/**
 * Get the architectural standard with name-based fallback for common patterns.
 */
export function getRoomStandardByName(type: string, name: string): RoomStandard {
  const direct = STANDARDS_MAP.get(type.toLowerCase());
  if (direct) return direct;

  const n = name.toLowerCase();
  if (n.includes("master") && n.includes("bed")) return STANDARDS_MAP.get("master_bedroom") ?? DEFAULT_STANDARD;
  if (n.includes("bedroom") || n.includes("bed room")) return STANDARDS_MAP.get("bedroom") ?? DEFAULT_STANDARD;
  if (n.includes("living") || n.includes("drawing")) return STANDARDS_MAP.get("living_room") ?? DEFAULT_STANDARD;
  if (n.includes("kitchen")) return STANDARDS_MAP.get("kitchen") ?? DEFAULT_STANDARD;
  if (n.includes("dining")) return STANDARDS_MAP.get("dining_room") ?? DEFAULT_STANDARD;
  if (n.includes("bath")) return STANDARDS_MAP.get("bathroom") ?? DEFAULT_STANDARD;
  if (n.includes("toilet") || n.includes("wc")) return STANDARDS_MAP.get("toilet") ?? DEFAULT_STANDARD;
  if (n.includes("corridor") || n.includes("passage")) return STANDARDS_MAP.get("corridor") ?? DEFAULT_STANDARD;
  if (n.includes("puja") || n.includes("pooja") || n.includes("prayer")) return STANDARDS_MAP.get("puja_room") ?? DEFAULT_STANDARD;
  if (n.includes("study") || n.includes("office")) return STANDARDS_MAP.get("study") ?? DEFAULT_STANDARD;
  if (n.includes("utility") || n.includes("store")) return STANDARDS_MAP.get("utility") ?? DEFAULT_STANDARD;
  if (n.includes("balcony")) return STANDARDS_MAP.get("balcony") ?? DEFAULT_STANDARD;
  if (n.includes("stair")) return STANDARDS_MAP.get("staircase") ?? DEFAULT_STANDARD;
  if (n.includes("foyer") || n.includes("lobby")) return STANDARDS_MAP.get("foyer") ?? DEFAULT_STANDARD;

  return DEFAULT_STANDARD;
}

/** Default standard for unknown room types */
const DEFAULT_STANDARD: RoomStandard = {
  type: "default",
  minWidth: 2400,
  minDepth: 2400,
  minArea: 9.5,
  maxAspectRatio: 2.2,
  preferredWindowWall: "exterior_any",
};

/** Get minimum dimension in meters (shorter side) — for BSP compatibility */
export function getMinDimMeters(type: string, name: string): number {
  const std = getRoomStandardByName(type, name);
  return std.minWidth / 1000;
}

/** Get minimum depth in meters (longer side) — for BSP cross-axis validation */
export function getMinDepthMeters(type: string, name: string): number {
  const std = getRoomStandardByName(type, name);
  return std.minDepth / 1000;
}

export { STANDARDS };
