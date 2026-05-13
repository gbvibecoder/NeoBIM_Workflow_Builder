"use client";

/**
 * Z.CANVAS.2B Phase 3 — Canvas Controls cluster.
 * Zoom in/out, zoom %, fit view, pan/select toggle.
 * Positioned bottom-right, above minimap area.
 */

import { memo, useCallback } from "react";
import { Minus, Plus, Maximize2, Sparkles } from "lucide-react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

interface CanvasControlsProps {
  onChatToggle?: () => void;
  isChatOpen?: boolean;
}

export const CanvasControls = memo(function CanvasControls({ onChatToggle, isChatOpen }: CanvasControlsProps) {
  const tk = useCanvasToken();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const viewport = useViewport();

  const zoomPct = Math.round(viewport.zoom * 100);

  const handleZoomIn = useCallback(() => zoomIn({ duration: 200 }), [zoomIn]);
  const handleZoomOut = useCallback(() => zoomOut({ duration: 200 }), [zoomOut]);
  const handleFitView = useCallback(() => fitView({ padding: 0.15, duration: 300 }), [fitView]);

  const btnBase: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 4,
    border: 0,
    background: "transparent",
    color: tk.controlBtnText,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 0.12s ease, color 0.12s ease",
    padding: 0,
  };

  const btnHover = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = tk.controlBtnHover;
  }, []);
  const btnLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const isActive = e.currentTarget.dataset.active === "true";
    e.currentTarget.style.background = isActive ? tk.controlBtnActiveBg : "transparent";
  }, []);

  return (
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 14,
          display: "flex",
          alignItems: "center",
          gap: 2,
          height: 36,
          padding: 4,
          background: tk.controlBg,
          border: `1px solid ${tk.controlBorder}`,
          borderRadius: 10,
          boxShadow: tk.controlShadow,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* AI Chat pill — integrated into controls cluster */}
        {onChatToggle && !isChatOpen && (
          <>
            <button
              onClick={onChatToggle}
              title="AI Chat"
              aria-label="AI Chat"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                height: 28, padding: "0 10px", borderRadius: 6,
                background: tk.aiBg, border: `1px solid ${tk.aiBorder}`,
                color: tk.aiText, fontSize: 11, fontWeight: 600,
                cursor: "pointer", transition: "background 0.12s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = tk.aiBgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = tk.aiBg; }}
            >
              <Sparkles size={12} />
              AI CHAT
            </button>
            <div style={{ width: 1, height: 20, background: tk.line2, margin: "0 2px", flexShrink: 0 }} />
          </>
        )}

        {/* Zoom out */}
        <button
          onClick={handleZoomOut}
          title="Zoom out"
          style={btnBase}
          onMouseEnter={btnHover}
          onMouseLeave={btnLeave}
        >
          <Minus size={14} strokeWidth={2} />
        </button>

        {/* Zoom % */}
        <div
          style={{
            minWidth: 44,
            textAlign: "center",
            fontSize: 12,
            fontWeight: 500,
            color: tk.controlBtnText,
            fontFamily: "var(--font-jetbrains), monospace",
            letterSpacing: "0.02em",
            userSelect: "none",
          }}
        >
          {zoomPct}%
        </div>

        {/* Zoom in */}
        <button
          onClick={handleZoomIn}
          title="Zoom in"
          style={btnBase}
          onMouseEnter={btnHover}
          onMouseLeave={btnLeave}
        >
          <Plus size={14} strokeWidth={2} />
        </button>

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 20,
            background: tk.line2,
            margin: "0 2px",
            flexShrink: 0,
          }}
        />

        {/* Fit to screen */}
        <button
          onClick={handleFitView}
          title="Fit to screen"
          aria-label="Fit to screen"
          style={btnBase}
          onMouseEnter={btnHover}
          onMouseLeave={btnLeave}
        >
          <Maximize2 size={14} strokeWidth={2} />
        </button>
      </div>
  );
});
