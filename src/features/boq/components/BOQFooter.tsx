"use client";

import { Download, FileText, Table2 } from "lucide-react";

interface BOQFooterProps {
  disclaimer: string;
  onExportExcel: () => void;
  onExportPDF: () => void;
  onExportCSV: () => void;
}

export function BOQFooter({ disclaimer, onExportExcel, onExportPDF, onExportCSV }: BOQFooterProps) {
  const buttons = [
    { label: "Excel", icon: Table2, color: "#0D9488", bg: "rgba(13, 148, 136, 0.08)", borderColor: "rgba(13, 148, 136, 0.2)", hoverBg: "rgba(13, 148, 136, 0.14)", onClick: onExportExcel },
    { label: "PDF", icon: FileText, color: "#DC2626", bg: "rgba(220, 38, 38, 0.06)", borderColor: "rgba(220, 38, 38, 0.15)", hoverBg: "rgba(220, 38, 38, 0.10)", onClick: onExportPDF },
    { label: "CSV", icon: Download, color: "#2563EB", bg: "rgba(37, 99, 235, 0.06)", borderColor: "rgba(37, 99, 235, 0.15)", hoverBg: "rgba(37, 99, 235, 0.10)", onClick: onExportCSV },
  ];

  return (
    <div className="mx-6 mt-2 mb-8">
      {/* Disclaimer */}
      <div
        className="rounded-xl px-5 py-4 mb-4"
        style={{
          background: "#F9FAFB",
          border: "1px solid rgba(0, 0, 0, 0.06)",
        }}
      >
        <p className="text-[10px] leading-relaxed" style={{ color: "#4B5563" }}>
          {disclaimer}
        </p>
      </div>

      {/* Export buttons + Attribution */}
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: "#9CA3AF" }}>
          Prepared by BuildFlow &middot; trybuildflow.in
        </span>

        <div className="flex items-center gap-2">
          {buttons.map((btn) => (
            <button
              key={btn.label}
              onClick={btn.onClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                background: btn.bg,
                border: `1px solid ${btn.borderColor}`,
                color: btn.color,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = btn.hoverBg;
                e.currentTarget.style.boxShadow = `0 2px 8px ${btn.borderColor}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = btn.bg;
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <btn.icon size={12} />
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
