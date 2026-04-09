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
    { label: "Excel", icon: Table2, color: "#22C55E", onClick: onExportExcel },
    { label: "PDF", icon: FileText, color: "#EF4444", onClick: onExportPDF },
    { label: "CSV", icon: Download, color: "#00F5FF", onClick: onExportCSV },
  ];

  return (
    <div className="mx-6 mt-2 mb-8">
      {/* Disclaimer */}
      <div
        className="rounded-xl px-5 py-4 mb-4"
        style={{
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.04)",
        }}
      >
        <p className="text-[10px] leading-relaxed" style={{ color: "#5C5C78" }}>
          {disclaimer}
        </p>
      </div>

      {/* Export buttons + Attribution */}
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: "#3A3A50" }}>
          Prepared by BuildFlow &middot; trybuildflow.in
        </span>

        <div className="flex items-center gap-2">
          {buttons.map((btn) => (
            <button
              key={btn.label}
              onClick={btn.onClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                background: `${btn.color}10`,
                border: `1px solid ${btn.color}30`,
                color: btn.color,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${btn.color}20`;
                e.currentTarget.style.boxShadow = `0 0 12px ${btn.color}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `${btn.color}10`;
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
