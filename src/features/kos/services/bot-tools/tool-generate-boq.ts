/**
 * Bot tool: generate_boq (5I PR 2b).
 *
 * Loads the mapper output cached on the KosCustomerDrawing row by an
 * earlier process_drawing call, calls the BOQ sidecar wrapper, and
 * persists the resulting multi-MB JSON to S3 under
 * `kosS3Key(tenant, "drawings", drawingId, "boq.json")`. Updates the
 * `boqResultS3Key` column. Returns S3 key + summary stats to the bot.
 *
 * Defence-in-depth C2: re-validates (tenant, customer) ownership.
 */

import type { KosCustomer, Tenant } from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import { KOS_AUDIT_5I_PR2B } from "@/features/kos/lib/kos-bot-constants";
import { generateBoq } from "@/features/kos/services/kos-boq-generator";
import {
  kosS3Key,
  uploadKosObject,
  fetchKosObjectAsBuffer,
} from "@/features/kos/services/s3-client";
import type { BOQOutput, MapperOutput } from "@/features/kos/types/sidecar";

type CachedParseResultEnvelope =
  | { kind: "parser"; data: unknown }
  | { kind: "mapper"; data: MapperOutput }
  | { kind: "mapper_s3"; s3Key: string };

function isCachedEnvelope(x: unknown): x is CachedParseResultEnvelope {
  if (!x || typeof x !== "object") return false;
  const k = (x as { kind?: unknown }).kind;
  return k === "parser" || k === "mapper" || k === "mapper_s3";
}

export interface GenerateBoqToolArgs {
  drawing_id: string;
  project_id?: string;
  project_name?: string;
  quote_date?: string; // YYYY-MM-DD
}

export type GenerateBoqToolResult =
  | {
      status: "generated";
      drawing_id: string;
      boq_id: string;
      s3_key: string;
      summary: {
        total_standard_panels: number | null;
        grand_total_inr_formatted: string | null;
        custom_quotes_pending_count: number | null;
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

export interface GenerateBoqHandlerCtx {
  tenant: Tenant;
  customer: KosCustomer;
  sidecarCallsRemaining: { count: number };
}

export async function generateBoqTool(
  args: GenerateBoqToolArgs,
  ctx: GenerateBoqHandlerCtx,
): Promise<GenerateBoqToolResult> {
  if (!args.drawing_id || typeof args.drawing_id !== "string") {
    throw new KosError(
      "KOS_TOOL_BOQ_010",
      "generate_boq requires a non-empty drawing_id string.",
      400,
    );
  }

  // C2 boundary
  const drawing = await prisma.kosCustomerDrawing.findFirst({
    where: {
      id: args.drawing_id,
      tenantId: ctx.tenant.id,
      customerId: ctx.customer.id,
    },
  });
  if (!drawing) {
    throw new KosError(
      "KOS_TOOL_BOQ_001",
      `Drawing ${args.drawing_id} not found for the current customer.`,
      404,
    );
  }

  // Require process_drawing to have run successfully first
  const rawCached: unknown = drawing.parseResult;
  if (drawing.status !== "PARSED" || !isCachedEnvelope(rawCached)) {
    return {
      status: "no_mapper_output",
      drawing_id: drawing.id,
      error_code: "KOS_TOOL_BOQ_002",
      error_message:
        "Mapper output not available for this drawing. Call process_drawing first to parse it and generate the panel layout.",
    };
  }
  if (rawCached.kind === "parser") {
    return {
      status: "no_mapper_output",
      drawing_id: drawing.id,
      error_code: "KOS_TOOL_BOQ_005",
      error_message:
        "Drawing was parsed but the classifier returned UNKNOWN and no application_hint was supplied yet. Ask the user to confirm the drawing type and call process_drawing again with the hint.",
    };
  }

  // Resolve mapper output — inline or S3
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
        error_code: "KOS_TOOL_BOQ_006",
        error_message: `Could not load cached mapper output from S3: ${(err as Error).message}`,
      };
    }
  }

  // Quota
  if (ctx.sidecarCallsRemaining.count <= 0) {
    throw new KosError(
      "KOS_BOT_QUOTA_EXCEEDED",
      "Per-turn sidecar call quota exceeded during generate_boq.",
      429,
    );
  }
  ctx.sidecarCallsRemaining.count -= 1;

  const todayIso = new Date().toISOString().slice(0, 10);

  let boqOutput: BOQOutput;
  try {
    boqOutput = await generateBoq({
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
      error_code: err instanceof KosError ? err.code : "KOS_TOOL_BOQ_003",
      error_message: (err as Error).message,
    };
  }

  // Persist to S3
  const s3Key = kosS3Key(ctx.tenant, "drawings", drawing.id, "boq.json");
  try {
    await uploadKosObject(
      ctx.tenant,
      s3Key,
      Buffer.from(JSON.stringify(boqOutput), "utf-8"),
      "application/json",
    );
  } catch (err) {
    kosLog.error("kos_tool_boq_s3_persist_failed", {
      drawingId: drawing.id,
      err: String(err),
    });
    throw new KosError(
      "KOS_TOOL_BOQ_004",
      `Failed to persist BOQ JSON to S3 at ${s3Key}: ${(err as Error).message}`,
      500,
    );
  }

  await prisma.kosCustomerDrawing.update({
    where: { id: drawing.id },
    data: { boqResultS3Key: s3Key },
  });

  kosLog.info("kos_tool_boq_ok", {
    drawingId: drawing.id,
    tenantId: ctx.tenant.id,
    customerId: ctx.customer.id,
    boqId: boqOutput.boq_id,
    s3Key,
    auditAction: KOS_AUDIT_5I_PR2B.TOOL_GENERATE_BOQ_OK,
  });

  const tier1 = (boqOutput.tier_1_summary ?? {}) as Record<string, unknown>;
  return {
    status: "generated",
    drawing_id: drawing.id,
    boq_id: boqOutput.boq_id,
    s3_key: s3Key,
    summary: {
      total_standard_panels: pickNumber(tier1.total_standard_panels),
      grand_total_inr_formatted: pickString(tier1.grand_total_inr_formatted),
      custom_quotes_pending_count: pickNumber(tier1.custom_quotes_pending_count),
    },
    warnings_count: Array.isArray(boqOutput.warnings) ? boqOutput.warnings.length : 0,
    pending_karthik_count: Array.isArray(boqOutput.pending_karthik)
      ? boqOutput.pending_karthik.length
      : 0,
  };
}

function pickNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function pickString(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}
