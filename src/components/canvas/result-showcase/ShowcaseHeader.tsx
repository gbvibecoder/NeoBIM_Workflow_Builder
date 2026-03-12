"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Zap, ArrowLeft } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
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
  const { t } = useLocale();
  return (
    <motion.div
      className="showcase-header"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 20px",
        borderBottom: `1px solid ${COLORS.GLASS_BORDER}`,
        background: "rgba(10,12,16,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
        flexShrink: 0,
        gap: 16,
      }}
    >
      {/* Left: back + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 18px",
            borderRadius: 8,
            background: "rgba(0,245,255,0.08)",
            border: "1px solid rgba(0,245,255,0.25)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease",
            flexShrink: 0,
            backdropFilter: "blur(8px)",
            boxShadow: "0 0 12px rgba(0,245,255,0.06)",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(0,245,255,0.15)";
            e.currentTarget.style.color = "#fff";
            e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0,245,255,0.12)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(0,245,255,0.08)";
            e.currentTarget.style.color = "#fff";
            e.currentTarget.style.borderColor = "rgba(0,245,255,0.25)";
            e.currentTarget.style.boxShadow = "0 0 12px rgba(0,245,255,0.06)";
          }}
        >
          <ArrowLeft size={13} />
          {t('showcase.back')}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h1 style={{
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.TEXT_PRIMARY,
            margin: 0,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
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
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.15)",
              flexShrink: 0,
            }}
          >
            <CheckCircle2 size={10} style={{ color: COLORS.EMERALD }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: COLORS.EMERALD }}>
              {t('showcase.complete')}
            </span>
          </div>
        </div>
      </div>

      {/* Right: stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Zap size={11} style={{ color: COLORS.AMBER }} />
          <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
            {totalArtifacts} {t('showcase.artifacts')}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <CheckCircle2 size={11} style={{ color: COLORS.EMERALD }} />
          <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
            {successNodes}/{totalNodes} {t('showcase.nodes')}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
