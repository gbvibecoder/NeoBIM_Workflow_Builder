"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Clock, SkipForward, Sparkles } from "lucide-react";

interface StatsShape {
  totalSurveys: number;
  completed: number;
  completionRate: number; // percent
  avgTimeSeconds: number;
  commonSkipScene: number | null;
  topDiscovery: string | null;
}

function formatDuration(s: number): string {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

export function SurveyStatsCards({ stats }: { stats: StatsShape }) {
  const items = [
    {
      icon: CheckCircle2,
      label: "Completion rate",
      value: `${stats.completionRate}%`,
      sub: `${stats.completed} / ${stats.totalSurveys} responses`,
      color: "16,185,129",
    },
    {
      icon: Clock,
      label: "Avg. time",
      value: formatDuration(stats.avgTimeSeconds),
      sub: "From first scene to finish",
      color: "79,138,255",
    },
    {
      icon: SkipForward,
      label: "Most common skip",
      value: stats.commonSkipScene ? `Scene ${stats.commonSkipScene}` : "—",
      sub: "Where users bail",
      color: "245,158,11",
    },
    {
      icon: Sparkles,
      label: "Top discovery",
      value: stats.topDiscovery ?? "—",
      sub: "Most-picked source",
      color: "139,92,246",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 14,
      }}
    >
      {items.map((it, i) => (
        <motion.div
          key={it.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{
            padding: "18px 20px",
            borderRadius: 14,
            background: "rgba(255,255,255,0.02)",
            border: `1px solid rgba(${it.color},0.18)`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: `rgba(${it.color},0.1)`,
                border: `1px solid rgba(${it.color},0.25)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: `rgb(${it.color})`,
              }}
            >
              <it.icon size={14} />
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {it.label}
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            {it.value}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{it.sub}</div>
        </motion.div>
      ))}
    </div>
  );
}
