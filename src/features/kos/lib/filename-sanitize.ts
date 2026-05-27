/**
 * Sanitize a user-supplied filename for safe use in:
 *   - S3 keys (no path separators that could redirect the upload)
 *   - DB persistence (filename column; bounded length)
 *   - Synthetic prompt-injection blocks (no quotes / angle brackets
 *     / control chars that could close the surrounding system-prompt
 *     fence and bleed user content into instructions)
 *
 * Never preserves: path separators, special chars, control chars,
 * unicode tricks. The user's original filename is persisted to
 * `KosCustomerDrawing.originalFilename` for display — sanitization
 * is one-way; the display column is the only place the raw filename
 * is shown to humans (with React's auto-escaping).
 *
 * The 64-char cap is a balance between "long enough for human
 * recognition" (e.g. "TOWER_GROUND_FLOOR_PLAN_REV_A.dxf") and "short
 * enough that an S3 key stays well under the AWS 1024-char limit
 * after we layer the prefix kosS3Key produces".
 */
export function sanitizeFilename(raw: string): string {
  if (!raw || typeof raw !== "string") return "drawing.dxf";

  // Strip any path component first — `..`, leading slashes, etc.
  // collapse to the bare basename. `pop()` on a non-empty split is
  // always defined here because split returns at least [""] for "".
  const basename = raw.split(/[\\/]/).pop() ?? raw;

  // Replace anything not [A-Za-z0-9._-] with `_`. This catches:
  //   - whitespace + control chars (\n \r \t \0 etc.)
  //   - quote variants ' " ` ‘ ’ “ ”
  //   - shell metacharacters $ & | ; > <
  //   - non-ASCII bytes (sanitize on the safe side)
  const stripped = basename.replace(/[^A-Za-z0-9._-]/g, "_");

  // Collapse runs of `_` produced by the replacement.
  const collapsed = stripped.replace(/_+/g, "_");

  // Reject empty result (`""` or `"___"` → originally all unsafe).
  if (!collapsed || collapsed === "_") return "drawing.dxf";

  if (collapsed.length <= 64) return collapsed;

  // Length cap with extension preservation. We only treat the trailing
  // ".xxx" as an extension when it is at most 10 chars including the
  // dot — anything longer is almost certainly content, not an
  // extension. This protects against a 200-char filename whose last
  // dot is in the middle.
  const dot = collapsed.lastIndexOf(".");
  if (dot > 0 && collapsed.length - dot <= 10) {
    const ext = collapsed.slice(dot);
    return collapsed.slice(0, 64 - ext.length) + ext;
  }
  return collapsed.slice(0, 64);
}
