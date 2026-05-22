"use client";

import React, { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";

/* ─── ToolButton primitive ────────────────────────────────────────────────
   Phase Z.IFC.1 (2026-05-18). A single button within a ToolGroup. Renders
   icon-only or icon+label depending on `label` presence. `active` state
   uses blueprint accent; `hasDropdown` adds a small caret.                */

export interface ToolButtonProps {
  icon?: ReactNode;
  label?: string;
  title?: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  hasDropdown?: boolean;
  onClick?: () => void;
  /** When this button is part of a ToolGroup, the parent renders the
      inter-button separator. Standalone buttons use their own pill chrome. */
  variant?: "grouped" | "standalone";
  /** Used when consumers need to position a popover relative to this
      button (e.g. dropdown menus). Bubbles via a render prop pattern. */
  children?: ReactNode;
}

export function ToolButton({
  icon,
  label,
  title,
  shortcut,
  active = false,
  disabled = false,
  hasDropdown = false,
  onClick,
  variant = "grouped",
  children,
}: ToolButtonProps) {
  const [hover, setHover] = useState(false);

  const showActiveStyles = active;
  const showHoverStyles = hover && !disabled && !active;

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: label ? 6 : 0,
    height: variant === "grouped" ? 26 : 32,
    padding: label ? "0 10px" : "0 7px",
    borderRadius: variant === "grouped" ? UI.radius.sm : UI.radius.md,
    border: variant === "standalone" ? `1px solid ${UI.border.subtle}` : "none",
    background: showActiveStyles
      ? "var(--rs-blueprint-soft)"
      : showHoverStyles
        ? UI.bg.cream
        : "transparent",
    color: showActiveStyles ? "var(--rs-blueprint)" : disabled ? UI.text.tertiary : UI.text.primary,
    fontSize: 11.5,
    fontWeight: showActiveStyles ? 600 : 500,
    fontFamily: UI.font.body,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: UI.transition,
    whiteSpace: "nowrap",
    position: "relative",
  };

  return (
    <div
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => !disabled && onClick?.()}
        disabled={disabled}
        title={`${title ?? label ?? ""}${shortcut ? ` (${shortcut})` : ""}`}
        style={base}
      >
        {icon && (
          <span style={{ display: "inline-flex", flexShrink: 0 }}>
            {icon}
          </span>
        )}
        {label && <span>{label}</span>}
        {hasDropdown && (
          <ChevronDown size={11} style={{ marginLeft: label ? 0 : 2, opacity: 0.55, flexShrink: 0 }} />
        )}
      </button>
      {children}
    </div>
  );
}
