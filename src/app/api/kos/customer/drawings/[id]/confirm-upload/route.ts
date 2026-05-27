/**
 * POST /api/kos/customer/drawings/[id]/confirm-upload
 *
 * Step 3 of the 3-step customer drawing upload flow. Called by the
 * `useChatAttachments` hook after the browser's XHR PUT to the
 * presigned URL completes.
 *
 * Side effects (only when AWAITING_UPLOAD → UPLOADED transition fires):
 *   • HEAD the S3 object to verify the PUT actually landed
 *   • Confirm the object size matches the claimed sizeBytes within
 *     a 10% tolerance (catches clients that lied about size at
 *     presign time, e.g. content-replacement attacks)
 *   • Atomic transition via updateMany so two concurrent confirms
 *     don't double-write
 *   • Audit log row
 *
 * Idempotency:
 *   • A re-call for a drawing already in UPLOADED/PARSING/PARSED
 *     returns 200 with the existing row's data and does NOT re-HEAD
 *     S3 (preserves the API contract while keeping the operation
 *     cheap on retry).
 *   • A re-call for a drawing in FAILED returns 409; the customer
 *     must re-upload from step 1.
 *
 * Defect C2 — cross-customer ownership:
 *   findFirst() requires { id, tenantId, customerId } match. A drawing
 *   belonging to customer A returns 404 (NOT 403) to customer B; the
 *   404 avoids leaking existence.
 */

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { headKosObject } from "@/features/kos/services/s3-client";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";

export const dynamic = "force-dynamic";

const SIZE_TOLERANCE_FACTOR = 1.1;

interface AttachmentRef {
  drawingId: string;
  kind: "drawing";
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await ctx.params;

  try {
    if (!id || typeof id !== "string") {
      throw new KosError(
        "KOS_DRAW_CFM_002",
        "Missing or invalid drawing id in path.",
        400,
      );
    }

    const tenant = await requireTenantOrThrow(req);
    const customer = await requireKosCustomer(req, tenant.id);

    const drawing = await prisma.kosCustomerDrawing.findFirst({
      where: { id, tenantId: tenant.id, customerId: customer.id },
    });
    if (!drawing) {
      // 404 (not 403) — do not leak existence. This is the C2 boundary.
      throw new KosError(
        "KOS_DRAW_CFM_001",
        `Drawing ${id} not found.`,
        404,
      );
    }

    // Idempotency: already-confirmed states return 200 with the row's
    // current data. PARSING and PARSED are downstream-only states that
    // PR 2 will set; we accept them here so a confirm retry mid-parse
    // doesn't fail the customer's UI.
    if (
      drawing.status === "UPLOADED" ||
      drawing.status === "PARSING" ||
      drawing.status === "PARSED"
    ) {
      kosLog.info("kos_draw_cfm_idempotent", {
        drawingId: id,
        customerId: customer.id,
        currentStatus: drawing.status,
      });
      const ref: AttachmentRef = { drawingId: drawing.id, kind: "drawing" };
      return NextResponse.json({
        drawing: {
          id: drawing.id,
          filename: drawing.filename,
          sizeBytes: drawing.actualSizeBytes ?? drawing.sizeBytes,
          sourceFormat: drawing.sourceFormat,
          status: drawing.status,
        },
        attachmentRef: ref,
      });
    }

    // Only AWAITING_UPLOAD can advance to UPLOADED. FAILED requires a
    // fresh upload (the original presigned URL has likely expired).
    if (drawing.status !== "AWAITING_UPLOAD") {
      throw new KosError(
        "KOS_DRAW_CFM_006",
        `Drawing ${id} is in state ${drawing.status} — cannot confirm. Re-upload via /upload-url.`,
        409,
      );
    }

    // S3 HEAD — verifies the PUT landed AND gives us the actual byte
    // count for the tolerance check below.
    let head;
    try {
      head = await headKosObject(tenant, drawing.s3Key);
    } catch (err) {
      kosLog.error("kos_draw_cfm_s3_head_failed", {
        drawingId: id,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new KosError(
        "KOS_DRAW_CFM_005",
        `S3 transport failure on HEAD: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    if (!head.exists) {
      throw new KosError(
        "KOS_DRAW_CFM_003",
        `S3 object missing for drawing ${id} (key=${drawing.s3Key}). Browser PUT may have failed silently — re-upload.`,
        422,
      );
    }

    if (head.contentLength === undefined || head.contentLength === null) {
      throw new KosError(
        "KOS_DRAW_CFM_003",
        `S3 object exists for drawing ${id} but no ContentLength returned. Re-upload.`,
        422,
      );
    }

    const actualSize = Number(head.contentLength);
    if (
      !Number.isFinite(actualSize) ||
      actualSize < 1 ||
      actualSize > drawing.sizeBytes * SIZE_TOLERANCE_FACTOR
    ) {
      throw new KosError(
        "KOS_DRAW_CFM_004",
        `S3 object size ${actualSize} outside tolerance for claimed ${drawing.sizeBytes} bytes (max ${Math.floor(drawing.sizeBytes * SIZE_TOLERANCE_FACTOR)}). Re-upload.`,
        422,
      );
    }

    // Atomic transition — updateMany returns count=0 if another
    // request raced us and already advanced the row.
    const updated = await prisma.kosCustomerDrawing.updateMany({
      where: { id, status: "AWAITING_UPLOAD" },
      data: { status: "UPLOADED", actualSizeBytes: actualSize },
    });

    if (updated.count === 0) {
      // Race resolved by the other writer. Re-read and return the
      // current state.
      const re = await prisma.kosCustomerDrawing.findFirst({
        where: { id, tenantId: tenant.id, customerId: customer.id },
      });
      if (!re) {
        // Should be impossible given we just saw it above. Defensive.
        throw new KosError(
          "KOS_DRAW_CFM_001",
          `Drawing ${id} disappeared mid-confirm.`,
          404,
        );
      }
      const ref: AttachmentRef = { drawingId: re.id, kind: "drawing" };
      return NextResponse.json({
        drawing: {
          id: re.id,
          filename: re.filename,
          sizeBytes: re.actualSizeBytes ?? re.sizeBytes,
          sourceFormat: re.sourceFormat,
          status: re.status,
        },
        attachmentRef: ref,
      });
    }

    // Audit log fire-and-forget.
    prisma.kosAuditLog
      .create({
        data: {
          tenantId: tenant.id,
          actorType: "CUSTOMER",
          actorId: customer.id,
          conversationId: drawing.conversationId,
          action: "CUSTOMER_DRAWING_UPLOADED",
          details: {
            drawingId: id,
            actualSizeBytes: actualSize,
            claimedSizeBytes: drawing.sizeBytes,
            sourceFormat: drawing.sourceFormat,
          },
        },
      })
      .catch((err) =>
        kosLog.warn("kos_draw_cfm_audit_failed", {
          drawingId: id,
          err: err instanceof Error ? err.message : String(err),
        }),
      );

    kosLog.info("kos_draw_cfm_success", {
      tenantId: tenant.id,
      customerId: customer.id,
      drawingId: id,
      actualSize,
      durationMs: Date.now() - startedAt,
    });

    const ref: AttachmentRef = { drawingId: id, kind: "drawing" };
    return NextResponse.json({
      drawing: {
        id,
        filename: drawing.filename,
        sizeBytes: actualSize,
        sourceFormat: drawing.sourceFormat,
        status: "UPLOADED" as const,
      },
      attachmentRef: ref,
    });
  } catch (err) {
    if (err instanceof KosError) {
      kosLog.warn("kos_draw_cfm_route_error", {
        errorCode: err.code,
        drawingId: id,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { code: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    kosLog.error("kos_draw_cfm_route_unhandled", {
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      drawingId: id,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        code: "KOS_DRAW_CFM_500",
        message: `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
