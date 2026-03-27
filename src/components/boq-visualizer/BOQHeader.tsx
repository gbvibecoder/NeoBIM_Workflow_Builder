"use client";

import { ArrowLeft, Download, Share2, Building2, MapPin, Calendar } from "lucide-react";
import { useRouter } from "next/navigation";
import type { BOQData } from "./types";

interface BOQHeaderProps {
  data: BOQData;
  onExportExcel: () => void;
}

export function BOQHeader({ data, onExportExcel }: BOQHeaderProps) {
  const router = useRouter();

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
  };

  const confidenceColor =
    data.confidenceLevel === "HIGH" ? "#22C55E" :
    data.confidenceLevel === "MEDIUM" ? "#F59E0B" : "#EF4444";

  return (
    <div
      className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
      style={{
        background: "rgba(10, 12, 16, 0.92)",
        backdropFilter: "blur(24px) saturate(1.3)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      {/* Left: Back + Project Info */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200"
          style={{
            background: "rgba(0, 245, 255, 0.08)",
            border: "1px solid rgba(0, 245, 255, 0.25)",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(0, 245, 255, 0.15)";
            e.currentTarget.style.borderColor = "rgba(0, 245, 255, 0.4)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(0, 245, 255, 0.08)";
            e.currentTarget.style.borderColor = "rgba(0, 245, 255, 0.25)";
          }}
        >
          <ArrowLeft size={16} color="#00F5FF" />
        </button>

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Building2 size={14} style={{ color: "#00F5FF" }} />
            <span className="text-sm font-semibold" style={{ color: "#F0F0F5" }}>
              {data.projectName}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="flex items-center gap-1 text-xs" style={{ color: "#9898B0" }}>
              <MapPin size={10} />
              {data.location}
            </span>
            <span className="flex items-center gap-1 text-xs" style={{ color: "#9898B0" }}>
              <Calendar size={10} />
              {data.date}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Badges + Actions */}
      <div className="flex items-center gap-3">
        {/* Confidence Badge */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{
            background: `${confidenceColor}15`,
            border: `1px solid ${confidenceColor}40`,
            color: confidenceColor,
          }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: confidenceColor }} />
          {data.confidenceLevel}
        </div>

        {/* AACE Class Badge */}
        <div
          className="px-2.5 py-1 rounded-full text-xs font-medium"
          style={{
            background: "rgba(139, 92, 246, 0.12)",
            border: "1px solid rgba(139, 92, 246, 0.3)",
            color: "#A78BFA",
          }}
        >
          AACE {data.aaceClass}
        </div>

        {/* Download Excel */}
        <button
          onClick={onExportExcel}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
          style={{
            background: "rgba(0, 245, 255, 0.1)",
            border: "1px solid rgba(0, 245, 255, 0.3)",
            color: "#00F5FF",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(0, 245, 255, 0.2)";
            e.currentTarget.style.boxShadow = "0 0 16px rgba(0, 245, 255, 0.15)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(0, 245, 255, 0.1)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <Download size={13} />
          Download Excel
        </button>

        {/* Share */}
        <button
          onClick={copyLink}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200"
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
          }}
          title="Copy link"
        >
          <Share2 size={14} color="#9898B0" />
        </button>
      </div>
    </div>
  );
}
