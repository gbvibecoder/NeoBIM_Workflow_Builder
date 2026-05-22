/**
 * Brief-to-IFC v3 — shared TypeScript contracts.
 *
 * `BriefSpec` is the contract between Layer 1 (Brief Enrichment) and
 * Layer 2 (Generator Agent). It is intentionally additive over the v2
 * `ArchitectScriptData` — v3 generates the script via a tool-using
 * agent loop instead of a single forced-tool call, so the spec is
 * passed straight to the Python sandbox as the initial state of the
 * `BuildFlowIFC` instance the agent operates on.
 *
 * Validation runs through zod at both API boundaries — incoming briefs
 * from `/api/brief-to-ifc/v3/generate` parse via `briefSpecSchema`,
 * outgoing tool payloads to the Railway sandbox use the same shape.
 */

import { z } from "zod";

import {
  tolerantBoundsTuple,
  tolerantEnum,
  tolerantOptionalRgb,
  tolerantPositive,
  tolerantRgbNamed,
} from "./schema-helpers";
import type { SchemaCoercionEvent } from "./telemetry";

// ─── Tolerant numeric vector schemas ─────────────────────────────────
//
// Opus occasionally emits 2-element arrays for fields that require 3
// (e.g. [width, depth] without height). Rather than reject the entire
// spec, we accept 2 or 3 elements and normalize to 3.

/** Tolerant 3D dimensions [width, depth, height] in metres.
 *  Accepts 2 or 3 positive numbers. Missing height defaults to
 *  min(width, depth) — a conservative cube-ish fallback. */
const tolerantDims3Schema = z
  .array(z.number().positive())
  .min(2)
  .max(3)
  .transform((arr): [number, number, number] => {
    if (arr.length === 3) return arr as [number, number, number];
    const [w, d] = arr;
    return [w, d, Math.max(0.01, Math.min(w, d))];
  });

/** Tolerant 3D position/offset [x, y, z] in metres.
 *  Accepts 2 or 3 numbers (may be negative). Missing z defaults to 0. */
const tolerantVec3Schema = z
  .array(z.number())
  .min(2)
  .max(3)
  .transform((arr): [number, number, number] => {
    if (arr.length === 3) return arr as [number, number, number];
    return [...arr, 0] as [number, number, number];
  });

// ─── BriefSpec — leaf schemas ───────────────────────────────────────

/** Canonical project.type values. Opus occasionally emits near-misses
 *  ("office_building", "co-working", "mixed_use") which the previous
 *  hard enum rejected outright. `tolerantEnum` normalises common
 *  near-misses and falls back to `"other"` for genuinely unknown
 *  values — the build proceeds, the coercion is recorded into
 *  telemetry, and δ.2's quality metric can still gate. */
export const PROJECT_TYPE_VALUES = [
  "exhibition_booth", "office", "residential", "retail",
  "gym", "restaurant", "classroom", "studio", "hotel",
  "warehouse", "hospital", "other",
] as const;
export type ProjectType = (typeof PROJECT_TYPE_VALUES)[number];

export const briefProjectSchema = z.object({
  name: z.string().min(1).max(200),
  type: tolerantEnum<ProjectType>({
    fieldName: "project.type",
    values: PROJECT_TYPE_VALUES,
    fallback: "other",
    synonyms: {
      office_building: "office",
      coworking: "office",
      "co_working": "office",
      shared_office: "office",
      apartment: "residential",
      house: "residential",
      flat: "residential",
      villa: "residential",
      shop: "retail",
      store: "retail",
      boutique: "retail",
      cafe: "restaurant",
      coffee_shop: "restaurant",
      bar: "restaurant",
      fitness: "gym",
      health_club: "gym",
      school: "classroom",
      training_room: "classroom",
      lecture_hall: "classroom",
      clinic: "hospital",
      medical: "hospital",
      lodging: "hotel",
      hostel: "hotel",
      storage: "warehouse",
      industrial: "warehouse",
      mixed_use: "other",
      booth: "exhibition_booth",
      exhibition: "exhibition_booth",
      stand: "exhibition_booth",
    },
  }),
  location: z.string().max(200),
  description: z.string().max(4000),
});

export const briefSiteSchema = z.object({
  /** Site bounds [width, depth] in metres. Tolerant of 0-element,
   *  3-element (drops Z), or non-positive inputs. Falls back to a
   *  reasonable default + records the coercion. */
  bounds_m: tolerantBoundsTuple({
    fieldName: "site.bounds_m",
    fallbackWidth: 10,
    fallbackDepth: 10,
    minimum: 0.5,
  }),
  /** Height limit. `0` is a sentinel meaning "uncapped"; any negative
   *  or junk value coerces to the fallback. */
  height_limit_m: tolerantPositive({
    fieldName: "site.height_limit_m",
    fallback: 100,
    minimum: 0,
    maximum: 10_000,
    acceptZero: true,
  }),
  /** Always sw_corner in the current pipeline. Tolerant of casing
   *  variations and absent values — never rejects. */
  coordinate_origin: tolerantEnum<"sw_corner">({
    fieldName: "site.coordinate_origin",
    values: ["sw_corner"] as const,
    fallback: "sw_corner",
    synonyms: { southwest_corner: "sw_corner", origin: "sw_corner", sw: "sw_corner" },
  }),
});

export const briefSpaceSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  long_name: z.string().max(200),
  polygon_world_m: z.array(z.tuple([z.number(), z.number()])).min(3).nullable(),
  circular_centre_radius: z
    .tuple([z.number(), z.number(), z.number().positive()])
    .optional(),
  height_m: z.number().positive(),
  occupancy_type: z.string().max(200),
});

/** Canonical element types. Phase δ.1b added `stair`, `roof`,
 *  `balcony`, `canopy`, `parapet`, `railing` — these were previously
 *  rejected at the schema layer, silently dropping any geometry the
 *  brief asked for. They are now valid; geometry-less ones fall back
 *  to a typed-but-proxy element in buildflow_ifc.py, and the proxy
 *  fallback is recorded in BuildTelemetry so δ.4 can prioritise
 *  implementing real geometry for the most-requested types. */
export const ELEMENT_TYPE_VALUES = [
  "slab", "wall", "column", "beam", "space",
  "covering", "furniture", "lighting", "proxy",
  // Typed openings — added 2026-05-17 (Gap B).
  "door", "window",
  // Phase δ.1b — previously silently rejected at the schema layer.
  "stair", "roof", "balcony", "canopy", "parapet", "railing",
] as const;
export type ElementType = (typeof ELEMENT_TYPE_VALUES)[number];

export const briefElementSchema = z.object({
  id: z.string().min(1).max(64),
  type: tolerantEnum<ElementType>({
    fieldName: "elements[].type",
    values: ELEMENT_TYPE_VALUES,
    fallback: "proxy",
    synonyms: {
      // Common near-misses observed in Opus output.
      floor: "slab",
      ceiling: "slab",
      partition: "wall",
      partition_wall: "wall",
      post: "column",
      pillar: "column",
      girder: "beam",
      joist: "beam",
      room: "space",
      zone: "space",
      flooring: "covering",
      finish: "covering",
      finishes: "covering",
      furnishing: "furniture",
      fixture: "furniture",
      light: "lighting",
      lamp: "lighting",
      fitting: "lighting",
      luminaire: "lighting",
      doorway: "door",
      entrance: "door",
      glazing: "window",
      // δ.1b additions — near-misses for the new types.
      stairway: "stair",
      staircase: "stair",
      steps: "stair",
      stairs: "stair",
      roof_slab: "roof",
      ceiling_roof: "roof",
      terrace: "balcony",
      veranda: "balcony",
      awning: "canopy",
      overhang: "canopy",
      parapet_wall: "parapet",
      handrail: "railing",
      guardrail: "railing",
      balustrade: "railing",
    },
  }),
  origin_world_m: tolerantVec3Schema,
  dims_m: tolerantDims3Schema.optional(),
  radius_m: z.number().positive().optional(),
  polygon_local_m: z.array(z.tuple([z.number(), z.number()])).min(3).optional(),
  rotation_z_rad: z.number().optional(),
  material_id: z.string().min(1),
  description: z.string().max(1000).optional().default(""),
  object_type: z.string().max(200).optional().default(""),
  tag: z.string().max(200).optional().default(""),
  contained_in_space_id: z.string().optional(),
});

/** Canonical material-shading methods. `tolerantEnum` accepts casing
 *  variants ("matte", "metallic") and semantic near-misses ("wood",
 *  "concrete" → "MATT"); unknown values fall back to "MATT" so the
 *  build never fails on a missed material-method classification. */
export const MATERIAL_METHOD_VALUES = ["MATT", "METAL", "PHONG", "PLASTIC"] as const;
export type MaterialMethod = (typeof MATERIAL_METHOD_VALUES)[number];

export const briefMaterialSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  /** RGB triple in [0,1]. Tolerant: 0-255 inputs auto-rescaled, RGBA
   *  truncated to RGB, missing components padded to gray, junk values
   *  fall back to (0.5, 0.5, 0.5). Never rejects. */
  rgb: tolerantRgbNamed("materials[].rgb"),
  specular_rgb: tolerantOptionalRgb.optional(),
  /** Roughness in [0,1]. Tolerant: clamps to range, accepts numeric
   *  strings, falls back to 0.5 on junk. */
  roughness: tolerantPositive({
    fieldName: "materials[].roughness",
    fallback: 0.5,
    minimum: 0,
    maximum: 1,
    acceptZero: true,
  }),
  method: tolerantEnum<MaterialMethod>({
    fieldName: "materials[].method",
    values: MATERIAL_METHOD_VALUES,
    fallback: "MATT",
    synonyms: {
      matte: "MATT",
      flat: "MATT",
      diffuse: "MATT",
      wood: "MATT",
      concrete: "MATT",
      stone: "MATT",
      fabric: "MATT",
      leather: "MATT",
      rubber: "MATT",
      metallic: "METAL",
      steel: "METAL",
      aluminum: "METAL",
      aluminium: "METAL",
      brass: "METAL",
      chrome: "METAL",
      glossy: "PHONG",
      polished: "PHONG",
      glass: "PHONG",
      shiny: "PHONG",
      plastic_finish: "PLASTIC",
      vinyl: "PLASTIC",
      laminate: "PLASTIC",
    },
  }),
  category: z.string().max(200),
});

export const briefBrandLanguageSchema = z.object({
  primary_text: z.string().max(500),
  approved_terms: z.array(z.string().max(200)).max(50),
  forbidden_terms: z.array(z.string().max(200)).max(50),
});

// ─── Phase EFG: Extended schemas ───────────────────────────────────

/** Archetype — drives which deterministic builder to invoke (Phase G).
 *  `"other"` falls back to the agent loop. */
export const archetypeSchema = z.enum([
  "office",
  "residential_2bhk",
  "residential_3bhk",
  "gym",
  "exhibition",
  "retail",
  "restaurant",
  "classroom",
  "other",
]);

/** Global construction parameters inferred from the brief. The enricher
 *  fills defaults when the brief is silent and logs them to
 *  `assumptions_made[]`. */
export const globalParametersSchema = z.object({
  ceiling_height_m: z.number().positive().default(3.0),
  wall_thickness_ext_m: z.number().positive().default(0.2),
  wall_thickness_int_m: z.number().positive().default(0.1),
  slab_thickness_m: z.number().positive().default(0.15),
  roof_thickness_m: z.number().positive().default(0.15),
  default_door_height_m: z.number().positive().default(2.1),
  default_door_width_m: z.number().positive().default(0.9),
  default_window_sill_m: z.number().positive().default(0.9),
  default_window_head_m: z.number().positive().default(2.4),
});

/** Openings as a peer to elements — each door/window carries its host
 *  wall reference and offset so the deterministic builder can cut voids
 *  without LLM guidance. */
export const briefOpeningSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["door", "window"]),
  host_wall_id: z.string().min(1).max(64),
  offset_m: z.number().min(0),
  width_m: z.number().positive(),
  height_m: z.number().positive(),
  sill_m: z.number().min(0).default(0),
  swing: z.enum(["left", "right", "double", "sliding"]).optional(),
  material_id: z.string().min(1),
  description: z.string().max(1000).default(""),
});

/** Furniture layout strategies for deterministic placement.
 *
 *  pitch_x_m / pitch_y_m are nonnegative (not positive) because Opus
 *  occasionally emits 0 for single-instance items. The briefFurnitureSchema
 *  refinement below enforces pitch > 0 only when count > 1. */
export const furnitureLayoutSchema = z.object({
  kind: z.enum(["grid", "explicit", "perimeter_offset"]).default("explicit"),
  rows: z.number().int().positive().optional(),
  cols: z.number().int().positive().optional(),
  pitch_x_m: z.number().nonnegative().optional(),
  pitch_y_m: z.number().nonnegative().optional(),
  offset_m: z.number().min(0).optional(),
});

/** Shape of a decomposed furniture part (Phase Alpha: Item Decomposer). */
export const furniturePartSchema = z.object({
  id: z.string().min(1).max(64),
  subtype: z.string().max(200),
  origin_local_m: tolerantVec3Schema,
  dims_m: tolerantDims3Schema,
  shape: z.enum(["box", "cylinder"]).default("box"),
  rotation_z_rad: z.number().default(0),
  material_id: z.string().min(1),
  ifc_class: z
    .enum([
      "IfcFurnishingElement",
      "IfcSystemFurnitureElement",
      "IfcDiscreteAccessory",
    ])
    .default("IfcFurnishingElement"),
  notes: z.string().max(500).optional(),
  /** Phase Beta 3: when true, this part MUST be built as a separate IFC
   *  element — the agent cannot collapse it into the parent. */
  mandatory: z.boolean().default(false).optional(),
});

export const briefFurnitureSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().max(200),
  count: z.number().int().positive().default(1),
  layout: furnitureLayoutSchema.optional(),
  anchor_space_id: z.string().max(64).optional(),
  bounding_box: tolerantDims3Schema.optional(),
  /** Decomposed physical parts — populated by the Item Decomposer
   *  (TR-028) between enrichment and agent building. When present, the
   *  agent builder creates a parent + child IfcFurnishingElements linked
   *  via IfcRelAggregates. When absent, falls back to single-box. */
  parts: z.array(furniturePartSchema).optional(),
  material_id: z.string().min(1),
  description: z.string().max(1000).default(""),
  /** Phase Beta 3: when true, the Hard Verifier will reject builds that
   *  omit this item. Set by the Spec Patcher on retry iterations. */
  must_build: z.boolean().default(false).optional(),
  /** Phase Beta 3: when true, every entry in parts[] MUST be built as a
   *  separate IFC element. No collapsing tolerated. */
  force_parts: z.boolean().default(false).optional(),
  /** Phase Beta 3: hint for Item Decomposer — produce at least this many
   *  parts on the next decomposition pass. */
  requested_part_count: z.number().int().positive().optional(),
}).refine(
  (item) => {
    const count = item.count ?? 1;
    // Single-instance items: pitch can be 0 or absent
    if (count <= 1) return true;
    // Multi-instance items with grid layout: need at least one non-zero pitch
    if (item.layout?.kind === "grid") {
      const pitchX = item.layout?.pitch_x_m ?? 0;
      const pitchY = item.layout?.pitch_y_m ?? 0;
      return pitchX > 0 || pitchY > 0;
    }
    return true;
  },
  {
    message: "Multi-instance grid furniture (count > 1) requires pitch_x_m > 0 OR pitch_y_m > 0",
    path: ["layout"],
  },
);

/** Lighting zone for deterministic fixture placement. */
export const lightingZoneSchema = z.object({
  anchor_space_id: z.string().max(64),
  fixture_type: z.string().max(200).default("LED Panel"),
  count: z.number().int().positive().default(1),
  layout: furnitureLayoutSchema.optional(),
  material_id: z.string().min(1),
});

export const briefLightingSchema = z.object({
  strategy: z.enum(["grid", "perimeter", "explicit"]).default("grid"),
  zones: z.array(lightingZoneSchema).default([]),
});

/** Assumptions the enricher made where the brief was silent. */
export const assumptionSchema = z.object({
  field: z.string().max(200),
  assumed_value: z.string().max(500),
  reason: z.string().max(500),
});

// ─── Phase Beta 2: Design Rationale (TR-029 Architectural Reasoner) ──

export const designRationaleSchema = z.object({
  itemId: z.string().min(1).max(64),
  position: tolerantVec3Schema,
  rotation_z_rad: z.number().default(0),
  rationale: z.string().min(1).max(500),
});

// ─── Phase Beta 2: Trim & Hardware (TR-030 Trim Specifier) ──────────

export const trimItemSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum([
    "skirting", "picture_rail", "cornice",
    "door_hinge", "door_handle", "door_strike_plate",
    "window_handle", "window_sash_lock",
    "door_sill", "wall_corner_protector",
  ]),
  hostId: z.string().min(1),
  dims_m: tolerantDims3Schema.optional(),
  origin_local_m: tolerantVec3Schema.optional(),
  rotation_z_rad: z.number().default(0),
  material_id: z.string().min(1),
  ifc_class: z
    .enum(["IfcCovering", "IfcDiscreteAccessory", "IfcBuildingElementProxy"])
    .default("IfcDiscreteAccessory"),
});

// ─── Phase Beta 2: Vision Inspector (TR-032) ────────────────────────

export const visionIssueSchema = z.object({
  severity: z.enum(["low", "med", "high"]),
  type: z.enum([
    "geometry", "positioning", "proportions", "missing",
    "collapsed", "material", "other",
  ]),
  description: z.string().max(500),
  affected_element: z.string().optional(),
  /** Phase Beta 3: whether this issue can be fixed by spec patching. */
  fixable: z.boolean().default(true),
  /** Phase Beta 3: recommended patch type for automated spec patching. */
  recommended_patch_type: z.enum([
    "force_parts", "add_position", "fix_size",
    "add_trim", "increase_decomposition", "manual_review",
  ]).optional(),
});

export const visionReportSchema = z.object({
  quality_score: z.number().int().min(0).max(100),
  pass: z.boolean(),
  issues: z.array(visionIssueSchema),
  summary: z.string().max(500),
  inspected_at: z.string(),
});

// ─── Phase Beta 3: Hard Verifier (TR-035) ────────────────────────────

export const verifierMismatchSchema = z.object({
  type: z.enum([
    "missing_parts",
    "missing_item",
    "missing_aggregation",
    "missing_trim",
    "size_mismatch",
    "size_mismatch_minor",
    "missing_covering",
    "unexpected_geometry",
    "wrong_class",
    "unverified",
  ]),
  item_id: z.string(),
  item_type: z.string().optional(),
  expected: z.unknown(),
  actual: z.unknown(),
  severity: z.enum(["low", "med", "high"]),
  description: z.string().max(500),
  suggested_patch: z.string().max(500).optional(),
});

export const verifierReportSchema = z.object({
  verified: z.boolean(),
  parts_coverage: z.number().min(0).max(1),
  trim_coverage: z.number().min(0).max(1),
  mismatches: z.array(verifierMismatchSchema),
  summary: z.string().max(500),
  verified_at: z.string(),
  /** Phase Beta 4: tracks whether this report came from real Railway
   *  parsing or a heuristic fallback. Spec Patcher forces iteration
   *  when source !== "railway". */
  source: z.enum(["railway", "heuristic_fallback", "unavailable"]).default("railway"),
});

// ─── Phase Beta 3: Spec Patcher (TR-033) ─────────────────────────────

export const specPatchSchema = z.object({
  item_id: z.string(),
  patch_type: z.enum([
    "force_parts",
    "add_position",
    "fix_size",
    "add_trim",
    "increase_decomposition",
    "fix_class",
  ]),
  rationale: z.string().max(500),
  payload: z.unknown(),
});

// ─── Phase δ.3: Per-iteration QStash chain state ─────────────────────

/**
 * One entry in `BriefToIfcV3Run.iterationHistory` (Json column, added
 * by migration `20260521120000_v3_iteration_chain`). Persisted across
 * QStash hops so each worker invocation can compute best-so-far and
 * the final COMPLETED transition can lift the best iteration's
 * artifacts into the user-facing row fields. Append-only — never
 * mutated after write.
 */
export interface IterationHistoryEntry {
  /** 1-based iteration number. Matches the QStash payload's iteration. */
  iteration: number;
  /** Quality score from the existing (known-broken) verifier metric.
   *  δ.3 chains around whichever score the metric returns; δ.2 swaps
   *  the formula later. */
  qualityScore: number;
  /** R2 URL of the IFC produced by this iteration. Empty string only
   *  when the iteration's generator failed before finalize_ifc. */
  ifcUrl: string;
  /** Entity count from this iteration's IFC. 0 if generator failed. */
  entityCount: number;
  /** Cost in USD for this iteration's generator run (single iteration). */
  costUsd: number;
  /** Wall-clock duration of this iteration in ms (worker entry → exit). */
  durationMs: number;
  /** Number of agent turns this iteration consumed. */
  turns: number;
  /** Verifier source — "railway" | "heuristic_fallback" | "unavailable". */
  verifierSource: string;
  /** ISO timestamp when this iteration finished. */
  finishedAt: string;
  /** Compressed prior-state summary forwarded to iteration N+1 (if
   *  any). Empty string when this is the terminal iteration. */
  forwardFeedback?: string;
  /** Full SandboxValidateResult — lifted to the run's `finalValidation`
   *  column when this iteration is selected as best on COMPLETED. */
  finalValidation?: SandboxValidateResult | null;
  /** Per-turn token+cost ledger — lifted to the run's `ledger` column
   *  on COMPLETED if this iteration is best. */
  ledger?: AgentTokenLedgerEntry[];
  /** Per-turn tool records — lifted to the run's `turnRecords` column
   *  on COMPLETED if this iteration is best. */
  turnRecords?: AgentTurnRecord[];
}

export const iterationResultSchema = z.object({
  iteration: z.number().int().min(1).max(3),
  ifcUrl: z.string(),
  qualityScore: z.number().min(0).max(100),
  parts_coverage: z.number().min(0).max(1),
  trim_coverage: z.number().min(0).max(1),
  entityCount: z.number().int(),
  elapsedMs: z.number(),
  costUsd: z.number(),
});

export const patcherResultSchema = z.object({
  finalIfcUrl: z.string(),
  finalQualityScore: z.number().min(0).max(100),
  finalEntityCount: z.number().int(),
  iterations: z.array(iterationResultSchema),
  bestIteration: z.number().int(),
  patches_applied: z.array(specPatchSchema),
  total_cost_usd: z.number(),
  total_elapsed_ms: z.number(),
  summary: z.string().max(500),
});

// ─── BriefSpec ──────────────────────────────────────────────────────

export const briefSpecSchema = z.object({
  project: briefProjectSchema,
  site: briefSiteSchema,
  spaces: z.array(briefSpaceSchema).max(64),
  elements: z.array(briefElementSchema).max(2000),
  materials: z.array(briefMaterialSchema).min(1).max(64),
  brand_language: briefBrandLanguageSchema.optional(),
  // Phase EFG extensions — all optional for backward compat with
  // existing Opus outputs that don't know about these fields yet.
  archetype: archetypeSchema.optional(),
  global_parameters: globalParametersSchema.optional(),
  // .catch(undefined) — Opus occasionally emits a description string
  // instead of an array for optional fields. Catch coerces bad types
  // to undefined rather than rejecting the entire spec.
  openings: z.array(briefOpeningSchema).max(200).optional().catch(undefined),
  furniture: z.array(briefFurnitureSchema).max(500).optional().catch(undefined),
  lighting: briefLightingSchema.optional().catch(undefined),
  assumptions_made: z.array(assumptionSchema).max(100).optional().catch(undefined),
  // Phase Beta 2 extensions
  designRationale: z.array(designRationaleSchema).optional().catch(undefined),
  trim: z.array(trimItemSchema).max(500).optional().catch(undefined),
});

export type BriefSpec = z.infer<typeof briefSpecSchema>;
export type BriefSpace = z.infer<typeof briefSpaceSchema>;
export type BriefElement = z.infer<typeof briefElementSchema>;
export type BriefMaterial = z.infer<typeof briefMaterialSchema>;
export type BriefOpening = z.infer<typeof briefOpeningSchema>;
export type FurniturePart = z.infer<typeof furniturePartSchema>;
export type BriefFurniture = z.infer<typeof briefFurnitureSchema>;
export type BriefLighting = z.infer<typeof briefLightingSchema>;
export type GlobalParameters = z.infer<typeof globalParametersSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type DesignRationale = z.infer<typeof designRationaleSchema>;
export type TrimItem = z.infer<typeof trimItemSchema>;
export type VisionIssue = z.infer<typeof visionIssueSchema>;
export type VisionReport = z.infer<typeof visionReportSchema>;
export type VerifierMismatch = z.infer<typeof verifierMismatchSchema>;
export type VerifierReport = z.infer<typeof verifierReportSchema>;
export type SpecPatch = z.infer<typeof specPatchSchema>;
export type IterationResult = z.infer<typeof iterationResultSchema>;
export type PatcherResult = z.infer<typeof patcherResultSchema>;

// ─── Phase γ.1: Direct Agent Mode — advisory suggestions ────────────

/** Suggestions from upstream advisory nodes, passed to the agent
 *  alongside the verbatim brief and the BriefSpec. The agent treats
 *  everything except materials as non-binding. */
export interface AgentInputSuggestions {
  rationale?: DesignRationale[];
  decomposed_furniture?: BriefFurniture[];
  trim?: TrimItem[];
  materials?: BriefMaterial[];
}

// ─── Generator agent loop — tool payloads / outcomes ────────────────

export interface SandboxExecResult {
  session_id: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  error_type: string | null;
  error_message: string | null;
  error_traceback: string | null;
  duration_ms: number;
}

export interface SandboxWorldBboxValidation {
  verdict:
    | "OK"
    | "SCALED_TOO_SMALL"
    | "SCALED_TOO_LARGE"
    | "COLLAPSED_AT_ORIGIN"
    | "OUT_OF_RANGE"
    | "EMPTY"
    | "ERROR";
  expected_extent: [number, number, number] | null;
  actual_bbox: {
    xmin: number; ymin: number; zmin: number;
    xmax: number; ymax: number; zmax: number;
  } | null;
  actual_extent: [number, number, number] | null;
  extent_ratio: [number, number, number] | null;
  suggested_unit_fix: string | null;
  error?: string;
}

export interface SandboxSpacePolygonValidation {
  space_id: string;
  verdict: "OK" | "MISSING" | "MISMATCH" | "NO_POLYGON_REP" | "NO_EXPECTED_POLYGON" | "ERROR";
  expected_polygon: [number, number][];
  actual_polygon: [number, number][] | null;
  max_vertex_delta_m: number | null;
  error?: string;
}

export interface SandboxElementCoverageValidation {
  verdict: "OK" | "MISSING_ELEMENTS" | "ERROR";
  total_expected: number;
  total_actual_in_expected_classes: number;
  by_class_expected: Record<string, number>;
  by_class_actual: Record<string, number>;
  missing_ids: { id: string; expected_class: string }[];
  missing_id_count: number;
  error?: string;
}

export interface SandboxOriginCollapseValidation {
  verdict: "OK" | "COLLAPSED" | "NO_ELEMENTS" | "ERROR";
  total_elements: number;
  at_origin_count: number;
  fraction_at_origin: number;
  collapsed: boolean;
  error?: string;
}

export interface SandboxValidateResult {
  session_id: string;
  schema_name: string | null;
  entity_count: number;
  refs_resolve: boolean;
  spaces_present: string[];
  spaces_missing: string[];
  errors: string[];
  web_ifc_load_test: "PASS" | "FAIL" | "SKIP";
  ascii_only: boolean;
  ascii_first_bad_offset: number | null;
  // Brief-aware visual validators (null when no brief on session).
  world_bbox: SandboxWorldBboxValidation | null;
  space_polygons: SandboxSpacePolygonValidation[] | null;
  element_coverage: SandboxElementCoverageValidation | null;
  origin_collapse: SandboxOriginCollapseValidation | null;
}

export interface SandboxSummaryResult {
  session_id: string;
  summary: {
    schema: string | null;
    entity_count_total: number;
    products_by_class: Record<string, number>;
    materials: string[];
    property_sets: string[];
    spaces: Array<{
      name: string | null;
      long_name: string | null;
      object_type: string | null;
    }>;
    tracked_element_ids: string[];
  };
}

export interface SandboxFinalizeResult {
  session_id: string;
  ifc_url: string;
  ifc_size_bytes: number;
  entity_count: number;
  validation: SandboxValidateResult;
  /** Phase δ.0 — optional structured telemetry from the BuildFlowIFC
   *  session: proxy fallbacks, material misses, dropped elements, and
   *  actually-built element-type counts. Absent when the Python service
   *  is pre-δ.0 (forwards-compatible). Always shape-tolerant on the
   *  TS side — the merge helper guards against missing or junk fields. */
  telemetry?: SandboxFinalizeTelemetry | null;
}

/** Shape mirrored from buildflow_ifc.py's `get_telemetry()` /
 *  `telemetry.json`. Every field is optional from the wire side because
 *  older Python builds may omit it; `BuildTelemetryCollector.mergePythonTelemetry`
 *  validates each slot defensively. */
export interface SandboxFinalizeTelemetry {
  proxy_fallbacks?: Array<{
    requested_type: string;
    ifc_class: string;
    element_id?: string;
    reason: string;
  }>;
  material_misses?: Array<{
    element_id?: string;
    requested_material_id: string;
    fallback_material_id: string;
  }>;
  dropped_elements?: Array<{
    type: string;
    element_id?: string;
    reason: string;
  }>;
  built_element_counts?: Record<string, number>;
}

// ─── Generator outcome ──────────────────────────────────────────────

export interface AgentTokenLedgerEntry {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface AgentTurnRecord {
  turn: number;
  toolName: string | null;
  toolArgsPreview: string;
  toolDurationMs: number;
  toolOk: boolean;
  toolErrorType: string | null;
  /** Layer 1.5 (AGENT_FAILURE_DIAGNOSIS_2026-05-22.md): when the underlying
   *  sandbox call returned an http-error, the HTTP status code is surfaced
   *  here so logs/telemetry can distinguish session-loss (404) from
   *  service errors (500) without having to infer from timings. Undefined
   *  for non-http-error failures and for successful calls. */
  httpStatus?: number;
  /** Layer 1.5: first ~200 chars of the sandbox-error message (which
   *  already inlines the response-body slice — see sandbox-client.ts).
   *  Undefined unless the call failed with http-error. Capped so logs
   *  stay cheap. */
  httpBodySnippet?: string;
  /** Layer 1 — set to true on the turn where session auto-recovery
   *  successfully re-bootstrapped the sandbox session (the failing
   *  `run_python` was retried with `brief` + `sessionId = null` and
   *  the retry succeeded). Telemetry uses this to count recovery
   *  events vs. unrecoverable losses. */
  sessionRecovered?: boolean;
}

export interface GeneratorResult {
  ok: boolean;
  ifcUrl: string | null;
  entityCount: number;
  costUsd: number;
  durationMs: number;
  turns: number;
  ledger: AgentTokenLedgerEntry[];
  turnRecords: AgentTurnRecord[];
  finalValidation: SandboxValidateResult | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export interface BriefEnrichmentResult {
  ok: boolean;
  brief: BriefSpec | null;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Phase δ.1a — schema-tolerance coercions captured during the
   *  briefSpec parse. Empty when no coercions fired or when the parse
   *  failed before any tolerant helper ran. Callers persist these as
   *  BuildTelemetry.schemaCoercions (or their own diagnostic log) so
   *  the recovery rate is observable. */
  coercions?: SchemaCoercionEvent[];
  /** Set to true when the result was served from the v3 result cache
   *  (see src/lib/result-cache.ts). On cache hit, `costUsd` is rewritten
   *  to 0 so per-build cost accounting stays accurate. */
  cacheHit?: boolean;
  error: {
    code: string;
    message: string;
  } | null;
}
