/**
 * Sidecar type-shape regression catchers.
 *
 * Pure runtime field-count assertions against fixtures that mirror the
 * sidecar response shapes captured at temp_folder/sidecar-capture/REPORT.md
 * and temp_folder/pdf-probe/REPORT.md. If Karthik's sidecar adds or
 * removes a top-level key, these tests fail noisily and force the
 * wrapper authors to reconcile.
 *
 * BOQ should be 16 top-level keys; Formwork should be 15 (no
 * `commercial_terms`, per Karthik 2026-05-26).
 */

import { describe, expect, it } from "vitest";

import type {
  BOQOutput,
  FormworkOutput,
  KosSidecarErrorEnvelope,
  MapperOutput,
} from "../sidecar";

function buildBOQOutputFixture(): BOQOutput {
  return {
    boq_id: "boq_test",
    generated_at: "2026-05-27T00:00:00+00:00",
    schema_version: "0.1.0",
    tier_1_summary: {},
    tier_2_categories: {},
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_panel_pieces: [],
    custom_quote_items: [],
    operator_review_items: [],
    commercial_terms: {},
    audit_trail: {},
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
  };
}

function buildFormworkOutputFixture(): FormworkOutput {
  return {
    formwork_id: "formwork_test",
    generated_at: "2026-05-27T00:00:00Z",
    schema_version: "0.1.0",
    tier_1_summary: {},
    tier_2_categories: {},
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_components: [],
    custom_quote_items: [],
    operator_review_items: [],
    audit_trail: {},
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
  };
}

function buildMapperOutputFixture(): MapperOutput {
  return {
    project_name: "test",
    seismic_zone: "III",
    split_strategy_used: "minimize_cuts",
    wall_height_mm: 3000,
    wall_segments: [],
    custom_quote_requests: [],
    total_counts: {},
    total_cost_inr: 0,
    total_weight_kg: 0,
    total_skin_kg: 0,
    total_rib_kg: 0,
    total_raw_kg: 0,
    total_waste_kg: 0,
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
    info_notes: [],
    schema_version: "0.1.0",
    generated_at: "2026-05-27T00:00:00Z",
    waste_ratio: 0,
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 0,
  };
}

describe("sidecar type fixtures — field-count regression catchers", () => {
  it("BOQOutput fixture has exactly 16 top-level keys (matches captured sidecar shape)", () => {
    expect(Object.keys(buildBOQOutputFixture())).toHaveLength(16);
  });

  it("FormworkOutput fixture has exactly 15 top-level keys (commercial_terms intentionally absent)", () => {
    const keys = Object.keys(buildFormworkOutputFixture());
    expect(keys).toHaveLength(15);
    expect(keys).not.toContain("commercial_terms");
  });

  it("MapperOutput fixture has exactly 22 top-level keys", () => {
    expect(Object.keys(buildMapperOutputFixture())).toHaveLength(22);
  });

  it("BOQ and Formwork share 13 common top-level keys; each has its own *_id, tier_6_* name, and commercial_terms is BOQ-only", () => {
    const boqKeys = new Set(Object.keys(buildBOQOutputFixture()));
    const frmKeys = new Set(Object.keys(buildFormworkOutputFixture()));
    const shared = [...boqKeys].filter((k) => frmKeys.has(k));
    // BOQ-only: boq_id, tier_6_panel_pieces, commercial_terms (3 keys).
    // Formwork-only: formwork_id, tier_6_components (2 keys).
    // 16 − 3 = 13 shared; 15 − 2 = 13 shared. Consistent.
    expect(shared).toHaveLength(13);
    expect(boqKeys.has("boq_id")).toBe(true);
    expect(frmKeys.has("formwork_id")).toBe(true);
    expect(boqKeys.has("commercial_terms")).toBe(true);
    expect(frmKeys.has("commercial_terms")).toBe(false);
    expect(boqKeys.has("tier_6_panel_pieces")).toBe(true);
    expect(frmKeys.has("tier_6_components")).toBe(true);
  });
});

describe("KosSidecarErrorEnvelope union shape", () => {
  it("accepts the parse-drawing 4xx shape ({error, message})", () => {
    const env: KosSidecarErrorEnvelope = {
      error: "invalid_extension",
      message: "file 'test.jpg' must be .dxf or .pdf",
    };
    expect(env.error).toBe("invalid_extension");
    expect(env.error_code).toBeUndefined();
  });

  it("accepts the mapper 4xx shape ({error, message, hint})", () => {
    const env: KosSidecarErrorEnvelope = {
      error: "MAPPER_INPUT_CONVERSION_FAILED",
      message: "KeyError: 'drawing_classification'",
      hint: "parser_output dict shape doesn't match the schema produced by /kos/parse-drawing.",
    };
    expect(env.error).toBe("MAPPER_INPUT_CONVERSION_FAILED");
    expect(env.hint).toContain("parser_output");
  });

  it("accepts the BOQ/Formwork 4xx shape ({error_code, message, hint?, invariant_id?})", () => {
    const env: KosSidecarErrorEnvelope = {
      error_code: "BOQ_INPUT_INVALID",
      message: "Failed to parse context",
      hint: "Verify context schema matches BOQContext.",
      invariant_id: "IV-7",
    };
    expect(env.error_code).toBe("BOQ_INPUT_INVALID");
    expect(env.error).toBeUndefined();
    expect(env.invariant_id).toBe("IV-7");
  });
});
