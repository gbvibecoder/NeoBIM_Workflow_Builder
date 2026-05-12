/**
 * Robust multi-layer PDF text extractor.
 *
 * BACKGROUND
 * ----------
 * The original TR-001 brief parser used `pdf-parse@1.1.1` directly. That
 * library is essentially abandoned and based on an old fork of PDF.js;
 * on perfectly normal PDFs it can throw obscure errors like
 *   UnknownErrorException: Command token too long: 128
 * which left the upstream caller with only the filename as "extracted
 * text" (~20 chars). GPT-4o-mini then hallucinated plot dimensions,
 * room counts, and project names — corrupting every downstream stage
 * (design-agent matcher refused, fell back to legacy /export-ifc,
 * produced thin commercial-shaped IFC).
 *
 * This module is the structural fix: a 3-layer fallback chain that
 * NEVER lets a parse failure become a silent hallucination cascade.
 *
 *   Layer 1 — `unpdf` (PDF.js-based, modern, maintained)
 *   Layer 2 — `pdf-parse` (different parser; succeeds on PDFs unpdf misses)
 *   Layer 3 — Claude vision-document (handles scanned, image-only, or
 *             corrupt PDFs; uses Anthropic SDK directly with the
 *             "document" content block — Claude reads the PDF natively)
 *
 * Each layer returns its own diagnostics. The caller can choose to
 * hard-fail when the chain returns `source: "failed"` instead of
 * letting downstream LLM stages invent data.
 *
 * CONTRACT
 * --------
 * - Never throws. Errors are captured in `result.errors`.
 * - Returns the FIRST layer that produced ≥ MIN_USEFUL_TEXT_CHARS
 *   characters of extracted text.
 * - When all layers fail or produce too little text, returns
 *   `{ text: "", source: "failed", errors: {…} }` so callers can
 *   surface a specific failure mode to the user.
 *
 * SECURITY
 * --------
 * - Capped at 30 MB input (the same cap TR-001 enforces upstream).
 * - Layer 3 sends the PDF base64-inlined to Anthropic — this is
 *   the user's own brief content, going to Anthropic's API which
 *   the project already uses elsewhere (design-agent).
 */

import { Buffer } from "node:buffer";

const MIN_USEFUL_TEXT_CHARS = 50;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const VISION_MODEL = "claude-haiku-4-5-20251001";
const VISION_MAX_TOKENS = 8000;
const VISION_TIMEOUT_MS = 45_000;

export type PdfExtractSource =
  | "unpdf"
  | "pdf-parse"
  | "claude-vision"
  | "failed";

export interface PdfExtractResult {
  /** Full extracted text. Empty string when source === "failed". */
  text: string;
  /** Which layer produced the text. */
  source: PdfExtractSource;
  /** Number of pages, when the producing layer reports it. */
  pageCount?: number;
  /** Per-layer error captures (always populated for layers that ran). */
  errors: {
    unpdf?: string;
    pdfParse?: string;
    vision?: string;
  };
  /** Per-layer latency in ms (only populated for layers that ran). */
  latencyMs: {
    unpdf?: number;
    pdfParse?: number;
    vision?: number;
  };
}

export interface PdfExtractOptions {
  /** Anthropic API key — required to enable Layer 3 vision fallback. */
  anthropicApiKey?: string;
  /** When `false`, skip the vision-document fallback entirely. Default true if key is present. */
  enableVisionFallback?: boolean;
  /** Hard cap on the input PDF size in bytes; default 30 MB. */
  maxBytes?: number;
}


/**
 * Extract text from a PDF buffer using a multi-layer fallback chain.
 *
 * Never throws. Returns a structured result with `source` indicating
 * which layer succeeded, or `"failed"` when every layer produced too
 * little usable text.
 */
export async function extractTextFromPdf(
  pdfBuffer: Buffer,
  opts: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  const errors: PdfExtractResult["errors"] = {};
  const latencyMs: PdfExtractResult["latencyMs"] = {};

  const maxBytes = opts.maxBytes ?? MAX_PDF_BYTES;
  if (pdfBuffer.length > maxBytes) {
    errors.unpdf = `PDF exceeds size cap: ${pdfBuffer.length} > ${maxBytes} bytes`;
    return { text: "", source: "failed", errors, latencyMs };
  }
  if (pdfBuffer.length < 8) {
    errors.unpdf = `PDF buffer too small to be a real PDF: ${pdfBuffer.length} bytes`;
    return { text: "", source: "failed", errors, latencyMs };
  }
  // Quick magic-byte sanity. A valid PDF starts with "%PDF-".
  if (
    pdfBuffer[0] !== 0x25 ||
    pdfBuffer[1] !== 0x50 ||
    pdfBuffer[2] !== 0x44 ||
    pdfBuffer[3] !== 0x46 ||
    pdfBuffer[4] !== 0x2d
  ) {
    errors.unpdf = "Buffer does not start with %PDF- header";
    // Don't return yet — pdf-parse and vision may still recover if the
    // header is followed by valid xref tables (rare but happens with
    // some legal-format generators).
  }

  // ──────────────────────────────────────────────────────────────────
  // Layer 1 — unpdf (PDF.js-based, modern, well-maintained)
  // ──────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const { getDocumentProxy, extractText } = await import("unpdf");
      // unpdf needs Uint8Array, not Buffer. Slice the buffer's
      // underlying ArrayBuffer for an exact view (Buffer's offset may
      // not be 0 for sub-allocations).
      const u8 = new Uint8Array(
        pdfBuffer.buffer,
        pdfBuffer.byteOffset,
        pdfBuffer.byteLength,
      );
      const pdf = await getDocumentProxy(u8);
      const result = await extractText(pdf, { mergePages: true });
      const rawText = Array.isArray(result.text)
        ? result.text.join("\n")
        : (result.text ?? "");
      latencyMs.unpdf = Date.now() - start;
      const text = rawText.trim();
      if (text.length >= MIN_USEFUL_TEXT_CHARS) {
        return {
          text,
          source: "unpdf",
          pageCount: pdf.numPages,
          errors,
          latencyMs,
        };
      }
      errors.unpdf = `extracted only ${text.length} chars (likely scanned / image-only PDF)`;
    } catch (err) {
      latencyMs.unpdf = Date.now() - start;
      errors.unpdf = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Layer 2 — pdf-parse (different engine; legacy fallback)
  // ──────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      // Import from lib/ directly to dodge pdf-parse v1's bundled test-data
      // self-test that fires when `!module.parent`.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
        buf: Buffer,
      ) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
      const result = await pdfParse(pdfBuffer);
      latencyMs.pdfParse = Date.now() - start;
      const text = (result.text ?? "").trim();
      if (text.length >= MIN_USEFUL_TEXT_CHARS) {
        return {
          text,
          source: "pdf-parse",
          pageCount: result.numpages,
          errors,
          latencyMs,
        };
      }
      errors.pdfParse = `extracted only ${text.length} chars`;
    } catch (err) {
      latencyMs.pdfParse = Date.now() - start;
      errors.pdfParse = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Layer 3 — Claude vision-document (handles scanned + corrupt PDFs)
  // ──────────────────────────────────────────────────────────────────
  const visionEnabled =
    opts.enableVisionFallback !== false &&
    !!opts.anthropicApiKey &&
    opts.anthropicApiKey.length > 10;

  if (visionEnabled) {
    const start = Date.now();
    try {
      const text = await extractTextViaClaudeVision(
        pdfBuffer,
        opts.anthropicApiKey!,
      );
      latencyMs.vision = Date.now() - start;
      const trimmed = text.trim();
      if (trimmed.length >= MIN_USEFUL_TEXT_CHARS) {
        return {
          text: trimmed,
          source: "claude-vision",
          errors,
          latencyMs,
        };
      }
      errors.vision = `extracted only ${trimmed.length} chars`;
    } catch (err) {
      latencyMs.vision = Date.now() - start;
      errors.vision = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  } else {
    errors.vision = opts.anthropicApiKey
      ? "vision fallback explicitly disabled"
      : "ANTHROPIC_API_KEY not provided — vision fallback skipped";
  }

  return { text: "", source: "failed", errors, latencyMs };
}


/**
 * Send a PDF straight to Claude as a document block. Anthropic's
 * messages API supports `type: "document"` for native PDF reading —
 * Claude handles the rasterisation + OCR + text extraction server-side,
 * so this layer succeeds on PDFs that any local text-extraction library
 * would choke on (scanned-image PDFs, complex multi-column layouts,
 * embedded-font weirdness, PostScript tokenizer crashes).
 *
 * Throws on API error / timeout; caller catches and records.
 */
async function extractTextViaClaudeVision(
  pdfBuffer: Buffer,
  apiKey: string,
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const base64 = pdfBuffer.toString("base64");
    const response = await client.messages.create(
      {
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              {
                type: "text",
                text:
                  "Transcribe ALL text from this PDF document verbatim. " +
                  "Preserve:\n" +
                  "  • Section headings and numbering (e.g., '1.', '2.')\n" +
                  "  • All numeric dimensions, units, and orientation (e.g., '24 feet (depth) x 50 feet (width)')\n" +
                  "  • Room names, sizes, and quadrant locations\n" +
                  "  • Bullet lists and indentation hints\n" +
                  "Output PLAIN TEXT only — no markdown formatting, no explanatory commentary, " +
                  "no 'Here is the transcription' prefix. Begin output with the document's own first line.",
              },
            ],
          },
        ],
      },
      { signal: controller.signal as unknown as AbortSignal },
    );

    const textBlock = response.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text block");
    }
    return textBlock.text;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Build a structured one-line summary suitable for logging. Useful in
 * TR-001's existing logger.info trail.
 */
export function summariseExtractResult(r: PdfExtractResult): string {
  const lat = Object.entries(r.latencyMs)
    .map(([k, v]) => `${k}=${v}ms`)
    .join(" ");
  const err = Object.entries(r.errors)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}_err="${v}"`)
    .join(" ");
  return `source=${r.source} text_chars=${r.text.length} pages=${r.pageCount ?? "?"} ${lat} ${err}`.trim();
}
