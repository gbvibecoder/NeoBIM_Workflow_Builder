/* ─── IFC Enhance — asset paths & PBR specs ───────────────────────────────
   Filenames verified against disk at 2026-04-22 (see Phase 2 report §8). */

import type { EnhanceTag, HDRIPreset, MaterialQuality } from "./types";

export const HDRI_PATHS: Record<HDRIPreset, string> = {
  day: "/hdri/day.exr",
  sunset: "/hdri/sunset.exr",
  overcast: "/hdri/overcast.exr",
  night: "/hdri/night.exr",
  studio: "/hdri/studio.exr",
};

/** Per-HDRI key-light intensity multiplier. Day = reference (1.0). */
export const HDRI_KEYLIGHT_INTENSITY: Record<HDRIPreset, number> = {
  day: 1.0,
  sunset: 0.9,
  overcast: 0.5,
  night: 0.2,
  studio: 0.8,
};

export interface PBRSpec {
  /** Folder path under `public/`. */
  base: string;
  /** Poly Haven slug — filename prefix. */
  slug: string;
  /** Whether this material has a `_metal_2k.jpg` map. */
  hasMetal: boolean;
  /** Texture repeat, in world-space metres per tile. */
  tilingMetres: number;
  /** PBR parameters applied alongside the maps. */
  roughness: number;
  metalness: number;
  /** Optional tint on the diffuse (RGB 0..1). Undefined → white. */
  colorTint?: [number, number, number];
}

/**
 * Mapping from classifier tag → PBR texture spec. Absent tags are rendered
 * with a procedural neutral material (see material-catalog).
 * `window-glass` is built procedurally (MeshPhysicalMaterial) — no textures.
 * `space` is a sentinel and never retextured.
 */
export const PBR_BY_TAG: Partial<Record<EnhanceTag, PBRSpec>> = {
  "wall-exterior": {
    base: "/textures/enhance/brick",
    slug: "red_brick_03",
    hasMetal: false,
    tilingMetres: 1.5,
    roughness: 0.92,
    metalness: 0,
  },
  "wall-interior": {
    base: "/textures/enhance/paint",
    slug: "painted_plaster_wall",
    hasMetal: false,
    tilingMetres: 2.5,
    roughness: 0.88,
    metalness: 0,
  },
  "floor-slab": {
    base: "/textures/enhance/wood_floor",
    slug: "wood_floor",
    hasMetal: false,
    tilingMetres: 2.0,
    roughness: 0.55,
    metalness: 0,
  },
  "roof-slab": {
    base: "/textures/enhance/roof_tile",
    slug: "roof_09",
    hasMetal: false,
    tilingMetres: 2.0,
    roughness: 0.72,
    metalness: 0,
  },
  "door": {
    base: "/textures/enhance/wood_door",
    slug: "wood_cabinet_worn_long",
    hasMetal: false,
    tilingMetres: 1.2,
    roughness: 0.55,
    metalness: 0,
  },
};

export const QUALITY_PRESETS: Record<MaterialQuality, { anisotropy: number; useAO: boolean }> = {
  low:    { anisotropy: 4,  useAO: false },
  medium: { anisotropy: 8,  useAO: true },
  high:   { anisotropy: 16, useAO: true },
};

/** Suffixes on the on-disk filenames — all four always present. */
export const TEXTURE_SUFFIXES = {
  diffuse: "_diffuse_2k.jpg",
  rough: "_rough_2k.jpg",
  ao: "_ao_2k.jpg",
  normal: "_nor_gl_2k.png",
  metal: "_metal_2k.jpg",
} as const;

/* ─── Phase 3 — Tier 2 Site Context constants (ground-only, post-strip) ──
   Additive. Phase 2 constants above are frozen. Trees, shrubs, road,
   sidewalk, and street lamps are removed — only the ground plane remains. */

/** Site extent — ground plane half-side = building max-extent × this. */
export const GROUND_SIZE_MULTIPLIER = 5;

/** Re-used texture specs for the ground plane (share Phase 2 texture
    cache via `loadPBRTextures` — same slug+quality key). */
export const GROUND_TEXTURE_SPECS = {
  grass: {
    base: "/textures/enhance/grass",
    slug: "aerial_grass_rock",
    hasMetal: false,
    tilingMetres: 4.0,
    roughness: 0.95,
    metalness: 0,
  },
  concrete: {
    base: "/textures/enhance/concrete_floor",
    slug: "concrete_floor_02",
    hasMetal: false,
    tilingMetres: 2.0,
    roughness: 0.9,
    metalness: 0,
  },
  asphalt: {
    base: "/textures/enhance/asphalt",
    slug: "asphalt_02",
    hasMetal: false,
    tilingMetres: 4.0,
    roughness: 0.92,
    metalness: 0,
  },
} as const;
