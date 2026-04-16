"use client";

/**
 * QualityPanel — Phase 1 honest layout-quality surface.
 *
 * Reads lastLayoutMetrics + lastQualityFlags + lastFeasibilityWarnings from
 * the store (populated by FloorPlanViewer.handleGenerateFromPrompt after a
 * successful API call). Shows the headline metrics and a list of quality
 * flags with severity icons. NOT the full "Explain" panel — that is Phase 2.
 */
import React from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import { computeHonestScore, type QualityFlag, type QualitySeverity } from "@/features/floor-plan/lib/layout-metrics";

const SEVERITY_STYLES: Record<QualitySeverity, { bg: string; border: string; text: string; icon: string; label: string }> = {
  critical: { bg: "bg-red-50",   border: "border-red-200",   text: "text-red-800",   icon: "⚠️", label: "Critical" },
  warning:  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", icon: "⚠",  label: "Warning"  },
  info:     { bg: "bg-blue-50",  border: "border-blue-200",  text: "text-blue-800",  icon: "ℹ",  label: "Info"     },
};

function MetricBox({ label, value, suffix }: { label: string; value: React.ReactNode; suffix?: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-gray-800">
        {value}
        {suffix && <span className="ml-0.5 text-[10px] font-normal text-gray-500">{suffix}</span>}
      </div>
    </div>
  );
}

function FlagCard({ flag }: { flag: QualityFlag }) {
  const s = SEVERITY_STYLES[flag.severity];
  return (
    <div className={`rounded-md border ${s.border} ${s.bg} px-3 py-2`}>
      <div className="flex items-start gap-2">
        <span className="text-[13px] leading-tight">{s.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-semibold ${s.text}`}>
            <span className="uppercase tracking-wider">{s.label}</span>
            <span className="ml-1.5 font-mono text-[9px] opacity-70">{flag.code}</span>
          </div>
          <div className={`mt-1 text-[11px] leading-snug ${s.text}`}>{flag.message}</div>
          <div className="mt-1.5 text-[10px] italic leading-snug text-gray-600">→ {flag.suggestion}</div>
        </div>
      </div>
    </div>
  );
}

export function QualityPanel() {
  const metrics = useFloorPlanStore((s) => s.lastLayoutMetrics);
  const flags = useFloorPlanStore((s) => s.lastQualityFlags);
  const warnings = useFloorPlanStore((s) => s.lastFeasibilityWarnings);
  const dataSource = useFloorPlanStore((s) => s.dataSource);

  if (!metrics) {
    return (
      <div className="px-4 py-6 text-center">
        <div className="text-[11px] text-gray-500">
          {dataSource === "sample"
            ? "Sample layouts don't have generated quality metrics."
            : dataSource === "saved" || dataSource === "blank"
              ? "Generate a floor plan from a prompt to see quality metrics."
              : "No quality metrics yet — generate a floor plan to see them."}
        </div>
      </div>
    );
  }

  const efficiencyColor =
    metrics.efficiency_pct < 70 ? "text-red-600" :
    metrics.efficiency_pct < 80 ? "text-amber-600" :
    "text-green-600";

  const doorColor =
    metrics.door_coverage_pct < 80 ? "text-red-600" :
    metrics.door_coverage_pct < 95 ? "text-amber-600" :
    "text-green-600";

  const honest = computeHonestScore(metrics);
  const gradeColor =
    honest.grade === "A" ? "text-green-600 bg-green-50 border-green-200" :
    honest.grade === "B" ? "text-emerald-600 bg-emerald-50 border-emerald-200" :
    honest.grade === "C" ? "text-amber-600 bg-amber-50 border-amber-200" :
    honest.grade === "D" ? "text-orange-600 bg-orange-50 border-orange-200" :
    "text-red-600 bg-red-50 border-red-200";

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Phase 1 — Honest Score header */}
      <div className={`rounded-md border ${gradeColor} px-3 py-2.5 flex items-center gap-3`}>
        <div className={`text-3xl font-black leading-none ${gradeColor.split(" ")[0]}`}>
          {honest.grade}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-gray-800">{honest.score}</span>
            <span className="text-[10px] text-gray-500">/ 100 honest score</span>
          </div>
          <div className="text-[10px] text-gray-500 leading-tight">
            Plot fidelity + connectivity + adjacency. Not the design-checks score.
          </div>
        </div>
      </div>

      {honest.rationale.length > 0 && (
        <details className="rounded-md border border-gray-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Score breakdown ({honest.rationale.length})
          </summary>
          <div className="border-t border-gray-100 px-3 py-2 space-y-0.5">
            {honest.rationale.map((line, i) => (
              <div key={i} className="text-[10px] font-mono text-gray-700">{line}</div>
            ))}
          </div>
        </details>
      )}

      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Headline metrics
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <MetricBox label="Efficiency" value={<span className={efficiencyColor}>{metrics.efficiency_pct}</span>} suffix="%" />
          <MetricBox label="Door coverage" value={<span className={doorColor}>{metrics.door_coverage_pct}</span>} suffix="%" />
          <MetricBox label="Plot area" value={metrics.plot_area_sqft.toLocaleString()} suffix="sqft" />
          <MetricBox label="Rooms" value={metrics.total_room_area_sqft.toLocaleString()} suffix="sqft" />
          <MetricBox label="Corridor" value={metrics.corridor_area_sqft.toLocaleString()} suffix="sqft" />
          <MetricBox label="Voids" value={<span className={metrics.void_area_sqft > 300 ? "text-amber-600" : "text-gray-800"}>{metrics.void_area_sqft.toLocaleString()}</span>} suffix="sqft" />
          <MetricBox label="Total rooms" value={metrics.total_rooms} />
          <MetricBox label="W/ doors" value={`${metrics.rooms_with_doors}/${metrics.total_rooms}`} />
        </div>
        {metrics.required_adjacencies > 0 && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <MetricBox label="Adjacencies" value={`${metrics.satisfied_adjacencies}/${metrics.required_adjacencies}`} />
            <MetricBox label="Dim deviation" value={metrics.mean_dim_deviation_pct} suffix="%" />
          </div>
        )}
      </div>

      {(flags.length > 0 || warnings.length > 0) && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Issues &amp; suggestions
          </div>
          <div className="space-y-1.5">
            {warnings.map((w, i) => (
              <FlagCard
                key={`w-${i}`}
                flag={{
                  severity: w.severity === "info" ? "info" : "warning",
                  code: w.kind === "UNDER_FULL" ? "AREA_SHORTFALL" : "AREA_SHORTFALL",
                  message: w.message,
                  suggestion: "Add a corridor, larger rooms, or extra rooms (utility, store) to fill the slack.",
                }}
              />
            ))}
            {flags.map((f, i) => (
              <FlagCard key={`f-${i}`} flag={f} />
            ))}
          </div>
        </div>
      )}

      {flags.length === 0 && warnings.length === 0 && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-800">
          ✓ Layout meets all Phase 1 quality checks.
        </div>
      )}

      {metrics.orphan_rooms.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-red-700">
            Orphan rooms ({metrics.orphan_rooms.length})
          </div>
          <div className="mt-1 text-[11px] leading-snug text-red-800">
            {metrics.orphan_rooms.join(", ")}
          </div>
        </div>
      )}

      {metrics.dim_deviations.length > 0 && metrics.mean_dim_deviation_pct > 5 && (
        <details className="rounded-md border border-gray-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Per-room dim deviations ({metrics.dim_deviations.length})
          </summary>
          <div className="border-t border-gray-100 px-3 py-2 space-y-1">
            {metrics.dim_deviations.slice(0, 20).map((d, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 text-[10px]">
                <span className="truncate text-gray-700">{d.room} <span className="text-gray-400">{d.axis}</span></span>
                <span className="shrink-0 font-mono text-gray-600">
                  {d.asked_ft}→{d.got_ft}ft
                  <span className={`ml-1 ${d.deviation_pct > 10 ? "text-amber-600" : "text-gray-400"}`}>
                    {d.deviation_pct > 0 ? "+" : ""}{d.deviation_pct}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
