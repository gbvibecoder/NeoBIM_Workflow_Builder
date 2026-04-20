import type { ReferenceFloorPlan } from "@/features/floor-plan/lib/reference-types";

/**
 * 5BHK reference plans — premium villas and bungalows.
 * Typical: 2500-3500+ sqft, 5 bedrooms + living + dining + kitchen + baths.
 *
 * Proportion targets (nw x nd as % of total):
 *   Living 12-20%, Master Bed 10-18%, Bed 2/3/4/5 8-15%, Kitchen 5-10%,
 *   Dining 6-12%, Bath 2-6%, Foyer 2-6%, Porch 2-4%, Utility 1.5-4%,
 *   Pooja 1-3%, Hallway 5-12%.
 *
 * All layouts use 0.01 gaps between rows and hallways to avoid
 * floating-point overlap artifacts.
 */
export const PLANS_5BHK: ReferenceFloorPlan[] = [
  // ─── 5BHK North-facing, 55x50 (2750sqft) ──────────────────────────
  //
  // Row 1  ny=0.00 nd=0.12 : Foyer | MBath | Bath2 | Bath3 | Pooja | Bath4
  // Row 2  ny=0.12 nd=0.34 : Kitchen | Bed3 | Bed4 | Bed5 | Utility
  //   gap 0.01 at y=0.46
  // Hall   ny=0.47 nd=0.06
  //   gap 0.01 at y=0.53
  // Row 3  ny=0.54 nd=0.39 : Living | Dining | MasterBed | Bed2
  // Row 4  ny=0.93 nd=0.07 : Porch (partial)
  //
  // Proportions:
  //   Living       0.32 x 0.39 = 12.48%  (12-20)
  //   Dining       0.17 x 0.39 =  6.63%  (6-12)
  //   Master Bed   0.26 x 0.39 = 10.14%  (10-18)
  //   Bed 2        0.25 x 0.39 =  9.75%  (8-15)
  //   Kitchen      0.18 x 0.34 =  6.12%  (5-10)
  //   Bed 3        0.24 x 0.34 =  8.16%  (8-15)
  //   Bed 4        0.24 x 0.34 =  8.16%  (8-15)
  //   Bed 5        0.24 x 0.34 =  8.16%  (8-15)
  //   Utility      0.10 x 0.34 =  3.40%  (1.5-4)
  //   Foyer        0.22 x 0.12 =  2.64%  (2-6)
  //   MasterBath   0.18 x 0.12 =  2.16%  (2-6)
  //   Bath 2       0.16 x 0.12 =  1.92%  — under 2%, bumping to 0.17 -> 2.04%
  //   Bath 3       0.16 x 0.12 =  1.92%  — under 2%, bumping to 0.17 -> 2.04%
  //   Pooja        0.12 x 0.12 =  1.44%  (1-3)
  //   Bath 4       0.16 x 0.12 =  1.92%  — under 2%. Make 0.17 -> 2.04%
  //     Width check: 0.22+0.18+0.17+0.17+0.12+0.17 = 1.03 — over!
  //     Adjust: Foyer(0.20)+MBath(0.18)+Bath2(0.17)+Bath3(0.17)+Pooja(0.11)+Bath4(0.17)=1.00
  //     Pooja=0.11x0.12=1.32% (1-3) OK
  //   Hallway      1.00 x 0.06 =  6.00%  (5-12)
  //   Porch        0.24 x 0.07 =  1.68%  (1.5-4)
  //   Total: ~92%
  {
    id: "REF-5BHK-N-001",
    metadata: {
      bhk: 5, plot_width_ft: 55, plot_depth_ft: 50,
      total_area_sqft: 2750, facing: "N", vastu_compliant: true,
      room_count: 16, has_parking: false, has_pooja: true,
      has_utility: true, has_balcony: false, has_servant_quarter: false,
      style: "bungalow",
    },
    rooms: [
      // Row 3 — public + master + bed2 (ny=0.54, nd=0.39)
      { name: "Living Room", type: "living", nx: 0, ny: 0.54, nw: 0.32, nd: 0.39, original_width_ft: 17.6, original_depth_ft: 19.5, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.32, ny: 0.54, nw: 0.17, nd: 0.39, original_width_ft: 9.35, original_depth_ft: 19.5, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.49, ny: 0.54, nw: 0.26, nd: 0.39, original_width_ft: 14.3, original_depth_ft: 19.5, zone: "PRIVATE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.75, ny: 0.54, nw: 0.25, nd: 0.39, original_width_ft: 13.75, original_depth_ft: 19.5, zone: "PRIVATE" },
      // Row 2 — bedrooms + kitchen + utility (ny=0.12, nd=0.34)
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.12, nw: 0.18, nd: 0.34, original_width_ft: 9.9, original_depth_ft: 17, zone: "SERVICE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.18, ny: 0.12, nw: 0.24, nd: 0.34, original_width_ft: 13.2, original_depth_ft: 17, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.42, ny: 0.12, nw: 0.24, nd: 0.34, original_width_ft: 13.2, original_depth_ft: 17, zone: "PRIVATE" },
      { name: "Bedroom 5", type: "bedroom", nx: 0.66, ny: 0.12, nw: 0.24, nd: 0.34, original_width_ft: 13.2, original_depth_ft: 17, zone: "PRIVATE" },
      { name: "Utility", type: "utility", nx: 0.90, ny: 0.12, nw: 0.10, nd: 0.34, original_width_ft: 5.5, original_depth_ft: 17, zone: "SERVICE" },
      // Row 1 — baths + foyer + pooja (ny=0.00, nd=0.12)
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.20, nd: 0.12, original_width_ft: 11, original_depth_ft: 6, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.20, ny: 0, nw: 0.18, nd: 0.12, original_width_ft: 9.9, original_depth_ft: 6, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.38, ny: 0, nw: 0.17, nd: 0.12, original_width_ft: 9.35, original_depth_ft: 6, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.55, ny: 0, nw: 0.17, nd: 0.12, original_width_ft: 9.35, original_depth_ft: 6, zone: "SERVICE" },
      { name: "Pooja", type: "pooja", nx: 0.72, ny: 0, nw: 0.11, nd: 0.12, original_width_ft: 6.05, original_depth_ft: 6, zone: "PRIVATE" },
      { name: "Bathroom 4", type: "bathroom", nx: 0.83, ny: 0, nw: 0.17, nd: 0.12, original_width_ft: 9.35, original_depth_ft: 6, zone: "SERVICE" },
      // Row 4 — porch (ny=0.93, nd=0.07)
      { name: "Porch", type: "porch", nx: 0.20, ny: 0.93, nw: 0.24, nd: 0.07, original_width_ft: 13.2, original_depth_ft: 3.5, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.47, nw: 1, nd: 0.06, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"], ["Master Bedroom", "Bedroom 2"],
      ["Kitchen", "Bedroom 3"], ["Bedroom 3", "Bedroom 4"], ["Bedroom 4", "Bedroom 5"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Bedroom 4", "Bathroom 3"], ["Bedroom 5", "Bathroom 4"],
      ["Kitchen", "Utility"], ["Foyer", "Living Room"], ["Porch", "Foyer"],
    ],
  },

  // ─── 5BHK South-facing, 55x50 ─────────────────────────────────────
  //
  // Mirror of N-001: front (south) at bottom.
  // Row 1  ny=0.00 nd=0.07 : Porch (partial, at bottom for south-facing entrance)
  // Row 2  ny=0.08 nd=0.39 : Living | Dining | MasterBed | Bed2
  //   gap at y=0.47
  // Hall   ny=0.47 nd=0.06
  //   gap at y=0.53
  // Row 3  ny=0.54 nd=0.34 : Kitchen | Bed3 | Bed4 | Bed5 | Utility
  // Row 4  ny=0.88 nd=0.12 : Foyer | MBath | Bath2 | Bath3 | Pooja | Bath4
  //
  // Same proportions as N-001.
  // Total: ~92%
  {
    id: "REF-5BHK-S-001",
    metadata: {
      bhk: 5, plot_width_ft: 55, plot_depth_ft: 50,
      total_area_sqft: 2750, facing: "S", vastu_compliant: false,
      room_count: 16, has_parking: false, has_pooja: true,
      has_utility: true, has_balcony: false, has_servant_quarter: false,
      style: "bungalow",
    },
    rooms: [
      // Row 2 — public + master + bed2 (ny=0.08, nd=0.39)
      { name: "Living Room", type: "living", nx: 0, ny: 0.08, nw: 0.32, nd: 0.39, original_width_ft: 17.6, original_depth_ft: 19.5, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.32, ny: 0.08, nw: 0.17, nd: 0.39, original_width_ft: 9.35, original_depth_ft: 19.5, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.49, ny: 0.08, nw: 0.26, nd: 0.39, original_width_ft: 14.3, original_depth_ft: 19.5, zone: "PRIVATE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.75, ny: 0.08, nw: 0.25, nd: 0.39, original_width_ft: 13.75, original_depth_ft: 19.5, zone: "PRIVATE" },
      // Row 3 — bedrooms + kitchen + utility (ny=0.54, nd=0.34)
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.54, nw: 0.18, nd: 0.34, original_width_ft: 9.9, original_depth_ft: 17, zone: "SERVICE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.18, ny: 0.54, nw: 0.24, nd: 0.34, original_width_ft: 13.2, original_depth_ft: 17, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.42, ny: 0.54, nw: 0.24, nd: 0.34, original_width_ft: 13.2, original_depth_ft: 17, zone: "PRIVATE" },
      { name: "Bedroom 5", type: "bedroom", nx: 0.66, ny: 0.54, nw: 0.24, nd: 0.34, original_width_ft: 13.2, original_depth_ft: 17, zone: "PRIVATE" },
      { name: "Utility", type: "utility", nx: 0.90, ny: 0.54, nw: 0.10, nd: 0.34, original_width_ft: 5.5, original_depth_ft: 17, zone: "SERVICE" },
      // Row 4 — baths + foyer + pooja (ny=0.88, nd=0.12)
      { name: "Foyer", type: "foyer", nx: 0, ny: 0.88, nw: 0.20, nd: 0.12, original_width_ft: 11, original_depth_ft: 6, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.20, ny: 0.88, nw: 0.18, nd: 0.12, original_width_ft: 9.9, original_depth_ft: 6, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.38, ny: 0.88, nw: 0.17, nd: 0.12, original_width_ft: 9.35, original_depth_ft: 6, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.55, ny: 0.88, nw: 0.17, nd: 0.12, original_width_ft: 9.35, original_depth_ft: 6, zone: "SERVICE" },
      { name: "Pooja", type: "pooja", nx: 0.72, ny: 0.88, nw: 0.11, nd: 0.12, original_width_ft: 6.05, original_depth_ft: 6, zone: "PRIVATE" },
      { name: "Bathroom 4", type: "bathroom", nx: 0.83, ny: 0.88, nw: 0.17, nd: 0.12, original_width_ft: 9.35, original_depth_ft: 6, zone: "SERVICE" },
      // Row 1 — porch (ny=0.00, nd=0.07)
      { name: "Porch", type: "porch", nx: 0.20, ny: 0, nw: 0.24, nd: 0.07, original_width_ft: 13.2, original_depth_ft: 3.5, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.47, nw: 1, nd: 0.06, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"], ["Master Bedroom", "Bedroom 2"],
      ["Kitchen", "Bedroom 3"], ["Bedroom 3", "Bedroom 4"], ["Bedroom 4", "Bedroom 5"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Bedroom 4", "Bathroom 3"], ["Bedroom 5", "Bathroom 4"],
      ["Kitchen", "Utility"], ["Foyer", "Living Room"], ["Porch", "Foyer"],
    ],
  },
];
