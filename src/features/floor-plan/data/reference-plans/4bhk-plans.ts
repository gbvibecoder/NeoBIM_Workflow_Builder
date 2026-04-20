import type { ReferenceFloorPlan } from "@/features/floor-plan/lib/reference-types";

/**
 * 4BHK reference plans — large residences, villas, bungalows.
 * Typical: 1800-3000 sqft, 4 bedrooms + living + dining + kitchen + 3 bath.
 *
 * Proportion targets (nw x nd as % of total):
 *   Living 12-20%, Master Bed 10-18%, Bed 2/3/4 8-15%, Kitchen 5-10%,
 *   Dining 6-12%, Bath 2-6%, Foyer 2-6%, Porch 2-4%, Utility 1.5-4%,
 *   Pooja 1-3%, Servant Qtr 3-8%, Hallway 5-12%, Parking 3-8%.
 *
 * All layouts use 0.01 gaps between rows and hallways to avoid
 * floating-point overlap artifacts.
 */
export const PLANS_4BHK: ReferenceFloorPlan[] = [
  // ─── 4BHK North-facing, 42x52 (2184sqft) ──────────────────────────
  //
  // Row 1  ny=0.00 nd=0.12 : Foyer(0.25) | MBath(0.20) | Bath2(0.20) | Bath3(0.18) | Porch(0.17)
  // Row 2  ny=0.12 nd=0.34 : Kitchen(0.24) | Bed3(0.38) | Bed4(0.38)
  //   gap 0.01 at y=0.46
  // Hall   ny=0.47 nd=0.06
  //   gap 0.01 at y=0.53
  // Row 3  ny=0.54 nd=0.38 : Living(0.32) | Dining(0.19) | MasterBed(0.27) | Bed2(0.22)
  //   (unused: ny=0.92..1.0 = porch gap)
  //
  // Proportions:
  //   Living       0.32 x 0.38 = 12.16%  (12-20)
  //   Dining       0.19 x 0.38 =  7.22%  (6-12)
  //   Master Bed   0.27 x 0.38 = 10.26%  (10-18)
  //   Bed 2        0.22 x 0.38 =  8.36%  (8-15)
  //   Kitchen      0.24 x 0.34 =  8.16%  (5-10)
  //   Bed 3        0.38 x 0.34 = 12.92%  (8-15)
  //   Bed 4        0.38 x 0.34 = 12.92%  (8-15)
  //   Foyer        0.25 x 0.12 =  3.00%  (2-6)
  //   MasterBath   0.20 x 0.12 =  2.40%  (2-6)
  //   Bath 2       0.20 x 0.12 =  2.40%  (2-6)
  //   Bath 3       0.18 x 0.12 =  2.16%  (2-6)
  //   Porch        0.17 x 0.12 =  2.04%  (1.5-4)
  //   Hallway      1.00 x 0.06 =  6.00%  (5-12)
  //   Total: 90.00%
  {
    id: "REF-4BHK-N-001",
    metadata: {
      bhk: 4, plot_width_ft: 42, plot_depth_ft: 52,
      total_area_sqft: 2184, facing: "N", vastu_compliant: true,
      room_count: 12, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "villa",
    },
    rooms: [
      // Row 3 — public + bedrooms (ny=0.54, nd=0.38)
      { name: "Living Room", type: "living", nx: 0, ny: 0.54, nw: 0.32, nd: 0.38, original_width_ft: 13.44, original_depth_ft: 19.76, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.32, ny: 0.54, nw: 0.19, nd: 0.38, original_width_ft: 7.98, original_depth_ft: 19.76, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.51, ny: 0.54, nw: 0.27, nd: 0.38, original_width_ft: 11.34, original_depth_ft: 19.76, zone: "PRIVATE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.78, ny: 0.54, nw: 0.22, nd: 0.38, original_width_ft: 9.24, original_depth_ft: 19.76, zone: "PRIVATE" },
      // Row 2 — kitchen + bedrooms (ny=0.12, nd=0.34)
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.12, nw: 0.24, nd: 0.34, original_width_ft: 10.08, original_depth_ft: 17.68, zone: "SERVICE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.24, ny: 0.12, nw: 0.38, nd: 0.34, original_width_ft: 15.96, original_depth_ft: 17.68, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.62, ny: 0.12, nw: 0.38, nd: 0.34, original_width_ft: 15.96, original_depth_ft: 17.68, zone: "PRIVATE" },
      // Row 1 — baths + foyer + porch (ny=0.00, nd=0.12)
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.25, nd: 0.12, original_width_ft: 10.5, original_depth_ft: 6.24, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.25, ny: 0, nw: 0.20, nd: 0.12, original_width_ft: 8.4, original_depth_ft: 6.24, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.45, ny: 0, nw: 0.20, nd: 0.12, original_width_ft: 8.4, original_depth_ft: 6.24, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.65, ny: 0, nw: 0.18, nd: 0.12, original_width_ft: 7.56, original_depth_ft: 6.24, zone: "SERVICE" },
      { name: "Porch", type: "porch", nx: 0.83, ny: 0, nw: 0.17, nd: 0.12, original_width_ft: 7.14, original_depth_ft: 6.24, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.47, nw: 1, nd: 0.06, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"], ["Master Bedroom", "Bedroom 2"],
      ["Kitchen", "Bedroom 3"], ["Bedroom 3", "Bedroom 4"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Bedroom 4", "Bathroom 3"], ["Foyer", "Living Room"], ["Porch", "Foyer"],
    ],
  },

  // ─── 4BHK South-facing, 42x52 ─────────────────────────────────────
  //
  // Mirror of N-001: front (south) at bottom.
  // Row 1  ny=0.00 nd=0.12 : Foyer | MBath | Bath2 | Bath3 | Porch  (south = entrance side)
  // Row 2  ny=0.08 nd=0.38 : Living | Dining | MasterBed | Bed2
  //   gap at y=0.46
  // Hall   ny=0.47 nd=0.06
  //   gap at y=0.53
  // Row 3  ny=0.54 nd=0.34 : Kitchen | Bed3 | Bed4
  // Row 4  ny=0.88 nd=0.12 : Foyer | MBath | Bath2 | Bath3 | Porch (back side)
  //
  // Same proportions as N-001.
  // Total: 90%
  {
    id: "REF-4BHK-S-001",
    metadata: {
      bhk: 4, plot_width_ft: 42, plot_depth_ft: 52,
      total_area_sqft: 2184, facing: "S", vastu_compliant: true,
      room_count: 12, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "villa",
    },
    rooms: [
      // Row 2 — public + bedrooms (ny=0.08, nd=0.38)
      { name: "Living Room", type: "living", nx: 0, ny: 0.08, nw: 0.32, nd: 0.38, original_width_ft: 13.44, original_depth_ft: 19.76, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.32, ny: 0.08, nw: 0.19, nd: 0.38, original_width_ft: 7.98, original_depth_ft: 19.76, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.51, ny: 0.08, nw: 0.27, nd: 0.38, original_width_ft: 11.34, original_depth_ft: 19.76, zone: "PRIVATE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.78, ny: 0.08, nw: 0.22, nd: 0.38, original_width_ft: 9.24, original_depth_ft: 19.76, zone: "PRIVATE" },
      // Row 3 — kitchen + bedrooms (ny=0.54, nd=0.34)
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.54, nw: 0.24, nd: 0.34, original_width_ft: 10.08, original_depth_ft: 17.68, zone: "SERVICE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.24, ny: 0.54, nw: 0.38, nd: 0.34, original_width_ft: 15.96, original_depth_ft: 17.68, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.62, ny: 0.54, nw: 0.38, nd: 0.34, original_width_ft: 15.96, original_depth_ft: 17.68, zone: "PRIVATE" },
      // Row 4 — baths + foyer + porch (ny=0.88, nd=0.12)
      { name: "Foyer", type: "foyer", nx: 0, ny: 0.88, nw: 0.25, nd: 0.12, original_width_ft: 10.5, original_depth_ft: 6.24, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.25, ny: 0.88, nw: 0.20, nd: 0.12, original_width_ft: 8.4, original_depth_ft: 6.24, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.45, ny: 0.88, nw: 0.20, nd: 0.12, original_width_ft: 8.4, original_depth_ft: 6.24, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.65, ny: 0.88, nw: 0.18, nd: 0.12, original_width_ft: 7.56, original_depth_ft: 6.24, zone: "SERVICE" },
      { name: "Porch", type: "porch", nx: 0.83, ny: 0.88, nw: 0.17, nd: 0.12, original_width_ft: 7.14, original_depth_ft: 6.24, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.47, nw: 1, nd: 0.06, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"], ["Master Bedroom", "Bedroom 2"],
      ["Kitchen", "Bedroom 3"], ["Bedroom 3", "Bedroom 4"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Bedroom 4", "Bathroom 3"], ["Foyer", "Living Room"], ["Porch", "Foyer"],
    ],
  },

  // ─── 4BHK East-facing, 40x50 — vertical hallway ───────────────────
  //
  // Vertical hallway at nx=0.48, nw=0.05, ny=0, nd=1.0.
  // Left wing (nx 0..0.47):
  //   Row top    ny=0.62 nd=0.38 : Kitchen(0.19) | Bed2(0.28)         = 0.47
  //   Row mid    ny=0.26 nd=0.36 : Bed3(0.23) | Bed4(0.24)            = 0.47
  //   Row bot    ny=0.00 nd=0.26 : Bath2(0.20) | Bath3(0.18)          = 0.38
  // Right wing (nx 0.53..1.0, max nw=0.47):
  //   Row top    ny=0.62 nd=0.38 : Living(0.47)                       = 0.47
  //   Row mid    ny=0.26 nd=0.36 : Dining(0.19) | MasterBed(0.28)     = 0.47
  //   Row bot    ny=0.00 nd=0.26 : Foyer(0.18) | MasterBath(0.16)     = 0.34
  //
  // Proportions:
  //   Living       0.47 x 0.38 = 17.86%  (12-20)
  //   Dining       0.19 x 0.36 =  6.84%  (6-12)
  //   Master Bed   0.28 x 0.36 = 10.08%  (10-18)
  //   Bed 2        0.28 x 0.38 = 10.64%  (8-15)
  //   Kitchen      0.19 x 0.38 =  7.22%  (5-10)
  //   Bed 3        0.23 x 0.36 =  8.28%  (8-15)
  //   Bed 4        0.24 x 0.36 =  8.64%  (8-15)
  //   Foyer        0.18 x 0.26 =  4.68%  (2-6)
  //   MasterBath   0.16 x 0.26 =  4.16%  (2-6)
  //   Bath 2       0.20 x 0.26 =  5.20%  (2-6)
  //   Bath 3       0.18 x 0.26 =  4.68%  (2-6)
  //   Hallway      0.05 x 1.00 =  5.00%  (5-12)
  //   Total: 93.28%
  {
    id: "REF-4BHK-E-001",
    metadata: {
      bhk: 4, plot_width_ft: 40, plot_depth_ft: 50,
      total_area_sqft: 2000, facing: "E", vastu_compliant: false,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "villa",
    },
    rooms: [
      // Right wing — top row (ny=0.62, nd=0.38)
      { name: "Living Room", type: "living", nx: 0.53, ny: 0.62, nw: 0.47, nd: 0.38, original_width_ft: 18.8, original_depth_ft: 19, zone: "PUBLIC" },
      // Right wing — mid row (ny=0.26, nd=0.36)
      { name: "Dining", type: "dining", nx: 0.53, ny: 0.26, nw: 0.19, nd: 0.36, original_width_ft: 7.6, original_depth_ft: 18, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.72, ny: 0.26, nw: 0.28, nd: 0.36, original_width_ft: 11.2, original_depth_ft: 18, zone: "PRIVATE" },
      // Right wing — bot row (ny=0.00, nd=0.26)
      { name: "Foyer", type: "foyer", nx: 0.53, ny: 0, nw: 0.18, nd: 0.26, original_width_ft: 7.2, original_depth_ft: 13, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.71, ny: 0, nw: 0.16, nd: 0.26, original_width_ft: 6.4, original_depth_ft: 13, attached_to: "Master Bedroom", zone: "SERVICE" },
      // Left wing — top row (ny=0.62, nd=0.38)
      { name: "Kitchen", type: "kitchen", nx: 0, ny: 0.62, nw: 0.19, nd: 0.38, original_width_ft: 7.6, original_depth_ft: 19, zone: "SERVICE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.19, ny: 0.62, nw: 0.28, nd: 0.38, original_width_ft: 11.2, original_depth_ft: 19, zone: "PRIVATE" },
      // Left wing — mid row (ny=0.26, nd=0.36)
      { name: "Bedroom 3", type: "bedroom", nx: 0, ny: 0.26, nw: 0.23, nd: 0.36, original_width_ft: 9.2, original_depth_ft: 18, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.23, ny: 0.26, nw: 0.24, nd: 0.36, original_width_ft: 9.6, original_depth_ft: 18, zone: "PRIVATE" },
      // Left wing — bot row (ny=0.00, nd=0.26)
      { name: "Bathroom 2", type: "bathroom", nx: 0, ny: 0, nw: 0.20, nd: 0.26, original_width_ft: 8, original_depth_ft: 13, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.20, ny: 0, nw: 0.18, nd: 0.26, original_width_ft: 7.2, original_depth_ft: 13, zone: "SERVICE" },
    ],
    hallway: { nx: 0.48, ny: 0, nw: 0.05, nd: 1, orientation: "vertical" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"],
      ["Kitchen", "Bedroom 2"], ["Bedroom 3", "Bedroom 4"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Bedroom 4", "Bathroom 3"], ["Foyer", "Living Room"],
    ],
  },

  // ─── 4BHK West-facing, 40x50 — vertical hallway (mirror of E) ─────
  //
  // Vertical hallway at nx=0.48, nw=0.05.
  // Left wing (nx 0..0.47) — public + master:
  //   Row top    ny=0.62 nd=0.38 : Living(0.47)                    = 17.86%
  //   Row mid    ny=0.26 nd=0.36 : MasterBed(0.28) | Dining(0.19) = 10.08% + 6.84%
  //   Row bot    ny=0.00 nd=0.26 : MasterBath(0.16) | Foyer(0.18) = 4.16% + 4.68%
  // Right wing (nx 0.53..1.0) — bedrooms + kitchen:
  //   Row top    ny=0.62 nd=0.38 : Bed2(0.28) | Kitchen(0.19)     = 10.64% + 7.22%
  //   Row mid    ny=0.26 nd=0.36 : Bed3(0.24) | Bed4(0.23)        = 8.64% + 8.28%
  //   Row bot    ny=0.00 nd=0.26 : Bath2(0.18) | Bath3(0.20)      = 4.68% + 5.20%
  // Hallway: 0.05 x 1.0 = 5%
  // Total: 93.28%
  {
    id: "REF-4BHK-W-001",
    metadata: {
      bhk: 4, plot_width_ft: 40, plot_depth_ft: 50,
      total_area_sqft: 2000, facing: "W", vastu_compliant: false,
      room_count: 11, has_parking: false, has_pooja: false,
      has_utility: false, has_balcony: false, has_servant_quarter: false,
      style: "villa",
    },
    rooms: [
      // Left wing — top row (ny=0.62, nd=0.38)
      { name: "Living Room", type: "living", nx: 0, ny: 0.62, nw: 0.47, nd: 0.38, original_width_ft: 18.8, original_depth_ft: 19, zone: "PUBLIC" },
      // Left wing — mid row (ny=0.26, nd=0.36)
      { name: "Master Bedroom", type: "master_bedroom", nx: 0, ny: 0.26, nw: 0.28, nd: 0.36, original_width_ft: 11.2, original_depth_ft: 18, zone: "PRIVATE" },
      { name: "Dining", type: "dining", nx: 0.28, ny: 0.26, nw: 0.19, nd: 0.36, original_width_ft: 7.6, original_depth_ft: 18, zone: "PUBLIC" },
      // Left wing — bot row (ny=0.00, nd=0.26)
      { name: "Bathroom 1", type: "master_bathroom", nx: 0, ny: 0, nw: 0.16, nd: 0.26, original_width_ft: 6.4, original_depth_ft: 13, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Foyer", type: "foyer", nx: 0.16, ny: 0, nw: 0.18, nd: 0.26, original_width_ft: 7.2, original_depth_ft: 13, zone: "ENTRANCE" },
      // Right wing — top row (ny=0.62, nd=0.38)
      { name: "Bedroom 2", type: "bedroom", nx: 0.53, ny: 0.62, nw: 0.28, nd: 0.38, original_width_ft: 11.2, original_depth_ft: 19, zone: "PRIVATE" },
      { name: "Kitchen", type: "kitchen", nx: 0.81, ny: 0.62, nw: 0.19, nd: 0.38, original_width_ft: 7.6, original_depth_ft: 19, zone: "SERVICE" },
      // Right wing — mid row (ny=0.26, nd=0.36)
      { name: "Bedroom 3", type: "bedroom", nx: 0.53, ny: 0.26, nw: 0.24, nd: 0.36, original_width_ft: 9.6, original_depth_ft: 18, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.77, ny: 0.26, nw: 0.23, nd: 0.36, original_width_ft: 9.2, original_depth_ft: 18, zone: "PRIVATE" },
      // Right wing — bot row (ny=0.00, nd=0.26)
      { name: "Bathroom 2", type: "bathroom", nx: 0.53, ny: 0, nw: 0.18, nd: 0.26, original_width_ft: 7.2, original_depth_ft: 13, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.71, ny: 0, nw: 0.20, nd: 0.26, original_width_ft: 8, original_depth_ft: 13, zone: "SERVICE" },
    ],
    hallway: { nx: 0.48, ny: 0, nw: 0.05, nd: 1, orientation: "vertical" },
    adjacency: [
      ["Living Room", "Dining"], ["Master Bedroom", "Dining"],
      ["Bedroom 2", "Kitchen"], ["Bedroom 3", "Bedroom 4"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Bedroom 4", "Bathroom 3"], ["Foyer", "Living Room"],
    ],
  },

  // ─── 4BHK North, bungalow with servant quarter, 50x55 (2750sqft) ──
  //
  // Row 1  ny=0.00 nd=0.12 : Foyer(0.26) | MBath(0.22) | Bath2(0.20) | Bath3(0.18) | Porch(0.14)
  // Row 2  ny=0.12 nd=0.34 : ServantQtr | Kitchen | Bed3 | Bed4 | Utility | Pooja
  //   gap 0.01 at y=0.46
  // Hall   ny=0.47 nd=0.06
  //   gap 0.01 at y=0.53
  // Row 3  ny=0.54 nd=0.40 : Parking | Living | Dining | MasterBed | Bed2
  //   (ends at 0.94)
  //
  // Proportions:
  //   Parking      0.08 x 0.40 =  3.20%  (3-8)
  //   Living       0.30 x 0.40 = 12.00%  (12-20)
  //   Dining       0.16 x 0.40 =  6.40%  (6-12)
  //   Master Bed   0.26 x 0.40 = 10.40%  (10-18)
  //   Bed 2        0.20 x 0.40 =  8.00%  (8-15)
  //   ServantQtr   0.14 x 0.34 =  4.76%  (3-8)
  //   Kitchen      0.20 x 0.34 =  6.80%  (5-10)
  //   Bed 3        0.24 x 0.34 =  8.16%  (8-15)
  //   Bed 4        0.24 x 0.34 =  8.16%  (8-15)
  //   Utility      0.10 x 0.34 =  3.40%  (1.5-4)
  //   Pooja        0.08 x 0.34 =  2.72%  (1-3)
  //   Foyer        0.26 x 0.12 =  3.12%  (2-6)
  //   MasterBath   0.22 x 0.12 =  2.64%  (2-6)
  //   Bath 2       0.20 x 0.12 =  2.40%  (2-6)
  //   Bath 3       0.18 x 0.12 =  2.16%  (2-6)
  //   Porch        0.14 x 0.12 =  1.68%  (1.5-4)
  //   Hallway      1.00 x 0.06 =  6.00%  (5-12)
  //   Total: 92.00%
  {
    id: "REF-4BHK-N-002",
    metadata: {
      bhk: 4, plot_width_ft: 50, plot_depth_ft: 55,
      total_area_sqft: 2750, facing: "N", vastu_compliant: true,
      room_count: 15, has_parking: true, has_pooja: true,
      has_utility: true, has_balcony: false, has_servant_quarter: true,
      style: "bungalow",
    },
    rooms: [
      // Row 3 — main public zone (ny=0.54, nd=0.40)
      { name: "Parking", type: "other", nx: 0, ny: 0.54, nw: 0.08, nd: 0.40, original_width_ft: 4, original_depth_ft: 22, zone: "SERVICE" },
      { name: "Living Room", type: "living", nx: 0.08, ny: 0.54, nw: 0.30, nd: 0.40, original_width_ft: 15, original_depth_ft: 22, zone: "PUBLIC" },
      { name: "Dining", type: "dining", nx: 0.38, ny: 0.54, nw: 0.16, nd: 0.40, original_width_ft: 8, original_depth_ft: 22, zone: "PUBLIC" },
      { name: "Master Bedroom", type: "master_bedroom", nx: 0.54, ny: 0.54, nw: 0.26, nd: 0.40, original_width_ft: 13, original_depth_ft: 22, zone: "PRIVATE" },
      { name: "Bedroom 2", type: "bedroom", nx: 0.80, ny: 0.54, nw: 0.20, nd: 0.40, original_width_ft: 10, original_depth_ft: 22, zone: "PRIVATE" },
      // Row 2 — bedrooms + service (ny=0.12, nd=0.34)
      { name: "Servant Quarter", type: "servant_quarter", nx: 0, ny: 0.12, nw: 0.14, nd: 0.34, original_width_ft: 7, original_depth_ft: 18.7, zone: "SERVICE" },
      { name: "Kitchen", type: "kitchen", nx: 0.14, ny: 0.12, nw: 0.20, nd: 0.34, original_width_ft: 10, original_depth_ft: 18.7, zone: "SERVICE" },
      { name: "Bedroom 3", type: "bedroom", nx: 0.34, ny: 0.12, nw: 0.24, nd: 0.34, original_width_ft: 12, original_depth_ft: 18.7, zone: "PRIVATE" },
      { name: "Bedroom 4", type: "bedroom", nx: 0.58, ny: 0.12, nw: 0.24, nd: 0.34, original_width_ft: 12, original_depth_ft: 18.7, zone: "PRIVATE" },
      { name: "Utility", type: "utility", nx: 0.82, ny: 0.12, nw: 0.10, nd: 0.34, original_width_ft: 5, original_depth_ft: 18.7, zone: "SERVICE" },
      { name: "Pooja", type: "pooja", nx: 0.92, ny: 0.12, nw: 0.08, nd: 0.34, original_width_ft: 4, original_depth_ft: 18.7, zone: "PRIVATE" },
      // Row 1 — baths + foyer + porch (ny=0.00, nd=0.12)
      { name: "Foyer", type: "foyer", nx: 0, ny: 0, nw: 0.26, nd: 0.12, original_width_ft: 13, original_depth_ft: 6.6, zone: "ENTRANCE" },
      { name: "Bathroom 1", type: "master_bathroom", nx: 0.26, ny: 0, nw: 0.22, nd: 0.12, original_width_ft: 11, original_depth_ft: 6.6, attached_to: "Master Bedroom", zone: "SERVICE" },
      { name: "Bathroom 2", type: "bathroom", nx: 0.48, ny: 0, nw: 0.20, nd: 0.12, original_width_ft: 10, original_depth_ft: 6.6, zone: "SERVICE" },
      { name: "Bathroom 3", type: "bathroom", nx: 0.68, ny: 0, nw: 0.18, nd: 0.12, original_width_ft: 9, original_depth_ft: 6.6, zone: "SERVICE" },
      { name: "Porch", type: "porch", nx: 0.86, ny: 0, nw: 0.14, nd: 0.12, original_width_ft: 7, original_depth_ft: 6.6, zone: "ENTRANCE" },
    ],
    hallway: { nx: 0, ny: 0.47, nw: 1, nd: 0.06, orientation: "horizontal" },
    adjacency: [
      ["Living Room", "Dining"], ["Dining", "Master Bedroom"], ["Master Bedroom", "Bedroom 2"],
      ["Kitchen", "Bedroom 3"], ["Bedroom 3", "Bedroom 4"],
      ["Master Bedroom", "Bathroom 1"], ["Bedroom 3", "Bathroom 2"],
      ["Kitchen", "Utility"], ["Foyer", "Living Room"], ["Porch", "Foyer"],
      ["Servant Quarter", "Kitchen"],
    ],
  },
];
