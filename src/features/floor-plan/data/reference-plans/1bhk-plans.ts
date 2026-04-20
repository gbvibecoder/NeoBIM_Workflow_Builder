import type { ReferenceFloorPlan } from "@/features/floor-plan/lib/reference-types";

/**
 * 1BHK reference plans — small apartments and studios.
 * Typical for: 500-750 sqft, urban apartments, starter homes.
 *
 * Plot: 25x30 ft (750 sqft) for all plans.
 *
 * Room proportion targets (% of plot area):
 *   Living Room  ~28%    (main living-dining area)
 *   Bedroom      ~25%    (only bedroom)
 *   Kitchen      ~14%    (compact but functional)
 *   Bathroom     ~6%     (attached to bedroom)
 *   Foyer        ~6%     (entrance area)
 *   Porch        ~4%     (entrance porch)
 *   Hallway      null    (not needed for 1BHK)
 *
 * Coverage target: 88%.
 * NOTE: The stated room-size ranges (max 83% combined) cannot quite reach
 * 88% coverage, so Living and Bedroom are ~2-4% above their ideal max to
 * fill the plan without dead space. This matches real-world 1BHK layouts
 * where the living-dining area is the dominant space.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VERIFICATION SUMMARY (all 4 plans identical proportions):
 *   Kitchen   0.141  (14.1%)
 *   Foyer     0.060  ( 6.0%)
 *   Bathroom  0.060  ( 6.0%)
 *   Living    0.319  (31.9%)   ← living-dining combo
 *   Bedroom   0.261  (26.1%)
 *   Porch     0.038  ( 3.8%)
 *   TOTAL     0.879  (87.9%)   ≈ 88%
 * ─────────────────────────────────────────────────────────────────────────
 */
export const PLANS_1BHK: ReferenceFloorPlan[] = [
  // ─── 1BHK North-facing (25×30) ────────────────────────────────────────
  //
  //  ┌─────────────────────────────────┐  1.0
  //  │          (setback)              │
  //  ├──────── Porch ─────────────────-┤  0.94  ← entrance (north)
  //  │   nx=0.18  nw=0.64  nd=0.06    │  0.88
  //  ├──────────────┬──────────────────┤
  //  │              │                  │
  //  │  Living Room │    Bedroom       │  Row 2: ny=0.30, nd=0.58
  //  │  nw=0.55     │    nw=0.45       │
  //  │              │                  │
  //  ├──────┬───────┼──────────────────┤  0.30
  //  │ Kit  │ Foyer │ Bathroom  (gap)  │  Row 1: ny=0, nd=0.30
  //  │ 0.47 │ 0.20  │  0.20    (0.13)  │
  //  └──────┴───────┴──────────────────┘  0.0
  //
  {
    id: "REF-1BHK-N-001",
    metadata: {
      bhk: 1, plot_width_ft: 25, plot_depth_ft: 30,
      total_area_sqft: 750, facing: "N", vastu_compliant: true,
      room_count: 6, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 1 — service (ny=0, nd=0.30)
      { name: "Kitchen",    type: "kitchen",   nx: 0,    ny: 0,    nw: 0.47, nd: 0.30, original_width_ft: 11.75, original_depth_ft: 9.0,  zone: "SERVICE" },
      { name: "Foyer",      type: "foyer",     nx: 0.47, ny: 0,    nw: 0.20, nd: 0.30, original_width_ft: 5.0,   original_depth_ft: 9.0,  zone: "ENTRANCE" },
      { name: "Bathroom",   type: "bathroom",  nx: 0.67, ny: 0,    nw: 0.20, nd: 0.30, original_width_ft: 5.0,   original_depth_ft: 9.0,  attached_to: "Bedroom", zone: "SERVICE" },
      // Row 2 — main (ny=0.30, nd=0.58)
      { name: "Living Room", type: "living",   nx: 0,    ny: 0.30, nw: 0.55, nd: 0.58, original_width_ft: 13.75, original_depth_ft: 17.4, zone: "PUBLIC" },
      { name: "Bedroom",    type: "bedroom",   nx: 0.55, ny: 0.30, nw: 0.45, nd: 0.58, original_width_ft: 11.25, original_depth_ft: 17.4, zone: "PRIVATE" },
      // Porch strip — entrance side (north = top)
      { name: "Porch",      type: "porch",     nx: 0.18, ny: 0.88, nw: 0.64, nd: 0.06, original_width_ft: 16.0,  original_depth_ft: 1.8,  zone: "ENTRANCE" },
    ],
    hallway: null,
    adjacency: [
      ["Living Room", "Bedroom"], ["Living Room", "Kitchen"], ["Living Room", "Foyer"],
      ["Bedroom", "Bathroom"], ["Kitchen", "Foyer"], ["Foyer", "Bathroom"],
      ["Porch", "Living Room"],
    ],
  },

  // ─── 1BHK South-facing (25×30) ────────────────────────────────────────
  //
  //  ┌──────┬───────┬──────────────────┐  1.0
  //  │ Kit  │ Foyer │ Bathroom  (gap)  │  Row 1: ny=0.70, nd=0.30
  //  │ 0.47 │ 0.20  │  0.20    (0.13)  │
  //  ├──────┴───────┼──────────────────┤  0.70
  //  │              │                  │
  //  │  Living Room │    Bedroom       │  Row 2: ny=0.12, nd=0.58
  //  │  nw=0.55     │    nw=0.45       │
  //  │              │                  │
  //  ├──────── Porch ──────────────────┤  0.12
  //  │   nx=0.18  nw=0.64  nd=0.06    │  0.06  ← entrance (south)
  //  ├─────────────────────────────────┤
  //  │          (setback)              │
  //  └─────────────────────────────────┘  0.0
  //
  {
    id: "REF-1BHK-S-001",
    metadata: {
      bhk: 1, plot_width_ft: 25, plot_depth_ft: 30,
      total_area_sqft: 750, facing: "S", vastu_compliant: true,
      room_count: 6, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 1 — service (ny=0.70, nd=0.30)
      { name: "Kitchen",    type: "kitchen",   nx: 0,    ny: 0.70, nw: 0.47, nd: 0.30, original_width_ft: 11.75, original_depth_ft: 9.0,  zone: "SERVICE" },
      { name: "Foyer",      type: "foyer",     nx: 0.47, ny: 0.70, nw: 0.20, nd: 0.30, original_width_ft: 5.0,   original_depth_ft: 9.0,  zone: "ENTRANCE" },
      { name: "Bathroom",   type: "bathroom",  nx: 0.67, ny: 0.70, nw: 0.20, nd: 0.30, original_width_ft: 5.0,   original_depth_ft: 9.0,  attached_to: "Bedroom", zone: "SERVICE" },
      // Row 2 — main (ny=0.12, nd=0.58)
      { name: "Living Room", type: "living",   nx: 0,    ny: 0.12, nw: 0.55, nd: 0.58, original_width_ft: 13.75, original_depth_ft: 17.4, zone: "PUBLIC" },
      { name: "Bedroom",    type: "bedroom",   nx: 0.55, ny: 0.12, nw: 0.45, nd: 0.58, original_width_ft: 11.25, original_depth_ft: 17.4, zone: "PRIVATE" },
      // Porch strip — entrance side (south = bottom)
      { name: "Porch",      type: "porch",     nx: 0.18, ny: 0.06, nw: 0.64, nd: 0.06, original_width_ft: 16.0,  original_depth_ft: 1.8,  zone: "ENTRANCE" },
    ],
    hallway: null,
    adjacency: [
      ["Living Room", "Bedroom"], ["Living Room", "Kitchen"], ["Living Room", "Foyer"],
      ["Bedroom", "Bathroom"], ["Kitchen", "Foyer"], ["Foyer", "Bathroom"],
      ["Porch", "Living Room"],
    ],
  },

  // ─── 1BHK East-facing (25×30) ─────────────────────────────────────────
  //
  //  ┌──────────┬────────────────┬──────┐  1.0
  //  │          │                │      │
  //  │ Kitchen  │  Living Room   │      │
  //  │ ny=0.53  │  ny=0.45       │      │
  //  │ nd=0.47  │  nd=0.55       │Porch │
  //  ├──────────┤                │nx=0.88
  //  │ Foyer    │                │nw=0.08
  //  │ nd=0.20  ├────────────────┤nd=0.50
  //  ├──────────┤                │      │
  //  │ Bathroom │   Bedroom      │      │
  //  │ nd=0.20  │   ny=0         │      │
  //  │          │   nd=0.45      │      │
  //  │  (gap)   │                │      │
  //  └──────────┴────────────────┴──────┘  0.0
  //  nx=0       nx=0.30          nx=0.88
  //  nw=0.30    nw=0.58          ← entrance (east)
  //
  {
    id: "REF-1BHK-E-001",
    metadata: {
      bhk: 1, plot_width_ft: 25, plot_depth_ft: 30,
      total_area_sqft: 750, facing: "E", vastu_compliant: false,
      room_count: 6, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Column 1 — service (nx=0, nw=0.30)
      { name: "Kitchen",    type: "kitchen",   nx: 0,    ny: 0.53, nw: 0.30, nd: 0.47, original_width_ft: 7.5,  original_depth_ft: 14.1, zone: "SERVICE" },
      { name: "Foyer",      type: "foyer",     nx: 0,    ny: 0.33, nw: 0.30, nd: 0.20, original_width_ft: 7.5,  original_depth_ft: 6.0,  zone: "ENTRANCE" },
      { name: "Bathroom",   type: "bathroom",  nx: 0,    ny: 0.13, nw: 0.30, nd: 0.20, original_width_ft: 7.5,  original_depth_ft: 6.0,  attached_to: "Bedroom", zone: "SERVICE" },
      // Column 2 — main (nx=0.30, nw=0.58)
      { name: "Living Room", type: "living",   nx: 0.30, ny: 0.45, nw: 0.58, nd: 0.55, original_width_ft: 14.5, original_depth_ft: 16.5, zone: "PUBLIC" },
      { name: "Bedroom",    type: "bedroom",   nx: 0.30, ny: 0,    nw: 0.58, nd: 0.45, original_width_ft: 14.5, original_depth_ft: 13.5, zone: "PRIVATE" },
      // Porch strip — entrance side (east = right)
      { name: "Porch",      type: "porch",     nx: 0.88, ny: 0.25, nw: 0.08, nd: 0.50, original_width_ft: 2.0,  original_depth_ft: 15.0, zone: "ENTRANCE" },
    ],
    hallway: null,
    adjacency: [
      ["Living Room", "Bedroom"], ["Living Room", "Kitchen"], ["Living Room", "Foyer"],
      ["Bedroom", "Bathroom"], ["Kitchen", "Foyer"], ["Foyer", "Bathroom"],
      ["Porch", "Living Room"],
    ],
  },

  // ─── 1BHK West-facing (25×30) ─────────────────────────────────────────
  //
  //  ┌──────┬────────────────┬──────────┐  1.0
  //  │      │                │          │
  //  │      │  Living Room   │ Kitchen  │
  //  │      │  ny=0.45       │ ny=0.53  │
  //  │Porch │  nd=0.55       │ nd=0.47  │
  //  │nx=0  │                ├──────────┤
  //  │nw=0.08                │ Foyer    │
  //  │nd=0.50├───────────────┤ nd=0.20  │
  //  │      │                ├──────────┤
  //  │      │   Bedroom      │ Bathroom │
  //  │      │   ny=0         │ nd=0.20  │
  //  │      │   nd=0.45      │          │
  //  │      │                │  (gap)   │
  //  └──────┴────────────────┴──────────┘  0.0
  //  ← entrance (west)       nx=0.66
  //  nx=0    nx=0.08          nw=0.30
  //          nw=0.58
  //
  {
    id: "REF-1BHK-W-001",
    metadata: {
      bhk: 1, plot_width_ft: 25, plot_depth_ft: 30,
      total_area_sqft: 750, facing: "W", vastu_compliant: false,
      room_count: 6, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Column 1 — service (nx=0.66, nw=0.30)
      { name: "Kitchen",    type: "kitchen",   nx: 0.66, ny: 0.53, nw: 0.30, nd: 0.47, original_width_ft: 7.5,  original_depth_ft: 14.1, zone: "SERVICE" },
      { name: "Foyer",      type: "foyer",     nx: 0.66, ny: 0.33, nw: 0.30, nd: 0.20, original_width_ft: 7.5,  original_depth_ft: 6.0,  zone: "ENTRANCE" },
      { name: "Bathroom",   type: "bathroom",  nx: 0.66, ny: 0.13, nw: 0.30, nd: 0.20, original_width_ft: 7.5,  original_depth_ft: 6.0,  attached_to: "Bedroom", zone: "SERVICE" },
      // Column 2 — main (nx=0.08, nw=0.58)
      { name: "Living Room", type: "living",   nx: 0.08, ny: 0.45, nw: 0.58, nd: 0.55, original_width_ft: 14.5, original_depth_ft: 16.5, zone: "PUBLIC" },
      { name: "Bedroom",    type: "bedroom",   nx: 0.08, ny: 0,    nw: 0.58, nd: 0.45, original_width_ft: 14.5, original_depth_ft: 13.5, zone: "PRIVATE" },
      // Porch strip — entrance side (west = left)
      { name: "Porch",      type: "porch",     nx: 0,    ny: 0.25, nw: 0.08, nd: 0.50, original_width_ft: 2.0,  original_depth_ft: 15.0, zone: "ENTRANCE" },
    ],
    hallway: null,
    adjacency: [
      ["Living Room", "Bedroom"], ["Living Room", "Kitchen"], ["Living Room", "Foyer"],
      ["Bedroom", "Bathroom"], ["Kitchen", "Foyer"], ["Foyer", "Bathroom"],
      ["Porch", "Living Room"],
    ],
  },
];
