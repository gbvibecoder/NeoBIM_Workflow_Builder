/**
 * BIM Material Mapping System
 * Maps element types and IFC material names to PBR material properties.
 * Used server-side (GLB generator) and client-side (BIM viewer).
 */

export interface PBRMaterialDef {
  color: number;
  roughness: number;
  metalness: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
  /** For MeshPhysicalMaterial glass */
  transmission?: number;
  ior?: number;
  reflectivity?: number;
}

// ─── Element Type → PBR Material ─────────────────────────────────────────────

const ELEMENT_MATERIALS: Record<string, PBRMaterialDef> = {
  // Architectural
  wall:         { color: 0xE8E0D4, roughness: 0.82, metalness: 0.0 },
  slab:         { color: 0xD0CCC4, roughness: 0.75, metalness: 0.0 },
  roof:         { color: 0x505050, roughness: 0.65, metalness: 0.15 },
  window:       { color: 0x3A6888, roughness: 0.03, metalness: 0.15, opacity: 0.65, transparent: true, transmission: 0.25, ior: 1.52, reflectivity: 0.98, emissive: 0x102030, emissiveIntensity: 0.08 },
  door:         { color: 0x8B7340, roughness: 0.55, metalness: 0.0 },
  space:        { color: 0xF0EDE8, roughness: 0.95, metalness: 0.0, opacity: 0.15, transparent: true },
  parapet:      { color: 0xC8C0B4, roughness: 0.8, metalness: 0.0 },
  canopy:       { color: 0xB8B0A4, roughness: 0.6, metalness: 0.1 },
  balcony:      { color: 0xC0C0C0, roughness: 0.7, metalness: 0.1 },

  // Structural
  column:       { color: 0xBBBBBB, roughness: 0.5, metalness: 0.25 },
  beam:         { color: 0xA0A0A0, roughness: 0.45, metalness: 0.35 },
  stair:        { color: 0xD4D0C8, roughness: 0.7, metalness: 0.0 },

  // MEP
  duct:         { color: 0x8A8A8A, roughness: 0.3, metalness: 0.75 },
  pipe:         { color: 0x3A8A5A, roughness: 0.3, metalness: 0.65 },
  "cable-tray": { color: 0xCCA020, roughness: 0.35, metalness: 0.55 },
  equipment:    { color: 0x5080B0, roughness: 0.3, metalness: 0.6 },

  // Facade detail
  mullion:      { color: 0xD0D0D8, roughness: 0.12, metalness: 0.95, emissive: 0xFFDDCC, emissiveIntensity: 0.06 },
  spandrel:     { color: 0x181820, roughness: 0.18, metalness: 0.88, emissive: 0x101018, emissiveIntensity: 0.04 },
};

/**
 * Get PBR material definition for a BIM element type.
 */
export function getMaterialForElement(elementType: string): PBRMaterialDef {
  return ELEMENT_MATERIALS[elementType] ?? ELEMENT_MATERIALS.wall;
}

// ─── IFC Material Name → Enhanced PBR ────────────────────────────────────────

const IFC_MATERIAL_OVERRIDES: Record<string, Partial<PBRMaterialDef>> = {
  // Concrete variants
  "reinforced_concrete":     { color: 0xC4BEB4, roughness: 0.85, metalness: 0.0 },
  "precast_concrete":        { color: 0xD0CAC0, roughness: 0.75, metalness: 0.0 },
  "exposed_concrete":        { color: 0xB8B0A4, roughness: 0.9, metalness: 0.0 },

  // Masonry
  "brick":                   { color: 0xC47860, roughness: 0.85, metalness: 0.0 },
  "stone":                   { color: 0xC8BCA8, roughness: 0.75, metalness: 0.0 },
  "limestone":               { color: 0xD8D0C0, roughness: 0.7, metalness: 0.0 },

  // Metals
  "structural_steel":        { color: 0x707070, roughness: 0.35, metalness: 0.9 },
  "stainless_steel":         { color: 0xCCCCCC, roughness: 0.2, metalness: 0.95 },
  "aluminum":                { color: 0xDDDDDD, roughness: 0.25, metalness: 0.9 },
  "copper":                  { color: 0xB87333, roughness: 0.3, metalness: 0.85 },
  "corten_steel":            { color: 0x8B4513, roughness: 0.8, metalness: 0.6 },

  // Wood
  "timber":                  { color: 0xA0824A, roughness: 0.6, metalness: 0.0 },
  "oak":                     { color: 0x8B7340, roughness: 0.55, metalness: 0.0 },
  "cedar":                   { color: 0xB8945A, roughness: 0.6, metalness: 0.0 },

  // Glass
  "clear_glass":             { color: 0xCCEEFF, roughness: 0.02, metalness: 0.0, opacity: 0.2, transparent: true, transmission: 0.9, ior: 1.52 },
  "tinted_glass":            { color: 0x668899, roughness: 0.05, metalness: 0.05, opacity: 0.3, transparent: true, transmission: 0.7, ior: 1.52 },
  "frosted_glass":           { color: 0xDDEEFF, roughness: 0.6, metalness: 0.0, opacity: 0.5, transparent: true, transmission: 0.4 },

  // Insulation / finishes
  "gypsum_plaster":          { color: 0xF5F0EB, roughness: 0.92, metalness: 0.0 },
  "terracotta":              { color: 0xB86B4A, roughness: 0.7, metalness: 0.0 },
  "zinc_cladding":           { color: 0x9A9A9A, roughness: 0.3, metalness: 0.85 },
};

/**
 * Get enhanced PBR material by IFC material name.
 * Falls back to element-type-based material if no override found.
 */
export function getMaterialByName(materialName: string, elementType: string): PBRMaterialDef {
  const base = getMaterialForElement(elementType);
  const key = materialName.toLowerCase().replace(/[\s-]+/g, "_");
  const override = IFC_MATERIAL_OVERRIDES[key];
  if (override) {
    return { ...base, ...override };
  }
  return base;
}

// ─── Discipline Color Coding ─────────────────────────────────────────────────

export const DISCIPLINE_COLORS = {
  architectural: 0x4488CC,  // Blue
  structural:    0xCC4444,  // Red
  mep:           0x44AA44,  // Green
} as const;

/**
 * Get discipline color for an element.
 */
export function getDisciplineColor(discipline?: string): number {
  if (discipline === "architectural") return DISCIPLINE_COLORS.architectural;
  if (discipline === "structural") return DISCIPLINE_COLORS.structural;
  if (discipline === "mep") return DISCIPLINE_COLORS.mep;
  return 0x888888;
}

// ─── Storey Colors ───────────────────────────────────────────────────────────

const STOREY_PALETTE = [
  0x4488CC, 0x44AA88, 0xAAAA44, 0xCC8844,
  0xCC4488, 0x8844CC, 0x44CCCC, 0xCC6644,
  0x6688CC, 0x88CC44, 0xCC44CC, 0x44CC88,
];

/**
 * Get color for a storey index.
 */
export function getStoreyColor(storeyIndex: number): number {
  return STOREY_PALETTE[Math.abs(storeyIndex) % STOREY_PALETTE.length];
}
