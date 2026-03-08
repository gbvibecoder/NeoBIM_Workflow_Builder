"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Terminal, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

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
}

const TYPE_COLOR: Record<LogEntry["type"], string> = {
  start:   "#00F5FF",
  running: "#FFBF00",
  success: "#10B981",
  error:   "#EF4444",
  info:    "#5C5C78",
};

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

export function ExecutionLog({ entries, isRunning, onClose }: ExecutionLogProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, expanded]);

  if (entries.length === 0 && !isRunning) return null;

  const statusColor = isRunning
    ? "#FFBF00"
    : entries[entries.length - 1]?.type === "error"
      ? "#EF4444"
      : "#10B981";

  const latestEntry = entries[entries.length - 1];

  return (
    <motion.div
      initial={{ y: 20, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 20, opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 25,
        borderRadius: expanded ? 4 : 4,
        overflow: "hidden",
        background: "rgba(5, 5, 8, 0.92)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(24px) saturate(1.3)",
        WebkitBackdropFilter: "blur(24px) saturate(1.3)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03) inset",
        fontFamily: "'JetBrains Mono', 'Fira Mono', 'Menlo', monospace",
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
          borderBottom: expanded ? "1px solid rgba(255,255,255,0.06)" : "none",
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
            color: "#5C5C78",
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
            <Terminal size={11} style={{ color: "#5C5C78", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#5C5C78", fontWeight: 500, flex: 1 }}>
              {isRunning ? t('execution.executing') : t('execution.log')}
            </span>
          </>
        )}
        <span
          style={{
            fontSize: 9,
            color: "#3A3A50",
            fontWeight: 500,
            padding: "1px 6px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          {entries.length}
        </span>
        <motion.div
          animate={{ rotate: expanded ? 0 : -90 }}
          transition={{ duration: 0.15 }}
          style={{ color: "#3A3A50", display: "flex", flexShrink: 0 }}
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
              color: "#3A3A50",
              padding: 2,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#3A3A50"; }}
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
                  <span style={{ color: "#2a2a3a", flexShrink: 0, fontWeight: 500 }}>
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
                        entry.type === "error" ? "#F87171" :
                        entry.type === "success" ? "#34D399" :
                        "#5C5C78",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.message}
                    {entry.detail && (
                      <span style={{ color: "#5C5C78", marginLeft: 6 }}>
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
  );
}
