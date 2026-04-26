"use client";

import { ExecutionDiagnosticsPanel } from "@/components/diagnostics/ExecutionDiagnosticsPanel";

/**
 * Diagnostics tab — Phase 1 D6.
 *
 * Mounts the existing ExecutionDiagnosticsPanel. The panel renders its own
 * floating launcher when there's a trace; clicking it opens a full-content
 * modal. We keep the launcher behavior verbatim — the audit's preservation
 * list (§11.1 row 11) flagged this component as preserved, so we don't
 * inline its internals here. When trace data exists, the launcher is the
 * tab's content; when it doesn't, the tab shows a friendly empty state.
 */
export function DiagnosticsTab({ hasTrace }: { hasTrace: boolean }) {
  return (
    <div
      style={{
        minHeight: 320,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "8px 0",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "16px 20px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "rgba(245,245,250,0.55)",
          }}
        >
          Behind the Scenes
        </span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#F5F5FA", letterSpacing: "-0.005em" }}>
          {hasTrace ? "Open the diagnostics panel" : "No diagnostics for this run"}
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(245,245,250,0.6)", lineHeight: 1.6 }}>
          {hasTrace
            ? "The button at the bottom-right opens the full execution trace: per-node attempts, API calls, data flows, and search."
            : "This execution finished before the diagnostics layer was wired up, or the trace was never persisted to Execution.metadata."}
        </p>
      </header>
      <ExecutionDiagnosticsPanel />
    </div>
  );
}
