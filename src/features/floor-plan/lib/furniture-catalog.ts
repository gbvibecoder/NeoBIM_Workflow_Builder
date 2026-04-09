/**
 * Furniture & Fixture Catalog
 *
 * 40+ items across 6 categories with plan-view outline paths.
 * All dimensions in mm. Outlines defined as polygon points (plan view).
 */

import type { CatalogItem, PlanSymbol } from "@/types/floor-plan-cad";

// ============================================================
// CATEGORIES
// ============================================================

export const FURNITURE_CATEGORIES = [
  { id: "living", label: "Living Room" },
  { id: "bedroom", label: "Bedroom" },
  { id: "dining", label: "Dining" },
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "office", label: "Office" },
] as const;

export type FurnitureCategory = typeof FURNITURE_CATEGORIES[number]["id"];

// ============================================================
// PLAN SYMBOL HELPERS
// ============================================================

/** Rectangle outline path */
function rectSymbol(w: number, d: number, fill?: string): PlanSymbol {
  return {
    paths: [
      {
        d: `M0,0 L${w},0 L${w},${d} L0,${d} Z`,
        stroke_width: 2,
        fill: fill ?? "none",
      },
    ],
  };
}

/** Rectangle with inner detail lines */
function rectWithLines(w: number, d: number, innerPaths: PlanSymbol["paths"][0][]): PlanSymbol {
  return {
    paths: [
      { d: `M0,0 L${w},0 L${w},${d} L0,${d} Z`, stroke_width: 2 },
      ...innerPaths,
    ],
  };
}

// ============================================================
// CATALOG ITEMS
// ============================================================

export const FURNITURE_CATALOG: CatalogItem[] = [
  // ==================== LIVING ====================
  {
    id: "sofa-3seat",
    name: "3-Seat Sofa",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 900 }, { x: 0, y: 900 }] },
    width_mm: 2200, depth_mm: 900, height_mm: 850,
    plan_symbol: rectWithLines(2200, 900, [
      { d: "M0,200 L2200,200", stroke_width: 1 },
      { d: "M0,200 L0,900 M2200,200 L2200,900", stroke_width: 1.5 },
    ]),
    clearance: { front_mm: 800, back_mm: 50, left_mm: 100, right_mm: 100 },
  },
  {
    id: "sofa-2seat",
    name: "2-Seat Sofa",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 900 }, { x: 0, y: 900 }] },
    width_mm: 1600, depth_mm: 900, height_mm: 850,
    plan_symbol: rectWithLines(1600, 900, [
      { d: "M0,200 L1600,200", stroke_width: 1 },
    ]),
    clearance: { front_mm: 800, back_mm: 50, left_mm: 100, right_mm: 100 },
  },
  {
    id: "armchair",
    name: "Armchair",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 850, y: 0 }, { x: 850, y: 850 }, { x: 0, y: 850 }] },
    width_mm: 850, depth_mm: 850, height_mm: 800,
    plan_symbol: rectWithLines(850, 850, [
      { d: "M100,200 L750,200", stroke_width: 1 },
      { d: "M100,200 L100,750 M750,200 L750,750", stroke_width: 1 },
    ]),
    clearance: { front_mm: 600, back_mm: 50, left_mm: 100, right_mm: 100 },
  },
  {
    id: "coffee-table",
    name: "Coffee Table",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 1200, depth_mm: 600, height_mm: 450,
    plan_symbol: rectSymbol(1200, 600),
    clearance: { front_mm: 400, back_mm: 400, left_mm: 300, right_mm: 300 },
  },
  {
    id: "tv-unit",
    name: "TV Unit",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 1800, depth_mm: 450, height_mm: 500,
    plan_symbol: rectWithLines(1800, 450, [
      { d: "M300,100 L1500,100 L1500,350 L300,350 Z", stroke_width: 1 },
    ]),
    clearance: { front_mm: 1500, back_mm: 50, left_mm: 100, right_mm: 100 },
  },
  {
    id: "side-table",
    name: "Side Table",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }] },
    width_mm: 500, depth_mm: 500, height_mm: 550,
    plan_symbol: rectSymbol(500, 500),
    clearance: { front_mm: 200, back_mm: 100, left_mm: 100, right_mm: 100 },
  },
  {
    id: "bookshelf",
    name: "Bookshelf",
    category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 350 }, { x: 0, y: 350 }] },
    width_mm: 1200, depth_mm: 350, height_mm: 1800,
    plan_symbol: rectWithLines(1200, 350, [
      { d: "M0,175 L1200,175", stroke_width: 0.5, dash: [20, 10] },
    ]),
    clearance: { front_mm: 600, back_mm: 0, left_mm: 50, right_mm: 50 },
  },

  // ==================== BEDROOM ====================
  {
    id: "bed-king",
    name: "King Bed",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1950, y: 0 }, { x: 1950, y: 2050 }, { x: 0, y: 2050 }] },
    width_mm: 1950, depth_mm: 2050, height_mm: 500,
    plan_symbol: rectWithLines(1950, 2050, [
      { d: "M100,0 L100,200 L1850,200 L1850,0", stroke_width: 1.5 },
      { d: "M200,250 L900,250 L900,550 L200,550 Z", stroke_width: 0.5, fill: "#f5f5f5" },
      { d: "M1050,250 L1750,250 L1750,550 L1050,550 Z", stroke_width: 0.5, fill: "#f5f5f5" },
    ]),
    clearance: { front_mm: 700, back_mm: 0, left_mm: 600, right_mm: 600 },
  },
  {
    id: "bed-queen",
    name: "Queen Bed",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1650, y: 0 }, { x: 1650, y: 2050 }, { x: 0, y: 2050 }] },
    width_mm: 1650, depth_mm: 2050, height_mm: 500,
    plan_symbol: rectWithLines(1650, 2050, [
      { d: "M100,0 L100,200 L1550,200 L1550,0", stroke_width: 1.5 },
      { d: "M200,250 L750,250 L750,550 L200,550 Z", stroke_width: 0.5, fill: "#f5f5f5" },
      { d: "M900,250 L1450,250 L1450,550 L900,550 Z", stroke_width: 0.5, fill: "#f5f5f5" },
    ]),
    clearance: { front_mm: 700, back_mm: 0, left_mm: 600, right_mm: 600 },
  },
  {
    id: "bed-single",
    name: "Single Bed",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 2000 }, { x: 0, y: 2000 }] },
    width_mm: 1000, depth_mm: 2000, height_mm: 500,
    plan_symbol: rectWithLines(1000, 2000, [
      { d: "M50,0 L50,180 L950,180 L950,0", stroke_width: 1.5 },
      { d: "M150,230 L850,230 L850,480 L150,480 Z", stroke_width: 0.5, fill: "#f5f5f5" },
    ]),
    clearance: { front_mm: 600, back_mm: 0, left_mm: 500, right_mm: 500 },
  },
  {
    id: "nightstand",
    name: "Nightstand",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 500, depth_mm: 450, height_mm: 550,
    plan_symbol: rectSymbol(500, 450),
    clearance: { front_mm: 300, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "wardrobe",
    name: "Wardrobe",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 1800, depth_mm: 600, height_mm: 2100,
    plan_symbol: rectWithLines(1800, 600, [
      { d: "M900,0 L900,600", stroke_width: 1 },
      { d: "M400,200 L500,300 M500,200 L400,300", stroke_width: 0.8 },
      { d: "M1300,200 L1400,300 M1400,200 L1300,300", stroke_width: 0.8 },
    ]),
    clearance: { front_mm: 800, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "dresser",
    name: "Dresser",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 500 }, { x: 0, y: 500 }] },
    width_mm: 1200, depth_mm: 500, height_mm: 800,
    plan_symbol: rectWithLines(1200, 500, [
      { d: "M0,250 L1200,250", stroke_width: 0.5 },
    ]),
    clearance: { front_mm: 700, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "desk-study",
    name: "Study Desk",
    category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 1200, depth_mm: 600, height_mm: 750,
    plan_symbol: rectSymbol(1200, 600),
    clearance: { front_mm: 800, back_mm: 0, left_mm: 100, right_mm: 100 },
  },

  // ==================== DINING ====================
  {
    id: "dining-table-6",
    name: "6-Seat Dining Table",
    category: "dining",
    outline: { points: [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 900 }, { x: 0, y: 900 }] },
    width_mm: 1800, depth_mm: 900, height_mm: 750,
    plan_symbol: rectSymbol(1800, 900),
    clearance: { front_mm: 800, back_mm: 800, left_mm: 800, right_mm: 800 },
  },
  {
    id: "dining-table-4",
    name: "4-Seat Dining Table",
    category: "dining",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 800 }, { x: 0, y: 800 }] },
    width_mm: 1200, depth_mm: 800, height_mm: 750,
    plan_symbol: rectSymbol(1200, 800),
    clearance: { front_mm: 800, back_mm: 800, left_mm: 700, right_mm: 700 },
  },
  {
    id: "dining-table-round",
    name: "Round Dining Table",
    category: "dining",
    outline: { points: [{ x: 0, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 1100 }, { x: 0, y: 1100 }] },
    width_mm: 1100, depth_mm: 1100, height_mm: 750,
    plan_symbol: {
      paths: [
        { d: "M550,0 A550,550 0 1,1 549,0 Z", stroke_width: 2 },
      ],
    },
    clearance: { front_mm: 800, back_mm: 800, left_mm: 800, right_mm: 800 },
  },
  {
    id: "dining-chair",
    name: "Dining Chair",
    category: "dining",
    outline: { points: [{ x: 0, y: 0 }, { x: 450, y: 0 }, { x: 450, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 450, depth_mm: 450, height_mm: 900,
    plan_symbol: rectWithLines(450, 450, [
      { d: "M50,0 L50,100 L400,100 L400,0", stroke_width: 1 },
    ]),
    clearance: { front_mm: 300, back_mm: 600, left_mm: 50, right_mm: 50 },
  },

  // ==================== KITCHEN ====================
  {
    id: "kitchen-counter",
    name: "Kitchen Counter",
    category: "kitchen",
    outline: { points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 2400, depth_mm: 600, height_mm: 850,
    plan_symbol: rectWithLines(2400, 600, [
      { d: "M600,0 L600,600 M1200,0 L1200,600 M1800,0 L1800,600", stroke_width: 0.5 },
    ]),
    clearance: { front_mm: 1000, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "sink-kitchen",
    name: "Kitchen Sink",
    category: "kitchen",
    outline: { points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 800, depth_mm: 600, height_mm: 850,
    plan_symbol: rectWithLines(800, 600, [
      { d: "M80,80 L350,80 L350,520 L80,520 Z", stroke_width: 1 },
      { d: "M450,80 L720,80 L720,520 L450,520 Z", stroke_width: 1 },
    ]),
    clearance: { front_mm: 800, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "stove-4burner",
    name: "4-Burner Stove",
    category: "kitchen",
    outline: { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 600, depth_mm: 600, height_mm: 850,
    plan_symbol: {
      paths: [
        { d: "M0,0 L600,0 L600,600 L0,600 Z", stroke_width: 2 },
        { d: "M150,150 A70,70 0 1,1 149,150 Z", stroke_width: 1 },
        { d: "M450,150 A70,70 0 1,1 449,150 Z", stroke_width: 1 },
        { d: "M150,450 A70,70 0 1,1 149,450 Z", stroke_width: 1 },
        { d: "M450,450 A70,70 0 1,1 449,450 Z", stroke_width: 1 },
      ],
    },
    clearance: { front_mm: 800, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  {
    id: "refrigerator",
    name: "Refrigerator",
    category: "kitchen",
    outline: { points: [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 700 }, { x: 0, y: 700 }] },
    width_mm: 700, depth_mm: 700, height_mm: 1800,
    plan_symbol: rectWithLines(700, 700, [
      { d: "M0,400 L700,400", stroke_width: 1 },
      { d: "M350,50 L350,350", stroke_width: 0.5, dash: [10, 10] },
    ]),
    clearance: { front_mm: 800, back_mm: 50, left_mm: 50, right_mm: 50 },
  },
  {
    id: "kitchen-island",
    name: "Kitchen Island",
    category: "kitchen",
    outline: { points: [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 800 }, { x: 0, y: 800 }] },
    width_mm: 1500, depth_mm: 800, height_mm: 900,
    plan_symbol: rectSymbol(1500, 800),
    clearance: { front_mm: 900, back_mm: 900, left_mm: 900, right_mm: 900 },
  },
  {
    id: "microwave-stand",
    name: "Microwave Stand",
    category: "kitchen",
    outline: { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 600, depth_mm: 450, height_mm: 1200,
    plan_symbol: rectSymbol(600, 450),
    clearance: { front_mm: 600, back_mm: 0, left_mm: 50, right_mm: 50 },
  },

  // ==================== BATHROOM ====================
  {
    id: "toilet",
    name: "Toilet (WC)",
    category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 700 }, { x: 0, y: 700 }] },
    width_mm: 400, depth_mm: 700, height_mm: 400,
    plan_symbol: {
      paths: [
        { d: "M50,0 L350,0 L350,250 L50,250 Z", stroke_width: 2 },
        { d: "M200,250 A175,200 0 1,0 200,700", stroke_width: 2 },
        { d: "M25,700 A175,200 0 0,0 375,700", stroke_width: 2 },
      ],
    },
    clearance: { front_mm: 600, back_mm: 0, left_mm: 200, right_mm: 200 },
  },
  {
    id: "washbasin",
    name: "Wash Basin",
    category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 600, depth_mm: 450, height_mm: 850,
    plan_symbol: {
      paths: [
        { d: "M0,0 L600,0 L600,450 L0,450 Z", stroke_width: 2 },
        { d: "M100,50 Q100,350 300,350 Q500,350 500,50", stroke_width: 1.5 },
      ],
    },
    clearance: { front_mm: 700, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  {
    id: "bathtub",
    name: "Bathtub",
    category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 750, y: 0 }, { x: 750, y: 1700 }, { x: 0, y: 1700 }] },
    width_mm: 750, depth_mm: 1700, height_mm: 600,
    plan_symbol: {
      paths: [
        { d: "M0,0 L750,0 L750,1700 L0,1700 Z", stroke_width: 2 },
        { d: "M60,60 L690,60 L690,1640 L60,1640 Z", stroke_width: 1, dash: [15, 10] },
      ],
    },
    clearance: { front_mm: 700, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  {
    id: "shower-enclosure",
    name: "Shower Enclosure",
    category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }] },
    width_mm: 900, depth_mm: 900, height_mm: 2000,
    plan_symbol: {
      paths: [
        { d: "M0,0 L900,0 L900,900 L0,900 Z", stroke_width: 2 },
        { d: "M0,0 L900,900", stroke_width: 0.5, dash: [20, 10] },
        { d: "M900,0 L0,900", stroke_width: 0.5, dash: [20, 10] },
      ],
    },
    clearance: { front_mm: 700, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  {
    id: "vanity-unit",
    name: "Vanity Unit",
    category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 500 }, { x: 0, y: 500 }] },
    width_mm: 900, depth_mm: 500, height_mm: 850,
    plan_symbol: rectWithLines(900, 500, [
      { d: "M200,50 Q200,350 450,350 Q700,350 700,50", stroke_width: 1 },
    ]),
    clearance: { front_mm: 700, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "washing-machine",
    name: "Washing Machine",
    category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 600, depth_mm: 600, height_mm: 850,
    plan_symbol: {
      paths: [
        { d: "M0,0 L600,0 L600,600 L0,600 Z", stroke_width: 2 },
        { d: "M300,300 A120,120 0 1,1 299,300 Z", stroke_width: 1 },
      ],
    },
    clearance: { front_mm: 800, back_mm: 50, left_mm: 50, right_mm: 50 },
  },

  // ==================== OFFICE ====================
  {
    id: "office-desk",
    name: "Office Desk",
    category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 750 }, { x: 0, y: 750 }] },
    width_mm: 1500, depth_mm: 750, height_mm: 750,
    plan_symbol: rectWithLines(1500, 750, [
      { d: "M50,600 L50,750 L500,750 L500,600 Z", stroke_width: 0.5 },
    ]),
    clearance: { front_mm: 900, back_mm: 50, left_mm: 100, right_mm: 100 },
  },
  {
    id: "office-chair",
    name: "Office Chair",
    category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 550, y: 0 }, { x: 550, y: 550 }, { x: 0, y: 550 }] },
    width_mm: 550, depth_mm: 550, height_mm: 1100,
    plan_symbol: {
      paths: [
        { d: "M275,275 A250,250 0 1,1 274,275 Z", stroke_width: 2 },
        { d: "M100,100 L450,100", stroke_width: 1 },
      ],
    },
    clearance: { front_mm: 300, back_mm: 600, left_mm: 200, right_mm: 200 },
  },
  {
    id: "filing-cabinet",
    name: "Filing Cabinet",
    category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 450, y: 0 }, { x: 450, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 450, depth_mm: 600, height_mm: 1200,
    plan_symbol: rectWithLines(450, 600, [
      { d: "M0,200 L450,200 M0,400 L450,400", stroke_width: 0.5 },
    ]),
    clearance: { front_mm: 800, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  {
    id: "conference-table",
    name: "Conference Table",
    category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1200 }, { x: 0, y: 1200 }] },
    width_mm: 2400, depth_mm: 1200, height_mm: 750,
    plan_symbol: rectSymbol(2400, 1200),
    clearance: { front_mm: 900, back_mm: 900, left_mm: 900, right_mm: 900 },
  },
  {
    id: "credenza",
    name: "Credenza",
    category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 1500, depth_mm: 450, height_mm: 750,
    plan_symbol: rectWithLines(1500, 450, [
      { d: "M500,0 L500,450 M1000,0 L1000,450", stroke_width: 0.5 },
    ]),
    clearance: { front_mm: 600, back_mm: 0, left_mm: 50, right_mm: 50 },
  },

  // ── INDIAN-SPECIFIC & ADDITIONAL ITEMS ──

  { id: "puja-mandir", name: "Puja Mandir", category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 900, depth_mm: 600, height_mm: 1800,
    plan_symbol: rectWithLines(900, 600, [{ d: "M150,100 L750,100 L750,500 L150,500 Z", stroke_width: 0.5 }]),
    clearance: { front_mm: 600, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  { id: "diya-stand", name: "Diya Lamp Stand", category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] },
    width_mm: 400, depth_mm: 400, height_mm: 900,
    plan_symbol: rectSymbol(400, 400),
    clearance: { front_mm: 300, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  { id: "shoe-cabinet", name: "Shoe Cabinet", category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 350 }, { x: 0, y: 350 }] },
    width_mm: 1200, depth_mm: 350, height_mm: 900,
    plan_symbol: rectSymbol(1200, 350),
    clearance: { front_mm: 500, back_mm: 0, left_mm: 0, right_mm: 0 },
  },
  { id: "console-table", name: "Console Table", category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 400 }, { x: 0, y: 400 }] },
    width_mm: 1200, depth_mm: 400, height_mm: 800,
    plan_symbol: rectSymbol(1200, 400),
    clearance: { front_mm: 400, back_mm: 0, left_mm: 50, right_mm: 50 },
  },
  { id: "clothes-rack", name: "Clothes Drying Rack", category: "bathroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 1200, depth_mm: 600, height_mm: 1500,
    plan_symbol: rectSymbol(1200, 600),
    clearance: { front_mm: 400, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  { id: "storage-shelf", name: "Storage Shelf", category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }] },
    width_mm: 1000, depth_mm: 400, height_mm: 1800,
    plan_symbol: rectSymbol(1000, 400),
    clearance: { front_mm: 500, back_mm: 0, left_mm: 0, right_mm: 0 },
  },
  { id: "outdoor-chair", name: "Outdoor Chair", category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }] },
    width_mm: 600, depth_mm: 600, height_mm: 850,
    plan_symbol: rectSymbol(600, 600),
    clearance: { front_mm: 400, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  { id: "planter", name: "Indoor Plant", category: "living",
    outline: { points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] },
    width_mm: 400, depth_mm: 400, height_mm: 600,
    plan_symbol: rectSymbol(400, 400),
    clearance: { front_mm: 200, back_mm: 0, left_mm: 100, right_mm: 100 },
  },
  { id: "car-outline", name: "Car (Parking)", category: "office",
    outline: { points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 4500 }, { x: 0, y: 4500 }] },
    width_mm: 2000, depth_mm: 4500, height_mm: 1500,
    plan_symbol: rectWithLines(2000, 4500, [{ d: "M200,500 L1800,500 L1800,4000 L200,4000 Z", stroke_width: 0.5 }]),
    clearance: { front_mm: 600, back_mm: 300, left_mm: 500, right_mm: 500 },
  },
  { id: "small-cupboard", name: "Small Cupboard", category: "bedroom",
    outline: { points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 450 }, { x: 0, y: 450 }] },
    width_mm: 900, depth_mm: 450, height_mm: 1800,
    plan_symbol: rectSymbol(900, 450),
    clearance: { front_mm: 500, back_mm: 0, left_mm: 0, right_mm: 0 },
  },
];

// ============================================================
// LOOKUP HELPERS
// ============================================================

const _catalogMap = new Map<string, CatalogItem>();
for (const item of FURNITURE_CATALOG) {
  _catalogMap.set(item.id, item);
}

export function getCatalogItem(id: string): CatalogItem | undefined {
  return _catalogMap.get(id);
}

export function getCatalogByCategory(category: FurnitureCategory): CatalogItem[] {
  return FURNITURE_CATALOG.filter((item) => item.category === category);
}

export function searchCatalog(query: string): CatalogItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return FURNITURE_CATALOG;
  return FURNITURE_CATALOG.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
  );
}
