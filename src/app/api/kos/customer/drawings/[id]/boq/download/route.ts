/**
 * 5I PR 4 — GET /api/kos/customer/drawings/[id]/boq/download
 *
 * Streams the BOQ as a binary `.xlsx` attachment.
 *
 * Pipeline:
 *  1. Auth: requireTenantOrThrow → requireKosCustomer (C2 boundary)
 *  2. Lookup drawing scoped to {tenantId, customerId}; 404 on miss
 *  3. Check boqResultS3Key; 404 if not generated yet
 *  4. Fetch BOQ JSON from S3 (graceful failure → 502)
 *  5. Render Excel via boq-xlsx-renderer (graceful failure → 500)
 *  6. Set Content-Disposition with both filename= (ASCII) and
 *     filename*= (UTF-8) for RFC 5987 broad-browser support
 *  7. Return Buffer with Cache-Control: no-store
 *
 * Error envelopes are JSON: `{ error_code, message }`.
 * Runtime: nodejs (xlsx requires Node, not Edge).
 */

import { type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { fetchKosObjectAsBuffer } from "@/features/kos/services/s3-client";
import { renderBoqExcel } from "@/features/kos/services/renderers/boq-xlsx-renderer";
import { buildDownloadFilename } from "@/features/kos/services/renderers/download-filename";
import type { BOQOutput } from "@/features/kos/types/sidecar";

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

    // C2 boundary — single findFirst pinned to {id, tenantId, customerId}
    const drawing = await prisma.kosCustomerDrawing.findFirst({
      where: { id, tenantId: tenant.id, customerId: customer.id },
    });
    if (!drawing) {
      throw new KosError("KOS_DL_BOQ_001", "Drawing not found.", 404);
    }

    if (!drawing.boqResultS3Key) {
      throw new KosError(
        "KOS_DL_BOQ_002",
        "BOQ has not been generated yet. Please wait for processing to complete.",
        404,
      );
    }

    // Fetch JSON
    let s3Result: Awaited<ReturnType<typeof fetchKosObjectAsBuffer>>;
    try {
      s3Result = await fetchKosObjectAsBuffer(tenant, drawing.boqResultS3Key);
    } catch (err) {
      kosLog.warn("kos_dl_boq_s3_fetch_failed", {
        drawingId: id,
        s3Key: drawing.boqResultS3Key,
        err: String(err),
      });
      throw new KosError(
        "KOS_DL_BOQ_005",
        "Failed to retrieve BOQ data. Please try again later.",
        502,
      );
    }

    let boqJson: BOQOutput;
    try {
      boqJson = JSON.parse(s3Result.buffer.toString("utf-8")) as BOQOutput;
    } catch (err) {
      kosLog.error("kos_dl_boq_json_parse_failed", { drawingId: id, err: String(err) });
      throw new KosError(
        "KOS_DL_BOQ_003",
        "BOQ data is corrupt. Please regenerate the BOQ.",
        500,
      );
    }

    // Render
    let excelBuffer: Buffer;
    try {
      excelBuffer = await renderBoqExcel({
        boq: boqJson,
        drawing,
        parseResult: drawing.parseResult,
      });
    } catch (err) {
      kosLog.error("kos_dl_boq_render_failed", {
        drawingId: id,
        err: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw new KosError(
        "KOS_DL_BOQ_004",
        "Failed to render BOQ. Please contact support.",
        500,
      );
    }

    const filename = buildDownloadFilename(drawing.originalFilename, "boq", drawing.id);

    kosLog.info("kos_dl_boq_ok", {
      tenantId: tenant.id,
      customerId: customer.id,
      drawingId: id,
      filename,
      bytes: excelBuffer.byteLength,
    });

    // Node's `Buffer` extends `Uint8Array`, both of which the
    // undici Response constructor accepts at runtime — but TS's
    // strict `BodyInit` union (lib.dom.d.ts) excludes them. Cast
    // through `BodyInit` to satisfy the type without copying bytes.
    return new Response(excelBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(excelBuffer.byteLength),
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
    kosLog.error("kos_dl_boq_unhandled", {
      drawingId: id,
      err: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error_code: "KOS_DL_BOQ_000",
        message: "An unexpected error occurred.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Strip non-ASCII characters from the filename for the legacy
 * `filename=` attribute. The companion `filename*=UTF-8''…` part
 * (RFC 5987) carries the full UTF-8 name for modern browsers.
 */
function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, "_");
}
