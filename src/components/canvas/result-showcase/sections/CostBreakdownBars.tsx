"use client";

import { motion } from "framer-motion";
import { COLORS } from "../constants";
import type { CostItem } from "../useShowcaseData";

interface CostBreakdownBarsProps {
  items: CostItem[];
}

export function CostBreakdownBars({ items }: CostBreakdownBarsProps) {
  if (items.length === 0) return null;

  const maxVal = Math.max(...items.map(i => i.value), 1);

  return (
    <div>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: COLORS.TEXT_SECONDARY,
        marginBottom: 12,
      }}>
        Cost Breakdown
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const pct = Math.max((item.value / maxVal) * 100, 4);

          return (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i }}
            >
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>
                  {item.label}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: COLORS.TEXT_PRIMARY,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {typeof item.value === "number"
                    ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : item.value}
                </span>
              </div>

              <div style={{
                height: 6,
                borderRadius: 3,
                background: "rgba(255,255,255,0.04)",
                overflow: "hidden",
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: 0.1 * i, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    background: `linear-gradient(90deg, ${COLORS.AMBER}, ${COLORS.COPPER})`,
                  }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
