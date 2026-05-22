/**
 * KOS-local QStash scheduler.
 *
 * Lives in `features/kos/` so we don't have to mutate
 * `src/lib/qstash.ts` for every new KOS worker (Week 2 rule: KOS code
 * stays in KOS). Re-uses the same Upstash QStash client + tokens that
 * BuildFlow uses — the QStash project is one per Vercel project, not
 * one per feature.
 *
 * Pattern matches `scheduleBriefRenderWorker` from `src/lib/qstash.ts`:
 *   • retries: 0 — the ingestion worker owns its own
 *     idempotent retries (status flips), and QStash re-delivery on a
 *     non-transient error would duplicate work.
 *   • timeout: 10m — the 50 MB PDF cap × ~50k embeddings tokens
 *     comfortably fits in 10 minutes.
 */

import { Client } from "@upstash/qstash";

import { KosError } from "@/features/kos/lib/kos-errors";

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new KosError(
      "KOS_INGEST_020",
      "QSTASH_TOKEN is not set — cannot enqueue KOS ingestion jobs. Set it in .env.local (development) or the Vercel project (production).",
      500,
    );
  }
  _client = new Client({ token });
  return _client;
}

function resolveAppUrl(): string {
  // Mirrors the existing src/lib/qstash.ts fallback: prod = vercel
  // env, dev = localhost. QStash can only reach internet-routable
  // URLs, so localhost callbacks require `npx vercel dev --listen`
  // or an ngrok tunnel — same constraint as the rest of BuildFlow.
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * Enqueue an ingest job for a single KosDocument. Returns the QStash
 * message id so the caller can persist it on the KosProcessingJob row
 * (Week 3 will add that table; for now the message id round-trips
 * back via the worker's signed request body).
 *
 * The `tenantId` is plumbed through to the worker so the new
 * `runDocumentIngestion` cross-tenant assertion can fire — that's
 * defence-in-depth: the worker no longer has to trust that the
 * documentId alone identifies the right tenant.
 */
export async function scheduleKosIngestWorker(
  documentId: string,
  tenantId: string,
): Promise<string> {
  if (!documentId || !tenantId) {
    throw new KosError(
      "KOS_INGEST_021",
      `scheduleKosIngestWorker requires both documentId and tenantId (got documentId="${documentId}", tenantId="${tenantId}").`,
      500,
    );
  }
  const client = getClient();
  const workerUrl = `${resolveAppUrl()}/api/kos/worker/ingest-document`;
  const result = await client.publishJSON({
    url: workerUrl,
    body: { documentId, tenantId },
    retries: 0,
    timeout: "10m",
  });
  return result.messageId;
}
