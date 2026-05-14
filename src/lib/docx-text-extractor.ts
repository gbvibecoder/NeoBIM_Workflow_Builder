/**
 * DOCX text extractor — cross-cutting utility.
 *
 * BACKGROUND
 * ----------
 * IN-002's upload picker accepts BOTH `.pdf` and `.docx`, but the
 * TR-001 Brief Parser only ever ran the uploaded bytes through the
 * PDF extractor chain (`pdf-text-extractor.ts`). A DOCX is a ZIP
 * container, not a PDF — so every PDF layer failed with errors like
 * `InvalidPDFException: Invalid PDF structure` and the user got a
 * "Could not read PDF" wall even though the file was a perfectly
 * valid Word document. This module is the missing DOCX branch.
 *
 * CONTRACT
 * --------
 * - Never throws. Errors are captured in `result.errors` so callers
 *   (TR-001) can surface a specific failure mode to the UI instead of
 *   letting a parse failure cascade into hallucinated data — the same
 *   discipline `pdf-text-extractor.ts` enforces.
 * - Returns `{ text: "", source: "failed", errors }` when mammoth
 *   throws, the buffer is empty/oversized, or the extracted text is
 *   too short to be a real brief.
 *
 * RELATION TO THE BRIEF-RENDERS EXTRACTOR
 * ---------------------------------------
 * `src/features/brief-renders/services/brief-pipeline/extractors/docx-text.ts`
 * is a SEPARATE, deliberately-different extractor: it preserves table
 * structure as HTML (load-bearing for that pipeline's apartment/shot
 * tables) and THROWS `EmptyDocxError`. This module is text-only and
 * never-throws — the shape the canvas brief-parser path needs. The
 * only genuinely shared code is the one-line `mammoth` invocation; the
 * two contracts diverge enough that consolidating them would force one
 * caller to carry the other's shape.
 */

import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

/** Below this, the extracted text is treated as "not a real brief". */
const MIN_USEFUL_TEXT_CHARS = 50;
/** Mirror the 30 MB cap `pdf-text-extractor.ts` uses. */
const MAX_DOCX_BYTES = 30 * 1024 * 1024;

// `createRequire` produces a Node-native CJS require that works inside
// ESM modules. Next.js's ESM-bundled API routes do NOT expose a global
// `require`, and Webpack/Turbopack don't statically analyse
// `createRequire(...)` calls — so `mammoth` stays a runtime resolution
// and never breaks a type-check / build on a tree without it installed.
// (Same rationale as the brief-renders docx extractor.)
const requireCjs = createRequire(import.meta.url);

/** Minimal mammoth surface we use. Fields match the public API. */
interface MammothResult {
  value: string;
  messages: ReadonlyArray<{ type: string; message: string }>;
}
interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}

let _cachedMammoth: MammothModule | null = null;

function loadMammoth(): MammothModule {
  if (_cachedMammoth) return _cachedMammoth;
  _cachedMammoth = requireCjs("mammoth") as MammothModule;
  return _cachedMammoth;
}

/** Test seam — replace the loaded mammoth module. Restore by passing `null`. */
let _mammothOverride: MammothModule | null = null;
export function _setMammothForTest(mod: MammothModule | null): void {
  _mammothOverride = mod;
  _cachedMammoth = null;
}

export type DocxExtractSource = "mammoth" | "failed";

export interface DocxExtractResult {
  /** Full extracted text. Empty string when `source === "failed"`. */
  text: string;
  /** Which path produced the text. */
  source: DocxExtractSource;
  /** Error capture — populated when extraction failed. */
  errors: { mammoth?: string };
  /** Extraction latency in ms. */
  latencyMs: { mammoth?: number };
}

/**
 * Magic-byte sniff: is this buffer a ZIP/OOXML container (i.e. a DOCX)?
 *
 * A DOCX is a ZIP archive — its first four bytes are the ZIP local file
 * header signature `PK\x03\x04` (`50 4B 03 04`). Magic bytes are the
 * authoritative format check: a client-supplied `mimeType` / filename
 * can be missing or wrong, the bytes cannot.
 *
 * NOTE: this also matches `.xlsx` / `.pptx` and plain `.zip` — that's
 * acceptable for the IN-002 path, whose picker already restricts the
 * file extension to `.pdf,.docx` client-side. The downstream mammoth
 * call will fail cleanly (captured in `errors`) for a non-DOCX zip.
 */
export function isDocxBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 && // P
    buf[1] === 0x4b && // K
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

/**
 * Extract raw text from a DOCX buffer. Never throws — see file header.
 */
export async function extractTextFromDocx(
  docxBuffer: Buffer | Uint8Array,
): Promise<DocxExtractResult> {
  const buf =
    docxBuffer instanceof Buffer ? docxBuffer : Buffer.from(docxBuffer);

  if (buf.length === 0) {
    return {
      text: "",
      source: "failed",
      errors: { mammoth: "Empty DOCX buffer." },
      latencyMs: {},
    };
  }
  if (buf.length > MAX_DOCX_BYTES) {
    return {
      text: "",
      source: "failed",
      errors: {
        mammoth: `DOCX exceeds the ${MAX_DOCX_BYTES}-byte cap (${buf.length} bytes).`,
      },
      latencyMs: {},
    };
  }

  const start = Date.now();
  try {
    const mammoth = _mammothOverride ?? loadMammoth();
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = (result.value ?? "").trim();
    const latencyMs = { mammoth: Date.now() - start };

    if (text.length < MIN_USEFUL_TEXT_CHARS) {
      return {
        text: "",
        source: "failed",
        errors: {
          mammoth:
            `Extracted only ${text.length} characters ` +
            `(minimum ${MIN_USEFUL_TEXT_CHARS}). The DOCX may be empty, ` +
            `image-only, or corrupt.`,
        },
        latencyMs,
      };
    }

    return { text, source: "mammoth", errors: {}, latencyMs };
  } catch (err) {
    return {
      text: "",
      source: "failed",
      errors: { mammoth: err instanceof Error ? err.message : String(err) },
      latencyMs: { mammoth: Date.now() - start },
    };
  }
}
