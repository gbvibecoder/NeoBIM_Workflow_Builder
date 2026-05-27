/**
 * 5I PR 4 — GET /api/kos/customer/drawings/[id]
 *
 * Lightweight per-drawing summary used by the client-side hydration
 * hook to populate ArtifactBubble with real download URLs after a turn
 * completes. Returns a `KosDrawingArtifactSummary`.
 *
 * Graceful degradation: if one artifact's S3 JSON fails to load, that
 * artifact's summary is omitted (null) but the endpoint still returns
 * 200 with whatever else is available. We do NOT 500 the whole summary
 * because BOQ S3 had a transient blip.
 *
 * C2 boundary identical to download routes: cross-customer or
 * cross-tenant → 404 with the same `KOS_DL_SUMMARY_001` envelope.
 */

import { type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { fetchKosObjectAsBuffer } from "@/features/kos/services/s3-client";
import type { KosDrawingArtifactSummary } from "@/features/kos/types/drawing-summary";
import type { BOQOutput, FormworkOutput } from "@/features/kos/types/sidecar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  try {
    const tenant = await requireTenantOrThrow(req);
    const customer = await requireKosCustomer(req, tenant.id);

    const drawing = await prisma.kosCustomerDrawing.findFirst({
      where: { id, tenantId: tenant.id, customerId: customer.id },
    });
    if (!drawing) {
      throw new KosError("KOS_DL_SUMMARY_001", "Drawing not found.", 404);
    }

    // ── Extract drawing-level summary from parseResult (best-effort) ─
    let hasMapper = false;
    let drawingSummary: KosDrawingArtifactSummary["drawingSummary"] = null;

    if (drawing.parseResult && typeof drawing.parseResult === "object") {
      const pr = drawing.parseResult as { kind?: unknown; data?: unknown };
      hasMapper = pr.kind === "mapper" || pr.kind === "mapper_s3";
      if (pr.kind === "parser" && pr.data && typeof pr.data === "object") {
        drawingSummary = extractDrawingSummary(pr.data);
      }
    }
    // Fall back to S3-stored parser blob if envelope is mapper-only
    if (!drawingSummary && drawing.fullParseResultS3Key) {
      try {
        const blob = await fetchKosObjectAsBuffer(tenant, drawing.fullParseResultS3Key);
        const parsed = JSON.parse(blob.buffer.toString("utf-8"));
        drawingSummary = extractDrawingSummary(parsed);
      } catch (err) {
        kosLog.warn("kos_dl_summary_parser_s3_failed", {
          drawingId: id,
          err: String(err),
        });
        // Graceful — leave drawingSummary as null
      }
    }

    // ── BOQ summary (graceful) ─────────────────────────────────────
    let boqSummary: KosDrawingArtifactSummary["boq"] = null;
    if (drawing.boqResultS3Key) {
      try {
        const blob = await fetchKosObjectAsBuffer(tenant, drawing.boqResultS3Key);
        const boq = JSON.parse(blob.buffer.toString("utf-8")) as BOQOutput;
        const tier1 = (boq.tier_1_summary ?? {}) as Record<string, unknown>;
        boqSummary = {
          boqId: boq.boq_id,
          totalStandardPanels: pickNumber(tier1, "total_standard_panels"),
          grandTotalInrFormatted: pickString(tier1, "grand_total_inr_formatted"),
          customQuotesPendingCount: pickNumber(tier1, "custom_quotes_pending_count"),
          warningsCount: Array.isArray(boq.warnings) ? boq.warnings.length : 0,
          downloadUrl: `/api/kos/customer/drawings/${encodeURIComponent(id)}/boq/download`,
        };
      } catch (err) {
        kosLog.warn("kos_dl_summary_boq_fetch_failed", {
          drawingId: id,
          err: String(err),
        });
        // boqSummary stays null — UI shows "BOQ unavailable"
      }
    }

    // ── Formwork summary (graceful) ────────────────────────────────
    let formworkSummary: KosDrawingArtifactSummary["formwork"] = null;
    if (drawing.formworkResultS3Key) {
      try {
        const blob = await fetchKosObjectAsBuffer(tenant, drawing.formworkResultS3Key);
        const fmw = JSON.parse(blob.buffer.toString("utf-8")) as FormworkOutput;
        const tier1 = (fmw.tier_1_summary ?? {}) as Record<string, unknown>;
        formworkSummary = {
          formworkId: fmw.formwork_id,
          propsCount: pickNumber(tier1, "total_props"),
          walersCount: pickNumber(tier1, "total_walers"),
          kickersCount: pickNumber(tier1, "total_kickers"),
          warningsCount: Array.isArray(fmw.warnings) ? fmw.warnings.length : 0,
          downloadUrl: `/api/kos/customer/drawings/${encodeURIComponent(id)}/formwork/download`,
        };
      } catch (err) {
        kosLog.warn("kos_dl_summary_formwork_fetch_failed", {
          drawingId: id,
          err: String(err),
        });
      }
    }

    const response: KosDrawingArtifactSummary = {
      drawingId: drawing.id,
      filename: drawing.originalFilename,
      status: drawing.status,
      errorCode: drawing.errorCode,
      errorMessage: drawing.errorText,
      hasMapper,
      drawingSummary,
      boq: boqSummary,
      formwork: formworkSummary,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof KosError) {
      return new Response(
        JSON.stringify({ error_code: err.code, message: err.message }),
        {
          status: err.httpStatus,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    kosLog.error("kos_dl_summary_unhandled", {
      drawingId: id,
      err: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error_code: "KOS_DL_SUMMARY_000",
        message: "An unexpected error occurred.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function extractDrawingSummary(data: unknown): KosDrawingArtifactSummary["drawingSummary"] {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const titleBlock =
    d.title_block && typeof d.title_block === "object"
      ? (d.title_block as Record<string, unknown>)
      : null;
  return {
    walls: Array.isArray(d.walls) ? d.walls.length : null,
    junctions: Array.isArray(d.junctions) ? d.junctions.length : null,
    openings: Array.isArray(d.openings) ? d.openings.length : null,
    titleBlockDrawingTitle:
      typeof titleBlock?.drawing_title === "string" ? titleBlock.drawing_title : null,
    drawingType: typeof d.drawing_type === "string" ? d.drawing_type : null,
    drawingTypeConfidence:
      typeof d.drawing_type_confidence === "number" ? d.drawing_type_confidence : null,
  };
}

function pickNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}
