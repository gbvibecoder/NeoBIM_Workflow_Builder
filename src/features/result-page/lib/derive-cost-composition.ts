/**
 * Pure helper: maps the BOQ table preview into a 4-segment cost composition
 * breakdown (Civil / MEP / Finishings / Labor + Equipment), used by the
 * `CostCompositionBar` section enrichment under the BOQ hero.
 *
 * Heuristic, not authoritative — the BOQ visualizer holds the canonical
 * breakdown via its `mepBreakdown` and division charts. This helper is a
 * lightweight glance for the result-page wrapper. If the BOQ table doesn't
 * have line-level division hints, returns `null` and the caller hides
 * the bar.
 */

import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

export interface CostSegment {
  label: string;
  pct: number; // 0-100, integer
  color: string;
}

const KEYWORDS: ReadonlyArray<{ label: string; color: string; matches: ReadonlyArray<string> }> = [
  {
    label: "Civil",
    color: "#94A3B8",
    matches: ["civil", "structural", "concrete", "rcc", "wall", "slab", "column", "beam", "footing", "foundation"],
  },
  {
    label: "MEP",
    color: "#0EA5E9",
    matches: ["mep", "electrical", "plumbing", "hvac", "wiring", "pipe", "duct", "conduit", "fire", "drainage"],
  },
  {
    label: "Finishings",
    color: "#7C3AED",
    matches: ["finish", "paint", "tile", "flooring", "plaster", "ceiling", "door", "window", "glaz", "lamination"],
  },
  {
    label: "Labor + Equipment",
    color: "#0D9488",
    matches: ["labor", "labour", "mason", "helper", "carpenter", "equipment", "machinery", "lift", "scaffold"],
  },
];

export function deriveCostComposition(data: ResultPageData): CostSegment[] | null {
  // Use the first BOQ-shaped table
  const boqTable = data.tableData.find(
    t =>
      t.label?.toLowerCase().includes("bill of quantities") ||
      t.label?.toLowerCase().includes("boq") ||
      t.label?.toLowerCase().includes("cost"),
  );
  if (!boqTable || boqTable.rows.length === 0) return null;

  // Find the description column (usually first non-numeric, but defensively column 0 or 1)
  // and the amount column (last numeric column).
  const headers = boqTable.headers.map(h => h.toLowerCase());
  const descIdx = headers.findIndex(h => h.includes("descr") || h.includes("item")) >= 0
    ? headers.findIndex(h => h.includes("descr") || h.includes("item"))
    : 1;
  const amountIdx = (() => {
    const candidates = ["amount", "total", "cost"];
    for (let i = headers.length - 1; i >= 0; i--) {
      if (candidates.some(c => headers[i].includes(c))) return i;
    }
    return headers.length - 1;
  })();

  const buckets = new Map<string, { color: string; total: number }>();
  for (const seg of KEYWORDS) buckets.set(seg.label, { color: seg.color, total: 0 });

  let grandTotal = 0;
  for (const row of boqTable.rows) {
    const desc = String(row[descIdx] ?? "").toLowerCase();
    const rawAmount = row[amountIdx];
    const amount =
      typeof rawAmount === "number"
        ? rawAmount
        : parseFloat(String(rawAmount).replace(/[, ₹]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let bucketLabel: string | null = null;
    for (const seg of KEYWORDS) {
      if (seg.matches.some(kw => desc.includes(kw))) {
        bucketLabel = seg.label;
        break;
      }
    }
    if (!bucketLabel) bucketLabel = "Civil"; // safe default — most BOQ rows are civil works

    const bucket = buckets.get(bucketLabel);
    if (bucket) {
      bucket.total += amount;
      grandTotal += amount;
    }
  }

  if (grandTotal <= 0) return null;

  const segments: CostSegment[] = [];
  for (const seg of KEYWORDS) {
    const bucket = buckets.get(seg.label);
    if (!bucket) continue;
    const pct = Math.round((bucket.total / grandTotal) * 100);
    if (pct > 0) segments.push({ label: seg.label, pct, color: seg.color });
  }

  // Normalize so segments sum to exactly 100 (rounding drift)
  const sum = segments.reduce((s, x) => s + x.pct, 0);
  if (sum !== 100 && segments.length > 0) {
    segments[0].pct += 100 - sum;
  }

  return segments.length > 0 ? segments : null;
}
