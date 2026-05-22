/**
 * GET /api/kos/customer/sources/[documentId]
 *
 * Streams a Kalzen source document inline so the browser's native PDF
 * viewer can render it at a `#page=N` fragment. This is the same-origin
 * proxy that the `/sources/[documentId]` page redirects to.
 *
 * Why proxy instead of redirecting straight to a presigned S3 URL:
 *   - The global CSP `frame-src` allow-list excludes S3 and the global
 *     `X-Frame-Options: DENY` / `frame-ancestors 'none'` block all
 *     iframes, so a presigned-URL iframe can't render. A same-origin
 *     top-level navigation to this route renders fine (XFO only
 *     restricts framing, not top-level navigation).
 *   - It keeps the presigned URL fully server-side (never reaches the
 *     client) and lets us FORCE `Content-Type: application/pdf` +
 *     `Content-Disposition: inline` regardless of how the object was
 *     stored, guaranteeing inline rendering.
 *
 * Auth: tenant must resolve AND a valid customer session must be
 * present — the same bar as the chat endpoint. Tenant isolation is
 * enforced by matching `document.tenantId` to the resolved tenant.
 */

import { type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";
import { streamKosObject } from "@/features/kos/services/s3-client";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params;

    const tenant = await requireTenantOrThrow(req);
    // Customer session required — mirrors the chat endpoint's bar.
    await requireKosCustomer(req, tenant.id);

    const doc = await prisma.kosDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        title: true,
        s3Key: true,
        mimeType: true,
      },
    });

    if (!doc) {
      throw new KosError(
        "KOS_CHAT_008",
        `Source document "${documentId}" not found.`,
        404,
      );
    }

    if (doc.tenantId !== tenant.id) {
      throw new KosError(
        "KOS_CHAT_004",
        `Document "${documentId}" belongs to a different tenant — access denied.`,
        403,
      );
    }

    if (doc.status !== "READY") {
      throw new KosError(
        "KOS_CHAT_009",
        `Source document "${documentId}" is not viewable (status: ${doc.status}).`,
        404,
      );
    }

    const { body, contentLength } = await streamKosObject(tenant, doc.s3Key);

    const contentType =
      doc.mimeType && doc.mimeType.trim().length > 0
        ? doc.mimeType
        : "application/pdf";

    // Sanitize the filename for the Content-Disposition header.
    const safeName =
      doc.title.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "source";

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeName}.pdf"`,
      // Private + no-store: presigned-backed content should not be
      // cached by shared proxies.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    if (contentLength > 0) {
      headers.set("Content-Length", String(contentLength));
    }

    return new Response(body, { status: 200, headers });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
