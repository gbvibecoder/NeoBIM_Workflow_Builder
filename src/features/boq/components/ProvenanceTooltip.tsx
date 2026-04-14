"use client";

import type { BOQLineItem } from "@/features/boq/components/types";
import { formatINRFull } from "@/features/boq/components/recalc-engine";

interface ProvenanceTooltipProps {
  line: BOQLineItem;
}

const CONFIDENCE_THEME = {
  HIGH: { bg: "#ECFDF5", color: "#059669" },
  MEDIUM: { bg: "#FFFBEB", color: "#D97706" },
  LOW: { bg: "#FEF2F2", color: "#DC2626" },
};

/**
 * Hoverable tooltip showing per-line rate breakdown and data provenance.
 * Wraps children and shows tooltip on hover.
 */
export function ProvenanceTooltip({ line, children }: ProvenanceTooltipProps & { children: React.ReactNode }) {
  const hasBreakdown = line.materialRate > 0 || line.laborRate > 0 || line.equipmentRate > 0;
  const factors = line.lineConfidence?.factors ?? [];
  const confidenceLabel = line.lineConfidence?.score?.toUpperCase() ?? (
    line.confidence >= 80 ? "HIGH" : line.confidence >= 55 ? "MEDIUM" : "LOW"
  );
  const confidenceTheme = CONFIDENCE_THEME[confidenceLabel as keyof typeof CONFIDENCE_THEME] ?? CONFIDENCE_THEME.LOW;

  return (
    <span className="relative group/prov inline-flex items-center">
      {children}
      <div
        className="absolute bottom-full left-0 mb-2 hidden group-hover/prov:block z-50 pointer-events-none"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 10,
          padding: "10px 12px",
          width: 260,
          boxShadow: "0 10px 25px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.05)",
        }}
      >
        {/* Rate header */}
        <div className="text-[11px] font-semibold mb-2" style={{ color: "#1A1A1A" }}>
          Rate: {formatINRFull(line.unitRate)}/{line.unit}
        </div>

        {/* M/L/E breakdown */}
        {hasBreakdown && (
          <div className="flex flex-col gap-1 mb-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 6 }}>
            {line.materialRate > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "#4B5563" }}>Material</span>
                <span style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
                  {formatINRFull(line.materialRate)}/{line.unit}
                </span>
              </div>
            )}
            {line.laborRate > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "#4B5563" }}>Labour</span>
                <span style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
                  {formatINRFull(line.laborRate)}/{line.unit}
                </span>
              </div>
            )}
            {line.equipmentRate > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "#4B5563" }}>Equipment</span>
                <span style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
                  {formatINRFull(line.equipmentRate)}/{line.unit}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Waste */}
        {line.wasteFactor > 0 && (
          <div className="flex justify-between text-[10px] mb-1">
            <span style={{ color: "#4B5563" }}>Waste</span>
            <span style={{ color: "#D97706" }}>+{(line.wasteFactor * 100).toFixed(0)}%</span>
          </div>
        )}

        {/* IS Code */}
        {line.isCode && (
          <div className="flex justify-between text-[10px] mb-1">
            <span style={{ color: "#4B5563" }}>IS Code</span>
            <span style={{ color: "#0D9488", fontFamily: "var(--font-jetbrains, 'JetBrains Mono', monospace)", fontSize: 9 }}>
              {line.isCode}
            </span>
          </div>
        )}

        {/* Confidence */}
        <div className="flex justify-between items-center text-[10px] mb-1">
          <span style={{ color: "#4B5563" }}>Confidence</span>
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background: confidenceTheme.bg, color: confidenceTheme.color, fontSize: 9 }}
          >
            {line.confidence}% {confidenceLabel}
          </span>
        </div>

        {/* Confidence factors */}
        {factors.length > 0 && (
          <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            {factors.map((f, i) => (
              <div key={i} className="text-[9px] leading-[1.5]" style={{ color: "#9CA3AF" }}>
                • {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </span>
  );
}
