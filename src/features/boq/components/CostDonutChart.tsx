"use client";

import { useState, useEffect } from "react";
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
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

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
    <div
      className="rounded-xl p-5"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.06)",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
      }}
    >
      <h3 className="text-sm font-semibold mb-4" style={{ color: "#1A1A1A" }}>
        Cost Breakdown
      </h3>

      <div className="flex items-center gap-6">
        {/* SVG Donut */}
        <div className="relative w-[140px] h-[140px] shrink-0">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            {/* Background track */}
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="#F3F4F6"
              strokeWidth={strokeWidth}
            />
            {/* Segments */}
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={hoveredSegment === arc.key ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={`${arc.length} ${arc.gap}`}
                strokeLinecap="round"
                transform={`rotate(${arc.rotation} ${cx} ${cy})`}
                style={{
                  transition: "stroke-width 0.2s ease, stroke-dasharray 0.4s ease",
                  filter: hoveredSegment === arc.key ? `drop-shadow(0 0 6px ${arc.color}30)` : "none",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredSegment(arc.key)}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            ))}
          </svg>

          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px]" style={{ color: "#9CA3AF" }}>Total</span>
            <span className="text-sm font-bold" style={{ color: "#1A1A1A", fontVariantNumeric: "tabular-nums", fontFamily: "Georgia, 'Times New Roman', serif" }}>
              {formatINR(total)}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-3 flex-1">
          {arcs.map((arc) => (
            <div
              key={arc.key}
              className="flex items-center gap-3 cursor-pointer rounded-lg px-2 py-1.5 transition-all duration-200"
              style={{
                background: hoveredSegment === arc.key ? `${arc.color}08` : "transparent",
              }}
              onMouseEnter={() => setHoveredSegment(arc.key)}
              onMouseLeave={() => setHoveredSegment(null)}
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: arc.color }}
              />
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-xs font-medium" style={{ color: "#4B5563" }}>
                  {arc.label}
                </span>
                <span className="text-[10px]" style={{ color: "#9CA3AF" }}>
                  {formatINR(arc.value)}
                </span>
              </div>
              <span className="text-xs font-bold" style={{ color: arc.color, fontVariantNumeric: "tabular-nums" }}>
                {(arc.fraction * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
