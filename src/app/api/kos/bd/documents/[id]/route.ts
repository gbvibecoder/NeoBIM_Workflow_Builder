/**
 * GET /api/kos/bd/documents/[id]
 *
 * Detail endpoint — returns the KosDocument plus a presigned
 * download URL for the source PDF (5 min expiry) and the current
 * chunk count.
 */

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";
import { createKosPresignedDownloadUrl } from "@/features/kos/services/s3-client";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = await requireTenantOrThrow(req);
    await requireKosBdUser(req);

    const { id } = await params;
    if (!id) {
      throw new KosError("KOS_VAL_001", "Missing document id.", 400);
    }

    const doc = await prisma.kosDocument.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!doc) {
      throw new KosError(
        "KOS_DOC_004",
        `Document ${id} not found in tenant "${tenant.slug}".`,
        404,
      );
    }

    const chunkCount = await prisma.kosDocumentChunk.count({
      where: { documentId: doc.id },
    });

    // Presigning a GET for a non-existent S3 key still succeeds; the
    // download itself surfaces the 404. We only presign when the
    // document is at least past UPLOADED (i.e. confirm-upload ran).
    let downloadUrl: string | null = null;
    if (doc.status !== "UPLOADED" && doc.s3Key) {
      downloadUrl = await createKosPresignedDownloadUrl(tenant, doc.s3Key, 300);
    }

    return NextResponse.json({
      id: doc.id,
      title: doc.title,
      docType: doc.docType,
      status: doc.status,
      pageCount: doc.pageCount,
      version: doc.version,
      mimeType: doc.mimeType,
      s3Key: doc.s3Key,
      uploadedBy: doc.uploadedBy,
      indexedAt: doc.indexedAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
      chunkCount,
      downloadUrl,
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
