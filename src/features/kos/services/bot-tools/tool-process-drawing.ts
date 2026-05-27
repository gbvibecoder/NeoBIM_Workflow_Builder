/**
 * Bot tool: process_drawing (5I PR 2b).
 *
 * Chains parseDrawingFromS3 → adapter → generatePanelLayout for a
 * customer-uploaded drawing identified by id. Persists results to the
 * KosCustomerDrawing row so subsequent tool calls (generate_boq /
 * generate_formwork) don't re-parse.
 *
 * Three terminal outcomes:
 *   - "ready"                — parse + mapper both succeeded, BOQ/formwork can run
 *   - "needs_classification" — parse succeeded but classifier=UNKNOWN; bot asks user
 *   - "scanned_pdf"          — parser detected a scanned-image PDF
 *   - "failed"               — anything else (transport, mapper schema, etc.)
 *
 * Two cache patterns on KosCustomerDrawing.parseResult:
 *   { kind: "parser", data: DrawingParseResult }       — UNKNOWN round; parser only
 *   { kind: "mapper", data: MapperOutput }             — mapper ran and was small
 *   { kind: "mapper_s3", s3Key: string }               — mapper ran, overflowed
 *
 * Parser output is ALWAYS persisted to S3 at
 * `kosS3Key(tenant, "drawings", drawingId, "parser-result.json")` (and
 * the key is captured in `fullParseResultS3Key`) so re-classification
 * rounds can reuse it without re-hitting the sidecar.
 *
 * Sidecar quota: each sidecar call decrements ctx.sidecarCallsRemaining.
 * count. The shared counter prevents runaway costs from a misbehaving
 * model spinning the tool in a loop.
 *
 * Defence-in-depth C2: this tool re-validates (tenant, customer)
 * ownership of the drawing even though the chat route already did.
 */

import type { KosCustomer, KosCustomerDrawing, Tenant } from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import {
  APPLICATION_HINT_SUGGESTIONS,
  KOS_AUDIT_5I_PR2B,
  KOS_DRAWING_PARSE_RESULT_INLINE_CAP_BYTES,
} from "@/features/kos/lib/kos-bot-constants";
import { parseDrawingFromS3 } from "@/features/kos/services/kos-drawing-parser";
import { generatePanelLayout } from "@/features/kos/services/kos-panel-mapper";
import {
  kosS3Key,
  uploadKosObject,
  fetchKosObjectAsBuffer,
} from "@/features/kos/services/s3-client";
import type {
  ApplicationHint,
  MapperOutput,
  MapperProjectContext,
} from "@/features/kos/types/sidecar";
import type {
  DrawingParseResult,
  DrawingSourceFormat,
} from "@/features/kos/types/drawing";

// ── Cached-result envelope ───────────────────────────────────────────────

type CachedParseResultEnvelope =
  | { kind: "parser"; data: DrawingParseResult }
  | { kind: "mapper"; data: MapperOutput }
  | { kind: "mapper_s3"; s3Key: string };

function isCachedEnvelope(x: unknown): x is CachedParseResultEnvelope {
  if (!x || typeof x !== "object") return false;
  const k = (x as { kind?: unknown }).kind;
  return k === "parser" || k === "mapper" || k === "mapper_s3";
}

// ── Public types ─────────────────────────────────────────────────────────

export interface ProcessDrawingArgs {
  drawing_id: string;
  application_hint?: ApplicationHint;
  project_context?: Partial<MapperProjectContext>;
}

export type ProcessDrawingResult =
  | {
      status: "ready";
      drawing_id: string;
      drawing_summary: {
        title_block_drawing_title: string | null;
        title_block_project_name: string | null;
        walls_count: number;
        junctions_count: number;
        openings_count: number;
        parser_version: string;
        drawing_type: string;
        drawing_type_confidence: number;
      };
      mapper_summary: {
        total_weight_kg: number | null;
        waste_ratio: number | null;
        downstream_ready_boq: boolean;
        downstream_ready_formwork: boolean;
        wall_segments_count: number;
      };
    }
  | {
      status: "needs_classification";
      drawing_id: string;
      title_block: { drawing_title: string | null; level: string | null };
      suggested_hints: typeof APPLICATION_HINT_SUGGESTIONS;
      message: string;
    }
  | {
      status: "scanned_pdf";
      drawing_id: string;
      message: string;
    }
  | {
      status: "failed";
      drawing_id: string;
      error_code: string;
      error_message: string;
    };

export interface ProcessDrawingHandlerCtx {
  tenant: Tenant;
  customer: KosCustomer;
  /** Mutable per-turn counter shared across all bot-tool handlers. */
  sidecarCallsRemaining: { count: number };
}

// ── Tool entry ───────────────────────────────────────────────────────────

export async function processDrawingTool(
  args: ProcessDrawingArgs,
  ctx: ProcessDrawingHandlerCtx,
): Promise<ProcessDrawingResult> {
  if (!args.drawing_id || typeof args.drawing_id !== "string") {
    throw new KosError(
      "KOS_TOOL_PROCESS_DRAWING_010",
      "process_drawing requires a non-empty drawing_id string.",
      400,
    );
  }

  // 1. C2 boundary — drawing must belong to this customer
  const drawing = await prisma.kosCustomerDrawing.findFirst({
    where: {
      id: args.drawing_id,
      tenantId: ctx.tenant.id,
      customerId: ctx.customer.id,
    },
  });
  if (!drawing) {
    throw new KosError(
      "KOS_TOOL_PROCESS_DRAWING_001",
      `Drawing ${args.drawing_id} not found for the current customer.`,
      404,
    );
  }

  // 2. Cache reuse — if mapper output is already cached AND no new
  //    application_hint, return ready immediately (no sidecar hits).
  // Cast via unknown: Prisma's JsonValue narrowing collides with our
  // envelope type (which references DrawingParseResult / MapperOutput
  // — both have optional fields that aren't JsonValue-pure).
  const rawCached: unknown = drawing.parseResult;
  const cachedEnvelope: CachedParseResultEnvelope | null = isCachedEnvelope(
    rawCached,
  )
    ? rawCached
    : null;
  if (
    drawing.status === "PARSED" &&
    cachedEnvelope &&
    (cachedEnvelope.kind === "mapper" || cachedEnvelope.kind === "mapper_s3") &&
    !args.application_hint
  ) {
    const mapper =
      cachedEnvelope.kind === "mapper"
        ? cachedEnvelope.data
        : await loadMapperFromS3(ctx.tenant, cachedEnvelope.s3Key);
    return buildReady(drawing.id, /* parsed */ null, mapper, drawing);
  }

  // 3. Mark PARSING + clear any prior error
  await prisma.kosCustomerDrawing.update({
    where: { id: drawing.id },
    data: { status: "PARSING", errorCode: null, errorText: null },
  });

  kosLog.info("kos_tool_process_drawing_start", {
    drawingId: drawing.id,
    tenantId: ctx.tenant.id,
    customerId: ctx.customer.id,
    applicationHint: args.application_hint ?? null,
  });

  // 4. Acquire parser output — either reuse cached (re-classification
  //    round) or call the sidecar fresh.
  let parsed: DrawingParseResult;
  if (
    cachedEnvelope &&
    cachedEnvelope.kind === "parser" &&
    args.application_hint
  ) {
    parsed = cachedEnvelope.data;
    kosLog.info("kos_tool_process_drawing_reuse_parse", {
      drawingId: drawing.id,
      tenantId: ctx.tenant.id,
    });
  } else if (
    !cachedEnvelope &&
    args.application_hint &&
    drawing.fullParseResultS3Key
  ) {
    // Re-classification round but parser fell out of inline; fetch from S3.
    try {
      const { buffer } = await fetchKosObjectAsBuffer(
        ctx.tenant,
        drawing.fullParseResultS3Key,
      );
      parsed = JSON.parse(buffer.toString("utf-8")) as DrawingParseResult;
    } catch (err) {
      return failWith(
        drawing.id,
        "KOS_TOOL_PROCESS_DRAWING_004",
        `Could not re-load cached parser output from S3 for re-classification: ${(err as Error).message}`,
      );
    }
  } else {
    // Fresh parse path
    if (ctx.sidecarCallsRemaining.count <= 0) {
      throw new KosError(
        "KOS_BOT_QUOTA_EXCEEDED",
        "Per-turn sidecar call quota exceeded during process_drawing parse step.",
        429,
      );
    }
    ctx.sidecarCallsRemaining.count -= 1;

    try {
      parsed = await parseDrawingFromS3({
        tenant: ctx.tenant,
        s3Key: drawing.s3Key,
        sourceFormat: drawing.sourceFormat as DrawingSourceFormat,
        filename: drawing.originalFilename,
        drawingId: drawing.id,
      });
    } catch (err) {
      // Scanned-PDF path — surface as its own status so the bot tells
      // the user what's wrong without confusion.
      if (err instanceof KosError && err.code === "KOS_DRAWING_004") {
        await prisma.kosCustomerDrawing.update({
          where: { id: drawing.id },
          data: {
            status: "FAILED",
            errorCode: "KOS_DRAWING_004",
            errorText: err.message,
          },
        });
        return {
          status: "scanned_pdf",
          drawing_id: drawing.id,
          message:
            "This PDF appears to be a scanned image, not a vector PDF. Please re-export the drawing from your CAD tool with vector output, or upload the original DXF instead.",
        };
      }
      const code =
        err instanceof KosError ? err.code : "KOS_TOOL_PROCESS_DRAWING_002";
      return failWith(drawing.id, code, (err as Error).message);
    }

    // Always persist parser output to S3 for re-classification reuse.
    const parserS3Key = kosS3Key(
      ctx.tenant,
      "drawings",
      drawing.id,
      "parser-result.json",
    );
    try {
      await uploadKosObject(
        ctx.tenant,
        parserS3Key,
        Buffer.from(JSON.stringify(parsed), "utf-8"),
        "application/json",
      );
      await prisma.kosCustomerDrawing.update({
        where: { id: drawing.id },
        data: { fullParseResultS3Key: parserS3Key },
      });
    } catch (err) {
      // Non-fatal — log and continue with inline-only.
      kosLog.warn("kos_tool_process_drawing_parser_s3_failed", {
        drawingId: drawing.id,
        err: String(err),
      });
    }
  }

  // 5. UNKNOWN classifier — short-circuit before calling the mapper.
  if (parsed.drawing_type === "UNKNOWN" && !args.application_hint) {
    await persistCachedEnvelope(drawing, {
      kind: "parser",
      data: parsed,
    } satisfies CachedParseResultEnvelope);
    await prisma.kosCustomerDrawing.update({
      where: { id: drawing.id },
      data: {
        status: "PARSED",
        parserVersion: parsed.parser_version,
        parsedAt: new Date(),
      },
    });
    return {
      status: "needs_classification",
      drawing_id: drawing.id,
      title_block: {
        drawing_title: parsed.title_block?.drawing_title ?? null,
        level: parsed.title_block?.level ?? null,
      },
      suggested_hints: APPLICATION_HINT_SUGGESTIONS,
      message: parsed.title_block?.drawing_title
        ? `I see this drawing is "${parsed.title_block.drawing_title}". I couldn't automatically identify what kind of wall it is. Could you tell me? For example: internal partition, villa external wall, apartment external (G+3), lift shaft, basement, or retaining wall.`
        : "I couldn't automatically identify this drawing. Could you tell me what kind of wall it is? For example: internal partition, villa external wall, apartment external (G+3), lift shaft, basement, or retaining wall.",
    };
  }

  // 6. Call the mapper.
  if (ctx.sidecarCallsRemaining.count <= 0) {
    throw new KosError(
      "KOS_BOT_QUOTA_EXCEEDED",
      "Per-turn sidecar call quota exceeded before mapper step.",
      429,
    );
  }
  ctx.sidecarCallsRemaining.count -= 1;

  let mapperOutput: MapperOutput;
  try {
    mapperOutput = await generatePanelLayout({
      tenantId: ctx.tenant.id,
      parsed,
      context: {
        project_name:
          args.project_context?.project_name ??
          parsed.title_block?.project_name ??
          `Drawing ${drawing.id}`,
        seismic_zone: args.project_context?.seismic_zone ?? "III",
        application_hint: args.application_hint ?? null,
        split_strategy:
          args.project_context?.split_strategy ?? "minimize_cuts",
        wall_height_mm: args.project_context?.wall_height_mm ?? 3000,
      },
    });
  } catch (err) {
    const code =
      err instanceof KosError ? err.code : "KOS_TOOL_PROCESS_DRAWING_003";
    return failWith(drawing.id, code, (err as Error).message);
  }

  // 7. Persist mapper (inline if small, S3 overflow if large)
  const mapperJson = JSON.stringify(mapperOutput);
  let envelope: CachedParseResultEnvelope;
  if (Buffer.byteLength(mapperJson, "utf-8") <= KOS_DRAWING_PARSE_RESULT_INLINE_CAP_BYTES) {
    envelope = { kind: "mapper", data: mapperOutput };
  } else {
    const mapperS3Key = kosS3Key(
      ctx.tenant,
      "drawings",
      drawing.id,
      "mapper-result.json",
    );
    try {
      await uploadKosObject(
        ctx.tenant,
        mapperS3Key,
        Buffer.from(mapperJson, "utf-8"),
        "application/json",
      );
    } catch (err) {
      return failWith(
        drawing.id,
        "KOS_TOOL_PROCESS_DRAWING_005",
        `Could not persist mapper output to S3: ${(err as Error).message}`,
      );
    }
    envelope = { kind: "mapper_s3", s3Key: mapperS3Key };
  }
  await persistCachedEnvelope(drawing, envelope);
  await prisma.kosCustomerDrawing.update({
    where: { id: drawing.id },
    data: {
      status: "PARSED",
      parserVersion: parsed.parser_version,
      parsedAt: new Date(),
    },
  });

  kosLog.info("kos_tool_process_drawing_ok", {
    drawingId: drawing.id,
    tenantId: ctx.tenant.id,
    customerId: ctx.customer.id,
    parserVersion: parsed.parser_version,
    drawingType: parsed.drawing_type,
    applicationHint: args.application_hint ?? null,
    envelopeKind: envelope.kind,
  });

  return buildReady(drawing.id, parsed, mapperOutput, drawing);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildReady(
  drawingId: string,
  parsed: DrawingParseResult | null,
  mapper: MapperOutput,
  drawing: KosCustomerDrawing,
): Extract<ProcessDrawingResult, { status: "ready" }> {
  return {
    status: "ready",
    drawing_id: drawingId,
    drawing_summary: {
      title_block_drawing_title: parsed?.title_block?.drawing_title ?? null,
      title_block_project_name: parsed?.title_block?.project_name ?? null,
      walls_count: parsed && Array.isArray(parsed.walls) ? parsed.walls.length : 0,
      junctions_count:
        parsed && Array.isArray(parsed.junctions) ? parsed.junctions.length : 0,
      openings_count:
        parsed && Array.isArray(parsed.openings) ? parsed.openings.length : 0,
      parser_version: parsed?.parser_version ?? drawing.parserVersion ?? "unknown",
      drawing_type: parsed?.drawing_type ?? "unknown",
      drawing_type_confidence: parsed?.drawing_type_confidence ?? 0,
    },
    mapper_summary: {
      total_weight_kg:
        typeof mapper.total_weight_kg === "number" ? mapper.total_weight_kg : null,
      waste_ratio: typeof mapper.waste_ratio === "number" ? mapper.waste_ratio : null,
      downstream_ready_boq: mapper.downstream_ready?.boq ?? false,
      downstream_ready_formwork: mapper.downstream_ready?.formwork ?? false,
      wall_segments_count: Array.isArray(mapper.wall_segments)
        ? mapper.wall_segments.length
        : 0,
    },
  };
}

async function failWith(
  drawingId: string,
  code: string,
  message: string,
): Promise<Extract<ProcessDrawingResult, { status: "failed" }>> {
  await prisma.kosCustomerDrawing.update({
    where: { id: drawingId },
    data: { status: "FAILED", errorCode: code, errorText: message },
  });
  kosLog.warn("kos_tool_process_drawing_fail", {
    drawingId,
    errorCode: code,
    errorMessage: message,
    auditAction: KOS_AUDIT_5I_PR2B.TOOL_PROCESS_DRAWING_FAIL,
  });
  return {
    status: "failed",
    drawing_id: drawingId,
    error_code: code,
    error_message: message,
  };
}

async function persistCachedEnvelope(
  drawing: KosCustomerDrawing,
  envelope: CachedParseResultEnvelope,
): Promise<void> {
  await prisma.kosCustomerDrawing.update({
    where: { id: drawing.id },
    data: { parseResult: envelope as object },
  });
}

async function loadMapperFromS3(
  tenant: Tenant,
  s3Key: string,
): Promise<MapperOutput> {
  const { buffer } = await fetchKosObjectAsBuffer(tenant, s3Key);
  return JSON.parse(buffer.toString("utf-8")) as MapperOutput;
}
