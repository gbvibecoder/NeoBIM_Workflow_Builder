"use client";

import { motion } from "framer-motion";

export interface FunnelRow {
  label: string;
  count: number;
}

interface FunnelChartProps {
  rows: FunnelRow[];
}

export function FunnelChart({ rows }: FunnelChartProps) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 20,
        borderRadius: 14,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {rows.map((r, i) => {
        const pct = (r.count / max) * 100;
        const prev = i > 0 ? rows[i - 1].count : r.count;
        const dropPct = prev > 0 ? Math.max(0, 100 - (r.count / prev) * 100) : 0;
        return (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 180, fontSize: 12, color: "var(--text-secondary)", textAlign: "right", flexShrink: 0 }}>
              {r.label}
            </div>
            <div style={{ flex: 1, position: "relative", height: 22, background: "rgba(255,255,255,0.03)", borderRadius: 6, overflow: "hidden" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  height: "100%",
                  background: `linear-gradient(90deg, rgba(79,138,255,0.35), rgba(139,92,246,${0.35 - i * 0.04}))`,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
                }}
              />
              <div style={{
                position: "absolute",
                top: 0,
                left: 10,
                height: "100%",
                display: "flex",
                alignItems: "center",
                fontSize: 11,
                fontWeight: 700,
                color: "#E0E7FF",
                fontFamily: "var(--font-jetbrains), monospace",
                pointerEvents: "none",
              }}>
                {r.count.toLocaleString()}
              </div>
            </div>
            <div style={{ width: 70, fontSize: 11, fontFamily: "var(--font-jetbrains), monospace", textAlign: "right", flexShrink: 0, color: dropPct > 40 ? "#F87171" : dropPct > 15 ? "#FBBF24" : "var(--text-tertiary)" }}>
              {i === 0 ? "—" : `-${dropPct.toFixed(0)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
