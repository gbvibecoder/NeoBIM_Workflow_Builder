"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Layers3 } from "lucide-react";
import { NodeLibrarySidebar } from "./NodeLibrarySidebar";

/**
 * Right-side collapsible panel that houses the Node Library on the canvas page.
 * Collapsed: visible tab with vertical "NODE LIBRARY" label and accent stripe.
 * Expanded: 280px panel with full search/filter/node list.
 */
export function RightNodePanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const tabActive = isOpen || isHovered;

  return (
    <div
      className="right-node-panel"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: isOpen ? 300 : 44,
        zIndex: 50,
        transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Toggle tab — always visible on the left edge of the panel */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={isOpen ? "Collapse Node Library" : "Expand Node Library"}
        style={{
          width: 44,
          height: "100%",
          flexShrink: 0,
          pointerEvents: "auto",
          background: tabActive
            ? "rgba(0, 245, 255, 0.04)"
            : "rgba(10, 12, 16, 0.85)",
          borderTop: "none",
          borderBottom: "none",
          borderLeft: tabActive
            ? "2px solid rgba(0, 245, 255, 0.5)"
            : "1px solid rgba(255,255,255,0.08)",
          borderRight: isOpen ? "1px solid rgba(255,255,255,0.06)" : "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: "pointer",
          color: tabActive ? "#00F5FF" : "rgba(255,255,255,0.5)",
          transition: "all 200ms ease",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          padding: 0,
        }}
      >
        {/* Arrow icon */}
        {isOpen ? (
          <ChevronRight size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
        ) : (
          <ChevronLeft size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
        )}

        {/* Node library icon */}
        <Layers3 size={16} style={{ flexShrink: 0 }} />

        {/* Vertical label */}
        <span
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.14em",
            fontFamily: "var(--font-jetbrains), monospace",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
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
          background: "rgba(10, 12, 16, 0.92)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
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
