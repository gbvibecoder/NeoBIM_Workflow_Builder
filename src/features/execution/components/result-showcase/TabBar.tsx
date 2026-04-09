"use client";

import { motion } from "framer-motion";
import {
  LayoutDashboard, Film, BarChart3, Box, Download, LayoutGrid,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { COLORS, TAB_DEFS, type TabId } from "@/features/execution/components/result-showcase/constants";
import type { TranslationKey } from "@/lib/i18n";

const TAB_LABEL_KEYS: Record<TabId, TranslationKey> = {
  overview: 'showcase.tabOverview',
  media: 'showcase.tabMedia',
  data: 'showcase.tabData',
  model: 'showcase.tabModel',
  export: 'showcase.tabExport',
};

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
  /**
   * When set, the "model" tab is relabeled (and re-iconed) — used when the
   * underlying artifact is a 2D floor plan rather than a true 3D model.
   */
  modelTabIs2DFloorPlan?: boolean;
}

export function TabBar({ availableTabs, activeTab, onTabChange, modelTabIs2DFloorPlan }: TabBarProps) {
  const { t } = useLocale();
  const visibleTabs = TAB_DEFS.filter(td => availableTabs.includes(td.id));

  return (
    <div
      role="tablist"
      aria-label={t('showcase.resultTabsLabel')}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 24px",
        borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
        background: "rgba(7,8,9,0.8)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        // ShowcaseHeader is now portaled into the dashboard header, so the
        // tab bar sits at the top of the showcase scroll container.
        top: 0,
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
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
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
            {tab.id === "model" && modelTabIs2DFloorPlan ? <LayoutGrid size={14} /> : ICONS[tab.id]}
            {tab.id === "model" && modelTabIs2DFloorPlan ? "2D Floor Plan" : t(TAB_LABEL_KEYS[tab.id])}
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
