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
        boxShadow: hovered ? `0 0 8px rgba(${rgb}, 0.7)` : "none",
        transition: "all 0.15s ease",
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
          transition={{ duration: 0.4, ease: "easeOut" }}
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
            width: "40%",
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, rgba(${rgb}, 0.75), transparent)`,
          }}
        />
      )}
    </div>
  );
}

// ─── InputField — editable area for IN-001 and IN-004 ────────────────────────

// InputField removed — replaced by InputNodeContent from InputNode.tsx

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
  const borderOpacity = selected ? 1.0 : isHovered ? 0.5 : 0.2;
  const glowOpacity   = selected ? 0.3 : isHovered ? 0.15 : 0;

  const inLabel  = data.inputs .map(p => p.label).join(", ");
  const outLabel = data.outputs.map(p => p.label).join(", ");
  const typeLabel =
    inLabel && outLabel ? `${inLabel} → ${outLabel}` :
    outLabel            ? `→ ${outLabel}` :
    inLabel             ? `${inLabel} →` :
    null;

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, scale: 0.88, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : 0.18, ease: "easeOut" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: isInput ? 280 : 220,
        background: "rgba(18, 18, 30, 0.85)",
        border: `1px solid rgba(${borderRgb}, ${borderOpacity})`,
        borderRadius: 12,
        boxShadow: `0 4px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.03), 0 0 20px rgba(${rgb}, ${glowOpacity})`,
        backdropFilter: "blur(12px) saturate(1.2)",
        WebkitBackdropFilter: "blur(12px) saturate(1.2)",
        transform: isHovered && !selected ? "scale(1.01)" : "scale(1)",
        transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
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
              `inset 0 0 0 1px rgba(${rgb}, 0.2)`,
              `inset 0 0 0 1px rgba(${rgb}, 0.55)`,
              `inset 0 0 0 1px rgba(${rgb}, 0.2)`,
            ],
          }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Content */}
      <div style={{ padding: "10px 12px 10px 16px" }}>

        {/* Row 1: icon + name + status + INPUT badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ color, flexShrink: 0 }}>
            {getIcon(data.icon, 14)}
          </div>
          <span style={{
            fontSize: 13, fontWeight: 600, color: "#F0F0F5",
            flex: 1, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", lineHeight: 1.2,
          }}>
            {data.label}
          </span>
          {isInput && (
            <span style={{
              fontSize: 8, fontWeight: 700, color: color,
              padding: "1px 5px", borderRadius: 4,
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
                initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }} transition={{ duration: 0.2, ease: "backOut" }}
                style={{ color: "#10B981", flexShrink: 0 }}>
                <CheckCircle2 size={12} />
              </motion.div>
            )}
            {status === "error" && (
              <motion.div key="e"
                initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }} transition={{ duration: 0.2, ease: "backOut" }}
                style={{ color: "#EF4444", flexShrink: 0 }}>
                <AlertCircle size={12} />
              </motion.div>
            )}
            {status === "running" && (
              <motion.div key="r"
                style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }}
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Row 2: type label */}
        {typeLabel && (
          <div style={{
            fontSize: 11, color: "#5C5C78", marginTop: 5, lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {typeLabel}
          </div>
        )}

        {/* Row 2b: interactive input for all 7 input node types */}
        {isInput && <InputNodeContent nodeId={id} data={data} />}

        {/* Row 3: progress + time */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <ProgressBar status={status} color={color} />
          <span style={{ fontSize: 10, color: "#5C5C78", whiteSpace: "nowrap", flexShrink: 0 }}>
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
  );
});

BaseNode.displayName = "BaseNode";
