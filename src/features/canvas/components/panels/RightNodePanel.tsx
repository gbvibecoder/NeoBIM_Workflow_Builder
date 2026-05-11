"use client";

import React, { useState, memo } from "react";
import { ChevronLeft, ChevronRight, Layers3 } from "lucide-react";
import { NodeLibrarySidebar } from "@/features/canvas/components/panels/NodeLibrarySidebar";
import { useLocale } from "@/hooks/useLocale";
import { useUIStore } from "@/shared/stores/ui-store";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";

/**
 * Right-side collapsible panel that houses the Node Library on the canvas page.
 * Collapsed: visible tab with vertical "NODE LIBRARY" label and accent stripe.
 * Expanded: 280px panel with full search/filter/node list.
 */
export const RightNodePanel = memo(function RightNodePanel() {
  const { t } = useLocale();
  const canvasTheme = useCanvasTheme((s) => s.theme);
  const isOpen = useUIStore((s) => s.isNodeLibraryOpen);
  const toggleNodeLibrary = useUIStore((s) => s.toggleNodeLibrary);
  const [isHovered, setIsHovered] = useState(false);

  const tabActive = isOpen || isHovered;

  return (
    <div
      className={`right-node-panel canvas-theme-${canvasTheme}`}
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
        onClick={toggleNodeLibrary}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={isOpen ? t('canvas.collapseNodeLibrary') : t('canvas.expandNodeLibrary')}
        style={{
          width: 44,
          height: "100%",
          flexShrink: 0,
          pointerEvents: "auto",
          background: tabActive
            ? "var(--canvas-accent-bg)"
            : "var(--canvas-panel-bg)",
          borderTop: "none",
          borderBottom: "none",
          borderLeft: tabActive
            ? "2px solid var(--canvas-lib-tab-border)"
            : "1px solid var(--canvas-line-1)",
          borderRight: isOpen ? "1px solid var(--canvas-line-1)" : "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: "pointer",
          color: tabActive ? "var(--canvas-accent)" : "var(--canvas-lib-tab-idle)",
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
          {t('canvas.nodeLibraryLabel')}
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
          background: "var(--canvas-panel-bg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderLeft: "1px solid var(--canvas-panel-border)",
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
});
