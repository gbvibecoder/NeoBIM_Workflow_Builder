"use client";

import { motion } from "framer-motion";
import {
  LayoutDashboard, Film, BarChart3, Box, Download,
} from "lucide-react";
import { COLORS, TAB_DEFS, type TabId } from "./constants";

const ICONS: Record<TabId, React.ReactNode> = {
  overview: <LayoutDashboard size={14} />,
  media: <Film size={14} />,
  data: <BarChart3 size={14} />,
  model: <Box size={14} />,
  export: <Download size={14} />,
};

interface TabBarProps {
  availableTabs: TabId[];
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ availableTabs, activeTab, onTabChange }: TabBarProps) {
  const visibleTabs = TAB_DEFS.filter(t => availableTabs.includes(t.id));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 24px",
        borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
        background: "rgba(7,8,9,0.8)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 52, // below header
        zIndex: 9,
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {visibleTabs.map(tab => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 16px",
              background: "none",
              border: "none",
              color: isActive ? COLORS.CYAN : COLORS.TEXT_MUTED,
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              transition: "color 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.color = COLORS.TEXT_SECONDARY;
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.color = COLORS.TEXT_MUTED;
            }}
          >
            {ICONS[tab.id]}
            {tab.label}
            {isActive && (
              <motion.div
                layoutId="tab-indicator"
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 12,
                  right: 12,
                  height: 2,
                  borderRadius: 1,
                  background: COLORS.CYAN,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
