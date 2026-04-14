"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Ruler, BarChart3, AlertTriangle, FileText, Info, Wifi } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";

interface DataSourcesSummaryProps {
  data: BOQData;
}

export function DataSourcesSummary({ data }: DataSourcesSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });

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

  const pricingIconColor =
    pricingSource === "market_intelligence" ? "#059669" :
    pricingSource === "mixed" ? "#D97706" : "#9CA3AF";

  return (
    <div
      ref={ref}
      style={{
        background: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
        padding: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Ruler size={14} color="#0D9488" />
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", margin: 0 }}>Data Sources</h3>
      </div>

      {/* Source breakdown bar */}
      <div
        style={{
          height: 8,
          borderRadius: 9999,
          background: "#F3F4F6",
          overflow: "hidden",
          display: "flex",
          marginBottom: 12,
        }}
      >
        {livePercent > 0 && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: isInView ? `${livePercent}%` : 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
            style={{ height: "100%", background: "#059669" }}
            title={`IFC Measured: ${livePercent}%`}
          />
        )}
        {benchmarkPercent > 0 && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: isInView ? `${benchmarkPercent}%` : 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
            style={{ height: "100%", background: "#D97706" }}
            title={`Benchmark: ${benchmarkPercent}%`}
          />
        )}
        {provisionalPercent > 0 && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: isInView ? `${provisionalPercent}%` : 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.5 }}
            style={{ height: "100%", background: "#DC2626" }}
            title={`Provisional: ${provisionalPercent}%`}
          />
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 16 }}>
        {[
          { icon: Ruler, color: "#059669", label: "IFC Measured", value: livePercent },
          { icon: BarChart3, color: "#D97706", label: "Benchmark", value: benchmarkPercent },
          { icon: AlertTriangle, color: "#DC2626", label: "Provisional", value: provisionalPercent },
        ].map((item) => (
          <span
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: item.color, flexShrink: 0 }} />
            <span style={{ color: "#4B5563" }}>{item.label}</span>
            <span style={{ color: "#9CA3AF" }}>{item.value}%</span>
          </span>
        ))}
      </div>

      {/* Pricing & AACE */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Wifi size={12} color={pricingIconColor} />
          <span style={{ fontSize: 11, color: "#4B5563" }}>
            Pricing: {pricingSource === "market_intelligence" ? "Live Market Intelligence" : pricingSource === "mixed" ? "Mixed (live + static)" : "CPWD Static Rates"}
            {marketStatus === "success" && " ✓"}
            {city && ` — ${city}`}
            {lastUpdate && ` (${new Date(lastUpdate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`}
          </span>
        </div>
        <div className="relative group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={12} color="#0D9488" />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 500,
              background: "#F0FDFA",
              color: "#0D9488",
            }}
          >
            {aaceClass}
          </span>
          <Info size={10} color="#9CA3AF" style={{ cursor: "help" }} />
          {/* AACE tooltip */}
          <div
            className="hidden group-hover:block"
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              marginBottom: 8,
              zIndex: 50,
              background: "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: 12,
              padding: "10px 12px",
              width: 280,
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#0D9488", marginBottom: 4 }}>
              {aaceClass} Estimate
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.6, color: "#4B5563" }}>
              {aaceDesc}
            </div>
          </div>
        </div>

        {/* Uncertainty */}
        {data.costRange && data.costRange.uncertaintyPercent > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>
              Estimate uncertainty: ±{data.costRange.uncertaintyPercent}% — {data.lines.length} line items
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
