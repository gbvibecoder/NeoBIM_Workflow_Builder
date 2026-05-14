/**
 * Shared brief text extractor — cross-cutting utility.
 *
 * BACKGROUND
 * ----------
 * The TR-001 Brief Parser (`handlers/tr-001.ts`) and the new TR-024 Brief
 * Enricher (`handlers/tr-024.ts`) both need to turn an uploaded `.pdf` /
 * `.docx` file into plain text. The extraction logic — magic-byte sniff,
 * DOCX → mammoth, PDF → the 3-layer `unpdf` → `pdf-parse` → Claude-vision
 * chain — used to live inline inside `tr-001.ts`. This module lifts that
 * logic verbatim so both handlers consume one implementation and a parser
 * regression is caught in one place.
 *
 * CONTRACT
 * --------
 * - Never throws. Every failure mode comes back as `{ ok: false, ... }`
 *   with per-layer error captures, so callers can surface a specific
 *   failure to the UI instead of letting a parse failure cascade into
 *   hallucinated data (the same discipline `pdf-text-extractor.ts` and
 *   `docx-text-extractor.ts` enforce).
 * - Magic bytes are authoritative for format routing. The `mimeType`
 *   argument is advisory only — it is recorded on the result for
 *   observability but never overrides the byte signature. This matches
 *   the original TR-001 behaviour exactly (`isDocxBuffer` → DOCX else PDF).
 */

import { Buffer } from "node:buffer";

/** PDF vs DOCX — decided by magic bytes, not the client-declared MIME type. */
export type BriefSourceFormat = "pdf" | "docx";

interface BriefExtractBase {
  sourceFormat: BriefSourceFormat;
  /** Extraction layers that actually ran, in order — e.g. `["unpdf"]`,
   *  `["unpdf", "pdf-parse", "claude-vision"]`, or `["mammoth"]`. */
  extractorChain: string[];
  /** One-line log summary. */
  summary: string;
  /** Client-declared MIME type, advisory only — recorded for observability. */
  declaredMimeType?: string;
}

export interface BriefExtractSuccess extends BriefExtractBase {
  ok: true;
  /** Full extracted text. */
  text: string;
  /** Raw decoded buffer — present only for PDFs. Lets callers pass it on
   *  to embedded-reference-image extraction (TR-001's `parseBriefDocument`
   *  uses this). `undefined` for DOCX. */
  pdfBuffer?: Buffer;
}

export interface BriefExtractFailure extends BriefExtractBase {
  ok: false;
  /** Per-layer error captures. */
  errors: Record<string, string>;
  /** Human-readable joined error summary, suitable for a UserError message.
   *  For PDFs this mirrors the `"unpdf: … | pdf-parse: … | vision: …"`
   *  format TR-001 built inline before this module existed. */
  errorSummary: string;
}

export type BriefExtractResult = BriefExtractSuccess | BriefExtractFailure;

/**
 * Decode a base64 brief file, sniff its format, and extract its text.
 *
 * @param fileData  base64-encoded `.pdf` or `.docx` bytes (as IN-002 emits)
 * @param mimeType  client-declared MIME type — advisory only, never used
 *                  for routing (magic bytes win, exactly as TR-001 did)
 */
export async function extractTextFromBriefFile(
  fileData: string,
  mimeType?: string,
): Promise<BriefExtractResult> {
  const buffer = Buffer.from(fileData, "base64");

  const { isDocxBuffer, extractTextFromDocx } = await import(
    "@/lib/docx-text-extractor"
  );

  // ── DOCX path — magic bytes PK\x03\x04 ──────────────────────────────
  if (isDocxBuffer(buffer)) {
    const docx = await extractTextFromDocx(buffer);
    const extractorChain = ["mammoth"];
    if (docx.text) {
      return {
        ok: true,
        text: docx.text,
        sourceFormat: "docx",
        extractorChain,
        summary: `source=docx via=mammoth chars=${docx.text.length}`,
        declaredMimeType: mimeType,
      };
    }
    const errorSummary = docx.errors.mammoth ?? "unknown";
    return {
      ok: false,
      sourceFormat: "docx",
      extractorChain,
      errors: docx.errors.mammoth ? { mammoth: docx.errors.mammoth } : {},
      errorSummary,
      summary: `source=docx FAILED mammoth_err="${errorSummary}"`,
      declaredMimeType: mimeType,
    };
  }

  // ── PDF path — multi-layer unpdf → pdf-parse → Claude vision ────────
  const { extractTextFromPdf, summariseExtractResult } = await import(
    "@/lib/pdf-text-extractor"
  );
  const extracted = await extractTextFromPdf(buffer, {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    enableVisionFallback: true,
  });
  const extractorChain = Object.keys(extracted.latencyMs);
  const summary = summariseExtractResult(extracted);

  if (extracted.text) {
    return {
      ok: true,
      text: extracted.text,
      pdfBuffer: buffer,
      sourceFormat: "pdf",
      extractorChain,
      summary,
      declaredMimeType: mimeType,
    };
  }

  const errors: Record<string, string> = {};
  if (extracted.errors.unpdf) errors.unpdf = extracted.errors.unpdf;
  if (extracted.errors.pdfParse) errors.pdfParse = extracted.errors.pdfParse;
  if (extracted.errors.vision) errors.vision = extracted.errors.vision;
  const errorSummary = [
    extracted.errors.unpdf && `unpdf: ${extracted.errors.unpdf}`,
    extracted.errors.pdfParse && `pdf-parse: ${extracted.errors.pdfParse}`,
    extracted.errors.vision && `vision: ${extracted.errors.vision}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    ok: false,
    sourceFormat: "pdf",
    extractorChain,
    errors,
    errorSummary,
    summary,
    declaredMimeType: mimeType,
  };
}
