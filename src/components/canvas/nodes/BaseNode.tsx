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
  input:     "#00F5FF",
  transform: "#B87333",
  generate:  "#FFBF00",
  export:    "#4FC3F7",
};

// ─── Category-specific background patterns ──────────────────────────────────

const CATEGORY_BG: Record<NodeCategory, React.CSSProperties> = {
  // Subtle dot grid — Atelier style
  input: {
    backgroundImage: 'radial-gradient(circle, rgba(0,245,255,0.04) 0.5px, transparent 0.5px)',
    backgroundSize: '12px 12px',
  },
  // Diagonal copper streams
  transform: {
    backgroundImage: [
      'repeating-linear-gradient(135deg, transparent, transparent 11px, rgba(184,115,51,0.04) 11px, rgba(184,115,51,0.04) 12px)',
      'repeating-linear-gradient(45deg, transparent, transparent 15px, rgba(184,115,51,0.025) 15px, rgba(184,115,51,0.025) 16px)',
    ].join(', '),
  },
  // Amber grid
  generate: {
    backgroundImage: [
      'linear-gradient(rgba(255,191,0,0.03) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(255,191,0,0.03) 1px, transparent 1px)',
    ].join(', '),
    backgroundSize: '10px 10px',
  },
  // Light stipple
  export: {
    backgroundImage: 'radial-gradient(circle, rgba(79,195,247,0.03) 0.5px, transparent 0.5px)',
    backgroundSize: '8px 8px',
  },
};

// ─── Corner Accents (targeting reticle / drafting markers) ──────────────────

function CornerAccents({ color, opacity }: { color: string; opacity: number }) {
  const c = `rgba(${hexToRgb(color)}, ${opacity})`;
  return (
    <>
      {/* Top-left */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 8, height: 1.5, background: c, pointerEvents: "none", zIndex: 2 }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: 1.5, height: 8, background: c, pointerEvents: "none", zIndex: 2 }} />
      {/* Top-right */}
      <div style={{ position: "absolute", top: 0, right: 0, width: 8, height: 1.5, background: c, pointerEvents: "none", zIndex: 2 }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 1.5, height: 8, background: c, pointerEvents: "none", zIndex: 2 }} />
      {/* Bottom-left */}
      <div style={{ position: "absolute", bottom: 0, left: 0, width: 8, height: 1.5, background: c, pointerEvents: "none", zIndex: 2 }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, width: 1.5, height: 8, background: c, pointerEvents: "none", zIndex: 2 }} />
      {/* Bottom-right */}
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 1.5, background: c, pointerEvents: "none", zIndex: 2 }} />
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 1.5, height: 8, background: c, pointerEvents: "none", zIndex: 2 }} />
    </>
  );
}

// ─── Tick Marks (scale ruler — input nodes only) ────────────────────────────

function TickMarks({ color }: { color: string }) {
  const c = `rgba(${hexToRgb(color)}, 0.12)`;
  const cS = `rgba(${hexToRgb(color)}, 0.22)`;
  return (
    <>
      {/* Top edge */}
      {Array.from({ length: 10 }, (_, i) => (
        <div key={`t${i}`} style={{
          position: "absolute", top: 0,
          left: `${((i + 1) / 11) * 100}%`,
          width: 0.5,
          height: i % 5 === 0 ? 6 : 3,
          background: i % 5 === 0 ? cS : c,
          pointerEvents: "none", zIndex: 2,
        }} />
      ))}
      {/* Left edge */}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={`l${i}`} style={{
          position: "absolute", left: 0,
          top: `${((i + 1) / 7) * 100}%`,
          width: i % 3 === 0 ? 6 : 3,
          height: 0.5,
          background: i % 3 === 0 ? cS : c,
          pointerEvents: "none", zIndex: 2,
        }} />
      ))}
    </>
  );
}

// ─── Category Decorations ───────────────────────────────────────────────────

/** Transform — neural network mini-visualization */
function NeuralViz({ color, isRunning }: { color: string; isRunning: boolean }) {
  const c = `rgba(${hexToRgb(color)}, 0.3)`;
  const c2 = `rgba(${hexToRgb(color)}, 0.15)`;
  const dur = isRunning ? "1.5s" : "4s";
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" style={{ opacity: 0.7, flexShrink: 0 }}>
      <line x1="11" y1="11" x2="4" y2="4" stroke={c2} strokeWidth="0.5" />
      <line x1="11" y1="11" x2="18" y2="5" stroke={c2} strokeWidth="0.5" />
      <line x1="11" y1="11" x2="5" y2="17" stroke={c2} strokeWidth="0.5" />
      <line x1="11" y1="11" x2="17" y2="18" stroke={c2} strokeWidth="0.5" />
      <circle cx="11" cy="11" r="2" fill={c} />
      <circle cx="4" cy="4" r="1.5" fill={c2}>
        <animate attributeName="r" values="1.2;2;1.2" dur={dur} repeatCount="indefinite" />
      </circle>
      <circle cx="18" cy="5" r="1.5" fill={c2}>
        <animate attributeName="r" values="1.2;2;1.2" dur={dur} begin="0.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="5" cy="17" r="1.5" fill={c2}>
        <animate attributeName="r" values="1.2;2;1.2" dur={dur} begin="1s" repeatCount="indefinite" />
      </circle>
      <circle cx="17" cy="18" r="1.5" fill={c2}>
        <animate attributeName="r" values="1.2;2;1.2" dur={dur} begin="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="11" cy="11" r="6" fill="none" stroke={c2} strokeWidth="0.4" strokeDasharray="2 2" />
    </svg>
  );
}

/** Generate — wireframe building section drawing */
function BuildingSection({ color }: { color: string }) {
  const c = `rgba(${hexToRgb(color)}, 0.3)`;
  const c2 = `rgba(${hexToRgb(color)}, 0.18)`;
  return (
    <svg width="22" height="26" viewBox="0 0 22 26"
      style={{ opacity: 0.7, flexShrink: 0, animation: "float 6s ease-in-out infinite" }}>
      <rect x="3" y="5" width="16" height="19" fill="none" stroke={c} strokeWidth="0.6" />
      <line x1="1" y1="5" x2="21" y2="5" stroke={c} strokeWidth="0.8" />
      <line x1="3" y1="12" x2="19" y2="12" stroke={c2} strokeWidth="0.4" strokeDasharray="2 1" />
      <line x1="3" y1="18" x2="19" y2="18" stroke={c2} strokeWidth="0.4" strokeDasharray="2 1" />
      <rect x="5" y="7" width="3" height="3" fill="none" stroke={c2} strokeWidth="0.4" />
      <rect x="14" y="7" width="3" height="3" fill="none" stroke={c2} strokeWidth="0.4" />
      <rect x="5" y="13.5" width="3" height="3" fill="none" stroke={c2} strokeWidth="0.4" />
      <rect x="14" y="13.5" width="3" height="3" fill="none" stroke={c2} strokeWidth="0.4" />
      <rect x="9" y="20" width="4" height="4" fill="none" stroke={c2} strokeWidth="0.4" />
      <line x1="0" y1="14" x2="22" y2="14" stroke={c} strokeWidth="0.3" strokeDasharray="4 2 1 2" />
    </svg>
  );
}

/** Export — document with corner fold */
function DocumentFold({ color }: { color: string }) {
  const c = `rgba(${hexToRgb(color)}, 0.35)`;
  const c2 = `rgba(${hexToRgb(color)}, 0.15)`;
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" style={{ opacity: 0.7, flexShrink: 0 }}>
      <path d="M2 1 L12 1 L16 5 L16 21 L2 21 Z" fill="none" stroke={c} strokeWidth="0.6" />
      <path d="M12 1 L12 5 L16 5" fill="none" stroke={c} strokeWidth="0.6" />
      <line x1="4" y1="8" x2="14" y2="8" stroke={c2} strokeWidth="0.5" />
      <line x1="4" y1="10.5" x2="12" y2="10.5" stroke={c2} strokeWidth="0.5" />
      <line x1="4" y1="13" x2="13" y2="13" stroke={c2} strokeWidth="0.5" />
      <line x1="4" y1="15.5" x2="9" y2="15.5" stroke={c2} strokeWidth="0.5" />
      <circle cx="12" cy="17.5" r="2" fill="none" stroke={c} strokeWidth="0.5" />
    </svg>
  );
}

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
        width:  hovered ? 12 : 9,
        height: hovered ? 12 : 9,
        background: hovered ? color : "#070809",
        border: `1.5px solid ${hovered ? color : `rgba(${rgb}, 0.4)`}`,
        borderRadius: "50%",
        boxShadow: hovered
          ? `0 0 12px rgba(${rgb}, 0.6), 0 0 4px rgba(${rgb}, 0.3)`
          : `0 0 6px rgba(${rgb}, 0.1)`,
        transition: "all 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        cursor: "crosshair",
        zIndex: 10,
      }}
    />
  );
}

// ─── ProgressBar (absolute bottom, 2px) ─────────────────────────────────────

function ProgressBar({ status, color }: { status: NodeStatus; color: string }) {
  const rgb = hexToRgb(color);

  return (
    <div
      style={{
        position: "absolute",
        left: 0, right: 0, bottom: 0,
        height: 1,
        background: "rgba(255,255,255,0.03)",
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
        overflow: "hidden",
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
            borderRadius: "inherit",
            background: status === "success" ? "#10B981" : "#EF4444",
          }}
        />
      )}
      {status === "running" && (
        <div
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: "50%",
            borderRadius: "inherit",
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
        borderTop: "1px solid rgba(184,115,51,0.1)",
        marginTop: 8,
      }}>
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            style={{
              fontSize: 10.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
              fontFamily: "'Space Mono', monospace",
              fontStyle: "italic",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {line || "\u00A0"}
          </motion.div>
        ))}
        {text.split("\n").length > 4 && (
          <div style={{ fontSize: 9, color: "#00F5FF", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>+{text.split("\n").length - 4} more lines</div>
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
        borderTop: "1px solid rgba(184,115,51,0.1)",
        marginTop: 8,
      }}>
        {metrics.slice(0, 4).map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            style={{
              background: "rgba(184,115,51,0.08)",
              border: "1px solid rgba(184,115,51,0.15)",
              borderRadius: 2, padding: "6px 10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#FFBF00", lineHeight: 1.1, fontFamily: "'Space Mono', monospace" }}>
              {m.value}
              {m.unit && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginLeft: 2 }}>{m.unit}</span>}
            </div>
            <div style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.1em", fontFamily: "'Space Mono', monospace" }}>
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
  const [showResult] = useState(true);

  const category = data.category as NodeCategory;
  const status   = data.status   as NodeStatus;
  const color    = CATEGORY_COLOR[category];
  const rgb      = hexToRgb(color);
  const isInput  = INPUT_NODE_IDS.has(data.catalogueId);

  const artifact = useExecutionStore(s => s.artifacts.get(id));

  const inLabel  = data.inputs .map(p => p.label).join(", ");
  const outLabel = data.outputs.map(p => p.label).join(", ");
  const typeLabel =
    inLabel && outLabel ? `${inLabel} \u2192 ${outLabel}` :
    outLabel            ? `\u2192 ${outLabel}` :
    inLabel             ? `${inLabel} \u2192` :
    null;

  const errorMessage = (data as WorkflowNodeData & { errorMessage?: string })?.errorMessage;

  // Dynamic styling
  const accentOpacity = selected ? 0.7 : isHovered ? 0.45 : 0.2;

  const outerBorderColor =
    status === "error"   ? "rgba(248,113,113,0.5)" :
    status === "success" ? "rgba(52,211,153,0.5)" :
    status === "running" ? `rgba(${rgb}, 0.7)` :
    selected ? `rgba(${rgb}, 0.45)` :
    isHovered ? `rgba(${rgb}, 0.3)` :
    `rgba(${rgb}, 0.12)`;

  const stateGlow =
    status === "success" ? `0 0 30px rgba(52, 211, 153, 0.35)` :
    status === "error"   ? `0 0 30px rgba(248, 113, 113, 0.35)` :
    "";

  const generateDepth = category === "generate" ? "inset 0 3px 12px rgba(0,0,0,0.2)" : "";

  return (
    <>
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, scale: 0.88, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: prefersReduced ? 0 : 0.22, ease: [0.4, 0, 0.2, 1] }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={status === "running" ? "node-running" : undefined}
        style={{
          ["--cat-color" as string]: color,
          ["--cat-rgb" as string]: rgb,
          width: isInput ? 320 : 220,
          background: "rgba(10, 12, 14, 0.75)",
          border: `1px solid ${outerBorderColor}`,
          borderRadius: 4,
          boxShadow: [
            isHovered
              ? `0 16px 48px rgba(0,0,0,0.65), 0 0 40px rgba(${rgb}, 0.1)`
              : `0 4px 24px rgba(0,0,0,0.5)`,
            stateGlow,
          ].filter(Boolean).join(", "),
          backdropFilter: "blur(40px) saturate(1.3)",
          WebkitBackdropFilter: "blur(40px) saturate(1.3)",
          transform: isHovered && !selected
            ? "translateY(-3px)"
            : "translateY(0)",
          transition: "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
          animation: status === "idle" && !isHovered && !selected
            ? "atelier-float-1 22s ease-in-out infinite"
            : "none",
          overflow: "visible",
          cursor: "pointer",
          position: "relative",
        }}
      >
        {/* ── Category-specific background pattern ── */}
        <div style={{
          position: "absolute", inset: 0,
          borderRadius: 4, overflow: "hidden",
          pointerEvents: "none", zIndex: 0,
          ...CATEGORY_BG[category],
        }} />

        {/* ── Top inner glow (category-tinted light from above) ── */}
        <div style={{
          position: "absolute",
          top: 0, left: 0, right: 0, height: 40,
          borderRadius: "4px 4px 0 0",
          background: `linear-gradient(180deg, rgba(${rgb}, 0.05) 0%, transparent 100%)`,
          pointerEvents: "none", zIndex: 0,
        }} />

        {/* ── Scanning line (Atelier) ── */}
        <div style={{
          position: "absolute", left: 0, width: "100%", height: "1px",
          background: `linear-gradient(90deg, transparent, rgba(${rgb}, 0.4), transparent)`,
          animation: status === "running" ? "atelier-scan 1s linear infinite" : "atelier-scan 4s linear infinite",
          opacity: 0.3, pointerEvents: "none", zIndex: 3,
        }} />

        {/* ── Glow behind node (Atelier) ── */}
        <div style={{
          position: "absolute", inset: "-30px",
          background: `radial-gradient(ellipse, rgba(${rgb}, 0.06) 0%, transparent 70%)`,
          filter: "blur(20px)", pointerEvents: "none", zIndex: -1,
          animation: "atelier-pulse 6s ease-in-out infinite",
        }} />

        {/* ── Generate node — recessed depth effect via inner shadow overlay ── */}
        {category === "generate" && (
          <div style={{
            position: "absolute", inset: 0,
            borderRadius: 4,
            boxShadow: "inset 0 3px 12px rgba(0,0,0,0.25), inset 0 -1px 4px rgba(0,0,0,0.1)",
            pointerEvents: "none", zIndex: 0,
          }} />
        )}

        {/* ── Export node — stamp/certificate dashed inner border ── */}
        {category === "export" && (
          <div style={{
            position: "absolute",
            inset: 5,
            borderRadius: 2,
            border: `1px dashed rgba(${rgb}, 0.08)`,
            pointerEvents: "none", zIndex: 0,
          }} />
        )}

        {/* ── Top glow line (full width, 1px — architectural precision) ── */}
        <div style={{
          position: "absolute",
          top: -1, left: 0, right: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent 5%, rgba(${rgb}, 0.4) 30%, rgba(${rgb}, 0.6) 50%, rgba(${rgb}, 0.4) 70%, transparent 95%)`,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          pointerEvents: "none",
        }} />

        {/* ── Corner accents (drafting reticle) ── */}
        <CornerAccents color={color} opacity={accentOpacity} />

        {/* ── Tick marks — scale ruler (input nodes only) ── */}
        {isInput && <TickMarks color={color} />}

        {/* ── Left accent bar — glowing line that fades at top/bottom (Atelier) ── */}
        <div style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: 2,
          background: `linear-gradient(180deg, rgba(${rgb}, 0) 0%, ${color} 30%, ${color} 70%, rgba(${rgb}, 0) 100%)`,
          animation: "accent-pulse 3s ease-in-out infinite",
          zIndex: 1,
        }} />
        <div style={{
          position: "absolute",
          left: -3, top: 0, bottom: 0,
          width: 8,
          background: `radial-gradient(ellipse at left, rgba(${rgb}, 0.12) 0%, transparent 80%)`,
          pointerEvents: "none",
          filter: "blur(4px)",
        }} />

        {/* ── Running state — ring pulse ── */}
        {status === "running" && (
          <>
            <div
              className="node-ring-pulse"
              style={{
                position: "absolute",
                inset: -4,
                borderRadius: 8,
                border: `2px solid rgba(${rgb}, 0.3)`,
                pointerEvents: "none",
              }}
            />
            <motion.div
              style={{
                position: "absolute", inset: 0,
                borderRadius: 4, pointerEvents: "none",
              }}
              animate={{
                boxShadow: [
                  `inset 0 0 0 1px rgba(${rgb}, 0.2), 0 0 20px rgba(${rgb}, 0.08)`,
                  `inset 0 0 0 1px rgba(${rgb}, 0.6), 0 0 35px rgba(${rgb}, 0.18)`,
                  `inset 0 0 0 1px rgba(${rgb}, 0.2), 0 0 20px rgba(${rgb}, 0.08)`,
                ],
              }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        )}

        {/* ── Success glow flash ── */}
        {status === "success" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{
              position: "absolute", inset: -2,
              borderRadius: 4, pointerEvents: "none",
              background: "radial-gradient(circle, rgba(52, 211, 153, 0.3) 0%, transparent 70%)",
            }}
          />
        )}

        {/* ── Error glow pulse ── */}
        {status === "error" && (
          <motion.div
            animate={{ opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            style={{
              position: "absolute", inset: -2,
              borderRadius: 4, pointerEvents: "none",
              background: "radial-gradient(circle, rgba(248, 113, 113, 0.25) 0%, transparent 70%)",
            }}
          />
        )}

        {/* ── Content ── */}
        <div style={{ padding: "16px 18px 14px 18px", position: "relative", zIndex: 1 }}>

          {/* Row 1: Icon + name + status + INPUT badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            {/* Simple icon — no container, Atelier style */}
            <div style={{
              color,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              filter: `drop-shadow(0 0 6px rgba(${rgb}, 0.3))`,
              animation: category === "transform" ? "spin-slow 8s linear infinite" : "none",
            }}>
              {getIcon(data.icon, 16)}
            </div>

            {/* Node name — Playfair Display italic (Atelier) */}
            <span style={{
              fontSize: 15,
              fontWeight: 400,
              fontStyle: "italic",
              color,
              letterSpacing: "0.05em",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
              fontFamily: "'Playfair Display', serif",
            }}>
              {data.label}
            </span>

            {/* INPUT badge — Atelier style */}
            {isInput && (
              <span style={{
                fontSize: 7,
                fontWeight: 400,
                color,
                padding: "3px 8px",
                background: `rgba(${rgb}, 0.15)`,
                border: `1px solid rgba(${rgb}, 0.25)`,
                letterSpacing: "0.15em",
                textTransform: "uppercase" as const,
                fontFamily: "'Space Mono', monospace",
                flexShrink: 0,
              }}>
                {t('execution.inputLabel')}
              </span>
            )}

            {/* Status indicator */}
            <AnimatePresence mode="wait">
              {status === "idle" && (
                <div key="idle" style={{
                  width: 8, height: 8,
                  borderRadius: "50%",
                  border: `1.5px solid rgba(${rgb}, 0.3)`,
                  flexShrink: 0,
                }} />
              )}
              {status === "success" && (
                <motion.div key="s"
                  initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  style={{
                    color: "#10B981", flexShrink: 0,
                    filter: "drop-shadow(0 0 6px rgba(16, 185, 129, 0.5))",
                  }}>
                  <CheckCircle2 size={13} />
                </motion.div>
              )}
              {status === "error" && (
                <motion.div key="e"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1, x: [0, -2, 2, -1, 1, 0] }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  style={{
                    color: "#EF4444", flexShrink: 0,
                    filter: "drop-shadow(0 0 6px rgba(239, 68, 68, 0.5))",
                  }}>
                  <AlertCircle size={13} />
                </motion.div>
              )}
              {status === "running" && (
                <motion.div key="r"
                  style={{
                    width: 8, height: 8,
                    borderRadius: "50%",
                    background: color,
                    flexShrink: 0,
                    boxShadow: `0 0 8px rgba(${rgb}, 0.6)`,
                  }}
                  animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Row 2: Subtitle — Space Mono, tiny, uppercase (Atelier) */}
          {typeLabel && (
            <div style={{
              fontSize: 8,
              color: `rgba(${rgb}, 0.5)`,
              marginTop: 4,
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textTransform: "uppercase" as const,
              letterSpacing: "0.1em",
              fontFamily: "'Space Mono', monospace",
            }}>
              {typeLabel}
            </div>
          )}

          {/* Row 2b: interactive input for all 7 input node types */}
          {isInput && <InputNodeContent nodeId={id} data={data} />}

          {/* Row 2c: viewType select for GN-003 */}
          {data.catalogueId === "GN-003" && <ViewTypeSelect nodeId={id} data={data} />}

          {/* Row 3: Category decoration + time estimate pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
            {/* Category-specific mini visualization */}
            {category === "transform" && <NeuralViz color={color} isRunning={status === "running"} />}
            {category === "generate" && <BuildingSection color={color} />}
            {category === "export" && <DocumentFold color={color} />}
            <div style={{ flex: 1 }} />
            {/* Time pill — Atelier */}
            <span style={{
              fontSize: 8,
              color: "rgba(255,255,255,0.3)",
              whiteSpace: "nowrap",
              flexShrink: 0,
              fontWeight: 400,
              padding: "2px 8px",
              borderRadius: 2,
              background: "rgba(0,0,0,0.3)",
              border: `1px solid rgba(${rgb}, 0.1)`,
              letterSpacing: "0.05em",
              fontFamily: "'Space Mono', monospace",
              textTransform: "uppercase" as const,
            }}>
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

        {/* ── Progress bar at very bottom ── */}
        <ProgressBar status={status} color={color} />

        {/* ── Handles ── */}
        {data.inputs.map((port, i) => (
          <NodeHandle key={port.id} port={port} handleType="target"
            position={Position.Left} topPct={portPercent(i, data.inputs.length)} color={color} />
        ))}
        {data.outputs.map((port, i) => (
          <NodeHandle key={port.id} port={port} handleType="source"
            position={Position.Right} topPct={portPercent(i, data.outputs.length)} color={color} />
        ))}
      </motion.div>

      {/* ── Error message tooltip ── */}
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
              borderRadius: 4,
              background: "rgba(10, 8, 8, 0.95)",
              border: "1px solid rgba(248, 113, 113, 0.4)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(40px)",
              WebkitBackdropFilter: "blur(40px)",
              maxWidth: 280,
              zIndex: 1000,
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertCircle size={14} style={{ color: "#F87171", flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#F87171", marginBottom: 3, fontFamily: "var(--font-space-grotesk, inherit)" }}>
                  {t('execution.executionError')}
                </div>
                <div style={{ fontSize: 10, color: "#E0B4B4", lineHeight: 1.5 }}>
                  {errorMessage}
                </div>
              </div>
            </div>
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
