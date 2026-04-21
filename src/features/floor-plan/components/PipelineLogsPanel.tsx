/**
 * Phase 2.6 — Pipeline Logs Panel.
 *
 * Renders the live stage-by-stage log for a VIP generation. The panel
 * consumes stageLog entries from useVipGeneration (polled every 3s).
 * Visible any time the VIP hook is non-idle.
 *
 * Design goals (Rutik's brief):
 *   - Stage name + status icon + duration + cost always visible
 *   - One-line summary of each stage for at-a-glance scanning
 *   - Click a row to expand and see the raw output JSON
 *   - "Copy All Logs" + "Download Logs" for sharing
 *   - Total cost + duration always visible in the footer
 *   - Empty state before the worker writes anything
 *   - Doesn't block the editor — fixed bottom-right, collapsible
 */

"use client";

import React, { useMemo, useState, useCallback } from "react";
import type { StageLogEntry } from "@/features/floor-plan/lib/vip-pipeline/types";

export interface PipelineLogsPanelProps {
  stageLog: StageLogEntry[];
  /**
   * Hint for the footer when the pipeline is still running. When true,
   * status icons for stages that haven't started yet show as "pending"
   * (hollow circle) instead of being missing from the list.
   */
  expectedStages?: number;
  /**
   * Optional: current pipeline status from useVipGeneration. Influences
   * the empty-state copy and the footer banner.
   */
  pipelineStatus?:
    | "idle"
    | "creating"
    | "polling"
    | "awaiting-approval"
    | "completed"
    | "failed";
}

const DEFAULT_EXPECTED_STAGES = 7; // Stages 1–7 (parse = bonus stage 0)

export function PipelineLogsPanel({
  stageLog,
  expectedStages = DEFAULT_EXPECTED_STAGES,
  pipelineStatus,
}: PipelineLogsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [openRows, setOpenRows] = useState<Record<number, boolean>>({});

  const toggleRow = useCallback((idx: number) => {
    setOpenRows((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const totals = useMemo(() => {
    let totalMs = 0;
    let totalCost = 0;
    let successCount = 0;
    let failed = false;
    for (const e of stageLog) {
      if (typeof e.durationMs === "number") totalMs += e.durationMs;
      if (typeof e.costUsd === "number") totalCost += e.costUsd;
      if (e.status === "success") successCount += 1;
      if (e.status === "failed") failed = true;
    }
    return { totalMs, totalCost, successCount, failed };
  }, [stageLog]);

  const progressLabel = `${totals.successCount}/${expectedStages}`;
  const durationLabel = fmtDuration(totals.totalMs);
  const costLabel = `$${totals.totalCost.toFixed(3)}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(stageLog, null, 2));
    } catch {
      // Fallback: create a temp textarea + execCommand("copy"). Ignored
      // silently — clipboard failures aren't catastrophic for the user.
    }
  }, [stageLog]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(stageLog, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pipeline-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, [stageLog]);

  // Build list: actual entries + placeholder slots for stages that haven't started yet
  const rows = useMemo(() => {
    // Skip stage 0 (parse) in the expected-stages count for UX clarity.
    const seenStages = new Set(stageLog.map((e) => e.stage));
    const placeholders: StageLogEntry[] = [];
    for (let s = 1; s <= expectedStages; s++) {
      if (!seenStages.has(s)) {
        placeholders.push({
          stage: s,
          name: STAGE_LABEL_HINTS[s] ?? `Stage ${s}`,
          status: pipelineStatus === "completed" || pipelineStatus === "failed" ? "skipped" : "running",
          startedAt: "",
        });
      }
    }
    // For placeholders generated post-run, mark as skipped instead of running.
    const renderRows = [...stageLog, ...placeholders.map((p) => ({
      ...p,
      // Pending rows are visually distinct — we reuse status "running"
      // while still-active so the spinner shows; use a virtual flag below.
    }))];
    // Sort: real entries in their emission order (already correct),
    // placeholders after. Group by stage number is confusing; leave as is.
    return renderRows;
  }, [stageLog, expectedStages, pipelineStatus]);

  if (stageLog.length === 0 && (pipelineStatus === "idle" || !pipelineStatus)) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Pipeline Logs"
      data-testid="pipeline-logs-panel"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: expanded ? 380 : 260,
        maxHeight: expanded ? "70vh" : 56,
        overflow: "hidden",
        zIndex: 9998,
        borderRadius: 14,
        background: "linear-gradient(180deg, #0E0E1C 0%, #060610 100%)",
        border: "1px solid rgba(79,138,255,0.18)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(79,138,255,0.08)",
        color: "#E6E8F2",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          color: "inherit",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          width: "100%",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, letterSpacing: "-0.01em" }}>
          <span aria-hidden="true" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▸</span>
          Pipeline Logs
        </span>
        <span style={{ display: "flex", gap: 8, color: "#9EA2B8", fontVariantNumeric: "tabular-nums" }}>
          <span>{progressLabel}</span>
          <span>·</span>
          <span>{costLabel}</span>
          <span>·</span>
          <span>{durationLabel}</span>
        </span>
      </button>

      {expanded && (
        <>
          <div
            data-testid="pipeline-logs-list"
            style={{
              overflow: "auto",
              flex: 1,
              borderTop: "1px solid rgba(255,255,255,0.05)",
              padding: "6px 0",
            }}
          >
            {rows.map((entry, idx) => (
              <LogRow
                key={`${entry.stage}-${idx}-${entry.startedAt}`}
                entry={entry}
                open={!!openRows[idx]}
                onToggle={() => toggleRow(idx)}
                isPlaceholder={!entry.startedAt}
              />
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "10px 12px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <button
              onClick={handleCopy}
              aria-label="Copy all logs to clipboard"
              style={footerButtonStyle}
            >
              Copy All Logs
            </button>
            <button
              onClick={handleDownload}
              aria-label="Download logs as JSON"
              style={footerButtonStyle}
            >
              Download
            </button>
          </div>

          {totals.failed && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                borderTop: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.08)",
                color: "#FCA5A5",
                fontSize: 11,
              }}
            >
              One or more stages failed — see details above.
            </div>
          )}
        </>
      )}
    </div>
  );
}

const footerButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "7px 10px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#D5D7E5",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const STAGE_LABEL_HINTS: Record<number, string> = {
  1: "Prompt Intelligence",
  2: "Parallel Image Gen",
  3: "Vision Jury",
  4: "Room Extraction",
  5: "Synthesis",
  6: "Quality Gate",
  7: "Delivery",
};

function LogRow({
  entry,
  open,
  onToggle,
  isPlaceholder,
}: {
  entry: StageLogEntry;
  open: boolean;
  onToggle: () => void;
  isPlaceholder: boolean;
}) {
  const icon = statusIcon(entry.status, isPlaceholder);
  const duration = typeof entry.durationMs === "number" ? fmtDuration(entry.durationMs) : "—";
  const cost = typeof entry.costUsd === "number" ? `$${entry.costUsd.toFixed(3)}` : "";
  const stageLabel = entry.stage === 0 ? "Pre-pipeline" : `Stage ${entry.stage}`;

  return (
    <div
      data-testid="pipeline-logs-row"
      data-stage={entry.stage}
      data-status={entry.status}
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.035)",
        cursor: entry.output || entry.error ? "pointer" : "default",
        opacity: isPlaceholder ? 0.45 : 1,
      }}
      onClick={() => {
        if (entry.output || entry.error) onToggle();
      }}
      role={entry.output || entry.error ? "button" : undefined}
      aria-expanded={entry.output || entry.error ? open : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 16, textAlign: "center" }} aria-hidden="true">{icon}</span>
        <span style={{ flex: 1, fontWeight: 600, color: "#DDE0EE" }}>
          <span style={{ color: "#8F93A8", fontSize: 10, textTransform: "uppercase", letterSpacing: "1px", marginRight: 6 }}>
            {stageLabel}
          </span>
          {entry.name}
        </span>
        <span style={{ color: "#9EA2B8", fontVariantNumeric: "tabular-nums" }}>{duration}</span>
        {cost && <span style={{ color: "#4F8AFF", fontVariantNumeric: "tabular-nums", marginLeft: 6 }}>{cost}</span>}
      </div>
      {entry.summary && !isPlaceholder && (
        <div style={{ marginTop: 3, marginLeft: 24, color: "#7A8099", fontSize: 11 }}>
          {entry.summary}
        </div>
      )}
      {entry.error && !isPlaceholder && (
        <div style={{ marginTop: 4, marginLeft: 24, color: "#FCA5A5", fontSize: 11 }}>
          {entry.error}
        </div>
      )}
      {open && entry.output && (
        <pre
          data-testid="pipeline-logs-row-output"
          style={{
            marginTop: 6,
            marginLeft: 24,
            padding: 8,
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
            color: "#B2B6C8",
            fontSize: 10.5,
            maxHeight: 160,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(entry.output, null, 2)}
        </pre>
      )}
    </div>
  );
}

function statusIcon(status: StageLogEntry["status"], isPlaceholder: boolean): string {
  if (isPlaceholder) return "◯";
  switch (status) {
    case "success":
      return "✓";
    case "failed":
      return "✗";
    case "skipped":
      return "–";
    case "running":
    default:
      return "⏳";
  }
}

function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}
