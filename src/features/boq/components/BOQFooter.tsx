"use client";

import { useState } from "react";
import { Download, FileText, Table2 } from "lucide-react";

interface BOQFooterProps {
  disclaimer: string;
  onExportExcel: () => void;
  onExportPDF: () => void;
  onExportCSV: () => void;
}

export function BOQFooter({ disclaimer, onExportExcel, onExportPDF, onExportCSV }: BOQFooterProps) {
  const buttons = [
    { label: "Excel", icon: Table2, color: "#0D9488", hoverBg: "#0D9488", onClick: onExportExcel },
    { label: "PDF", icon: FileText, color: "#DC2626", hoverBg: "#DC2626", onClick: onExportPDF },
    { label: "CSV", icon: Download, color: "#2563EB", hoverBg: "#2563EB", onClick: onExportCSV },
  ];

  return (
    <div
      style={{
        margin: "0 24px",
        borderRadius: 16,
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
        padding: 24,
      }}
    >
      {/* Disclaimer */}
      <div
        style={{
          borderRadius: 12,
          padding: "12px 16px",
          background: "#F9FAFB",
          marginBottom: 16,
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontStyle: "italic",
            lineHeight: 1.6,
            color: "#9CA3AF",
            margin: 0,
          }}
        >
          {disclaimer}
        </p>
      </div>

      {/* Export buttons + Attribution */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>
          Prepared by BuildFlow &middot; trybuildflow.in
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {buttons.map((btn) => (
            <ExportButton key={btn.label} {...btn} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ExportButton({
  label,
  icon: Icon,
  color,
  hoverBg,
  onClick,
}: {
  label: string;
  icon: typeof Table2;
  color: string;
  hoverBg: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 20px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.2s",
        border: `1px solid ${color}`,
        background: hovered ? hoverBg : "transparent",
        color: hovered ? "#FFFFFF" : color,
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
