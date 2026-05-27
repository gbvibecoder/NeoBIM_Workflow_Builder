/**
 * Bot tool: generate_formwork (5I PR 2b).
 *
 * Mirror of generate_boq: loads cached mapper output, calls the
 * formwork sidecar wrapper, persists JSON to S3 under
 * `formwork.json`, updates `formworkResultS3Key` on the row.
 *
 * Formwork response has 15 top-level keys (NO `commercial_terms` —
 * Karthik 2026-05-26 "no pricing in 5F output"). The summary surfaced
 * to the bot reflects that — no INR fields, only quantity stats.
 */

import type { KosCustomer, Tenant } from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import { KOS_AUDIT_5I_PR2B } from "@/features/kos/lib/kos-bot-constants";
import { generateFormwork } from "@/features/kos/services/kos-formwork-generator";
import {
  kosS3Key,
  uploadKosObject,
  fetchKosObjectAsBuffer,
} from "@/features/kos/services/s3-client";
import type { FormworkOutput, MapperOutput } from "@/features/kos/types/sidecar";

type CachedParseResultEnvelope =
  | { kind: "parser"; data: unknown }
  | { kind: "mapper"; data: MapperOutput }
  | { kind: "mapper_s3"; s3Key: string };

function isCachedEnvelope(x: unknown): x is CachedParseResultEnvelope {
  if (!x || typeof x !== "object") return false;
  const k = (x as { kind?: unknown }).kind;
  return k === "parser" || k === "mapper" || k === "mapper_s3";
}

export interface GenerateFormworkToolArgs {
  drawing_id: string;
  project_id?: string;
  project_name?: string;
  quote_date?: string; // YYYY-MM-DD
}

export type GenerateFormworkToolResult =
  | {
      status: "generated";
      drawing_id: string;
      formwork_id: string;
      s3_key: string;
      summary: {
        total_props: number | null;
        total_walers: number | null;
        total_kickers: number | null;
        total_starter_track_meters: number | null;
      };
      warnings_count: number;
      pending_karthik_count: number;
    }
  | {
      status: "no_mapper_output";
      drawing_id: string;
      error_code: string;
      error_message: string;
    }
  | {
      status: "failed";
      drawing_id: string;
      error_code: string;
      error_message: string;
    };

export interface GenerateFormworkHandlerCtx {
  tenant: Tenant;
  customer: KosCustomer;
  sidecarCallsRemaining: { count: number };
}

export async function generateFormworkTool(
  args: GenerateFormworkToolArgs,
  ctx: GenerateFormworkHandlerCtx,
): Promise<GenerateFormworkToolResult> {
  if (!args.drawing_id || typeof args.drawing_id !== "string") {
    throw new KosError(
      "KOS_TOOL_FRM_010",
      "generate_formwork requires a non-empty drawing_id string.",
      400,
    );
  }

  const drawing = await prisma.kosCustomerDrawing.findFirst({
    where: {
      id: args.drawing_id,
      tenantId: ctx.tenant.id,
      customerId: ctx.customer.id,
    },
  });
  if (!drawing) {
    throw new KosError(
      "KOS_TOOL_FRM_001",
      `Drawing ${args.drawing_id} not found for the current customer.`,
      404,
    );
  }

  const rawCached: unknown = drawing.parseResult;
  if (drawing.status !== "PARSED" || !isCachedEnvelope(rawCached)) {
    return {
      status: "no_mapper_output",
      drawing_id: drawing.id,
      error_code: "KOS_TOOL_FRM_002",
      error_message:
        "Mapper output not available for this drawing. Call process_drawing first.",
    };
  }
  if (rawCached.kind === "parser") {
    return {
      status: "no_mapper_output",
      drawing_id: drawing.id,
      error_code: "KOS_TOOL_FRM_005",
      error_message:
        "Drawing was parsed but the classifier returned UNKNOWN and no application_hint was supplied yet. Ask the user to confirm the drawing type and call process_drawing again with the hint.",
    };
  }

  let mapperOutput: MapperOutput;
  if (rawCached.kind === "mapper") {
    mapperOutput = rawCached.data;
  } else {
    try {
      const { buffer } = await fetchKosObjectAsBuffer(ctx.tenant, rawCached.s3Key);
      mapperOutput = JSON.parse(buffer.toString("utf-8")) as MapperOutput;
    } catch (err) {
      return {
        status: "failed",
        drawing_id: drawing.id,
        error_code: "KOS_TOOL_FRM_006",
        error_message: `Could not load cached mapper output from S3: ${(err as Error).message}`,
      };
    }
  }

  if (ctx.sidecarCallsRemaining.count <= 0) {
    throw new KosError(
      "KOS_BOT_QUOTA_EXCEEDED",
      "Per-turn sidecar call quota exceeded during generate_formwork.",
      429,
    );
  }
  ctx.sidecarCallsRemaining.count -= 1;

  const todayIso = new Date().toISOString().slice(0, 10);

  let formworkOutput: FormworkOutput;
  try {
    formworkOutput = await generateFormwork({
      tenantId: ctx.tenant.id,
      mapperOutput,
      context: {
        project_id: args.project_id ?? drawing.id,
        project_name:
          args.project_name ??
          mapperOutput.project_name ??
          `Drawing ${drawing.id}`,
        quote_date: args.quote_date ?? todayIso,
      },
    });
  } catch (err) {
    return {
      status: "failed",
      drawing_id: drawing.id,
      error_code: err instanceof KosError ? err.code : "KOS_TOOL_FRM_003",
      error_message: (err as Error).message,
    };
  }

  const s3Key = kosS3Key(ctx.tenant, "drawings", drawing.id, "formwork.json");
  try {
    await uploadKosObject(
      ctx.tenant,
      s3Key,
      Buffer.from(JSON.stringify(formworkOutput), "utf-8"),
      "application/json",
    );
  } catch (err) {
    kosLog.error("kos_tool_formwork_s3_persist_failed", {
      drawingId: drawing.id,
      err: String(err),
    });
    throw new KosError(
      "KOS_TOOL_FRM_004",
      `Failed to persist Formwork JSON to S3 at ${s3Key}: ${(err as Error).message}`,
      500,
    );
  }

  await prisma.kosCustomerDrawing.update({
    where: { id: drawing.id },
    data: { formworkResultS3Key: s3Key },
  });

  kosLog.info("kos_tool_formwork_ok", {
    drawingId: drawing.id,
    tenantId: ctx.tenant.id,
    customerId: ctx.customer.id,
    formworkId: formworkOutput.formwork_id,
    s3Key,
    auditAction: KOS_AUDIT_5I_PR2B.TOOL_GENERATE_FORMWORK_OK,
  });

  const tier1 = (formworkOutput.tier_1_summary ?? {}) as Record<string, unknown>;
  return {
    status: "generated",
    drawing_id: drawing.id,
    formwork_id: formworkOutput.formwork_id,
    s3_key: s3Key,
    summary: {
      total_props: pickNumber(tier1.total_props),
      total_walers: pickNumber(tier1.total_walers),
      total_kickers: pickNumber(tier1.total_kickers),
      total_starter_track_meters: pickNumber(tier1.total_starter_track_meters),
    },
    warnings_count: Array.isArray(formworkOutput.warnings)
      ? formworkOutput.warnings.length
      : 0,
    pending_karthik_count: Array.isArray(formworkOutput.pending_karthik)
      ? formworkOutput.pending_karthik.length
      : 0,
  };
}

function pickNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
