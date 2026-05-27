/**
 * POST /api/kos/customer/drawings/upload-url
 *
 * Step 1 of the 3-step direct-to-S3 upload flow for customer-attached
 * drawings (5I PR 1). Mirrors the existing BD `documents/upload-url`
 * route but with:
 *   • customer auth (requireKosCustomer) instead of BD auth
 *   • per-customer + per-IP rate limit (customer-rate-limit.ts)
 *   • the "drawings" S3 key prefix
 *   • a tighter MIME allowlist scoped to drawing source formats
 *   • idempotent server-side filename sanitization
 *
 * The 15 MB cap is tighter than BD's 50 MB cap on purpose — customer
 * drawings are typically a single DXF or PDF page; anything larger
 * suggests an unsanitised CAD export with embedded raster bloat, and
 * the bot's processing pipeline gets cheaper-to-fail-fast as size
 * shrinks.
 *
 * Response shape:
 *   { drawingId, uploadUrl, s3Key, expiresAt }
 *
 * Errors use the KOS_DRAW_UP_* namespace (001-009 reserved here).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import {
  createKosPresignedUploadUrl,
  kosS3Key,
} from "@/features/kos/services/s3-client";
import { sanitizeFilename } from "@/features/kos/lib/filename-sanitize";
import { DRAWING_SOURCE_FORMATS } from "@/features/kos/types/drawing";
import {
  checkUploadRateLimit,
  resolveClientIp,
} from "@/features/kos/lib/customer-rate-limit";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — see file docstring

// Zod 4 z.enum requires a tuple. DRAWING_SOURCE_FORMATS is `readonly
// [...string]` from the `as const` declaration; the cast satisfies
// the type checker without changing runtime behaviour.
const Body = z.object({
  filename: z.string().min(1).max(255),
  originalFilename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  sourceFormat: z.enum(
    DRAWING_SOURCE_FORMATS as unknown as readonly [string, ...string[]],
  ),
  conversationId: z.string().nullable().optional(),
});

const ALLOWED_CT_BY_FORMAT: Record<string, readonly string[]> = {
  // DXF is text but most browsers report application/octet-stream; the
  // allowlist accepts both the IANA-registered MIME and the generic
  // fallback.
  dxf: ["image/vnd.dxf", "application/dxf", "application/x-dxf", "application/octet-stream"],
  dwg: ["image/vnd.dwg", "application/acad", "application/x-acad", "application/octet-stream"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
};

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const tenant = await requireTenantOrThrow(req);
    const customer = await requireKosCustomer(req, tenant.id);

    const ip = resolveClientIp(req);
    const rl = await checkUploadRateLimit({ customerId: customer.id, ip });
    if (!rl.ok) {
      throw new KosError(
        "KOS_DRAW_UP_006",
        `Rate limit exceeded (${rl.dimension}). Please try again later.`,
        429,
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch (err) {
      throw new KosError(
        "KOS_DRAW_UP_002",
        `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }

    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new KosError(
        "KOS_DRAW_UP_003",
        `Validation failed: ${detail}`,
        400,
      );
    }
    const data = parsed.data;

    // Zod already enforces max(MAX_BYTES) but a 413 is more accurate
    // than the 400 Zod produces, and surfacing the exact mismatch in
    // the message helps debugging.
    if (data.sizeBytes > MAX_BYTES) {
      throw new KosError(
        "KOS_DRAW_UP_004",
        `File too large: ${data.sizeBytes} bytes > ${MAX_BYTES} bytes (15 MB limit).`,
        413,
      );
    }

    const allowed = ALLOWED_CT_BY_FORMAT[data.sourceFormat];
    if (!allowed?.includes(data.contentType)) {
      throw new KosError(
        "KOS_DRAW_UP_005",
        `Unsupported contentType "${data.contentType}" for sourceFormat "${data.sourceFormat}". Allowed: ${allowed?.join(", ") ?? "(none)"}.`,
        415,
      );
    }

    // Sanitise server-side even though the client also sanitises — the
    // client is untrusted. Apply to BOTH the storage filename and
    // (defensively) to the originalFilename's max length only; we
    // preserve the originalFilename's content because the customer
    // sees it in the chat transcript and React auto-escapes on render.
    const safeFilename = sanitizeFilename(data.filename);
    const originalFilenameCapped = data.originalFilename.slice(0, 255);

    if (data.conversationId) {
      const owns = await prisma.kosConversation.findFirst({
        where: {
          id: data.conversationId,
          tenantId: tenant.id,
          customerId: customer.id,
        },
        select: { id: true },
      });
      if (!owns) {
        // 403 because the conversation exists in the customer's
        // namespace check OR doesn't exist at all — leaking either
        // signal is fine here because the customer asserted the id;
        // confirm-upload uses 404 for the stricter post-hoc check.
        throw new KosError(
          "KOS_DRAW_UP_007",
          `Conversation ${data.conversationId} not found or not owned by this customer.`,
          403,
        );
      }
    }

    // Create the drawing row with a sentinel s3Key, then patch it once
    // we know the persisted id (since the key uses the id). Two-step
    // write keeps the schema's s3Key NOT NULL.
    let drawing;
    try {
      drawing = await prisma.kosCustomerDrawing.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          conversationId: data.conversationId ?? null,
          filename: safeFilename,
          originalFilename: originalFilenameCapped,
          sourceFormat: data.sourceFormat,
          sizeBytes: data.sizeBytes,
          s3Key: "PENDING",
          status: "AWAITING_UPLOAD",
        },
      });
    } catch (err) {
      kosLog.error("kos_draw_up_db_insert_failed", {
        tenantId: tenant.id,
        customerId: customer.id,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new KosError(
        "KOS_DRAW_UP_008",
        `Failed to persist drawing record: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    const s3Key = kosS3Key(
      tenant,
      "drawings",
      customer.id,
      drawing.id,
      `source.${data.sourceFormat}`,
    );

    let presigned: { uploadUrl: string };
    try {
      presigned = await createKosPresignedUploadUrl(
        tenant,
        s3Key,
        data.contentType,
        900, // 15 minutes — long enough for a flaky mobile upload, short enough that a leaked URL is nearly useless within the hour
      );
    } catch (err) {
      kosLog.error("kos_draw_up_presign_failed", {
        tenantId: tenant.id,
        drawingId: drawing.id,
        err: err instanceof Error ? err.message : String(err),
      });
      // Roll the row back so it doesn't dangle in AWAITING_UPLOAD
      // forever with no possible PUT target.
      await prisma.kosCustomerDrawing
        .delete({ where: { id: drawing.id } })
        .catch((cleanupErr) => {
          kosLog.warn("kos_draw_up_rollback_failed", {
            drawingId: drawing.id,
            err: String(cleanupErr),
          });
        });
      throw new KosError(
        "KOS_DRAW_UP_009",
        `S3 presign failed: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    await prisma.kosCustomerDrawing.update({
      where: { id: drawing.id },
      data: { s3Key },
    });

    // Audit log is fire-and-forget — a logging failure should not
    // block the success path (the customer's drawing row is already
    // committed; the audit can be reconstructed from app logs).
    prisma.kosAuditLog
      .create({
        data: {
          tenantId: tenant.id,
          actorType: "CUSTOMER",
          actorId: customer.id,
          conversationId: data.conversationId ?? null,
          action: "CUSTOMER_DRAWING_UPLOAD_REQUESTED",
          details: {
            drawingId: drawing.id,
            sourceFormat: data.sourceFormat,
            sizeBytes: data.sizeBytes,
            filename: safeFilename,
          },
          ipAddress: ip,
        },
      })
      .catch((err) =>
        kosLog.warn("kos_draw_up_audit_failed", {
          drawingId: drawing.id,
          err: err instanceof Error ? err.message : String(err),
        }),
      );

    kosLog.info("kos_draw_up_success", {
      tenantId: tenant.id,
      customerId: customer.id,
      drawingId: drawing.id,
      sourceFormat: data.sourceFormat,
      sizeBytes: data.sizeBytes,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      drawingId: drawing.id,
      uploadUrl: presigned.uploadUrl,
      s3Key,
      expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
    });
  } catch (err) {
    if (err instanceof KosError) {
      kosLog.warn("kos_draw_up_route_error", {
        errorCode: err.code,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { code: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    kosLog.error("kos_draw_up_route_unhandled", {
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        code: "KOS_DRAW_UP_500",
        message: `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { code: "KOS_DRAW_UP_405", message: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
