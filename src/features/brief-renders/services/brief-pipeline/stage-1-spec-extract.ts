/**
 * Stage 1 — Spec Extract.
 *
 * Given a `briefUrl` (R2 URL of a `.pdf` or `.docx`), produce a fully
 * validated `BriefSpec` JSON where every leaf is either source-extracted
 * or `null`. **No invention pathway exists** — that's the load-bearing
 * contract of the entire feature.
 *
 * Pipeline:
 *   1. SSRF-guard the URL (only R2-served origins are allowed).
 *   2. Download the brief.
 *   3. Detect format from Content-Type + magic bytes (defence in depth).
 *   4. Extract text (PDF: pdf-parse; DOCX: mammoth).
 *   5. Extract embedded raster images.
 *   6. Upload reference images to R2 under `briefs/refs/{jobId}/...`.
 *   7. Call Claude with the `submit_brief_spec` tool, forced via
 *      `tool_choice`, with a 120 s `AbortSignal.timeout`.
 *   8. Validate the tool_use payload against `BriefSpecSchema` (.strict).
 *   9. Compute cost from token usage; log via `BriefRenderLogger`.
 *  10. Return `{ spec, referenceImages, pageCount, costUsd, tokensIn, tokensOut }`.
 *
 * Idempotent: same `jobId` re-runs produce the same R2 keys and the
 * same Claude call (modulo non-determinism). Phase 3's worker is the
 * one that handles retries; this stage just runs once per invocation.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  BriefDownloadError,
  BriefRendersError,
  EmptyDocxError,
  EmptyPdfError,
  InvalidSpecError,
  MissingToolUseError,
  UnauthorizedBriefUrlError,
  UnsupportedBriefFormatError,
} from "./errors";
import {
  BRIEF_RENDERS_ANTHROPIC_MODEL,
  BRIEF_RENDERS_INPUT_COST_PER_MILLION,
  BRIEF_RENDERS_OUTPUT_COST_PER_MILLION,
  createAnthropicClient,
} from "./clients";
import { extractDocxText } from "./extractors/docx-text";
import { extractEmbeddedImages, type SupportedBriefMime } from "./extractors/embedded-images";
import { extractPdfText } from "./extractors/pdf-text";
import {
  uploadReferenceImages,
  type ReferenceImage,
} from "./extractors/upload-reference-images";
import type { BriefRenderLogger } from "./logger";
import {
  BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT,
  buildSpecExtractorUserMessage,
} from "./prompts/spec-extractor";
import { BriefSpecSchema, briefSpecJsonSchema, type ZBriefSpec } from "./schemas";

// ─── Constants ──────────────────────────────────────────────────────

/** Hard timeout for the Claude call. Sonnet 4.6 typically responds in 8-30 s. */
const ANTHROPIC_TIMEOUT_MS = 120_000;

/** Hard timeout for the brief download. R2 → Lambda is sub-second in practice. */
const BRIEF_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Hard cap on the brief body we accept post-download. Phase 1 cap is 50 MB. */
const MAX_BRIEF_BODY_BYTES = 50 * 1024 * 1024;

/** Anthropic max_tokens for the tool_use response. 8 K is plenty for our schema. */
const ANTHROPIC_MAX_TOKENS = 8192;

/** Tool name. Asserted by tests so a refactor can't silently rename it. */
const TOOL_NAME = "submit_brief_spec";

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 (DOCX = ZIP)

const PDF_MIME: SupportedBriefMime = "application/pdf";
const DOCX_MIME: SupportedBriefMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ─── Public surface ─────────────────────────────────────────────────

export interface Stage1Args {
  /** Public R2 URL of the brief PDF / DOCX. */
  briefUrl: string;
  /** `BriefRenderJob.id` — used for deterministic R2 reference-image keys. */
  jobId: string;
  /** Logger. Stage events are logged here; cost is recorded. */
  logger: BriefRenderLogger;
}

export interface Stage1Result {
  /** Validated, strict-faithfulness Brief Specification. */
  spec: ZBriefSpec;
  /** R2-hosted reference images extracted from the brief. May be empty. */
  referenceImages: ReferenceImage[];
  /** Brief page count. `null` for DOCX (no page concept post-mammoth). */
  pageCount: number | null;
  /** Computed Claude API cost for this stage in USD. */
  costUsd: number;
  /** Anthropic input token count. */
  tokensIn: number;
  /** Anthropic output token count. */
  tokensOut: number;
}

// ─── Orchestrator ───────────────────────────────────────────────────

export async function runStage1SpecExtract(args: Stage1Args): Promise<Stage1Result> {
  const { briefUrl, jobId, logger } = args;
  logger.startStage(1, "Spec Extract");

  try {
    assertBriefUrlIsAuthorized(briefUrl);

    // 1. Download.
    const { buffer, contentType } = await downloadBrief(briefUrl);

    // 2. Classify (Content-Type + magic bytes; magic bytes win on conflict).
    const mime = classifyBuffer(buffer, contentType);

    // 3. Extract text + page count.
    let textOrHtml: string;
    let format: "pdf-text" | "docx-html";
    let pageCount: number | null;

    if (mime === PDF_MIME) {
      const pdf = await extractPdfText(buffer);
      textOrHtml = pdf.text;
      pageCount = pdf.pageCount;
      format = "pdf-text";
    } else {
      const docx = await extractDocxText(buffer);
      // Prefer HTML (preserves table structure). Raw text is the fallback
      // only if HTML is empty — extractDocxText guarantees at least one is
      // populated, otherwise it would have thrown EmptyDocxError.
      textOrHtml = docx.html.trim().length > 0 ? docx.html : docx.rawText;
      pageCount = null;
      format = "docx-html";
    }

    // 4. Embedded images → R2 reference URLs.
    const embedded = await extractEmbeddedImages(buffer, mime);
    const referenceImages = await uploadReferenceImages(embedded, jobId);

    // 5. Claude call — tool_use forced.
    const userMessage = buildSpecExtractorUserMessage({
      textOrHtml,
      format,
      referenceImages,
    });
    const tool: Anthropic.Tool = {
      name: TOOL_NAME,
      description:
        "Submit the extracted Brief Specification. Every field must be either explicitly stated in the source or set to null.",
      input_schema: briefSpecJsonSchema() as Anthropic.Tool["input_schema"],
    };

    const client = createAnthropicClient();
    const response = await client.messages.create(
      {
        model: BRIEF_RENDERS_ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [userMessage],
      },
      { signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS) },
    );

    // 6. Extract tool_use payload.
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new MissingToolUseError(
        `Claude returned no tool_use block. Stop reason: ${response.stop_reason ?? "unknown"}.`,
      );
    }
    if (toolUse.name !== TOOL_NAME) {
      throw new MissingToolUseError(
        `Claude called wrong tool: "${toolUse.name}" (expected "${TOOL_NAME}").`,
      );
    }

    // 7. Zod validation — strict mode, every leaf nullable.
    const parsed = BriefSpecSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new InvalidSpecError(
        `Spec validation failed: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
        issues,
      );
    }

    const spec = parsed.data;

    // 8. Cost computation. Sonnet 4.6 = $3 / $15 per million tokens.
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    const costUsd =
      (tokensIn * BRIEF_RENDERS_INPUT_COST_PER_MILLION +
        tokensOut * BRIEF_RENDERS_OUTPUT_COST_PER_MILLION) /
      1_000_000;
    logger.recordCost(1, costUsd);

    logger.endStage(1, "success", {
      apartmentCount: spec.apartments.length,
      // Phase 3: shots are nested under apartments — flat count via flatMap.
      shotCount: spec.apartments.reduce((sum, a) => sum + a.shots.length, 0),
      baselinePopulated: countNonNullFields(spec.baseline),
      referenceImageCount: referenceImages.length,
      pageCount,
      tokensIn,
      tokensOut,
      costUsd,
    });

    return {
      spec,
      referenceImages,
      pageCount,
      costUsd,
      tokensIn,
      tokensOut,
    };
  } catch (err) {
    const message =
      err instanceof BriefRendersError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown error";
    logger.endStage(1, "failed", undefined, message);
    throw err;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * SSRF guard. Allows URLs whose host is the configured R2 public-URL host
 * or any `*.r2.cloudflarestorage.com` (the path-style fallback used by
 * `r2.ts` when `R2_PUBLIC_URL` is unset).
 *
 * Throws `UnauthorizedBriefUrlError` for any other host. Called BEFORE
 * any network access.
 */
function assertBriefUrlIsAuthorized(briefUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(briefUrl);
  } catch {
    throw new UnauthorizedBriefUrlError(
      `Brief URL is not a valid absolute URL: ${truncate(briefUrl, 100)}`,
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UnauthorizedBriefUrlError(
      `Brief URL protocol "${parsed.protocol}" is not allowed.`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (host.endsWith(".r2.cloudflarestorage.com")) return;

  const publicUrl = process.env.R2_PUBLIC_URL ?? "";
  if (publicUrl) {
    try {
      const allowedHost = new URL(publicUrl).hostname.toLowerCase();
      if (allowedHost && host === allowedHost) return;
    } catch {
      // R2_PUBLIC_URL malformed — fall through to refusal.
    }
  }

  throw new UnauthorizedBriefUrlError(
    `Brief URL host "${host}" is not in the allowlist (R2_PUBLIC_URL host or *.r2.cloudflarestorage.com).`,
  );
}

async function downloadBrief(
  briefUrl: string,
): Promise<{ buffer: Buffer; contentType: string | null }> {
  let response: Response;
  try {
    response = await fetch(briefUrl, {
      signal: AbortSignal.timeout(BRIEF_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BriefDownloadError(
      `fetch(${truncate(briefUrl, 100)}) threw: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (!response.ok) {
    throw new BriefDownloadError(
      `Brief download failed with status ${response.status}: ${response.statusText}`,
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_BRIEF_BODY_BYTES) {
      throw new BriefDownloadError(
        `Brief Content-Length ${declared} exceeds cap ${MAX_BRIEF_BODY_BYTES}.`,
      );
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BRIEF_BODY_BYTES) {
    throw new BriefDownloadError(
      `Brief body ${arrayBuffer.byteLength} bytes exceeds cap ${MAX_BRIEF_BODY_BYTES}.`,
    );
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type"),
  };
}

/**
 * Classify a downloaded brief by Content-Type AND magic bytes. Magic
 * bytes win on conflict — Content-Type can lie (R2 sometimes serves
 * `application/octet-stream`); the byte signature is authoritative.
 */
function classifyBuffer(
  buffer: Buffer,
  contentType: string | null,
): SupportedBriefMime {
  const startsWithPdf = buffer.length >= PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
  if (startsWithPdf) return PDF_MIME;

  const startsWithZip = buffer.length >= ZIP_MAGIC.length && buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);
  if (startsWithZip) return DOCX_MIME;

  // Magic bytes lost — fall through to Content-Type as a last resort,
  // but we still refuse anything we don't recognize.
  if (contentType) {
    const ct = contentType.split(";")[0].trim().toLowerCase();
    if (ct === PDF_MIME) return PDF_MIME;
    if (ct === DOCX_MIME) return DOCX_MIME;
  }

  throw new UnsupportedBriefFormatError(
    `Brief did not match PDF or DOCX magic bytes. Content-Type="${contentType ?? "(none)"}".`,
  );
}

function countNonNullFields(record: Record<string, unknown>): number {
  let count = 0;
  for (const v of Object.values(record)) {
    if (v !== null && v !== undefined) count++;
  }
  return count;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ─── Re-exports for callers ─────────────────────────────────────────

export type { ZBriefSpec as BriefSpec } from "./schemas";
export type { ReferenceImage } from "./extractors/upload-reference-images";
export {
  EmptyDocxError,
  EmptyPdfError,
  InvalidSpecError,
  MissingToolUseError,
  UnauthorizedBriefUrlError,
  UnsupportedBriefFormatError,
};
