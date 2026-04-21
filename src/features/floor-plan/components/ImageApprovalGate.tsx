/**
 * Phase 2.3 Workstream C — Image approval gate UI.
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
}

export function ImageApprovalGate({
  imageBase64,
  onApprove,
  onRegenerate,
  onCancel,
}: ImageApprovalGateProps) {
  const dataUrl = `data:image/png;base64,${imageBase64}`;

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
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#9090B0",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 11,
                cursor: "pointer",
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

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onRegenerate}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#D5D7E5",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Regenerate image (~$0.034)
            </button>
            <button
              onClick={onApprove}
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
                cursor: "pointer",
                boxShadow: "0 8px 24px rgba(79,138,255,0.28)",
              }}
            >
              Looks good → generate CAD (~$0.06)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
