/**
 * PDF Image Extractor — pulls embedded raster images out of an architectural
 * brief PDF so they can be passed as reference images to gpt-image-1.5
 * via images.edit(). This implements the architectural rule from CLAUDE.md:
 * "if a reference image is available, pass it as a reference; never describe
 * it in text." Architectural briefs typically contain site photos, mood
 * references, and floor plan scans embedded as raster images — flattening
 * them to text loses the visual signal that produces accurate output.
 *
 * Implementation notes:
 *   - Uses unpdf's extractImages, which extracts EMBEDDED raster images from
 *     the PDF content stream. Does NOT require @napi-rs/canvas (unlike
 *     renderPageAsImage), so it deploys cleanly on Vercel without native
 *     binary configuration.
 *   - Vector-only content (CAD drawings as paths) is not captured by this
 *     extractor; that's an acceptable v1 tradeoff because most briefs put
 *     drawings in as raster scans.
 *   - Sharp converts the raw RGBA buffer to PNG (sharp is already a
 *     project dep used by sketchToRender + floor-plan-rasterizer).
 *   - Failure to extract is non-fatal: caller receives an empty array and
 *     falls back to the text-only flow.
 */

import { getDocumentProxy, extractImages } from "unpdf";

/** Minimum dimension (in pixels) for an extracted image to be considered useful.
 *  Filters out logos, page-number glyphs, and decorative bullets. */
const MIN_DIMENSION = 200;

/** Max number of pages we'll iterate through. Briefs over 50 pages are
 *  unusual; this prevents memory blow-ups on pathological inputs. */
const MAX_PAGES = 50;

/** Max number of reference images to keep after ranking. gpt-image-1.5
 *  accepts up to 16, but practical sweet spot is 3-5; more references
 *  slow the call and can confuse the model. */
const DEFAULT_TOP_N = 4;

/**
 * Extract all embedded images from every page of the PDF.
 * Returns PNG-encoded buffers, smaller-than-MIN_DIMENSION images filtered out.
 * Errors on individual pages are logged and skipped — the function never
 * throws (it's a soft-feature; text-only path must continue to work).
 */
export async function extractPdfImages(
  pdfBuffer: Buffer,
): Promise<Buffer[]> {
  const sharp = (await import("sharp")).default;
  const collected: Buffer[] = [];

  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  } catch (err) {
    console.warn("[pdf-image-extractor] Failed to load PDF document:", err);
    return [];
  }

  const numPages = Math.min(pdf.numPages, MAX_PAGES);

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    let images;
    try {
      images = await extractImages(pdf, pageNum);
    } catch (err) {
      console.warn(`[pdf-image-extractor] Page ${pageNum} extractImages failed:`, err);
      continue;
    }

    for (const img of images) {
      if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) continue;

      try {
        const png = await sharp(Buffer.from(img.data), {
          raw: {
            width: img.width,
            height: img.height,
            channels: img.channels,
          },
        })
          .png()
          .toBuffer();
        collected.push(png);
      } catch (err) {
        console.warn(`[pdf-image-extractor] Sharp encoding failed for page ${pageNum}:`, err);
      }
    }
  }

  return collected;
}

/**
 * Rank the extracted images and keep only the most useful ones.
 * Heuristic: larger pixel area = more likely a meaningful visual asset
 * (full-bleed site photo, mood reference) rather than a small inline icon.
 * Returns at most maxCount buffers, ordered by descending importance.
 */
export async function selectTopReferenceImages(
  images: Buffer[],
  maxCount: number = DEFAULT_TOP_N,
): Promise<Buffer[]> {
  if (images.length <= maxCount) return images;

  const sharp = (await import("sharp")).default;

  const scored = await Promise.all(
    images.map(async (buf) => {
      try {
        const meta = await sharp(buf).metadata();
        const area = (meta.width ?? 0) * (meta.height ?? 0);
        return { buf, score: area };
      } catch {
        return { buf, score: 0 };
      }
    }),
  );

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map((s) => s.buf);
}

/**
 * Convenience pipeline: extract → rank → upload to R2 → return URLs.
 * Returns empty array on any failure (graceful degradation: the text-only
 * brief flow continues working without references).
 */
export async function extractAndUploadBriefReferenceImages(
  pdfBuffer: Buffer,
  filenamePrefix: string = "brief-reference",
  maxCount: number = DEFAULT_TOP_N,
): Promise<string[]> {
  try {
    const all = await extractPdfImages(pdfBuffer);
    if (all.length === 0) return [];

    const selected = await selectTopReferenceImages(all, maxCount);

    const { uploadToR2, isR2Configured } = await import("@/lib/r2");
    if (!isR2Configured()) {
      // R2 not available — caller should handle this case (e.g., embed as
      // data URIs). We return empty here because images.edit() needs URLs
      // or File objects, and downloading large data URIs is unnecessary
      // when R2 is the canonical hosting.
      console.warn("[pdf-image-extractor] R2 not configured; skipping reference upload.");
      return [];
    }

    const urls: string[] = [];
    const timestamp = Date.now();
    for (let i = 0; i < selected.length; i++) {
      try {
        const result = await uploadToR2(
          selected[i],
          `${filenamePrefix}-${timestamp}-${i}.png`,
          "image/png",
        );
        if (result.success) urls.push(result.url);
      } catch (err) {
        console.warn(`[pdf-image-extractor] R2 upload ${i} failed:`, err);
      }
    }

    return urls;
  } catch (err) {
    console.warn("[pdf-image-extractor] Pipeline failed:", err);
    return [];
  }
}
