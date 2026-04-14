"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { formatINR } from "@/features/boq/components/recalc-engine";

interface CostDonutChartProps {
  material: number;
  labor: number;
  equipment: number;
}

const SEGMENTS = [
  { key: "material", label: "Material", color: "#0D9488" },
  { key: "labor", label: "Labour", color: "#D97706" },
  { key: "equipment", label: "Equipment", color: "#7C3AED" },
] as const;

export function CostDonutChart({ material, labor, equipment }: CostDonutChartProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  useEffect(() => {
    if (!isInView) return;

    let start: number | null = null;
    const duration = 600;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      // ease-out cubic
      setAnimProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [isInView]);

  const total = material + labor + equipment;
  if (total === 0) return null;

  const values = { material, labor, equipment };
  const cx = 100, cy = 100, r = 70, strokeWidth = 24;
  const circumference = 2 * Math.PI * r;

  let cumulativeAngle = 0;
  const arcs = SEGMENTS.map((seg) => {
    const val = values[seg.key];
    const fraction = val / total;
    const length = circumference * fraction * animProgress;
    const gap = circumference - length;
    const rotation = (cumulativeAngle * 360) - 90;
    cumulativeAngle += fraction;

    return {
      ...seg,
      value: val,
      fraction,
      length,
      gap,
      rotation,
    };
  });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{
        background: "#FFFFFF",
        borderRadius: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        border: "1px solid rgba(0,0,0,0.06)",
        padding: 24,
      }}
    >
      <h3
        style={{
          color: "#111827",
          fontSize: 15,
          fontWeight: 600,
          margin: 0,
          marginBottom: 20,
        }}
      >
        Cost Breakdown
      </h3>

      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        {/* SVG Donut */}
        <div
          style={{
            position: "relative",
            width: 140,
            height: 140,
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 200 200" style={{ width: "100%", height: "100%" }}>
            {/* Background track */}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#F3F4F6"
              strokeWidth={strokeWidth}
            />
            {/* Segments */}
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={
                  hoveredSegment === arc.key ? strokeWidth + 4 : strokeWidth
                }
                strokeDasharray={`${arc.length} ${arc.gap}`}
                strokeLinecap="round"
                transform={`rotate(${arc.rotation} ${cx} ${cy})`}
                style={{
                  transition:
                    "stroke-width 0.2s ease, stroke-dasharray 0.4s ease",
                  filter:
                    hoveredSegment === arc.key
                      ? `drop-shadow(0 0 6px ${arc.color}30)`
                      : "none",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredSegment(arc.key)}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            ))}
          </svg>

          {/* Center text */}
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
            <span style={{ fontSize: 10, color: "#9CA3AF" }}>Total</span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#111827",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatINR(total)}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flex: 1,
          }}
        >
          {arcs.map((arc, index) => (
            <motion.div
              key={arc.key}
              initial={{ opacity: 0, x: 12 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{
                duration: 0.4,
                delay: 0.3 + index * 0.1,
                ease: "easeOut",
              }}
              onMouseEnter={() => setHoveredSegment(arc.key)}
              onMouseLeave={() => setHoveredSegment(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                borderRadius: 8,
                padding: "6px 8px",
                background:
                  hoveredSegment === arc.key
                    ? "rgba(0,0,0,0.02)"
                    : "transparent",
                transition: "background 0.15s ease",
              }}
            >
              {/* Color dot */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: arc.color,
                  flexShrink: 0,
                }}
              />

              {/* Label + sub-amount */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: "#111827",
                  }}
                >
                  {arc.label}
                </span>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                  {formatINR(arc.value)}
                </span>
              </div>

              {/* Percentage */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#4B5563",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {(arc.fraction * 100).toFixed(1)}%
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
