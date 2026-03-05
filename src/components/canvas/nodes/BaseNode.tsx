"use client";

import React, { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import * as LucideIcons from "lucide-react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { WorkflowNodeData, NodeCategory, NodeStatus } from "@/types/nodes";
import { InputNodeContent } from "./InputNode";

const INPUT_NODE_IDS = new Set(["IN-001","IN-002","IN-003","IN-004","IN-005","IN-006","IN-007"]);

// ─── helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

function getIcon(name: string, size = 14): React.ReactNode {
  const icons = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; strokeWidth?: number }>
  >;
  const Icon = icons[name];
  if (Icon) return <Icon size={size} strokeWidth={1.5} />;
  const Fallback = LucideIcons.Box;
  return <Fallback size={size} strokeWidth={1.5} />;
}

function portPercent(index: number, total: number): number {
  if (total === 1) return 50;
  return ((index + 1) / (total + 1)) * 100;
}

// ─── category colours ────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<NodeCategory, string> = {
  input:     "#3B82F6",
  transform: "#8B5CF6",
  generate:  "#10B981",
  export:    "#F59E0B",
};

// ─── NodeHandle ──────────────────────────────────────────────────────────────

interface NodeHandleProps {
  port: { id: string; label: string; type: string };
  handleType: "source" | "target";
  position: Position;
  topPct: number;
  color: string;
}

function NodeHandle({ port, handleType, position, topPct, color }: NodeHandleProps) {
  const [hovered, setHovered] = useState(false);
  const rgb = hexToRgb(color);

  return (
    <Handle
      type={handleType}
      position={position}
      id={port.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${handleType === "source" ? "Output" : "Input"}: ${port.label}`}
      style={{
        top: `${topPct}%`,
        width:  hovered ? 12 : 8,
        height: hovered ? 12 : 8,
        background: handleType === "source" ? color : "rgba(18,18,26,0.95)",
        border: `2px solid ${color}`,
        borderRadius: "50%",
        boxShadow: hovered ? `0 0 10px rgba(${rgb}, 0.8)` : "none",
        transition: "all 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "crosshair",
        zIndex: 10,
      }}
    />
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

function ProgressBar({ status, color }: { status: NodeStatus; color: string }) {
  const rgb = hexToRgb(color);

  return (
    <div
      style={{
        height: 4,
        flex: 1,
        background: "rgba(88, 88, 112, 0.18)",
        borderRadius: 2,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {(status === "success" || status === "error") && (
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            borderRadius: 2,
            background: status === "success" ? "#10B981" : "#EF4444",
          }}
        />
      )}
      {status === "running" && (
        <div
          className="node-shimmer"
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: "50%",
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, rgba(${rgb}, 0.85), transparent)`,
            animation: "shimmer 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      )}
    </div>
  );
}

// ─── BaseNode ─────────────────────────────────────────────────────────────────

type BaseNodeProps = NodeProps & { data: WorkflowNodeData };

export const BaseNode = memo(function BaseNode({ id, data, selected }: BaseNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const prefersReduced = useReducedMotion();

  const category = data.category as NodeCategory;
  const status   = data.status   as NodeStatus;
  const color    = CATEGORY_COLOR[category];
  const rgb      = hexToRgb(color);
  const isInput  = INPUT_NODE_IDS.has(data.catalogueId);

  const borderColor =
    status === "error"   ? "#F87171" :
    status === "success" ? "#34D399" :
    color;
  const borderRgb     = hexToRgb(borderColor);
  const borderOpacity = selected ? 1.0 : isHovered ? 0.6 : 0.25;
  const glowOpacity   = selected ? 0.35 : isHovered ? 0.2 : 0;

  // Enhanced glow for success/error states
  const stateGlow = 
    status === "success" ? "0 0 30px rgba(52, 211, 153, 0.4)" :
    status === "error"   ? "0 0 30px rgba(248, 113, 113, 0.4)" :
    "";

  const inLabel  = data.inputs .map(p => p.label).join(", ");
  const outLabel = data.outputs.map(p => p.label).join(", ");
  const typeLabel =
    inLabel && outLabel ? `${inLabel} → ${outLabel}` :
    outLabel            ? `→ ${outLabel}` :
    inLabel             ? `${inLabel} →` :
    null;

  const errorMessage = (data as WorkflowNodeData & { errorMessage?: string })?.errorMessage;

  return (
    <>
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, scale: 0.88, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: prefersReduced ? 0 : 0.22, ease: [0.4, 0, 0.2, 1] }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: isInput ? 290 : 230,
          background: "rgba(18, 18, 30, 0.90)",
          border: `1px solid rgba(${borderRgb}, ${borderOpacity})`,
          borderRadius: 12,
          boxShadow: `
            0 4px 24px rgba(0,0,0,0.28),
            0 0 0 1px rgba(255,255,255,0.04),
            0 0 24px rgba(${rgb}, ${glowOpacity})
            ${stateGlow ? `, ${stateGlow}` : ""}
          `,
          backdropFilter: "blur(16px) saturate(1.3)",
          WebkitBackdropFilter: "blur(16px) saturate(1.3)",
          transform: isHovered && !selected ? "scale(1.015)" : "scale(1)",
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          overflow: "hidden",
          cursor: "pointer",
          position: "relative",
        }}
      >
        {/* Left accent bar */}
        <div style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: 3,
          background: color,
          boxShadow: `0 0 8px rgba(${rgb}, 0.5)`,
        }} />

        {/* Running border pulse */}
        {status === "running" && (
          <motion.div
            style={{
              position: "absolute", inset: 0,
              borderRadius: 12, pointerEvents: "none",
            }}
            animate={{
              boxShadow: [
                `inset 0 0 0 1px rgba(${rgb}, 0.25)`,
                `inset 0 0 0 1px rgba(${rgb}, 0.65)`,
                `inset 0 0 0 1px rgba(${rgb}, 0.25)`,
              ],
            }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {/* Success glow animation */}
        {status === "success" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{
              position: "absolute", inset: -2,
              borderRadius: 12, pointerEvents: "none",
              background: "radial-gradient(circle, rgba(52, 211, 153, 0.3) 0%, transparent 70%)",
            }}
          />
        )}

        {/* Error glow animation */}
        {status === "error" && (
          <motion.div
            animate={{
              opacity: [0.4, 0.7, 0.4],
            }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            style={{
              position: "absolute", inset: -2,
              borderRadius: 12, pointerEvents: "none",
              background: "radial-gradient(circle, rgba(248, 113, 113, 0.25) 0%, transparent 70%)",
            }}
          />
        )}

        {/* Content */}
        <div style={{ padding: "11px 13px 11px 17px" }}>

          {/* Row 1: icon + name + status + INPUT badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 1 }}>
            <div style={{ color, flexShrink: 0 }}>
              {getIcon(data.icon, 14)}
            </div>
            <span style={{
              fontSize: 13, fontWeight: 600, color: "#F0F0F5",
              flex: 1, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", lineHeight: 1.3,
            }}>
              {data.label}
            </span>
            {isInput && (
              <span style={{
                fontSize: 8, fontWeight: 700, color: color,
                padding: "2px 6px", borderRadius: 4,
                background: `${color}18`,
                border: `1px solid ${color}40`,
                flexShrink: 0, letterSpacing: 0.5,
              }}>
                INPUT
              </span>
            )}
            <AnimatePresence mode="wait">
              {status === "success" && (
                <motion.div key="s"
                  initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  style={{ color: "#10B981", flexShrink: 0 }}>
                  <CheckCircle2 size={13} />
                </motion.div>
              )}
              {status === "error" && (
                <motion.div key="e"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  style={{ color: "#EF4444", flexShrink: 0 }}>
                  <AlertCircle size={13} />
                </motion.div>
              )}
              {status === "running" && (
                <motion.div key="r"
                  style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }}
                  animate={{ opacity: [1, 0.3, 1], scale: [1, 0.85, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Row 2: type label */}
          {typeLabel && (
            <div style={{
              fontSize: 11, color: "#7C7C90", marginTop: 6, lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {typeLabel}
            </div>
          )}

          {/* Row 2b: interactive input for all 7 input node types */}
          {isInput && <InputNodeContent nodeId={id} data={data} />}

          {/* Row 3: progress + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}>
            <ProgressBar status={status} color={color} />
            <span style={{ fontSize: 10, color: "#8888A0", whiteSpace: "nowrap", flexShrink: 0, fontWeight: 500 }}>
              {data.executionTime ?? "< 2s"}
            </span>
          </div>
        </div>

        {/* Handles */}
        {data.inputs.map((port, i) => (
          <NodeHandle key={port.id} port={port} handleType="target"
            position={Position.Left} topPct={portPercent(i, data.inputs.length)} color={color} />
        ))}
        {data.outputs.map((port, i) => (
          <NodeHandle key={port.id} port={port} handleType="source"
            position={Position.Right} topPct={portPercent(i, data.outputs.length)} color={color} />
        ))}
      </motion.div>

      {/* Error message tooltip */}
      <AnimatePresence>
        {status === "error" && errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              marginTop: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(30, 10, 10, 0.95)",
              border: "1px solid rgba(248, 113, 113, 0.4)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              maxWidth: 280,
              zIndex: 1000,
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertCircle size={14} style={{ color: "#F87171", flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#F87171", marginBottom: 3 }}>
                  Execution Error
                </div>
                <div style={{ fontSize: 10, color: "#E0B4B4", lineHeight: 1.5 }}>
                  {errorMessage}
                </div>
              </div>
            </div>
            {/* Pointer triangle */}
            <div style={{
              position: "absolute",
              top: -5,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderBottom: "5px solid rgba(248, 113, 113, 0.4)",
            }} />
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </>
  );
});

BaseNode.displayName = "BaseNode";
