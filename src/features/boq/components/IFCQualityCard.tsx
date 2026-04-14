"use client";

import { ShieldCheck, AlertTriangle } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";
import { getIFCQualityLabel, getIFCQualityColor } from "@/features/boq/constants/quality-thresholds";

interface IFCQualityCardProps {
  quality: NonNullable<BOQData["ifcQuality"]>;
}

export function IFCQualityCard({ quality }: IFCQualityCardProps) {
  const scoreColor = getIFCQualityColor(quality.score);
  const scoreLabel = getIFCQualityLabel(quality.score);

  // Map dark-theme quality colors to light-theme equivalents
  const lightScoreColor = quality.score >= 80 ? "#0D9488" : quality.score >= 50 ? "#B45309" : "#DC2626";

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
      }}
    >
      <h3 className="text-sm font-semibold mb-4" style={{ color: "#1A1A1A" }}>
        IFC Quality Assessment
      </h3>

      {/* Score + Confidence */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex flex-col items-center">
          <div
            className="text-2xl font-bold"
            style={{
              color: lightScoreColor,
              fontVariantNumeric: "tabular-nums",
              fontFamily: "var(--font-dm-serif, 'DM Serif Display', serif)",
            }}
          >
            {quality.score}%
          </div>
          <span className="text-[10px] font-medium" style={{ color: lightScoreColor }}>
            {scoreLabel}
          </span>
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: "#9CA3AF" }}>Quality Score</span>
            <span className="text-[10px]" style={{ color: "#4B5563" }}>
              Confidence: {quality.confidence}%
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "#F3F4F6" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${quality.score}%`,
                background: `linear-gradient(90deg, ${lightScoreColor}80, ${lightScoreColor})`,
                transition: "width 0.6s ease-out",
              }}
            />
          </div>
        </div>
      </div>

      {/* Element Coverage */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-medium" style={{ color: "#9CA3AF" }}>
            <ShieldCheck size={10} className="inline mr-1" />
            Element Coverage
          </span>
          <span className="text-[10px]" style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
            {quality.elementCoverage}%
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#F3F4F6" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${quality.elementCoverage}%`,
              background: "linear-gradient(90deg, #0D948880, #0D9488)",
            }}
          />
        </div>
      </div>

      {/* Missing Files */}
      {quality.missingFiles.length > 0 && (
        <div>
          <span className="text-[10px] font-medium flex items-center gap-1 mb-2" style={{ color: "#B45309" }}>
            <AlertTriangle size={10} />
            Missing Files
          </span>
          <div className="flex flex-col gap-1.5">
            {quality.missingFiles.map((file) => (
              <div
                key={file}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                style={{ background: "#FFFBEB", border: "1px solid rgba(180, 83, 9, 0.15)" }}
              >
                <span className="text-[10px]" style={{ color: "#B45309" }}>{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomalies */}
      {quality.anomalies.length > 0 && (
        <div className="mt-3">
          <span className="text-[10px] font-medium mb-1.5 block" style={{ color: "#9CA3AF" }}>
            Anomalies Detected
          </span>
          {quality.anomalies.slice(0, 3).map((a, i) => (
            <p key={i} className="text-[10px] mb-0.5" style={{ color: "#4B5563" }}>
              &bull; {a}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
