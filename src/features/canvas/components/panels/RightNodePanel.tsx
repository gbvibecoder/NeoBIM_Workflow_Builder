"use client";

import React, { useState, memo } from "react";
import { ChevronLeft, ChevronRight, Layers3 } from "lucide-react";
import { NodeLibrarySidebar } from "@/features/canvas/components/panels/NodeLibrarySidebar";
import { useLocale } from "@/hooks/useLocale";
import { useUIStore } from "@/shared/stores/ui-store";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

/**
 * Right-side floating chrome panel — Node Library (V3).
 * Collapsed: 40px rounded pill with vertical "NODE LIBRARY" label.
 * Expanded: 320px floating card with search/filter/node list.
 */
export const RightNodePanel = memo(function RightNodePanel() {
  const { t } = useLocale();
  const canvasTheme = useCanvasTheme((s) => s.theme);
  const tk = useCanvasToken();
  const isOpen = useUIStore((s) => s.isNodeLibraryOpen);
  const toggleNodeLibrary = useUIStore((s) => s.toggleNodeLibrary);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`right-node-panel canvas-theme-${canvasTheme}`}
      style={{
        position: "fixed",
        top: 80,
        right: 16,
        bottom: 80,
        width: isOpen ? 320 : 40,
        background: tk.libBg,
        border: `1px solid ${tk.libBorder}`,
        borderRadius: 14,
        boxShadow: tk.shadowMd,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 9,
        transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {!isOpen ? (
        /* ── Collapsed: vertical tab ─────────────────────────────── */
        <button
          onClick={toggleNodeLibrary}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          title={t("canvas.expandNodeLibrary")}
          style={{
            width: "100%",
            height: "100%",
            background: isHovered ? tk.accentBg : "transparent",
            border: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            cursor: "pointer",
            color: isHovered ? tk.accent : tk.text3,
            transition: "all 200ms ease",
            padding: 0,
          }}
        >
          <ChevronLeft size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
          <Layers3 size={16} style={{ flexShrink: 0 }} />
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
            {t("canvas.nodeLibraryLabel")}
          </span>
        </button>
      ) : (
        /* ── Expanded: library content ───────────────────────────── */
        <>
          {/* Collapse button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "6px 8px 0",
              flexShrink: 0,
            }}
          >
            <button
              onClick={toggleNodeLibrary}
              title={t("canvas.collapseNodeLibrary")}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: tk.text3,
                transition: "color 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = tk.text1;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = tk.text3;
              }}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Library content */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <NodeLibrarySidebar alwaysOpen />
          </div>
        </>
      )}
    </div>
  );
});
