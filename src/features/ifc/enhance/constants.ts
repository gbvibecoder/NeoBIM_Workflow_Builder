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

/* ─── Phase 3.5a — Tier 3 roof treatment constants ────────────────────────
   Additive. Every number above is frozen. These drive parapet, terrace
   deck, bulkhead (HVAC + stair access), and pitched gable synthesis in
   `tier3/`. */

/** Parapet dimensions — standard architectural guard height. */
export const PARAPET = {
  heightM: 1.0,
  thicknessM: 0.15,
} as const;

/** Terrace deck geometry. */
export const DECK = {
  /** Anti-z-fight offset above the (hidden) original roof slab top surface. */
  elevationAboveSlabM: 0.01,
  /** Target world-space plank width — drives UV scaling on the deck plane. */
  plankWidthM: 0.15,
} as const;

/** Bulkhead (HVAC + stair access) constants. */
export const BULKHEAD = {
  stairWidthM: 2.0,
  stairDepthM: 2.0,
  stairHeightM: 2.5,
  stairInsetFromEdgeM: 1.0,

  hvacWidthM: 0.9,
  hvacHeightM: 0.7,
  hvacDepthM: 0.6,
  hvacInsetFromEdgeM: 1.5,
  hvacSpacingMinM: 2.0,

  hvac2CountThresholdM2: 50,
  hvac3CountThresholdM2: 100,

  hvacColor: 0x454a52,
  hvacMetalness: 0.6,
  hvacRoughness: 0.45,

  doorWidthM: 0.9,
  doorHeightM: 2.0,
  doorColor: 0x2a1e16,
} as const;

/** Pitched gable roof constants. */
export const GABLE = {
  defaultPitchDeg: 30,
  minPitchDeg: 15,
  maxPitchDeg: 45,
  eaveOverhangM: 0.25,
  fasciaThicknessM: 0.03,
  /** Tile UV scale — 1 texture tile ≈ 1 m of slope. */
  tileUvScalePerMeter: 1.0,
} as const;

/* ─── Phase 4a — building detail constants (railings, frames, sills) ──────
   Additive. Every number above is frozen. These drive balcony detection,
   railing assembly, window frame/mullion geometry, and concrete sill
   placement in `tier4/`. */

/** Balcony railings along cantilever floor-slab edges. */
export const RAILING = {
  /** Railing height above slab surface. */
  heightM: 1.1,
  /** Top rail cylinder dimensions. */
  topRailRadiusM: 0.025,
  /** Vertical baluster dimensions. */
  balusterRadiusM: 0.015,
  /** Spacing between baluster centres along an edge. */
  balusterSpacingM: 0.12,
  /** Base rail (horizontal bar just above slab). */
  baseRailRadiusM: 0.015,
  baseRailOffsetM: 0.08,
  /** Minimum edge length to bother with a railing. */
  minEdgeLengthM: 0.5,
  /** Metal PBR. */
  metal: {
    color: 0x2a2a2a,
    metalness: 0.7,
    roughness: 0.4,
  },
} as const;

/** Window frame (+ optional mullion / transom) dimensions per window. */
export const WINDOW_FRAME = {
  /** Frame member face width (thickness on-wall). */
  widthM: 0.06,
  /** Frame member depth (perpendicular to wall face). */
  depthM: 0.05,
  /** How far the frame protrudes outward from the glass plane. */
  protrusionM: 0.02,
  /** Add a vertical mullion if window wider than this. */
  mullionWidthThresholdM: 1.2,
  /** Add a horizontal transom if window taller than this. */
  transomHeightThresholdM: 1.5,
  /** Minimum fraction of horizontal normal weight that must align with
   *  the winning ±X/±Z axis before we call a window "cardinal-facing".
   *  Windows below this threshold (non-axis-aligned, e.g. curved
   *  facades) are skipped — better no frame than a wrong-axis frame
   *  floating in front of a tangential curtain wall. A perfect cardinal
   *  window scores 1.0; a 45° diagonal scores 0.5; a 22° off-cardinal
   *  window scores ~0.73. Default 0.7 allows ≤ ~23° off-cardinal. */
  minCardinalAlignment: 0.7,
  /** Colour → PBR params. */
  colors: {
    aluminum: { color: 0xc0c0c0, metalness: 0.6, roughness: 0.4 },
    "white-pvc": { color: 0xf5f5f0, metalness: 0.0, roughness: 0.5 },
    wood: { color: 0x5a3a22, metalness: 0.0, roughness: 0.8 },
  },
} as const;

/** Concrete / stone sill below each window frame. */
export const WINDOW_SILL = {
  /** Vertical gap between sill top and window bottom. */
  belowFrameM: 0.02,
  /** Sill slab height. */
  heightM: 0.05,
  /** How far the sill projects outward from the wall face. */
  depthM: 0.15,
  /** Extra width on each side beyond the window frame. */
  overhangM: 0.05,
  /** Concrete / stone PBR. */
  material: {
    color: 0xb5b0a8,
    metalness: 0.0,
    roughness: 0.8,
  },
} as const;

/** Cantilever balcony detection thresholds. */
export const BALCONY_DETECT = {
  /** Slab AABB edge must extend past the wall AABB by ≥ this to count.
   *  Legacy from the AABB-edge detector; kept as a guard against
   *  sub-centimetre numerical jitter in the polygon-aware path. */
  minCantileverDistanceM: 0.3,
  /** Skip the topmost slab — tier 3 parapet already owns that perimeter. */
  excludeTopSlab: true,
  /** Hotfix: minimum polygon area to register as a balcony. Below this
   *  a sliver is treated as drip-edge / structural overhang, not a
   *  functional balcony. */
  minAreaM2: 1.5,
  /** Hotfix: Douglas-Peucker tolerance when simplifying slab polygons
   *  (matches tier3's roof polygon tolerance). */
  simplifyToleranceM: 0.05,
  /** Hotfix: always drop the topmost balcony from the final result so
   *  the highest level's cantilever is treated as drip-edge / never
   *  conflicts with an as-yet-unbuilt upper-storey parapet. */
  skipTopmostAlways: true,
} as const;
