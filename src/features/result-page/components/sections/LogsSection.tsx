"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Copy, Download, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import { ScrollReveal } from "@/features/result-page/components/ScrollReveal";
import { SectionHeader } from "@/features/result-page/components/sections/SectionHeader";
import type { NodeTrace, LogEntry } from "@/lib/execution-diagnostics";

interface LogsSectionProps {
  index: number;
}

export function isLogsSectionEligible(): boolean {
  const trace = useExecutionStore.getState().currentTrace;
  return !!(trace && trace.nodes.length > 0);
}

const MONO = "var(--font-jetbrains), ui-monospace, monospace";

const LEVEL_COLOR: Record<string, string> = {
  debug: "#94A3B8",
  info: "#3B82F6",
  warn: "#D97706",
  error: "#EF4444",
  success: "#10B981",
};

const STATUS_ICON: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  success: { icon: CheckCircle2, color: "#10B981" },
  error: { icon: XCircle, color: "#EF4444" },
  warning: { icon: CheckCircle2, color: "#D97706" },
  running: { icon: Clock, color: "#3B82F6" },
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function formatTimestamp(ts: number, base: number): string {
  const delta = Math.max(0, ts - base);
  const s = Math.floor(delta / 1000) % 60;
  const m = Math.floor(delta / 60_000);
  const ms = delta % 1000;
  return `+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function LogsSection({ index }: LogsSectionProps) {
  const trace = useExecutionStore(s => s.currentTrace);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    if (!trace) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      toast.success("Logs copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }, [trace]);

  const handleDownload = useCallback(() => {
    if (!trace) return;
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-${trace.executionId}-logs.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [trace]);

  if (!trace || trace.nodes.length === 0) return null;

  const baseTs = new Date(trace.startedAt).getTime();
  const errors = trace.nodes.filter(n => n.status === "error").length;
  const succeeded = trace.nodes.filter(n => n.status === "success").length;

  return (
    <ScrollReveal>
      <section style={{ padding: "0 clamp(12px, 3vw, 24px)" }}>
        <SectionHeader
          index={index}
          icon={<Terminal size={16} />}
          label="Logs"
          title="Behind the scenes"
          subtitle={`${trace.nodes.length} nodes · ${succeeded} succeeded${errors > 0 ? ` · ${errors} failed` : ""} · ${formatMs(trace.totalDurationMs ?? 0)} total`}
          iconColor="#475569"
          iconBg="#F1F5F9"
          right={
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleCopy}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 10,
                  background: "#FFFFFF",
                  border: "1px solid rgba(0,0,0,0.08)",
                  color: "#475569",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Copy size={13} /> Copy
              </button>
              <button
                onClick={handleDownload}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 10,
                  background: "#0F172A",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Download size={13} /> Download JSON
              </button>
            </div>
          }
        />

        <div
          style={{
            background: "#0F172A",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            overflow: "hidden",
          }}
        >
          {/* Header bar */}
          <div
            style={{
              padding: "12px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontFamily: MONO,
              fontSize: 11,
              color: "#94A3B8",
            }}
          >
            <span>EXECUTION · {trace.executionId}</span>
            <span>{trace.totalDurationMs ? formatMs(trace.totalDurationMs) : ""}</span>
          </div>

          {/* Node entries */}
          {trace.nodes.map((node, i) => (
            <NodeLogEntry
              key={node.nodeId}
              node={node}
              baseTs={baseTs}
              isLast={i === trace.nodes.length - 1}
              isExpanded={expandedNodes.has(node.nodeId)}
              onToggle={() => toggleNode(node.nodeId)}
            />
          ))}
        </div>
      </section>
    </ScrollReveal>
  );
}

function NodeLogEntry({
  node,
  baseTs,
  isLast,
  isExpanded,
  onToggle,
}: {
  node: NodeTrace;
  baseTs: number;
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusInfo = STATUS_ICON[node.status] ?? STATUS_ICON.running;
  const StatusIcon = statusInfo.icon;

  return (
    <div
      style={{
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Node header (clickable) */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: MONO,
          fontSize: 12,
          color: "#E2E8F0",
        }}
      >
        {isExpanded ? (
          <ChevronDown size={14} color="#64748B" />
        ) : (
          <ChevronRight size={14} color="#64748B" />
        )}
        <StatusIcon size={14} color={statusInfo.color} />
        <span style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>
          {node.nodeName}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 9999,
            background: node.isMock ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.06)",
            color: node.isMock ? "#D97706" : "#94A3B8",
            fontWeight: 500,
          }}
        >
          {node.isMock ? "MOCK" : node.nodeTypeId}
        </span>
        <span style={{ color: "#64748B", fontSize: 11, flexShrink: 0 }}>
          {node.durationMs ? formatMs(node.durationMs) : "—"}
        </span>
      </button>

      {/* Expanded log entries */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.2 }}
          style={{
            padding: "0 20px 14px 52px",
            overflow: "hidden",
          }}
        >
          {/* Summary */}
          {node.summary && (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: "#94A3B8",
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              {node.summary}
            </div>
          )}

          {/* Log entries */}
          {node.log.map((entry, i) => (
            <LogLine key={i} entry={entry} baseTs={baseTs} />
          ))}

          {/* Attempts */}
          {node.attempts.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {node.attempts.map((attempt, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: attempt.status === "success" ? "#10B981" : "#EF4444",
                    display: "flex",
                    gap: 8,
                    padding: "2px 0",
                  }}
                >
                  <span style={{ color: "#64748B" }}>attempt {attempt.attemptNumber}</span>
                  <span>{attempt.action}</span>
                  <span style={{ color: "#64748B" }}>{formatMs(attempt.durationMs)}</span>
                  {attempt.detail && (
                    <span style={{ color: "#94A3B8", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {attempt.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function LogLine({ entry, baseTs }: { entry: LogEntry; baseTs: number }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 11,
        display: "flex",
        gap: 10,
        padding: "1px 0",
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: "#475569", flexShrink: 0, width: 80 }}>
        {formatTimestamp(entry.timestamp, baseTs)}
      </span>
      <span
        style={{
          color: LEVEL_COLOR[entry.level] ?? "#94A3B8",
          fontWeight: entry.level === "error" ? 600 : 400,
          flexShrink: 0,
          width: 42,
          textTransform: "uppercase",
          fontSize: 10,
        }}
      >
        {entry.level}
      </span>
      <span style={{ color: "#CBD5E1", minWidth: 0, wordBreak: "break-word" }}>
        {entry.message}
      </span>
    </div>
  );
}
