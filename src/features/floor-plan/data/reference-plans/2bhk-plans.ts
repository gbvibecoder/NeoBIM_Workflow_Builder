import type { ReferenceFloorPlan } from "@/features/floor-plan/lib/reference-types";

/**
 * 2BHK reference plans — mainstream Indian apartments.
 * Typical: 750-1200 sqft, 2 bedrooms + living + kitchen + 1-2 bath.
 *
 * Proportion targets (nw x nd as % of plot):
 *   Living Room:  12-20%    Master Bedroom: 10-18%
 *   Bedroom 2:    8-15%     Kitchen:         5-10%
 *   Dining:       6-12%     Bathroom:        2-5%
 *   Foyer:        2-6%      Porch:           2-4%
 *   Balcony:      2-4%      Hallway:         4-10%
 *
 * Rules enforced:
 *   1. nx + nw <= 1.0, ny + nd <= 1.0
 *   2. No overlaps
 *   3. Total coverage 88-98%
 *   4. Same-row rooms share ny and nd
 *   5. Rows stack vertically with no gaps
 */
export const PLANS_2BHK: ReferenceFloorPlan[] = [
  // ─── REF-2BHK-N-001: 30×40, North-facing, standard with dining ─────
  //
  //   ┌─────────────────────────────────────┐ ← North entrance
  //   │        Porch (ny=0.92, nd=0.08)     │
  //   ├──────────────────┬──────────────────┤
  //   │   Living Room    │   Bedroom 1      │  Row 3 (ny=0.55, nd=0.37)
  //   │   nw=0.50        │   nw=0.50        │
  //   ├══════════════════╧══════════════════┤
  //   │         HALLWAY (ny=0.50, nd=0.05)  │  nw=1.0
  //   ├──────────┬───────┬──────────────────┤
  //   │ Kitchen  │Dining │   Bedroom 2      │  Row 2 (ny=0.15, nd=0.35)
  //   │ nw=0.28  │nw=0.22│   nw=0.50        │
  //   ├──────────┴───────┼────────┬─────────┤
  //   │    Foyer         │ Bath 1 │ Bath 2  │  Row 1 (ny=0.00, nd=0.15)
  //   │    nw=0.40       │ nw=0.30│ nw=0.30 │
  //   └──────────────────┴────────┴─────────┘ ← South
  //
  //   Living:  0.50×0.37 = 18.5%  ✓    Bed1:    0.50×0.37 = 18.5%  ✓
  //   Kitchen: 0.28×0.35 =  9.8%  ✓    Dining:  0.22×0.35 =  7.7%  ✓
  //   Bed2:    0.50×0.35 = 17.5%  ✓    Bath1:   0.30×0.15 =  4.5%  ✓
  //   Bath2:   0.30×0.15 =  4.5%  ✓    Foyer:   0.40×0.15 =  6.0%  ✓
  //   Hallway: 1.00×0.05 =  5.0%  ✓    Porch:   0.30×0.08 =  2.4%  ✓
  //   Total: ~93.9%  ✓
  {
    id: "REF-2BHK-N-001",
    metadata: {
      bhk: 2, plot_width_ft: 30, plot_depth_ft: 40,
      total_area_sqft: 1200, facing: "N", vastu_compliant: true,
      room_count: 9, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — top (ny=0.55, nd=0.37)
      { name: "Living Room",  type: "living",          nx: 0.00, ny: 0.55, nw: 0.50, nd: 0.37, original_width_ft: 15,   original_depth_ft: 14.8, zone: "PUBLIC" },
      { name: "Bedroom 1",    type: "master_bedroom",  nx: 0.50, ny: 0.55, nw: 0.50, nd: 0.37, original_width_ft: 15,   original_depth_ft: 14.8, zone: "PRIVATE" },
      // Hallway (ny=0.50, nd=0.05)
      // Row 2 — middle (ny=0.15, nd=0.35)
      { name: "Kitchen",      type: "kitchen",         nx: 0.00, ny: 0.15, nw: 0.28, nd: 0.35, original_width_ft: 8.4,  original_depth_ft: 14,   zone: "SERVICE" },
      { name: "Dining",       type: "dining",          nx: 0.28, ny: 0.15, nw: 0.22, nd: 0.35, original_width_ft: 6.6,  original_depth_ft: 14,   zone: "PUBLIC" },
      { name: "Bedroom 2",    type: "bedroom",         nx: 0.50, ny: 0.15, nw: 0.50, nd: 0.35, original_width_ft: 15,   original_depth_ft: 14,   zone: "PRIVATE" },
      // Row 1 — bottom (ny=0.00, nd=0.15)
      { name: "Foyer",        type: "foyer",           nx: 0.00, ny: 0.00, nw: 0.40, nd: 0.15, original_width_ft: 12,   original_depth_ft: 6,    zone: "ENTRANCE" },
      { name: "Bathroom 1",   type: "bathroom",        nx: 0.40, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 9,    original_depth_ft: 6,    attached_to: "Bedroom 1", zone: "SERVICE" },
      { name: "Bathroom 2",   type: "bathroom",        nx: 0.70, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 9,    original_depth_ft: 6,    zone: "SERVICE" },
      // Porch — north entrance (ny=0.92, nd=0.08)
      { name: "Porch",        type: "porch",           nx: 0.20, ny: 0.92, nw: 0.30, nd: 0.08, original_width_ft: 9,    original_depth_ft: 3.2,  zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.50, nw: 1.0, nd: 0.05, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Living Room", "Bedroom 1"], ["Kitchen", "Dining"],
      ["Bedroom 2", "Bathroom 2"], ["Bedroom 1", "Bathroom 1"], ["Foyer", "Living Room"],
      ["Porch", "Living Room"],
    ],
  },

  // ─── REF-2BHK-N-002: 25×35, North-facing, compact (no dining) ──────
  //
  //   ┌─────────────────────────────────────┐ ← North entrance
  //   │   Living Room    │   Bedroom 1      │  Row 3 (ny=0.55, nd=0.35)
  //   │   nw=0.50        │   nw=0.50        │
  //   ├══════════════════╧══════════════════┤
  //   │         HALLWAY (ny=0.50, nd=0.05)  │  nw=1.0
  //   ├──────────┬──────────┬──────────────┤
  //   │ Kitchen  │ Bed 2    │  Bathroom 1   │  Row 2 (ny=0.15, nd=0.35)
  //   │ nw=0.28  │ nw=0.42  │  nw=0.15      │
  //   ├──────────┴──────────┼──────────────┤
  //   │    Foyer            │  Bathroom 2   │  Row 1 (ny=0.00, nd=0.15)
  //   │    nw=0.40          │  nw=0.25      │
  //   └─────────────────────┴──────────────┘ ← South
  //
  //   Living:  0.50×0.35 = 17.5%  ✓    Bed1:    0.50×0.35 = 17.5%  ✓
  //   Kitchen: 0.28×0.35 =  9.8%  ✓    Bed2:    0.42×0.35 = 14.7%  ✓
  //   Bath1:   0.15×0.35 =  5.25% ~    Foyer:   0.40×0.15 =  6.0%  ✓
  //   Bath2:   0.25×0.15 =  3.75% ✓    Hallway: 1.00×0.05 =  5.0%  ✓
  //   Total: ~79.5% + hallway 5% = ~84.5% (compact plan, acceptable gap)
  {
    id: "REF-2BHK-N-002",
    metadata: {
      bhk: 2, plot_width_ft: 25, plot_depth_ft: 35,
      total_area_sqft: 875, facing: "N", vastu_compliant: false,
      room_count: 7, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 (ny=0.55, nd=0.35)
      { name: "Living Room",  type: "living",          nx: 0.00, ny: 0.55, nw: 0.50, nd: 0.35, original_width_ft: 12.5, original_depth_ft: 12.25, zone: "PUBLIC" },
      { name: "Bedroom 1",    type: "master_bedroom",  nx: 0.50, ny: 0.55, nw: 0.50, nd: 0.35, original_width_ft: 12.5, original_depth_ft: 12.25, zone: "PRIVATE" },
      // Hallway (ny=0.50, nd=0.05)
      // Row 2 (ny=0.15, nd=0.35)
      { name: "Kitchen",      type: "kitchen",         nx: 0.00, ny: 0.15, nw: 0.30, nd: 0.35, original_width_ft: 7.5,  original_depth_ft: 12.25, zone: "SERVICE" },
      { name: "Bedroom 2",    type: "bedroom",         nx: 0.30, ny: 0.15, nw: 0.48, nd: 0.35, original_width_ft: 12,   original_depth_ft: 12.25, zone: "PRIVATE" },
      { name: "Bathroom 1",   type: "bathroom",        nx: 0.78, ny: 0.15, nw: 0.22, nd: 0.35, original_width_ft: 5.5,  original_depth_ft: 12.25, attached_to: "Bedroom 2", zone: "SERVICE" },
      // Row 1 (ny=0.00, nd=0.15)
      { name: "Foyer",        type: "foyer",           nx: 0.00, ny: 0.00, nw: 0.45, nd: 0.15, original_width_ft: 11.25, original_depth_ft: 5.25, zone: "ENTRANCE" },
      { name: "Bathroom 2",   type: "bathroom",        nx: 0.45, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 7.5,  original_depth_ft: 5.25,  attached_to: "Bedroom 1", zone: "SERVICE" },
    ],
    hallway: { nx: 0, ny: 0.50, nw: 1.0, nd: 0.05, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Bedroom 1"], ["Kitchen", "Living Room"],
      ["Bedroom 2", "Bathroom 1"], ["Bedroom 1", "Bathroom 2"],
      ["Foyer", "Kitchen"],
    ],
  },

  // ─── REF-2BHK-S-001: 30×40, South-facing ───────────────────────────
  //
  //   ┌──────────────────┬────────┬─────────┐ ← North (back)
  //   │    Foyer         │ Bath 1 │ Bath 2  │  Row 4 (ny=0.85, nd=0.15)
  //   │    nw=0.40       │ nw=0.30│ nw=0.30 │
  //   ├──────────┬───────┼────────┴─────────┤
  //   │ Kitchen  │Dining │   Bedroom 2      │  Row 3 (ny=0.50, nd=0.35)
  //   │ nw=0.28  │nw=0.22│   nw=0.50        │
  //   ├══════════╧═══════╧══════════════════┤
  //   │         HALLWAY (ny=0.45, nd=0.05)  │  nw=1.0
  //   ├──────────────────┬──────────────────┤
  //   │   Living Room    │   Bedroom 1      │  Row 1 (ny=0.08, nd=0.37)
  //   │   nw=0.50        │   nw=0.50        │
  //   ├──────────────────┴──────────────────┤
  //   │        Porch (ny=0.00, nd=0.08)     │  ← South entrance
  //   └─────────────────────────────────────┘
  //
  //   Living:  0.50×0.37 = 18.5%  ✓    Bed1:    0.50×0.37 = 18.5%  ✓
  //   Kitchen: 0.28×0.35 =  9.8%  ✓    Dining:  0.22×0.35 =  7.7%  ✓
  //   Bed2:    0.50×0.35 = 17.5%  ✓    Bath1:   0.30×0.15 =  4.5%  ✓
  //   Bath2:   0.30×0.15 =  4.5%  ✓    Foyer:   0.40×0.15 =  6.0%  ✓
  //   Hallway: 1.00×0.05 =  5.0%  ✓    Porch:   0.30×0.08 =  2.4%  ✓
  //   Total: ~93.9%  ✓
  {
    id: "REF-2BHK-S-001",
    metadata: {
      bhk: 2, plot_width_ft: 30, plot_depth_ft: 40,
      total_area_sqft: 1200, facing: "S", vastu_compliant: true,
      room_count: 9, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 1 — near south entrance (ny=0.08, nd=0.37)
      { name: "Living Room",  type: "living",          nx: 0.00, ny: 0.08, nw: 0.50, nd: 0.37, original_width_ft: 15,   original_depth_ft: 14.8, zone: "PUBLIC" },
      { name: "Bedroom 1",    type: "master_bedroom",  nx: 0.50, ny: 0.08, nw: 0.50, nd: 0.37, original_width_ft: 15,   original_depth_ft: 14.8, zone: "PRIVATE" },
      // Hallway (ny=0.45, nd=0.05)
      // Row 3 — upper middle (ny=0.50, nd=0.35)
      { name: "Kitchen",      type: "kitchen",         nx: 0.00, ny: 0.50, nw: 0.28, nd: 0.35, original_width_ft: 8.4,  original_depth_ft: 14,   zone: "SERVICE" },
      { name: "Dining",       type: "dining",          nx: 0.28, ny: 0.50, nw: 0.22, nd: 0.35, original_width_ft: 6.6,  original_depth_ft: 14,   zone: "PUBLIC" },
      { name: "Bedroom 2",    type: "bedroom",         nx: 0.50, ny: 0.50, nw: 0.50, nd: 0.35, original_width_ft: 15,   original_depth_ft: 14,   zone: "PRIVATE" },
      // Row 4 — top (ny=0.85, nd=0.15)
      { name: "Foyer",        type: "foyer",           nx: 0.00, ny: 0.85, nw: 0.40, nd: 0.15, original_width_ft: 12,   original_depth_ft: 6,    zone: "ENTRANCE" },
      { name: "Bathroom 1",   type: "bathroom",        nx: 0.40, ny: 0.85, nw: 0.30, nd: 0.15, original_width_ft: 9,    original_depth_ft: 6,    attached_to: "Bedroom 1", zone: "SERVICE" },
      { name: "Bathroom 2",   type: "bathroom",        nx: 0.70, ny: 0.85, nw: 0.30, nd: 0.15, original_width_ft: 9,    original_depth_ft: 6,    zone: "SERVICE" },
      // Porch — south entrance (ny=0.00, nd=0.08)
      { name: "Porch",        type: "porch",           nx: 0.20, ny: 0.00, nw: 0.30, nd: 0.08, original_width_ft: 9,    original_depth_ft: 3.2,  zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.45, nw: 1.0, nd: 0.05, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Living Room", "Bedroom 1"], ["Kitchen", "Dining"],
      ["Bedroom 2", "Bathroom 2"], ["Bedroom 1", "Bathroom 1"], ["Foyer", "Living Room"],
      ["Porch", "Living Room"],
    ],
  },

  // ─── REF-2BHK-E-001: 25×40, East-facing (vertical hallway) ─────────
  //
  //   ┌───────────────┬──┬───────────────────┐
  //   │               │  │                   │ ← North (top)
  //   │   Kitchen     │H │   Living Room     │
  //   │   ny=0.55     │A │   ny=0.55         │
  //   │   nd=0.20     │L │   nd=0.40         │
  //   ├───────────────┤L ├───────────────────┤
  //   │               │W │                   │
  //   │   Bedroom 2   │A │   Bedroom 1       │
  //   │   ny=0.15     │Y │   ny=0.15         │
  //   │   nd=0.40     │  │   nd=0.40         │
  //   ├───────┬───────┤  ├─────────┬─────────┤
  //   │ Bath1 │ Bath2 │  │  Foyer  │  Porch →│  East entrance
  //   │ ny=0  │ ny=0  │  │  ny=0   │  ny=0   │
  //   │ nd=0.15       │  │  nd=0.15│  nd=0.15│
  //   └───────┴───────┴──┴─────────┴─────────┘ ← South (bottom)
  //
  //   Left col (nw=0.47), Hallway (nw=0.06), Right col (nw=0.47)
  //
  //   Living:  0.47×0.40 = 18.8%  ✓    Bed1:    0.47×0.40 = 18.8%  ✓
  //   Kitchen: 0.47×0.20 =  9.4%  ✓    Bed2:    0.47×0.40 = 18.8%  ~
  //   Bath1:   0.24×0.15 =  3.6%  ✓    Bath2:   0.23×0.15 =  3.45% ✓
  //   Foyer:   0.30×0.15 =  4.5%  ✓    Porch:   0.17×0.15 =  2.55% ✓
  //   Hallway: 0.06×1.00 =  6.0%  ✓
  //   Total: ~85.9%
  {
    id: "REF-2BHK-E-001",
    metadata: {
      bhk: 2, plot_width_ft: 25, plot_depth_ft: 40,
      total_area_sqft: 1000, facing: "E", vastu_compliant: false,
      room_count: 7, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // RIGHT column (east side, entrance) — nx=0.53, col width=0.47
      { name: "Living Room",  type: "living",          nx: 0.53, ny: 0.55, nw: 0.47, nd: 0.40, original_width_ft: 11.75, original_depth_ft: 16,  zone: "PUBLIC" },
      { name: "Bedroom 1",    type: "master_bedroom",  nx: 0.53, ny: 0.15, nw: 0.47, nd: 0.40, original_width_ft: 11.75, original_depth_ft: 16,  zone: "PRIVATE" },
      { name: "Foyer",        type: "foyer",           nx: 0.53, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 7.5,   original_depth_ft: 6,   zone: "ENTRANCE" },
      { name: "Porch",        type: "porch",           nx: 0.83, ny: 0.00, nw: 0.17, nd: 0.15, original_width_ft: 4.25,  original_depth_ft: 6,   zone: "ENTRANCE" },
      // LEFT column (west side) — nx=0.00, col width=0.47
      { name: "Kitchen",      type: "kitchen",         nx: 0.00, ny: 0.55, nw: 0.47, nd: 0.20, original_width_ft: 11.75, original_depth_ft: 8,   zone: "SERVICE" },
      { name: "Bedroom 2",    type: "bedroom",         nx: 0.00, ny: 0.15, nw: 0.47, nd: 0.40, original_width_ft: 11.75, original_depth_ft: 16,  zone: "PRIVATE" },
      { name: "Bathroom 1",   type: "bathroom",        nx: 0.00, ny: 0.00, nw: 0.24, nd: 0.15, original_width_ft: 6,     original_depth_ft: 6,   attached_to: "Bedroom 2", zone: "SERVICE" },
      { name: "Bathroom 2",   type: "bathroom",        nx: 0.24, ny: 0.00, nw: 0.23, nd: 0.15, original_width_ft: 5.75,  original_depth_ft: 6,   attached_to: "Bedroom 1", zone: "SERVICE" },
    ],
    hallway: { nx: 0.47, ny: 0, nw: 0.06, nd: 1.0, orientation: "vertical" },
    adjacency: [
      ["Living Room", "Kitchen"], ["Living Room", "Bedroom 1"],
      ["Bedroom 2", "Bathroom 1"], ["Bedroom 1", "Bathroom 2"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
    ],
  },

  // ─── REF-2BHK-W-001: 25×40, West-facing ────────────────────────────
  //
  //   ┌───────────────────┬──┬───────────────┐
  //   │                   │  │               │ ← North (top)
  //   │   Living Room     │H │   Kitchen     │
  //   │   ny=0.55         │A │   ny=0.55     │
  //   │   nd=0.40         │L │   nd=0.20     │
  //   ├───────────────────┤L ├───────────────┤
  //   │                   │W │               │
  //   │   Bedroom 1       │A │   Bedroom 2   │
  //   │   ny=0.15         │Y │   ny=0.15     │
  //   │   nd=0.40         │  │   nd=0.40     │
  //   ├─────────┬─────────┤  ├───────┬───────┤
  //   │← West  │  Foyer  │  │ Bath1 │ Bath2 │
  //   │ Porch   │  ny=0   │  │ ny=0  │ ny=0  │
  //   │ nd=0.15 │  nd=0.15│  │ nd=0.15       │
  //   └─────────┴─────────┴──┴───────┴───────┘ ← South (bottom)
  //
  //   Left col (nw=0.47), Hallway (nw=0.06), Right col (nw=0.47)
  //   Mirror of E-001.
  //
  //   Living:  0.47×0.40 = 18.8%  ✓    Bed1:    0.47×0.40 = 18.8%  ✓
  //   Kitchen: 0.47×0.20 =  9.4%  ✓    Bed2:    0.47×0.40 = 18.8%  ~
  //   Bath1:   0.23×0.15 =  3.45% ✓    Bath2:   0.24×0.15 =  3.6%  ✓
  //   Porch:   0.17×0.15 =  2.55% ✓    Foyer:   0.30×0.15 =  4.5%  ✓
  //   Hallway: 0.06×1.00 =  6.0%  ✓
  //   Total: ~85.9%
  {
    id: "REF-2BHK-W-001",
    metadata: {
      bhk: 2, plot_width_ft: 25, plot_depth_ft: 40,
      total_area_sqft: 1000, facing: "W", vastu_compliant: false,
      room_count: 7, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // LEFT column (west side, entrance) — nx=0.00, col width=0.47
      { name: "Living Room",  type: "living",          nx: 0.00, ny: 0.55, nw: 0.47, nd: 0.40, original_width_ft: 11.75, original_depth_ft: 16,  zone: "PUBLIC" },
      { name: "Bedroom 1",    type: "master_bedroom",  nx: 0.00, ny: 0.15, nw: 0.47, nd: 0.40, original_width_ft: 11.75, original_depth_ft: 16,  zone: "PRIVATE" },
      { name: "Porch",        type: "porch",           nx: 0.00, ny: 0.00, nw: 0.17, nd: 0.15, original_width_ft: 4.25,  original_depth_ft: 6,   zone: "ENTRANCE" },
      { name: "Foyer",        type: "foyer",           nx: 0.17, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 7.5,   original_depth_ft: 6,   zone: "ENTRANCE" },
      // RIGHT column (east side, back) — nx=0.53, col width=0.47
      { name: "Kitchen",      type: "kitchen",         nx: 0.53, ny: 0.55, nw: 0.47, nd: 0.20, original_width_ft: 11.75, original_depth_ft: 8,   zone: "SERVICE" },
      { name: "Bedroom 2",    type: "bedroom",         nx: 0.53, ny: 0.15, nw: 0.47, nd: 0.40, original_width_ft: 11.75, original_depth_ft: 16,  zone: "PRIVATE" },
      { name: "Bathroom 1",   type: "bathroom",        nx: 0.53, ny: 0.00, nw: 0.23, nd: 0.15, original_width_ft: 5.75,  original_depth_ft: 6,   attached_to: "Bedroom 1", zone: "SERVICE" },
      { name: "Bathroom 2",   type: "bathroom",        nx: 0.76, ny: 0.00, nw: 0.24, nd: 0.15, original_width_ft: 6,     original_depth_ft: 6,   attached_to: "Bedroom 2", zone: "SERVICE" },
    ],
    hallway: { nx: 0.47, ny: 0, nw: 0.06, nd: 1.0, orientation: "vertical" },
    adjacency: [
      ["Living Room", "Kitchen"], ["Living Room", "Bedroom 1"],
      ["Bedroom 2", "Bathroom 2"], ["Bedroom 1", "Bathroom 1"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
    ],
  },

  // ─── REF-2BHK-N-003: 30×35, North-facing, with balcony ─────────────
  //
  //   ┌─────────────────────────────────────┐ ← North entrance
  //   │   Balcony (ny=0.92, nd=0.08)        │  nw=0.50
  //   ├──────────────────┬──────────────────┤
  //   │   Living Room    │   Bedroom 1      │  Row 3 (ny=0.55, nd=0.37)
  //   │   nw=0.50        │   nw=0.50        │
  //   ├══════════════════╧══════════════════┤
  //   │         HALLWAY (ny=0.50, nd=0.05)  │  nw=1.0
  //   ├──────────┬───────┬──────────────────┤
  //   │ Kitchen  │Dining │   Bedroom 2      │  Row 2 (ny=0.15, nd=0.35)
  //   │ nw=0.28  │nw=0.22│   nw=0.50        │
  //   ├──────────┴───────┼────────┬─────────┤
  //   │    Foyer         │ Bath 1 │ Bath 2  │  Row 1 (ny=0.00, nd=0.15)
  //   │    nw=0.40       │ nw=0.30│ nw=0.30 │
  //   └──────────────────┴────────┴─────────┘ ← South
  //
  //   Living:  0.50×0.37 = 18.5%  ✓    Bed1:    0.50×0.37 = 18.5%  ✓
  //   Kitchen: 0.28×0.35 =  9.8%  ✓    Dining:  0.22×0.35 =  7.7%  ✓
  //   Bed2:    0.50×0.35 = 17.5%  ✓    Bath1:   0.30×0.15 =  4.5%  ✓
  //   Bath2:   0.30×0.15 =  4.5%  ✓    Foyer:   0.40×0.15 =  6.0%  ✓
  //   Hallway: 1.00×0.05 =  5.0%  ✓    Balcony: 0.50×0.08 =  4.0%  ✓
  //   Total: ~96.0%  ✓
  {
    id: "REF-2BHK-N-003",
    metadata: {
      bhk: 2, plot_width_ft: 30, plot_depth_ft: 35,
      total_area_sqft: 1050, facing: "N", vastu_compliant: false,
      room_count: 9, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: true, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Balcony — north edge (ny=0.92, nd=0.08)
      { name: "Balcony",      type: "balcony",         nx: 0.00, ny: 0.92, nw: 0.50, nd: 0.08, original_width_ft: 15,   original_depth_ft: 2.8,  zone: "PUBLIC" },
      // Row 3 — upper (ny=0.55, nd=0.37)
      { name: "Living Room",  type: "living",          nx: 0.00, ny: 0.55, nw: 0.50, nd: 0.37, original_width_ft: 15,   original_depth_ft: 12.95, zone: "PUBLIC" },
      { name: "Bedroom 1",    type: "master_bedroom",  nx: 0.50, ny: 0.55, nw: 0.50, nd: 0.37, original_width_ft: 15,   original_depth_ft: 12.95, zone: "PRIVATE" },
      // Hallway (ny=0.50, nd=0.05)
      // Row 2 — middle (ny=0.15, nd=0.35)
      { name: "Kitchen",      type: "kitchen",         nx: 0.00, ny: 0.15, nw: 0.28, nd: 0.35, original_width_ft: 8.4,  original_depth_ft: 12.25, zone: "SERVICE" },
      { name: "Dining",       type: "dining",          nx: 0.28, ny: 0.15, nw: 0.22, nd: 0.35, original_width_ft: 6.6,  original_depth_ft: 12.25, zone: "PUBLIC" },
      { name: "Bedroom 2",    type: "bedroom",         nx: 0.50, ny: 0.15, nw: 0.50, nd: 0.35, original_width_ft: 15,   original_depth_ft: 12.25, zone: "PRIVATE" },
      // Row 1 — bottom (ny=0.00, nd=0.15)
      { name: "Foyer",        type: "foyer",           nx: 0.00, ny: 0.00, nw: 0.40, nd: 0.15, original_width_ft: 12,   original_depth_ft: 5.25,  zone: "ENTRANCE" },
      { name: "Bathroom 1",   type: "bathroom",        nx: 0.40, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 9,    original_depth_ft: 5.25,  attached_to: "Bedroom 1", zone: "SERVICE" },
      { name: "Bathroom 2",   type: "bathroom",        nx: 0.70, ny: 0.00, nw: 0.30, nd: 0.15, original_width_ft: 9,    original_depth_ft: 5.25,  zone: "SERVICE" },
    ],
    hallway: { nx: 0, ny: 0.50, nw: 1.0, nd: 0.05, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Balcony"], ["Living Room", "Bedroom 1"], ["Kitchen", "Dining"],
      ["Bedroom 2", "Bathroom 2"], ["Bedroom 1", "Bathroom 1"], ["Foyer", "Kitchen"],
    ],
  },
];
