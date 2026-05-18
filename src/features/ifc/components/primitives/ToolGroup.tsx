"use client";

import React, { type ReactNode } from "react";
import { UI } from "@/features/ifc/components/constants";

/* ─── ToolGroup primitive ─────────────────────────────────────────────────
   Phase Z.IFC.1 (2026-05-18). Pill that wraps 2-4 ToolButtons with thin
   inter-button dividers, matching the prototype's `.vh-group` pattern.
   Replaces the prior loose-divider style in the old Toolbar.              */

interface Props {
  children: ReactNode;
  /** Tooltip for the entire group (e.g. "Camera"). */
  label?: string;
}

export function ToolGroup({ children, label }: Props) {
  return (
    <div
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        height: 32,
        padding: "0 3px",
        background: UI.bg.paper,
        border: `1px solid ${UI.border.subtle}`,
        borderRadius: UI.radius.md,
        boxShadow: UI.shadow.paper,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}
