"use client";

import React, { type CSSProperties } from "react";
import { UI } from "@/features/ifc/components/constants";

/* ─── Switch primitive ────────────────────────────────────────────────────
   Phase Z.IFC.1 (2026-05-18). Replaces ~8 inline switchStyle/switchThumb
   patterns in IFCEnhancePanel. 36×20 pill, blueprint when on.            */

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  helper?: string;
  disabled?: boolean;
  /** When provided, renders the switch as a full row with label + helper
      on the left and the switch on the right. Otherwise renders just the
      pill (caller composes its own row). */
  layout?: "row" | "pill-only";
}

const trackStyle = (on: boolean, disabled: boolean): CSSProperties => ({
  position: "relative",
  width: 36,
  height: 20,
  borderRadius: 10,
  border: `1px solid ${on ? "var(--rs-blueprint)" : UI.border.default}`,
  background: on ? "var(--rs-blueprint)" : UI.bg.cream,
  cursor: disabled ? "not-allowed" : "pointer",
  padding: 0,
  flexShrink: 0,
  opacity: disabled ? 0.5 : 1,
  transition: UI.transition,
});

const thumbStyle = (on: boolean): CSSProperties => ({
  position: "absolute",
  top: 1,
  left: on ? 17 : 1,
  width: 16,
  height: 16,
  borderRadius: 8,
  background: "#FFFFFF",
  boxShadow: "0 1px 2px rgba(14,18,24,0.18)",
  transition: UI.transition,
});

export function Switch({
  checked,
  onChange,
  label,
  helper,
  disabled = false,
  layout = "pill-only",
}: Props) {
  const pill = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={trackStyle(checked, disabled)}
    >
      <span style={thumbStyle(checked)} />
    </button>
  );

  if (layout === "pill-only") return pill;

  return (
    <div
      style={{
        display: "flex",
        alignItems: helper ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        {label && (
          <span style={{ fontSize: 12.5, color: UI.text.primary, fontFamily: UI.font.body }}>
            {label}
          </span>
        )}
        {helper && (
          <span style={{ fontSize: 10.5, color: UI.text.tertiary, lineHeight: 1.4 }}>
            {helper}
          </span>
        )}
      </div>
      {pill}
    </div>
  );
}
