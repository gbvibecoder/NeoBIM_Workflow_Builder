"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Box, Film, FileDown } from "lucide-react";
import { COLORS } from "../constants";
import { HeroSection } from "../sections/HeroSection";
import { KpiStrip } from "../sections/KpiStrip";
import { PipelineViz } from "../sections/PipelineViz";
import type { ShowcaseData } from "../useShowcaseData";
import type { TabId } from "../constants";

interface OverviewTabProps {
  data: ShowcaseData;
  onExpandVideo: () => void;
  onNavigateTab: (tab: TabId) => void;
}

export function OverviewTab({ data, onExpandVideo, onNavigateTab }: OverviewTabProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const descLines = data.textContent.split("\n");
  const shortDesc = descLines.slice(0, 4).join("\n");
  const hasLongDesc = descLines.length > 4;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Two-column layout on wide screens */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 24,
      }}>
        {/* Left: Hero */}
        <div style={{ minWidth: 0 }}>
          <HeroSection
            videoData={data.videoData}
            heroImageUrl={data.heroImageUrl}
            onExpandVideo={onExpandVideo}
          />
          {/* If no hero media, show a placeholder */}
          {!data.videoData?.videoUrl && !data.heroImageUrl && (
            <div style={{
              height: 200,
              borderRadius: 12,
              background: COLORS.GLASS_BG,
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLORS.TEXT_MUTED,
              fontSize: 13,
            }}>
              No media generated
            </div>
          )}
        </div>

        {/* Right: KPIs + Pipeline */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minWidth: 0,
        }}>
          <KpiStrip metrics={data.kpiMetrics} maxItems={6} compact />
          <PipelineViz steps={data.pipelineSteps} />
        </div>
      </div>

      {/* Description */}
      {data.textContent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          style={{
            background: COLORS.GLASS_BG,
            border: `1px solid ${COLORS.GLASS_BORDER}`,
            borderRadius: 10,
            padding: "18px 22px",
          }}
        >
          <div style={{
            fontSize: 13,
            color: COLORS.TEXT_SECONDARY,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}>
            {descExpanded ? data.textContent : shortDesc}
            {hasLongDesc && (
              <button
                onClick={() => setDescExpanded(e => !e)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "none",
                  border: "none",
                  color: COLORS.CYAN,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  marginLeft: 8,
                }}
              >
                {descExpanded ? "Show less" : `Show more (+${descLines.length - 4} lines)`}
                {descExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {data.model3dData && (
          <QuickActionButton
            icon={<Box size={14} />}
            label="View 3D Model"
            color={COLORS.CYAN}
            onClick={() => onNavigateTab("model")}
          />
        )}
        {data.videoData && (
          <QuickActionButton
            icon={<Film size={14} />}
            label="Watch Video"
            color={COLORS.VIOLET}
            onClick={onExpandVideo}
          />
        )}
        <QuickActionButton
          icon={<FileDown size={14} />}
          label="Downloads"
          color={COLORS.AMBER}
          onClick={() => onNavigateTab("export")}
        />
      </div>
    </div>
  );
}

function QuickActionButton({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: 8,
        background: `${color}10`,
        border: `1px solid ${color}30`,
        color,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `${color}20`;
        e.currentTarget.style.boxShadow = `0 0 20px ${color}15`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = `${color}10`;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {icon}
      {label}
    </motion.button>
  );
}
