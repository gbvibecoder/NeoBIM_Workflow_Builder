/**
 * Phase 4.1 · Fix 6 — region normalization.
 *
 * The TR-008 handler ships a `currencySymbol`/`region` for the BOQ
 * artifact. When the user didn't provide a Location node, the handler
 * defaults to `"USA (baseline)"` — which is correct upstream (CPWD
 * Static Rates use the en-US locale internally), but it should never
 * surface to the end user. BuildFlow targets Indian AEC.
 *
 * This helper is the single render-side gate for any `region` string
 * shown on the result page. Sacred upstream code (the handler) is
 * untouched per the preservation list.
 */

export function normalizeRegion(raw?: string | null): string {
  if (!raw || !raw.trim()) return "INDIA · BASELINE";
  const lower = raw.toLowerCase().trim();
  if (
    lower === "usa (baseline)" ||
    lower.includes("united states") ||
    lower.startsWith("usa ") ||
    lower === "usa" ||
    (lower.includes("baseline") && !lower.includes("india"))
  ) {
    return "INDIA · BASELINE";
  }
  // A real region — uppercase + tidy spacing
  return raw.toUpperCase().replace(/,\s+/g, ", ").trim();
}
