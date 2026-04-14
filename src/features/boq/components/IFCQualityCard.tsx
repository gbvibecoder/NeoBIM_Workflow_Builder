"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { ShieldCheck, AlertTriangle, FileX, ChevronDown } from "lucide-react";
import type { BOQData } from "@/features/boq/components/types";
import { getIFCQualityLabel, getIFCQualityColor } from "@/features/boq/constants/quality-thresholds";

interface IFCQualityCardProps {
  quality: NonNullable<BOQData["ifcQuality"]>;
}

export function IFCQualityCard({ quality }: IFCQualityCardProps) {
  const scoreColor = getIFCQualityColor(quality.score);
  const scoreLabel = getIFCQualityLabel(quality.score);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const [anomaliesExpanded, setAnomaliesExpanded] = useState(false);

  const lightScoreColor = quality.score >= 80 ? "#0D9488" : quality.score >= 50 ? "#D97706" : "#DC2626";

  // SVG progress ring params
  const ringSize = 80;
  const strokeWidth = 6;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (quality.score / 100) * circumference;

  return (
    <div
      ref={ref}
      style={{
        background: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
        padding: 24,
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#111827",
          marginBottom: 20,
        }}
      >
        IFC Quality Assessment
      </h3>

      {/* Score ring + Confidence */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
        {/* SVG Progress Ring */}
        <div style={{ position: "relative", width: ringSize, height: ringSize, flexShrink: 0 }}>
          <svg width={ringSize} height={ringSize} style={{ transform: "rotate(-90deg)" }}>
            {/* Background track */}
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke="#F3F4F6"
              strokeWidth={strokeWidth}
            />
            {/* Animated progress arc */}
            <motion.circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={lightScoreColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: isInView ? strokeDashoffset : circumference }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.2 }}
            />
          </svg>
          {/* Score number inside ring */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: lightScoreColor,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {quality.score}
            </span>
            <span style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>/ 100</span>
          </div>
        </div>

        {/* Label + Confidence */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: lightScoreColor,
              marginBottom: 4,
            }}
          >
            {scoreLabel}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>Quality Score</span>
            <span style={{ fontSize: 11, color: "#4B5563" }}>
              Confidence: {quality.confidence}%
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 9999, background: "#F3F4F6", overflow: "hidden" }}>
            <motion.div
              style={{
                height: "100%",
                borderRadius: 9999,
                background: `linear-gradient(90deg, ${lightScoreColor}80, ${lightScoreColor})`,
              }}
              initial={{ width: 0 }}
              animate={{ width: isInView ? `${quality.score}%` : 0 }}
              transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
            />
          </div>
        </div>
      </div>

      {/* Element Coverage */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "#9CA3AF", display: "flex", alignItems: "center", gap: 4 }}>
            <ShieldCheck size={12} color="#0D9488" />
            Element Coverage
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums" }}>
            {quality.elementCoverage}%
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 9999, background: "#F3F4F6", overflow: "hidden" }}>
          <motion.div
            style={{
              height: "100%",
              borderRadius: 9999,
              background: "linear-gradient(90deg, #0D948860, #0D9488)",
            }}
            initial={{ width: 0 }}
            animate={{ width: isInView ? `${quality.elementCoverage}%` : 0 }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.5 }}
          />
        </div>
      </div>

      {/* Missing Files */}
      {quality.missingFiles.length > 0 && (
        <div style={{ marginBottom: quality.anomalies.length > 0 ? 16 : 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "#D97706",
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 8,
            }}
          >
            <FileX size={12} />
            Missing Files
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {quality.missingFiles.map((file) => (
              <div
                key={file}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "#FEF3C7",
                  border: "1px solid rgba(217, 119, 6, 0.12)",
                }}
              >
                <FileX size={12} color="#D97706" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#92400E" }}>{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomalies — expandable */}
      {quality.anomalies.length > 0 && (
        <div>
          <button
            onClick={() => setAnomaliesExpanded(!anomaliesExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              color: "#9CA3AF",
              marginBottom: 8,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <AlertTriangle size={12} color="#9CA3AF" />
            Anomalies Detected ({quality.anomalies.length})
            <motion.span
              animate={{ rotate: anomaliesExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: "inline-flex" }}
            >
              <ChevronDown size={12} />
            </motion.span>
          </button>
          <motion.div
            initial={false}
            animate={{ height: anomaliesExpanded ? "auto" : 0, opacity: anomaliesExpanded ? 1 : 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {quality.anomalies.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 11,
                    color: "#4B5563",
                    lineHeight: 1.5,
                  }}
                >
                  <AlertTriangle size={10} color="#9CA3AF" style={{ flexShrink: 0, marginTop: 3 }} />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
