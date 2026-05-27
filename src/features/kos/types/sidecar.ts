/**
 * KOS Python sidecar — TypeScript types for /kos/generate-panel-layout,
 * /boq/generate, /formwork/generate.
 *
 * Evidence base — DO NOT GUESS:
 *   - temp_folder/sidecar-capture/REPORT.md (DXF probe + BOQ + Formwork captures)
 *   - temp_folder/pdf-probe/REPORT.md       (PDF probe + mapper compat check)
 * Last verified against the live Railway sidecar: 2026-05-27.
 *
 * Three quirks the captures pinned down (NOT in the sidecar's OpenAPI):
 *   1. Parser→Mapper schema drift — parser emits `drawing_type` +
 *      `drawing_type_confidence`; mapper REQUIRES `drawing_classification` +
 *      `drawing_classification_confidence`. The adapter at
 *      `parser-to-mapper-adapter.ts` shims this; the `MapperParserOutputInput`
 *      type below carries the adapter's output shape.
 *   2. `BOQContext` / `FormworkContext` required fields are NOT exposed in
 *      OpenAPI (additionalProperties: true). They were discovered by
 *      triggering 422s. The wrappers add a regression test that catches
 *      future drift.
 *   3. Formwork response has 15 top-level keys (NOT the 16 the docstring
 *      claims) — `commercial_terms` is intentionally absent per Karthik
 *      2026-05-26 "no pricing in 5F".
 */

import type { DrawingParseResult } from "./drawing";

// ── Sidecar error envelope (union of 3 shapes from §3.8 of PR 2a prompt) ──
//
//   parse-drawing 4xx:   { error, message }
//   mapper        4xx:   { error, message, hint? }
//   BOQ/Formwork  4xx:   { error_code, message, hint?, invariant_id? }
//
// Modeled as a single permissive union so the shared sidecar client can
// destructure either shape without branching by endpoint.
export interface KosSidecarErrorEnvelope {
  /** parse-drawing + mapper use this key */
  error?: string;
  /** BOQ / Formwork use this key instead */
  error_code?: string;
  /** Always present */
  message: string;
  /** mapper + BOQ/Formwork only */
  hint?: string;
  /** BOQ/Formwork only */
  invariant_id?: string;
}

// ── /kos/generate-panel-layout input ─────────────────────────────────────

export type ApplicationHint =
  | "internal_partition"
  | "villa_external"
  | "apartment_external_g3"
  | "apartment_external_g5"
  | "school_commercial_g3"
  | "lift_shaft_g5"
  | "shear_wall_g10"
  | "basement_lt3m"
  | "basement_gt3m"
  | "retaining";

export type SeismicZone = "II" | "III" | "IV" | "V";
export type SplitStrategy = "minimize_panels" | "minimize_cuts" | "symmetric";

export interface MapperProjectContext {
  /** Non-empty. Sidecar Pydantic rule: min length 1. */
  project_name: string;
  /** Sidecar default: "III". */
  seismic_zone?: SeismicZone;
  /** Enum-typed for editor autocomplete; sidecar validates the literal set. */
  application_hint?: ApplicationHint | null;
  /** Sidecar default: "minimize_cuts". */
  split_strategy?: SplitStrategy;
  /** 1..20000. Sidecar default: 3000. */
  wall_height_mm?: number;
}

/**
 * The shape of `parser_output` that the mapper accepts, AFTER the
 * adapter has run. All 25 parser fields are preserved verbatim, but
 * the two classification keys are renamed:
 *
 *   parser_output.drawing_type            → drawing_classification
 *   parser_output.drawing_type_confidence → drawing_classification_confidence
 *
 * The original keys are kept too (the parser's downstream consumers
 * may still reference them).
 */
export interface MapperParserOutputInput
  extends Omit<DrawingParseResult, "drawing_type" | "drawing_type_confidence"> {
  drawing_classification: string;
  drawing_classification_confidence: number;
  drawing_type?: string;
  drawing_type_confidence?: number;
}

export interface MapperInput {
  parser_output: MapperParserOutputInput;
  project_context: MapperProjectContext;
}

// ── /kos/generate-panel-layout output (22 top-level keys per capture) ────
//
// Sub-shapes are kept permissive because the mapper's internal schema is
// still under churn upstream (PanelGridMapperOutput is not in OpenAPI).
export interface MapperOutput {
  project_name: string;
  seismic_zone: SeismicZone;
  split_strategy_used: SplitStrategy;
  wall_height_mm: number;
  wall_segments: unknown[];
  custom_quote_requests: unknown[];
  total_counts: Record<string, unknown>;
  /** Sidecar emits the literal string "TBD" in some custom-quote-only branches. */
  total_cost_inr: number | string;
  total_weight_kg: number;
  total_skin_kg: number;
  total_rib_kg: number;
  total_raw_kg: number;
  total_waste_kg: number;
  warnings: string[];
  assumptions_made: string[];
  pending_karthik: unknown[];
  info_notes: string[];
  schema_version: string;
  generated_at: string;
  waste_ratio: number;
  downstream_ready: { boq: boolean; formwork: boolean; shop_drawings: boolean };
  duration_ms: number;
}

// ── /boq/generate input (16-field output) ────────────────────────────────

/**
 * BOQContext — REQUIRED fields are NOT documented in OpenAPI.
 * Discovered via 422 responses; wrapper enforces them defensively.
 */
export interface BOQContext {
  project_id: string;
  project_name: string;
  /** ISO YYYY-MM-DD. Wrapper validates the format. */
  quote_date: string;
}

export interface BOQInput {
  mapper_output: MapperOutput;
  context: BOQContext;
}

/**
 * BOQ output — 16 top-level keys per capture.
 *
 * NOTE: `tier_2_categories` is an OBJECT (dict keyed by category name)
 * per captured evidence, NOT a list. Same for `tier_1_summary`,
 * `commercial_terms`, and `audit_trail`.
 * `tier_3..tier_6` are lists.
 */
export interface BOQOutput {
  boq_id: string;
  generated_at: string;
  schema_version: string;
  tier_1_summary: Record<string, unknown>;
  tier_2_categories: Record<string, unknown>;
  tier_3_sku_types: unknown[];
  tier_4_sku_details: unknown[];
  tier_5_wall_segments: unknown[];
  tier_6_panel_pieces: unknown[];
  custom_quote_items: unknown[];
  operator_review_items: unknown[];
  commercial_terms: Record<string, unknown>;
  audit_trail: Record<string, unknown>;
  warnings: string[];
  assumptions_made: string[];
  pending_karthik: unknown[];
}

// ── /formwork/generate input + output (15-field output) ──────────────────

export interface FormworkContext extends BOQContext {}

export interface FormworkInput {
  mapper_output: MapperOutput;
  context: FormworkContext;
}

/**
 * Formwork output — 15 top-level keys.
 *
 * `commercial_terms` is intentionally absent (Karthik 2026-05-26:
 * "no pricing in 5F output"). Do NOT add it back without checking with
 * Karthik first.
 */
export interface FormworkOutput {
  formwork_id: string;
  generated_at: string;
  schema_version: string;
  tier_1_summary: Record<string, unknown>;
  tier_2_categories: Record<string, unknown>;
  tier_3_sku_types: unknown[];
  tier_4_sku_details: unknown[];
  tier_5_wall_segments: unknown[];
  tier_6_components: unknown[];
  custom_quote_items: unknown[];
  operator_review_items: unknown[];
  audit_trail: Record<string, unknown>;
  warnings: string[];
  assumptions_made: string[];
  pending_karthik: unknown[];
}
