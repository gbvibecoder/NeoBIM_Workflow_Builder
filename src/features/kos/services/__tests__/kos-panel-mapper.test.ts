/**
 * Unit tests for kos-panel-mapper.ts wrapper.
 *
 * We mock `callJsonSidecar` and assert:
 *  - happy path: returns the sidecar's MapperOutput verbatim
 *  - adapter is applied: parser_output.drawing_classification is set
 *  - sidecar errors propagate
 *  - request body shape (parser_output + project_context)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonSidecarMock } = vi.hoisted(() => ({
  callJsonSidecarMock: vi.fn(),
}));

vi.mock("@/features/kos/services/_sidecar-client", () => ({
  callJsonSidecar: callJsonSidecarMock,
}));

import { generatePanelLayout } from "../kos-panel-mapper";
import { KosError } from "@/features/kos/lib/kos-errors";
import type { DrawingParseResult } from "@/features/kos/types/drawing";
import type { MapperOutput } from "@/features/kos/types/sidecar";

function buildParsedFixture(
  overrides: Partial<DrawingParseResult> = {},
): DrawingParseResult {
  return {
    filename: "x.dxf",
    format: "dxf",
    size_bytes: 1000,
    parser_version: "0.1.0",
    phase: "5C-1",
    drawing_type: "FLOOR_PLAN",
    drawing_type_confidence: 0.95,
    drawing_classification_signals: [],
    drawing_classification_reasoning: "",
    title_block: {
      project_name: null,
      drawing_number: null,
      drawing_title: null,
      revision: null,
      scale: null,
      date: null,
      sheet: null,
      level: null,
      client: null,
      drawn_by: null,
      checked_by: null,
      raw_text_block: "",
      source: "title_block",
      extraction_warnings: [],
    },
    walls: [],
    junctions: [],
    openings: [],
    layers_found: [],
    drawing_bounds: { min_x: 0, min_y: 0, max_x: 0, max_y: 0 },
    units_detected: "mm",
    stats: {
      total_entities: 0,
      walls_count: 0,
      junctions_count: 0,
      title_block_fields_extracted: 0,
      lines: 0,
      polylines: 0,
      text: 0,
      dimensions: 0,
      circles: 0,
      blocks: 0,
    },
    warnings: [],
    detection_strategy_used: "tier_1",
    overall_confidence: 0,
    field_confidences: { walls: 0, title_block: 0 },
    missing_data: [],
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 0,
    debug_png_base64: null,
    ...overrides,
  } as DrawingParseResult;
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

describe("generatePanelLayout", () => {
  beforeEach(() => {
    callJsonSidecarMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: returns the MapperOutput from the sidecar verbatim", async () => {
    const expected = buildMapperOutputFixture();
    callJsonSidecarMock.mockResolvedValueOnce(expected);

    const result = await generatePanelLayout({
      tenantId: "tenant_1",
      parsed: buildParsedFixture(),
      context: { project_name: "test" },
    });

    expect(result).toEqual(expected);
  });

  it("applies the parser→mapper adapter: request body has drawing_classification + drawing_classification_confidence", async () => {
    callJsonSidecarMock.mockResolvedValueOnce(buildMapperOutputFixture());

    await generatePanelLayout({
      tenantId: "tenant_1",
      parsed: buildParsedFixture({
        drawing_type: "FLOOR_PLAN",
        drawing_type_confidence: 0.9,
      }),
      context: { project_name: "test" },
    });

    expect(callJsonSidecarMock).toHaveBeenCalledTimes(1);
    const callArgs = callJsonSidecarMock.mock.calls[0][0];
    expect(callArgs.endpoint).toBe("/kos/generate-panel-layout");
    expect(callArgs.errorCodePrefix).toBe("KOS_MAPPER");
    expect(callArgs.tenantId).toBe("tenant_1");
    expect(callArgs.body.parser_output.drawing_classification).toBe("FLOOR_PLAN");
    expect(callArgs.body.parser_output.drawing_classification_confidence).toBe(
      0.9,
    );
    // Original keys retained for backward compat
    expect(callArgs.body.parser_output.drawing_type).toBe("FLOOR_PLAN");
    expect(callArgs.body.parser_output.drawing_type_confidence).toBe(0.9);
  });

  it("passes project_context through verbatim", async () => {
    callJsonSidecarMock.mockResolvedValueOnce(buildMapperOutputFixture());

    await generatePanelLayout({
      tenantId: "tenant_1",
      parsed: buildParsedFixture(),
      context: {
        project_name: "90 Victoria",
        seismic_zone: "IV",
        application_hint: "basement_lt3m",
        split_strategy: "minimize_panels",
        wall_height_mm: 2700,
      },
    });

    const callArgs = callJsonSidecarMock.mock.calls[0][0];
    expect(callArgs.body.project_context).toEqual({
      project_name: "90 Victoria",
      seismic_zone: "IV",
      application_hint: "basement_lt3m",
      split_strategy: "minimize_panels",
      wall_height_mm: 2700,
    });
  });

  it("uses the 120s timeout (mapper is heavy)", async () => {
    callJsonSidecarMock.mockResolvedValueOnce(buildMapperOutputFixture());

    await generatePanelLayout({
      tenantId: "tenant_1",
      parsed: buildParsedFixture(),
      context: { project_name: "test" },
    });

    expect(callJsonSidecarMock.mock.calls[0][0].timeoutMs).toBe(120_000);
  });

  it("propagates sidecar 4xx errors as-is", async () => {
    callJsonSidecarMock.mockRejectedValueOnce(
      new KosError(
        "KOS_MAPPER_SIDECAR_4XX",
        "MAPPER_INPUT_INVALID: IV-1 (expected 'FLOOR_PLAN')",
        400,
      ),
    );

    let caught: unknown;
    try {
      await generatePanelLayout({
        tenantId: "tenant_1",
        parsed: buildParsedFixture({ drawing_type: "UNKNOWN" }),
        context: { project_name: "test" },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KosError);
    const err = caught as KosError;
    expect(err.code).toBe("KOS_MAPPER_SIDECAR_4XX");
    expect(err.message).toContain("MAPPER_INPUT_INVALID");
  });
});
