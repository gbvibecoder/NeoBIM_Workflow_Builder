/**
 * Unit tests for the parser→mapper schema-drift adapter.
 *
 * The adapter exists because the Python sidecar parser emits one set
 * of classification key names and the Python sidecar mapper requires
 * a different set. Captured at temp_folder/sidecar-capture and
 * temp_folder/pdf-probe — see adapter docstring.
 */

import { describe, expect, it } from "vitest";

import { adaptParserOutputForMapper } from "../parser-to-mapper-adapter";
import type { DrawingParseResult } from "@/features/kos/types/drawing";

function buildParseFixture(): DrawingParseResult {
  return {
    filename: "test.pdf",
    format: "pdf",
    size_bytes: 600000,
    parser_version: "0.2.0",
    phase: "5C-2",
    drawing_type: "FLOOR_PLAN",
    drawing_type_confidence: 0.9,
    drawing_classification_signals: [
      "title_block:drawing_title='Concrete Setout Plan-Basement-Part'",
    ],
    drawing_classification_reasoning:
      "Title-block drawing title names a plan/setout/layout/floor drawing — authoritative signal.",
    title_block: {
      project_name: "90 Victoria Road",
      drawing_number: "90VR-MR-AD-2501",
      drawing_title: "Concrete Setout Plan-Basement-Part",
      revision: "J",
      scale: "1:50",
      date: null,
      sheet: null,
      level: "BASEMENT",
      client: null,
      drawn_by: "LH",
      checked_by: "JK",
      raw_text_block: "UP 1 A B ...",
      source: "mixed",
      extraction_warnings: [],
    },
    walls: [],
    junctions: [],
    openings: [],
    layers_found: ["PDF:black@1.2"],
    drawing_bounds: { min_x: 0, min_y: 0, max_x: 100, max_y: 100 },
    units_detected: "pdf 1:50 (pt→mm ×17.6389)",
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
    overall_confidence: 0.75,
    field_confidences: { walls: 0.85, title_block: 1.0 },
    missing_data: ["wall_heights — need elevation drawing"],
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 1617,
    debug_png_base64: null,
  };
}

describe("adaptParserOutputForMapper", () => {
  it("adds drawing_classification with the value from drawing_type", () => {
    const fixture = buildParseFixture();
    const result = adaptParserOutputForMapper(fixture);
    expect(result.drawing_classification).toBe("FLOOR_PLAN");
  });

  it("adds drawing_classification_confidence with the value from drawing_type_confidence", () => {
    const fixture = buildParseFixture();
    const result = adaptParserOutputForMapper(fixture);
    expect(result.drawing_classification_confidence).toBe(0.9);
  });

  it("preserves drawing_type + drawing_type_confidence so downstream consumers still see them", () => {
    const fixture = buildParseFixture();
    const result = adaptParserOutputForMapper(fixture);
    expect(result.drawing_type).toBe("FLOOR_PLAN");
    expect(result.drawing_type_confidence).toBe(0.9);
  });

  it("preserves every other field verbatim", () => {
    const fixture = buildParseFixture();
    const result = adaptParserOutputForMapper(fixture);
    expect(result.filename).toBe(fixture.filename);
    expect(result.format).toBe(fixture.format);
    expect(result.size_bytes).toBe(fixture.size_bytes);
    expect(result.parser_version).toBe(fixture.parser_version);
    expect(result.title_block).toEqual(fixture.title_block);
    expect(result.walls).toEqual(fixture.walls);
    expect(result.junctions).toEqual(fixture.junctions);
    expect(result.openings).toEqual(fixture.openings);
    expect(result.layers_found).toEqual(fixture.layers_found);
    expect(result.drawing_bounds).toEqual(fixture.drawing_bounds);
    expect(result.units_detected).toBe(fixture.units_detected);
    expect(result.overall_confidence).toBe(fixture.overall_confidence);
    expect(result.field_confidences).toEqual(fixture.field_confidences);
    expect(result.missing_data).toEqual(fixture.missing_data);
    expect(result.downstream_ready).toEqual(fixture.downstream_ready);
    expect(result.duration_ms).toBe(fixture.duration_ms);
  });

  it("adapter output carries the keys that the mapper requires (regression-against-sidecar contract)", () => {
    // This catches the case where the mapper sidecar later renames the
    // expected key — e.g. if Karthik switches to `drawing_kind` instead.
    // If that happens, the type system will FAIL TO COMPILE first, then
    // this test gives the runtime backstop.
    const fixture = buildParseFixture();
    const result = adaptParserOutputForMapper(fixture);
    const keys = Object.keys(result);
    expect(keys).toContain("drawing_classification");
    expect(keys).toContain("drawing_classification_confidence");
  });

  it("does not mutate the input parse result", () => {
    const fixture = buildParseFixture();
    const snapshot = JSON.parse(JSON.stringify(fixture));
    adaptParserOutputForMapper(fixture);
    expect(fixture).toEqual(snapshot);
  });

  it("propagates UNKNOWN classification verbatim (DXF case from sidecar-capture probe)", () => {
    const fixture = buildParseFixture();
    fixture.drawing_type = "UNKNOWN";
    fixture.drawing_type_confidence = 0.0;
    const result = adaptParserOutputForMapper(fixture);
    expect(result.drawing_classification).toBe("UNKNOWN");
    expect(result.drawing_classification_confidence).toBe(0.0);
  });
});
