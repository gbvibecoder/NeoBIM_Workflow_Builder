"use client";

/**
 * Z.CANVAS.2B Phase 6 — Smart alignment guides SVG overlay.
 * Renders pink guide lines when a dragging node aligns with others.
 * Purely visual — no positioning logic (that lives in the onNodeDrag handler).
 */

import React, { memo } from "react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

export interface GuideLine {
  type: "vertical" | "horizontal";
  position: number; // x for vertical, y for horizontal
  from: number;     // start extent
  to: number;       // end extent
}

interface AlignmentGuidesProps {
  guides: GuideLine[];
}

export const AlignmentGuides = memo(function AlignmentGuides({ guides }: AlignmentGuidesProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();

  if (guides.length === 0) return null;

  return (
          <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 5,
          overflow: "visible",
        }}
      >
        {guides.map((g, i) => (
          <line
            key={i}
            x1={g.type === "vertical" ? g.position : g.from}
            y1={g.type === "vertical" ? g.from : g.position}
            x2={g.type === "vertical" ? g.position : g.to}
            y2={g.type === "vertical" ? g.to : g.position}
            stroke={tk.guideLine}
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.8}
          />
        ))}
      </svg>
  );
});
