"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertOctagon, RotateCcw, Activity } from "lucide-react";

interface FailureSectionProps {
  errorMessage: string | null;
  workflowId: string | null;
  executionId: string;
}

/**
 * Calm full-failure card per Phase 2 P6. Red is restrained — one accent
 * stripe + one icon tile + the status pill in the header. The body of
 * the card is white; the message reads as prose, not as an alarm.
 */
export function FailureSection({ errorMessage, workflowId, executionId }: FailureSectionProps) {
  const router = useRouter();

  const handleRetry = () => {
    if (!workflowId) return;
    try {
      sessionStorage.setItem("prefill-from-execution", executionId);
    } catch {
      // sessionStorage unavailable
    }
    router.push(`/dashboard/canvas?id=${workflowId}`);
  };

  const handleViewDiagnostics = () => {
    // The floating ExecutionDiagnosticsPanel launcher button has its own
    // selectable hook via the `title` attribute. Programmatically click it
    // when present so the user can see the trace without hunting for the
    // launcher.
    if (typeof document === "undefined") return;
    const launcher = document.querySelector<HTMLButtonElement>(
      'button[title="Open execution diagnostics"]',
    );
    launcher?.click();
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        position: "relative",
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 20,
        boxShadow: "0 4px 16px rgba(0,0,0,0.05)",
        padding: "32px clamp(24px, 4vw, 40px)",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "linear-gradient(90deg, #DC2626, #DC262640, transparent)",
        }}
      />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 48,
            height: 48,
            borderRadius: 14,
            background: "#FEE2E2",
            color: "#DC2626",
            flexShrink: 0,
          }}
        >
          <AlertOctagon size={22} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 500,
              color: "#B91C1C",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Run terminated · 00 artifacts
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(22px, 2.8vw, 28px)",
              fontWeight: 600,
              color: "#0F172A",
              letterSpacing: "-0.01em",
            }}
          >
            Something stopped this run before it finished.
          </h2>
        </div>
      </div>

      <div
        style={{
          background: "#FAFAF8",
          border: "1px solid rgba(0,0,0,0.06)",
          borderRadius: 12,
          padding: "14px 16px",
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: 13,
          color: "#4B5563",
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginBottom: 18,
        }}
      >
        {errorMessage?.trim() ||
          "No specific error was recorded for this run. Open Diagnostics (bottom-right) — the per-node trace usually tells the story. Then retry from the canvas with whatever needs to change."}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {workflowId ? (
          <button
            type="button"
            onClick={handleRetry}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 10,
              background: "#DC2626",
              border: "none",
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(220,38,38,0.18)",
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Retry from canvas
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleViewDiagnostics}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.10)",
            color: "#4B5563",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Activity size={14} aria-hidden="true" />
          View diagnostics
        </button>
      </div>
    </motion.section>
  );
}
