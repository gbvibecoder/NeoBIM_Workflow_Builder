"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

export interface PieBucket {
  label: string;
  count: number;
}

interface SurveyPieChartsProps {
  discovery: PieBucket[];
  profession: PieBucket[];
  teamSize: PieBucket[];
  pricing: PieBucket[];
}

const PALETTE = [
  "#4F8AFF",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
  "#EC4899",
  "#22C55E",
  "#A855F7",
  "#FB923C",
];

function PiePanel({ title, data }: { title: string; data: PieBucket[] }) {
  const rows = data.map((d, i) => ({
    name: d.label,
    value: d.count,
    color: PALETTE[i % PALETTE.length],
  }));

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 14,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 320,
      }}
    >
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-disabled)", fontSize: 12 }}>
          No data yet
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                stroke="none"
                isAnimationActive
                animationDuration={700}
              >
                {rows.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "rgba(12,12,22,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                itemStyle={{ color: "#E0E7FF" }}
                labelStyle={{ color: "#A5B4FC" }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function SurveyPieCharts({ discovery, profession, teamSize, pricing }: SurveyPieChartsProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
      }}
    >
      <PiePanel title="Discovery" data={discovery} />
      <PiePanel title="Profession" data={profession} />
      <PiePanel title="Team Size" data={teamSize} />
      <PiePanel title="Pricing Action" data={pricing} />
    </div>
  );
}
