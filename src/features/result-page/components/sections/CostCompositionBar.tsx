"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CostComposition } from "@/features/result-page/lib/derive-cost-composition";
import { formatINR } from "@/features/boq/components/recalc-engine";

interface CostCompositionBarProps {
  composition: CostComposition;
  /** Total project cost (₹). Used to compute per-segment ₹ values for hover tooltips. */
  totalCost: number;
}

/**
 * Phase 4.1 · Fix 4 — composition bar with derivation-aware caption.
 *
 * Renders a 4-5 segment horizontal stacked bar showing the BOQ total
 * broken down by Civil / Steel / MEP / Finishings / Labor. Each segment
 * grows in sequentially (left → right, 120ms apart, 600ms each) on first
 * viewport entry — the bar feels like it's *being constructed*.
 *
 * Caption (mono, 9px) tells the user which derivation tier produced the
 * breakdown:
 *   live        → "LIVE BREAKDOWN · FROM BOQ TABLE"
 *   ifc         → "INDICATIVE · FROM IFC CATEGORIES"
 *   indicative  → "INDICATIVE · TYPICAL CONSTRUCTION SHARES"
 */
export function CostCompositionBar({ composition, totalCost }: CostCompositionBarProps) {
  const reduce = useReducedMotion();
  const { segments, source } = composition;
  if (segments.length === 0) return null;

  const captionText =
    source === "live"
      ? "Live breakdown · from BOQ table"
      : source === "ifc"
        ? "Indicative · derived from IFC categories"
        : "Indicative · typical construction shares";

  const captionColor = source === "live" ? "#0D9488" : "#94A3B8";

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
          Cost composition
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.08em",
            color: captionColor,
            textTransform: "uppercase",
          }}
        >
          {captionText}
        </span>
      </div>

      {/* Segmented bar — sequential left→right grow */}
      <div
        style={{
          display: "flex",
          height: 12,
          borderRadius: 9999,
          overflow: "hidden",
          background: "#F1F5F9",
        }}
      >
        {segments.map((seg, i) => {
          const segValue = (totalCost * seg.pct) / 100;
          const tooltip = `${seg.label} · ${formatINR(segValue)} · ${seg.pct}%`;
          return (
            <motion.div
              key={seg.label}
              initial={{ width: reduce ? `${seg.pct}%` : 0 }}
              whileInView={{ width: `${seg.pct}%` }}
              viewport={{ once: true, margin: "-40px" }}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      delay: 0.15 + i * 0.12,
                      duration: 0.6,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }
              }
              title={tooltip}
              style={{
                height: "100%",
                background: seg.color,
                borderRight: i < segments.length - 1 ? "1px solid #FFFFFF" : "none",
                cursor: "help",
              }}
            />
          );
        })}
      </div>

      {/* Legend with ₹ values */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(segments.length, 5)}, minmax(0, 1fr))`,
          gap: 12,
          marginTop: 14,
        }}
      >
        {segments.map(seg => {
          const segValue = (totalCost * seg.pct) / 100;
          return (
            <div key={seg.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                    fontSize: 10,
                    color: "#94A3B8",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {seg.label}
                </span>
              </span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#0F172A",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.005em",
                }}
              >
                {seg.pct}%
              </span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 10,
                  color: "#475569",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {totalCost > 0 ? formatINR(segValue) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
