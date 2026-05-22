"use client";

/**
 * BuildJourneySection — Phase gamma.1 Direct Agent Mode.
 *
 * Shows the agent's build journey: turn count, render_preview calls,
 * retry hints applied. Helps the user trust what happened.
 */

import { useState } from "react";

interface BuildJourneySectionProps {
  totalAgentTurns: number;
  renderPreviewCalls: number;
  retryHints: string[];
}

export function BuildJourneySection({
  totalAgentTurns,
  renderPreviewCalls,
  retryHints,
}: BuildJourneySectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Don't render if there's no journey data
  if (totalAgentTurns === 0 && renderPreviewCalls === 0 && retryHints.length === 0) {
    return null;
  }

  return (
    <section style={{ marginTop: 32, marginBottom: 24 }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 600,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
          ▸
        </span>
        Build Journey
        <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.7 }}>
          {totalAgentTurns} turns, {renderPreviewCalls} previews, {retryHints.length} hint{retryHints.length !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 12, paddingLeft: 16, borderLeft: "2px solid #334155" }}>
          {/* Turn count */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Agent Turns</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
              {totalAgentTurns}
            </div>
          </div>

          {/* Render preview count */}
          {renderPreviewCalls > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Render Previews</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
                {renderPreviewCalls}
              </div>
            </div>
          )}

          {/* Retry hints */}
          {retryHints.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Retry Feedback</div>
              {retryHints.map((hint, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: 12,
                    padding: "8px 12px",
                    background: "#1e293b",
                    borderRadius: 6,
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "#cbd5e1",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                    Iteration {idx + 1} → {idx + 2}
                  </div>
                  {hint}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
