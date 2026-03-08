"use client";

import React, { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import * as LucideIcons from "lucide-react";
import { CheckCircle2, AlertCircle, Download, Maximize2 } from "lucide-react";
import type { WorkflowNodeData, NodeCategory, NodeStatus } from "@/types/nodes";
import { InputNodeContent } from "./InputNode";
import { ViewTypeSelect } from "./GenerateNodeContent";
import { useLocale } from "@/hooks/useLocale";
import { useExecutionStore } from "@/stores/execution-store";
import type { ExecutionArtifact } from "@/types/execution";

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
        width:  hovered ? 14 : 12,
        height: hovered ? 14 : 12,
        background: hovered ? color : "#1a1a2e",
        border: `2px solid ${hovered ? color : `${color}66`}`,
        borderRadius: "50%",
        boxShadow: hovered ? `0 0 12px rgba(${rgb}, 0.6)` : "none",
        transition: "all 150ms ease",
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
        height: 3,
        flex: 1,
        background: "rgba(255,255,255,0.05)",
        borderRadius: 9999,
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
            borderRadius: 9999,
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
            borderRadius: 9999,
            background: `linear-gradient(90deg, transparent, rgba(${rgb}, 0.85), transparent)`,
            animation: "shimmer 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      )}
    </div>
  );
}

// ─── Inline Result Display ──────────────────────────────────────────────────

function InlineResult({ artifact }: { artifact: ExecutionArtifact }) {
  const d = artifact.data as Record<string, unknown>;

  if (artifact.type === "text") {
    const text = (d?.content as string) ?? "";
    const lines = text.split("\n").slice(0, 4);
    return (
      <div style={{
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            style={{
              fontSize: 10.5, color: "#8888A0", lineHeight: 1.5,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {line || "\u00A0"}
          </motion.div>
        ))}
        {text.split("\n").length > 4 && (
          <div style={{ fontSize: 9, color: "#4F8AFF", marginTop: 2 }}>+{text.split("\n").length - 4} more lines</div>
        )}
      </div>
    );
  }

  if (artifact.type === "kpi") {
    const metrics = (d?.metrics as Array<{ label: string; value: string | number; unit?: string }>) ?? [];
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4,
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        {metrics.slice(0, 4).map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 6, padding: "5px 7px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F5", lineHeight: 1.1 }}>
              {m.value}
              {m.unit && <span style={{ fontSize: 8, color: "#5C5C78", marginLeft: 2 }}>{m.unit}</span>}
            </div>
            <div style={{ fontSize: 7.5, color: "#5C5C78", marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.3px" }}>
              {m.label}
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  if (artifact.type === "image") {
    const url = d?.url as string;
    return (
      <div style={{
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}
        >
          {url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt="Result" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8 }} />
          ) : (
            <div style={{ height: 60, background: "rgba(255,255,255,0.03)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#5C5C78" }}>No preview</span>
            </div>
          )}
          <div style={{
            position: "absolute", top: 6, right: 6,
            width: 22, height: 22, borderRadius: 5,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Maximize2 size={10} style={{ color: "rgba(255,255,255,0.6)" }} />
          </div>
        </motion.div>
      </div>
    );
  }

  if (artifact.type === "json") {
    const json = d?.json as Record<string, unknown>;
    const preview = json ? JSON.stringify(json, null, 1).slice(0, 120) : "{}";
    return (
      <div style={{
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        <motion.pre
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{
            fontSize: 9, color: "#10B981", background: "rgba(0,0,0,0.2)",
            borderRadius: 6, padding: "6px 8px", margin: 0,
            fontFamily: "monospace", lineHeight: 1.4,
            overflow: "hidden", maxHeight: 60,
          }}
        >
          {preview}{preview.length >= 120 ? "..." : ""}
        </motion.pre>
      </div>
    );
  }

  if (artifact.type === "table") {
    const headers = (d?.headers as string[]) ?? [];
    const rows = (d?.rows as string[][]) ?? [];
    return (
      <div style={{
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{
            fontSize: 9, color: "#5C5C78",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 6, padding: "6px 8px",
            overflow: "hidden", maxHeight: 60,
          }}
        >
          <div style={{ fontWeight: 600, color: "#8888A0" }}>{headers.slice(0, 4).join(" | ")}</div>
          {rows.slice(0, 2).map((row, i) => (
            <div key={i}>{row.slice(0, 4).join(" | ")}</div>
          ))}
          {rows.length > 2 && <div style={{ color: "#4F8AFF", marginTop: 2 }}>+{rows.length - 2} rows</div>}
        </motion.div>
      </div>
    );
  }

  if (artifact.type === "file") {
    const name = d?.name as string;
    const size = d?.size as number;
    return (
      <div style={{
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(0,0,0,0.2)",
            borderRadius: 6, padding: "6px 8px",
          }}
        >
          <Download size={11} style={{ color: "#4F8AFF", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "#8888A0" }}>
            {name}
          </div>
          <span style={{ fontSize: 9, color: "#3A3A50", flexShrink: 0 }}>
            {size ? `${(size / 1024).toFixed(0)}KB` : ""}
          </span>
        </motion.div>
      </div>
    );
  }

  if (artifact.type === "svg" || artifact.type === "3d") {
    return (
      <div style={{
        padding: "8px 0 2px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 8,
      }}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(79,138,255,0.06)",
            border: "1px solid rgba(79,138,255,0.15)",
            borderRadius: 6, padding: "8px",
            fontSize: 10, fontWeight: 500, color: "#4F8AFF",
            cursor: "pointer",
          }}
        >
          {artifact.type === "svg" ? "View Floor Plan" : "View 3D Model"}
        </motion.div>
      </div>
    );
  }

  return null;
}

// ─── BaseNode ─────────────────────────────────────────────────────────────────

type BaseNodeProps = NodeProps & { data: WorkflowNodeData };

export const BaseNode = memo(function BaseNode({ id, data, selected }: BaseNodeProps) {
  const { t } = useLocale();
  const [isHovered, setIsHovered] = useState(false);
  const prefersReduced = useReducedMotion();
  const [showResult, setShowResult] = useState(true);

  const category = data.category as NodeCategory;
  const status   = data.status   as NodeStatus;
  const color    = CATEGORY_COLOR[category];
  const rgb      = hexToRgb(color);
  const isInput  = INPUT_NODE_IDS.has(data.catalogueId);

  // Get artifact for this node (for inline result display)
  const artifact = useExecutionStore(s => s.artifacts.get(id));

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
          width: isInput ? 320 : 220,
          background: "linear-gradient(145deg, rgba(12,14,24,0.92) 0%, rgba(8,10,18,0.95) 100%)",
          border: `1px solid ${
            status === "error" ? "rgba(248,113,113,0.5)" :
            status === "success" ? "rgba(52,211,153,0.5)" :
            selected ? `rgba(${rgb}, 0.6)` :
            isHovered ? `${color}55` :
            `${color}35`
          }`,
          borderRadius: 16,
          boxShadow: isHovered
            ? `0 12px 40px rgba(0,0,0,0.6), 0 0 30px rgba(${rgb}, 0.15), inset 0 1px 0 rgba(255,255,255,0.1)${stateGlow ? `, ${stateGlow}` : ""}`
            : `0 4px 24px rgba(0,0,0,0.5), 0 0 1px ${color}40, inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.2)${stateGlow ? `, ${stateGlow}` : ""}`,
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          transform: isHovered && !selected ? "translateY(-4px) scale(1.01)" : "translateY(0)",
          transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          animation: status === "idle" && !isHovered && !selected ? "nodeBreathing 4s ease-in-out infinite" : "none",
          overflow: "hidden",
          cursor: "pointer",
          position: "relative",
        }}
      >
        {/* Top highlight line */}
        <div style={{
          position: "absolute", top: 0, left: "10%", right: "10%", height: 1,
          background: `linear-gradient(90deg, transparent, ${color}50, transparent)`,
        }} />

        {/* Left accent bar */}
        <div style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: 3,
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
          background: `linear-gradient(180deg, ${color} 0%, ${color}20 100%)`,
          boxShadow: `3px 0 15px rgba(${rgb}, 0.25), 6px 0 30px rgba(${rgb}, 0.1)`,
        }} />

        {/* Running — outward ring pulse */}
        {status === "running" && (
          <>
            <motion.div
              style={{
                position: "absolute", inset: -4,
                borderRadius: 20, pointerEvents: "none",
                border: `2px solid rgba(${rgb}, 0.3)`,
              }}
              animate={{
                inset: [-4, -4, -4, -4],
                opacity: [0.6, 0],
                scale: [1, 1.08],
              }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              style={{
                position: "absolute", inset: 0,
                borderRadius: 16, pointerEvents: "none",
              }}
              animate={{
                boxShadow: [
                  `inset 0 0 0 1px rgba(${rgb}, 0.25), 0 0 20px rgba(${rgb}, 0.1)`,
                  `inset 0 0 0 1px rgba(${rgb}, 0.65), 0 0 35px rgba(${rgb}, 0.2)`,
                  `inset 0 0 0 1px rgba(${rgb}, 0.25), 0 0 20px rgba(${rgb}, 0.1)`,
                ],
              }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        )}

        {/* Success glow animation */}
        {status === "success" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{
              position: "absolute", inset: -2,
              borderRadius: 16, pointerEvents: "none",
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
              borderRadius: 16, pointerEvents: "none",
              background: "radial-gradient(circle, rgba(248, 113, 113, 0.25) 0%, transparent 70%)",
            }}
          />
        )}

        {/* Content */}
        <div style={{ padding: "11px 13px 11px 17px" }}>

          {/* Row 1: icon + name + status + INPUT badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 1 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 10,
              background: `${color}15`,
              boxShadow: `0 0 12px ${color}15`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color, flexShrink: 0,
            }}>
              {getIcon(data.icon, 18)}
            </div>
            <span style={{
              fontSize: 13, fontWeight: 600, color: "#e8e8f0", letterSpacing: "-0.01em",
              flex: 1, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", lineHeight: 1.3,
            }}>
              {data.label}
            </span>
            {isInput && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: color,
                padding: "2px 8px", borderRadius: 6,
                background: `${color}25`,
                border: `1px solid ${color}40`,
                boxShadow: `0 0 8px ${color}15`,
                flexShrink: 0, letterSpacing: "0.1em",
                textTransform: "uppercase" as const,
              }}>
                {t('execution.inputLabel')}
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
              fontSize: 11, color: "#4a4a68", marginTop: 6, lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {typeLabel}
            </div>
          )}

          {/* Row 2b: interactive input for all 7 input node types */}
          {isInput && <InputNodeContent nodeId={id} data={data} />}

          {/* Row 2c: viewType select for GN-003 */}
          {data.catalogueId === "GN-003" && <ViewTypeSelect nodeId={id} data={data} />}

          {/* Row 3: progress + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}>
            <ProgressBar status={status} color={color} />
            <span style={{ fontSize: 10, color: "#8888A0", whiteSpace: "nowrap", flexShrink: 0, fontWeight: 500 }}>
              {data.executionTime ?? "< 2s"}
            </span>
          </div>

          {/* Row 4: Inline result (after execution) */}
          <AnimatePresence>
            {artifact && showResult && status === "success" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: "hidden" }}
              >
                <InlineResult artifact={artifact} />
              </motion.div>
            )}
          </AnimatePresence>
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
                  {t('execution.executionError')}
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
        @keyframes nodeBreathing {
          0%, 100% { box-shadow: 0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04); }
          50% { box-shadow: 0 6px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 20px rgba(${rgb}, 0.08); }
        }
      `}</style>
    </>
  );
});

BaseNode.displayName = "BaseNode";
