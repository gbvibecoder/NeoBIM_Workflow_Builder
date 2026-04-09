"use client";

import { useState, useEffect } from "react";
import { formatINR } from "@/components/boq-visualizer/recalc-engine";
import { getDivisionCategory } from "@/components/boq-visualizer/recalc-engine";
import type { BOQLineItem } from "@/components/boq-visualizer/types";

interface DivisionBarChartProps {
  lines: BOQLineItem[];
}

const DIVISION_COLORS: Record<string, string> = {
  "Structural": "#00F5FF",
  "MEP": "#B87333",
  "Finishes": "#FFBF00",
  "Foundation": "#8B5CF6",
  "External": "#4FC3F7",
};

export function DivisionBarChart({ lines }: DivisionBarChartProps) {
  const [animProgress, setAnimProgress] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    const duration = 700;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setAnimProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) requestAnimationFrame(animate);
    };
    // Stagger: start after donut finishes
    const timer = setTimeout(() => requestAnimationFrame(animate), 200);
    return () => clearTimeout(timer);
  }, []);

  // Aggregate by division category
  const divisionMap = new Map<string, number>();
  for (const line of lines) {
    const cat = getDivisionCategory(line.division, line.description);
    divisionMap.set(cat, (divisionMap.get(cat) || 0) + line.totalCost);
  }

  const divisions = Array.from(divisionMap.entries())
    .map(([name, cost]) => ({ name, cost, color: DIVISION_COLORS[name] || "#9898B0" }))
    .sort((a, b) => b.cost - a.cost);

  const maxCost = divisions[0]?.cost || 1;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      <h3 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F5" }}>
        Cost by Division
      </h3>

      <div className="flex flex-col gap-3">
        {divisions.map((div, i) => {
          const pct = (div.cost / maxCost) * 100 * animProgress;
          return (
            <div key={div.name} className="flex items-center gap-3">
              <span
                className="text-xs w-20 shrink-0 text-right"
                style={{ color: "#9898B0" }}
              >
                {div.name}
              </span>

              <div className="relative flex-1 h-6 rounded-md overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${div.color}40, ${div.color})`,
                    boxShadow: `0 0 12px ${div.color}20`,
                    transition: "width 0.4s ease-out",
                    transitionDelay: `${i * 50}ms`,
                  }}
                />
              </div>

              <span
                className="text-xs font-medium w-20 shrink-0 text-right"
                style={{ color: div.color, fontVariantNumeric: "tabular-nums" }}
              >
                {formatINR(div.cost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
