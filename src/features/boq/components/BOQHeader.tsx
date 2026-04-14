"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Download, Share2, Building2, MapPin, Calendar, ChevronDown, FileText, FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BOQData } from "@/features/boq/components/types";

interface BOQHeaderProps {
  data: BOQData;
  onExportExcel: () => void;
  onExportPDF?: () => void;
  onExportCSV?: () => void;
}

export function BOQHeader({ data, onExportExcel, onExportPDF, onExportCSV }: BOQHeaderProps) {
  const router = useRouter();
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-export-menu]")) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      toast.success("Link copied!", { description: "Share this BOQ with your team or client." });
    });
  };

  const confidenceBg =
    data.confidenceLevel === "HIGH" ? "#ECFDF5" :
    data.confidenceLevel === "MEDIUM" ? "#FEF3C7" : "#FEE2E2";
  const confidenceText =
    data.confidenceLevel === "HIGH" ? "#059669" :
    data.confidenceLevel === "MEDIUM" ? "#D97706" : "#DC2626";

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        background: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
        borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
      }}
    >
      {/* Left: Back + Project Info */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={() => router.back()}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 9999,
            background: "#F9FAFB",
            border: "1px solid rgba(0, 0, 0, 0.06)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#F3F4F6";
            e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.1)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "#F9FAFB";
            e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.06)";
          }}
        >
          <ArrowLeft size={16} color="#4B5563" />
        </button>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={14} color="#0D9488" />
            <span
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "#111827",
              }}
            >
              {data.projectName}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 2 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#6B7280" }}>
              <MapPin size={11} color="#6B7280" />
              {data.location}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#6B7280" }}>
              <Calendar size={11} color="#6B7280" />
              {data.date}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Badges + Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Confidence Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 500,
            background: confidenceBg,
            color: confidenceText,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: 9999, background: confidenceText }} />
          {data.confidenceLevel}
        </div>

        {/* AACE Class Badge with tooltip */}
        <div className="relative group/aace" style={{ position: "relative" }}>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 9999,
              fontSize: 12,
              fontWeight: 500,
              background: "#F0FDFA",
              color: "#0D9488",
              border: "1px solid rgba(13, 148, 136, 0.15)",
              cursor: "help",
            }}
          >
            AACE {data.aaceClass}
          </div>
          <div
            className="hidden group-hover/aace:block"
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 8,
              zIndex: 50,
              background: "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: 12,
              padding: "12px 14px",
              width: 280,
              boxShadow: "0 12px 24px -4px rgba(0, 0, 0, 0.08), 0 4px 8px -2px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "#0D9488", marginBottom: 6 }}>
              AACE {data.aaceClass} Estimate
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.6, color: "#4B5563", marginBottom: 8 }}>
              {data.aaceDescription || "Feasibility study — accuracy ±25-30%. Suitable for early-stage cost planning."}
            </div>
            {data.costRange && data.costRange.totalLow > 0 && (
              <div style={{ borderTop: "1px solid rgba(0, 0, 0, 0.06)", paddingTop: 8 }}>
                <div style={{ fontSize: 11, color: "#4B5563" }}>
                  Estimated range: ₹{(data.costRange.totalLow / 10000000).toFixed(1)} — ₹{(data.costRange.totalHigh / 10000000).toFixed(1)} Cr
                </div>
                <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                  Best estimate: ₹{(data.costRange.totalBest / 10000000).toFixed(2)} Cr
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 8 }}>
              Not suitable for tender submission or procurement.
            </div>
          </div>
        </div>

        {/* Export button group */}
        <div style={{ position: "relative" }} data-export-menu>
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <button
              onClick={onExportExcel}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: "10px 0 0 10px", fontSize: 12, fontWeight: 500,
                background: "#0D9488", color: "#FFFFFF", border: "none", cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)", transition: "all 0.2s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#0F766E"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#0D9488"; }}
            >
              <Download size={13} />
              Excel
            </button>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 7px", borderRadius: "0 10px 10px 0", fontSize: 12,
                background: "#0F766E", color: "#FFFFFF", border: "none", borderLeft: "1px solid rgba(255,255,255,0.2)",
                cursor: "pointer", transition: "all 0.2s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#115E59"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#0F766E"; }}
            >
              <ChevronDown size={12} />
            </button>
          </div>
          {showExportMenu && (
            <div
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4,
                background: "#FFFFFF", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                border: "1px solid rgba(0,0,0,0.08)", padding: 4, zIndex: 50, minWidth: 140,
              }}
            >
              {onExportPDF && (
                <button
                  onClick={() => { onExportPDF(); setShowExportMenu(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 12px", borderRadius: 8, fontSize: 13, color: "#4B5563",
                    background: "transparent", border: "none", cursor: "pointer", transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#F9FAFB"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <FileText size={14} color="#DC2626" />
                  PDF
                </button>
              )}
              {onExportCSV && (
                <button
                  onClick={() => { onExportCSV(); setShowExportMenu(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 12px", borderRadius: 8, fontSize: 13, color: "#4B5563",
                    background: "transparent", border: "none", cursor: "pointer", transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#F9FAFB"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <FileSpreadsheet size={14} color="#2563EB" />
                  CSV
                </button>
              )}
            </div>
          )}
        </div>

        {/* Share */}
        <button
          onClick={copyLink}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 9999,
            background: "#F9FAFB",
            border: "1px solid rgba(0, 0, 0, 0.06)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "#F3F4F6";
            e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.1)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "#F9FAFB";
            e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.06)";
          }}
          title="Copy link"
        >
          <Share2 size={14} color="#6B7280" />
        </button>
      </div>
    </div>
  );
}
