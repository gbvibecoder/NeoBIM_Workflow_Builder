/**
 * KOS drawing-parser client.
 *
 * Thin HTTP wrapper around the Python sidecar's `POST /kos/parse-drawing`.
 * Originally filesystem-only (5C-1 Phase 1, single `parseDrawing` entry
 * point); 5I PR 2a adds two more entry points so the chat-attached
 * customer-drawing flow can parse from a Buffer or directly from S3
 * without round-tripping through a temp file.
 *
 *   parseDrawingFromFile     — read from local disk, then dispatch
 *   parseDrawingFromBuffer   — dispatch a Buffer directly (used internally)
 *   parseDrawingFromS3       — fetch from Kalzen S3 → Buffer → dispatch
 *
 * All three funnel through the SAME multipart POST and the same
 * post-parse safety checks (scanned-image PDF detection — see
 * `temp_folder/pdf-probe/REPORT.md` Finding 4). The legacy
 * `parseDrawing` symbol is preserved as a deprecated alias for the
 * `scripts/kos-drawing-parse-test.ts` CLI driver.
 *
 * Auth: sends `Authorization: Bearer <IFC_SERVICE_API_KEY>` when configured
 * (the sidecar's `ApiKeyMiddleware` guards every non-public route).
 * Errors surface as `KosError` codes the caller can map to user-facing
 * messages — see the table near the bottom of this file.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { Tenant } from "@prisma/client";

import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import {
  KOS_DRAWING_REQUEST_TIMEOUT_MS,
  KOS_SIDECAR_API_KEY,
  KOS_SIDECAR_URL,
} from "@/features/kos/lib/kos-drawing-constants";
import { fetchKosObjectAsBuffer } from "@/features/kos/services/s3-client";
import type {
  DrawingFormat,
  DrawingParseError,
  DrawingParseResult,
  DrawingSourceFormat,
} from "@/features/kos/types/drawing";

// ── public arg types ─────────────────────────────────────────────────────

/**
 * Legacy filesystem-only args (5C-1). Retained verbatim so the CLI
 * driver at `scripts/kos-drawing-parse-test.ts` keeps compiling and
 * running. Prefer `ParseDrawingFromFileArgs` for new code.
 */
export interface ParseDrawingArgs {
  filePath: string;
  format?: DrawingFormat;
  debug?: boolean;
  filename?: string;
}

export interface ParseDrawingFromFileArgs {
  /** Absolute path to a local DXF or PDF. */
  filePath: string;
  /** Source format the upload originated as. Sidecar only honours dxf/pdf wire-side. */
  sourceFormat: DrawingSourceFormat;
  /** Override the filename reported to the sidecar (defaults to basename(filePath)). */
  filename?: string;
  /** Ask the sidecar for a debug overlay PNG. */
  debug?: boolean;
  /** Optional tenant id for log correlation. Not sent to the sidecar. */
  tenantId?: string;
  /** Optional drawing id for log correlation. */
  drawingId?: string;
}

export interface ParseDrawingFromBufferArgs {
  /** Raw drawing bytes. */
  buffer: Buffer;
  /** Source format. Sidecar validates via filename extension, not this field. */
  sourceFormat: DrawingSourceFormat;
  /**
   * Filename reported to the sidecar — REQUIRED for the buffer path
   * because the sidecar checks the extension to gate "scanned-image PDFs
   * are not supported." Pass `*.dxf` or `*.pdf`.
   */
  filename: string;
  debug?: boolean;
  tenantId?: string;
  drawingId?: string;
}

export interface ParseDrawingFromS3Args {
  /**
   * Full tenant row — needed by `fetchKosObjectAsBuffer` to resolve
   * the per-tenant S3 client (bucket + creds). `tenant.id` is used for
   * log correlation; the sidecar itself is tenant-blind.
   */
  tenant: Tenant;
  /**
   * S3 key produced by `kosS3Key()` (or otherwise trusted server-side).
   * Defence-in-depth: rejects any key containing `..` even though
   * production keys come from `kosS3Key` which already strips path
   * traversal segments at build time.
   */
  s3Key: string;
  sourceFormat: DrawingSourceFormat;
  /** Filename to report to the sidecar (typically the customer's original filename). */
  filename: string;
  debug?: boolean;
  drawingId?: string;
}

// ── public functions ─────────────────────────────────────────────────────

export async function parseDrawingFromFile(
  args: ParseDrawingFromFileArgs,
): Promise<DrawingParseResult> {
  const filename = args.filename ?? basename(args.filePath);
  let buffer: Buffer;
  try {
    buffer = await readFile(args.filePath);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new KosError(
      "KOS_DRAWING_001",
      `Could not read drawing at "${args.filePath}" before parse: ${msg}`,
      400,
    );
  }
  return parseDrawingFromBuffer({
    buffer,
    sourceFormat: args.sourceFormat,
    filename,
    debug: args.debug,
    tenantId: args.tenantId,
    drawingId: args.drawingId,
  });
}

export async function parseDrawingFromBuffer(
  args: ParseDrawingFromBufferArgs,
): Promise<DrawingParseResult> {
  return parseDrawingFromBufferInternal(args);
}

export async function parseDrawingFromS3(
  args: ParseDrawingFromS3Args,
): Promise<DrawingParseResult> {
  if (args.s3Key.includes("..")) {
    throw new KosError(
      "KOS_DRAWING_003",
      `Refusing to fetch S3 key "${args.s3Key}" — contains ".." (path-traversal guard).`,
      400,
    );
  }
  let buffer: Buffer;
  try {
    const fetched = await fetchKosObjectAsBuffer(args.tenant, args.s3Key);
    buffer = fetched.buffer;
  } catch (err) {
    if (err instanceof KosError) {
      // Surface S3-layer KosErrors with a parser-namespaced code so
      // the caller can distinguish "S3 fetch failed" from "sidecar parse
      // failed" without inspecting the inner code prefix.
      throw new KosError(
        "KOS_DRAWING_003",
        `Could not fetch drawing s3://${args.s3Key} for tenant ${args.tenant.id} before parse: ${err.code}: ${err.message}`,
        err.httpStatus,
      );
    }
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new KosError(
      "KOS_DRAWING_003",
      `Could not fetch drawing s3://${args.s3Key} for tenant ${args.tenant.id} before parse: ${msg}`,
      500,
    );
  }
  return parseDrawingFromBuffer({
    buffer,
    sourceFormat: args.sourceFormat,
    filename: args.filename,
    debug: args.debug,
    tenantId: args.tenant.id,
    drawingId: args.drawingId,
  });
}

/**
 * @deprecated Use `parseDrawingFromFile`. Retained as an alias for the
 * `scripts/kos-drawing-parse-test.ts` CLI driver (5C-1). Will be removed
 * in a future 5I cleanup PR.
 */
export async function parseDrawing(
  args: ParseDrawingArgs,
): Promise<DrawingParseResult> {
  return parseDrawingFromFile({
    filePath: args.filePath,
    sourceFormat: (args.format ?? "dxf") as DrawingSourceFormat,
    filename: args.filename,
    debug: args.debug,
  });
}

// ── internal dispatch ────────────────────────────────────────────────────

async function parseDrawingFromBufferInternal(
  args: ParseDrawingFromBufferArgs,
): Promise<DrawingParseResult> {
  const { buffer, sourceFormat, filename, debug = false } = args;
  const url = `${KOS_SIDECAR_URL}/kos/parse-drawing`;
  const startedAt = Date.now();

  kosLog.info("kos_parse_dispatch", {
    tenantId: args.tenantId,
    drawingId: args.drawingId,
    filename,
    sourceFormat,
    sizeBytes: buffer.length,
  });

  const form = new FormData();
  // Uint8Array view keeps Blob happy across Node versions (Buffer is a view).
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
    filename,
  );
  form.append("format", sourceFormat);
  form.append("debug", String(debug));
  form.append("filename", filename);

  const headers: Record<string, string> = {};
  if (KOS_SIDECAR_API_KEY) {
    headers.Authorization = `Bearer ${KOS_SIDECAR_API_KEY}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    KOS_DRAWING_REQUEST_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const durationMs = Date.now() - startedAt;
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    kosLog.warn("kos_parse_failed", {
      tenantId: args.tenantId,
      drawingId: args.drawingId,
      filename,
      durationMs,
      errorCode: "KOS_DRAWING_001",
      reason: aborted ? "timeout" : "network",
    });
    throw new KosError(
      "KOS_DRAWING_001",
      aborted
        ? `Sidecar did not respond within ${
            KOS_DRAWING_REQUEST_TIMEOUT_MS / 1000
          }s for "${filename}" — ${url} may be cold-starting or down.`
        : `Network error calling sidecar at ${url} for "${filename}": ${errMsg}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    const durationMs = Date.now() - startedAt;
    let detail = text.slice(0, 500);
    let sidecarErrorCode: string | null = null;
    try {
      const body = JSON.parse(text) as DrawingParseError;
      sidecarErrorCode = body.error ?? null;
      detail = `${body.error}: ${body.message}`;
    } catch {
      // non-JSON body — keep the raw prefix
    }
    // The sidecar returns `error: "invalid_extension"` for bad filenames
    // (see PDF probe §6). Surface that as KOS_DRAWING_002 so callers can
    // distinguish "bad input" from generic transport failure.
    const isInputError = response.status >= 400 && response.status < 500;
    const surfacedCode = isInputError ? "KOS_DRAWING_002" : "KOS_DRAWING_001";
    kosLog.warn("kos_parse_failed", {
      tenantId: args.tenantId,
      drawingId: args.drawingId,
      filename,
      durationMs,
      status: response.status,
      errorCode: surfacedCode,
      sidecarErrorCode,
    });
    throw new KosError(
      surfacedCode,
      `Sidecar returned ${response.status} for "${filename}" — ${detail}`,
      response.status,
    );
  }

  let result: DrawingParseResult;
  try {
    result = JSON.parse(text) as DrawingParseResult;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    kosLog.warn("kos_parse_failed", {
      tenantId: args.tenantId,
      drawingId: args.drawingId,
      filename,
      durationMs,
      errorCode: "KOS_DRAWING_001",
      reason: "invalid_json",
    });
    throw new KosError(
      "KOS_DRAWING_001",
      `Sidecar returned 200 but body was not valid JSON for "${filename}": ${errMsg}`,
      502,
    );
  }

  // ── Scanned-image PDF post-parse detection ──
  //
  // The sidecar's `invalid_extension` 400 only catches the filename-
  // extension mismatch. A .pdf-named raster scan is accepted (200) and
  // returns a near-empty parse with walls=[] and title_block.source set
  // to "filename" (because the title-block branch couldn't find any
  // vector text). Detect that here so the user gets a clear message
  // instead of a confused "your PDF was parsed but has no walls".
  //
  // See temp_folder/pdf-probe/REPORT.md Finding 4 + Recommendation.
  if (isScannedPdfResponse(result)) {
    const durationMs = Date.now() - startedAt;
    kosLog.warn("kos_parse_failed", {
      tenantId: args.tenantId,
      drawingId: args.drawingId,
      filename,
      durationMs,
      errorCode: "KOS_DRAWING_004",
      drawingType: result.drawing_type,
    });
    throw new KosError(
      "KOS_DRAWING_004",
      `PDF "${filename}" appears to be a scanned image (no vector walls detected, title-block source = "filename"). Vector PDF required — please re-export from the CAD tool with vector output, or upload a DXF instead.`,
      415,
    );
  }

  const durationMs = Date.now() - startedAt;
  kosLog.info("kos_parse_done", {
    tenantId: args.tenantId,
    drawingId: args.drawingId,
    filename,
    durationMs,
    drawingType: result.drawing_type,
    drawingTypeConfidence: result.drawing_type_confidence,
    wallsCount: result.walls?.length ?? 0,
  });

  return result;
}

/**
 * Returns true when the sidecar response looks like the
 * "scanned-image PDF accepted but contains no vectors" failure mode.
 * Conservative — requires ALL three signals to match.
 */
function isScannedPdfResponse(result: DrawingParseResult): boolean {
  return (
    result.format === "pdf" &&
    Array.isArray(result.walls) &&
    result.walls.length === 0 &&
    result.title_block?.source === "filename"
  );
}

// ── error code reference ────────────────────────────────────────────────
//
//   KOS_DRAWING_001 — Sidecar transport failure (network / timeout /
//                     5xx / invalid JSON in 200 response).
//   KOS_DRAWING_002 — Sidecar 4xx with a structured error envelope
//                     (e.g. `error: "invalid_extension"`). Surfaces the
//                     sidecar's own error code + message verbatim so the
//                     caller can map to a user-facing string.
//   KOS_DRAWING_003 — S3 fetch failure on the `parseDrawingFromS3` path.
//                     Includes any path-traversal guard rejection.
//   KOS_DRAWING_004 — Scanned-image PDF detected post-parse. Surfaces
//                     a user-actionable message ("vector PDF required").
