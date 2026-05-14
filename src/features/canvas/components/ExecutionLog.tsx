"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Terminal, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

export interface LogEntry {
  timestamp: Date;
  type: "start" | "running" | "success" | "error" | "info";
  message: string;
  detail?: string;
}

interface ExecutionLogProps {
  entries: LogEntry[];
  isRunning: boolean;
  onClose: () => void;
  /** When true, force the log body open (used to auto-expand on execution start) */
  autoExpand?: boolean;
}

function getTypeColor(tk: ReturnType<typeof useCanvasToken>): Record<LogEntry["type"], string> {
  return {
    start:   tk.accent,
    running: tk.statusWarning,
    success: tk.statusSuccess,
    error:   tk.statusError,
    info:    tk.logMuted,
  };
}

const TYPE_SYMBOL: Record<LogEntry["type"], string> = {
  start:   "\u25B6",
  running: "\u25C9",
  success: "\u2713",
  error:   "\u2717",
  info:    "\u00B7",
};

function fmt(d: Date) {
  return d.toTimeString().slice(0, 8);
}

export function ExecutionLog({ entries, isRunning, onClose, autoExpand }: ExecutionLogProps) {
  const { t } = useLocale();
  const canvasTheme = useCanvasTheme((s) => s.theme);
  const tk = useCanvasToken();
  const TYPE_COLOR = getTypeColor(tk);
  // Initialize expanded from autoExpand so it's open on first mount during execution
  const [expanded, setExpanded] = useState(!!autoExpand);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-expand whenever autoExpand flips to true (covers re-runs)
  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  // Auto-collapse when execution finishes (isRunning goes true → false)
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      setExpanded(false);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, expanded]);

  if (entries.length === 0 && !isRunning) return null;

  const statusColor = isRunning
    ? tk.statusWarning
    : entries[entries.length - 1]?.type === "error"
      ? tk.statusError
      : tk.statusSuccess;

  const latestEntry = entries[entries.length - 1];

  return (
    <div className={`canvas-theme-${canvasTheme}`} style={{ display: "contents" }}>
    <motion.div
      className="execution-log-container"
      initial={{ y: 20, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 20, opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 25,
        borderRadius: 4,
        overflow: "hidden",
        background: tk.notebookBg,
        border: `1px solid ${tk.panelBorder}`,
        backdropFilter: "blur(24px) saturate(1.3)",
        WebkitBackdropFilter: "blur(24px) saturate(1.3)",
        boxShadow: tk.panelShadow,
        fontFamily: "var(--font-jetbrains), monospace",
        transition: "border-radius 0.2s ease",
      }}
    >
      {/* Pill header — always visible */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: expanded ? "9px 12px" : "7px 14px",
          borderBottom: expanded ? `1px solid ${tk.panelBorder}` : "none",
          cursor: "pointer",
          userSelect: "none",
          minWidth: expanded ? 380 : 0,
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}60`,
            flexShrink: 0,
            animation: isRunning ? "logDotPulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        {!expanded && latestEntry && (
          <span style={{
            fontSize: 11,
            color: tk.logMuted,
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {latestEntry.message}
          </span>
        )}
        {expanded && (
          <>
            <Terminal size={11} style={{ color: tk.logMuted, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: tk.logMuted, fontWeight: 500, flex: 1 }}>
              {isRunning ? t('execution.executing') : "Field Notes"}
            </span>
          </>
        )}
        <span
          style={{
            fontSize: 9,
            color: tk.logBadgeText,
            fontWeight: 500,
            padding: "1px 6px",
            borderRadius: 8,
            background: tk.logBadgeBg,
          }}
        >
          {entries.length}
        </span>
        <motion.div
          animate={{ rotate: expanded ? 0 : -90 }}
          transition={{ duration: 0.15 }}
          style={{ color: tk.logBadgeText, display: "flex", flexShrink: 0 }}
        >
          <ChevronDown size={11} />
        </motion.div>
        {!isRunning && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={t('execution.closeLog')}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: tk.logBadgeText,
              padding: 2,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = tk.statusError; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = tk.logBadgeText; }}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Expanded log body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                maxHeight: 160,
                overflowY: "auto",
                padding: "6px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {entries.map((entry, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.15,
                    delay: Math.min(i * 0.015, 0.3),
                  }}
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: 10,
                    lineHeight: 1.6,
                    padding: "1px 0",
                  }}
                >
                  <span style={{ color: tk.logTimestamp, flexShrink: 0, fontWeight: 500 }}>
                    {fmt(entry.timestamp)}
                  </span>
                  <span
                    style={{
                      color: TYPE_COLOR[entry.type],
                      flexShrink: 0,
                      fontWeight: 600,
                      width: 10,
                      textAlign: "center",
                    }}
                  >
                    {TYPE_SYMBOL[entry.type]}
                  </span>
                  <span
                    style={{
                      color:
                        entry.type === "error" ? tk.logMsgError :
                        entry.type === "success" ? tk.logMsgSuccess :
                        tk.logMuted,
                      flex: 1,
                      overflow: "hidden",
                      // Wrap long smart-summary lines (e.g. "TR-008: 155 line items
                      // mapped — ₹3.20 Cr (₹64,000/m²)") instead of truncating them.
                      // Capped to two lines so the panel stays compact.
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 2,
                      wordBreak: "break-word",
                    }}
                  >
                    {entry.message}
                    {entry.detail && (
                      <span style={{ color: tk.logMuted, marginLeft: 6 }}>
                        {entry.detail}
                      </span>
                    )}
                  </span>
                </motion.div>
              ))}
              <div ref={bottomRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes logDotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </motion.div>
    </div>
  );
}
