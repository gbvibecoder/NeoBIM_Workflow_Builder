/**
 * Defensive utility — strips price / cost / currency data from any metadata
 * object before it reaches a hero, ribbon, or panel. Applied at the edge of
 * `useExecutionResult` so nothing downstream has to remember the rule.
 *
 * Why: the product contract forbids `$X.XX` or "Cost" labels anywhere on the
 * results surface. This runs on an unknown-shape payload coming from Prisma
 * `tileResults` JSON or the live execution store, so we can't rely on a
 * typed filter — we purge defensively.
 */

const PRICE_KEY_RE = /cost|price|usd|dollar|amount|spend/i;
const PRICE_VALUE_RE = /^\s*\$\s*[0-9]/;

export function stripPrice<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(walk);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      if (PRICE_KEY_RE.test(key)) continue;
      const v = src[key];
      if (typeof v === "string" && PRICE_VALUE_RE.test(v)) continue;
      out[key] = walk(v);
    }
    return out;
  }
  return value;
}

/** True when a metric label/value would render a forbidden price string. */
export function isPriceLike(label: string, value: string | number): boolean {
  if (PRICE_KEY_RE.test(label)) return true;
  if (typeof value === "string" && PRICE_VALUE_RE.test(value)) return true;
  return false;
}
