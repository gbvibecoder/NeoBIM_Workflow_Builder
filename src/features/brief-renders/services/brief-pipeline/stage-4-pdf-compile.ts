/**
 * Stage 4 — editorial PDF compile.
 *
 * Given a job at `RUNNING + currentStage="awaiting_compile"` (or
 * `compiling` for retry), fetch every shot's image from R2, build the
 * cover + per-shot pages with jspdf, upload the result back to R2 at
 * a deterministic key, and transition the job to `COMPLETED`.
 *
 * Idempotency contract:
 *   • Deterministic R2 key (`briefs/pdfs/{jobId}.pdf`) — re-running
 *     the compile overwrites in place, never duplicates.
 *   • Status transitions use conditional `updateMany` so a concurrent
 *     cancel mid-compile is detected (count = 0) and the orchestrator
 *     returns `skipped` rather than corrupting state.
 *   • The `awaiting_compile → compiling` claim flip serialises the
 *     work — concurrent compile-worker invocations all see status =
 *     `compiling` after the first claim and either re-build (overwrite
 *     the deterministic key) or exit at the terminal flip with count=0.
 *
 * Phase 5 NEVER charges for compile (no per-call API cost). The R2
 * storage cost is amortised under the existing `briefs/` prefix.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { jsPDF } from "jspdf";

import { JobNotFoundError } from "./orchestrator";
import { isR2Configured, uploadEditorialPdfToR2 } from "@/lib/r2";
import type { BriefRenderLogger } from "./logger";
import { registerInterFont } from "./pdf-fonts";
import {
  addPageWithChrome,
  backfillPageNumbers,
  renderCoverPage,
  renderShotPage,
  type ShotImageMimeType,
} from "./pdf-layout";
import type {
  BriefSpec,
  ShotResult,
  ShotSpec,
} from "./types";

// ─── Constants ──────────────────────────────────────────────────────

const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const IMAGE_FETCH_CONCURRENCY = 4;
const PDF_VERSION = "01";

// ─── Public surface ─────────────────────────────────────────────────

export interface Stage4Args {
  jobId: string;
  logger: BriefRenderLogger;
  prisma: PrismaClient;
}

export type Stage4Result =
  | {
      status: "success";
      pdfUrl: string;
      pageCount: number;
      pdfSizeBytes: number;
      costUsd: 0;
    }
  | {
      status: "skipped";
      reason: "job_not_ready" | "missing_shots" | "already_compiled";
    }
  | { status: "failed"; error: string };

// ─── Helpers ────────────────────────────────────────────────────────

interface FetchedShotImage {
  /** Composite key `${apartmentIndex}-${shotIndexInApartment}`. */
  key: string;
  imageBase64: string;
  mimeType: ShotImageMimeType;
}

async function fetchShotImage(
  shot: ShotResult,
): Promise<FetchedShotImage | null> {
  if (!shot.imageUrl) return null;
  try {
    const res = await fetch(shot.imageUrl, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "image/png";
    const mimeType: ShotImageMimeType = ct.toLowerCase().includes("jpeg")
      ? "image/jpeg"
      : "image/png";
    return {
      key: `${shot.apartmentIndex ?? 0}-${shot.shotIndexInApartment}`,
      imageBase64: buffer.toString("base64"),
      mimeType,
    };
  } catch {
    return null;
  }
}

/**
 * Concurrency-capped image fetch. Returns a Map keyed by
 * `${apartmentIndex}-${shotIndexInApartment}`. Returns `null` when any
 * fetch fails (whole-batch atomicity — partial PDFs would be misleading
 * to the user).
 */
async function fetchAllShotImages(
  shots: ShotResult[],
): Promise<Map<string, FetchedShotImage> | null> {
  const result = new Map<string, FetchedShotImage>();
  for (let i = 0; i < shots.length; i += IMAGE_FETCH_CONCURRENCY) {
    const slice = shots.slice(i, i + IMAGE_FETCH_CONCURRENCY);
    const batch = await Promise.all(slice.map((s) => fetchShotImage(s)));
    for (const fetched of batch) {
      if (!fetched) return null;
      result.set(fetched.key, fetched);
    }
  }
  return result;
}

/**
 * Validate that the job is ready for Stage 4. Returns null when ready;
 * otherwise returns the skip reason for the orchestrator to surface.
 */
function classifyReadiness(
  status: string,
  currentStage: string | null,
  pdfUrl: string | null,
  shots: ShotResult[],
): Stage4Result | null {
  if (status === "COMPLETED" && pdfUrl) {
    return { status: "skipped", reason: "already_compiled" };
  }
  if (status !== "RUNNING") {
    return { status: "skipped", reason: "job_not_ready" };
  }
  if (currentStage !== "awaiting_compile" && currentStage !== "compiling") {
    return { status: "skipped", reason: "job_not_ready" };
  }
  if (shots.length === 0) {
    return { status: "skipped", reason: "missing_shots" };
  }
  for (const shot of shots) {
    if (shot.status !== "success" || !shot.imageUrl) {
      return { status: "skipped", reason: "missing_shots" };
    }
  }
  return null;
}

// ─── Main entry point ───────────────────────────────────────────────

export async function runStage4PdfCompile(
  args: Stage4Args,
): Promise<Stage4Result> {
  const { jobId, logger, prisma } = args;

  logger.startStage(4, "PDF Compile");

  // 1. Load job.
  const job = await prisma.briefRenderJob.findUnique({ where: { id: jobId } });
  if (!job) {
    logger.endStage(4, "failed", undefined, "job_not_found");
    throw new JobNotFoundError(jobId);
  }

  const shots = (job.shots as ShotResult[] | null) ?? [];
  const readiness = classifyReadiness(
    job.status,
    job.currentStage,
    job.pdfUrl,
    shots,
  );
  if (readiness) {
    if (readiness.status === "skipped") {
      logger.endStage(4, "success", { skipped: readiness.reason });
    }
    return readiness;
  }

  const spec = job.specResult as BriefSpec | null;
  if (!spec) {
    logger.endStage(4, "failed", undefined, "spec_missing");
    return { status: "failed", error: "specResult missing on job row" };
  }

  // 2. Claim the compile slot — atomic transition awaiting_compile →
  //    compiling. Concurrent invocations either land on `compiling`
  //    (already claimed, OK to proceed) or fail the claim and exit.
  const claim = await prisma.briefRenderJob.updateMany({
    where: { id: jobId, status: "RUNNING", currentStage: "awaiting_compile" },
    data: { currentStage: "compiling", progress: 92 },
  });
  // count: 0 is fine if another worker already claimed (currentStage =
  // compiling). Re-fetch to confirm.
  if (claim.count === 0) {
    const refetched = await prisma.briefRenderJob.findUnique({
      where: { id: jobId },
      select: { status: true, currentStage: true },
    });
    if (
      !refetched ||
      refetched.status !== "RUNNING" ||
      (refetched.currentStage !== "compiling" &&
        refetched.currentStage !== "awaiting_compile")
    ) {
      logger.endStage(4, "success", { skipped: "job_not_ready_after_claim" });
      return { status: "skipped", reason: "job_not_ready" };
    }
  }

  // 3. Fetch all shot images (concurrency-capped). Whole-batch atomic:
  //    a single failure → the whole compile fails so we never produce
  //    a half-rendered PDF.
  const images = await fetchAllShotImages(shots);
  if (!images) {
    logger.endStage(4, "failed", undefined, "image_fetch_failed");
    // Leave the job in `compiling` — Phase 6 cron / manual re-run can
    // recover. Do NOT auto-revert: another invocation may already be
    // mid-flight and we don't want to thrash.
    return {
      status: "failed",
      error: "Failed to fetch one or more shot images from R2.",
    };
  }

  // 4. Build the PDF.
  let pdfBuffer: Buffer;
  let pageCount: number;
  try {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    const fontResult = registerInterFont(doc);

    const totalShots = spec.apartments.reduce(
      (sum, a) => sum + a.shots.length,
      0,
    );

    // Page 1: cover.
    renderCoverPage(doc, {
      spec,
      totalShots,
      version: PDF_VERSION,
      fontFamily: fontResult.family,
    });

    // Pages 2..N+1: per-shot pages.
    for (
      let apartmentIndex = 0;
      apartmentIndex < spec.apartments.length;
      apartmentIndex++
    ) {
      const apartment = spec.apartments[apartmentIndex];
      const totalShotsInApartment = apartment.shots.length;
      for (
        let shotIndexInApartment = 0;
        shotIndexInApartment < totalShotsInApartment;
        shotIndexInApartment++
      ) {
        const shotSpec: ShotSpec = apartment.shots[shotIndexInApartment];
        const fetched = images.get(`${apartmentIndex}-${shotIndexInApartment}`);
        if (!fetched) {
          // Should be impossible — fetchAllShotImages returns null on any
          // miss — but defensively skip rather than crash mid-compile.
          continue;
        }
        addPageWithChrome(doc, {
          showFooter: true,
          version: PDF_VERSION,
        });
        renderShotPage(doc, {
          apartment,
          shot: shotSpec,
          shotIndexInApartment,
          totalShotsInApartment,
          imageBase64: fetched.imageBase64,
          imageMimeType: fetched.mimeType,
          version: PDF_VERSION,
          fontFamily: fontResult.family,
        });
      }
    }

    // Backfill page numbers across every page.
    backfillPageNumbers(doc);

    pageCount = doc.getNumberOfPages();
    // arraybuffer → Buffer skips the base64 round-trip and gives us the
    // exact byte size for the cap check + the upload.
    const arrayBuffer = doc.output("arraybuffer");
    pdfBuffer = Buffer.from(arrayBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown jspdf error";
    logger.endStage(4, "failed", undefined, `pdf_render_failed: ${message}`);
    return { status: "failed", error: `PDF render failed: ${message}` };
  }

  const pdfSizeBytes = pdfBuffer.length;

  // 5. Upload to R2 with deterministic key. Specific-errors rule: the
  // failure envelope from `uploadEditorialPdfToR2` already explains
  // exactly why (cap exceeded, R2 unconfigured, S3 PutObject error) —
  // pass it through to the caller and the stage log so the failure
  // banner reads as something diagnosable, never "r2_unconfigured" when
  // the real reason was a 12 MB file hitting a 5 MB cap.
  const pdfKey = `briefs-pdfs-${jobId}.pdf`;
  let uploadedUrl: string;
  try {
    if (!isR2Configured()) {
      logger.endStage(4, "failed", undefined, "r2_unconfigured");
      return {
        status: "failed",
        error:
          "R2 storage is not configured. Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY before retrying.",
      };
    }
    const upload = await uploadEditorialPdfToR2(pdfBuffer, pdfKey);
    if (!upload.success) {
      const reason = upload.error;
      logger.endStage(4, "failed", undefined, `r2_upload_failed: ${reason}`);
      return {
        status: "failed",
        error: `R2 upload failed: ${reason} (pdfSize=${(pdfSizeBytes / 1024 / 1024).toFixed(2)} MB)`,
      };
    }
    uploadedUrl = upload.url;
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.endStage(4, "failed", undefined, `r2_upload_threw: ${message}`);
    return {
      status: "failed",
      error: `R2 upload threw: ${message} (pdfSize=${(pdfSizeBytes / 1024 / 1024).toFixed(2)} MB)`,
    };
  }

  // 7. Atomic terminal flip — RUNNING + compiling → COMPLETED. The
  //    conditional where-clause means a concurrent cancel during the
  //    compile is detected (count = 0). The PDF stays in R2 under the
  //    deterministic key — Phase 6 cleanup cron sweeps orphans.
  const completed = await prisma.briefRenderJob.updateMany({
    where: { id: jobId, status: "RUNNING", currentStage: "compiling" },
    data: {
      status: "COMPLETED",
      currentStage: "completed",
      progress: 100,
      pdfUrl: uploadedUrl,
      completedAt: new Date(),
    } as Prisma.BriefRenderJobUpdateManyMutationInput,
  });
  if (completed.count === 0) {
    logger.endStage(4, "success", {
      skipped: "job_not_running_after_compile",
      pdfUrl: uploadedUrl,
    });
    return { status: "skipped", reason: "job_not_ready" };
  }

  logger.endStage(4, "success", {
    pdfUrl: uploadedUrl,
    pageCount,
    pdfSizeBytes,
  });

  return {
    status: "success",
    pdfUrl: uploadedUrl,
    pageCount,
    pdfSizeBytes,
    costUsd: 0,
  };
}
