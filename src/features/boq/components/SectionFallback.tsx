"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

interface SectionFallbackProps {
  section: string;
}

export function SectionFallback({ section }: SectionFallbackProps) {
  return (
    <div
      style={{
        margin: "0 24px",
        borderRadius: 12,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        background: "#FEF2F2",
        border: "1px solid rgba(220, 38, 38, 0.15)",
      }}
    >
      <AlertTriangle size={18} color="#DC2626" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#DC2626", margin: 0 }}>
          {section} failed to render
        </p>
        <p style={{ fontSize: 11, color: "#6B7280", margin: 0, marginTop: 2 }}>
          Other sections are unaffected. Try reloading the page.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          background: "#FFFFFF",
          border: "1px solid rgba(0, 0, 0, 0.1)",
          color: "#4B5563",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "#F9FAFB";
          e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.15)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "#FFFFFF";
          e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.1)";
        }}
      >
        <RotateCcw size={11} />
        Reload
      </button>
    </div>
  );
}
