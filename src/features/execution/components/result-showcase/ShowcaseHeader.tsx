"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "@/features/execution/components/result-showcase/constants";

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

  // Portal target — when on the canvas page in the dashboard layout, the
  // showcase header content renders inside the empty top dashboard header
  // instead of taking its own row.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setHeaderSlot(document.getElementById("canvas-toolbar-slot"));
    find();
    const t = setTimeout(find, 0);
    return () => clearTimeout(t);
  }, []);
  const inHeader = !!headerSlot;

  const content = (
    <motion.div
      className="showcase-header"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: inHeader ? 0 : "10px clamp(12px, 3vw, 20px)",
        borderBottom: inHeader ? "none" : `1px solid ${COLORS.GLASS_BORDER}`,
        background: inHeader ? "transparent" : "rgba(10,12,16,0.92)",
        backdropFilter: inHeader ? "none" : "blur(24px)",
        WebkitBackdropFilter: inHeader ? "none" : "blur(24px)",
        position: inHeader ? "relative" : "sticky",
        top: inHeader ? undefined : 0,
        zIndex: inHeader ? undefined : 10,
        flexShrink: 0,
        gap: 16,
        width: inHeader ? "100%" : undefined,
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

      {/*
        Right-side stats (artifacts count + N/N nodes) intentionally removed
        from the dashboard header — they're already surfaced inside the
        showcase body (Execution Complete row + per-section stat cards).
      */}
    </motion.div>
  );

  return inHeader && headerSlot ? createPortal(content, headerSlot) : content;
}
