/**
 * PDF text extractor for the Brief-to-Renders pipeline.
 *
 * Uses `pdf-parse` via the inner-import dance from
 * `src/app/api/execute-node/handlers/tr-001.ts:51-58` — the package's
 * `index.js` runs a self-test on import that opens a missing fixture
 * file when `!module.parent`, breaking under vitest. Importing the
 * library file directly sidesteps that.
 *
 * Throws `EmptyPdfError` when the extracted text is empty (signals a
 * scanned / image-only PDF). v1 design decision per execution plan:
 * we error cleanly rather than running OCR. v2 may rasterize-and-vision.
 */

import { createRequire } from "node:module";

import { EmptyPdfError } from "../errors";

// ESM-compatible CJS require. Direct `require(...)` works in CommonJS
// or in webpack-bundled API routes, but Next.js's modern ESM bundling
// can leave it undefined at runtime. `createRequire(import.meta.url)`
// resolves modules relative to this file using Node's native loader.
const requireCjs = createRequire(import.meta.url);

interface PdfParseResult {
  text: string;
  numpages?: number;
  info?: Record<string, unknown>;
}

type PdfParseFn = (buf: Buffer) => Promise<PdfParseResult>;

/** Minimum text length (chars, post-trim) below which we treat the PDF as empty. */
const MIN_TEXT_LENGTH = 1;

/**
 * Lazy loader for `pdf-parse`. Pulled into a separate function so unit
 * tests can replace it via `vi.mock` (mocking `require()` of an
 * arbitrary path is unreliable across CJS/ESM interop boundaries — a
 * named function is a stable boundary).
 *
 * Inner-import via `pdf-parse/lib/pdf-parse.js` (not `pdf-parse`) dodges
 * the v1 self-test that opens a missing fixture file when imported as
 * the entry module. Same trick `tr-001.ts` uses.
 */
function loadPdfParse(): PdfParseFn {
  return requireCjs("pdf-parse/lib/pdf-parse.js") as PdfParseFn;
}

/** Test seam: replace the parser. Restore by passing `null`. */
let _pdfParseOverride: PdfParseFn | null = null;
export function _setPdfParseForTest(fn: PdfParseFn | null): void {
  _pdfParseOverride = fn;
}

/**
 * Extract text + page count from a PDF buffer.
 *
 * @throws {EmptyPdfError} when the PDF yields no text (image-only / scanned).
 * @throws Generic Error when `pdf-parse` itself throws (corrupt buffer).
 */
export async function extractPdfText(
  pdfBuffer: Buffer | Uint8Array,
): Promise<{ text: string; pageCount: number }> {
  const pdfParse: PdfParseFn = _pdfParseOverride ?? loadPdfParse();

  const buf = pdfBuffer instanceof Buffer ? pdfBuffer : Buffer.from(pdfBuffer);
  const result = await pdfParse(buf);

  const text = (result.text ?? "").toString();
  const pageCount = typeof result.numpages === "number" ? result.numpages : 0;

  if (text.trim().length < MIN_TEXT_LENGTH) {
    throw new EmptyPdfError(
      `PDF yielded no text (pages=${pageCount}, charCount=${text.length}). ` +
        `Likely a scanned/image-only document.`,
    );
  }

  return { text, pageCount };
}
