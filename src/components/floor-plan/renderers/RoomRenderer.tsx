"use client";

import React from "react";
import { Line as KLine, Text, Group } from "react-konva";
import type { Room, ViewMode } from "@/types/floor-plan-cad";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import { worldToScreen, worldToScreenDistance } from "@/lib/floor-plan/geometry";
import { formatArea, formatDimension } from "@/lib/floor-plan/unit-conversion";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";

interface RoomRendererProps {
  rooms: Room[];
  viewport: Viewport;
  viewMode: ViewMode;
  renderMode: "fill" | "labels";
  displayUnit?: DisplayUnit;
}

// Abbreviations for small rooms
const NAME_ABBREV: Record<string, string> = {
  "Living Room": "LR",
  "Dining Room": "DR",
  "Kitchen": "Kit",
  "Bedroom": "BR",
  "Bathroom": "Bath",
  "Hallway": "Hall",
  "Balcony": "Bal",
  "Corridor": "Corr",
  "Store Room": "Store",
  "Utility": "Util",
  "Staircase": "Stair",
};

function abbreviate(name: string): string {
  // Check exact match first
  if (NAME_ABBREV[name]) return NAME_ABBREV[name];
  // Check prefix match (e.g., "Bedroom 1" → "BR1")
  for (const [full, abbr] of Object.entries(NAME_ABBREV)) {
    if (name.startsWith(full)) {
      const suffix = name.slice(full.length).trim();
      return suffix ? `${abbr}${suffix}` : abbr;
    }
  }
  // Fallback: first 4 chars
  return name.length > 5 ? name.slice(0, 4) : name;
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

        // Screen-space dimensions of the room
        const screenW = worldToScreenDistance(roomWidth_mm, viewport.zoom);
        const screenH = worldToScreenDistance(roomHeight_mm, viewport.zoom);
        const minScreenDim = Math.min(screenW, screenH);

        // Determine level of detail based on room's screen size
        // LOD: "full" (name+dims+area), "compact" (name+area), "name" (name only), "abbrev" (abbreviated), "hidden"
        let lod: "full" | "compact" | "name" | "abbrev" | "hidden";
        if (minScreenDim < 20) lod = "hidden";
        else if (minScreenDim < 40) lod = "abbrev";
        else if (minScreenDim < 65) lod = "name";
        else if (minScreenDim < 100) lod = "compact";
        else lod = "full";

        if (lod === "hidden") return null;

        // Font sizes adapt to room screen size
        const maxNameFont = Math.min(14, screenW * 0.12, screenH * 0.18);
        const baseFontSize = Math.max(8, Math.min(maxNameFont, viewport.zoom * 140));
        const dimFontSize = baseFontSize * 0.78;
        const areaFontSize = baseFontSize * 0.72;

        // Constrain text width to room screen width (with padding)
        const textWidth = Math.max(40, screenW - 10);

        const labelColor = viewMode === "cad" ? "#333333" : colors.label;

        const displayName = lod === "abbrev" ? abbreviate(room.name) : room.name;

        // Vertical layout — stack lines from centroid
        const lines: Array<{ text: string; size: number; style: string; color: string; dy: number }> = [];

        // Line 1: Room name (always shown unless hidden)
        lines.push({
          text: displayName,
          size: baseFontSize,
          style: "600",
          color: labelColor,
          dy: 0,
        });

        if (lod === "full") {
          // Line 2: Dimensions
          lines.push({
            text: `${formatDimension(roomWidth_mm, displayUnit)} × ${formatDimension(roomHeight_mm, displayUnit)}`,
            size: dimFontSize,
            style: "normal",
            color: viewMode === "cad" ? "#666666" : colors.label,
            dy: baseFontSize + 3,
          });
          // Line 3: Area
          lines.push({
            text: formatArea(room.area_sqm, displayUnit),
            size: areaFontSize,
            style: "bold",
            color: viewMode === "cad" ? "#444444" : colors.label,
            dy: baseFontSize + dimFontSize + 7,
          });
        } else if (lod === "compact") {
          // Line 2: Area only
          lines.push({
            text: formatArea(room.area_sqm, displayUnit),
            size: areaFontSize,
            style: "bold",
            color: viewMode === "cad" ? "#444444" : colors.label,
            dy: baseFontSize + 3,
          });
        }

        // Total text block height
        const totalHeight = lines.length > 0 ? lines[lines.length - 1].dy + lines[lines.length - 1].size : 0;
        const startY = labelScreen.y - totalHeight / 2;

        return (
          <Group key={`room-label-${room.id}`}>
            {lines.map((line, idx) => (
              <Text
                key={idx}
                x={labelScreen.x}
                y={startY + line.dy}
                text={line.text}
                fontSize={line.size}
                fontFamily="Inter, system-ui, sans-serif"
                fontStyle={line.style}
                fill={line.color}
                align="center"
                width={textWidth}
                offsetX={textWidth / 2}
                listening={false}
              />
            ))}
          </Group>
        );
      })}
    </>
  );
}
