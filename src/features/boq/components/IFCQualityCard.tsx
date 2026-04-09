"use client";

import { ShieldCheck, AlertTriangle, Plus } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";

interface IFCQualityCardProps {
  quality: NonNullable<BOQData["ifcQuality"]>;
}

export function IFCQualityCard({ quality }: IFCQualityCardProps) {
  const scoreColor = quality.score >= 80 ? "#22C55E" : quality.score >= 60 ? "#00F5FF" : quality.score >= 40 ? "#F59E0B" : "#EF4444";
  const scoreLabel = quality.score >= 80 ? "EXCELLENT" : quality.score >= 60 ? "GOOD" : quality.score >= 40 ? "FAIR" : "LIMITED";

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      <h3 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F5" }}>
        IFC Quality Assessment
      </h3>

      {/* Score + Confidence */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex flex-col items-center">
          <div
            className="text-2xl font-bold"
            style={{ color: scoreColor, fontVariantNumeric: "tabular-nums" }}
          >
            {quality.score}%
          </div>
          <span className="text-[10px] font-medium" style={{ color: scoreColor }}>
            {scoreLabel}
          </span>
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: "#9898B0" }}>Quality Score</span>
            <span className="text-[10px]" style={{ color: "#5C5C78" }}>
              Confidence: {quality.confidence}%
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${quality.score}%`,
                background: `linear-gradient(90deg, ${scoreColor}60, ${scoreColor})`,
                transition: "width 0.6s ease-out",
              }}
            />
          </div>
        </div>
      </div>

      {/* Element Coverage */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-medium" style={{ color: "#9898B0" }}>
            <ShieldCheck size={10} className="inline mr-1" />
            Element Coverage
          </span>
          <span className="text-[10px]" style={{ color: "#F0F0F5", fontVariantNumeric: "tabular-nums" }}>
            {quality.elementCoverage}%
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${quality.elementCoverage}%`,
              background: "linear-gradient(90deg, rgba(0,245,255,0.4), #00F5FF)",
            }}
          />
        </div>
      </div>

      {/* Missing Files */}
      {quality.missingFiles.length > 0 && (
        <div>
          <span className="text-[10px] font-medium flex items-center gap-1 mb-2" style={{ color: "#F59E0B" }}>
            <AlertTriangle size={10} />
            Missing Files
          </span>
          <div className="flex flex-col gap-1.5">
            {quality.missingFiles.map((file) => (
              <div
                key={file}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                style={{ background: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.15)" }}
              >
                <span className="text-[10px]" style={{ color: "#F59E0B" }}>{file}</span>
                <button
                  className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(245, 158, 11, 0.15)", color: "#F59E0B" }}
                >
                  <Plus size={8} /> Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomalies */}
      {quality.anomalies.length > 0 && (
        <div className="mt-3">
          <span className="text-[10px] font-medium mb-1.5 block" style={{ color: "#9898B0" }}>
            Anomalies Detected
          </span>
          {quality.anomalies.slice(0, 3).map((a, i) => (
            <p key={i} className="text-[10px] mb-0.5" style={{ color: "#5C5C78" }}>
              &bull; {a}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
