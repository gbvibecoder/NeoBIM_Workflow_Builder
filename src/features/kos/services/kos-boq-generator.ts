/**
 * KOS BOQ generator client (5I PR 2a).
 *
 * Wraps the Python sidecar's `POST /boq/generate`. The sidecar returns
 * the structured 6-tier BOQ as JSON; Excel rendering (PR 4) happens
 * server-side in the TS layer via the `xlsx` library — NOT here.
 *
 * `BOQContext` required fields (project_id, project_name, quote_date)
 * are NOT documented in the sidecar's OpenAPI schema — they were
 * discovered by triggering 422 responses (see
 * `temp_folder/sidecar-capture/REPORT.md` §5 "Iterations needed to get
 * 200"). The wrapper enforces them defensively to fail fast at the TS
 * edge instead of round-tripping a bad request to the sidecar.
 *
 * Latency expectation: ~9 s on the test fixture. Timeout: 3 minutes.
 */

import { KosError } from "@/features/kos/lib/kos-errors";
import { callJsonSidecar } from "@/features/kos/services/_sidecar-client";
import type {
  BOQContext,
  BOQInput,
  BOQOutput,
  MapperOutput,
} from "@/features/kos/types/sidecar";

const BOQ_TIMEOUT_MS = 180_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GenerateBoqArgs {
  /** For logging only — sidecar is tenant-blind. */
  tenantId: string;
  mapperOutput: MapperOutput;
  context: BOQContext;
}

export async function generateBoq(args: GenerateBoqArgs): Promise<BOQOutput> {
  assertBoqContext(args.context);

  const body: BOQInput = {
    mapper_output: args.mapperOutput,
    context: args.context,
  };
  return callJsonSidecar<BOQOutput, BOQInput>({
    endpoint: "/boq/generate",
    method: "POST",
    body,
    timeoutMs: BOQ_TIMEOUT_MS,
    errorCodePrefix: "KOS_BOQ_GEN",
    tenantId: args.tenantId,
  });
}

function assertBoqContext(context: BOQContext): void {
  if (!context.project_id || typeof context.project_id !== "string") {
    throw new KosError(
      "KOS_BOQ_GEN_001",
      "BOQ context.project_id is required (non-empty string). Sidecar BOQContext dataclass rejects missing project_id with a 422.",
      400,
    );
  }
  if (!context.project_name || typeof context.project_name !== "string") {
    throw new KosError(
      "KOS_BOQ_GEN_002",
      "BOQ context.project_name is required (non-empty string).",
      400,
    );
  }
  if (!context.quote_date || typeof context.quote_date !== "string") {
    throw new KosError(
      "KOS_BOQ_GEN_003",
      "BOQ context.quote_date is required (ISO YYYY-MM-DD string).",
      400,
    );
  }
  if (!ISO_DATE_RE.test(context.quote_date)) {
    throw new KosError(
      "KOS_BOQ_GEN_004",
      `BOQ context.quote_date must match ISO YYYY-MM-DD (got "${context.quote_date}").`,
      400,
    );
  }
}
