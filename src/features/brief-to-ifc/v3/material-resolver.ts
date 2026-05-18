/**
 * Material Resolver (TR-031) — canonical material ID normalisation.
 *
 * PURE DETERMINISTIC — no Opus / LLM calls. Runs in < 1 ms for typical
 * specs. Iterates every material_id reference in the BriefSpec
 * (materials, furniture, furniture parts, trim) and resolves each to a
 * canonical entry in MATERIAL_LIBRARY:
 *
 *   1. Exact match → keep as-is.
 *   2. Case-insensitive match → replace with canonical casing.
 *   3. Category-keyword fuzzy match → map to a sensible default.
 *   4. No match at all → fall back to "wall_paint_offwhite".
 *
 * Returns a shallow-cloned spec (arrays are new references, leaf objects
 * are cloned where a mutation occurred) so the caller's original
 * BriefSpec is never modified.
 */

import { MATERIAL_LIBRARY } from "./material-library";
import type { BriefSpec } from "./types";

// ─── Types ────────────────────────────────────────────────────────────

export interface MaterialResolverMetrics {
  /** Material IDs that matched exactly (no change needed). */
  resolved: number;
  /** Material IDs resolved via case-insensitive or keyword match. */
  fuzzy: number;
  /** Material IDs that fell through to the default fallback. */
  fallback: number;
}

export interface MaterialResolverResult {
  spec: BriefSpec;
  metrics: MaterialResolverMetrics;
}

// ─── Lookup structures (module-level, built once) ─────────────────────

const EXACT_SET = new Set<string>(MATERIAL_LIBRARY);

/** lowercase → canonical id */
const LOWERCASE_MAP = new Map<string, string>();
for (const id of MATERIAL_LIBRARY) {
  LOWERCASE_MAP.set(id.toLowerCase(), id);
}

const DEFAULT_FALLBACK = "wall_paint_offwhite";

/**
 * Category keyword → canonical material id. Checked against the
 * lowercased input in declaration order — first match wins.
 */
const KEYWORD_MAP: [string, string][] = [
  ["wood", "wood_pale"],
  ["metal", "aluminium"],
  ["steel", "aluminium"],
  ["iron", "aluminium"],
  ["concrete", "concrete_polished"],
  ["glass", "glass_clear"],
  ["fabric", "fabric_neutral"],
  ["cloth", "fabric_neutral"],
  ["stone", "stone_marble"],
  ["rock", "stone_marble"],
  ["ceramic", "ceramic_white"],
  ["tile", "ceramic_white"],
  ["leather", "leather_black"],
  ["plastic", "plastic_white"],
  ["paper", "paper_neutral"],
  ["rubber", "rubber_black"],
  ["chrome", "chrome_steel"],
  ["brass", "brass"],
  ["copper", "copper"],
];

// ─── Internal helpers ─────────────────────────────────────────────────

function resolveOne(
  raw: string,
  metrics: MaterialResolverMetrics,
): string {
  // 1. Exact match
  if (EXACT_SET.has(raw)) {
    metrics.resolved++;
    return raw;
  }

  // 2. Case-insensitive match
  const lower = raw.toLowerCase();
  const canonical = LOWERCASE_MAP.get(lower);
  if (canonical !== undefined) {
    metrics.fuzzy++;
    return canonical;
  }

  // 3. Keyword fuzzy match
  for (const [keyword, fallback] of KEYWORD_MAP) {
    if (lower.includes(keyword)) {
      metrics.fuzzy++;
      return fallback;
    }
  }

  // 4. Default fallback
  metrics.fallback++;
  return DEFAULT_FALLBACK;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Resolve all material_id references in `spec` to canonical
 * MATERIAL_LIBRARY entries. Returns a shallow-cloned spec (original
 * untouched) and resolution metrics.
 */
export function resolveMaterials(spec: BriefSpec): MaterialResolverResult {
  const metrics: MaterialResolverMetrics = {
    resolved: 0,
    fuzzy: 0,
    fallback: 0,
  };

  // Shallow-clone all arrays that may be mutated.
  const materials = spec.materials.map((m) => {
    const resolvedId = resolveOne(m.id, metrics);
    return resolvedId !== m.id ? { ...m, id: resolvedId } : m;
  });

  const furniture = spec.furniture?.map((f) => {
    const resolvedMaterialId = resolveOne(f.material_id, metrics);
    const parts = f.parts?.map((p) => {
      const resolvedPartMaterialId = resolveOne(p.material_id, metrics);
      return resolvedPartMaterialId !== p.material_id
        ? { ...p, material_id: resolvedPartMaterialId }
        : p;
    });

    const changed =
      resolvedMaterialId !== f.material_id ||
      (parts !== undefined && parts !== f.parts);

    return changed
      ? {
          ...f,
          material_id: resolvedMaterialId,
          ...(parts !== undefined ? { parts } : {}),
        }
      : f;
  });

  const trim = spec.trim?.map((t) => {
    const resolvedId = resolveOne(t.material_id, metrics);
    return resolvedId !== t.material_id
      ? { ...t, material_id: resolvedId }
      : t;
  });

  const result: BriefSpec = {
    ...spec,
    materials,
    ...(furniture !== undefined ? { furniture } : {}),
    ...(trim !== undefined ? { trim } : {}),
  };

  return { spec: result, metrics };
}
