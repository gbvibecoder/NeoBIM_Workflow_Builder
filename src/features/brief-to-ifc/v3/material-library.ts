/**
 * Material library — canonical 50-entry palette for the v3 pipeline.
 *
 * Used by Item Decomposer (TR-028), Trim Specifier (TR-030), Material
 * Resolver (TR-031), and the agent builder system prompt. Each entry
 * maps a snake_case id to an RGB tuple (0-1). The downstream Python
 * sandbox resolves these via keyword matching in material_library.py's
 * resolve_material().
 */

export const MATERIAL_LIBRARY = [
  // Metals
  "chrome_steel",
  "black_steel",
  "brushed_steel",
  "stainless_steel",
  "carbon_fiber",
  "aluminium",
  "anodized_aluminium",
  "copper",
  "brass",
  // Glass
  "glass_clear",
  // Wood
  "wood_teak",
  "wood_dark",
  "wood_oak",
  "wood_walnut",
  "wood_pine",
  "wood_pale",
  "wood_rosewood",
  // Leather
  "leather_black",
  "leather_brown",
  "leather_tan",
  // Rubber
  "rubber_black",
  "rubber_grey",
  // Paper
  "paper_neutral",
  "paper_white",
  // Fabric
  "fabric_neutral",
  "fabric_grey",
  "fabric_blue",
  "fabric_red",
  "fabric_velvet",
  "fabric_linen",
  // Camera / electronics
  "camera_black",
  // Concrete
  "concrete_polished",
  "concrete_structural",
  "concrete_raw",
  "concrete_terrazzo",
  // Plastic
  "plastic_white",
  "plastic_black",
  "plastic_grey",
  // Stone
  "stone_marble",
  "stone_granite",
  "stone_slate",
  "stone_basalt",
  // Ceramic / tile
  "ceramic_white",
  "ceramic_terracotta",
  "ceramic_black",
  "tile_grey",
  "tile_terracotta",
  "tile_marble",
  // Paint
  "wall_paint_offwhite",
  "wall_paint_grey",
  "wall_paint_blue",
  "wall_paint_red",
  "wall_paint_green",
  // Other
  "gypsum_white",
] as const;

export type MaterialId = (typeof MATERIAL_LIBRARY)[number];

/** RGB tuples (0-1 per channel). */
export const MATERIAL_RGB: Record<MaterialId, [number, number, number]> = {
  // Metals
  chrome_steel:          [0.82, 0.84, 0.86],
  black_steel:           [0.15, 0.15, 0.16],
  brushed_steel:         [0.65, 0.67, 0.70],
  stainless_steel:       [0.70, 0.72, 0.75],
  carbon_fiber:          [0.12, 0.12, 0.12],
  aluminium:             [0.75, 0.77, 0.80],
  anodized_aluminium:    [0.25, 0.25, 0.28],
  copper:                [0.72, 0.45, 0.20],
  brass:                 [0.80, 0.68, 0.22],
  // Glass
  glass_clear:           [0.85, 0.92, 0.95],
  // Wood
  wood_teak:             [0.62, 0.42, 0.22],
  wood_dark:             [0.40, 0.26, 0.15],
  wood_oak:              [0.72, 0.58, 0.38],
  wood_walnut:           [0.40, 0.26, 0.15],
  wood_pine:             [0.80, 0.68, 0.48],
  wood_pale:             [0.85, 0.75, 0.60],
  wood_rosewood:         [0.35, 0.18, 0.10],
  // Leather
  leather_black:         [0.08, 0.08, 0.08],
  leather_brown:         [0.45, 0.30, 0.18],
  leather_tan:           [0.65, 0.50, 0.35],
  // Rubber
  rubber_black:          [0.15, 0.15, 0.15],
  rubber_grey:           [0.40, 0.40, 0.40],
  // Paper
  paper_neutral:         [0.92, 0.90, 0.85],
  paper_white:           [0.97, 0.97, 0.96],
  // Fabric
  fabric_neutral:        [0.75, 0.72, 0.68],
  fabric_grey:           [0.50, 0.50, 0.50],
  fabric_blue:           [0.18, 0.30, 0.55],
  fabric_red:            [0.65, 0.12, 0.10],
  fabric_velvet:         [0.30, 0.10, 0.25],
  fabric_linen:          [0.88, 0.85, 0.78],
  // Camera
  camera_black:          [0.05, 0.05, 0.05],
  // Concrete
  concrete_polished:     [0.72, 0.70, 0.67],
  concrete_structural:   [0.75, 0.73, 0.70],
  concrete_raw:          [0.65, 0.63, 0.60],
  concrete_terrazzo:     [0.78, 0.75, 0.72],
  // Plastic
  plastic_white:         [0.92, 0.92, 0.90],
  plastic_black:         [0.08, 0.08, 0.08],
  plastic_grey:          [0.55, 0.55, 0.55],
  // Stone
  stone_marble:          [0.95, 0.93, 0.90],
  stone_granite:         [0.45, 0.45, 0.45],
  stone_slate:           [0.35, 0.35, 0.38],
  stone_basalt:          [0.20, 0.20, 0.22],
  // Ceramic / tile
  ceramic_white:         [0.95, 0.95, 0.95],
  ceramic_terracotta:    [0.75, 0.40, 0.25],
  ceramic_black:         [0.10, 0.10, 0.10],
  tile_grey:             [0.60, 0.60, 0.60],
  tile_terracotta:       [0.72, 0.38, 0.22],
  tile_marble:           [0.90, 0.88, 0.85],
  // Paint
  wall_paint_offwhite:   [0.95, 0.93, 0.88],
  wall_paint_grey:       [0.70, 0.70, 0.70],
  wall_paint_blue:       [0.20, 0.45, 0.72],
  wall_paint_red:        [0.72, 0.20, 0.15],
  wall_paint_green:      [0.25, 0.60, 0.35],
  // Other
  gypsum_white:          [0.92, 0.90, 0.88],
};
