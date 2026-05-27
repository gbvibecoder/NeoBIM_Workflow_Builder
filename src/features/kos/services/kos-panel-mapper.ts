/**
 * KOS panel mapper client (5I PR 2a).
 *
 * Wraps the Python sidecar's `POST /kos/generate-panel-layout`.
 * Sits between the drawing parser and the BOQ/Formwork generators in
 * the pipeline:
 *
 *   parse-drawing  →  generate-panel-layout  →  boq + formwork (parallel)
 *
 * The mapper requires `parser_output.drawing_classification` +
 * `drawing_classification_confidence` but the parser emits the old
 * names — see `parser-to-mapper-adapter.ts` for the shim. This wrapper
 * runs the adapter automatically; callers pass the raw
 * `DrawingParseResult` straight through.
 *
 * Latency expectation (per `temp_folder/sidecar-capture/REPORT.md`):
 * ~5 s on the test fixture; production drawings may take longer.
 * Timeout set to 2 minutes.
 */

import { callJsonSidecar } from "@/features/kos/services/_sidecar-client";
import { adaptParserOutputForMapper } from "@/features/kos/services/parser-to-mapper-adapter";
import type { DrawingParseResult } from "@/features/kos/types/drawing";
import type {
  MapperInput,
  MapperOutput,
  MapperProjectContext,
} from "@/features/kos/types/sidecar";

const MAPPER_TIMEOUT_MS = 120_000;

export interface GeneratePanelLayoutArgs {
  /** For logging only — sidecar is tenant-blind. */
  tenantId: string;
  /** Raw parser output from `/kos/parse-drawing`. Adapter runs internally. */
  parsed: DrawingParseResult;
  /** Project context — see ProjectContextAPI in the sidecar's OpenAPI. */
  context: MapperProjectContext;
}

export async function generatePanelLayout(
  args: GeneratePanelLayoutArgs,
): Promise<MapperOutput> {
  const adapted = adaptParserOutputForMapper(args.parsed);
  const body: MapperInput = {
    parser_output: adapted,
    project_context: args.context,
  };
  return callJsonSidecar<MapperOutput, MapperInput>({
    endpoint: "/kos/generate-panel-layout",
    method: "POST",
    body,
    timeoutMs: MAPPER_TIMEOUT_MS,
    errorCodePrefix: "KOS_MAPPER",
    tenantId: args.tenantId,
  });
}
