/**
 * Per-workflow primary KPI selector (Phase 2).
 *
 * Reuses the BOQ visualizer's canonical `formatINR` so every rupee value on
 * the result page is rendered identically to the BOQ deep view. Phase 1's
 * `$` literal bug is fixed at the source — this helper never accepts a
 * non-rupee currency symbol; the BOQ artifact's `_currencySymbol` field
 * is intentionally ignored, since the BuildFlow product is INR-only.
 */

import { formatINR } from "@/features/boq/components/recalc-engine";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

export interface PrimaryKpi {
  /** Short uppercase tracking-wider label e.g. "TOTAL PROJECT COST" */
  label: string;
  /** Pre-formatted display value with rupee + suffix baked in */
  value: string;
  /** Optional supporting text (sub-stat) */
  sublabel?: string;
}

const GFA_KEYWORDS = [
  "gfa",
  "gross floor area",
  "total area",
  "built-up area",
  "built up area",
  "builtup area",
];

function isGfaLabel(raw: string): boolean {
  const lower = raw.toLowerCase();
  return GFA_KEYWORDS.some(kw => lower.includes(kw));
}

function formatGfa(value: number): string {
  return `${Math.round(value).toLocaleString("en-IN")} m²`;
}

export function selectPrimaryKpi(data: ResultPageData): PrimaryKpi | null {
  // ── BOQ wins highest priority (always rupees, formatINR canonical) ──
  if (data.boqSummary && data.boqSummary.totalCost > 0) {
    const sublabel = data.boqSummary.gfa
      ? `across ${formatGfa(data.boqSummary.gfa)} built-up area`
      : data.boqSummary.region || undefined;
    return {
      label: "TOTAL PROJECT COST",
      value: formatINR(data.boqSummary.totalCost),
      sublabel,
    };
  }

  // ── IFC-bearing workflows surface Total GFA ──
  const hasIfcArtifact = data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"));
  if (hasIfcArtifact) {
    for (const m of data.kpiMetrics) {
      if (!isGfaLabel(m.label)) continue;
      const numeric =
        typeof m.value === "number"
          ? m.value
          : parseFloat(String(m.value).replace(/[, ]/g, ""));
      if (Number.isFinite(numeric) && numeric > 0) {
        return {
          label: "TOTAL GFA",
          value: formatGfa(numeric),
          sublabel: m.label,
        };
      }
    }
    if (data.model3dData?.kind === "procedural" && data.model3dData.gfa > 0) {
      return {
        label: "TOTAL GFA",
        value: formatGfa(data.model3dData.gfa),
        sublabel: `${data.model3dData.floors} floors · ${data.model3dData.buildingType}`,
      };
    }
  }

  return null;
}
