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
        background: "rgba(239, 68, 68, 0.05)",
        border: "1px solid rgba(239, 68, 68, 0.15)",
      }}
    >
      <AlertTriangle size={18} color="#EF4444" className="shrink-0" />
      <div className="flex-1">
        <p className="text-xs font-medium" style={{ color: "#EF4444" }}>
          {section} failed to render
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: "#9898B0" }}>
          Other sections are unaffected. Try reloading the page.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-all"
        style={{
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          color: "#9898B0",
        }}
      >
        <RotateCcw size={10} />
        Reload
      </button>
    </div>
  );
}
