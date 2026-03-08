"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Clock, Zap, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

interface ExecutionSummaryProps {
  totalNodes: number;
  successCount: number;
  errorCount: number;
  totalTime: string;
  artifactCount: number;
  onDismiss: () => void;
}

export function ExecutionSummary({
  totalNodes,
  successCount,
  errorCount,
  totalTime,
  artifactCount,
  onDismiss,
}: ExecutionSummaryProps) {
  const { t } = useLocale();
  const allPassed = errorCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        borderRadius: 16,
        background: "rgba(8, 8, 16, 0.92)",
        border: `1px solid ${allPassed ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
        backdropFilter: "blur(32px) saturate(1.3)",
        WebkitBackdropFilter: "blur(32px) saturate(1.3)",
        boxShadow: allPassed
          ? "0 12px 40px rgba(0,0,0,0.4), 0 0 30px rgba(16,185,129,0.08)"
          : "0 12px 40px rgba(0,0,0,0.4), 0 0 30px rgba(239,68,68,0.08)",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      {/* Status icon */}
      <motion.div
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.1 }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: allPassed ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {allPassed ? (
          <CheckCircle2 size={18} style={{ color: "#10B981" }} />
        ) : (
          <AlertCircle size={18} style={{ color: "#EF4444" }} />
        )}
      </motion.div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", lineHeight: 1.2 }}>
            {allPassed ? t('execution.completed') : t('execution.completedWithErrors')}
          </div>
          <div style={{ fontSize: 10, color: "#5C5C78", marginTop: 2 }}>
            {successCount}/{totalNodes} {t('execution.nodesSucceeded')}
          </div>
        </div>

        {/* Metrics row */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Clock size={11} style={{ color: "#5C5C78" }} />
            <span style={{ fontSize: 11, color: "#8888A0", fontWeight: 500 }}>{totalTime}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Zap size={11} style={{ color: "#F59E0B" }} />
            <span style={{ fontSize: 11, color: "#8888A0", fontWeight: 500 }}>
              {artifactCount} {artifactCount === 1 ? "artifact" : "artifacts"}
            </span>
          </div>
          {errorCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={11} style={{ color: "#EF4444" }} />
              <span style={{ fontSize: 11, color: "#F87171", fontWeight: 500 }}>
                {errorCount} {errorCount === 1 ? "error" : "errors"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        style={{
          width: 24, height: 24, borderRadius: 6,
          background: "transparent", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#3A3A50", cursor: "pointer",
          flexShrink: 0, marginLeft: 4,
          transition: "color 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}
