/**
 * Phase 2.3 Workstream C — Image approval gate UI.
 * Phase 2.6 — Now the default UX for every VIP generation (no longer
 * gated by PIPELINE_VIP_APPROVAL_GATE flag). Adds loading/error states.
 *
 * Shown when a VipJob is AWAITING_APPROVAL after Stage 2. The user
 * sees the generated image and picks:
 *   - "Looks good" → resume pipeline (Stages 3-7, ~$0.06 more)
 *   - "Regenerate image" → re-run Stage 2 only (~$0.034)
 *
 * Follows the visual language of VipGenerationProgress so users
 * don't feel jolted between overlays.
 */

"use client";

import React from "react";

interface ImageApprovalGateProps {
  /** Base64-encoded PNG from Stage 2 (no data-URL prefix). */
  imageBase64: string;
  onApprove: () => void;
  onRegenerate: () => void;
  onCancel?: () => void;
  /** True while an approve request is in flight — disables buttons, shows spinner. */
  approving?: boolean;
  /** True while a regenerate request is in flight — disables buttons, shows spinner. */
  regenerating?: boolean;
  /** If set, renders a red error banner above the buttons (e.g. network failure). */
  errorMessage?: string | null;
}

export function ImageApprovalGate({
  imageBase64,
  onApprove,
  onRegenerate,
  onCancel,
  approving = false,
  regenerating = false,
  errorMessage = null,
}: ImageApprovalGateProps) {
  const dataUrl = `data:image/png;base64,${imageBase64}`;
  const busy = approving || regenerating;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(7,7,13,0.92)",
        backdropFilter: "blur(10px)",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 720,
          width: "100%",
          borderRadius: 20,
          overflow: "hidden",
          background: "linear-gradient(180deg, #111120 0%, #080816 100%)",
          border: "1px solid rgba(79,138,255,0.18)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.7), 0 0 80px rgba(79,138,255,0.08)",
        }}
      >
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "1.5px",
                color: "#4F8AFF",
                marginBottom: 4,
              }}
            >
              Step 1 of 2 — Image generated
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#F0F2F8", letterSpacing: "-0.01em" }}>
              Review the generated floor plan image
            </div>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              aria-label="Cancel generation"
              disabled={busy}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#9090B0",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 11,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.4 : 1,
              }}
            >
              Cancel
            </button>
          )}
        </div>

        <div
          style={{
            background: "#FFFFFF",
            padding: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: 360,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL, not a CDN asset */}
          <img
            src={dataUrl}
            alt="Stage 2 generated floor plan"
            style={{ maxWidth: "100%", maxHeight: 480, display: "block" }}
          />
        </div>

        <div style={{ padding: 20 }}>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: "#B8B8D0",
              margin: "0 0 18px",
            }}
          >
            The CAD geometry runs next and costs about $0.06 more. If this image
            looks right (rooms in the right places, labels readable), approve.
            If it looks off, regenerate just the image for ~$0.034.
          </p>

          {errorMessage && (
            <div
              role="alert"
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.28)",
                color: "#FCA5A5",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {errorMessage}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onRegenerate}
              disabled={busy}
              aria-busy={regenerating}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#D5D7E5",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy && !regenerating ? 0.35 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {regenerating && <Spinner tone="light" />}
              {regenerating ? "Regenerating…" : "Regenerate image (~$0.034)"}
            </button>
            <button
              onClick={onApprove}
              disabled={busy}
              aria-busy={approving}
              style={{
                flex: 1.4,
                padding: "12px 16px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #4F8AFF, #A855F7)",
                border: "none",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy && !approving ? 0.5 : 1,
                boxShadow: "0 8px 24px rgba(79,138,255,0.28)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {approving && <Spinner tone="dark" />}
              {approving ? "Starting CAD…" : "Looks good → generate CAD (~$0.06)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner({ tone }: { tone: "light" | "dark" }) {
  const color = tone === "dark" ? "#fff" : "#D5D7E5";
  return (
    <span
      aria-hidden="true"
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        display: "inline-block",
        animation: "iag-spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes iag-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
