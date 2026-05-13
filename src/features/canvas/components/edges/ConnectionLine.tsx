"use client";

/**
 * Z.CANVAS.2B Phase 5 — Smart Connect ghost preview line.
 * Custom connectionLineComponent for ReactFlow.
 * Shows blue for valid connections, red for invalid, dashed while dragging.
 */

import React from "react";
import type { ConnectionLineComponentProps } from "@xyflow/react";
import type { WorkflowNodeData } from "@/types/nodes";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromNode,
}: ConnectionLineComponentProps) {
  const tk = useCanvasToken();
  // Bezier control points for a smooth curve
  const dx = Math.abs(toX - fromX);
  const cpOffset = Math.min(dx * 0.5, 80);

  const path = `M ${fromX} ${fromY} C ${fromX + cpOffset} ${fromY}, ${toX - cpOffset} ${toY}, ${toX} ${toY}`;

  // We always show the ghost edge color (no target validation during drag).
  // Full validity checking would require toNode which isn't reliably available
  // during the connection drag. The final onConnect handler validates.
  const strokeColor = tk.ghostEdge;

  return (
    <g>
      {/* Glow halo */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={8}
        strokeOpacity={0.1}
        strokeLinecap="round"
      />
      {/* Main dashed line */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeDasharray="6 3"
        strokeLinecap="round"
        strokeOpacity={0.7}
      />
      {/* Target dot */}
      <circle
        cx={toX}
        cy={toY}
        r={4}
        fill={strokeColor}
        fillOpacity={0.3}
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeOpacity={0.6}
      />
    </g>
  );
}
