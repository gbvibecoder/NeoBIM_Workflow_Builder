"use client";

import React from "react";
import { Line as KLine, Text, Group } from "react-konva";
import type { Room, ViewMode } from "@/types/floor-plan-cad";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import { worldToScreen } from "@/lib/floor-plan/geometry";
import { formatArea, formatDimension } from "@/lib/floor-plan/unit-conversion";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";

interface RoomRendererProps {
  rooms: Room[];
  viewport: Viewport;
  viewMode: ViewMode;
  renderMode: "fill" | "labels";
  displayUnit?: DisplayUnit;
}

export function RoomRenderer({ rooms, viewport, viewMode, renderMode, displayUnit = "m" }: RoomRendererProps) {
  if (renderMode === "fill") {
    return (
      <>
        {rooms.map((room) => {
          const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
          const screenPoints = room.boundary.points.map((p) => worldToScreen(p, viewport));
          const flatPoints = screenPoints.flatMap((p) => [p.x, p.y]);

          return (
            <KLine
              key={`room-fill-${room.id}`}
              points={flatPoints}
              closed
              fill={colors.fill}
              opacity={room.fill_opacity ?? 0.4}
              stroke={colors.stroke}
              strokeWidth={1}
              listening={false}
            />
          );
        })}
      </>
    );
  }

  // Labels mode
  return (
    <>
      {rooms.map((room) => {
        const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
        const labelScreen = worldToScreen(room.label_position, viewport);

        // Compute room dimensions from boundary bounding box
        const xs = room.boundary.points.map((p) => p.x);
        const ys = room.boundary.points.map((p) => p.y);
        const roomWidth_mm = Math.max(...xs) - Math.min(...xs);
        const roomHeight_mm = Math.max(...ys) - Math.min(...ys);

        // Determine font sizes based on zoom level
        const baseFontSize = Math.max(10, Math.min(14, viewport.zoom * 140));
        const dimFontSize = baseFontSize * 0.8;
        const areaFontSize = baseFontSize * 0.75;

        const labelColor = viewMode === "cad" ? "#333333" : colors.label;

        return (
          <Group key={`room-label-${room.id}`}>
            {/* Room name */}
            <Text
              x={labelScreen.x}
              y={labelScreen.y - baseFontSize * 1.2}
              text={room.name}
              fontSize={baseFontSize}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle="600"
              fill={labelColor}
              align="center"
              listening={false}
              width={200}
              offsetX={100}
            />

            {/* Dimensions: W × H */}
            <Text
              x={labelScreen.x}
              y={labelScreen.y + 2}
              text={`${formatDimension(roomWidth_mm, displayUnit)} × ${formatDimension(roomHeight_mm, displayUnit)}`}
              fontSize={dimFontSize}
              fontFamily="Inter, system-ui, sans-serif"
              fill={viewMode === "cad" ? "#666666" : colors.label}
              align="center"
              width={200}
              offsetX={100}
              listening={false}
            />

            {/* Area */}
            <Text
              x={labelScreen.x}
              y={labelScreen.y + dimFontSize + 6}
              text={formatArea(room.area_sqm, displayUnit)}
              fontSize={areaFontSize}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle="bold"
              fill={viewMode === "cad" ? "#444444" : colors.label}
              align="center"
              width={200}
              offsetX={100}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
