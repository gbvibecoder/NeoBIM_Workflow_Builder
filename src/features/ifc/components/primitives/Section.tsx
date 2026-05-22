"use client";

import React, { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";

/* ─── Section primitive ───────────────────────────────────────────────────
   Phase Z.IFC.1 (2026-05-18) — Light Render Studio.
   Replaces three separate hand-rolled <Section> patterns (Editor card,
   Enhance border-bottom, Properties PsetGroup). One primitive, one look.

   Each section is a vellum card with:
     - drafting strip top-edge (CSS gradient tied to `accent`)
     - icon + title row + optional meta + optional pill (e.g. "AI BETA")
     - chevron caret on the right
     - body padded children when expanded                                */

export type SectionAccent = "blueprint" | "burnt" | "sage" | "ember" | "amber";

interface Props {
  icon?: ReactNode;
  title: string;
  /** Small uppercase eyebrow / meta text below the title. */
  meta?: string;
  /** Pill rendered to the right of the title (e.g. "AI BETA"). */
  pill?: ReactNode;
  /** Default open state on first render. Subsequent toggles are local state. */
  defaultOpen?: boolean;
  /** Controls the colour of the drafting strip + icon tint. */
  accent?: SectionAccent;
  /** Variant — "card" gets full border + paper bg; "inline" gets only a
      borderBottom (used by long lists where 7 stacked cards look heavy). */
  variant?: "card" | "inline";
  children: ReactNode;
}

const accentMap: Record<SectionAccent, string> = {
  blueprint: "var(--rs-blueprint)",
  burnt: "var(--rs-burnt)",
  sage: "var(--rs-sage)",
  ember: "var(--rs-ember)",
  amber: "var(--rs-amber-mark)",
};

export function Section({
  icon,
  title,
  meta,
  pill,
  defaultOpen = true,
  accent = "blueprint",
  variant = "card",
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const containerStyle: CSSProperties =
    variant === "card"
      ? {
          marginBottom: 8,
          background: UI.bg.paper,
          border: `1px solid ${UI.border.subtle}`,
          borderRadius: UI.radius.md,
          overflow: "hidden",
          position: "relative",
        }
      : {
          borderBottom: `1px solid ${UI.border.subtle}`,
          position: "relative",
        };

  return (
    <div style={containerStyle}>
      {/* Drafting strip — coloured top edge */}
      {variant === "card" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: accentMap[accent],
            opacity: 0.85,
          }}
        />
      )}

      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          color: UI.text.primary,
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {icon && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              color: accentMap[accent],
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
        )}
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: 0.1,
              color: UI.text.primary,
              fontFamily: UI.font.body,
            }}
          >
            {title}
          </span>
          {meta && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: UI.text.tertiary,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                fontFamily: UI.font.mono,
              }}
            >
              {meta}
            </span>
          )}
        </span>
        {pill && <span style={{ flexShrink: 0 }}>{pill}</span>}
        <span style={{ color: UI.text.tertiary, display: "inline-flex", flexShrink: 0 }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div style={{ padding: variant === "card" ? "0 12px 12px" : "0 12px 10px" }}>
          {children}
        </div>
      )}
    </div>
  );
}
