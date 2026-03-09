"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { COLORS } from "../constants";
import { AnimatedNumber } from "./AnimatedNumber";
import type { KpiMetric } from "../useShowcaseData";

interface KpiStripProps {
  metrics: KpiMetric[];
  maxItems?: number;
  compact?: boolean;
}

const TREND_ICONS = {
  up: <TrendingUp size={12} style={{ color: COLORS.EMERALD }} />,
  down: <TrendingDown size={12} style={{ color: "#EF4444" }} />,
  neutral: <Minus size={12} style={{ color: COLORS.TEXT_MUTED }} />,
};

export function KpiStrip({ metrics, maxItems = 6, compact = false }: KpiStripProps) {
  if (metrics.length === 0) return null;

  const shown = metrics.slice(0, maxItems);
  const cols = Math.min(shown.length, compact ? 3 : 3);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: compact ? 8 : 10,
      }}
    >
      {shown.map((m, i) => {
        const numericValue = typeof m.value === "number"
          ? m.value
          : parseFloat(String(m.value));
        const isNumeric = !isNaN(numericValue);

        return (
          <motion.div
            key={`${m.label}-${i}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            style={{
              background: COLORS.GLASS_BG,
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              borderRadius: 10,
              padding: compact ? "12px 14px" : "16px 18px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Subtle glow line at top */}
            <div style={{
              position: "absolute",
              top: 0,
              left: "20%",
              right: "20%",
              height: 1,
              background: `linear-gradient(90deg, transparent, ${COLORS.CYAN}33, transparent)`,
            }} />

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}>
              <span style={{
                fontSize: compact ? 20 : 24,
                fontWeight: 700,
                color: COLORS.TEXT_PRIMARY,
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
              }}>
                {isNumeric ? (
                  <AnimatedNumber
                    value={numericValue}
                    duration={1200 + i * 200}
                    decimals={numericValue % 1 !== 0 ? 1 : 0}
                  />
                ) : (
                  m.value
                )}
                {m.unit && (
                  <span style={{
                    fontSize: compact ? 10 : 11,
                    color: COLORS.TEXT_MUTED,
                    marginLeft: 3,
                    fontWeight: 400,
                  }}>
                    {m.unit}
                  </span>
                )}
              </span>
              {m.trend && TREND_ICONS[m.trend]}
            </div>

            <div style={{
              fontSize: compact ? 9 : 10,
              color: COLORS.TEXT_MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 500,
            }}>
              {m.label}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
