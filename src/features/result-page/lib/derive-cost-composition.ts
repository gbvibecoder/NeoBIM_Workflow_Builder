/**
 * Phase 4.1 · Fix 4 — cost composition derivation with fallbacks.
 *
 * The result page mounts a 4-5 segment horizontal bar showing the BOQ
 * total broken down by Civil / Steel / MEP / Finishings / Labor. Phase 4
 * shipped the live-derivation path only — when the BOQ table didn't carry
 * line-level division hints, the bar hid silently. That meant every BOQ
 * page rendered without it, defeating the whole purpose.
 *
 * This rewrite adds three tiers of derivation:
 *   1. Live   · keyword-match BOQ line descriptions (the Phase 4 path)
 *   2. IFC    · derive composition from IFC element category counts
 *   3. Static · sensible BOQ defaults marked indicative
 *
 * Tier 3 always returns a result for any BOQ workflow — the bar never
 * silently disappears. The component renders an `INDICATIVE` mono caption
 * when tier 2 or 3 was used.
 */

import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

export interface CostSegment {
  label: string;
  pct: number; // 0-100, integer
  color: string;
}

export interface CostComposition {
  segments: CostSegment[];
  /** Which derivation tier produced this. Drives the caption. */
  source: "live" | "ifc" | "indicative";
}

const DIVISIONS = [
  {
    label: "Civil",
    color: "#94A3B8",
    matches: ["civil", "structural", "concrete", "rcc", "wall", "slab", "column", "beam", "footing", "foundation"],
  },
  {
    label: "Steel",
    color: "#0EA5E9",
    matches: ["steel", "rebar", "reinforcement", "tmt", "rod"],
  },
  {
    label: "MEP",
    color: "#7C3AED",
    matches: ["mep", "electrical", "plumbing", "hvac", "wiring", "pipe", "duct", "conduit", "fire", "drainage"],
  },
  {
    label: "Finishings",
    color: "#D97706",
    matches: ["finish", "paint", "tile", "flooring", "plaster", "ceiling", "door", "window", "glaz", "lamination", "opening"],
  },
  {
    label: "Labor",
    color: "#0D9488",
    matches: ["labor", "labour", "mason", "helper", "carpenter", "equipment", "machinery", "lift", "scaffold"],
  },
] as const;

const STATIC_DEFAULTS: ReadonlyArray<CostSegment> = [
  { label: "Civil", pct: 48, color: "#94A3B8" },
  { label: "Steel", pct: 18, color: "#0EA5E9" },
  { label: "MEP", pct: 14, color: "#7C3AED" },
  { label: "Finishings", pct: 12, color: "#D97706" },
  { label: "Labor", pct: 8, color: "#0D9488" },
];

function tryLive(data: ResultPageData): CostComposition | null {
  const boqTable = data.tableData.find(
    t =>
      t.label?.toLowerCase().includes("bill of quantities") ||
      t.label?.toLowerCase().includes("boq") ||
      t.label?.toLowerCase().includes("cost"),
  );
  if (!boqTable || boqTable.rows.length === 0) return null;

  const headers = boqTable.headers.map(h => h.toLowerCase());
  const descIdx = headers.findIndex(h => h.includes("descr") || h.includes("item")) >= 0
    ? headers.findIndex(h => h.includes("descr") || h.includes("item"))
    : 1;
  const amountIdx = (() => {
    const cands = ["amount", "total", "cost"];
    for (let i = headers.length - 1; i >= 0; i--) {
      if (cands.some(c => headers[i].includes(c))) return i;
    }
    return -1;
  })();

  if (amountIdx < 0) return null;

  const buckets = new Map<string, { color: string; total: number }>();
  for (const div of DIVISIONS) buckets.set(div.label, { color: div.color, total: 0 });

  let grandTotal = 0;
  for (const row of boqTable.rows) {
    const desc = String(row[descIdx] ?? "").toLowerCase();
    const raw = row[amountIdx];
    const amount =
      typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[, ₹]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let bucket: string | null = null;
    for (const div of DIVISIONS) {
      if (div.matches.some(kw => desc.includes(kw))) {
        bucket = div.label;
        break;
      }
    }
    if (!bucket) bucket = "Civil";
    const b = buckets.get(bucket);
    if (b) {
      b.total += amount;
      grandTotal += amount;
    }
  }

  if (grandTotal <= 0) return null;

  const segments: CostSegment[] = [];
  for (const div of DIVISIONS) {
    const b = buckets.get(div.label);
    if (!b) continue;
    const pct = Math.round((b.total / grandTotal) * 100);
    if (pct > 0) segments.push({ label: div.label, pct, color: div.color });
  }
  const sum = segments.reduce((s, x) => s + x.pct, 0);
  if (sum !== 100 && segments.length > 0) segments[0].pct += 100 - sum;
  return segments.length > 0 ? { segments, source: "live" } : null;
}

function tryIfc(data: ResultPageData): CostComposition | null {
  // Look for an "Extracted Quantities" / IFC element table with a Category column.
  const ifcTable = data.tableData.find(t => {
    const lbl = t.label?.toLowerCase() ?? "";
    return lbl.includes("extracted quant") || lbl.includes("ifc") || lbl.includes("element");
  });
  if (!ifcTable || ifcTable.rows.length === 0) return null;

  const headers = ifcTable.headers.map(h => h.toLowerCase());
  const catIdx = headers.findIndex(h => h.includes("categor") || h.includes("type") || h.includes("class"));
  const elemIdx = headers.findIndex(h => h.includes("element"));
  const idx = catIdx >= 0 ? catIdx : elemIdx >= 0 ? elemIdx : 0;

  const counts = new Map<string, number>();
  for (const div of DIVISIONS) counts.set(div.label, 0);
  let total = 0;
  for (const row of ifcTable.rows) {
    const txt = String(row[idx] ?? "").toLowerCase();
    if (!txt) continue;
    let bucket: string | null = null;
    for (const div of DIVISIONS) {
      if (div.matches.some(kw => txt.includes(kw))) {
        bucket = div.label;
        break;
      }
    }
    if (!bucket) bucket = "Civil";
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;

  // IFC element counts → composition. We weight Civil 1.5× to reflect that each
  // wall/slab line item maps to far more rupees than a window or door does.
  const weights: Record<string, number> = {
    Civil: 1.5,
    Steel: 1.2,
    MEP: 0.9,
    Finishings: 0.7,
    Labor: 1.0,
  };
  let weightedTotal = 0;
  const weighted = new Map<string, number>();
  for (const [label, count] of counts) {
    const w = (weights[label] ?? 1) * count;
    weighted.set(label, w);
    weightedTotal += w;
  }
  if (weightedTotal === 0) return null;

  const segments: CostSegment[] = [];
  for (const div of DIVISIONS) {
    const w = weighted.get(div.label) ?? 0;
    if (w === 0) continue;
    const pct = Math.round((w / weightedTotal) * 100);
    if (pct > 0) segments.push({ label: div.label, pct, color: div.color });
  }
  const sum = segments.reduce((s, x) => s + x.pct, 0);
  if (sum !== 100 && segments.length > 0) segments[0].pct += 100 - sum;
  return segments.length > 0 ? { segments, source: "ifc" } : null;
}

export function deriveCostComposition(data: ResultPageData): CostComposition | null {
  if (!data.boqSummary) return null;
  return tryLive(data) ?? tryIfc(data) ?? { segments: [...STATIC_DEFAULTS], source: "indicative" };
}
