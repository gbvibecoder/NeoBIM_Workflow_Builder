"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

interface SectionFallbackProps {
  section: string;
}

export function SectionFallback({ section }: SectionFallbackProps) {
  return (
    <div
      className="mx-6 rounded-xl p-6 flex items-center gap-4"
      style={{
        background: "#FEF2F2",
        border: "1px solid rgba(220, 38, 38, 0.12)",
      }}
    >
      <AlertTriangle size={18} color="#DC2626" className="shrink-0" />
      <div className="flex-1">
        <p className="text-xs font-medium" style={{ color: "#DC2626" }}>
          {section} failed to render
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: "#4B5563" }}>
          Other sections are unaffected. Try reloading the page.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-all"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0, 0, 0, 0.12)",
          color: "#4B5563",
        }}
      >
        <RotateCcw size={10} />
        Reload
      </button>
    </div>
  );
}
