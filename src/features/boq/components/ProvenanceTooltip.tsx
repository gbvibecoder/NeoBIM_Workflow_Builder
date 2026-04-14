"use client";

import { motion } from "framer-motion";
import type { BOQLineItem } from "@/features/boq/components/types";
import { formatINRFull } from "@/features/boq/components/recalc-engine";

interface ProvenanceTooltipProps {
  line: BOQLineItem;
}

const CONFIDENCE_THEME = {
  HIGH: { bg: "#ECFDF5", color: "#059669" },
  MEDIUM: { bg: "#FEF3C7", color: "#D97706" },
  LOW: { bg: "#FEE2E2", color: "#DC2626" },
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
    <span className="relative group/prov" style={{ display: "inline-flex", alignItems: "center" }}>
      {children}
      <div
        className="hidden group-hover/prov:block"
        style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          marginBottom: 8,
          zIndex: 50,
          pointerEvents: "none",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15 }}
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0, 0, 0, 0.08)",
            borderRadius: 12,
            padding: "12px 14px",
            width: 260,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
          }}
        >
          {/* Rate header */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
            Rate: {formatINRFull(line.unitRate)}/{line.unit}
          </div>

          {/* M/L/E breakdown */}
          {hasBreakdown && (
            <div style={{ borderBottom: "1px solid rgba(0, 0, 0, 0.06)", paddingBottom: 8, marginBottom: 8, display: "flex", flexDirection: "column", gap: 5 }}>
              {line.materialRate > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 9999, background: "#0D9488", flexShrink: 0 }} />
                    Material
                  </span>
                  <span style={{ color: "#111827", fontVariantNumeric: "tabular-nums" }}>
                    {formatINRFull(line.materialRate)}/{line.unit}
                  </span>
                </div>
              )}
              {line.laborRate > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 9999, background: "#D97706", flexShrink: 0 }} />
                    Labour
                  </span>
                  <span style={{ color: "#111827", fontVariantNumeric: "tabular-nums" }}>
                    {formatINRFull(line.laborRate)}/{line.unit}
                  </span>
                </div>
              )}
              {line.equipmentRate > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 9999, background: "#7C3AED", flexShrink: 0 }} />
                    Equipment
                  </span>
                  <span style={{ color: "#111827", fontVariantNumeric: "tabular-nums" }}>
                    {formatINRFull(line.equipmentRate)}/{line.unit}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Waste */}
          {line.wasteFactor > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
              <span style={{ color: "#6B7280" }}>Waste</span>
              <span style={{ color: "#D97706", fontWeight: 600 }}>+{(line.wasteFactor * 100).toFixed(0)}%</span>
            </div>
          )}

          {/* IS Code as pill badge */}
          {line.isCode && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 5 }}>
              <span style={{ color: "#6B7280" }}>IS Code</span>
              <span style={{
                display: "inline-flex", padding: "2px 8px", borderRadius: 6,
                background: "#F3F4F6", color: "#4B5563", fontSize: 9,
                fontFamily: "var(--font-jetbrains, 'JetBrains Mono', monospace)",
              }}>
                {line.isCode}
              </span>
            </div>
          )}

          {/* Confidence */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 5 }}>
            <span style={{ color: "#6B7280" }}>Confidence</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: 9999,
                fontWeight: 600,
                fontSize: 9,
                background: confidenceTheme.bg,
                color: confidenceTheme.color,
              }}
            >
              {line.confidence}% {confidenceLabel}
            </span>
          </div>

          {/* Confidence factors */}
          {factors.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(0, 0, 0, 0.06)", paddingTop: 6, marginTop: 6 }}>
              {factors.map((f, i) => (
                <div key={i} style={{ fontSize: 9, lineHeight: 1.5, color: "#6B7280" }}>
                  &bull; {f}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </span>
  );
}
