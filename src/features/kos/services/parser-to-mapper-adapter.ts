/**
 * Parser → Mapper schema-drift adapter (5I PR 2a).
 *
 * The Python sidecar's parser (`/kos/parse-drawing`) emits:
 *
 *   { drawing_type: "FLOOR_PLAN", drawing_type_confidence: 0.9, ... }
 *
 * The Python sidecar's mapper (`/kos/generate-panel-layout`) requires:
 *
 *   { drawing_classification: "FLOOR_PLAN", drawing_classification_confidence: 0.9, ... }
 *
 * Mismatch was confirmed in `temp_folder/sidecar-capture/REPORT.md`
 * Finding #1 and re-confirmed against the PDF parser v0.2.0 path in
 * `temp_folder/pdf-probe/REPORT.md` §extra. The mapper hint claims
 * "Pass the response verbatim" — that hint is wrong; the response is
 * rejected with `KeyError: 'drawing_classification'`.
 *
 * This adapter renames the two keys while preserving everything else.
 * Original keys are KEPT (not deleted) so any downstream Python code
 * that references `drawing_type` continues to work.
 *
 * TODO(karthik-item-8): When the sidecar reconciles the schema (either
 * the parser is updated to emit `drawing_classification`, or the mapper
 * is updated to accept `drawing_type`), this adapter becomes a no-op.
 * At that point, delete this file and inline `parsed` straight into
 * `MapperInput.parser_output` from `kos-panel-mapper.ts`.
 */

import type { DrawingParseResult } from "@/features/kos/types/drawing";
import type { MapperParserOutputInput } from "@/features/kos/types/sidecar";

export function adaptParserOutputForMapper(
  parsed: DrawingParseResult,
): MapperParserOutputInput {
  return {
    ...parsed,
    drawing_classification: parsed.drawing_type,
    drawing_classification_confidence: parsed.drawing_type_confidence,
  };
}
