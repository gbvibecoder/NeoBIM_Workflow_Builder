/**
 * scripts/kos-bim-test-ingest.ts
 *
 * Week 5A test driver for the KOS BIM (Autodesk APS) ingestion pipeline.
 * Walks the local Dincel/Kalzen family package, categorises each file, and
 * runs the FULL end-to-end pipeline (KOS S3 → APS upload → translate →
 * poll → metadata → derive SKU rows) for up to --limit files.
 *
 * This is the 5A *verification* phase: prove the pipeline works on 5 sample
 * files using FREE APS credits. Bulk ingestion of all 77 files is 5B.
 *
 *   # list + categorise only, no uploads, no APS calls:
 *   npm run kos:bim-test-ingest -- --tenant=kalzen --dry-run
 *
 *   # real 5-file run:
 *   npm run kos:bim-test-ingest -- --tenant=kalzen --limit=5
 *
 *   # target a subset, re-ingest even if already done:
 *   npm run kos:bim-test-ingest -- --tenant=kalzen --filter="Profile_DIN-200P-*" --force
 *
 * IMPORT ORDER (critical): `./lib/prisma-for-scripts` MUST be first — its
 * side effect points `@/lib/db` at a pg-backed client so the orchestrator's
 * `prisma` works under tsx (the Neon WebSocket adapter fails opaquely
 * there). Do not let an auto-sorter hoist the `@/` imports above it.
 */

// 1. Side-effect import: env load + globalThis.prisma assignment.
import { prismaForScripts } from "./lib/prisma-for-scripts";

// 2. App-layer KOS services (safe now that globalThis.prisma is set).
import {
  ingestSingleFamily,
  type IngestSingleFamilyResult,
} from "@/features/kos/services/kos-bim-ingestion";
import { ensureApsBucketExists } from "@/features/kos/services/aps-bucket";
import {
  detectCategoryFromFolder,
  extractSkuFromFilename,
  fileExtension,
  isSupportedBimExtension,
} from "@/features/kos/lib/kos-bim-naming";
import {
  KOS_BIM_LOCAL_PACKAGE_PATH,
  KOS_BIM_TEST_FILE_LIMIT,
} from "@/features/kos/lib/kos-bim-constants";

import fs from "node:fs";
import path from "node:path";
import type { KosBimFamilyCategory } from "@prisma/client";

const LOG = "[kos-bim-test-ingest]";

// ─── CLI arg parsing ─────────────────────────────────────────────────────
function parseArg(flag: string): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1).trim();
  }
  return null;
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

const tenantSlug = parseArg("--tenant") ?? "kalzen";
const packageRoot = path.resolve(
  parseArg("--path") ?? KOS_BIM_LOCAL_PACKAGE_PATH,
);
const limit = (() => {
  const raw = parseArg("--limit");
  if (raw === null) return KOS_BIM_TEST_FILE_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : KOS_BIM_TEST_FILE_LIMIT;
})();
const concurrency = (() => {
  const raw = parseArg("--concurrency");
  const n = Number(raw ?? 1);
  return Math.max(1, Math.min(4, Number.isFinite(n) ? Math.floor(n) : 1));
})();
const dryRun = hasFlag("--dry-run");
const force = hasFlag("--force");
const filterGlob = parseArg("--filter");

// ─── helpers ─────────────────────────────────────────────────────────────

interface FilePlan {
  filePath: string;
  filename: string;
  sourceFolder: string | null;
  sizeBytes: number;
  category: KosBimFamilyCategory;
  sku: string;
}

/** Recursively collect supported BIM files under `dir`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (isSupportedBimExtension(fileExtension(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Compile a shell-style glob (* and ?) into a filename-matching RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Top-level subfolder relative to the package root, or null if at root. */
function sourceFolderOf(filePath: string): string | null {
  const rel = path.relative(packageRoot, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : null;
}

// ─── bounded promise pool ────────────────────────────────────────────────
async function runPool<T, R>(
  items: T[],
  poolLimit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function lane(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(poolLimit, items.length) }, lane),
  );
  return results;
}

// ─── main ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const startedAt = Date.now();

  // ── Validate APS credentials early (dry-run is exempt) ─────────────
  if (!dryRun) {
    const missing: string[] = [];
    if (!process.env.APS_CLIENT_ID) missing.push("APS_CLIENT_ID");
    if (!process.env.APS_CLIENT_SECRET) missing.push("APS_CLIENT_SECRET");
    if (missing.length > 0) {
      console.error(
        `${LOG} Missing env var(s): ${missing.join(", ")}.\n` +
          `${LOG} Create a Server-to-Server app at https://aps.autodesk.com,\n` +
          `${LOG} then add APS_CLIENT_ID + APS_CLIENT_SECRET (and APS_BUCKET_KEY)\n` +
          `${LOG} to .env.local. Re-run with --dry-run to test categorisation\n` +
          `${LOG} without credentials.`,
      );
      process.exit(1);
    }
  }

  // ── Validate the package folder ────────────────────────────────────
  let stat: fs.Stats;
  try {
    stat = fs.statSync(packageRoot);
  } catch {
    console.error(`${LOG} package path not found: ${packageRoot}`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`${LOG} --path is not a directory: ${packageRoot}`);
    process.exit(1);
  }

  // ── Collect + plan files ───────────────────────────────────────────
  let files = walk(packageRoot).sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b)),
  );

  if (filterGlob) {
    const re = globToRegExp(filterGlob);
    files = files.filter((f) => re.test(path.basename(f)));
  }

  const totalMatched = files.length;
  files = files.slice(0, limit);

  if (files.length === 0) {
    console.error(
      `${LOG} no supported BIM files matched under ${packageRoot}` +
        (filterGlob ? ` with --filter="${filterGlob}"` : "") +
        `. Supported extensions: .rfa .dwg .rvt .ifc`,
    );
    process.exit(1);
  }

  const plans: FilePlan[] = files.map((filePath) => {
    const filename = path.basename(filePath);
    const sourceFolder = sourceFolderOf(filePath);
    return {
      filePath,
      filename,
      sourceFolder,
      sizeBytes: fs.statSync(filePath).size,
      category: detectCategoryFromFolder(sourceFolder, filename),
      sku: extractSkuFromFilename(filename),
    };
  });

  console.info(
    `${LOG} package=${packageRoot}\n` +
      `${LOG} tenant=${tenantSlug} limit=${limit} concurrency=${concurrency} ` +
      `dryRun=${dryRun} force=${force}` +
      (filterGlob ? ` filter="${filterGlob}"` : "") +
      `\n${LOG} matched ${totalMatched} file(s); processing ${plans.length}.`,
  );

  // ── Categorisation summary (every mode) ────────────────────────────
  const breakdown: Record<KosBimFamilyCategory, number> = {
    PANEL: 0,
    ACCESSORY: 0,
    ASSEMBLY: 0,
    REFERENCE: 0,
    OTHER: 0,
  };
  for (const p of plans) breakdown[p.category]++;

  console.info(`\n${LOG} files to process:`);
  for (const p of plans) {
    console.info(
      `  ${p.category.padEnd(9)} ${humanSize(p.sizeBytes).padStart(8)}  ` +
        `${(p.sourceFolder ?? "<root>").padEnd(11)} ${p.filename}\n` +
        `${" ".repeat(24)}→ sku: ${p.sku}`,
    );
  }

  // ── DRY RUN — categorise only, exit ────────────────────────────────
  if (dryRun) {
    printBreakdown(breakdown);
    console.info(
      `\n${LOG} DRY RUN — no S3 uploads, no APS calls, no DB writes.\n` +
        `${LOG} Re-run without --dry-run to ingest.`,
    );
    return;
  }

  // ── Resolve tenant ─────────────────────────────────────────────────
  const tenant = await prismaForScripts.tenant.findUnique({
    where: { slug: tenantSlug },
  });
  if (!tenant) {
    console.error(
      `${LOG} tenant slug="${tenantSlug}" not found. Run \`npm run seed:kos\` first.`,
    );
    process.exit(1);
  }

  // ── Ensure the APS bucket exists before any file ───────────────────
  console.info(`\n${LOG} ensuring APS bucket exists…`);
  await ensureApsBucketExists();

  // ── Ingest ─────────────────────────────────────────────────────────
  const results = await runPool<FilePlan, IngestSingleFamilyResult>(
    plans,
    concurrency,
    async (plan) => {
      console.info(
        `\n${LOG} ${plan.filename} category=${plan.category} size=${humanSize(plan.sizeBytes)}`,
      );
      const result = await ingestSingleFamily({
        tenantId: tenant.id,
        filePath: plan.filePath,
        sourceFolder: plan.sourceFolder,
        packageRoot,
        force,
      });
      console.info(
        `${LOG} ${plan.filename} → status=${result.status} ` +
          `duration=${(result.durationMs / 1000).toFixed(1)}s ` +
          `credits=~${result.creditsEstimated}` +
          (result.error ? ` error="${result.error}"` : ""),
      );
      return result;
    },
  );

  // ── Summary ────────────────────────────────────────────────────────
  const ready = results.filter((r) => r.status === "READY").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  const skipped = results.filter(
    (r) => r.status === "SKIPPED_ALREADY_INGESTED",
  ).length;
  const totalCredits = results.reduce((s, r) => s + r.creditsEstimated, 0);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.info(`\n${LOG} processed: ${results.length}`);
  console.info(`${LOG}   READY: ${ready}`);
  console.info(`${LOG}   FAILED: ${failed}`);
  console.info(`${LOG}   SKIPPED: ${skipped} (already ingested)`);
  printBreakdown(breakdown);
  console.info(`${LOG} total APS credits estimated: ~${totalCredits}`);
  console.info(`${LOG} total duration: ${elapsedSec} seconds`);

  if (failed > 0) {
    console.info(`\n${LOG} FAILED files (left in FAILED status — re-run to retry):`);
    results.forEach((r, i) => {
      if (r.status === "FAILED") {
        console.info(`  ✗ ${plans[i].filename} — ${r.error ?? "unknown error"}`);
      }
    });
    process.exitCode = 1;
  }
}

function printBreakdown(breakdown: Record<KosBimFamilyCategory, number>): void {
  console.info(`${LOG} categorization breakdown:`);
  console.info(`  PANEL: ${breakdown.PANEL}`);
  console.info(`  ACCESSORY: ${breakdown.ACCESSORY}`);
  console.info(`  ASSEMBLY: ${breakdown.ASSEMBLY}`);
  console.info(`  REFERENCE: ${breakdown.REFERENCE}`);
  console.info(`  OTHER: ${breakdown.OTHER}`);
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
