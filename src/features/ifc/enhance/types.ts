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

/* ─── Phase 3 — Tier 2 Site Context (ground-only, post-strip) ─────────────
   Additive: Phase 2 types above are unchanged. Tier 2 orchestration is a
   separate engine (`tier2/tier2-engine.ts`) that mounts a ground plane
   via `ViewportHandle.mountEnhancements(nodes, { tier: 2 })` and never
   touches IFC model materials.

   Phase 3 strip: trees, shrubs, street lamps, road and sidewalk ring
   removed — will be reintroduced in a later phase with better design.
   Only the ground plane remains as Tier 2's visible output. */

export type GroundType = "auto" | "grass" | "concrete" | "asphalt";

export interface Tier2Toggles {
  /** Master switch — if false, skip ALL Phase 3 work. */
  context: boolean;
  /** Ground plane enabled. */
  ground: boolean;
  /** Which texture spec to stretch across the ground plane. */
  groundType: GroundType;
}

export const DEFAULT_TIER2_TOGGLES: Tier2Toggles = {
  context: true,
  ground: true,
  groundType: "auto",
};

export interface Tier2ApplyResult {
  success: boolean;
  message?: string;
  groundAreaM2: number;
  durationMs: number;
}

/* ─── Phase 3.5a — Tier 3 roof treatment ─────────────────────────────────
   Additive. Phase 2 + Phase 3 Tier 2 types above are unchanged. Tier 3 is
   orchestrated by `tier3/tier3-engine.ts` and mounts roof geometry under
   `ViewportHandle.mountEnhancements(nodes, { tier: 3 })`. It NEVER swaps
   materials on the IFC model — it only hides the original roof-slab via
   `mesh.visible = false` and builds supplementary roof elements above. */

export type RoofStyle = "auto" | "gable" | "flat-terrace";
export type DeckMaterial = "wood" | "ceramic" | "concrete";
export type RidgeDirection = "auto" | "ns" | "ew";

export interface Tier3Toggles {
  /** Master switch. */
  enabled: boolean;
  /** Style — "auto" picks gable for 1-storey, flat-terrace for 2+. */
  style: RoofStyle;
  /** Deck material — only consulted when style resolves to flat-terrace. */
  deckMaterial: DeckMaterial;
  /** Pitch angle in degrees — only consulted when style resolves to gable. */
  pitchDeg: number;
  /** Ridge direction — only consulted when style resolves to gable. */
  ridgeDirection: RidgeDirection;
  /** HVAC + stair bulkhead toggle — only consulted for flat-terrace. */
  bulkheads: boolean;
}

export const DEFAULT_TIER3_TOGGLES: Tier3Toggles = {
  enabled: true,
  style: "auto",
  deckMaterial: "wood",
  pitchDeg: 30,
  ridgeDirection: "auto",
  bulkheads: true,
};

export interface Tier3ApplyResult {
  success: boolean;
  resolvedStyle: "gable" | "flat-terrace" | "skipped";
  message?: string;
  parapetLengthM?: number;
  deckAreaM2?: number;
  hvacCount?: number;
  stairBulkhead?: boolean;
  pitchDeg?: number;
  ridgeDirection?: "ns" | "ew";
  durationMs: number;
}
