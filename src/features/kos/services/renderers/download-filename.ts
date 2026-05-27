/**
 * 5I PR 4 — Customer-facing download filename builder.
 *
 * Naming convention:
 *   BOQ_<sanitized>.xlsx
 *   Formwork_quantities_<sanitized>.pdf
 *
 * Pipeline:
 *  1. Strip the trailing extension from the customer's `originalFilename`
 *  2. Sanitize the base via the project's PR 1 `sanitizeFilename` helper
 *     (strips path separators, control chars, shell metacharacters,
 *     replaces non-ASCII with `_`)
 *  3. Detect the sentinel `"drawing.dxf"` that `sanitizeFilename`
 *     returns for empty/all-invalid input, and substitute a per-drawing
 *     fallback (`Drawing-<8 chars>` or `Drawing`) — without that detection
 *     we'd end up with names like `BOQ_drawing.dxf.xlsx`.
 *  4. Hard-cap the sanitized base at 200 characters before prefix/suffix
 *  5. Compose the final name
 *
 * Collision handling: none server-side. The browser/OS appends `(1)`,
 * `(2)`, etc. when the same name is downloaded twice. Acceptable for v1.
 */

import { sanitizeFilename } from "@/features/kos/lib/filename-sanitize";

/** Maximum length of the sanitized base (before the prefix + extension). */
const MAX_BASE_LENGTH = 200;

/** Sentinel `sanitizeFilename` emits on empty/invalid input. */
const SANITIZE_EMPTY_SENTINEL = "drawing.dxf";

export type DownloadKind = "boq" | "formwork";

export function buildDownloadFilename(
  originalFilename: string,
  kind: DownloadKind,
  fallbackDrawingId?: string,
): string {
  // 1. Strip the trailing extension if any. `90VR-...-Part 2.pdf` → base.
  // We only strip the LAST extension; multi-dot stems like `file.v2.dxf`
  // keep the `.v2` part.
  const raw = typeof originalFilename === "string" ? originalFilename : "";
  const base = raw.replace(/\.[^/.]+$/, "");

  // 2. Sanitize via the project helper.
  let sanitized = sanitizeFilename(base);

  // 3. Detect the "drawing.dxf" fallback. If the customer's filename
  // sanitizes to this sentinel, treat the input as empty for our
  // download-naming purposes.
  if (sanitized === SANITIZE_EMPTY_SENTINEL) {
    sanitized = "";
  }

  // 4. Fall back to a drawing-id-derived name when empty.
  if (!sanitized || sanitized.length === 0) {
    if (fallbackDrawingId && fallbackDrawingId.length > 0) {
      // Trim down to 8 chars for brevity; defensive against unusual id formats.
      const idSlice = String(fallbackDrawingId).replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      sanitized = idSlice.length > 0 ? `Drawing-${idSlice}` : "Drawing";
    } else {
      sanitized = "Drawing";
    }
  }

  // 5. Hard cap at 200 chars (preserve start of name; truncating from
  // the end is fine since the drawing-id prefix in customer filenames
  // is usually at the start).
  if (sanitized.length > MAX_BASE_LENGTH) {
    sanitized = sanitized.slice(0, MAX_BASE_LENGTH);
  }

  // 6. Compose.
  switch (kind) {
    case "boq":
      return `BOQ_${sanitized}.xlsx`;
    case "formwork":
      return `Formwork_quantities_${sanitized}.pdf`;
  }
}
