/**
 * Sample Floor Plan Data — 2BHK Indian Apartment
 *
 * Professional reference data for development and testing.
 * 85 sqm (915 sqft) apartment with Vastu-compliant layout.
 * All dimensions in mm.
 */

import type { FloorPlanProject } from "@/types/floor-plan-cad";

export function createSample2BHK(): FloorPlanProject {
  // Overall: 10600mm x 8600mm (10.6m x 8.6m) ≈ 91 sqm gross
  const W = 10600;
  const H = 8600;

  // Room layout (from bottom-left):
  // Row 1 (bottom): Living+Dining (5500 x 4200) | Kitchen (2600 x 3000) | Utility (2500 x 1200)
  // Row 2 (top): Master Bed (4000 x 4400) | Bathroom1 (1500 x 2400) | Bedroom2 (3600 x 4400) | Bath2 (1500 x 2000)
  // Corridor in between

  const EXT_THICK = 230;
  const INT_THICK = 150;

  return {
    id: "sample-2bhk",
    name: "2BHK Vastu Apartment",
    version: "1.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      project_type: "residential",
      building_type: "2BHK Apartment",
      location: { city: "Pune", state: "Maharashtra", country: "India" },
      plot_area_sqm: 91,
      carpet_area_sqm: 72,
      num_floors: 2,
      building_code: "NBC India 2016",
      original_prompt: "2BHK apartment, Vastu compliant, modern layout with open living-dining",
    },
    settings: {
      units: "metric",
      display_unit: "m",
      scale: "1:100",
      grid_size_mm: 100,
      wall_thickness_mm: 150,
      paper_size: "A3",
      orientation: "landscape",
      north_angle_deg: 0,
      vastu_compliance: true,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: true,
    },
    floors: [
      {
        id: "floor-ground",
        name: "Ground Floor",
        level: 0,
        floor_to_floor_height_mm: 3000,
        slab_thickness_mm: 150,
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: W, y: 0 },
            { x: W, y: H },
            { x: 0, y: H },
          ],
        },
        walls: [
          // Exterior walls
          { id: "w-ext-s", type: "exterior", material: "brick", centerline: { start: { x: 0, y: 0 }, end: { x: W, y: 0 } }, thickness_mm: EXT_THICK, height_mm: 2850, left_room_id: undefined, right_room_id: undefined, openings: [], line_weight: "thick", is_load_bearing: true },
          { id: "w-ext-e", type: "exterior", material: "brick", centerline: { start: { x: W, y: 0 }, end: { x: W, y: H } }, thickness_mm: EXT_THICK, height_mm: 2850, left_room_id: undefined, right_room_id: undefined, openings: [], line_weight: "thick", is_load_bearing: true },
          { id: "w-ext-n", type: "exterior", material: "brick", centerline: { start: { x: W, y: H }, end: { x: 0, y: H } }, thickness_mm: EXT_THICK, height_mm: 2850, left_room_id: undefined, right_room_id: undefined, openings: [], line_weight: "thick", is_load_bearing: true },
          { id: "w-ext-w", type: "exterior", material: "brick", centerline: { start: { x: 0, y: H }, end: { x: 0, y: 0 } }, thickness_mm: EXT_THICK, height_mm: 2850, left_room_id: undefined, right_room_id: undefined, openings: [], line_weight: "thick", is_load_bearing: true },

          // Horizontal divider: corridor at y=4200 (separating living area from bedrooms)
          { id: "w-corr-s", type: "interior", material: "brick", centerline: { start: { x: 0, y: 4200 }, end: { x: W, y: 4200 } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },
          // Corridor north wall at y=5400
          { id: "w-corr-n", type: "interior", material: "brick", centerline: { start: { x: 0, y: 5400 }, end: { x: W, y: 5400 } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },

          // Living-Kitchen divider at x=5500
          { id: "w-lk", type: "interior", material: "brick", centerline: { start: { x: 5500, y: 0 }, end: { x: 5500, y: 4200 } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },
          // Kitchen-Utility divider at x=8100
          { id: "w-ku", type: "interior", material: "brick", centerline: { start: { x: 8100, y: 0 }, end: { x: 8100, y: 4200 } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },

          // Master bedroom east wall at x=4000
          { id: "w-mb-e", type: "interior", material: "brick", centerline: { start: { x: 4000, y: 5400 }, end: { x: 4000, y: H } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },
          // Master bath east wall at x=5500
          { id: "w-mbath-e", type: "interior", material: "brick", centerline: { start: { x: 5500, y: 5400 }, end: { x: 5500, y: H } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },
          // Bedroom 2 east wall (bath divider) at x=9100
          { id: "w-b2bath", type: "interior", material: "brick", centerline: { start: { x: 9100, y: 5400 }, end: { x: 9100, y: H } }, thickness_mm: INT_THICK, height_mm: 2850, openings: [], line_weight: "medium", is_load_bearing: false },
        ],
        rooms: [
          // Living + Dining (open plan)
          {
            id: "r-living",
            name: "Living + Dining",
            type: "living_room",
            boundary: { points: [{ x: 115, y: 115 }, { x: 5425, y: 115 }, { x: 5425, y: 4125 }, { x: 115, y: 4125 }] },
            area_sqm: 22.1,
            perimeter_mm: 18680,
            natural_light_required: true,
            ventilation_required: true,
            label_position: { x: 2750, y: 2100 },
            wall_ids: ["w-ext-s", "w-lk", "w-corr-s", "w-ext-w"],
            vastu_direction: "N",
          },
          // Kitchen — INTENTIONAL VASTU VIOLATION: placed in NE (should be SE)
          {
            id: "r-kitchen",
            name: "Kitchen",
            type: "kitchen",
            boundary: { points: [{ x: 5575, y: 115 }, { x: 8025, y: 115 }, { x: 8025, y: 4125 }, { x: 5575, y: 4125 }] },
            area_sqm: 10.1,
            perimeter_mm: 13280,
            natural_light_required: true,
            ventilation_required: true,
            label_position: { x: 6800, y: 2100 },
            wall_ids: ["w-ext-s", "w-ku", "w-corr-s", "w-lk"],
            vastu_direction: "NE", // VIOLATION: Kitchen in NE instead of SE
          },
          // Utility / Wash
          {
            id: "r-utility",
            name: "Utility",
            type: "utility",
            boundary: { points: [{ x: 8175, y: 115 }, { x: 10485, y: 115 }, { x: 10485, y: 4125 }, { x: 8175, y: 4125 }] },
            area_sqm: 9.3,
            perimeter_mm: 12840,
            natural_light_required: false,
            ventilation_required: true,
            label_position: { x: 9300, y: 2100 },
            wall_ids: ["w-ext-s", "w-ext-e", "w-corr-s", "w-ku"],
          },
          // Corridor
          {
            id: "r-corridor",
            name: "Corridor",
            type: "corridor",
            boundary: { points: [{ x: 115, y: 4275 }, { x: 10485, y: 4275 }, { x: 10485, y: 5325 }, { x: 115, y: 5325 }] },
            area_sqm: 10.9,
            perimeter_mm: 22940,
            natural_light_required: false,
            ventilation_required: false,
            label_position: { x: 5300, y: 4800 },
            wall_ids: ["w-corr-s", "w-ext-e", "w-corr-n", "w-ext-w"],
          },
          // Master Bedroom — INTENTIONAL VASTU VIOLATION: placed in NE (should be SW)
          {
            id: "r-master",
            name: "Master Bedroom",
            type: "master_bedroom",
            boundary: { points: [{ x: 115, y: 5475 }, { x: 3925, y: 5475 }, { x: 3925, y: 8485 }, { x: 115, y: 8485 }] },
            area_sqm: 11.5,
            perimeter_mm: 13640,
            natural_light_required: true,
            ventilation_required: true,
            label_position: { x: 2000, y: 6950 },
            wall_ids: ["w-corr-n", "w-mb-e", "w-ext-n", "w-ext-w"],
            vastu_direction: "NE", // VIOLATION: Master bedroom in NE instead of SW
          },
          // Master Bathroom
          {
            id: "r-mbath",
            name: "Bathroom 1",
            type: "bathroom",
            boundary: { points: [{ x: 4075, y: 5475 }, { x: 5425, y: 5475 }, { x: 5425, y: 8485 }, { x: 4075, y: 8485 }] },
            area_sqm: 4.1,
            perimeter_mm: 8740,
            natural_light_required: false,
            ventilation_required: true,
            label_position: { x: 4750, y: 6950 },
            wall_ids: ["w-corr-n", "w-mbath-e", "w-ext-n", "w-mb-e"],
            vastu_direction: "NW",
          },
          // Bedroom 2
          {
            id: "r-bed2",
            name: "Bedroom 2",
            type: "bedroom",
            boundary: { points: [{ x: 5575, y: 5475 }, { x: 9025, y: 5475 }, { x: 9025, y: 8485 }, { x: 5575, y: 8485 }] },
            area_sqm: 10.4,
            perimeter_mm: 12920,
            natural_light_required: true,
            ventilation_required: true,
            label_position: { x: 7300, y: 6950 },
            wall_ids: ["w-corr-n", "w-b2bath", "w-ext-n", "w-mbath-e"],
            vastu_direction: "E",
          },
          // Bathroom 2 — INTENTIONAL CODE ISSUE: small area (1.5 sq.m, min is 1.8)
          {
            id: "r-bath2",
            name: "Bathroom 2",
            type: "bathroom",
            boundary: { points: [{ x: 9475, y: 5475 }, { x: 10485, y: 5475 }, { x: 10485, y: 6975 }, { x: 9475, y: 6975 }] },
            area_sqm: 1.5,
            perimeter_mm: 5040,
            natural_light_required: false,
            ventilation_required: true,
            label_position: { x: 9980, y: 6225 },
            wall_ids: ["w-corr-n", "w-ext-e", "w-ext-n", "w-b2bath"],
            vastu_direction: "NW",
          },
        ],
        doors: [
          // Main entrance — south wall into living
          {
            id: "d-main",
            type: "main_entrance",
            wall_id: "w-ext-s",
            width_mm: 1050,
            height_mm: 2100,
            thickness_mm: 45,
            position_along_wall_mm: 2200,
            swing_direction: "right",
            swing_angle_deg: 90,
            opens_to: "inside",
            symbol: { hinge_point: { x: 2200, y: 0 }, arc_radius_mm: 1050, arc_start_angle_deg: 90, arc_end_angle_deg: 180, leaf_end_point: { x: 2200, y: 1050 } },
            connects_rooms: ["r-living", ""],
          },
          // Kitchen door from living
          {
            id: "d-kitchen",
            type: "single_swing",
            wall_id: "w-lk",
            width_mm: 900,
            height_mm: 2100,
            thickness_mm: 35,
            position_along_wall_mm: 1500,
            swing_direction: "left",
            swing_angle_deg: 90,
            opens_to: "inside",
            symbol: { hinge_point: { x: 5500, y: 1500 }, arc_radius_mm: 900, arc_start_angle_deg: 0, arc_end_angle_deg: 90, leaf_end_point: { x: 6400, y: 1500 } },
            connects_rooms: ["r-living", "r-kitchen"],
          },
          // Master bedroom from corridor
          {
            id: "d-master",
            type: "single_swing",
            wall_id: "w-corr-n",
            width_mm: 900,
            height_mm: 2100,
            thickness_mm: 35,
            position_along_wall_mm: 1500,
            swing_direction: "right",
            swing_angle_deg: 90,
            opens_to: "inside",
            symbol: { hinge_point: { x: 1500, y: 5400 }, arc_radius_mm: 900, arc_start_angle_deg: 90, arc_end_angle_deg: 180, leaf_end_point: { x: 1500, y: 6300 } },
            connects_rooms: ["r-corridor", "r-master"],
          },
          // Bedroom 2 from corridor
          {
            id: "d-bed2",
            type: "single_swing",
            wall_id: "w-corr-n",
            width_mm: 900,
            height_mm: 2100,
            thickness_mm: 35,
            position_along_wall_mm: 6500,
            swing_direction: "left",
            swing_angle_deg: 90,
            opens_to: "inside",
            symbol: { hinge_point: { x: 7400, y: 5400 }, arc_radius_mm: 900, arc_start_angle_deg: 90, arc_end_angle_deg: 180, leaf_end_point: { x: 7400, y: 6300 } },
            connects_rooms: ["r-corridor", "r-bed2"],
          },
          // Master bath from master bedroom
          {
            id: "d-mbath",
            type: "single_swing",
            wall_id: "w-mb-e",
            width_mm: 750,
            height_mm: 2100,
            thickness_mm: 35,
            position_along_wall_mm: 800,
            swing_direction: "right",
            swing_angle_deg: 90,
            opens_to: "outside",
            symbol: { hinge_point: { x: 4000, y: 6200 }, arc_radius_mm: 750, arc_start_angle_deg: 0, arc_end_angle_deg: -90, leaf_end_point: { x: 3250, y: 6200 } },
            connects_rooms: ["r-master", "r-mbath"],
          },
          // Bath 2 from bedroom 2
          {
            id: "d-bath2",
            type: "single_swing",
            wall_id: "w-b2bath",
            width_mm: 750,
            height_mm: 2100,
            thickness_mm: 35,
            position_along_wall_mm: 800,
            swing_direction: "left",
            swing_angle_deg: 90,
            opens_to: "outside",
            symbol: { hinge_point: { x: 9100, y: 6200 }, arc_radius_mm: 750, arc_start_angle_deg: 180, arc_end_angle_deg: 270, leaf_end_point: { x: 9850, y: 6200 } },
            connects_rooms: ["r-bed2", "r-bath2"],
          },
        ],
        windows: [
          // Living room — south windows
          { id: "win-living-s1", type: "casement", wall_id: "w-ext-s", width_mm: 1500, height_mm: 1200, sill_height_mm: 900, position_along_wall_mm: 500, symbol: { start_point: { x: 500, y: 0 }, end_point: { x: 2000, y: 0 }, glass_lines: [] }, glazing: "double", operable: true },
          // Living room — west window
          { id: "win-living-w", type: "casement", wall_id: "w-ext-w", width_mm: 1800, height_mm: 1500, sill_height_mm: 900, position_along_wall_mm: 1200, symbol: { start_point: { x: 0, y: 1200 }, end_point: { x: 0, y: 3000 }, glass_lines: [] }, glazing: "double", operable: true },
          // Kitchen — south window
          { id: "win-kitchen-s", type: "sliding", wall_id: "w-ext-s", width_mm: 1200, height_mm: 1200, sill_height_mm: 1050, position_along_wall_mm: 6200, symbol: { start_point: { x: 6200, y: 0 }, end_point: { x: 7400, y: 0 }, glass_lines: [] }, glazing: "single", operable: true },
          // Master bedroom — north window
          { id: "win-master-n", type: "casement", wall_id: "w-ext-n", width_mm: 1800, height_mm: 1500, sill_height_mm: 900, position_along_wall_mm: 1200, symbol: { start_point: { x: 1200, y: 8600 }, end_point: { x: 3000, y: 8600 }, glass_lines: [] }, glazing: "double", operable: true },
          // Master bedroom — west window
          { id: "win-master-w", type: "casement", wall_id: "w-ext-w", width_mm: 1500, height_mm: 1200, sill_height_mm: 900, position_along_wall_mm: 6400, symbol: { start_point: { x: 0, y: 6400 }, end_point: { x: 0, y: 7900 }, glass_lines: [] }, glazing: "double", operable: true },
          // Bedroom 2 — north window
          { id: "win-bed2-n", type: "casement", wall_id: "w-ext-n", width_mm: 1500, height_mm: 1500, sill_height_mm: 900, position_along_wall_mm: 6500, symbol: { start_point: { x: 6500, y: 8600 }, end_point: { x: 8000, y: 8600 }, glass_lines: [] }, glazing: "double", operable: true },
          // Bathroom 1 — north window (small)
          { id: "win-bath1-n", type: "awning", wall_id: "w-ext-n", width_mm: 600, height_mm: 600, sill_height_mm: 1500, position_along_wall_mm: 4400, symbol: { start_point: { x: 4400, y: 8600 }, end_point: { x: 5000, y: 8600 }, glass_lines: [] }, glazing: "single", operable: true },
          // Bathroom 2 — east window (small)
          { id: "win-bath2-e", type: "awning", wall_id: "w-ext-e", width_mm: 600, height_mm: 600, sill_height_mm: 1500, position_along_wall_mm: 6000, symbol: { start_point: { x: 10600, y: 6000 }, end_point: { x: 10600, y: 6600 }, glass_lines: [] }, glazing: "single", operable: true },
        ],
        stairs: [
          {
            id: "stair-1",
            type: "straight",
            boundary: { points: [{ x: 9200, y: 4300 }, { x: 10400, y: 4300 }, { x: 10400, y: 5300 }, { x: 9200, y: 5300 }] },
            num_risers: 6,
            riser_height_mm: 170,
            tread_depth_mm: 250,
            width_mm: 1000,
            up_direction: { start: { x: 9800, y: 5200 }, end: { x: 9800, y: 4400 } },
            treads: Array.from({ length: 6 }, (_, i) => ({
              start: { x: 9200, y: 5200 - i * 150 },
              end: { x: 10400, y: 5200 - i * 150 },
            })),
            has_railing: true,
            railing_side: "both",
            connects_floors: [0, 1] as [number, number],
          },
        ],
        columns: [
          { id: "col-1", type: "rectangular", center: { x: 5500, y: 4200 }, width_mm: 300, depth_mm: 300, is_structural: true, grid_ref: "A1" },
          { id: "col-2", type: "rectangular", center: { x: 5500, y: 5400 }, width_mm: 300, depth_mm: 300, is_structural: true, grid_ref: "A2" },
          { id: "col-3", type: "circular", center: { x: 8100, y: 4200 }, diameter_mm: 300, is_structural: true, grid_ref: "B1" },
          { id: "col-4", type: "circular", center: { x: 8100, y: 5400 }, diameter_mm: 300, is_structural: true, grid_ref: "B2" },
        ],
        furniture: [
          // Living room furniture
          { id: "f-sofa", catalog_id: "sofa-3seat", position: { x: 500, y: 1200 }, rotation_deg: 0, scale: 1, room_id: "r-living", locked: false },
          { id: "f-ctable", catalog_id: "coffee-table", position: { x: 800, y: 2400 }, rotation_deg: 0, scale: 1, room_id: "r-living", locked: false },
          { id: "f-tv", catalog_id: "tv-unit", position: { x: 600, y: 3200 }, rotation_deg: 0, scale: 1, room_id: "r-living", locked: false },
          { id: "f-armchair", catalog_id: "armchair", position: { x: 3500, y: 1800 }, rotation_deg: 270, scale: 1, room_id: "r-living", locked: false },
          // Dining
          { id: "f-dtable", catalog_id: "dining-table-4", position: { x: 3200, y: 2800 }, rotation_deg: 0, scale: 1, room_id: "r-living", locked: false },
          // Kitchen
          { id: "f-counter", catalog_id: "kitchen-counter", position: { x: 5600, y: 200 }, rotation_deg: 0, scale: 1, room_id: "r-kitchen", locked: false },
          { id: "f-stove", catalog_id: "stove-4burner", position: { x: 5800, y: 1000 }, rotation_deg: 0, scale: 1, room_id: "r-kitchen", locked: false },
          { id: "f-fridge", catalog_id: "refrigerator", position: { x: 7200, y: 200 }, rotation_deg: 0, scale: 1, room_id: "r-kitchen", locked: false },
          // Master Bedroom
          { id: "f-kbed", catalog_id: "bed-king", position: { x: 500, y: 6000 }, rotation_deg: 0, scale: 1, room_id: "r-master", locked: false },
          { id: "f-ns1", catalog_id: "nightstand", position: { x: 200, y: 5600 }, rotation_deg: 0, scale: 1, room_id: "r-master", locked: false },
          { id: "f-ns2", catalog_id: "nightstand", position: { x: 2500, y: 5600 }, rotation_deg: 0, scale: 1, room_id: "r-master", locked: false },
          { id: "f-wardrobe", catalog_id: "wardrobe", position: { x: 500, y: 8100 }, rotation_deg: 180, scale: 1, room_id: "r-master", locked: false },
          // Bedroom 2
          { id: "f-sbed", catalog_id: "bed-queen", position: { x: 6000, y: 6200 }, rotation_deg: 0, scale: 1, room_id: "r-bed2", locked: false },
          { id: "f-desk", catalog_id: "desk-study", position: { x: 7600, y: 5600 }, rotation_deg: 0, scale: 1, room_id: "r-bed2", locked: false },
          // Master Bathroom
          { id: "f-toilet1", catalog_id: "toilet", position: { x: 4200, y: 7800 }, rotation_deg: 0, scale: 1, room_id: "r-mbath", locked: false },
          { id: "f-basin1", catalog_id: "washbasin", position: { x: 4200, y: 5600 }, rotation_deg: 0, scale: 1, room_id: "r-mbath", locked: false },
          // Bathroom 2
          { id: "f-toilet2", catalog_id: "toilet", position: { x: 9300, y: 7800 }, rotation_deg: 0, scale: 1, room_id: "r-bath2", locked: false },
          { id: "f-shower", catalog_id: "shower-enclosure", position: { x: 9300, y: 5600 }, rotation_deg: 0, scale: 1, room_id: "r-bath2", locked: false },
          // Utility
          { id: "f-washer", catalog_id: "washing-machine", position: { x: 8400, y: 200 }, rotation_deg: 0, scale: 1, room_id: "r-utility", locked: false },
        ],
        fixtures: [],
        annotations: [],
        dimensions: [],
        zones: [
          { id: "z-public", name: "Public", type: "public", room_ids: ["r-living", "r-corridor"], color: "#D5F5E3", opacity: 0.2 },
          { id: "z-private", name: "Private", type: "private", room_ids: ["r-master", "r-bed2", "r-mbath", "r-bath2"], color: "#D4E6F1", opacity: 0.2 },
          { id: "z-service", name: "Service", type: "service", room_ids: ["r-kitchen", "r-utility"], color: "#FEF9E7", opacity: 0.2 },
        ],
      },
    ],
  };
}
