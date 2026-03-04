"use client";

import React, { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiagramNode {
  label: string;
  category: string;
}

interface MiniWorkflowDiagramProps {
  nodes: DiagramNode[];
  size?: "sm" | "md" | "lg";
  animated?: boolean;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  input:     "#3B82F6",
  transform: "#8B5CF6",
  generate:  "#10B981",
  export:    "#F59E0B",
};

// ─── Component ───────────────────────────────────────────────────────────────

export const MiniWorkflowDiagram = memo(function MiniWorkflowDiagram({
  nodes,
  size = "md",
  animated = true,
}: MiniWorkflowDiagramProps) {
  const prefersReduced = useReducedMotion();
  const dotSize   = size === "sm" ? 9  : size === "md" ? 12 : 20;
  const fontSize  = size === "lg" ? 10 : 8;
  const lineWidth = size === "lg" ? 28 : 14;
  const gapPad    = size === "lg" ? "0 24px" : "0 12px";

  // Show at most 6 nodes to keep things tidy
  const display = nodes.slice(0, 6);

  return (
    <div style={{
      display: "flex", alignItems: "center",
      justifyContent: "center",
      height: "100%",
      padding: gapPad,
      overflow: "hidden",
    }}>
      {display.map((node, i) => {
        const color = CATEGORY_COLORS[node.category] ?? "#4F8AFF";
        const firstWord = node.label.split(" ")[0] ?? node.label;

        return (
          <React.Fragment key={i}>
            {/* Node dot + label */}
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: 5, flexShrink: 0,
            }}>
              <motion.div
                animate={animated && !prefersReduced ? { scale: [1, 1.18, 1] } : {}}
                transition={{
                  duration: 2.8,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.5,
                }}
                style={{
                  width: dotSize, height: dotSize,
                  borderRadius: "50%",
                  background: color,
                  boxShadow: `0 0 ${dotSize + 2}px ${color}55`,
                  flexShrink: 0,
                }}
              />
              <span style={{
                fontSize,
                color: "#5C5C78",
                whiteSpace: "nowrap",
                maxWidth: size === "lg" ? 56 : 36,
                overflow: "hidden",
                textOverflow: "ellipsis",
                textAlign: "center",
                lineHeight: 1.2,
              }}>
                {firstWord}
              </span>
            </div>

            {/* Connector */}
            {i < display.length - 1 && (
              <div style={{
                width: lineWidth, height: 1,
                background: "rgba(255,255,255,0.1)",
                flexShrink: 0,
                marginBottom: 13,
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});

MiniWorkflowDiagram.displayName = "MiniWorkflowDiagram";
