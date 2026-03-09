"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Zap, ArrowLeft } from "lucide-react";
import { COLORS } from "./constants";

interface ShowcaseHeaderProps {
  projectTitle: string;
  totalArtifacts: number;
  successNodes: number;
  totalNodes: number;
  onClose: () => void;
}

export function ShowcaseHeader({
  projectTitle,
  totalArtifacts,
  successNodes,
  totalNodes,
  onClose,
}: ShowcaseHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
        background: "rgba(7,8,9,0.95)",
        backdropFilter: "blur(20px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
        flexShrink: 0,
      }}
    >
      {/* Left: back + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 8,
            background: COLORS.GLASS_BG,
            border: `1px solid ${COLORS.GLASS_BORDER}`,
            color: COLORS.TEXT_SECONDARY,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = COLORS.TEXT_PRIMARY;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = COLORS.GLASS_BG;
            e.currentTarget.style.color = COLORS.TEXT_SECONDARY;
          }}
        >
          <ArrowLeft size={13} />
          Back
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{
            fontSize: 15,
            fontWeight: 600,
            color: COLORS.TEXT_PRIMARY,
            margin: 0,
            letterSpacing: "-0.01em",
          }}>
            {projectTitle}
          </h1>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 12,
              background: "rgba(16,185,129,0.1)",
              border: "1px solid rgba(16,185,129,0.2)",
            }}
          >
            <CheckCircle2 size={10} style={{ color: COLORS.EMERALD }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: COLORS.EMERALD }}>
              Complete
            </span>
          </div>
        </div>
      </div>

      {/* Right: stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Zap size={11} style={{ color: COLORS.AMBER }} />
          <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
            {totalArtifacts} artifacts
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <CheckCircle2 size={11} style={{ color: COLORS.EMERALD }} />
          <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
            {successNodes}/{totalNodes} nodes
          </span>
        </div>
      </div>
    </motion.div>
  );
}
