import type { ReferenceFloorPlan } from "@/features/floor-plan/lib/reference-types";

/**
 * 3BHK reference plans — the most common Indian residential type.
 * Typical: 1000-1800 sqft, 3 bedrooms + living + kitchen + dining + 2 bath.
 *
 * ALL rooms verified against proportion targets (nw×nd as % of unit square):
 *   Living 12-20%  | Master Bed 10-18% | Bed 2/3 8-15%
 *   Kitchen 5-10%  | Dining 6-12%      | Bath 2-6%
 *   Foyer 2-6%     | Porch 2-4%        | Utility 1.5-4%
 *   Pooja 1-3%     | Hallway 5-12%     | Sitout 2-5%
 *
 * Layout invariants:
 *   1. nx + nw <= 1.0  and  ny + nd <= 1.0
 *   2. No overlapping rooms
 *   3. Total coverage 88-98%
 *   4. Same-row rooms share ny and nd
 *   5. Rows stack vertically with no gaps
 */
export const PLANS_3BHK: ReferenceFloorPlan[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // 1. REF-3BHK-N-001 — 40×40 (1600sqft) North-facing, standard spine
  // ═══════════════════════════════════════════════════════════════════════
  // Row 1 (ny=0.00, nd=0.12): Foyer(0.35)=4.2% | Ensuite(0.18)=2.16% | Bath2(0.17)=2.04% | extra(0.30)=3.6%
  // Hallway (ny=0.12, nd=0.07): full-width=7%
  // Row 2 (ny=0.19, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Row 3 (ny=0.55, nd=0.35): Living(0.40)=14% | Dining(0.25)=8.75% | MasterBed(0.35)=12.25%
  // Row 4 (ny=0.90, nd=0.10): Porch(0.20)=2%
  // Total: 4.2+2.16+2.04+3.6 +7 +9+13.68+13.32 +14+8.75+12.25 +2 = 92%
  {
    id: "REF-3BHK-N-001",
    metadata: {
      bhk: 3, plot_width_ft: 40, plot_depth_ft: 40,
      total_area_sqft: 1600, facing: "N", vastu_compliant: true,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — north public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.55, nw: 0.40, nd: 0.35, original_width_ft: 16, original_depth_ft: 14, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.40, ny: 0.55, nw: 0.25, nd: 0.35, original_width_ft: 10, original_depth_ft: 14, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.55, nw: 0.35, nd: 0.35, original_width_ft: 14, original_depth_ft: 14, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.19, nw: 0.25, nd: 0.36, original_width_ft: 10, original_depth_ft: 14.4, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.25, ny: 0.19, nw: 0.38, nd: 0.36, original_width_ft: 15.2, original_depth_ft: 14.4, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.19, nw: 0.37, nd: 0.36, original_width_ft: 14.8, original_depth_ft: 14.4, zone: "PRIVATE" },
      // Row 1 — service strip
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.35, nd: 0.12, original_width_ft: 14, original_depth_ft: 4.8, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.35, ny: 0, nw: 0.18, nd: 0.12, original_width_ft: 7.2, original_depth_ft: 4.8, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.53, ny: 0, nw: 0.17, nd: 0.12, original_width_ft: 6.8, original_depth_ft: 4.8, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.70, ny: 0, nw: 0.30, nd: 0.12, original_width_ft: 12, original_depth_ft: 4.8, zone: "SERVICE" },
      // Row 4 — porch
      { name: "Porch", type: "porch", nx: 0.40, ny: 0.90, nw: 0.20, nd: 0.10, original_width_ft: 8, original_depth_ft: 4, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.12, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Living Room", "Kitchen"], ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Master Bedroom", "Bathroom 1"],
      ["Bedroom 2", "Bathroom 2"], ["Porch", "Living Room"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 2. REF-3BHK-N-002 — 35×40 (1400sqft) North-facing, compact
  // ═══════════════════════════════════════════════════════════════════════
  // Row 1 (ny=0.00, nd=0.13): Foyer(0.40)=5.2% | Bath1(0.18)=2.34% | Bath2(0.17)=2.21% | store(0.25)=3.25%
  // Hallway (ny=0.13, nd=0.07): full-width=7%
  // Row 2 (ny=0.20, nd=0.35): Kitchen(0.28)=9.8% | Bed2(0.36)=12.6% | Bed3(0.36)=12.6%
  // Row 3 (ny=0.55, nd=0.35): Living(0.42)=14.7% | Dining(0.23)=8.05% | MasterBed(0.35)=12.25%
  // Row 4 (ny=0.90, nd=0.10): Porch(0.20)=2%
  // Total: 5.2+2.34+2.21+3.25 +7 +9.8+12.6+12.6 +14.7+8.05+12.25 +2 = 91.8%
  {
    id: "REF-3BHK-N-002",
    metadata: {
      bhk: 3, plot_width_ft: 35, plot_depth_ft: 40,
      total_area_sqft: 1400, facing: "N", vastu_compliant: true,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — north public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.55, nw: 0.42, nd: 0.35, original_width_ft: 14.7, original_depth_ft: 14, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.42, ny: 0.55, nw: 0.23, nd: 0.35, original_width_ft: 8.05, original_depth_ft: 14, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.55, nw: 0.35, nd: 0.35, original_width_ft: 12.25, original_depth_ft: 14, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.20, nw: 0.28, nd: 0.35, original_width_ft: 9.8, original_depth_ft: 14, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.28, ny: 0.20, nw: 0.36, nd: 0.35, original_width_ft: 12.6, original_depth_ft: 14, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.64, ny: 0.20, nw: 0.36, nd: 0.35, original_width_ft: 12.6, original_depth_ft: 14, zone: "PRIVATE" },
      // Row 1 — service strip
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.40, nd: 0.13, original_width_ft: 14, original_depth_ft: 5.2, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.40, ny: 0, nw: 0.18, nd: 0.13, original_width_ft: 6.3, original_depth_ft: 5.2, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.58, ny: 0, nw: 0.17, nd: 0.13, original_width_ft: 5.95, original_depth_ft: 5.2, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.75, ny: 0, nw: 0.25, nd: 0.13, original_width_ft: 8.75, original_depth_ft: 5.2, zone: "SERVICE" },
      // Row 4 — porch
      { name: "Porch", type: "porch", nx: 0.40, ny: 0.90, nw: 0.20, nd: 0.10, original_width_ft: 7, original_depth_ft: 4, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.13, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Living Room", "Kitchen"], ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Master Bedroom", "Bathroom 1"],
      ["Bedroom 2", "Bathroom 2"], ["Porch", "Living Room"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 3. REF-3BHK-S-001 — 40×40 (1600sqft) South-facing
  // ═══════════════════════════════════════════════════════════════════════
  // South-facing: entrance at south (ny=0), public rooms near south, private at north.
  // Row 1 (ny=0.00, nd=0.35): Living(0.40)=14% | Dining(0.25)=8.75% | Foyer(0.15)=5.25% | Porch(0.20)=not full nd
  //   Porch: nx=0.80, ny=0.00, nw=0.20, nd=0.10 = 2%
  //   Foyer occupies full nd: 0.15×0.35=5.25%
  // Hallway (ny=0.35, nd=0.07): full-width=7%
  // Row 2 (ny=0.42, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Row 3 (ny=0.78, nd=0.12): MasterBed(0.35)=4.2% — too small!
  // Redesign: flip N-001 vertically.
  // Row 1 (ny=0.00, nd=0.35): Living(0.40)=14% | Dining(0.25)=8.75% | MasterBed(0.35)=12.25%
  // Hallway (ny=0.35, nd=0.07): full-width=7%
  // Row 2 (ny=0.42, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Row 3 (ny=0.78, nd=0.12): Foyer(0.35)=4.2% | Bath1(0.18)=2.16% | Bath2(0.17)=2.04% | extra(0.30)=3.6%
  // Row 4 (ny=0.90, nd=0.10): Porch(0.20)=2%
  // Wait — south facing means entrance is at south. If ny=0 is south,
  // public rooms go at bottom (ny=0) and private at top (ny=high).
  // But we want porch at entrance side, so porch at bottom.
  // Row 0 (ny=0.00, nd=0.10): Porch(0.20)=2%
  // Row 1 (ny=0.10, nd=0.12): Foyer(0.35)=4.2% | Bath1(0.18)=2.16% | Bath2(0.17)=2.04% | extra(0.30)=3.6%
  // Hallway (ny=0.22, nd=0.07): full-width=7%
  // Row 2 (ny=0.29, nd=0.35): Living(0.40)=14% | Dining(0.25)=8.75% | MasterBed(0.35)=12.25%
  // Row 3 (ny=0.64, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Total: 2 +4.2+2.16+2.04+3.6 +7 +14+8.75+12.25 +9+13.68+13.32 = 92%
  {
    id: "REF-3BHK-S-001",
    metadata: {
      bhk: 3, plot_width_ft: 40, plot_depth_ft: 40,
      total_area_sqft: 1600, facing: "S", vastu_compliant: true,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 0 — south entrance porch
      { name: "Porch", type: "porch", nx: 0.40, ny: 0, nw: 0.20, nd: 0.10, original_width_ft: 8, original_depth_ft: 4, zone: "ENTRANCE" },
      // Row 1 — service strip near entrance
      { name: "Foyer", type: "foyer", nx: 0, ny: 0.10, nw: 0.35, nd: 0.12, original_width_ft: 14, original_depth_ft: 4.8, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.35, ny: 0.10, nw: 0.18, nd: 0.12, original_width_ft: 7.2, original_depth_ft: 4.8, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.53, ny: 0.10, nw: 0.17, nd: 0.12, original_width_ft: 6.8, original_depth_ft: 4.8, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.70, ny: 0.10, nw: 0.30, nd: 0.12, original_width_ft: 12, original_depth_ft: 4.8, zone: "SERVICE" },
      // Row 2 — public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.29, nw: 0.40, nd: 0.35, original_width_ft: 16, original_depth_ft: 14, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.40, ny: 0.29, nw: 0.25, nd: 0.35, original_width_ft: 10, original_depth_ft: 14, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.29, nw: 0.35, nd: 0.35, original_width_ft: 14, original_depth_ft: 14, zone: "PRIVATE" },
      // Row 3 — private zone at north
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.64, nw: 0.25, nd: 0.36, original_width_ft: 10, original_depth_ft: 14.4, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.25, ny: 0.64, nw: 0.38, nd: 0.36, original_width_ft: 15.2, original_depth_ft: 14.4, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.64, nw: 0.37, nd: 0.36, original_width_ft: 14.8, original_depth_ft: 14.4, zone: "PRIVATE" },
    ],
    hallway: { nx: 0, ny: 0.22, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 2", "Bathroom 2"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 4. REF-3BHK-E-001 — 30×45 (1350sqft) East-facing, vertical hallway
  // ═══════════════════════════════════════════════════════════════════════
  // Vertical hallway at nx=0.47, nw=0.06, nd=1.0 → 6%
  // East entrance: right side (high nx) is public.
  // Left wing (nx=0..0.47):
  //   Col-L Row1 (ny=0.00, nd=0.35): Bed3(nw=0.47)=16.45% — too big
  // Use 3 rows on each side.
  // Left wing (nx=0..0.47):
  //   L-Row1 (ny=0.00, nd=0.28): Kitchen(nw=0.47)=13.16% — too big
  // Need to split into more cells.
  // Left wing (nw_avail=0.47):
  //   L-top (ny=0.65, nd=0.35): Bed2(0.47)=16.45% — too big
  //   L-mid (ny=0.30, nd=0.35): Bed3(0.47)=16.45% — too big
  //   L-bot (ny=0.00, nd=0.30): Kitchen(0.27)=8.1% + Bath2(0.20)=6% — bath too big
  //
  // Better: split left into 2 cols.
  // Left wing (0..0.47):
  //   Top: Bed2(nx=0, nw=0.23, ny=0.55, nd=0.45)=10.35% | Bed3(nx=0.23, nw=0.24, ny=0.55, nd=0.45)=10.8%
  //   Bot: Kitchen(nx=0, nw=0.27, ny=0.00, nd=0.55)=14.85% — too big
  //
  // Let me think differently about E/W facing plans with vertical hallway.
  // Hallway: nx=0.47, nw=0.06, full height → 6%
  // Right wing (nx=0.53, nw up to 0.47):
  //   R-top (ny=0.60, nd=0.40): Living(0.47)=18.8% — too big
  //   Need narrower.
  //
  // Make hallway thinner: nw=0.06.
  // Left (nw=0.47), Right (nw=0.47).
  // Split each side into 3 rows:
  //
  // Right side (entrance, nx=0.53, available_nw=0.47):
  //   R-top (ny=0.62, nd=0.38): Living(0.35)=13.3% + Foyer(0.12)=4.56%
  //   R-mid (ny=0.30, nd=0.32): MasterBed(0.47)=15.04% — OK
  //   R-bot (ny=0.00, nd=0.30): Bath1(0.17)=5.1% — too big. nd=0.15: Bath1(0.17)=2.55%
  //
  // Let me do a cleaner layout:
  // Hallway: nx=0.47, nw=0.06, ny=0, nd=1.0 → 6%
  //
  // RIGHT WING (entrance side, east) nx starts at 0.53:
  //   R-Row3 (ny=0.65, nd=0.35): Living(nw=0.47) = 16.45% ✓ (12-20)
  //   R-Row2 (ny=0.25, nd=0.40): MasterBed(nw=0.33)=13.2% ✓ + Dining(nw=0.14)=5.6% — dining too low
  //     Dining(nw=0.18)=7.2% ✓, MasterBed(nw=0.29)=11.6% ✓
  //   R-Row1 (ny=0.00, nd=0.25): Bath1(nw=0.15)=3.75% ✓ + Foyer(nw=0.32)=8% — foyer too big
  //     Foyer(nw=0.20)=5% ✓ + Bath1(nw=0.15)=3.75% ✓ + Porch(nw=0.12)=3% ✓
  //
  // LEFT WING (nx=0, nw up to 0.47):
  //   L-Row3 (ny=0.65, nd=0.35): Bed2(nw=0.47)=16.45% — too big
  //     Split: Bed2(nw=0.28)=9.8% ✓ + Kitchen(nw=0.19)=6.65% ✓
  //   L-Row2 (ny=0.25, nd=0.40): Bed3(nw=0.30)=12% ✓ + remaining(nw=0.17)=6.8%
  //   L-Row1 (ny=0.00, nd=0.25): Bath2(nw=0.20)=5% ✓ + storage(nw=0.27)=6.75%
  //
  // Let me settle on something cleaner:
  //
  // Hallway: nx=0.47, nw=0.06, ny=0, nd=1.0 → 6%
  //
  // RIGHT (east entrance, nx=0.53, max nw=0.47):
  //   Foyer:    nx=0.53, ny=0.00, nw=0.20, nd=0.15 = 3%
  //   Porch:    nx=0.73, ny=0.00, nw=0.15, nd=0.15 = 2.25%
  //   Bath1:    nx=0.88, ny=0.00, nw=0.12, nd=0.15 = 1.8% — low, bump
  //   Bath1:    nx=0.53, ny=0.15, nw=0.18, nd=0.15 = 2.7%
  //   MasterBed:nx=0.53, ny=0.30, nw=0.47, nd=0.35 = 16.45% ✓
  //   Living:   nx=0.53, ny=0.65, nw=0.47, nd=0.35 = 16.45% ✓
  //
  // This is getting messy with non-row alignment. Let me use a simpler approach with clear rows.
  //
  // For E/W facing, use horizontal rows but with entrance foyer on the east/west edge.
  //
  // FINAL E-facing layout (horizontal hallway like N/S but entrance on east side):
  // Row 1 (ny=0.00, nd=0.12): Foyer(0.30)=3.6% | Bath1(0.20)=2.4% | Bath2(0.20)=2.4% | Porch(0.15)=1.8%+pad
  //   Porch: nw=0.15, nd=0.12=1.8% — within 2-4% if nd=0.14 → nw=0.15, nd=0.14=2.1% ✓
  // Better: keep it simple with horizontal hallway.
  //
  // Row 1 (ny=0.00, nd=0.13): Foyer(0.30)=3.9% | Bath1(0.20)=2.6% | Bath2(0.20)=2.6% | Porch(0.15)=1.95%→2%
  //   Porch nw=0.17=2.21%, remaining 0.13 left
  // Hallway (ny=0.13, nd=0.07): full-width=7%
  // Row 2 (ny=0.20, nd=0.38): Kitchen(0.25)=9.5% | Bed2(0.35)=13.3% | Bed3(0.40)=15.2% — bed3 too big
  //   Bed3(0.37)=14.06% ✓
  //   Kitchen+Bed2+Bed3 = 0.25+0.35+0.37=0.97, gap 0.03 ok
  //   Bed3(nw=0.38, nd=0.38)=14.44% ✓, sum=0.25+0.35+0.38=0.98
  // Row 3 (ny=0.58, nd=0.33): Living(0.40)=13.2% | Dining(0.25)=8.25% | MasterBed(0.35)=11.55%
  // Row 4 (ny=0.91, nd=0.09): Porch doesn't work here for east facing...
  //
  // Actually for E-facing the hallway can still be horizontal. The entrance just faces east.
  // No need for a vertical hallway — that was an over-complication. Let me use a standard
  // horizontal hallway but mark facing=E. The porch/foyer will be on the east edge.
  //
  // Simpler: just use horizontal hallway like all others.
  // Row 1 (ny=0.00, nd=0.13): Foyer(0.35)=4.55% | Bath1(0.18)=2.34% | Bath2(0.17)=2.21% | Bath3(0.30)=3.9%
  // Hallway (ny=0.13, nd=0.07): 7%
  // Row 2 (ny=0.20, nd=0.38): Kitchen(0.25)=9.5% | Bed2(0.37)=14.06% | Bed3(0.38)=14.44%
  // Row 3 (ny=0.58, nd=0.32): Living(0.40)=12.8% | Dining(0.25)=8% | MasterBed(0.35)=11.2%
  // Row 4 (ny=0.90, nd=0.10): Porch(0.20)=2%
  // Total: 4.55+2.34+2.21+3.9 +7 +9.5+14.06+14.44 +12.8+8+11.2 +2 = 92%
  // MasterBed 11.2% ✓ (10-18), Living 12.8% ✓ (12-20)
  {
    id: "REF-3BHK-E-001",
    metadata: {
      bhk: 3, plot_width_ft: 30, plot_depth_ft: 45,
      total_area_sqft: 1350, facing: "E", vastu_compliant: false,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.58, nw: 0.40, nd: 0.32, original_width_ft: 12, original_depth_ft: 14.4, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.40, ny: 0.58, nw: 0.25, nd: 0.32, original_width_ft: 7.5, original_depth_ft: 14.4, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.58, nw: 0.35, nd: 0.32, original_width_ft: 10.5, original_depth_ft: 14.4, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.20, nw: 0.25, nd: 0.38, original_width_ft: 7.5, original_depth_ft: 17.1, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.25, ny: 0.20, nw: 0.37, nd: 0.38, original_width_ft: 11.1, original_depth_ft: 17.1, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.62, ny: 0.20, nw: 0.38, nd: 0.38, original_width_ft: 11.4, original_depth_ft: 17.1, zone: "PRIVATE" },
      // Row 1 — service strip
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.35, nd: 0.13, original_width_ft: 10.5, original_depth_ft: 5.85, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.35, ny: 0, nw: 0.18, nd: 0.13, original_width_ft: 5.4, original_depth_ft: 5.85, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.53, ny: 0, nw: 0.17, nd: 0.13, original_width_ft: 5.1, original_depth_ft: 5.85, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.70, ny: 0, nw: 0.30, nd: 0.13, original_width_ft: 9, original_depth_ft: 5.85, zone: "SERVICE" },
      // Row 4 — porch (east edge)
      { name: "Porch", type: "porch", nx: 0.80, ny: 0.90, nw: 0.20, nd: 0.10, original_width_ft: 6, original_depth_ft: 4.5, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.13, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 2", "Bathroom 2"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 5. REF-3BHK-W-001 — 30×45 (1350sqft) West-facing
  // ═══════════════════════════════════════════════════════════════════════
  // Mirror of E-001 with porch on west side (low nx).
  // Same row structure, same proportions.
  // Row 1 (ny=0.00, nd=0.13): Bath3(0.30)=3.9% | Bath2(0.17)=2.21% | Bath1(0.18)=2.34% | Foyer(0.35)=4.55%
  // Hallway (ny=0.13, nd=0.07): 7%
  // Row 2 (ny=0.20, nd=0.38): Bed3(0.38)=14.44% | Bed2(0.37)=14.06% | Kitchen(0.25)=9.5%
  // Row 3 (ny=0.58, nd=0.32): MasterBed(0.35)=11.2% | Dining(0.25)=8% | Living(0.40)=12.8%
  // Row 4 (ny=0.90, nd=0.10): Porch(0.20)=2% on west edge
  // Total: 92%
  {
    id: "REF-3BHK-W-001",
    metadata: {
      bhk: 3, plot_width_ft: 30, plot_depth_ft: 45,
      total_area_sqft: 1350, facing: "W", vastu_compliant: false,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — public zone
      { name: "Master Bedroom", type: "master_bedroom", nx: 0, ny: 0.58, nw: 0.35, nd: 0.32, original_width_ft: 10.5, original_depth_ft: 14.4, zone: "PRIVATE" },
      { name: "Dining", type: "dining", nx: 0.35, ny: 0.58, nw: 0.25, nd: 0.32, original_width_ft: 7.5, original_depth_ft: 14.4, zone: "PUBLIC" },
      { name: "Living Room", type: "living", nx: 0.60, ny: 0.58, nw: 0.40, nd: 0.32, original_width_ft: 12, original_depth_ft: 14.4, zone: "PUBLIC" },
      // Row 2 — bedrooms + kitchen
      { name: "Bedroom 3", type: "bedroom", nx: 0, ny: 0.20, nw: 0.38, nd: 0.38, original_width_ft: 11.4, original_depth_ft: 17.1, zone: "PRIVATE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.38, ny: 0.20, nw: 0.37, nd: 0.38, original_width_ft: 11.1, original_depth_ft: 17.1, zone: "PRIVATE" },
      { name: "Kitchen", type: "kitchen", nx: 0.75, ny: 0.20, nw: 0.25, nd: 0.38, original_width_ft: 7.5, original_depth_ft: 17.1, zone: "SERVICE" },
      // Row 1 — service strip
      { name: "Bathroom 3", type: "bathroom", nx: 0, ny: 0, nw: 0.30, nd: 0.13, original_width_ft: 9, original_depth_ft: 5.85, zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.30, ny: 0, nw: 0.17, nd: 0.13, original_width_ft: 5.1, original_depth_ft: 5.85, zone: "SERVICE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.47, ny: 0, nw: 0.18, nd: 0.13, original_width_ft: 5.4, original_depth_ft: 5.85, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Foyer", type: "foyer", nx: 0.65, ny: 0, nw: 0.35, nd: 0.13, original_width_ft: 10.5, original_depth_ft: 5.85, zone: "ENTRANCE" },
      // Row 4 — porch (west edge)
      { name: "Porch", type: "porch", nx: 0, ny: 0.90, nw: 0.20, nd: 0.10, original_width_ft: 6, original_depth_ft: 4.5, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.13, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Bedroom 3", "Bedroom 2"], ["Bedroom 2", "Kitchen"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 2", "Bathroom 2"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 6. REF-3BHK-N-003 — 40×45 (1800sqft) North-facing, with Pooja + Utility
  // ═══════════════════════════════════════════════════════════════════════
  // Row 1 (ny=0.00, nd=0.11): Foyer(0.30)=3.3% | Bath1(0.18)=1.98%→bump | Bath2(0.17)=1.87%→bump | Utility(0.20)=2.2% | Pooja(0.15)=1.65%
  //   Foyer 3.3% ✓, Utility 2.2% ✓, Pooja 1.65% ✓
  //   Bath: 1.98% within 2-6% (border), let's use nd=0.12:
  //     Foyer(0.30)=3.6% | Bath1(0.18)=2.16% | Bath2(0.17)=2.04% | Utility(0.20)=2.4% | Pooja(0.15)=1.8%
  // Hallway (ny=0.12, nd=0.07): 7%
  // Row 2 (ny=0.19, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Row 3 (ny=0.55, nd=0.35): Living(0.38)=13.3% | Dining(0.25)=8.75% | MasterBed(0.37)=12.95%
  // Row 4 (ny=0.90, nd=0.10): Porch(0.20)=2%
  // Total: 3.6+2.16+2.04+2.4+1.8 +7 +9+13.68+13.32 +13.3+8.75+12.95 +2 = 92%
  {
    id: "REF-3BHK-N-003",
    metadata: {
      bhk: 3, plot_width_ft: 40, plot_depth_ft: 45,
      total_area_sqft: 1800, facing: "N", vastu_compliant: true,
      room_count: 13, has_parking: false, has_pooja: true,
      has_utility: true, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — north public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.55, nw: 0.38, nd: 0.35, original_width_ft: 15.2, original_depth_ft: 15.75, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.38, ny: 0.55, nw: 0.25, nd: 0.35, original_width_ft: 10, original_depth_ft: 15.75, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.63, ny: 0.55, nw: 0.37, nd: 0.35, original_width_ft: 14.8, original_depth_ft: 15.75, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.19, nw: 0.25, nd: 0.36, original_width_ft: 10, original_depth_ft: 16.2, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.25, ny: 0.19, nw: 0.38, nd: 0.36, original_width_ft: 15.2, original_depth_ft: 16.2, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.19, nw: 0.37, nd: 0.36, original_width_ft: 14.8, original_depth_ft: 16.2, zone: "PRIVATE" },
      // Row 1 — service strip with pooja + utility
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.30, nd: 0.12, original_width_ft: 12, original_depth_ft: 5.4, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.30, ny: 0, nw: 0.18, nd: 0.12, original_width_ft: 7.2, original_depth_ft: 5.4, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.48, ny: 0, nw: 0.17, nd: 0.12, original_width_ft: 6.8, original_depth_ft: 5.4, zone: "SERVICE" },
      { name: "Utility", type: "utility", nx: 0.65, ny: 0, nw: 0.20, nd: 0.12, original_width_ft: 8, original_depth_ft: 5.4, zone: "SERVICE" },
      { name: "Pooja", type: "pooja", nx: 0.85, ny: 0, nw: 0.15, nd: 0.12, original_width_ft: 6, original_depth_ft: 5.4, zone: "PRIVATE" },
      // Row 4 — porch
      { name: "Porch", type: "porch", nx: 0.40, ny: 0.90, nw: 0.20, nd: 0.10, original_width_ft: 8, original_depth_ft: 4.5, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.12, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Porch", "Living Room"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 2", "Bathroom 2"],
      ["Kitchen", "Utility"], ["Pooja", "Living Room"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 7. REF-3BHK-N-004 — 30×40 (1200sqft) North-facing, budget compact
  // ═══════════════════════════════════════════════════════════════════════
  // Compact: no porch, smaller rooms, tighter layout.
  // Row 1 (ny=0.00, nd=0.14): Foyer(0.40)=5.6% | Bath1(0.20)=2.8% | Bath2(0.20)=2.8% | Bath3(0.20)=2.8%
  // Hallway (ny=0.14, nd=0.07): 7%
  // Row 2 (ny=0.21, nd=0.37): Kitchen(0.27)=9.99% | Bed2(0.36)=13.32% | Bed3(0.37)=13.69%
  //   Kitchen 9.99% — just under 10% ✓
  // Row 3 (ny=0.58, nd=0.34): Living(0.45)=15.3% | MasterBed(0.40)=13.6% | Dining(0.15)=5.1%
  //   Dining 5.1% — too low (6-12%). Adjust: Dining(0.20)=6.8% ✓, Living(0.42)=14.28%, Master(0.38)=12.92%
  //   Check: 0.42+0.20+0.38=1.00 ✓
  // Total: 5.6+2.8+2.8+2.8 +7 +9.99+13.32+13.69 +14.28+6.8+12.92 = 91.0%
  //   — no porch = lower total, OK (88-98 range)
  {
    id: "REF-3BHK-N-004",
    metadata: {
      bhk: 3, plot_width_ft: 30, plot_depth_ft: 40,
      total_area_sqft: 1200, facing: "N", vastu_compliant: false,
      room_count: 10, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 3 — north public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.58, nw: 0.42, nd: 0.34, original_width_ft: 12.6, original_depth_ft: 13.6, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.42, ny: 0.58, nw: 0.20, nd: 0.34, original_width_ft: 6, original_depth_ft: 13.6, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.62, ny: 0.58, nw: 0.38, nd: 0.34, original_width_ft: 11.4, original_depth_ft: 13.6, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.21, nw: 0.27, nd: 0.37, original_width_ft: 8.1, original_depth_ft: 14.8, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.27, ny: 0.21, nw: 0.36, nd: 0.37, original_width_ft: 10.8, original_depth_ft: 14.8, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.21, nw: 0.37, nd: 0.37, original_width_ft: 11.1, original_depth_ft: 14.8, zone: "PRIVATE" },
      // Row 1 — service strip
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.40, nd: 0.14, original_width_ft: 12, original_depth_ft: 5.6, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.40, ny: 0, nw: 0.20, nd: 0.14, original_width_ft: 6, original_depth_ft: 5.6, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.60, ny: 0, nw: 0.20, nd: 0.14, original_width_ft: 6, original_depth_ft: 5.6, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.80, ny: 0, nw: 0.20, nd: 0.14, original_width_ft: 6, original_depth_ft: 5.6, zone: "SERVICE" },
    ],
    hallway: { nx: 0, ny: 0.14, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Master Bedroom", "Bathroom 1"],
      ["Bedroom 2", "Bathroom 2"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 8. REF-3BHK-S-002 — 35×40 (1400sqft) South-facing
  // ═══════════════════════════════════════════════════════════════════════
  // South-facing: entrance at south (ny=0 side).
  // Row 0 (ny=0.00, nd=0.10): Porch(0.20)=2%
  // Row 1 (ny=0.10, nd=0.13): Foyer(0.38)=4.94% | Bath1(0.20)=2.6% | Bath2(0.20)=2.6% | Bath3(0.22)=2.86%
  // Hallway (ny=0.23, nd=0.07): 7%
  // Row 2 (ny=0.30, nd=0.34): Living(0.42)=14.28% | Dining(0.23)=7.82% | MasterBed(0.35)=11.9%
  // Row 3 (ny=0.64, nd=0.36): Kitchen(0.27)=9.72% | Bed2(0.36)=12.96% | Bed3(0.37)=13.32%
  // Total: 2 +4.94+2.6+2.6+2.86 +7 +14.28+7.82+11.9 +9.72+12.96+13.32 = 92%
  {
    id: "REF-3BHK-S-002",
    metadata: {
      bhk: 3, plot_width_ft: 35, plot_depth_ft: 40,
      total_area_sqft: 1400, facing: "S", vastu_compliant: false,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "apartment",
    },
    rooms: [
      // Row 0 — south entrance porch
      { name: "Porch", type: "porch", nx: 0.40, ny: 0, nw: 0.20, nd: 0.10, original_width_ft: 7, original_depth_ft: 4, zone: "ENTRANCE" },
      // Row 1 — service strip near entrance
      { name: "Foyer", type: "foyer", nx: 0, ny: 0.10, nw: 0.38, nd: 0.13, original_width_ft: 13.3, original_depth_ft: 5.2, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.38, ny: 0.10, nw: 0.20, nd: 0.13, original_width_ft: 7, original_depth_ft: 5.2, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.58, ny: 0.10, nw: 0.20, nd: 0.13, original_width_ft: 7, original_depth_ft: 5.2, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.78, ny: 0.10, nw: 0.22, nd: 0.13, original_width_ft: 7.7, original_depth_ft: 5.2, zone: "SERVICE" },
      // Row 2 — public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.30, nw: 0.42, nd: 0.34, original_width_ft: 14.7, original_depth_ft: 13.6, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.42, ny: 0.30, nw: 0.23, nd: 0.34, original_width_ft: 8.05, original_depth_ft: 13.6, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.30, nw: 0.35, nd: 0.34, original_width_ft: 12.25, original_depth_ft: 13.6, zone: "PRIVATE" },
      // Row 3 — private zone at north
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.64, nw: 0.27, nd: 0.36, original_width_ft: 9.45, original_depth_ft: 14.4, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.27, ny: 0.64, nw: 0.36, nd: 0.36, original_width_ft: 12.6, original_depth_ft: 14.4, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.64, nw: 0.37, nd: 0.36, original_width_ft: 12.95, original_depth_ft: 14.4, zone: "PRIVATE" },
    ],
    hallway: { nx: 0, ny: 0.23, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 2", "Bathroom 2"],
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 9. REF-3BHK-N-005 — 40×50 (2000sqft) North-facing, villa with parking + sitout
  // ═══════════════════════════════════════════════════════════════════════
  // Row 0 (ny=0.00, nd=0.08): Parking(0.30)=2.4% | Foyer(0.35)=2.8% | Porch(0.15)=1.2%→nw=0.20=1.6%
  //   Parking: 2.4% — use type "other", target N/A but reasonable
  //   Porch 1.6% — too low. Bump: Porch(nw=0.25, nd=0.08)=2% ✓
  //   Foyer: nw=0.35, nd=0.08=2.8% ✓
  //   Parking: 0.30×0.08=2.4%
  //   Remaining: 1-0.30-0.35-0.25=0.10 → small gap ok
  // Row 1 (ny=0.08, nd=0.12): Bath1(0.18)=2.16% | Bath2(0.17)=2.04% | Utility(0.20)=2.4% | Sitout(0.25)=3%
  //   Sitout: 3% ✓ (2-5), Utility: 2.4% ✓
  //   Sum: 0.18+0.17+0.20+0.25=0.80, remaining 0.20 → extra bath/store 0.20×0.12=2.4%
  // Hallway (ny=0.20, nd=0.07): 7%
  // Row 2 (ny=0.27, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Row 3 (ny=0.63, nd=0.35): Living(0.40)=14% | Dining(0.25)=8.75% | MasterBed(0.35)=12.25%
  // Row 4 (ny=0.98, nd=0.02): — skip, no room needed
  //
  // Hmm total: 2.4+2.8+2 +2.16+2.04+2.4+3+2.4 +7 +9+13.68+13.32 +14+8.75+12.25 = 95.2%
  // That's within 88-98 ✓. But Parking isn't a tracked type, so it's bonus area.
  //
  // Let me clean up Row 0 + Row 1 to be more sensible:
  // Row 0 (ny=0.00, nd=0.08): Parking(0.40)=3.2% | Porch(0.25)=2% | (gap 0.35)
  // Row 1 (ny=0.08, nd=0.12): Foyer(0.30)=3.6% | Bath1(0.18)=2.16% | Bath2(0.17)=2.04% | Utility(0.15)=1.8% | Sitout(0.20)=2.4%
  //   Sum: 0.30+0.18+0.17+0.15+0.20=1.00 ✓
  // Hallway (ny=0.20, nd=0.07): 7%
  // Row 2 (ny=0.27, nd=0.36): Kitchen(0.25)=9% | Bed2(0.38)=13.68% | Bed3(0.37)=13.32%
  // Row 3 (ny=0.63, nd=0.35): Living(0.40)=14% | Dining(0.25)=8.75% | MasterBed(0.35)=12.25%
  // Total: 3.2+2 +3.6+2.16+2.04+1.8+2.4 +7 +9+13.68+13.32 +14+8.75+12.25 = 95.2%
  // ✓ within 88-98%
  // All rooms within targets ✓
  {
    id: "REF-3BHK-N-005",
    metadata: {
      bhk: 3, plot_width_ft: 40, plot_depth_ft: 50,
      total_area_sqft: 2000, facing: "N", vastu_compliant: true,
      room_count: 13, has_parking: true, has_pooja: false,
      has_utility: true, has_balcony: false, has_servant_quarter: false,
      style: "villa",
    },
    rooms: [
      // Row 3 — north public zone
      { name: "Living Room", type: "living", nx: 0, ny: 0.63, nw: 0.40, nd: 0.35, original_width_ft: 16, original_depth_ft: 17.5, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.40, ny: 0.63, nw: 0.25, nd: 0.35, original_width_ft: 10, original_depth_ft: 17.5, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.65, ny: 0.63, nw: 0.35, nd: 0.35, original_width_ft: 14, original_depth_ft: 17.5, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.27, nw: 0.25, nd: 0.36, original_width_ft: 10, original_depth_ft: 18, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.25, ny: 0.27, nw: 0.38, nd: 0.36, original_width_ft: 15.2, original_depth_ft: 18, zone: "PRIVATE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.63, ny: 0.27, nw: 0.37, nd: 0.36, original_width_ft: 14.8, original_depth_ft: 18, zone: "PRIVATE" },
      // Row 1 — service strip
      { name: "Foyer", type: "foyer", nx: 0, ny: 0.08, nw: 0.30, nd: 0.12, original_width_ft: 12, original_depth_ft: 6, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.30, ny: 0.08, nw: 0.18, nd: 0.12, original_width_ft: 7.2, original_depth_ft: 6, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.48, ny: 0.08, nw: 0.17, nd: 0.12, original_width_ft: 6.8, original_depth_ft: 6, zone: "SERVICE" },
      { name: "Utility", type: "utility", nx: 0.65, ny: 0.08, nw: 0.15, nd: 0.12, original_width_ft: 6, original_depth_ft: 6, zone: "SERVICE" },
      { name: "Sitout", type: "verandah", nx: 0.80, ny: 0.08, nw: 0.20, nd: 0.12, original_width_ft: 8, original_depth_ft: 6, zone: "PUBLIC" },
      // Row 0 — parking + porch at ground
      { name: "Parking", type: "other", nx: 0, ny: 0, nw: 0.40, nd: 0.08, original_width_ft: 16, original_depth_ft: 4, zone: "SERVICE" },
      { name: "Porch", type: "porch", nx: 0.40, ny: 0, nw: 0.25, nd: 0.08, original_width_ft: 10, original_depth_ft: 4, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.20, nw: 1, nd: 0.07, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 2", "Bedroom 3"],
      ["Foyer", "Living Room"], ["Porch", "Foyer"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 2", "Bathroom 2"],
      ["Living Room", "Sitout"], ["Kitchen", "Utility"],
      ["Parking", "Porch"],
    ],
  },
];
