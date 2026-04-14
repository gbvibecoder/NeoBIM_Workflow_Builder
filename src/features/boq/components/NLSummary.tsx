"use client";

import React from "react";
import { Quote } from "lucide-react";

interface NLSummaryProps {
  summary: string;
}

// Highlight numbers and currency values in teal
function highlightNumbers(text: string): (string | React.ReactElement)[] {
  const parts = text.split(/(₹[\d,.\s]+(?:Cr|L|lakh|crore)?|[\d,]+\.?\d*\s*(?:m²|m³|kg|nos|units|%|Cr|L|lakh|crore|sqm|sqft))/gi);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span key={i} style={{ color: "#0D9488", fontWeight: 700 }}>
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
      className="mx-6 rounded-xl p-6 relative overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
      }}
    >
      {/* Decorative quote mark */}
      <Quote
        size={48}
        className="absolute top-4 right-4"
        style={{
          color: "rgba(13, 148, 136, 0.10)",
          fontFamily: "var(--font-dm-serif, 'DM Serif Display', serif)",
        }}
      />

      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[4px]"
        style={{ background: "linear-gradient(180deg, #0D9488, rgba(13,148,136,0.3))" }}
      />

      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "#1A1A1A" }}>
        <Quote size={14} color="#0D9488" />
        Quantity Surveyor Summary
      </h3>

      <div
        className="text-sm leading-relaxed"
        style={{ color: "#4B5563" }}
      >
        {summary.split("\n").map((paragraph, i) => (
          <p key={i} className={i > 0 ? "mt-2" : ""}>
            {highlightNumbers(paragraph)}
          </p>
        ))}
      </div>
    </div>
  );
}
