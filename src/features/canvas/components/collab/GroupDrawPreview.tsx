"use client";

/**
 * Z.CANVAS.SCHEMA Phase 10 — Live rectangle preview during group drag-create.
 */

import { memo } from "react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import type { DrawingGroupState } from "@/features/canvas/stores/canvas-groups-store";

interface GroupDrawPreviewProps {
  drawing: DrawingGroupState;
}

export const GroupDrawPreview = memo(function GroupDrawPreview({ drawing }: GroupDrawPreviewProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();
  const x = Math.min(drawing.startX, drawing.currentX);
  const y = Math.min(drawing.startY, drawing.currentY);
  const w = Math.abs(drawing.currentX - drawing.startX);
  const h = Math.abs(drawing.currentY - drawing.startY);

  if (w < 10 && h < 10) return null;

  return (
          <div
        style={{
          position: "absolute",
          left: x, top: y,
          width: w, height: h,
          border: `2px dashed ${tk.groupPurple}`,
          background: tk.groupPurpleBg,
          borderRadius: 14,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
  );
});
