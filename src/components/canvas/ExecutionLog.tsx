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
  start:   "#4F8AFF",
  running: "#F59E0B",
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
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, collapsed]);

  if (entries.length === 0 && !isRunning) return null;

  const statusColor = isRunning
    ? "#F59E0B"
    : entries[entries.length - 1]?.type === "error"
      ? "#EF4444"
      : "#10B981";

  return (
    <motion.div
      initial={{ y: 40, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 40, opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 25,
        width: collapsed ? 220 : 420,
        maxWidth: "calc(100vw - 360px)",
        borderRadius: 12,
        overflow: "hidden",
        background: "rgba(5, 5, 8, 0.95)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px) saturate(1.3)",
        WebkitBackdropFilter: "blur(20px) saturate(1.3)",
        boxShadow:
          "0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset",
        fontFamily:
          "'JetBrains Mono', 'Fira Mono', 'Menlo', monospace",
        transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Title bar */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          borderBottom: collapsed
            ? "none"
            : "1px solid rgba(255,255,255,0.06)",
          cursor: "pointer",
          userSelect: "none",
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
            animation: isRunning
              ? "logDotPulse 1.4s ease-in-out infinite"
              : "none",
          }}
        />
        <Terminal size={11} style={{ color: "#5C5C78", flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            color: "#5C5C78",
            fontWeight: 500,
            flex: 1,
          }}
        >
          {isRunning ? t('execution.executing') : t('execution.log')}
        </span>
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
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ color: "#3A3A50", display: "flex", flexShrink: 0 }}
        >
          <ChevronDown size={12} />
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
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#EF4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#3A3A50";
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Log body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                padding: "8px 12px",
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
                    fontSize: 11,
                    lineHeight: 1.6,
                    padding: "2px 0",
                  }}
                >
                  <span
                    style={{
                      color: "#2a2a3a",
                      flexShrink: 0,
                      fontWeight: 500,
                    }}
                  >
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
