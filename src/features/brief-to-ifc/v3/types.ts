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

// ─── BriefSpec — leaf schemas ───────────────────────────────────────

export const briefProjectSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["exhibition_booth", "office", "residential", "retail"]),
  location: z.string().max(200),
  description: z.string().max(4000),
});

export const briefSiteSchema = z.object({
  bounds_m: z.tuple([z.number().positive(), z.number().positive()]),
  height_limit_m: z.number().positive(),
  coordinate_origin: z.literal("sw_corner"),
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

export const briefElementSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum([
    "slab",
    "wall",
    "column",
    "beam",
    "space",
    "covering",
    "furniture",
    "lighting",
    "proxy",
  ]),
  origin_world_m: z.tuple([z.number(), z.number(), z.number()]),
  dims_m: z
    .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
    .optional(),
  radius_m: z.number().positive().optional(),
  polygon_local_m: z.array(z.tuple([z.number(), z.number()])).min(3).optional(),
  rotation_z_rad: z.number().optional(),
  material_id: z.string().min(1),
  description: z.string().max(1000),
  object_type: z.string().max(200),
  tag: z.string().max(200),
  contained_in_space_id: z.string().optional(),
});

export const briefMaterialSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  rgb: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  specular_rgb: z
    .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
    .optional(),
  roughness: z.number().min(0).max(1),
  method: z.enum(["MATT", "METAL", "PHONG", "PLASTIC"]),
  category: z.string().max(200),
});

export const briefBrandLanguageSchema = z.object({
  primary_text: z.string().max(500),
  approved_terms: z.array(z.string().max(200)).max(50),
  forbidden_terms: z.array(z.string().max(200)).max(50),
});

// ─── BriefSpec ──────────────────────────────────────────────────────

export const briefSpecSchema = z.object({
  project: briefProjectSchema,
  site: briefSiteSchema,
  spaces: z.array(briefSpaceSchema).max(64),
  elements: z.array(briefElementSchema).max(2000),
  materials: z.array(briefMaterialSchema).min(1).max(64),
  brand_language: briefBrandLanguageSchema,
});

export type BriefSpec = z.infer<typeof briefSpecSchema>;
export type BriefSpace = z.infer<typeof briefSpaceSchema>;
export type BriefElement = z.infer<typeof briefElementSchema>;
export type BriefMaterial = z.infer<typeof briefMaterialSchema>;

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
  error: {
    code: string;
    message: string;
  } | null;
}
