/**
 * KOS drawing-parser client (Week 5C-1, Phase 1).
 *
 * Thin HTTP wrapper around the Python sidecar's `POST /kos/parse-drawing`.
 * Reads a DXF off disk, ships it as multipart/form-data, and returns the
 * typed parse result. Errors surface as `KosError("KOS_DRAWING_001", …)`
 * with enough context (status, sidecar message) that the message alone
 * tells you what failed and where — per the project's specific-errors rule.
 *
 * Auth: sends `Authorization: Bearer <IFC_SERVICE_API_KEY>` when configured
 * (the sidecar's `ApiKeyMiddleware` guards every non-public route). With no
 * key set, the sidecar runs in dev/open mode and the header is omitted.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { KosError } from "@/features/kos/lib/kos-errors";
import {
  KOS_DRAWING_REQUEST_TIMEOUT_MS,
  KOS_SIDECAR_API_KEY,
  KOS_SIDECAR_URL,
} from "@/features/kos/lib/kos-drawing-constants";
import type {
  DrawingFormat,
  DrawingParseError,
  DrawingParseResult,
} from "@/features/kos/types/drawing";

export interface ParseDrawingArgs {
  /** Absolute path to the DXF on the local filesystem. */
  filePath: string;
  /** Upload format — only `"dxf"` in this phase. */
  format?: DrawingFormat;
  /** Request the debug overlay PNG (base64). */
  debug?: boolean;
  /**
   * Filename to report to the sidecar (drives the title-block filename
   * fallback). Defaults to the basename of `filePath`.
   */
  filename?: string;
}

/**
 * Parse a DXF drawing via the sidecar. Resolves to the typed result, or
 * throws `KosError` on transport / non-2xx / timeout.
 */
export async function parseDrawing(
  args: ParseDrawingArgs,
): Promise<DrawingParseResult> {
  const { filePath, format = "dxf", debug = false } = args;
  const filename = args.filename ?? basename(filePath);
  const url = `${KOS_SIDECAR_URL}/kos/parse-drawing`;

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (err) {
    throw new KosError(
      "KOS_DRAWING_001",
      `Could not read DXF at "${filePath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      400,
    );
  }

  const form = new FormData();
  // Uint8Array view keeps Blob happy across Node versions (Buffer is a view).
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
    filename,
  );
  form.append("format", format);
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
    throw new KosError(
      "KOS_DRAWING_001",
      aborted
        ? `Sidecar did not respond within ${
            KOS_DRAWING_REQUEST_TIMEOUT_MS / 1000
          }s for "${filename}" — ${url} may be cold-starting or down.`
        : `Network error calling sidecar at ${url} for "${filename}": ${
            err instanceof Error ? err.message : String(err)
          }`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 500);
    try {
      const body = JSON.parse(text) as DrawingParseError;
      detail = `${body.error}: ${body.message}`;
    } catch {
      // non-JSON body — keep the raw prefix
    }
    throw new KosError(
      "KOS_DRAWING_001",
      `Sidecar returned ${response.status} for "${filename}" — ${detail}`,
      response.status,
    );
  }

  try {
    return JSON.parse(text) as DrawingParseResult;
  } catch (err) {
    throw new KosError(
      "KOS_DRAWING_001",
      `Sidecar returned 200 but body was not valid JSON for "${filename}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    );
  }
}
