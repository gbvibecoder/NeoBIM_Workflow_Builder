/* ─── Furniture + MEP presets per (building category × room usage) ────────
   Pure data tables consumed by floor-plan-to-massing.ts. Maps a room's
   intended use to a curated furniture / sanitary set with realistic
   dimensions (in FEET; converter handles ft→m).

   Position hints:
     "wall-N" / "wall-S" / "wall-E" / "wall-W" → flush against that
       wall, centred along the wall.
     "corner-NW" etc. → corner anchored, useful for fitted units.
     "center" → centred in the room. */

import type { BuildingCategory } from "../types/floor-plan-schema";

export type FurniturePosition =
  | "wall-N" | "wall-S" | "wall-E" | "wall-W"
  | "corner-NW" | "corner-NE" | "corner-SW" | "corner-SE"
  | "center";

export interface FurnitureItem {
  /** Display name (becomes the IfcFurniture.Name). */
  name: string;
  /** Width (E-W extent of the item), feet. */
  widthFt: number;
  /** Depth (N-S extent of the item), feet. */
  depthFt: number;
  /** Height, feet. */
  heightFt: number;
  /** Where in the room the item lives. */
  position: FurniturePosition;
  /** Y-offset from floor, feet. 0 for floor-standing items. */
  liftedFt?: number;
  /** Free-text material — surfaces as `properties.material`. */
  material?: string;
}

export interface MEPFixtureItem {
  /** "WC", "wash-basin", "kitchen-sink", "shower" — drives IFC predefined type. */
  kind: "wc" | "wash-basin" | "kitchen-sink" | "utility-sink" | "shower" | "bidet";
  name: string;
  widthFt: number;
  depthFt: number;
  heightFt: number;
  position: FurniturePosition;
  /** Whether this fixture connects to a drainage stack. */
  drains?: boolean;
}

/** Lighting preset — ceiling-mounted by default. */
export interface LightingItem {
  name: string;
  /** Watts (informational metadata). */
  watts?: number;
  /** Position on the ceiling. Default "center". */
  position?: FurniturePosition;
}

/** Lookup key for the preset map. Same `usage` string as
 *  `FloorPlanRoom.usage`. Common synonyms are aliased in `normaliseUsage`. */
export type RoomUsageKey =
  | "living" | "bedroom" | "kitchen" | "toilet" | "wash"
  | "office" | "conference" | "reception" | "shop" | "restaurant"
  | "lobby" | "warehouse" | "factory"
  | "stair" | "corridor" | "balcony"
  | "default";

/* ── Residential presets ──────────────────────────────────────────────── */

const RESIDENTIAL_FURNITURE: Record<RoomUsageKey, FurnitureItem[]> = {
  living: [
    { name: "3-seater Sofa",   widthFt: 7,   depthFt: 3,   heightFt: 3,    position: "wall-W",   material: "fabric" },
    { name: "Coffee Table",    widthFt: 4,   depthFt: 2,   heightFt: 1.5,  position: "center",   material: "wood" },
    { name: "TV Unit",         widthFt: 5,   depthFt: 1.5, heightFt: 4,    position: "wall-E",   material: "wood" },
    { name: "Armchair",        widthFt: 3,   depthFt: 3,   heightFt: 3,    position: "corner-NE",material: "fabric" },
  ],
  bedroom: [
    { name: "Bed (Queen)",     widthFt: 5,   depthFt: 6.5, heightFt: 2,    position: "center",   material: "wood + fabric" },
    { name: "Wardrobe",        widthFt: 6,   depthFt: 2,   heightFt: 7,    position: "wall-W",   material: "wood" },
    { name: "Nightstand",      widthFt: 1.5, depthFt: 1.5, heightFt: 2,    position: "wall-S",   material: "wood" },
    { name: "Study Desk",      widthFt: 4,   depthFt: 2,   heightFt: 2.5,  position: "wall-E",   material: "wood" },
  ],
  kitchen: [
    { name: "Cooking Platform",widthFt: 8,   depthFt: 2,   heightFt: 3,    position: "wall-N",   material: "granite + steel" },
    { name: "Storage Cabinet", widthFt: 6,   depthFt: 2,   heightFt: 7,    position: "wall-W",   material: "MDF + laminate", liftedFt: 3 },
    { name: "Refrigerator",    widthFt: 2.5, depthFt: 2.5, heightFt: 6,    position: "corner-SE",material: "steel" },
  ],
  toilet: [
    /* Furniture set is intentionally small — fixtures handled in MEP table. */
    { name: "Towel Rail",      widthFt: 2,   depthFt: 0.2, heightFt: 0.2,  position: "wall-N",   liftedFt: 4, material: "chrome" },
    { name: "Mirror Cabinet",  widthFt: 2,   depthFt: 0.5, heightFt: 2.5,  position: "wall-N",   liftedFt: 3, material: "wood + glass" },
  ],
  wash: [
    { name: "Storage Cabinet", widthFt: 4,   depthFt: 2,   heightFt: 6,    position: "wall-W",   material: "wood" },
    { name: "Drying Rack",     widthFt: 3,   depthFt: 1.5, heightFt: 5,    position: "wall-E",   material: "steel" },
  ],
  office: [
    { name: "Work Desk",       widthFt: 5,   depthFt: 2.5, heightFt: 2.5,  position: "wall-N",   material: "wood" },
    { name: "Office Chair",    widthFt: 2,   depthFt: 2,   heightFt: 3,    position: "center",   material: "fabric + steel" },
    { name: "Bookshelf",       widthFt: 4,   depthFt: 1,   heightFt: 7,    position: "wall-W",   material: "wood" },
  ],
  conference: [],
  reception: [],
  shop: [],
  restaurant: [],
  lobby: [],
  warehouse: [],
  factory: [],
  stair: [],
  corridor: [],
  balcony: [
    { name: "Outdoor Chair",   widthFt: 2,   depthFt: 2,   heightFt: 3,    position: "center",   material: "rattan" },
    { name: "Side Table",      widthFt: 1.5, depthFt: 1.5, heightFt: 1.5,  position: "wall-N",   material: "wood" },
  ],
  default: [],
};

/* ── Commercial presets ───────────────────────────────────────────────── */

const COMMERCIAL_FURNITURE: Record<RoomUsageKey, FurnitureItem[]> = {
  office: [
    { name: "Executive Desk",  widthFt: 6,   depthFt: 3,   heightFt: 2.5,  position: "center",   material: "wood + steel" },
    { name: "Office Chair",    widthFt: 2,   depthFt: 2,   heightFt: 3,    position: "wall-S",   material: "fabric + steel" },
    { name: "Filing Cabinet",  widthFt: 3,   depthFt: 2,   heightFt: 4,    position: "wall-W",   material: "steel" },
    { name: "Visitor Chair",   widthFt: 2,   depthFt: 2,   heightFt: 3,    position: "wall-N",   material: "fabric" },
  ],
  conference: [
    { name: "Conference Table",widthFt: 10,  depthFt: 4,   heightFt: 2.5,  position: "center",   material: "wood + glass" },
    { name: "Conference Chair",widthFt: 2,   depthFt: 2,   heightFt: 3,    position: "wall-S",   material: "fabric" },
    { name: "Whiteboard",      widthFt: 6,   depthFt: 0.2, heightFt: 4,    position: "wall-N",   liftedFt: 2.5, material: "magnetic glass" },
  ],
  reception: [
    { name: "Reception Counter", widthFt: 8, depthFt: 2.5, heightFt: 3.5,  position: "wall-N",   material: "wood + stone" },
    { name: "Visitor Sofa",      widthFt: 6, depthFt: 3,   heightFt: 3,    position: "wall-S",   material: "fabric" },
    { name: "Coffee Table",      widthFt: 3, depthFt: 2,   heightFt: 1.5,  position: "center",   material: "wood" },
  ],
  lobby: [
    { name: "Lobby Sofa",        widthFt: 8, depthFt: 3,   heightFt: 3,    position: "wall-W",   material: "leather" },
    { name: "Coffee Table",      widthFt: 4, depthFt: 2,   heightFt: 1.5,  position: "center",   material: "wood" },
    { name: "Plant Stand",       widthFt: 2, depthFt: 2,   heightFt: 4,    position: "corner-NE", material: "ceramic" },
  ],
  shop: [
    { name: "Display Counter",   widthFt: 8, depthFt: 2.5, heightFt: 3,    position: "wall-N",   material: "wood + glass" },
    { name: "Shelving Unit",     widthFt: 8, depthFt: 1.5, heightFt: 7,    position: "wall-W",   material: "steel" },
    { name: "Checkout Counter",  widthFt: 6, depthFt: 2.5, heightFt: 3,    position: "corner-SE", material: "wood" },
  ],
  restaurant: [
    { name: "Dining Table (4)",  widthFt: 4, depthFt: 4,   heightFt: 2.5,  position: "center",   material: "wood" },
    { name: "Dining Chair",      widthFt: 2, depthFt: 2,   heightFt: 3,    position: "wall-W",   material: "wood + fabric" },
  ],
  living: [],
  bedroom: [],
  kitchen: [
    { name: "Commercial Kitchen Range", widthFt: 6, depthFt: 3, heightFt: 3, position: "wall-N", material: "stainless steel" },
    { name: "Prep Counter",            widthFt: 8, depthFt: 2.5, heightFt: 3, position: "wall-S", material: "stainless steel" },
  ],
  toilet: [
    { name: "Mirror Wall",       widthFt: 6, depthFt: 0.2, heightFt: 4,    position: "wall-N",   liftedFt: 3, material: "glass" },
  ],
  wash: [],
  warehouse: [
    { name: "Pallet Rack",       widthFt: 8, depthFt: 4,   heightFt: 12,   position: "wall-W",   material: "steel" },
  ],
  factory: [
    { name: "Workbench",         widthFt: 8, depthFt: 3,   heightFt: 3,    position: "wall-N",   material: "steel" },
  ],
  stair: [],
  corridor: [],
  balcony: [],
  default: [],
};

/* ── MEP fixture presets ──────────────────────────────────────────────── */

const RESIDENTIAL_MEP: Partial<Record<RoomUsageKey, MEPFixtureItem[]>> = {
  toilet: [
    { kind: "wc",         name: "Water Closet (WC)", widthFt: 1.5, depthFt: 2.5, heightFt: 2.5, position: "wall-S",     drains: true },
    { kind: "wash-basin", name: "Wash Basin",        widthFt: 2,   depthFt: 1.5, heightFt: 3,   position: "wall-N",     drains: true },
    { kind: "shower",     name: "Shower",            widthFt: 3,   depthFt: 3,   heightFt: 7,   position: "corner-NE",  drains: true },
  ],
  kitchen: [
    { kind: "kitchen-sink", name: "Kitchen Sink",    widthFt: 3,   depthFt: 2,   heightFt: 3,   position: "wall-N",     drains: true },
  ],
  wash: [
    { kind: "utility-sink", name: "Utility Sink",    widthFt: 2.5, depthFt: 2,   heightFt: 3,   position: "wall-N",     drains: true },
  ],
};

const COMMERCIAL_MEP: Partial<Record<RoomUsageKey, MEPFixtureItem[]>> = {
  toilet: [
    { kind: "wc",         name: "WC",                widthFt: 1.5, depthFt: 2.5, heightFt: 2.5, position: "wall-S",     drains: true },
    { kind: "wash-basin", name: "Wash Basin",        widthFt: 2,   depthFt: 1.5, heightFt: 3,   position: "wall-N",     drains: true },
  ],
  kitchen: [
    { kind: "kitchen-sink", name: "3-Compartment Sink", widthFt: 6, depthFt: 2.5, heightFt: 3,  position: "wall-N",     drains: true },
  ],
};

/* ── Lighting (universal) ─────────────────────────────────────────────── */

const DEFAULT_LIGHTING: LightingItem = {
  name: "Ceiling Light",
  watts: 18,
  position: "center",
};

/* ── Public API ───────────────────────────────────────────────────────── */

/** Coerce free-text usage to a known key. Tolerant of synonyms and casing. */
export function normaliseUsage(usage: string | undefined): RoomUsageKey {
  if (!usage) return "default";
  const u = usage.toLowerCase().trim();
  if (u.includes("living") || u.includes("hall") || u.includes("drawing") || u.includes("lounge")) return "living";
  if (u.includes("bedroom") || u.includes("master") || u.includes("guest")) return "bedroom";
  if (u.includes("kitchen")) return "kitchen";
  if (u.includes("toilet") || u.includes("bathroom") || u.includes("wc") || u.includes("powder")) return "toilet";
  if (u.includes("wash") || u.includes("laundry") || u.includes("utility")) return "wash";
  if (u.includes("office") || u.includes("study") || u.includes("workstation")) return "office";
  if (u.includes("conference") || u.includes("meeting") || u.includes("boardroom")) return "conference";
  if (u.includes("reception") || u.includes("front desk")) return "reception";
  if (u.includes("shop") || u.includes("store") || u.includes("retail")) return "shop";
  if (u.includes("restaurant") || u.includes("dining") || u.includes("cafe")) return "restaurant";
  if (u.includes("lobby")) return "lobby";
  if (u.includes("warehouse") || u.includes("storage")) return "warehouse";
  if (u.includes("factory") || u.includes("workshop") || u.includes("plant")) return "factory";
  if (u.includes("stair") || u.includes("staircase")) return "stair";
  if (u.includes("corridor") || u.includes("passage")) return "corridor";
  if (u.includes("balcony") || u.includes("terrace") || u.includes("verandah")) return "balcony";
  return "default";
}

/** Look up the furniture set for a (category, usage) pair. */
export function getFurniturePreset(
  category: BuildingCategory,
  usage: string | undefined,
): FurnitureItem[] {
  const key = normaliseUsage(usage);
  if (category === "commercial" || category === "hospitality") return COMMERCIAL_FURNITURE[key] ?? [];
  if (category === "industrial") {
    /* Industrial buildings have minimal furniture — workbenches + racks. */
    return COMMERCIAL_FURNITURE[key] ?? [];
  }
  if (category === "institutional") return COMMERCIAL_FURNITURE[key] ?? [];
  return RESIDENTIAL_FURNITURE[key] ?? [];
}

/** Look up the MEP fixture set for a (category, usage) pair. */
export function getMEPFixtures(
  category: BuildingCategory,
  usage: string | undefined,
): MEPFixtureItem[] {
  const key = normaliseUsage(usage);
  if (category === "commercial" || category === "hospitality" || category === "institutional") {
    return COMMERCIAL_MEP[key] ?? [];
  }
  return RESIDENTIAL_MEP[key] ?? [];
}

/** Default ceiling light fixture for any habitable space. */
export function getLightingFixture(): LightingItem {
  return { ...DEFAULT_LIGHTING };
}
