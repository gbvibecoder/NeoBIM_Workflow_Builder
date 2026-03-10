"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { NodeLibrarySidebar } from "./NodeLibrarySidebar";

/**
 * Right-side collapsible panel that houses the Node Library on the canvas page.
 * Collapsed: 40px tab with vertical "NODE LIBRARY" label.
 * Expanded: 280px panel with full search/filter/node list.
 */
export function RightNodePanel() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: isOpen ? 300 : 40,
        zIndex: 50,
        transition: "width 300ms ease",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Toggle tab — always visible on the left edge of the panel */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        title={isOpen ? "Collapse Node Library" : "Expand Node Library"}
        style={{
          width: 40,
          height: "100%",
          flexShrink: 0,
          pointerEvents: "auto",
          background: "rgba(7, 8, 9, 0.85)",
          borderTop: "none",
          borderBottom: "none",
          borderLeft: "1px solid rgba(184,115,51,0.15)",
          borderRight: isOpen ? "1px solid rgba(184,115,51,0.1)" : "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "pointer",
          color: isOpen ? "#00F5FF" : "rgba(255,255,255,0.35)",
          transition: "color 200ms ease, background 200ms ease",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          padding: 0,
        }}
      >
        {/* Arrow icon */}
        {isOpen ? (
          <ChevronRight size={14} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronLeft size={14} style={{ flexShrink: 0 }} />
        )}

        {/* Package icon */}
        <Package size={14} style={{ flexShrink: 0, opacity: 0.7 }} />

        {/* Vertical label */}
        <span
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.15em",
            fontFamily: "var(--font-jetbrains), monospace",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            opacity: 0.6,
          }}
        >
          NODE LIBRARY
        </span>
      </button>

      {/* Expanded content */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          opacity: isOpen ? 1 : 0,
          transition: "opacity 250ms ease",
          pointerEvents: isOpen ? "auto" : "none",
          background: "rgba(7, 8, 9, 0.92)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderLeft: "1px solid rgba(184,115,51,0.1)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* NodeLibrarySidebar fills full height — scrolling handled inside */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            paddingTop: 8,
            paddingBottom: 8,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <NodeLibrarySidebar alwaysOpen />
        </div>
      </div>
    </div>
  );
}
