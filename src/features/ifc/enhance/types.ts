/* ─── IFC Enhance — shared types ───────────────────────────────────────────
   Tier 1 feature surface. Consumed by classifier, material-catalog,
   tier1-engine, and IFCEnhancePanel. */

/**
 * Classifier output. Every IFC mesh in the model receives exactly one tag,
 * which drives material assignment in the catalog. `space` is a sentinel —
 * IFCSPACE meshes render at 0.15 alpha today (see Viewport.tsx
 * getMaterialPreset for IFCSPACE) and must NOT be retextured.
 */
export type EnhanceTag =
  | "wall-exterior"
  | "wall-interior"
  | "window-glass"
  | "door"
  | "floor-slab"
  | "roof-slab"
  | "column"
  | "beam"
  | "stair"
  | "railing"
  | "space"
  | "other";

export type HDRIPreset = "day" | "sunset" | "overcast" | "night" | "studio";

export type MaterialQuality = "low" | "medium" | "high";

/** User-facing toggle state. Persisted in the panel's local state only. */
export interface EnhanceToggles {
  /** Master switch for material swap. */
  materials: boolean;
  /** Master switch for HDRI environment swap. */
  hdri: boolean;
  /** Which HDRI to load when hdri=true. */
  hdriPreset: HDRIPreset;
  /** Emissive glow on window glass — stronger at night. */
  litInteriorWindows: boolean;
  /** Texture quality — scales anisotropy and AO inclusion. */
  quality: MaterialQuality;
}

export const DEFAULT_TOGGLES: EnhanceToggles = {
  materials: true,
  hdri: true,
  hdriPreset: "day",
  litInteriorWindows: true,
  quality: "medium",
};

/** Engine status for the panel's progress UI. */
export type EnhanceStatus =
  | { kind: "idle" }
  | { kind: "loading"; step: string; progress: number }
  | { kind: "applied"; toggles: EnhanceToggles; counts: Partial<Record<EnhanceTag, number>> }
  | { kind: "error"; message: string };

export interface ClassifiedMesh {
  expressID: number;
  tag: EnhanceTag;
}

/* ─── Phase 3 — Tier 2 Site Context ──────────────────────────────────────
   Additive: Phase 2 types above are unchanged. Tier 2 orchestration is a
   separate engine (`tier2/tier2-engine.ts`) that mounts new Object3D
   subtrees via `ViewportHandle.mountEnhancements(nodes, { tier: 2 })` and
   never touches IFC model materials. */

export type GroundType = "auto" | "grass" | "concrete" | "asphalt";

export type RoadSide = "north" | "east" | "south" | "west" | "none";

export interface Tier2Toggles {
  /** Master switch — if false, skip ALL Phase 3 work. */
  context: boolean;
  /** Ground plane enabled. */
  ground: boolean;
  groundType: GroundType;
  /** Sidewalk ring around building. */
  sidewalk: boolean;
  /** Road along one side. */
  road: boolean;
  roadSide: RoadSide;
  /** Number of trees to scatter (0–40). */
  treeCount: number;
  /** Number of shrubs to scatter (0–30). */
  shrubCount: number;
  /** Street lamps along road edge. */
  lamps: boolean;
}

export const DEFAULT_TIER2_TOGGLES: Tier2Toggles = {
  context: true,
  ground: true,
  groundType: "auto",
  sidewalk: true,
  road: true,
  roadSide: "east",
  treeCount: 20,
  shrubCount: 15,
  lamps: true,
};

export interface Tier2ApplyResult {
  success: boolean;
  message?: string;
  groundAreaM2: number;
  treesPlaced: number;
  shrubsPlaced: number;
  lampsPlaced: number;
  durationMs: number;
}
