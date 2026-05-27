/**
 * POST /api/kos/bd/documents/[id]/reindex
 *
 * Bump the document's version, drop all existing chunks, reset
 * status to PARSING, and enqueue a fresh ingestion job. Used when:
 *   • The source PDF is unchanged but the BD wants a fresh embed
 *     (e.g. after the model dimension migrates).
 *   • A previous ingest failed and the failure cause is fixed.
 *
 * Re-uploading a new file is a separate flow (upload-url +
 * confirm-upload create a new KosDocument row, leaving history).
 */

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";
import { headKosObject } from "@/features/kos/services/s3-client";
import { scheduleKosIngestWorker } from "@/features/kos/services/kos-qstash";

export const dynamic = "force-dynamic";

export async function POST(
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

    // Sanity-check the source PDF is still in S3 (lifecycle policies
    // could have aged it out between the original upload and now).
    const head = await headKosObject(tenant, doc.s3Key);
    if (!head.exists) {
      throw new KosError(
        "KOS_DOC_005",
        `Cannot reindex — source S3 object missing for document ${id} (key=${doc.s3Key}). Re-upload the file.`,
        409,
      );
    }

    // Drop the old chunks + bump version in a single transaction so
    // a reindex never leaves the DB in a half-flushed state.
    const updated = await prisma.$transaction(async (tx) => {
      await tx.kosDocumentChunk.deleteMany({ where: { documentId: doc.id } });
      return tx.kosDocument.update({
        where: { id: doc.id },
        data: {
          version: { increment: 1 },
          status: "PARSING",
          indexedAt: null,
        },
        select: { id: true, version: true },
      });
    });

    const messageId = await scheduleKosIngestWorker(doc.id, doc.tenantId);

    return NextResponse.json({
      ok: true,
      documentId: updated.id,
      version: updated.version,
      newJobId: messageId,
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
