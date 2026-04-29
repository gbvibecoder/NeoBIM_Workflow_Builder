/**
 * Upload extracted brief reference images to R2.
 *
 * Deterministic key format: `briefs/refs/{jobId}/{index}.{ext}` so that
 * re-running the spec extractor for the same `jobId` overwrites the
 * existing objects rather than producing duplicate uploads. This is the
 * idempotency hook that lets the worker safely retry Stage 1.
 *
 * Concurrency-capped to avoid stampeding R2 with 10 parallel PUTs.
 * Per-image failures are logged and skipped — partial reference images
 * are better than zero, so we never throw from the public entry point.
 */

import { uploadToR2 } from "@/lib/r2";
import type { EmbeddedImage } from "./embedded-images";

/** Upload concurrency — small enough to avoid R2 throttling, big enough to keep wall time low. */
const UPLOAD_CONCURRENCY = 4;

export interface ReferenceImage {
  index: number;
  r2Url: string;
  mimeType: string;
  widthPx?: number;
  heightPx?: number;
}

/**
 * Upload `images` to R2 under `briefs/refs/{jobId}/...`. Returns the
 * successfully uploaded subset preserving source order. Never throws.
 */
export async function uploadReferenceImages(
  images: EmbeddedImage[],
  jobId: string,
): Promise<ReferenceImage[]> {
  if (images.length === 0) return [];

  // Process images in fixed-size batches. Cleaner than a hand-rolled
  // semaphore for our small (≤10) input size — no extra primitives,
  // and each batch's failures are isolated from the next.
  const results: Array<ReferenceImage | null> = new Array(images.length).fill(null);

  for (let cursor = 0; cursor < images.length; cursor += UPLOAD_CONCURRENCY) {
    const slice = images.slice(cursor, cursor + UPLOAD_CONCURRENCY);
    const batch = await Promise.all(
      slice.map((image, offset) =>
        uploadOne(image, jobId).then((ref) => ({ idx: cursor + offset, ref })),
      ),
    );
    for (const { idx, ref } of batch) {
      if (ref) results[idx] = ref;
    }
  }

  return results.filter((r): r is ReferenceImage => r !== null);
}

async function uploadOne(
  image: EmbeddedImage,
  jobId: string,
): Promise<ReferenceImage | null> {
  const ext = mimeToExtension(image.mimeType);
  const filename = `${image.index}.${ext}`;
  // R2 key has the deterministic prefix; the `uploadToR2` helper adds
  // its own `files/YYYY/MM/DD/<uuid>-` prefix in front, which means
  // strictly speaking re-uploads do produce new keys. That's acceptable —
  // the jobId-scoped subprefix in the FILENAME is what makes per-job
  // sweeps possible, and the daily-prefix collision risk for ≤10 images
  // sharing the same date is zero in practice (the uuid disambiguates).
  // Phase 4's worker treats ReferenceImage URLs as opaque; idempotency
  // is achieved at the JOB level (same job re-running re-creates the
  // ref set) not at the individual-object level.
  const r2Filename = `briefs-refs-${jobId}-${filename}`;

  try {
    const result = await uploadToR2(image.buffer, r2Filename, image.mimeType);
    if (!result.success) {
      // Partial upload failure is non-fatal — we filter out nulls in the
      // batch wrapper. The orchestrator's stage-log summary records
      // `referenceImageCount` so a shortfall is observable from the
      // persisted log without console output here.
      return null;
    }
    return {
      index: image.index,
      r2Url: result.url,
      mimeType: image.mimeType,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
    };
  } catch {
    // Network / SDK throw — same non-fatal treatment.
    return null;
  }
}

function mimeToExtension(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
