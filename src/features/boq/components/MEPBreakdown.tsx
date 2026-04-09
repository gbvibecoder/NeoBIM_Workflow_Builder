"use client";

import { Wind, Zap, Droplets, Flame, ArrowUpDown } from "lucide-react";
import { formatINR } from "@/features/boq/components/recalc-engine";
import type { BOQData } from "@/features/boq/components/types";

interface MEPBreakdownProps {
  mep: NonNullable<BOQData["mepBreakdown"]>;
}

const MEP_ITEMS = [
  { key: "hvac" as const, label: "HVAC", icon: Wind, color: "#00F5FF" },
  { key: "electrical" as const, label: "Electrical", icon: Zap, color: "#FFBF00" },
  { key: "plumbing" as const, label: "Plumbing", icon: Droplets, color: "#4FC3F7" },
  { key: "fire" as const, label: "Fire Safety", icon: Flame, color: "#EF4444" },
  { key: "lifts" as const, label: "Lifts", icon: ArrowUpDown, color: "#8B5CF6" },
];

export function MEPBreakdown({ mep }: MEPBreakdownProps) {
  const maxPct = Math.max(...MEP_ITEMS.map((m) => mep[m.key].percentage));

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      <h3 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F5" }}>
        MEP Breakdown
      </h3>

      <div className="flex flex-col gap-3.5">
        {MEP_ITEMS.map((item) => {
          const data = mep[item.key];
          const barWidth = maxPct > 0 ? (data.percentage / maxPct) * 100 : 0;

          return (
            <div key={item.key} className="group">
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                  style={{ background: `${item.color}12` }}
                >
                  <item.icon size={13} color={item.color} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: "#F0F0F5" }}>
                      {item.label}
                    </span>
                    <span className="text-xs" style={{ color: item.color, fontVariantNumeric: "tabular-nums" }}>
                      {data.percentage.toFixed(1)}% · {formatINR(data.cost)}
                    </span>
                  </div>

                  <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barWidth}%`,
                        background: `linear-gradient(90deg, ${item.color}50, ${item.color})`,
                        transition: "width 0.6s ease-out",
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Reasoning tooltip on hover */}
              <div
                className="overflow-hidden transition-all duration-200 max-h-0 group-hover:max-h-10"
              >
                <p className="text-[10px] mt-1.5 ml-10" style={{ color: "#5C5C78" }}>
                  {data.reasoning}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
