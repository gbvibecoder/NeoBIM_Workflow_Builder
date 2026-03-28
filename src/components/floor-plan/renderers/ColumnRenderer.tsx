"use client";

import React from "react";
import { Group, Rect, Circle, Line, Text } from "react-konva";
import type { Column } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import { worldToScreen } from "@/lib/floor-plan/geometry";
import { lw } from "@/lib/floor-plan/line-weights";

interface ColumnRendererProps {
  columns: Column[];
  viewport: Viewport;
  selectedIds: string[];
}

export function ColumnRenderer({ columns, viewport, selectedIds }: ColumnRendererProps) {
  return (
    <>
      {columns.map((col) => (
        <ColumnItem
          key={col.id}
          column={col}
          viewport={viewport}
          isSelected={selectedIds.includes(col.id)}
        />
      ))}
    </>
  );
}

function ColumnItem({
  column,
  viewport,
  isSelected,
}: {
  column: Column;
  viewport: Viewport;
  isSelected: boolean;
}) {
  const { zoom } = viewport;
  const screen = worldToScreen(column.center, viewport);
  const strokeColor = isSelected ? "#3B82F6" : "#333333";
  const fillColor = isSelected ? "rgba(59, 130, 246, 0.15)" : "rgba(100, 100, 100, 0.2)";

  if (column.type === "circular") {
    const r = ((column.diameter_mm ?? 300) / 2) * zoom;
    return (
      <Group x={screen.x} y={screen.y}>
        <Circle
          radius={r}
          stroke={strokeColor}
          strokeWidth={isSelected ? 2 : lw("col", zoom)}
          fill={fillColor}
        />
        {/* Cross pattern */}
        <Line points={[-r * 0.7, -r * 0.7, r * 0.7, r * 0.7]} stroke={strokeColor} strokeWidth={lw("furn-detail", zoom)} opacity={0.4} />
        <Line points={[r * 0.7, -r * 0.7, -r * 0.7, r * 0.7]} stroke={strokeColor} strokeWidth={lw("furn-detail", zoom)} opacity={0.4} />
        {/* Grid ref label */}
        {column.grid_ref && zoom > 0.03 && (
          <Text
            x={-r - 10}
            y={-r - 14}
            text={column.grid_ref}
            fontSize={Math.max(7, Math.min(14, 90 * zoom))}
            fill="#666"
            fontStyle="bold"
          />
        )}
      </Group>
    );
  }

  // Rectangular column
  const w = (column.width_mm ?? 300) * zoom;
  const d = (column.depth_mm ?? 300) * zoom;
  const rotDeg = -(column.rotation_deg ?? 0);

  return (
    <Group x={screen.x} y={screen.y} rotation={rotDeg}>
      <Rect
        x={-w / 2}
        y={-d / 2}
        width={w}
        height={d}
        stroke={strokeColor}
        strokeWidth={isSelected ? 2 : lw("col", zoom)}
        fill={fillColor}
      />
      {/* X pattern */}
      <Line points={[-w / 2, -d / 2, w / 2, d / 2]} stroke={strokeColor} strokeWidth={lw("furn-detail", zoom)} opacity={0.4} />
      <Line points={[w / 2, -d / 2, -w / 2, d / 2]} stroke={strokeColor} strokeWidth={lw("furn-detail", zoom)} opacity={0.4} />
      {/* Grid ref label */}
      {column.grid_ref && zoom > 0.03 && (
        <Text
          x={-w / 2 - 10}
          y={-d / 2 - 14}
          text={column.grid_ref}
          fontSize={Math.max(7, Math.min(14, 90 * zoom))}
          fill="#666"
          fontStyle="bold"
        />
      )}
    </Group>
  );
}
