/**
 * Embedded-image extractor for Brief-to-Renders.
 *
 * Pulls raster images out of the source brief so they can be passed as
 * reference images to gpt-image-1.5 via `images.edit()` in Phase 4.
 * This implements the architectural rule from CLAUDE.md:
 *   "if a reference image is available, pass it as a reference;
 *    never describe it in text."
 *
 * Two source paths:
 *   • PDF — uses `unpdf`'s `extractImages()`. Mirrors the pattern in
 *     `src/features/ai/services/pdf-image-extractor.ts:45-91`. Vector
 *     content (CAD-as-paths) is not captured — acceptable v1 tradeoff.
 *   • DOCX — uses `mammoth`'s image conversion handler. Captures each
 *     embedded image's buffer + content type via the
 *     `mammoth.images.imgElement(...)` callback API.
 *
 * Returns the buffers in source order. Filtering / ranking / R2 upload
 * is the next stage's responsibility (`upload-reference-images.ts`).
 */

import { createRequire } from "node:module";

// `createRequire` produces a Node-native CJS require that works inside
// ESM modules. Replaces the previous `(0, eval)("require")` pattern,
// which throws `ReferenceError: require is not defined` at runtime in
// Next.js's ESM-bundled API routes. See `docx-text.ts` for full
// rationale — same fix.
const requireCjs = createRequire(import.meta.url);

/** Minimum dimension (px). Filters out logos, page-number glyphs, decorative bullets. */
const MIN_DIMENSION = 200;
/** Page cap for PDFs. Briefs > 50 pages are unusual; this prevents memory blow-ups. */
const MAX_PAGES = 50;
/** Maximum images we return. gpt-image-1.5 accepts up to 16 references; the practical sweet spot is 3-5. */
const MAX_IMAGES = 10;

export type SupportedBriefMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface EmbeddedImage {
  /** 0-based index in the order images were encountered. */
  index: number;
  /** Image MIME type (e.g. `image/png`, `image/jpeg`). */
  mimeType: string;
  /** Raw image bytes — already encoded (PNG / JPEG, not raw RGBA). */
  buffer: Buffer;
  /** Pixel width when known. PDF path always sets this; DOCX may not. */
  widthPx?: number;
  /** Pixel height when known. */
  heightPx?: number;
}

/**
 * Public entry point. Branches on MIME and delegates to the format-specific
 * implementation. Caps the result at `MAX_IMAGES`.
 *
 * Never throws — returns `[]` if extraction fails. The pipeline can run
 * fine without reference images (Claude works from text alone), so partial
 * loss here is non-fatal.
 */
export async function extractEmbeddedImages(
  buffer: Buffer | Uint8Array,
  mimeType: SupportedBriefMime,
): Promise<EmbeddedImage[]> {
  const buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  try {
    const raw =
      mimeType === "application/pdf"
        ? await extractFromPdf(buf)
        : await extractFromDocx(buf);
    return raw.slice(0, MAX_IMAGES);
  } catch {
    // Extraction is best-effort: the orchestrator can still run with
    // zero reference images. The orchestrator's stage-log summary
    // surfaces `referenceImageCount` so a 0 here is observable from
    // the persisted stageLog without us touching the global console.
    return [];
  }
}

// ─── PDF ────────────────────────────────────────────────────────────

async function extractFromPdf(buf: Buffer): Promise<EmbeddedImage[]> {
  // The override path uses our minimal `UnpdfModuleShape`; the real
  // module is wider but structurally compatible at the call sites
  // below. `as unknown as UnpdfModuleShape` is the standard test-seam
  // shape narrowing — both branches satisfy the surface we actually use.
  const unpdfMod: UnpdfModuleShape =
    _unpdfOverride ?? ((await import("unpdf")) as unknown as UnpdfModuleShape);
  const { getDocumentProxy, extractImages } = unpdfMod;
  const sharp: SharpFactory =
    _sharpOverride ?? ((await import("sharp")).default as unknown as SharpFactory);

  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch {
    // PDF load failure is non-fatal: caller gets [] and the orchestrator's
    // stageLog summary records `referenceImageCount: 0` so the absence
    // is observable without console output.
    return [];
  }

  const numPages = Math.min(pdf.numPages, MAX_PAGES);
  const collected: EmbeddedImage[] = [];
  let nextIndex = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    let images;
    try {
      images = await extractImages(pdf, pageNum);
    } catch {
      // Per-page failure is non-fatal: skip and continue.
      continue;
    }

    for (const img of images) {
      if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) continue;

      try {
        // unpdf returns RGBA-ish raw buffers. sharp re-encodes to PNG so
        // downstream consumers (R2 upload, Claude image content blocks)
        // get a real image format.
        const png = await sharp(Buffer.from(img.data), {
          raw: {
            width: img.width,
            height: img.height,
            channels: img.channels,
          },
        })
          .png()
          .toBuffer();

        collected.push({
          index: nextIndex++,
          mimeType: "image/png",
          buffer: png,
          widthPx: img.width,
          heightPx: img.height,
        });
        if (collected.length >= MAX_IMAGES) return collected;
      } catch {
        // sharp re-encode failure is non-fatal: skip this image.
      }
    }
  }

  return collected;
}

// ─── DOCX ───────────────────────────────────────────────────────────

/** Mammoth's image-element handler signature — narrowed to what we use. */
interface MammothImageElement {
  read(): Promise<Buffer>;
  contentType: string;
  /** Mammoth doesn't always populate dimensions; we treat them as optional. */
  altText?: string;
}

interface MammothImageHelper {
  imgElement(
    cb: (image: MammothImageElement) => Promise<{ src: string }>,
  ): unknown;
}

interface MammothModuleForImages {
  convertToHtml(
    input: { buffer: Buffer },
    options: { convertImage: unknown },
  ): Promise<{ value: string; messages: ReadonlyArray<unknown> }>;
  images: MammothImageHelper;
}

/** Test seam — replace the loaded mammoth module. Restore by passing `null`. */
let _mammothOverride: MammothModuleForImages | null = null;
export function _setMammothForImagesForTest(
  mod: MammothModuleForImages | null,
): void {
  _mammothOverride = mod;
}

/** Test seam — replace the unpdf module. Restore by passing `null`. */
interface UnpdfModuleShape {
  getDocumentProxy(buffer: Uint8Array): Promise<{ numPages: number }>;
  extractImages(
    pdf: { numPages: number },
    pageNum: number,
  ): Promise<
    Array<{ width: number; height: number; channels: number; data: Uint8Array }>
  >;
}
let _unpdfOverride: UnpdfModuleShape | null = null;
export function _setUnpdfForTest(mod: UnpdfModuleShape | null): void {
  _unpdfOverride = mod;
}

/** Test seam — replace sharp factory. Restore by passing `null`. */
type SharpInstanceShape = { png(): { toBuffer(): Promise<Buffer> } };
type SharpFactory = (
  input: Buffer,
  options?: { raw: { width: number; height: number; channels: number } },
) => SharpInstanceShape;
let _sharpOverride: SharpFactory | null = null;
export function _setSharpForTest(factory: SharpFactory | null): void {
  _sharpOverride = factory;
}

async function extractFromDocx(buf: Buffer): Promise<EmbeddedImage[]> {
  // ESM-compatible CJS require — see docx-text.ts for the rationale.
  // The previous `(0, eval)("require")` pattern broke under Next.js's
  // ESM bundling because modern Node.js ESM doesn't expose a global
  // `require`. `createRequire(import.meta.url)` is the canonical fix.
  let mammoth: MammothModuleForImages;
  if (_mammothOverride) {
    mammoth = _mammothOverride;
  } else {
    mammoth = requireCjs("mammoth") as MammothModuleForImages;
  }

  const collected: EmbeddedImage[] = [];
  let nextIndex = 0;

  // mammoth's imgElement callback is invoked once per embedded image.
  // We capture the buffer + content type here and return a `src` so the
  // resulting HTML body is well-formed (we discard that HTML — the
  // companion `extractDocxText` produces the canonical HTML separately).
  const convertImage = mammoth.images.imgElement(async (image) => {
    if (collected.length >= MAX_IMAGES) {
      return { src: "" };
    }
    try {
      const buffer = await image.read();
      collected.push({
        index: nextIndex++,
        mimeType: image.contentType,
        buffer,
        // mammoth doesn't expose dimensions in this callback. Leave
        // width/height undefined; the upstream uploader is fine with
        // that and we don't have a sharp introspection step here for
        // perf reasons (sharp boots a worker process per call).
      });
      // The src we return is irrelevant — we discard the HTML output.
      return { src: "" };
    } catch {
      // Per-image read failure is non-fatal: skip this image.
      return { src: "" };
    }
  });

  try {
    await mammoth.convertToHtml({ buffer: buf }, { convertImage });
  } catch {
    // mammoth convertToHtml failure is non-fatal: caller gets the partial
    // (possibly empty) result. Companion `extractDocxText` will surface
    // the underlying corruption separately if the same DOCX fails text
    // extraction, with a typed `EmptyDocxError`.
    return [];
  }

  return collected;
}
