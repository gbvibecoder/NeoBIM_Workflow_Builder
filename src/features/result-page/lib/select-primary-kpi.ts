/**
 * Per-workflow primary KPI selector (Phase 1 D1).
 *
 * Returns ONE hero number per workflow result type, or null when the workflow
 * has no number worth heroing (video / floor-plan / 3D — the visual IS the KPI).
 *
 * Decisions per Phase 1 brief:
 * - BOQ workflows  → Total Cost in ₹ Cr / L / formatted-INR
 * - IFC workflows  → Total GFA in m² (read from KPI metric labeled gfa/total area/built-up area)
 * - Video / floor-plan / 3D / image / clash / table / text → null
 */

import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

export interface PrimaryKpi {
  /** Short uppercase tracking-wider label e.g. "TOTAL COST" */
  label: string;
  /** Pre-formatted display value with currency / unit baked in */
  value: string;
  /** Optional supporting text e.g. "across 2,284 m² built-up area" */
  sublabel?: string;
}

const GFA_KEYWORDS = ["gfa", "gross floor area", "total area", "built-up area", "built up area", "builtup area"];

function isGfaLabel(raw: string): boolean {
  const lower = raw.toLowerCase();
  return GFA_KEYWORDS.some(kw => lower.includes(kw));
}

function formatRupees(amount: number, currencySymbol: string = "₹"): string {
  if (amount >= 10_000_000) return `${currencySymbol} ${(amount / 10_000_000).toFixed(1)} Cr`;
  if (amount >= 100_000) return `${currencySymbol} ${(amount / 100_000).toFixed(1)} L`;
  if (amount > 0) return `${currencySymbol}${amount.toLocaleString("en-IN")}`;
  return `${currencySymbol}0`;
}

function formatGfa(value: number): string {
  return `${Math.round(value).toLocaleString("en-IN")} m²`;
}

export function selectPrimaryKpi(data: ResultPageData): PrimaryKpi | null {
  // ── BOQ wins highest priority for KPI selection ──
  if (data.boqSummary && data.boqSummary.totalCost > 0) {
    const cost = data.boqSummary.totalCost;
    const symbol = data.boqSummary.currencySymbol || "₹";
    const sublabel = data.boqSummary.gfa
      ? `across ${formatGfa(data.boqSummary.gfa)} built-up area`
      : data.boqSummary.region || undefined;
    return {
      label: "TOTAL COST",
      value: formatRupees(cost, symbol),
      sublabel,
    };
  }

  // ── IFC-bearing workflows surface Total GFA ──
  const hasIfcArtifact = data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"));
  if (hasIfcArtifact) {
    // Look at incoming KPI metrics for a GFA-shaped one
    for (const m of data.kpiMetrics) {
      if (!isGfaLabel(m.label)) continue;
      const numeric = typeof m.value === "number" ? m.value : parseFloat(String(m.value).replace(/[, ]/g, ""));
      if (Number.isFinite(numeric) && numeric > 0) {
        return {
          label: "TOTAL GFA",
          value: formatGfa(numeric),
          sublabel: m.label,
        };
      }
    }
    // Fallback: derive from procedural model if present
    if (data.model3dData?.kind === "procedural" && data.model3dData.gfa > 0) {
      return {
        label: "TOTAL GFA",
        value: formatGfa(data.model3dData.gfa),
        sublabel: `${data.model3dData.floors} floors · ${data.model3dData.buildingType}`,
      };
    }
  }

  // Video / floor-plan / 3D / image / clash / generic → no KPI overlay
  return null;
}
