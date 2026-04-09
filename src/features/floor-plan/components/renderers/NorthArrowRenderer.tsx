"use client";

import React from "react";
import { Group, Line as KLine, Text, Circle } from "react-konva";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import type { Viewport } from "@/features/floor-plan/lib/geometry";

interface NorthArrowRendererProps {
  viewport: Viewport;
  northAngleDeg: number;
}

/**
 * Screen-fixed north arrow — top-right of canvas.
 * Click to rotate in 45° increments.
 */
export const NorthArrowRenderer = React.memo(function NorthArrowRenderer({ viewport, northAngleDeg }: NorthArrowRendererProps) {
  // Position: top-right, offset from edge
  const cx = viewport.canvasWidth - 40;
  const cy = 52;
  const size = 18; // arrow half-height

  const handleClick = () => {
    try {
      const next = (northAngleDeg + 45) % 360;
      useFloorPlanStore.getState().setNorthAngle(next);
    } catch { /* non-critical */ }
  };

  return (
    <Group
      x={cx}
      y={cy}
      rotation={northAngleDeg}
      listening={true}
      onClick={handleClick}
      onTap={handleClick}
    >
      {/* Background circle — clickable hit area */}
      <Circle
        x={0}
        y={0}
        radius={size + 8}
        fill="rgba(255,255,255,0.85)"
        stroke="#CCCCCC"
        strokeWidth={0.5}
      />

      {/* Arrow body (filled triangle pointing up) */}
      <KLine
        points={[
          0, -size,       // tip
          -7, size * 0.4, // bottom-left
          0, size * 0.15, // notch
          7, size * 0.4,  // bottom-right
        ]}
        closed
        fill="#1A1A1A"
        stroke="#1A1A1A"
        strokeWidth={1}
      />

      {/* Bottom half (outline only) */}
      <KLine
        points={[
          0, size * 0.15, // notch
          -7, size * 0.4, // bottom-left
          0, size,         // bottom tip
          7, size * 0.4,  // bottom-right
        ]}
        closed
        fill="#FFFFFF"
        stroke="#1A1A1A"
        strokeWidth={1}
      />

      {/* "N" label */}
      <Text
        x={0}
        y={-size - 12}
        text="N"
        fontSize={11}
        fontFamily="Inter, system-ui, sans-serif"
        fontStyle="bold"
        fill="#1A1A1A"
        align="center"
        width={20}
        offsetX={10}
      />

      {/* Angle badge */}
      {northAngleDeg !== 0 && (
        <Text
          x={0}
          y={size + 12}
          text={`${northAngleDeg}°`}
          fontSize={9}
          fontFamily="Inter, system-ui, sans-serif"
          fill="#666666"
          align="center"
          width={30}
          offsetX={15}
          rotation={-northAngleDeg}
        />
      )}
    </Group>
  );
});
