"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertOctagon, RotateCcw, Activity, Lightbulb } from "lucide-react";

interface FailureSectionProps {
  errorMessage: string | null;
  workflowId: string | null;
  executionId: string;
}

/**
 * Phase 4.2 Fix 5 — derive 1–3 actionable recovery suggestions from the
 * raw error message. Heuristic, not authoritative; shown as a quiet bullet
 * list. Always also recommends Diagnostics as a last resort.
 */
function deriveRecoverySuggestions(errorMessage: string | null): string[] {
  const out: string[] = [];
  if (!errorMessage) {
    out.push("Open Diagnostics (bottom-right) for the per-node trace.");
    out.push("Retry from the canvas — most transient failures clear on a second run.");
    return out;
  }
  const msg = errorMessage.toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    out.push("Network timeout — the upstream service didn't respond in time. Try again in a moment.");
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) {
    out.push("Rate limit hit — wait a few minutes before re-running, or check your plan limits.");
  }
  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("api key") || msg.includes("forbidden") || msg.includes("403")) {
    out.push("Auth or API-key issue — verify your account and any provider keys configured for the workflow.");
  }
  if (msg.includes("base64") || msg.includes("invalid format") || msg.includes("corrupt")) {
    out.push("The input file may be corrupted or malformed — re-upload it from the canvas.");
  }
  if (msg.includes("not found") || msg.includes("404")) {
    out.push("A required resource wasn't found upstream — check the input artifact still exists.");
  }
  if (msg.includes("kling") || msg.includes("dall-e") || msg.includes("openai") || msg.includes("ifc service")) {
    out.push("The render/parser provider is unavailable. Re-run after a minute, or check the provider status page.");
  }
  if (out.length === 0) {
    out.push("Open Diagnostics (bottom-right) — the per-node trace will name the step that broke.");
  }
  if (out.length < 3) {
    out.push("Retry from the canvas with the same inputs — many failures are transient.");
  }
  return out.slice(0, 3);
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

      {/* Phase 4.2 Fix 5 — recovery suggestions block */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(13,148,136,0.18)",
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 600,
            color: "#0D9488",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          <Lightbulb size={12} aria-hidden="true" />
          Try this next
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {deriveRecoverySuggestions(errorMessage).map((suggestion, i) => (
            <li key={i} style={{ fontSize: 13, color: "#0F172A", lineHeight: 1.55 }}>
              {suggestion}
            </li>
          ))}
        </ul>
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
