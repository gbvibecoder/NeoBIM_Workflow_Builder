/**
 * KOS formwork generator client (5I PR 2a).
 *
 * Wraps the Python sidecar's `POST /formwork/generate`. Mirrors the
 * BOQ wrapper exactly — same `{mapper_output, context}` shape, same
 * defensive context validation, same JSON-only response. PDF rendering
 * (PR 4) happens server-side in the TS layer via `jspdf` — NOT here.
 *
 * NOTE: the formwork response shape has **15** top-level keys (not 16
 * like BOQ). `commercial_terms` is intentionally absent per Karthik
 * 2026-05-26 — "no pricing in 5F output". Do not infer prices from
 * formwork data.
 *
 * Latency expectation: ~6 s on the test fixture. Timeout: 3 minutes.
 */

import { KosError } from "@/features/kos/lib/kos-errors";
import { callJsonSidecar } from "@/features/kos/services/_sidecar-client";
import type {
  FormworkContext,
  FormworkInput,
  FormworkOutput,
  MapperOutput,
} from "@/features/kos/types/sidecar";

const FORMWORK_TIMEOUT_MS = 180_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GenerateFormworkArgs {
  /** For logging only — sidecar is tenant-blind. */
  tenantId: string;
  mapperOutput: MapperOutput;
  context: FormworkContext;
}

export async function generateFormwork(
  args: GenerateFormworkArgs,
): Promise<FormworkOutput> {
  assertFormworkContext(args.context);

  const body: FormworkInput = {
    mapper_output: args.mapperOutput,
    context: args.context,
  };
  return callJsonSidecar<FormworkOutput, FormworkInput>({
    endpoint: "/formwork/generate",
    method: "POST",
    body,
    timeoutMs: FORMWORK_TIMEOUT_MS,
    errorCodePrefix: "KOS_FRM_GEN",
    tenantId: args.tenantId,
  });
}

function assertFormworkContext(context: FormworkContext): void {
  if (!context.project_id || typeof context.project_id !== "string") {
    throw new KosError(
      "KOS_FRM_GEN_001",
      "Formwork context.project_id is required (non-empty string). Sidecar FormworkContext dataclass rejects missing project_id with a 422.",
      400,
    );
  }
  if (!context.project_name || typeof context.project_name !== "string") {
    throw new KosError(
      "KOS_FRM_GEN_002",
      "Formwork context.project_name is required (non-empty string).",
      400,
    );
  }
  if (!context.quote_date || typeof context.quote_date !== "string") {
    throw new KosError(
      "KOS_FRM_GEN_003",
      "Formwork context.quote_date is required (ISO YYYY-MM-DD string).",
      400,
    );
  }
  if (!ISO_DATE_RE.test(context.quote_date)) {
    throw new KosError(
      "KOS_FRM_GEN_004",
      `Formwork context.quote_date must match ISO YYYY-MM-DD (got "${context.quote_date}").`,
      400,
    );
  }
}
