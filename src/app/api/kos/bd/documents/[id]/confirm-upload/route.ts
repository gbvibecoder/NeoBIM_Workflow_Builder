/**
 * POST /api/kos/bd/documents/[id]/confirm-upload
 *
 * Step 2 of the 2-step upload flow. The BD client calls this AFTER
 * successfully PUTting the file to the presigned URL from step 1.
 *
 * Side effects:
 *   • HEAD the S3 object — surfaces a precise error if the browser
 *     thought the PUT succeeded but the object didn't actually land
 *     (e.g. transient S3 503, CORS preflight failure, etc.).
 *   • Flip status to PARSING.
 *   • Enqueue the ingestion worker via QStash.
 *   • Return the QStash message id so the BD client can correlate.
 *
 * Idempotent under repeated calls: a re-call once the doc is already
 * in PARSING/CHUNKING/EMBEDDING/READY returns 409 — we don't want a
 * double-enqueue when a network blip caused the BD client to retry.
 */

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";
import { headKosObject } from "@/features/kos/services/s3-client";
import { scheduleKosIngestWorker } from "@/features/kos/services/kos-qstash";
import { runDocumentIngestion } from "@/features/kos/services/document-ingestion";

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

    if (doc.status !== "UPLOADED" && doc.status !== "FAILED") {
      throw new KosError(
        "KOS_DOC_006",
        `Document ${id} is in state ${doc.status} — confirm-upload already ran. Use /reindex to re-ingest.`,
        409,
      );
    }

    const head = await headKosObject(tenant, doc.s3Key);
    if (!head.exists) {
      throw new KosError(
        "KOS_DOC_005",
        `S3 object missing for document ${id} (key=${doc.s3Key}). Re-upload via /upload-url.`,
        409,
      );
    }

    await prisma.kosDocument.update({
      where: { id: doc.id },
      data: { status: "PARSING", indexedAt: null },
    });

    // ── Dev-only inline-worker branch ────────────────────────────────
    // Stage-A blocker: QStash is a cloud service and cannot POST to
    // localhost:3000, so a vanilla `npm run dev` setup leaves every
    // upload stuck at PARSING. When KOS_DEV_INLINE_WORKER=true is set
    // (and we're NOT in production), run the worker in-process —
    // fire-and-forget so the BD client gets a fast 200 back, and the
    // Next dev server keeps the process alive long enough to finish.
    //
    // Production never takes this branch — the env-flag check is
    // strictly an AND with NODE_ENV !== "production".
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.KOS_DEV_INLINE_WORKER === "true"
    ) {
      const docId = doc.id;
      const tenantId = doc.tenantId;
      console.info(`[KOS] Inline worker starting for document ${docId}`);
      void runDocumentIngestion(docId, tenantId)
        .then(() => {
          console.info(`[KOS] Inline worker completed for document ${docId}`);
        })
        .catch((err) => {
          console.error(
            `[KOS] Inline worker failed for document ${docId}:`,
            err,
          );
        });
      return NextResponse.json({
        ok: true,
        documentId: docId,
        inline: true,
      });
    }

    // ── Production / default path: enqueue via QStash ───────────────
    let messageId: string | null = null;
    try {
      messageId = await scheduleKosIngestWorker(doc.id, doc.tenantId);
    } catch (err) {
      // Roll the status back so the BD client can retry. Re-throw
      // the KosError so the response carries the specific message.
      await prisma.kosDocument.update({
        where: { id: doc.id },
        data: { status: "UPLOADED" },
      });
      throw err instanceof KosError
        ? err
        : new KosError(
            "KOS_INGEST_022",
            `Failed to enqueue ingestion worker: ${
              err instanceof Error ? err.message : String(err)
            }`,
            502,
          );
    }

    return NextResponse.json({
      ok: true,
      documentId: doc.id,
      qstashMessageId: messageId,
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
