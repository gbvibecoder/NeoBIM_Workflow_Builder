/* ─── IFC Enhance — shared types ───────────────────────────────────────────
   Tier 1 feature surface. Consumed by classifier, material-catalog,
   tier1-engine, and IFCEnhancePanel. */

import type { Vector2 } from "three";

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
  /* Phase 3.5b — polygon-aware footprint telemetry. Absent when tier3
     was skipped or failed before extraction. */
  shapeType?: RoofShapeType;
  vertexCount?: number;
  /** True iff polygon extraction bailed to an AABB rectangle. */
  usedFallback?: boolean;
}

/* ─── Phase 3.5b — polygon-aware footprint ────────────────────────────────
   Replaces Phase 3.5a's AABB-only footprint. The 2D outline of the roof
   slab is extracted from the top-facing triangles of the roof-slab mesh(es),
   chained into a closed CCW loop, simplified, and classified. All tier3
   builders (parapet, deck, bulkheads, gable) read from this shape; gable
   specifically uses the inscribed AABB because ridge+slope topology is
   rectangular by construction. `Vector2` components use `(x, y) = (worldX,
   worldZ)` — the 2D "y" is always the horizontal Z axis, never world Y. */

export type RoofShapeType = "rectangle" | "circular" | "polygon";

export interface RoofFootprint {
  /** Ordered closed loop, CCW winding in (X, Z). No duplicate close vertex. */
  vertices: Vector2[];
  vertexCount: number;
  shapeType: RoofShapeType;
  /** World Y of the roof slab's top surface — parapet base / eave elevation. */
  topY: number;
  /** True geometric centroid of the polygon (NOT the AABB centre). */
  centerX: number;
  centerZ: number;
  /** Polygon area via shoelace, absolute value. */
  areaM2: number;
  /** Axis-aligned bounds — useful for gable ridge + coarse HVAC layout. */
  aabb: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Which AABB axis is longer — drives gable ridge default. */
  longerAxis: "x" | "z";
  /** Set true iff extraction fell back to the AABB rectangle. */
  isFallback: boolean;
}
