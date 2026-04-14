"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Wind, Zap, Droplets, Flame, ArrowUpDown } from "lucide-react";
import { formatINR } from "@/features/boq/components/recalc-engine";
import type { BOQData } from "@/features/boq/components/types";

interface MEPBreakdownProps {
  mep: NonNullable<BOQData["mepBreakdown"]>;
}

const MEP_ITEMS = [
  { key: "hvac" as const, label: "HVAC", icon: Wind, color: "#0D9488" },
  { key: "electrical" as const, label: "Electrical", icon: Zap, color: "#D97706" },
  { key: "plumbing" as const, label: "Plumbing", icon: Droplets, color: "#2563EB" },
  { key: "fire" as const, label: "Fire Safety", icon: Flame, color: "#DC2626" },
  { key: "lifts" as const, label: "Lifts", icon: ArrowUpDown, color: "#7C3AED" },
];

export function MEPBreakdown({ mep }: MEPBreakdownProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const maxPct = Math.max(...MEP_ITEMS.map((m) => mep[m.key].percentage));

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
        MEP Breakdown
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {MEP_ITEMS.map((item, index) => {
          const data = mep[item.key];
          const barWidth = maxPct > 0 ? (data.percentage / maxPct) * 100 : 0;

          return (
            <motion.div
              key={item.key}
              className="group"
              initial={{ opacity: 0, x: -8 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{
                duration: 0.4,
                delay: index * 0.08,
                ease: "easeOut",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: `${item.color}14`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <item.icon size={12} color={item.color} />
                </div>

                {/* Label + bar + stats */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#111827",
                      }}
                    >
                      {item.label}
                    </span>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: item.color,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {data.percentage.toFixed(1)}%
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#4B5563",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formatINR(data.cost)}
                      </span>
                    </div>
                  </div>

                  {/* Bar track */}
                  <div
                    style={{
                      height: 6,
                      borderRadius: 9999,
                      background: "#F3F4F6",
                      overflow: "hidden",
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={isInView ? { width: `${barWidth}%` } : {}}
                      transition={{
                        duration: 0.7,
                        delay: index * 0.08,
                        ease: "easeOut",
                      }}
                      style={{
                        height: "100%",
                        borderRadius: 9999,
                        background: item.color,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Reasoning tooltip on hover — slides down via maxHeight */}
              <div
                className="overflow-hidden transition-all duration-200 max-h-0 group-hover:max-h-10"
              >
                <p
                  style={{
                    fontSize: 10,
                    color: "#4B5563",
                    margin: 0,
                    marginTop: 6,
                    marginLeft: 36,
                  }}
                >
                  {data.reasoning}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
