"use client";

import { Database, Wifi, FileText, Info } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";

interface DataSourcesSummaryProps {
  data: BOQData;
}

export function DataSourcesSummary({ data }: DataSourcesSummaryProps) {
  // Count lines by source
  const sourceCounts = { "ifc-geometry": 0, "ifc-derived": 0, "benchmark": 0, "provisional": 0 };
  for (const line of data.lines) {
    sourceCounts[line.source] = (sourceCounts[line.source] || 0) + 1;
  }
  const total = data.lines.length || 1;
  const livePercent = Math.round(((sourceCounts["ifc-geometry"] + sourceCounts["ifc-derived"]) / total) * 100);
  const benchmarkPercent = Math.round((sourceCounts["benchmark"] / total) * 100);
  const provisionalPercent = Math.round((sourceCounts["provisional"] / total) * 100);

  // Pricing source
  const pricingSource = data.pricingMetadata?.source ?? "cpwd_static";
  const marketStatus = data.pricingMetadata?.marketIntelligenceStatus;
  const lastUpdate = data.pricingMetadata?.lastMarketUpdate;
  const city = data.pricingMetadata?.cityUsed;
  const aaceClass = data.aaceClass ?? "Class 4";
  const aaceDesc = data.aaceDescription ?? "Feasibility study — accuracy ±25-30%.";

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Database size={14} color="#0D9488" />
        <h3 className="text-sm font-semibold" style={{ color: "#1A1A1A" }}>Data Sources</h3>
      </div>

      {/* Source breakdown bar */}
      <div className="h-2 rounded-full overflow-hidden flex mb-3" style={{ background: "#F3F4F6" }}>
        {livePercent > 0 && (
          <div style={{ width: `${livePercent}%`, background: "#0D9488" }} title={`IFC Measured: ${livePercent}%`} />
        )}
        {benchmarkPercent > 0 && (
          <div style={{ width: `${benchmarkPercent}%`, background: "#D97706" }} title={`Benchmark: ${benchmarkPercent}%`} />
        )}
        {provisionalPercent > 0 && (
          <div style={{ width: `${provisionalPercent}%`, background: "#DC2626" }} title={`Provisional: ${provisionalPercent}%`} />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="w-2 h-2 rounded-full" style={{ background: "#0D9488" }} />
          <span style={{ color: "#4B5563" }}>IFC Measured {livePercent}%</span>
        </span>
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="w-2 h-2 rounded-full" style={{ background: "#D97706" }} />
          <span style={{ color: "#4B5563" }}>Benchmark {benchmarkPercent}%</span>
        </span>
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="w-2 h-2 rounded-full" style={{ background: "#DC2626" }} />
          <span style={{ color: "#4B5563" }}>Provisional {provisionalPercent}%</span>
        </span>
      </div>

      {/* Pricing & AACE */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Wifi size={10} color={pricingSource === "market_intelligence" ? "#059669" : pricingSource === "mixed" ? "#D97706" : "#9CA3AF"} />
          <span className="text-[10px]" style={{ color: "#4B5563" }}>
            Pricing: {pricingSource === "market_intelligence" ? "Live Market Intelligence" : pricingSource === "mixed" ? "Mixed (live + static)" : "CPWD Static Rates"}
            {marketStatus === "success" && " ✓"}
            {city && ` — ${city}`}
            {lastUpdate && ` (${new Date(lastUpdate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`}
          </span>
        </div>
        <div className="flex items-center gap-2 group relative">
          <FileText size={10} color="#0D9488" />
          <span className="text-[10px] font-medium" style={{ color: "#0D9488" }}>
            {aaceClass}
          </span>
          <Info size={8} color="#9CA3AF" />
          {/* AACE tooltip */}
          <div
            className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50"
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.06)",
              borderRadius: 8,
              padding: "8px 10px",
              width: 280,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          >
            <div className="text-[10px] font-semibold mb-1" style={{ color: "#0D9488" }}>
              {aaceClass} Estimate
            </div>
            <div className="text-[10px] leading-relaxed" style={{ color: "#4B5563" }}>
              {aaceDesc}
            </div>
          </div>
        </div>

        {/* Uncertainty */}
        {data.costRange && data.costRange.uncertaintyPercent > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: "#9CA3AF" }}>
              Estimate uncertainty: ±{data.costRange.uncertaintyPercent}% — {data.lines.length} line items
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
