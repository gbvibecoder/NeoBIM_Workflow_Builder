"use client";

import { motion } from "framer-motion";
import type { StatTile } from "@/features/result-page/lib/derive-stat-strip";

interface StatStripProps {
  tiles: StatTile[];
}

/**
 * Workflow-aware stat strip — mounted at the top of the Data section.
 *
 * Mono uppercase tags + bold tabular-figure values, separated by hairline
 * vertical rules. Reads like the title block on a drawing.
 */
export function StatStrip({ tiles }: StatStripProps) {
  if (tiles.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(tiles.length, 4)}, minmax(0, 1fr))`,
        gap: 0,
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 14,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        overflow: "hidden",
      }}
    >
      {tiles.map((t, i) => (
        <motion.div
          key={t.tag}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: 0.1 + i * 0.06, duration: 0.3 }}
          style={{
            padding: "14px 18px",
            borderRight: i < tiles.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minHeight: 64,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.10em",
              color: "#94A3B8",
              textTransform: "uppercase",
            }}
          >
            {t.tag}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 700,
              color: t.color ?? "#0F172A",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.005em",
            }}
          >
            {t.value}
          </span>
          {t.hint ? (
            <span style={{ fontSize: 11, color: "#94A3B8" }}>{t.hint}</span>
          ) : null}
        </motion.div>
      ))}
    </motion.div>
  );
}
