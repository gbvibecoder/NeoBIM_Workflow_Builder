"use client";

import React from "react";
import { Quote } from "lucide-react";

interface NLSummaryProps {
  summary: string;
}

// Highlight numbers and currency values in small teal pills
function highlightNumbers(text: string): (string | React.ReactElement)[] {
  const parts = text.split(/(₹[\d,.\s]+(?:Cr|L|lakh|crore)?|[\d,]+\.?\d*\s*(?:m²|m³|kg|nos|units|%|Cr|L|lakh|crore|sqm|sqft))/gi);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            background: "#F0FDFA",
            color: "#0D9488",
            padding: "1px 6px",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export function NLSummary({ summary }: NLSummaryProps) {
  if (!summary) return null;

  return (
    <div
      style={{
        marginLeft: 24,
        marginRight: 24,
        borderRadius: 16,
        padding: 24,
        position: "relative",
        overflow: "hidden",
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        borderLeft: "4px solid #0D9488",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* Large decorative quote mark */}
      <span
        style={{
          position: "absolute",
          top: 16,
          right: 20,
          fontSize: 48,
          fontFamily: "Georgia, 'Times New Roman', serif",
          color: "#E5E7EB",
          lineHeight: 1,
          userSelect: "none",
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        &ldquo;
      </span>

      {/* Title */}
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#111827",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Quote size={14} color="#0D9488" />
        Quantity Surveyor Summary
      </h3>

      {/* Body text */}
      <div style={{ fontSize: 14, lineHeight: 1.75, color: "#4B5563" }}>
        {summary.split("\n").map((paragraph, i) => (
          <p key={i} style={{ marginTop: i > 0 ? 8 : 0 }}>
            {highlightNumbers(paragraph)}
          </p>
        ))}
      </div>
    </div>
  );
}
