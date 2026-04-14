"use client";

import { ArrowLeft, Download, Share2, Building2, MapPin, Calendar } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BOQData } from "@/features/boq/components/types";

interface BOQHeaderProps {
  data: BOQData;
  onExportExcel: () => void;
}

export function BOQHeader({ data, onExportExcel }: BOQHeaderProps) {
  const router = useRouter();

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      toast.success("Link copied!", { description: "Share this BOQ with your team or client." });
    });
  };

  const confidenceBg =
    data.confidenceLevel === "HIGH" ? "#ECFDF5" :
    data.confidenceLevel === "MEDIUM" ? "#FFFBEB" : "#FEF2F2";
  const confidenceText =
    data.confidenceLevel === "HIGH" ? "#059669" :
    data.confidenceLevel === "MEDIUM" ? "#D97706" : "#DC2626";

  return (
    <div
      className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
      style={{
        background: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      {/* Left: Back + Project Info */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200"
          style={{
            background: "transparent",
            border: "1px solid #0D9488",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#CCFBF1";
            e.currentTarget.style.borderColor = "#0F766E";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "#0D9488";
          }}
        >
          <ArrowLeft size={16} color="#0D9488" />
        </button>

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Building2 size={14} style={{ color: "#0D9488" }} />
            <span
              className="text-sm font-semibold"
              style={{
                color: "#1A1A1A",
                fontFamily: "var(--font-dm-serif, 'DM Serif Display', serif)",
              }}
            >
              {data.projectName}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="flex items-center gap-1 text-xs" style={{ color: "#4B5563" }}>
              <MapPin size={10} />
              {data.location}
            </span>
            <span className="flex items-center gap-1 text-xs" style={{ color: "#4B5563" }}>
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
            background: confidenceBg,
            color: confidenceText,
          }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: confidenceText }} />
          {data.confidenceLevel}
        </div>

        {/* AACE Class Badge with tooltip */}
        <div className="relative group/aace">
          <div
            className="px-2.5 py-1 rounded-full text-xs font-medium cursor-help"
            style={{
              background: "#F0FDFA",
              color: "#0D9488",
            }}
          >
            AACE {data.aaceClass}
          </div>
          <div
            className="absolute top-full right-0 mt-2 hidden group-hover/aace:block z-50"
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.06)",
              borderRadius: 12,
              padding: "10px 12px",
              width: 280,
              boxShadow: "0 10px 15px -3px rgba(0,0,0,0.06)",
            }}
          >
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: "#0D9488" }}>
              AACE {data.aaceClass} Estimate
            </div>
            <div className="text-[10px] leading-relaxed mb-2" style={{ color: "#4B5563" }}>
              {data.aaceDescription || "Feasibility study — accuracy ±25-30%. Suitable for early-stage cost planning."}
            </div>
            {data.costRange && data.costRange.totalLow > 0 && (
              <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 6 }}>
                <div className="text-[10px]" style={{ color: "#4B5563" }}>
                  Estimated range: ₹{(data.costRange.totalLow / 10000000).toFixed(1)} — ₹{(data.costRange.totalHigh / 10000000).toFixed(1)} Cr
                </div>
                <div className="text-[10px]" style={{ color: "#9CA3AF" }}>
                  Best estimate: ₹{(data.costRange.totalBest / 10000000).toFixed(2)} Cr
                </div>
              </div>
            )}
            <div className="text-[9px] mt-2" style={{ color: "#9CA3AF" }}>
              Not suitable for tender submission or procurement.
            </div>
          </div>
        </div>

        {/* Download Excel */}
        <button
          onClick={onExportExcel}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
          style={{
            background: "#0D9488",
            color: "#FFFFFF",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#0F766E";
            e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(13,148,136,0.25)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "#0D9488";
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
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.06)",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#FAFAF8";
            e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)";
          }}
          title="Copy link"
        >
          <Share2 size={14} color="#9CA3AF" />
        </button>
      </div>
    </div>
  );
}
