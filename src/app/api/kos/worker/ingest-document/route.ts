/**
 * POST /api/kos/worker/ingest-document
 *
 * QStash callback for KOS document ingestion. Mirrors the brief-
 * renders worker pattern (signature-verify, 10-min max, return 200
 * on logical failures so QStash doesn't retry).
 *
 * Retry semantics:
 *   • Permanent / logical errors (PDF parse failure, OpenAI 4xx,
 *     missing tenant config) → return 200 with `{ ok: false, error }`.
 *     The orchestrator has already flipped the KosDocument to FAILED
 *     and written an audit log. BD can hit /reindex to retry.
 *   • Transient errors (S3 timeout, OpenAI 5xx after our 3 retries,
 *     network) → return 500 so QStash retries via its own delivery
 *     policy. Note: our publishJSON uses `retries: 0` by default, so
 *     the QStash project's default retry count applies (3 if not
 *     overridden). The transient classifier in `isTransientError`
 *     below decides.
 */

export const maxDuration = 600;

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifyQstashSignature } from "@/lib/qstash";
import { runDocumentIngestion } from "@/features/kos/services/document-ingestion";
import { KosError } from "@/features/kos/lib/kos-errors";

const BODY_SCHEMA = z
  .object({
    documentId: z.string().min(1),
    tenantId: z.string().min(1),
  })
  .strict();

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  // Dev escape hatch — explicit opt-in only. Hard-fail if present in
  // production. Matches the brief-renders worker's wording.
  const skipVerify = process.env.SKIP_QSTASH_SIG_VERIFY === "true";
  if (skipVerify && process.env.NODE_ENV === "production") {
    throw new Error(
      "SECURITY: SKIP_QSTASH_SIG_VERIFY must not be true in production",
    );
  }
  if (!skipVerify) {
    const valid = await verifyQstashSignature(signature, rawBody);
    if (!valid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { documentId: string; tenantId: string };
  try {
    body = BODY_SCHEMA.parse(JSON.parse(rawBody));
  } catch {
    // Bad body — QStash will retry but the next delivery will hit the
    // same parse error. 400 prevents infinite retry loops.
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    await runDocumentIngestion(body.documentId, body.tenantId);
    return NextResponse.json({
      ok: true,
      documentId: body.documentId,
    });
  } catch (err) {
    const transient = isTransientError(err);
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(
      `[kos/worker/ingest-document] documentId=${body.documentId} transient=${transient} error=${message.slice(0, 500)}`,
    );

    if (transient) {
      // Surface a 500 so QStash retries — but the row is already
      // in FAILED, which a successful retry will reset back to
      // PARSING via ingestDocument's first update.
      return NextResponse.json(
        {
          ok: false,
          documentId: body.documentId,
          transient: true,
          error: message,
        },
        { status: 500 },
      );
    }

    // Permanent — log and acknowledge so QStash doesn't retry.
    return NextResponse.json({
      ok: false,
      documentId: body.documentId,
      transient: false,
      error: message,
    });
  }
}

/**
 * Decide whether an error from `ingestDocument` is worth a QStash
 * retry. The list errs on the side of "permanent" so a corrupt PDF
 * or a misconfigured tenant doesn't bounce around the queue for
 * hours; only known-transient signals retry.
 */
function isTransientError(err: unknown): boolean {
  // Specific KosError codes that indicate "try again":
  //   KOS_S3_009/011/013 — S3 PUT/HEAD/GET failure (often transient)
  //   KOS_EMBED_001      — exhausted OpenAI retries (still might recover)
  if (err instanceof KosError) {
    return (
      err.code === "KOS_S3_009" ||
      err.code === "KOS_S3_011" ||
      err.code === "KOS_S3_013" ||
      err.code === "KOS_EMBED_001"
    );
  }
  // Network-shape errors — same heuristic as the embeddings retry path.
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}
