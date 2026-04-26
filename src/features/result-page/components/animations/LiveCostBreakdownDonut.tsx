"use client";

import { useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { formatINR } from "@/features/boq/components/recalc-engine";

interface DonutSegment {
  label: string;
  /** 0-100, integer */
  pct: number;
  color: string;
}

interface LiveCostBreakdownDonutProps {
  totalCost: number;
}

/**
 * Phase 4.1 · Fix 2 — fills the BOQ hero's right-side dead zone.
 *
 * 5-segment SVG donut tied to the same color palette as the
 * MaterialChipsCascade. Each arc draws stroke-by-stroke (pathLength
 * 0→1) sympathetically with the chip timing (200/440/680/920/1160ms),
 * so the chips lighting up and the donut completing read as one unified
 * "the estimate just calculated" moment.
 *
 * Center label: TOTAL · ₹X.XX L · 5 CATEGORIES.
 * Below the donut: 5 mono legend rows revealing as their segment draws.
 *
 * Reduced motion: arcs render at full pathLength immediately, legend
 * rows at full opacity.
 *
 * The breakdown percentages use the same typical-construction shares
 * the static-fallback in derive-cost-composition uses (Civil 48 · Steel
 * 18 · MEP 14 · Finishings 12 · Labor 8) so the visual story across the
 * hero donut and the data-section bar stays consistent. We could plumb
 * `deriveCostComposition()` here too, but that would require lifting
 * the data dependency into the BOQ hero — accepting the tighter
 * coupling isn't worth the reuse for one component.
 */
export function LiveCostBreakdownDonut({ totalCost }: LiveCostBreakdownDonutProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [hovered, setHovered] = useState<string | null>(null);

  // Five segments — same palette / order as MaterialChipsCascade.
  const segments: DonutSegment[] = [
    { label: "Concrete", pct: 32, color: "#475569" },
    { label: "Steel", pct: 22, color: "#0EA5E9" },
    { label: "Bricks", pct: 18, color: "#B45309" },
    { label: "Labor", pct: 16, color: "#0D9488" },
    { label: "Finishings", pct: 12, color: "#7C3AED" },
  ];

  // SVG donut geometry
  const size = 240;
  const strokeWidth = 28;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Compute arc lengths and rotations
  let cumulative = 0;
  const arcs = segments.map((seg, i) => {
    const fraction = seg.pct / 100;
    const length = circumference * fraction;
    const rotation = cumulative * 360 - 90; // start at top
    cumulative += fraction;
    const delay = 0.2 + i * 0.24;
    return { ...seg, length, rotation, delay, index: i };
  });

  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: "8px 0",
      }}
    >
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {/* Background track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#F1F5F9"
            strokeWidth={strokeWidth}
          />
          {/* Animated arcs */}
          {arcs.map(arc => {
            const isHovered = hovered === arc.label;
            return (
              <motion.circle
                key={arc.label}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                strokeLinecap="butt"
                strokeDasharray={`${arc.length} ${circumference}`}
                transform={`rotate(${arc.rotation} ${cx} ${cy})`}
                initial={reduce || !inView ? { pathLength: 1 } : { pathLength: 0 }}
                animate={inView ? { pathLength: 1 } : undefined}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { delay: arc.delay, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const }
                }
                style={{
                  cursor: "pointer",
                  transition: "stroke-width 0.18s ease",
                  filter: isHovered ? `drop-shadow(0 0 6px ${arc.color}55)` : "none",
                }}
                onMouseEnter={() => setHovered(arc.label)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>
        {/* Center label */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 9,
              fontWeight: 600,
              color: "#94A3B8",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Total
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#0F172A",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
              fontFeatureSettings: "'tnum'",
              lineHeight: 1.1,
            }}
          >
            {totalCost > 0 ? formatINR(totalCost) : "—"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 9,
              fontWeight: 500,
              color: "#94A3B8",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            {segments.length} categories
          </span>
        </div>
      </div>

      {/* Mini legend rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%", maxWidth: 280 }}>
        {arcs.map(arc => {
          const isHovered = hovered === arc.label;
          const segValue = (totalCost * arc.pct) / 100;
          return (
            <motion.div
              key={arc.label}
              initial={reduce || !inView ? { opacity: 1 } : { opacity: 0, x: -4 }}
              animate={inView ? { opacity: 1, x: 0 } : undefined}
              transition={
                reduce
                  ? { duration: 0 }
                  : { delay: arc.delay + 0.1, duration: 0.3, ease: "easeOut" as const }
              }
              onMouseEnter={() => setHovered(arc.label)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                borderRadius: 8,
                background: isHovered ? "#F8FAFC" : "transparent",
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: arc.color,
                  flexShrink: 0,
                  boxShadow: isHovered ? `0 0 0 3px ${arc.color}22` : "none",
                  transition: "box-shadow 0.15s ease",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 10,
                  color: "#475569",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  flex: 1,
                  fontWeight: 500,
                }}
              >
                {arc.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#0F172A",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {totalCost > 0 ? formatINR(segValue) : "—"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontSize: 10,
                  fontWeight: 500,
                  color: "#94A3B8",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 28,
                  textAlign: "right",
                }}
              >
                {arc.pct}%
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
