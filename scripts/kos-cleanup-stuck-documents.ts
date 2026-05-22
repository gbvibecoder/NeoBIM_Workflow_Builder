/**
 * scripts/kos-cleanup-stuck-documents.ts
 *
 * Purge stuck KOS documents (everything that didn't reach READY) for
 * a given tenant. Deletes:
 *   1. The S3 source object (best-effort — counts failures, doesn't abort)
 *   2. The KosDocumentChunk rows (cascades via the Prisma FK)
 *   3. The KosDocument row itself
 *
 * Usage:
 *   npm run kos:cleanup-stuck                  # defaults to tenant=kalzen
 *   npm run kos:cleanup-stuck -- --tenant=foo  # any other slug
 *
 * Idempotent. Safe to re-run.
 */

import { DeleteObjectCommand } from "@aws-sdk/client-s3";

// Script-only Prisma client (pg adapter — bypasses the Neon
// WebSocket adapter that fails opaquely in tsx). Import side-effect
// loads .env.local and binds globalThis.prisma; we use the named
// export directly here since no `@/lib/db` consumer is involved.
import { prismaForScripts as prisma } from "./lib/prisma-for-scripts";

import {
  getKosBucket,
  getKosS3Client,
} from "@/features/kos/services/s3-client";

// ─── CLI arg parsing ────────────────────────────────────────────────
function parseTenantArg(defaultSlug: string): string {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--tenant=(.+)$/);
    if (m) return m[1].trim();
  }
  return defaultSlug;
}

const tenantSlug = parseTenantArg("kalzen");

const STUCK_STATUSES = [
  "UPLOADED",
  "PARSING",
  "CHUNKING",
  "EMBEDDING",
  "FAILED",
] as const;

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });
  if (!tenant) {
    throw new Error(
      `[kos-cleanup-stuck] tenant slug="${tenantSlug}" not found. Did you run \`npm run seed:kos\`?`,
    );
  }

  const docs = await prisma.kosDocument.findMany({
    where: {
      tenantId: tenant.id,
      status: { in: [...STUCK_STATUSES] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      s3Key: true,
    },
  });

  if (docs.length === 0) {
    console.info(
      `[kos-cleanup-stuck] no stuck documents for tenant="${tenantSlug}". Nothing to do.`,
    );
    return;
  }

  console.info(
    `[kos-cleanup-stuck] tenant="${tenantSlug}" — found ${docs.length} stuck document(s):`,
  );
  for (const d of docs) {
    console.info(`  · ${d.id}  status=${d.status}  s3Key=${d.s3Key}  title="${d.title}"`);
  }

  // ── S3 deletes (best-effort) ─────────────────────────────────────
  const bucket = getKosBucket(tenant);
  const s3 = getKosS3Client(tenant);
  let s3Deleted = 0;
  let s3Failed = 0;
  for (const d of docs) {
    if (!d.s3Key) {
      s3Failed++; // shouldn't happen — but defensive
      continue;
    }
    try {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: d.s3Key }),
      );
      s3Deleted++;
    } catch (err) {
      s3Failed++;
      console.warn(
        `[kos-cleanup-stuck] S3 delete failed for s3://${bucket}/${d.s3Key}:`,
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      );
    }
  }

  // ── Chunk count (for the summary) ────────────────────────────────
  const chunkCount = await prisma.kosDocumentChunk.count({
    where: { documentId: { in: docs.map((d) => d.id) } },
  });

  // ── DB deletes (single transaction). Chunks cascade via FK. ───────
  const { count: docsDeleted } = await prisma.kosDocument.deleteMany({
    where: { id: { in: docs.map((d) => d.id) }, tenantId: tenant.id },
  });

  console.info(
    `[kos-cleanup-stuck] Deleted ${docsDeleted} documents, ${chunkCount} chunks, ${s3Deleted} S3 objects.` +
      (s3Failed > 0 ? ` (${s3Failed} S3 delete(s) failed — see warnings above.)` : ""),
  );
}

main()
  .catch((err) => {
    console.error("[kos-cleanup-stuck] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
