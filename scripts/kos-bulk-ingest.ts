/**
 * scripts/kos-bulk-ingest.ts
 *
 * Bulk PDF ingestion for KOS. Reuses the EXACT Stage-A pipeline the BD
 * console upload flow uses (S3 upload → parse → chunk → embed → halfvec
 * insert) but skips the two-step presigned-URL dance and the per-file
 * UI clicks, so a 26-file pack ingests in one command.
 *
 *   npm run kos:bulk-ingest -- --tenant=kalzen --folder=/abs/path/to/pdfs
 *   npm run kos:bulk-ingest -- --tenant=kalzen --folder=/abs/path --dry-run
 *   npm run kos:bulk-ingest -- --tenant=kalzen --folder=/abs/path --concurrency=4
 *
 * SOURCE ATTRIBUTION (no schema change):
 *   KosDocument has no `metadata` column, and the bot's retrieval tool
 *   result surfaces ONLY the document `title` (not docType, not chunk
 *   metadata) as a source-bearing field. So we carry provenance in the
 *   title itself: `"<SourceLabel> — <originalFilename>"` (e.g.
 *   "Dincel — codemark-certificate...pdf"). This makes EVERY doc
 *   attributable — including the ~7 files whose raw filename never says
 *   "Dincel" (report_by_grove…, elsevier…, FAS…, CV071106…). Retrieval
 *   ranking is unaffected: it scores chunk-content embeddings, not the
 *   title. See kos_dincel_ingestion_report.md for the full rationale.
 *
 * IMPORTANT IMPORT ORDER:
 *   `./lib/prisma-for-scripts` MUST be imported BEFORE any `@/features`
 *   import. It has a side effect — it sets `globalThis.prisma` to a
 *   pg-backed client so `@/lib/db` (pulled in transitively by
 *   document-ingestion / s3-client) adopts it instead of building a
 *   fresh Neon-WebSocket client (which fails opaquely under tsx). ESM
 *   evaluates imports in declaration order; do not let an auto-sorter
 *   hoist the `@/` imports above this line.
 */

// 1. Side-effect import: env load + globalThis.prisma assignment.
import { prismaForScripts } from "./lib/prisma-for-scripts";

// 2. Now safe to pull in the app-layer KOS services.
import {
  uploadKosObject,
  kosS3Key,
} from "@/features/kos/services/s3-client";
import { runDocumentIngestion } from "@/features/kos/services/document-ingestion";

// 3. Local pure helper.
import { categorizeDincelDoc } from "./lib/dincel-categorize";

import fs from "node:fs";
import path from "node:path";
import type { KosDocType, Tenant } from "@prisma/client";

// ─── CLI arg parsing ────────────────────────────────────────────────
function parseArg(flag: string): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1).trim();
  }
  return null;
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

const tenantSlug = parseArg("--tenant");
const folder = parseArg("--folder");
const sourceTag = (parseArg("--source") ?? "dincel").trim();
const dryRun = hasFlag("--dry-run");
const concurrencyRaw = parseArg("--concurrency");
const concurrency = Math.max(1, Math.min(8, Number(concurrencyRaw ?? 3) || 3));

const LOG = "[kos-bulk-ingest]";

function usage(): never {
  console.error(
    `${LOG} Usage:\n` +
      `  npm run kos:bulk-ingest -- --tenant=<slug> --folder=<absolute-path> ` +
      `[--source=dincel] [--concurrency=3] [--dry-run]`,
  );
  process.exit(1);
}

if (!tenantSlug) {
  console.error(`${LOG} --tenant=<slug> is required.`);
  usage();
}
if (!folder) {
  console.error(`${LOG} --folder=<absolute-path> is required.`);
  usage();
}

/** "dincel" → "Dincel". The title prefix the bot reads for attribution. */
const sourceLabel =
  sourceTag.length > 0
    ? sourceTag.charAt(0).toUpperCase() + sourceTag.slice(1)
    : "Source";

/** Stored title format. Idempotency keys on this exact string. */
function buildTitle(filename: string): string {
  return `${sourceLabel} — ${filename}`;
}

interface FilePlan {
  filename: string;
  absPath: string;
  sizeBytes: number;
  docType: KosDocType;
  title: string;
}

interface FileResult {
  filename: string;
  docType: KosDocType;
  outcome: "skipped" | "ingested" | "failed";
  chunkCount: number;
  error?: string;
}

// ─── Promise pool (bounded concurrency) ─────────────────────────────
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function lane(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, lane);
  await Promise.all(lanes);
  return results;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  // ── Resolve + validate the folder ──────────────────────────────
  const folderAbs = path.resolve(folder!);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(folderAbs);
  } catch {
    throw new Error(`${LOG} Folder not found: ${folderAbs}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${LOG} --folder is not a directory: ${folderAbs}`);
  }

  // top-level *.pdf only (recursive=false), deterministic order
  const pdfFiles = fs
    .readdirSync(folderAbs)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b));

  if (pdfFiles.length === 0) {
    throw new Error(`${LOG} No *.pdf files found in ${folderAbs}`);
  }

  // ── Build the per-file plan (categorisation happens here) ──────
  const plans: FilePlan[] = pdfFiles.map((filename) => {
    const absPath = path.join(folderAbs, filename);
    const sizeBytes = fs.statSync(absPath).size;
    const { docType } = categorizeDincelDoc(filename);
    return { filename, absPath, sizeBytes, docType, title: buildTitle(filename) };
  });

  console.info(
    `${LOG} folder=${folderAbs}\n${LOG} tenant=${tenantSlug} source="${sourceTag}" ` +
      `concurrency=${concurrency} dryRun=${dryRun}\n${LOG} found ${plans.length} PDF(s)`,
  );

  // ── Categorisation breakdown (printed in every mode) ───────────
  const breakdown: Record<string, number> = {};
  for (const p of plans) breakdown[p.docType] = (breakdown[p.docType] ?? 0) + 1;

  // ── DRY RUN — list + categorise, no DB, no S3 ──────────────────
  if (dryRun) {
    console.info(`\n${LOG} DRY RUN — no uploads, no DB writes\n`);
    for (const p of plans) {
      console.info(
        `  ${p.docType.padEnd(11)} ${humanSize(p.sizeBytes).padStart(8)}  ` +
          `${p.filename}\n${" ".repeat(24)}→ title: "${p.title}"`,
      );
    }
    printBreakdown(breakdown);
    console.info(
      `\n${LOG} dry-run complete — re-run without --dry-run to ingest.`,
    );
    return;
  }

  // ── Resolve tenant ─────────────────────────────────────────────
  const tenant = await prismaForScripts.tenant.findUnique({
    where: { slug: tenantSlug! },
  });
  if (!tenant) {
    throw new Error(
      `${LOG} tenant slug="${tenantSlug}" not found. Run \`npm run seed:kos\` first.`,
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      `${LOG} OPENAI_API_KEY is not set in .env.local — embedding will fail. Aborting before any upload.`,
    );
  }

  // ── Ingest with bounded concurrency ────────────────────────────
  const results = await runPool<FilePlan, FileResult>(
    plans,
    concurrency,
    (plan) => ingestOne(tenant, plan),
  );

  // ── Summary ────────────────────────────────────────────────────
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const ingested = results.filter((r) => r.outcome === "ingested").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const totalEmbeddings = results.reduce((s, r) => s + r.chunkCount, 0);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.info(`\n${LOG} processed: ${results.length} files`);
  console.info(`${LOG}   skipped (already ingested): ${skipped}`);
  console.info(`${LOG}   uploaded + ingested: ${ingested}`);
  console.info(`${LOG}   failed: ${failed}`);
  printBreakdown(breakdown);
  console.info(`${LOG} total embeddings created: ${totalEmbeddings}`);
  console.info(`${LOG} elapsed: ${elapsedSec}s`);

  if (failed > 0) {
    console.info(`\n${LOG} FAILED files (left in FAILED status — retry via BD /reindex):`);
    for (const r of results.filter((x) => x.outcome === "failed")) {
      console.info(`  ✗ ${r.filename} — ${r.error}`);
    }
    process.exitCode = 1;
  }
}

function printBreakdown(breakdown: Record<string, number>): void {
  console.info(`${LOG} categorization breakdown:`);
  for (const docType of Object.keys(breakdown).sort()) {
    console.info(`  ${docType}: ${breakdown[docType]}`);
  }
}

/**
 * Ingest a single file. Mirrors the BD upload-url → confirm-upload flow:
 * create row → set s3Key → upload to S3 → runDocumentIngestion (which
 * drives PARSING → CHUNKING → EMBEDDING → READY and flips to FAILED on
 * error). Each call is independently try/caught so one bad PDF can't
 * abort the batch.
 */
async function ingestOne(
  tenant: Tenant,
  plan: FilePlan,
): Promise<FileResult> {
  const { filename, absPath, docType, title } = plan;
  const tag = `${LOG} [${filename}]`;

  try {
    // ── Idempotency: match on tenantId + title ───────────────────
    const existing = await prismaForScripts.kosDocument.findMany({
      where: { tenantId: tenant.id, title },
      select: { id: true, status: true, s3Key: true },
      orderBy: { createdAt: "desc" },
    });

    const ready = existing.find((d) => d.status === "READY");
    if (ready) {
      console.info(`${tag} SKIP (already ingested, READY) docType=${docType}`);
      return { filename, docType, outcome: "skipped", chunkCount: 0 };
    }
    // An in-flight row (PARSING/CHUNKING/EMBEDDING) means another run is
    // working it — don't double-ingest.
    const inFlight = existing.find((d) =>
      ["PARSING", "CHUNKING", "EMBEDDING"].includes(d.status),
    );
    if (inFlight) {
      console.info(`${tag} SKIP (in-flight, status=${inFlight.status})`);
      return { filename, docType, outcome: "skipped", chunkCount: 0 };
    }

    // Reuse a prior FAILED/UPLOADED row if present (retry), else create.
    const retryRow = existing.find((d) =>
      ["FAILED", "UPLOADED"].includes(d.status),
    );

    const buffer = fs.readFileSync(absPath);

    let documentId: string;
    let s3Key: string;
    if (retryRow) {
      documentId = retryRow.id;
      s3Key =
        retryRow.s3Key && retryRow.s3Key.length > 0
          ? retryRow.s3Key
          : kosS3Key(tenant, "documents", documentId, "source.pdf");
      console.info(`${tag} RETRY existing row id=${documentId} (was ${retryRow.status})`);
      await prismaForScripts.kosDocument.update({
        where: { id: documentId },
        data: { docType, s3Key, mimeType: "application/pdf", status: "UPLOADED" },
      });
    } else {
      const created = await prismaForScripts.kosDocument.create({
        data: {
          tenantId: tenant.id,
          title,
          docType,
          s3Key: "", // filled once we know the id
          mimeType: "application/pdf",
          status: "UPLOADED",
          // No BD user attribution for a script run — use the seed
          // convention. KosDocument.uploadedBy is a required String.
          uploadedBy: "system",
          version: 1,
        },
        select: { id: true },
      });
      documentId = created.id;
      s3Key = kosS3Key(tenant, "documents", documentId, "source.pdf");
      await prismaForScripts.kosDocument.update({
        where: { id: documentId },
        data: { s3Key },
      });
    }

    // ── Upload source PDF to S3 ──────────────────────────────────
    console.info(
      `${tag} uploading ${humanSize(buffer.byteLength)} → s3://…/${s3Key}`,
    );
    await uploadKosObject(tenant, s3Key, buffer, "application/pdf");

    // ── Run the real pipeline (parse → chunk → embed → halfvec) ──
    console.info(`${tag} ingesting (docType=${docType})…`);
    await runDocumentIngestion(documentId, tenant.id);

    // runDocumentIngestion returns void; count chunks for the summary.
    const chunkCount = await prismaForScripts.kosDocumentChunk.count({
      where: { documentId },
    });

    console.info(`${tag} READY ✓ (${chunkCount} chunks)`);
    return { filename, docType, outcome: "ingested", chunkCount };
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`${tag} FAILED — ${message}`);
    return { filename, docType, outcome: "failed", chunkCount: 0, error: message };
  }
}

main()
  .catch((err) => {
    console.error(`${LOG} fatal:`, err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prismaForScripts.$disconnect();
    } catch {
      // exiting anyway
    }
  });
