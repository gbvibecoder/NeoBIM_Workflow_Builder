"use client";

import { useState, useEffect } from "react";
import { formatINR } from "@/features/boq/components/recalc-engine";
import { getDivisionCategory } from "@/features/boq/components/recalc-engine";
import type { BOQLineItem } from "@/features/boq/components/types";

interface DivisionBarChartProps {
  lines: BOQLineItem[];
}

const DIVISION_COLORS: Record<string, string> = {
  "Structural": "#0D9488",
  "MEP": "#2563EB",
  "Finishes": "#D97706",
  "Foundation": "#7C3AED",
  "External": "#059669",
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
    .map(([name, cost]) => ({ name, cost, color: DIVISION_COLORS[name] || "#9CA3AF" }))
    .sort((a, b) => b.cost - a.cost);

  const maxCost = divisions[0]?.cost || 1;

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
        Cost by Division
      </h3>

      <div className="flex flex-col gap-3">
        {divisions.map((div, i) => {
          const pct = (div.cost / maxCost) * 100 * animProgress;
          return (
            <div key={div.name} className="flex items-center gap-3">
              <span
                className="text-xs w-20 shrink-0 text-right font-medium"
                style={{ color: "#1A1A1A" }}
              >
                {div.name}
              </span>

              <div className="relative flex-1 h-6 rounded-md overflow-hidden" style={{ background: "#F3F4F6" }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${pct}%`,
                    background: div.color,
                    transition: "width 0.4s ease-out",
                    transitionDelay: `${i * 50}ms`,
                  }}
                />
              </div>

              <span
                className="text-xs font-medium w-20 shrink-0 text-right"
                style={{ color: "#4B5563", fontVariantNumeric: "tabular-nums" }}
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
