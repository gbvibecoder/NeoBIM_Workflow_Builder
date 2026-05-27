/**
 * 5I PR 4 — GET /api/kos/customer/drawings/[id]/formwork/download
 *
 * Streams the Formwork artifact as a binary `.pdf` attachment.
 * Mirrors the BOQ download route — same auth/C2/error pipeline,
 * different content-type + renderer + filename prefix + error codes.
 */

import { type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { fetchKosObjectAsBuffer } from "@/features/kos/services/s3-client";
import { renderFormworkPdf } from "@/features/kos/services/renderers/formwork-pdf-renderer";
import { buildDownloadFilename } from "@/features/kos/services/renderers/download-filename";
import type { FormworkOutput } from "@/features/kos/types/sidecar";

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
      throw new KosError("KOS_DL_FRM_001", "Drawing not found.", 404);
    }

    if (!drawing.formworkResultS3Key) {
      throw new KosError(
        "KOS_DL_FRM_002",
        "Formwork has not been generated yet. Please wait for processing to complete.",
        404,
      );
    }

    let s3Result: Awaited<ReturnType<typeof fetchKosObjectAsBuffer>>;
    try {
      s3Result = await fetchKosObjectAsBuffer(tenant, drawing.formworkResultS3Key);
    } catch (err) {
      kosLog.warn("kos_dl_frm_s3_fetch_failed", {
        drawingId: id,
        s3Key: drawing.formworkResultS3Key,
        err: String(err),
      });
      throw new KosError(
        "KOS_DL_FRM_005",
        "Failed to retrieve Formwork data. Please try again later.",
        502,
      );
    }

    let formworkJson: FormworkOutput;
    try {
      formworkJson = JSON.parse(s3Result.buffer.toString("utf-8")) as FormworkOutput;
    } catch (err) {
      kosLog.error("kos_dl_frm_json_parse_failed", { drawingId: id, err: String(err) });
      throw new KosError(
        "KOS_DL_FRM_003",
        "Formwork data is corrupt. Please regenerate the Formwork.",
        500,
      );
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderFormworkPdf({
        formwork: formworkJson,
        drawing,
        parseResult: drawing.parseResult,
      });
    } catch (err) {
      kosLog.error("kos_dl_frm_render_failed", {
        drawingId: id,
        err: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw new KosError(
        "KOS_DL_FRM_004",
        "Failed to render Formwork PDF. Please contact support.",
        500,
      );
    }

    const filename = buildDownloadFilename(drawing.originalFilename, "formwork", drawing.id);

    kosLog.info("kos_dl_frm_ok", {
      tenantId: tenant.id,
      customerId: customer.id,
      drawingId: id,
      filename,
      bytes: pdfBuffer.byteLength,
    });

    // See BOQ route comment: cast through BodyInit because TS's
    // strict DOM types exclude Node Buffer even though Response
    // accepts it at runtime (undici / Next.js).
    return new Response(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(pdfBuffer.byteLength),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
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
    kosLog.error("kos_dl_frm_unhandled", {
      drawingId: id,
      err: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error_code: "KOS_DL_FRM_000",
        message: "An unexpected error occurred.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, "_");
}
