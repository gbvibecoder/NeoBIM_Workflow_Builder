"use client";

/**
 * Z.CANVAS.TOOLS-RESTORE — Floating collab tools cluster.
 * Comment mode + Group mode toggles. Positioned bottom-left, above minimap.
 * Separated from CanvasControls (which is zoom-only).
 */

import { memo } from "react";
import { MessageSquare, Group } from "lucide-react";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import { useUIStore, selectCanvasMode, selectSetCanvasMode } from "@/shared/stores/ui-store";

export const CanvasTools = memo(function CanvasTools() {
  const tk = useCanvasToken();
  const canvasMode = useUIStore(selectCanvasMode);
  const setCanvasMode = useUIStore(selectSetCanvasMode);

  const isComment = canvasMode === "comment";
  const isGroup = canvasMode === "group";

  const btnBase: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    transition: "background 120ms ease, color 120ms ease",
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 112,
        left: 16,
        zIndex: 20,
        display: "flex",
        gap: 4,
        padding: 4,
        background: tk.surface1,
        border: `1px solid ${tk.line1}`,
        borderRadius: 10,
        boxShadow: tk.shadowSm,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Comment mode toggle */}
      <button
        onClick={() => setCanvasMode(isComment ? "select" : "comment")}
        title="Drop a sticky note"
        aria-label="Comment mode"
        style={{
          ...btnBase,
          background: isComment ? tk.catTransformSoft : "transparent",
          color: isComment ? tk.catTransform : tk.text2,
        }}
        onMouseEnter={(e) => {
          if (!isComment) e.currentTarget.style.background = tk.hoverBg;
        }}
        onMouseLeave={(e) => {
          if (!isComment) e.currentTarget.style.background = "transparent";
        }}
      >
        <MessageSquare size={16} strokeWidth={2} />
      </button>

      {/* Group mode toggle */}
      <button
        onClick={() => setCanvasMode(isGroup ? "select" : "group")}
        title="Frame nodes together"
        aria-label="Group mode"
        style={{
          ...btnBase,
          background: isGroup ? tk.catGenerateSoft : "transparent",
          color: isGroup ? tk.catGenerate : tk.text2,
        }}
        onMouseEnter={(e) => {
          if (!isGroup) e.currentTarget.style.background = tk.hoverBg;
        }}
        onMouseLeave={(e) => {
          if (!isGroup) e.currentTarget.style.background = "transparent";
        }}
      >
        <Group size={16} strokeWidth={2} />
      </button>
    </div>
  );
});
