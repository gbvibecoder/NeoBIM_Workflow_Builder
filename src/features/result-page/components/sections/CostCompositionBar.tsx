"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CostSegment } from "@/features/result-page/lib/derive-cost-composition";

interface CostCompositionBarProps {
  segments: CostSegment[];
}

/**
 * Horizontal stacked bar showing how the BOQ total breaks down across
 * Civil / MEP / Finishings / Labor + Equipment. Each segment animates
 * its width from 0 to its target % on first viewport entry.
 *
 * Quietly informative — the BOQ visualizer holds the deep breakdown,
 * this is the at-a-glance preview on the wrapper.
 */
export function CostCompositionBar({ segments }: CostCompositionBarProps) {
  const reduce = useReducedMotion();
  if (segments.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 14,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        padding: "16px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.10em",
            color: "#94A3B8",
            textTransform: "uppercase",
          }}
        >
          Cost composition · estimate
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.06em",
            color: "#94A3B8",
            textTransform: "uppercase",
          }}
        >
          {segments.length} categories
        </span>
      </div>

      {/* Segmented bar */}
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 9999,
          overflow: "hidden",
          background: "#F1F5F9",
        }}
      >
        {segments.map((seg, i) => (
          <motion.div
            key={seg.label}
            initial={{ width: reduce ? `${seg.pct}%` : 0 }}
            whileInView={{ width: `${seg.pct}%` }}
            viewport={{ once: true, margin: "-40px" }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    delay: 0.15 + i * 0.08,
                    duration: 0.7,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }
            }
            style={{
              height: "100%",
              background: seg.color,
              borderRight: i < segments.length - 1 ? "1px solid #FFFFFF" : "none",
            }}
            title={`${seg.label} · ${seg.pct}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 12 }}>
        {segments.map(seg => (
          <span key={seg.label} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background: seg.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>{seg.label}</span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: 12,
                color: "#0F172A",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {seg.pct}%
            </span>
          </span>
        ))}
      </div>
    </motion.div>
  );
}
