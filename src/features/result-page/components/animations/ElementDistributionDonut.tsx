"use client";

import { useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { __extractIfcCategories } from "@/features/result-page/components/animations/ElementCategoryCascade";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface ElementDistributionDonutProps {
  data: ResultPageData;
}

interface Segment {
  label: string;
  count: number;
  pct: number;
  color: string;
}

/**
 * Phase 4.2 · Fix 2 — sibling of LiveCostBreakdownDonut for IFC artifacts.
 *
 * Segments by element category (Walls / Slabs / Doors / Windows / Columns
 * / Beams / MEP). Center label `TOTAL · N ELEMENTS · K CATEGORIES`.
 */
export function ElementDistributionDonut({ data }: ElementDistributionDonutProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [hovered, setHovered] = useState<string | null>(null);

  const segments = useMemo<Segment[]>(() => {
    const buckets = __extractIfcCategories(data);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    if (total === 0) return [];
    const out: Segment[] = buckets.map(b => ({
      label: b.label,
      count: b.count,
      pct: Math.round((b.count / total) * 100),
      color: b.color,
    }));
    const sum = out.reduce((s, x) => s + x.pct, 0);
    if (sum !== 100 && out.length > 0) out[0].pct += 100 - sum;
    return out.filter(s => s.pct > 0).slice(0, 7);
  }, [data]);

  if (segments.length === 0) return null;

  const totalElements = segments.reduce((s, x) => s + x.count, 0);

  const size = 240;
  const strokeWidth = 28;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;
  const arcs = segments.map((seg, i) => {
    const fraction = seg.pct / 100;
    const length = circumference * fraction;
    const rotation = cumulative * 360 - 90;
    cumulative += fraction;
    const delay = 0.2 + i * 0.22;
    return { ...seg, length, rotation, delay };
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
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
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
                    : { delay: arc.delay, duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] as const }
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
            {totalElements.toLocaleString("en-IN")}
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
            elements · {segments.length} categories
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%", maxWidth: 280 }}>
        {arcs.map(arc => {
          const isHovered = hovered === arc.label;
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
                {arc.count}
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
