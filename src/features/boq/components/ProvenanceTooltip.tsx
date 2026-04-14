"use client";

import type { BOQLineItem } from "@/features/boq/components/types";
import { formatINRFull } from "@/features/boq/components/recalc-engine";

interface ProvenanceTooltipProps {
  line: BOQLineItem;
}

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
  const confidenceColor = confidenceLabel === "HIGH" ? "#22C55E" : confidenceLabel === "MEDIUM" ? "#F59E0B" : "#EF4444";

  return (
    <span className="relative group/prov inline-flex items-center">
      {children}
      <div
        className="absolute bottom-full left-0 mb-2 hidden group-hover/prov:block z-50 pointer-events-none"
        style={{
          background: "rgba(12,12,20,0.97)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          padding: "10px 12px",
          width: 260,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        }}
      >
        {/* Rate header */}
        <div className="text-[11px] font-semibold mb-2" style={{ color: "#F0F0F5" }}>
          Rate: {formatINRFull(line.unitRate)}/{line.unit}
        </div>

        {/* M/L/E breakdown */}
        {hasBreakdown && (
          <div className="flex flex-col gap-1 mb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 6 }}>
            {line.materialRate > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "#9898B0" }}>Material</span>
                <span style={{ color: "#F0F0F5", fontVariantNumeric: "tabular-nums" }}>
                  {formatINRFull(line.materialRate)}/{line.unit}
                </span>
              </div>
            )}
            {line.laborRate > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "#9898B0" }}>Labour</span>
                <span style={{ color: "#F0F0F5", fontVariantNumeric: "tabular-nums" }}>
                  {formatINRFull(line.laborRate)}/{line.unit}
                </span>
              </div>
            )}
            {line.equipmentRate > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: "#9898B0" }}>Equipment</span>
                <span style={{ color: "#F0F0F5", fontVariantNumeric: "tabular-nums" }}>
                  {formatINRFull(line.equipmentRate)}/{line.unit}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Waste */}
        {line.wasteFactor > 0 && (
          <div className="flex justify-between text-[10px] mb-1">
            <span style={{ color: "#9898B0" }}>Waste</span>
            <span style={{ color: "#F59E0B" }}>+{(line.wasteFactor * 100).toFixed(0)}%</span>
          </div>
        )}

        {/* IS Code */}
        {line.isCode && (
          <div className="flex justify-between text-[10px] mb-1">
            <span style={{ color: "#9898B0" }}>IS Code</span>
            <span style={{ color: "#00F5FF", fontFamily: "var(--font-jetbrains, monospace)", fontSize: 9 }}>
              {line.isCode}
            </span>
          </div>
        )}

        {/* Confidence */}
        <div className="flex justify-between text-[10px] mb-1">
          <span style={{ color: "#9898B0" }}>Confidence</span>
          <span style={{ color: confidenceColor, fontWeight: 600 }}>
            {line.confidence}% {confidenceLabel}
          </span>
        </div>

        {/* Confidence factors */}
        {factors.length > 0 && (
          <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {factors.map((f, i) => (
              <div key={i} className="text-[9px] leading-[1.5]" style={{ color: "#7A7A94" }}>
                • {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </span>
  );
}
