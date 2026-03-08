"use client";

import React from "react";
import { Star, GitFork, Zap, Clock, Crown, Share2 } from "lucide-react";
import { shareTemplateToTwitter } from "@/lib/share";
import { motion } from "framer-motion";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { LIVE_NODES } from "@/constants/node-catalogue";
import type { WorkflowTemplate } from "@/types/workflow";
import type { NodeCategory } from "@/types/nodes";

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

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

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
  buttonLabel = "Use Template",
  index = 0,
}: WorkflowCardProps) {
  const nodeCount       = workflow.tileGraph.nodes.length;
  const catalogueIds = workflow.tileGraph.nodes.map(n => n.data.catalogueId).filter(Boolean);
  const nonInputIds = catalogueIds.filter(id => !id.startsWith("IN-")); // Input nodes don't count
  const liveCount = nonInputIds.filter(id => LIVE_NODES.has(id)).length;
  const isFullyLive = nonInputIds.length > 0 && liveCount === nonInputIds.length;
  const isPartiallyLive = liveCount > 0 && !isFullyLive;
  const complexityColor = COMPLEXITY_COLOR[workflow.complexity] ?? "#55556A";
  const catColor        = CATEGORY_COLOR[workflow.category ?? ""] ?? "#4F8AFF";

  const diagramNodes = workflow.tileGraph.nodes.map(n => ({
    label:    n.data.label,
    category: n.data.category as NodeCategory,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: "easeOut" }}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      style={{
        borderRadius: 14,
        border: isFeatured
          ? "1px solid rgba(245,158,11,0.4)"
          : "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))",
        overflow: "hidden",
        cursor: "default",
        position: "relative",
        boxShadow: isFeatured
          ? "0 0 24px rgba(245,158,11,0.08)"
          : "0 1px 3px rgba(0,0,0,0.1)",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={e => {
        if (!isFeatured) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)";
        const shareBtn = e.currentTarget.querySelector(".workflow-card-share") as HTMLElement | null;
        if (shareBtn) shareBtn.style.opacity = "1";
      }}
      onMouseLeave={e => {
        if (!isFeatured) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
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
          background: "rgba(245,158,11,0.15)",
          border: "1px solid rgba(245,158,11,0.35)",
          fontSize: 9, fontWeight: 700, color: "#F59E0B",
          letterSpacing: "0.4px",
        }}>
          <Crown size={9} />
          FEATURED
        </div>
      )}

      {/* Top: Mini diagram */}
      <div style={{
        height: 130,
        background: "#0B0B13",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Category accent top bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: catColor,
          opacity: 0.7,
        }} />

        <MiniWorkflowDiagram nodes={diagramNodes} size="md" animated />

        {/* Share button — top-right, visible on card hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            shareTemplateToTwitter(workflow.name);
          }}
          title="Share template"
          style={{
            position: "absolute", top: 8, right: isFeatured ? 90 : 8,
            width: 26, height: 26, borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
            color: "#8888A0", cursor: "pointer",
            opacity: 0, transition: "opacity 0.15s, color 0.15s",
          }}
          className="workflow-card-share"
          onMouseEnter={e => { e.currentTarget.style.color = "#4F8AFF"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#8888A0"; }}
        >
          <Share2 size={11} />
        </button>

        {/* Category chip */}
        <div style={{
          position: "absolute", bottom: 8, left: 8,
          fontSize: 9, padding: "2px 7px", borderRadius: 10,
          background: `rgba(${hexToRgb(catColor)}, 0.12)`,
          border: `1px solid rgba(${hexToRgb(catColor)}, 0.25)`,
          color: catColor, fontWeight: 600, textTransform: "uppercase" as const,
          letterSpacing: "0.4px",
        }}>
          {workflow.category}
        </div>
      </div>

      {/* Bottom: Content */}
      <div style={{ padding: "13px 14px 12px" }}>
        {/* Title */}
        <h3 style={{
          fontSize: 15, fontWeight: 600, color: "#F0F0F5",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginBottom: 5,
        }}>
          {workflow.name}
        </h3>

        {/* Description */}
        <p style={{
          fontSize: 12, color: "#7C7C96", lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
          margin: "0 0 9px",
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
              }}>Verified</span>
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
                <span>{cloneCount.toLocaleString()} clones</span>
              </div>
            )}
          </div>
        )}

        {/* Meta row */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.06)",
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
              }} />
              {workflow.complexity}
            </div>
            {/* Node count */}
            <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#3A3A50" }}>
              <Zap size={9} style={{ color: "#4F8AFF" }} />
              {nodeCount} nodes
            </div>
            {/* Time */}
            {workflow.estimatedRunTime && (
              <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#3A3A50" }}>
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
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.2)",
              }}>
                Fully Live
              </div>
            )}
            {isPartiallyLive && (
              <div style={{
                display: "flex", alignItems: "center", gap: 3,
                fontSize: 9, fontWeight: 700, color: "#F59E0B",
                padding: "1px 6px", borderRadius: 10,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.2)",
              }}>
                Partially Live
              </div>
            )}
          </div>

          {/* Action button */}
          {showCloneButton && onClone && (
            <button
              onClick={() => onClone(workflow.id)}
              style={{
                padding: "4px 10px", borderRadius: 6,
                background: "rgba(79,138,255,0.1)",
                border: "1px solid rgba(79,138,255,0.2)",
                fontSize: 10, fontWeight: 600, color: "#4F8AFF",
                cursor: "pointer", transition: "all 0.12s",
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.18)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.4)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.1)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.2)";
              }}
            >
              {buttonLabel}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
