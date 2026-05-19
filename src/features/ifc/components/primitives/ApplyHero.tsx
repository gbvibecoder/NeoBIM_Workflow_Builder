"use client";

import React, { type CSSProperties, type ReactNode } from "react";
import { Sparkles, Loader2, Wand2, RotateCcw } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";

/* ─── ApplyHero — the premium "Apply Enhancement" CTA card ────────────────
   Phase Z.IFC.1 (2026-05-18). Sits at the top of the Enhance panel.
   Gradient strip + italic headline + detected chip + primary CTA + Auto.
   Pulses softly when idle + hasModel + not applied. After apply, morphs
   into a destructive Reset button (preserves IFCEnhancePanel behavior).  */

interface Props {
  /** Detected building type, e.g. "Residential apartment". */
  detected?: string | null;
  /** Optional source label e.g. "(default)" — appears after detected. */
  detectedSource?: string | null;
  /** Headline content. Pass <em>life</em> spans for italic accents. */
  headline?: ReactNode;
  /** True while Apply is running (shows spinner + "Applying…"). */
  applying?: boolean;
  /** True after a successful apply (Apply button morphs to Reset). */
  applied?: boolean;
  /** Master disable (no model loaded yet). */
  disabled?: boolean;
  onApply: () => void;
  onAuto?: () => void;
  onReset?: () => void;
}

export function ApplyHero({
  detected,
  detectedSource,
  headline,
  applying = false,
  applied = false,
  disabled = false,
  onApply,
  onAuto,
  onReset,
}: Props) {
  const shouldPulse = !disabled && !applying && !applied;

  /* Compact button heights (Phase Z.IFC.2 follow-up 2026-05-19):
     40 → 34 to recover vertical space without losing tappability. */
  const primaryStyle: CSSProperties = applied
    ? {
        flex: 1,
        height: 34,
        padding: "0 14px",
        borderRadius: UI.radius.md,
        border: `1px solid ${UI.accent.red}`,
        background: UI.bg.paper,
        color: UI.accent.red,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        fontFamily: UI.font.body,
        letterSpacing: 0.1,
        transition: UI.transition,
      }
    : {
        flex: 1,
        height: 34,
        padding: "0 14px",
        borderRadius: UI.radius.md,
        border: "none",
        background: "linear-gradient(135deg, var(--rs-blueprint) 0%, var(--rs-blueprint-2) 100%)",
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled || applying ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        fontFamily: UI.font.body,
        letterSpacing: 0.2,
        boxShadow: "0 2px 8px rgba(26,77,92,0.22), inset 0 1px 0 rgba(255,255,255,0.15)",
        animation: shouldPulse ? "ifc-apply-pulse 2.6s ease-in-out infinite" : undefined,
        transition: UI.transition,
      };

  const autoStyle: CSSProperties = {
    height: 34,
    padding: "0 12px",
    borderRadius: UI.radius.md,
    border: `1px solid ${UI.border.default}`,
    background: UI.bg.cream,
    color: UI.text.primary,
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled || applying ? "not-allowed" : "pointer",
    opacity: disabled || applying ? 0.5 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontFamily: UI.font.body,
    flexShrink: 0,
    transition: UI.transition,
  };

  return (
    <div
      style={{
        position: "relative",
        background: UI.bg.paper,
        border: `1px solid ${UI.border.subtle}`,
        borderRadius: UI.radius.lg,
        padding: "10px 12px 12px",
        margin: "10px 12px 10px",
        boxShadow: UI.shadow.card,
        overflow: "hidden",
      }}
    >
      {/* Drafting strip — multi-color gradient */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background:
            "linear-gradient(90deg, var(--rs-blueprint) 0%, var(--rs-blueprint-2) 45%, var(--rs-sage) 75%, var(--rs-burnt) 100%)",
        }}
      />

      {/* Eyebrow + detected chip — single-row, ellipsis-truncate.
          Prior version wrapped the chip to 3 lines on narrow widths
          ("DETECTED · RESIDENTIAL APARTMENT" overflowing). Now the chip
          shrinks via minWidth:0 + truncation. "(DEFAULT)" source is
          dropped — implied when the chip is sage-tinted; restore via
          tooltip on the chip itself. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
          marginBottom: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: UI.text.tertiary,
            fontFamily: UI.font.mono,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <Sparkles size={11} color="var(--rs-blueprint)" />
          AI Enhancement
        </span>
        {detected && (
          <span
            title={detectedSource ? `Detected ${detected} (${detectedSource})` : `Detected ${detected}`}
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: UI.accent.sage,
              fontFamily: UI.font.mono,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              minWidth: 0,
              maxWidth: "60%",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: UI.accent.sage,
                boxShadow: "0 0 6px rgba(74,107,77,0.6)",
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              Detected · {detected}
            </span>
          </span>
        )}
      </div>

      {/* Italic headline — compact */}
      <h3
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: UI.text.primary,
          margin: "0 0 10px",
          fontFamily: UI.font.display,
          letterSpacing: -0.1,
          lineHeight: 1.2,
        }}
      >
        {headline ?? (
          <>
            Bring your IFC to <em style={{ fontStyle: "italic", color: UI.accent.blueprint }}>life</em>.
          </>
        )}
      </h3>

      {/* Action row */}
      <div style={{ display: "flex", gap: 8 }}>
        {applied ? (
          <button
            type="button"
            onClick={onReset}
            style={primaryStyle}
            title="Strip all enhancements and return to raw IFC"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={disabled || applying}
            style={primaryStyle}
            title={disabled ? "Upload an IFC first" : "Run the full enhance pipeline"}
          >
            {applying ? (
              <Loader2 size={15} className="animate-spin" strokeWidth={2.4} />
            ) : (
              <Sparkles size={15} strokeWidth={2.4} />
            )}
            {applying ? "Applying…" : "Apply Enhancement"}
          </button>
        )}
        {onAuto && (
          <button
            type="button"
            onClick={onAuto}
            disabled={disabled || applying}
            style={autoStyle}
            title="Pick sensible defaults based on model size, then apply"
          >
            <Wand2 size={13} />
            Auto
          </button>
        )}
      </div>
    </div>
  );
}
