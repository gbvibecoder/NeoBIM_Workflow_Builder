"use client";

import React, { type CSSProperties, type ReactNode } from "react";
import { UI } from "@/features/ifc/components/constants";

/* ─── PresetGrid primitive ────────────────────────────────────────────────
   Phase Z.IFC.1 (2026-05-18). For multi-icon grids like HDRI preset
   (Day/Sunset/Overcast/Night/Studio) where each option needs an icon AND
   a label. SegmentedPicker is for compact label-only segments.            */

interface Option<T extends string> {
  value: T;
  icon: ReactNode;
  label: string;
  helper?: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Number of columns. Default 5 — matches HDRI 5-preset grid. */
  columns?: number;
  /** Small label above the grid. */
  label?: string;
}

export function PresetGrid<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  columns = 5,
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
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 6,
        }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          const style: CSSProperties = {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "10px 4px",
            border: `1px solid ${active ? "var(--rs-blueprint)" : UI.border.subtle}`,
            background: active ? "var(--rs-blueprint-soft)" : UI.bg.paper,
            color: active ? "var(--rs-blueprint)" : UI.text.secondary,
            fontSize: 10.5,
            fontWeight: active ? 600 : 500,
            borderRadius: UI.radius.sm,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            transition: UI.transition,
            fontFamily: UI.font.body,
            minWidth: 0,
          };
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              title={opt.helper}
              style={style}
            >
              <span style={{ display: "inline-flex", color: active ? "var(--rs-blueprint)" : UI.text.tertiary }}>
                {opt.icon}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  textAlign: "center",
                }}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
