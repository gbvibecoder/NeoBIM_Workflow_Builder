"use client";

import React from "react";
import { Star, GitFork, Zap, Clock, Crown, Share2, Building2, Ruler, Layers } from "lucide-react";
import { shareTemplateToTwitter } from "@/lib/share";
import { motion } from "framer-motion";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { LIVE_NODES } from "@/constants/node-catalogue";
import type { WorkflowTemplate } from "@/types/workflow";
import type { NodeCategory } from "@/types/nodes";
import { useLocale } from "@/hooks/useLocale";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMPLEXITY_COLOR: Record<string, string> = {
  simple:       "#10B981",
  intermediate: "#F59E0B",
  advanced:     "#EF4444",
};

const CATEGORY_COLOR: Record<string, string> = {
  "Concept Design":   "#3B82F6",
  "Visualization":    "#10B981",
  "BIM Export":       "#F59E0B",
  "Cost Estimation":  "#8B5CF6",
  "Full Pipeline":    "#06B6D4",
  "Compliance":       "#EF4444",
  "Site Analysis":    "#10B981",
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  "Concept Design":   <Building2 size={8} />,
  "Visualization":    <Layers size={8} />,
  "BIM Export":       <Layers size={8} />,
  "Cost Estimation":  <Ruler size={8} />,
  "Full Pipeline":    <Building2 size={8} />,
  "Site Analysis":    <Layers size={8} />,
};

import { hexToRgb } from "@/lib/ui-constants";

// Avatar from initials
function AuthorAvatar({ name, size = 22 }: { name: string; size?: number }) {
  const initials = name.split(" ").slice(0, 2).map(p => p[0]).join("").toUpperCase();
  // Deterministic color from name
  let hash = 0;
  for (let c = 0; c < name.length; c++) hash = name.charCodeAt(c) + ((hash << 5) - hash);
  const colors = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];
  const color = colors[Math.abs(hash) % colors.length];

  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `rgba(${hexToRgb(color)}, 0.2)`,
      border: `1px solid rgba(${hexToRgb(color)}, 0.4)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, color, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// Star rating display
function StarRating({ rating }: { rating: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          size={9}
          style={{ color: s <= Math.round(rating) ? "#FBBF24" : "#2A2A3E" }}
          fill={s <= Math.round(rating) ? "#FBBF24" : "none"}
        />
      ))}
      <span style={{ fontSize: 10, color: "#8888A0", marginLeft: 2 }}>
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

// Blueprint-style grid overlay for the card top section
function CardBlueprintOverlay({ color }: { color: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {/* Subtle grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(rgba(${hexToRgb(color)},0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(${hexToRgb(color)},0.03) 1px, transparent 1px)
        `,
        backgroundSize: "20px 20px",
      }} />
      {/* Corner bracket top-left */}
      <svg style={{ position: "absolute", top: 6, left: 6 }} width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M0 4 L0 0 L4 0" stroke={`rgba(${hexToRgb(color)},0.15)`} strokeWidth="0.5" />
      </svg>
      {/* Corner bracket bottom-right */}
      <svg style={{ position: "absolute", bottom: 6, right: 6 }} width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M6 10 L10 10 L10 6" stroke={`rgba(${hexToRgb(color)},0.15)`} strokeWidth="0.5" />
      </svg>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface WorkflowCardProps {
  workflow: WorkflowTemplate;
  href?: string;
  onClone?: (id: string) => void;
  showCloneButton?: boolean;
  ratingAvg?: number;
  cloneCount?: number;
  authorName?: string;
  publishedAt?: string;
  isFeatured?: boolean;
  buttonLabel?: string;
  index?: number;
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function WorkflowCard({
  workflow,
  onClone,
  showCloneButton = false,
  ratingAvg,
  cloneCount,
  authorName,
  publishedAt,
  isFeatured = false,
  buttonLabel,
  index = 0,
}: WorkflowCardProps) {
  const { t } = useLocale();
  const nodeCount       = workflow.tileGraph.nodes.length;
  const catalogueIds = workflow.tileGraph.nodes.map(n => n.data.catalogueId).filter(Boolean);
  const nonInputIds = catalogueIds.filter(id => !id.startsWith("IN-")); // Input nodes don't count
  const liveCount = nonInputIds.filter(id => LIVE_NODES.has(id)).length;
  const isFullyLive = nonInputIds.length > 0 && liveCount === nonInputIds.length;
  const isPartiallyLive = liveCount > 0 && !isFullyLive;
  const complexityColor = COMPLEXITY_COLOR[workflow.complexity] ?? "#55556A";
  const catColor        = CATEGORY_COLOR[workflow.category ?? ""] ?? "#4F8AFF";
  const catIcon         = CATEGORY_ICON[workflow.category ?? ""];

  const diagramNodes = workflow.tileGraph.nodes.map(n => ({
    label:    n.data.label,
    category: n.data.category as NodeCategory,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: "easeOut" }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      style={{
        borderRadius: 14,
        border: isFeatured
          ? "1px solid rgba(245,158,11,0.35)"
          : "1px solid rgba(255,255,255,0.05)",
        background: "linear-gradient(165deg, rgba(16,16,28,0.98), rgba(10,10,18,0.99))",
        overflow: "hidden",
        cursor: "default",
        position: "relative",
        boxShadow: isFeatured
          ? "0 0 30px rgba(245,158,11,0.06), 0 4px 16px rgba(0,0,0,0.2)"
          : "0 2px 8px rgba(0,0,0,0.15)",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={e => {
        if (!isFeatured) {
          (e.currentTarget as HTMLElement).style.borderColor = `rgba(${hexToRgb(catColor)},0.2)`;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px rgba(0,0,0,0.25), 0 0 30px rgba(${hexToRgb(catColor)},0.04)`;
        }
        const shareBtn = e.currentTarget.querySelector(".workflow-card-share") as HTMLElement | null;
        if (shareBtn) shareBtn.style.opacity = "1";
      }}
      onMouseLeave={e => {
        if (!isFeatured) {
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
        }
        const shareBtn = e.currentTarget.querySelector(".workflow-card-share") as HTMLElement | null;
        if (shareBtn) shareBtn.style.opacity = "0";
      }}
    >
      {/* Featured badge */}
      {isFeatured && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 10,
          display: "flex", alignItems: "center", gap: 4,
          padding: "3px 8px", borderRadius: 20,
          background: "rgba(245,158,11,0.12)",
          border: "1px solid rgba(245,158,11,0.3)",
          fontSize: 9, fontWeight: 700, color: "#F59E0B",
          letterSpacing: "0.4px",
        }}>
          <Crown size={9} />
          {t('community.featured')}
        </div>
      )}

      {/* Top: Mini diagram with blueprint overlay */}
      <div style={{
        height: 130,
        background: `linear-gradient(180deg, rgba(${hexToRgb(catColor)},0.02) 0%, #09090F 100%)`,
        borderBottom: `1px solid rgba(${hexToRgb(catColor)},0.06)`,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Blueprint grid overlay */}
        <CardBlueprintOverlay color={catColor} />

        {/* Category accent top bar — gradient */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${catColor}, rgba(${hexToRgb(catColor)},0.2))`,
          opacity: 0.6,
        }} />

        <MiniWorkflowDiagram nodes={diagramNodes} size="md" animated />

        {/* Share button — top-right, always visible on mobile, hover on desktop */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            shareTemplateToTwitter(workflow.name);
          }}
          title={t('community.shareTemplate')}
          style={{
            position: "absolute", top: 8, right: isFeatured ? 90 : 8,
            width: 26, height: 26, borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#6B6B85", cursor: "pointer",
            transition: "opacity 0.15s, color 0.15s",
            backdropFilter: "blur(8px)",
          }}
          className="workflow-card-share workflow-card-share-visible"
          onMouseEnter={e => { e.currentTarget.style.color = "#4F8AFF"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#6B6B85"; }}
        >
          <Share2 size={11} />
        </button>

        {/* Category chip with icon */}
        <div style={{
          position: "absolute", bottom: 8, left: 8,
          fontSize: 9, padding: "3px 8px", borderRadius: 6,
          background: `rgba(${hexToRgb(catColor)}, 0.1)`,
          border: `1px solid rgba(${hexToRgb(catColor)}, 0.2)`,
          color: catColor, fontWeight: 600, textTransform: "uppercase" as const,
          letterSpacing: "0.4px",
          display: "flex", alignItems: "center", gap: 4,
          backdropFilter: "blur(4px)",
        }}>
          {catIcon}
          {workflow.category}
        </div>
      </div>

      {/* Bottom: Content */}
      <div style={{ padding: "14px 16px 13px" }}>
        {/* Title */}
        <h3 style={{
          fontSize: 14, fontWeight: 650, color: "#F0F0F5",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
          marginBottom: 6, letterSpacing: "-0.01em",
          lineHeight: 1.4,
        }}>
          {workflow.name}
        </h3>

        {/* Description */}
        <p style={{
          fontSize: 12, color: "#6B6B85", lineHeight: 1.55,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
          margin: "0 0 10px",
        }}>
          {workflow.description}
        </p>

        {/* Author row (community) */}
        {authorName && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <AuthorAvatar name={authorName} size={20} />
            <span style={{ fontSize: 11, color: "#6B6B85" }}>{authorName}</span>
            {authorName === "BuildFlow Team" && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: "#10B981",
                padding: "1px 5px", borderRadius: 3,
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.25)",
                marginLeft: 4,
              }}>{t('community.verified')}</span>
            )}
            {publishedAt && (
              <span style={{ fontSize: 10, color: "#3A3A50", marginLeft: "auto" }}>{publishedAt}</span>
            )}
          </div>
        )}

        {/* Ratings (community) */}
        {ratingAvg !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <StarRating rating={ratingAvg} />
            {cloneCount !== undefined && (
              <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#4A4A60" }}>
                <GitFork size={9} />
                <span>{cloneCount.toLocaleString()} {t('community.clones')}</span>
              </div>
            )}
          </div>
        )}

        {/* Meta row */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Complexity */}
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 9, fontWeight: 600, textTransform: "capitalize" as const,
              color: complexityColor,
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%",
                background: complexityColor, flexShrink: 0,
                boxShadow: `0 0 6px ${complexityColor}40`,
              }} />
              {workflow.complexity}
            </div>
            {/* Node count */}
            <div style={{
              display: "flex", alignItems: "center", gap: 3,
              fontSize: 10, color: "#3A3A50",
              fontFamily: "monospace",
            }}>
              <Zap size={9} style={{ color: "rgba(79,138,255,0.5)" }} />
              {nodeCount} {t('community.nodes')}
            </div>
            {/* Time */}
            {workflow.estimatedRunTime && (
              <div style={{
                display: "flex", alignItems: "center", gap: 3,
                fontSize: 10, color: "#3A3A50",
                fontFamily: "monospace",
              }}>
                <Clock size={9} />
                {workflow.estimatedRunTime}
              </div>
            )}
            {/* Live status badge */}
            {isFullyLive && (
              <div style={{
                display: "flex", alignItems: "center", gap: 3,
                fontSize: 9, fontWeight: 700, color: "#10B981",
                padding: "1px 6px", borderRadius: 10,
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.15)",
              }}>
                {t('community.fullyLive')}
              </div>
            )}
            {isPartiallyLive && (
              <div style={{
                display: "flex", alignItems: "center", gap: 3,
                fontSize: 9, fontWeight: 700, color: "#F59E0B",
                padding: "1px 6px", borderRadius: 10,
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.15)",
              }}>
                {t('community.partiallyLive')}
              </div>
            )}
          </div>

          {/* Action button */}
          {showCloneButton && onClone && (
            <button
              onClick={() => onClone(workflow.id)}
              style={{
                padding: "5px 12px", borderRadius: 6,
                background: `rgba(${hexToRgb(catColor)},0.08)`,
                border: `1px solid rgba(${hexToRgb(catColor)},0.15)`,
                fontSize: 10, fontWeight: 600, color: catColor,
                cursor: "pointer", transition: "all 0.15s ease",
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `rgba(${hexToRgb(catColor)},0.15)`;
                (e.currentTarget as HTMLElement).style.borderColor = `rgba(${hexToRgb(catColor)},0.35)`;
                (e.currentTarget as HTMLElement).style.transform = "scale(1.02)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = `rgba(${hexToRgb(catColor)},0.08)`;
                (e.currentTarget as HTMLElement).style.borderColor = `rgba(${hexToRgb(catColor)},0.15)`;
                (e.currentTarget as HTMLElement).style.transform = "scale(1)";
              }}
            >
              {buttonLabel ?? t('community.useTemplate')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
