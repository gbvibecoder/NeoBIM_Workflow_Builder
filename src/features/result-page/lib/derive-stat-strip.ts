/**
 * Pure helper: produces the workflow-aware stat strip mounted at the top
 * of the Data section. Each workflow type gets 3-4 mono stat tiles tuned
 * to what an architect / BIM manager actually wants to see at a glance.
 */

import { normalizeRegion } from "@/features/result-page/lib/normalize-region";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

export interface StatTile {
  /** Mono uppercase tag e.g. "STORIES" */
  tag: string;
  /** Pre-formatted value e.g. "3" or "₹274/m²" */
  value: string;
  /** Optional supporting caption e.g. "above benchmark" */
  hint?: string;
  /** Color override for the value text. */
  color?: string;
}

function fmtIN(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString("en-IN", opts);
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function deriveStatStrip(data: ResultPageData): StatTile[] | null {
  // ── BOQ workflow ──
  if (data.boqSummary) {
    const cost = data.boqSummary.totalCost;
    const gfa = data.boqSummary.gfa;
    const perM2 = gfa > 0 ? cost / gfa : 0;
    return [
      {
        tag: "TOTAL",
        value: cost >= 10_000_000 ? `₹${(cost / 10_000_000).toFixed(2)} Cr` : cost >= 100_000 ? `₹${(cost / 100_000).toFixed(2)} L` : `₹${fmtIN(cost, { maximumFractionDigits: 0 })}`,
        color: "#0D9488",
      },
      {
        tag: "COST/M²",
        value: perM2 > 0 ? `₹${fmtIN(perM2, { maximumFractionDigits: 0 })}` : "—",
      },
      {
        tag: "BUILT-UP",
        value: gfa > 0 ? `${fmtIN(gfa, { maximumFractionDigits: 0 })} m²` : "—",
      },
      {
        tag: "REGION",
        value: normalizeRegion(data.boqSummary.region),
      },
    ];
  }

  // ── IFC workflow (model 3d + ifc artifact) ──
  const ifcFile = data.fileDownloads.find(f => f.name.toLowerCase().endsWith(".ifc"));
  if (ifcFile) {
    const elementMetric = data.kpiMetrics.find(m =>
      m.label.toLowerCase().includes("element") || m.label.toLowerCase().includes("entit"),
    );
    const elementCount = elementMetric
      ? typeof elementMetric.value === "number"
        ? elementMetric.value
        : parseFloat(String(elementMetric.value).replace(/[, ]/g, ""))
      : null;
    const tiles: StatTile[] = [];
    if (elementCount && Number.isFinite(elementCount)) {
      tiles.push({ tag: "ELEMENTS", value: fmtIN(elementCount), color: "#0D9488" });
    } else if (data.model3dData?.kind === "procedural") {
      tiles.push({ tag: "FLOORS", value: String(data.model3dData.floors), color: "#0D9488" });
    }
    if (data.model3dData?.kind === "procedural") {
      tiles.push({ tag: "GFA", value: `${fmtIN(Math.round(data.model3dData.gfa))} m²` });
    }
    if (ifcFile.size > 0) {
      tiles.push({ tag: "FILE SIZE", value: fmtBytes(ifcFile.size) });
    }
    tiles.push({
      tag: "ENGINE",
      value: ifcFile.ifcEngine === "ifcopenshell" ? "RICH · IfcOpenShell" : "LEAN · TS",
      color: ifcFile.ifcEngine === "ifcopenshell" ? "#059669" : "#D97706",
    });
    return tiles.slice(0, 4);
  }

  // ── Floor plan workflow (CAD project) ──
  if (data.model3dData?.kind === "floor-plan-interactive") {
    const s = data.model3dData.summary;
    return [
      { tag: "ROOMS", value: String(s.totalRooms), color: "#0D9488" },
      { tag: "AREA", value: `${fmtIN(Math.round(s.totalArea_sqm))} m²` },
      { tag: "WALLS", value: String(s.totalWalls) },
      { tag: "OPENINGS", value: `${s.totalDoors + s.totalWindows}` },
    ];
  }

  // ── Video workflow ──
  if (data.videoData?.videoUrl) {
    const v = data.videoData;
    return [
      { tag: "DURATION", value: `${v.durationSeconds}s`, color: "#7C3AED" },
      { tag: "SHOTS", value: String(v.segments?.length ?? v.shotCount) },
      { tag: "PIPELINE", value: v.pipeline?.toUpperCase() ?? "KLING" },
      { tag: "FORMAT", value: "1080p · MP4" },
    ];
  }

  // ── Clash workflow ──
  if (data.clashSummary) {
    const c = data.clashSummary;
    return [
      { tag: "TOTAL", value: String(c.total), color: c.total > 0 ? "#D97706" : "#059669" },
      { tag: "CRITICAL", value: String(c.critical), color: c.critical > 0 ? "#DC2626" : "#94A3B8" },
      { tag: "MAJOR", value: String(c.major), color: c.major > 0 ? "#D97706" : "#94A3B8" },
      { tag: "MINOR", value: String(c.minor), color: c.minor > 0 ? "#A16207" : "#94A3B8" },
    ];
  }

  // ── Generic fallback: pipeline stats ──
  if (data.pipelineSteps.length > 0) {
    return [
      { tag: "STEPS", value: `${data.successNodes}/${data.totalNodes}`, color: "#0D9488" },
      { tag: "DURATION", value: fmtMs(data.executionMeta.durationMs) },
      { tag: "ARTIFACTS", value: String(data.totalArtifacts) },
    ];
  }

  return null;
}
