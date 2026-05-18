/**
 * Material library — canonical palette for the Item Decomposer (TR-028).
 *
 * Each entry maps a human-readable snake_case id to an RGB tuple (0-1).
 * The downstream Python sandbox resolves these via keyword matching in
 * `material_library.py`'s `resolve_material()`. The TS list is kept in
 * sync with the Python canonical list but uses cleaner IDs for the
 * decomposer prompt.
 */

export const MATERIAL_LIBRARY = [
  "chrome_steel",
  "black_steel",
  "carbon_fiber",
  "aluminium",
  "glass_clear",
  "wood_teak",
  "wood_dark",
  "wood_oak",
  "wood_pine",
  "leather_black",
  "leather_brown",
  "rubber_black",
  "paper_neutral",
  "fabric_neutral",
  "fabric_grey",
  "camera_black",
  "concrete_polished",
  "concrete_structural",
  "plastic_white",
  "plastic_black",
  "copper",
  "brass",
  "stone_marble",
  "ceramic_white",
  "wall_paint_offwhite",
] as const;

export type MaterialId = (typeof MATERIAL_LIBRARY)[number];

/** RGB tuples (0–1 per channel), cross-referenced against
 *  `neobim-ifc-service/app/services/ifc_generator_v3/material_library.py`. */
export const MATERIAL_RGB: Record<MaterialId, [number, number, number]> = {
  chrome_steel:          [0.82, 0.84, 0.86],
  black_steel:           [0.15, 0.15, 0.16],
  carbon_fiber:          [0.12, 0.12, 0.12],
  aluminium:             [0.75, 0.77, 0.80],
  glass_clear:           [0.85, 0.92, 0.95],
  wood_teak:             [0.62, 0.42, 0.22],
  wood_dark:             [0.40, 0.26, 0.15],
  wood_oak:              [0.72, 0.58, 0.38],
  wood_pine:             [0.80, 0.68, 0.48],
  leather_black:         [0.08, 0.08, 0.08],
  leather_brown:         [0.45, 0.30, 0.18],
  rubber_black:          [0.15, 0.15, 0.15],
  paper_neutral:         [0.92, 0.90, 0.85],
  fabric_neutral:        [0.75, 0.72, 0.68],
  fabric_grey:           [0.50, 0.50, 0.50],
  camera_black:          [0.05, 0.05, 0.05],
  concrete_polished:     [0.72, 0.70, 0.67],
  concrete_structural:   [0.75, 0.73, 0.70],
  plastic_white:         [0.92, 0.92, 0.90],
  plastic_black:         [0.08, 0.08, 0.08],
  copper:                [0.72, 0.45, 0.20],
  brass:                 [0.80, 0.68, 0.22],
  stone_marble:          [0.95, 0.93, 0.90],
  ceramic_white:         [0.95, 0.95, 0.95],
  wall_paint_offwhite:   [0.95, 0.93, 0.88],
};
