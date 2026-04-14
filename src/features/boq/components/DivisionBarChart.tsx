"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { formatINR } from "@/features/boq/components/recalc-engine";
import { getDivisionCategory } from "@/features/boq/components/recalc-engine";
import type { BOQLineItem } from "@/features/boq/components/types";

interface DivisionBarChartProps {
  lines: BOQLineItem[];
}

const DIVISION_COLORS: Record<string, string> = {
  Structural: "#0D9488",
  MEP: "#2563EB",
  Finishes: "#D97706",
  Foundation: "#7C3AED",
  External: "#059669",
};

export function DivisionBarChart({ lines }: DivisionBarChartProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  // Aggregate by division category
  const divisionMap = new Map<string, number>();
  for (const line of lines) {
    const cat = getDivisionCategory(line.division, line.description);
    divisionMap.set(cat, (divisionMap.get(cat) || 0) + line.totalCost);
  }

  const divisions = Array.from(divisionMap.entries())
    .map(([name, cost]) => ({
      name,
      cost,
      color: DIVISION_COLORS[name] || "#6B7280",
    }))
    .sort((a, b) => b.cost - a.cost);

  const maxCost = divisions[0]?.cost || 1;

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
        Cost by Division
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {divisions.map((div, index) => {
          const pct = (div.cost / maxCost) * 100;

          return (
            <motion.div
              key={div.name}
              initial={{ opacity: 0, x: -8 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{
                duration: 0.4,
                delay: index * 0.08,
                ease: "easeOut",
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Division name */}
              <span
                style={{
                  fontSize: 13,
                  color: "#111827",
                  width: 80,
                  flexShrink: 0,
                  textAlign: "right",
                  fontWeight: 500,
                }}
              >
                {div.name}
              </span>

              {/* Bar track */}
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 9999,
                  background: "#F3F4F6",
                  overflow: "hidden",
                }}
              >
                {/* Animated bar fill */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={isInView ? { width: `${pct}%` } : {}}
                  transition={{
                    duration: 0.7,
                    delay: index * 0.08,
                    ease: "easeOut",
                  }}
                  style={{
                    height: "100%",
                    borderRadius: 9999,
                    background: div.color,
                    opacity: 0.85,
                    transition: "opacity 0.15s ease",
                  }}
                  whileHover={{ opacity: 1 }}
                />
              </div>

              {/* Amount */}
              <span
                style={{
                  fontSize: 13,
                  color: "#4B5563",
                  width: 80,
                  flexShrink: 0,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatINR(div.cost)}
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
