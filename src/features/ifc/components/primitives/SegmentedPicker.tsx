"use client";

import React, { type CSSProperties } from "react";
import { UI } from "@/features/ifc/components/constants";

/* ─── SegmentedPicker primitive ───────────────────────────────────────────
   Phase Z.IFC.1 (2026-05-18). Replaces ~6 inline pickerBtnStyle usages.
   A row of equal-flex buttons; active one has blueprint outline + cream
   background. Designed for 2–5 short labels (Low/Med/High, etc).         */

interface Option<T extends string> {
  value: T;
  label: string;
  /** Disable a specific option (renders "soon" pattern). */
  disabled?: boolean;
  /** Helper text shown below the active label on hover/focus. */
  helper?: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Optional small label above the row. */
  label?: string;
}

export function SegmentedPicker<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  label,
}: Props<T>) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: UI.text.tertiary,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            fontFamily: UI.font.mono,
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 3,
          background: UI.bg.cream,
          borderRadius: UI.radius.md,
          border: `1px solid ${UI.border.subtle}`,
        }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          const isDisabled = disabled || opt.disabled;
          const style: CSSProperties = {
            flex: 1,
            padding: "6px 8px",
            border: "none",
            borderRadius: UI.radius.sm,
            background: active ? UI.bg.paper : "transparent",
            color: active ? UI.text.primary : UI.text.secondary,
            fontSize: 11,
            fontWeight: active ? 600 : 500,
            cursor: isDisabled ? "not-allowed" : "pointer",
            opacity: isDisabled && !active ? 0.45 : 1,
            transition: UI.transition,
            boxShadow: active ? UI.shadow.paper : "none",
            fontFamily: UI.font.body,
            letterSpacing: 0.1,
          };
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => !isDisabled && onChange(opt.value)}
              disabled={isDisabled}
              title={opt.helper}
              style={style}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
