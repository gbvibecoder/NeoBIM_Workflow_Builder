"use client";

import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Film,
  BarChart3,
  Box,
  Download,
  Activity,
  LayoutGrid,
} from "lucide-react";

export type ResultTabId = "overview" | "media" | "data" | "model" | "export" | "diagnostics";

const ICONS: Record<ResultTabId, React.ReactNode> = {
  overview: <LayoutDashboard size={14} aria-hidden="true" />,
  media: <Film size={14} aria-hidden="true" />,
  data: <BarChart3 size={14} aria-hidden="true" />,
  model: <Box size={14} aria-hidden="true" />,
  export: <Download size={14} aria-hidden="true" />,
  diagnostics: <Activity size={14} aria-hidden="true" />,
};

const LABELS: Record<ResultTabId, string> = {
  overview: "Overview",
  media: "Media",
  data: "Data",
  model: "3D Model",
  export: "Export",
  diagnostics: "Diagnostics",
};

const ORDER: ResultTabId[] = ["overview", "media", "data", "model", "export", "diagnostics"];

interface TabBarProps {
  available: ResultTabId[];
  active: ResultTabId;
  onChange: (tab: ResultTabId) => void;
  modelTabIs2DFloorPlan?: boolean;
  accentColor: string;
}

export function TabBar({ available, active, onChange, modelTabIs2DFloorPlan, accentColor }: TabBarProps) {
  const visible = ORDER.filter(id => available.includes(id));
  return (
    <div
      role="tablist"
      aria-label="Result page tabs"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 clamp(12px, 3vw, 28px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(7,8,9,0.78)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 56,
        zIndex: 9,
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {visible.map(id => {
        const isActive = id === active;
        const label =
          id === "model" && modelTabIs2DFloorPlan ? "2D Floor Plan" : LABELS[id];
        const icon =
          id === "model" && modelTabIs2DFloorPlan
            ? <LayoutGrid size={14} aria-hidden="true" />
            : ICONS[id];
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(id)}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 16px",
              background: "transparent",
              border: "none",
              color: isActive ? accentColor : "rgba(245,245,250,0.55)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color 0.15s ease",
            }}
          >
            {icon}
            {label}
            {isActive ? (
              <motion.span
                layoutId="result-tab-indicator"
                style={{
                  position: "absolute",
                  bottom: -1,
                  left: 12,
                  right: 12,
                  height: 2,
                  borderRadius: 1,
                  background: accentColor,
                  boxShadow: `0 0 12px ${accentColor}55`,
                }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
