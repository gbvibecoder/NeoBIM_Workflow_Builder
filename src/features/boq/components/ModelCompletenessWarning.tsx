"use client";

import { AlertTriangle } from "lucide-react";

interface ModelCompletenessWarningProps {
  elementCoverage: number; // 0-100 — % of elements with extractable geometry
  estimatedFromCount?: number; // how many element groups used geometry fallback
}

/**
 * Shows a warning banner when IFC model completeness is below 30%.
 * Different from staleness warning (different cause: model quality, not rate age).
 */
export function ModelCompletenessWarning({ elementCoverage, estimatedFromCount }: ModelCompletenessWarningProps) {
  if (elementCoverage >= 30) return null;

  return (
    <div
      style={{
        margin: "0 24px 16px",
        padding: "14px 18px",
        borderRadius: 12,
        background: "rgba(217,119,6,0.06)",
        borderLeft: "4px solid #D97706",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <AlertTriangle size={16} color="#D97706" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>
          Limited Model Accuracy
        </span>
        <span
          style={{
            padding: "2px 8px", borderRadius: 9999,
            fontSize: 10, fontWeight: 600,
            background: "rgba(217,119,6,0.12)", color: "#D97706",
          }}
        >
          {Math.round(elementCoverage)}% geometry coverage
        </span>
      </div>
      <p style={{ fontSize: 12, color: "#78350F", lineHeight: 1.6, margin: 0 }}>
        Most elements in this IFC model lack extractable geometry data. Walls, slabs, and columns
        were estimated from element counts using standard Indian construction dimensions.
        {estimatedFromCount && estimatedFromCount > 0 && (
          <span style={{ display: "block", marginTop: 4, fontStyle: "italic" }}>
            {estimatedFromCount} element groups used standard-dimension fallback (Wall: 18m²/element, Slab: 36m²/element, Column: 0.48m³/element).
          </span>
        )}
        For a more accurate estimate, upload an IFC with full geometric quantities (BaseQuantities / Qto_*).
      </p>
    </div>
  );
}
