"use client";

import React from "react";
import { Line as KLine, Text, Group, Circle, Rect } from "react-konva";
import type { Room, ViewMode } from "@/types/floor-plan-cad";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import { worldToScreen, worldToScreenDistance, polygonBounds } from "@/features/floor-plan/lib/geometry";
import { formatArea, formatDimension } from "@/features/floor-plan/lib/unit-conversion";
import type { DisplayUnit } from "@/features/floor-plan/lib/unit-conversion";

interface RoomRendererProps {
  rooms: Room[];
  viewport: Viewport;
  viewMode: ViewMode;
  renderMode: "fill" | "labels";
  displayUnit?: DisplayUnit;
}

// Abbreviations for small rooms
const ABBREV: Record<string, string> = {
  "Living Room": "LR", "Dining Room": "DR", Kitchen: "Kit",
  Bedroom: "BR", Bathroom: "Bath", Hallway: "Hall",
  Balcony: "Bal", Corridor: "Corr", "Store Room": "Store",
  Utility: "Util", Staircase: "Stair",
};

function abbreviate(name: string): string {
  if (ABBREV[name]) return ABBREV[name];
  for (const [full, abbr] of Object.entries(ABBREV)) {
    if (name.startsWith(full)) {
      const suffix = name.slice(full.length).trim();
      return suffix ? `${abbr}${suffix}` : abbr;
    }
  }
  return name.length > 5 ? name.slice(0, 4) : name;
}

function RoomRendererBase({
  rooms, viewport, viewMode, renderMode, displayUnit = "m",
}: RoomRendererProps) {
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

  // ── Labels mode: professional room tags ──
  // Precompute visible room numbers so labels stay sequential across LOD-hidden
  // small rooms (bathrooms, wardrobes). Without this, `roomIdx + 1` skips
  // numbers whenever a smaller room is filtered by minDim < 20.
  const visibleRoomNumber = new Map<string, number>();
  {
    let nextNum = 1;
    for (const room of rooms) {
      const rb = polygonBounds(room.boundary.points);
      const sw = worldToScreenDistance(rb.width, viewport.zoom);
      const sh = worldToScreenDistance(rb.height, viewport.zoom);
      if (Math.min(sw, sh) >= 20) {
        visibleRoomNumber.set(room.id, nextNum++);
      }
    }
  }

  return (
    <>
      {rooms.map((room) => {
        const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
        const labelScreen = worldToScreen(room.label_position, viewport);

        const rb = polygonBounds(room.boundary.points);
        const roomW_mm = rb.width;
        const roomH_mm = rb.height;

        const screenW = worldToScreenDistance(roomW_mm, viewport.zoom);
        const screenH = worldToScreenDistance(roomH_mm, viewport.zoom);
        const minDim = Math.min(screenW, screenH);

        // LOD levels
        let lod: "full" | "compact" | "name" | "abbrev" | "hidden";
        if (minDim < 20) lod = "hidden";
        else if (minDim < 40) lod = "abbrev";
        else if (minDim < 65) lod = "name";
        else if (minDim < 100) lod = "compact";
        else lod = "full";

        if (lod === "hidden") return null;

        const maxNameFont = Math.min(14, screenW * 0.12, screenH * 0.18);
        const baseFontSize = Math.max(8, Math.min(maxNameFont, viewport.zoom * 140));
        const dimFontSize = baseFontSize * 0.78;
        const areaFontSize = baseFontSize * 0.72;
        const textW = Math.max(40, screenW - 10);

        const isCAD = viewMode === "cad";
        const labelColor = isCAD ? "#333333" : colors.label;
        const dimColor = isCAD ? "#666666" : colors.label;
        const areaColor = isCAD ? "#444444" : colors.label;
        const displayName = lod === "abbrev" ? abbreviate(room.name) : room.name;

        // Room number circle radius
        const circleR = Math.max(6, baseFontSize * 0.65);
        const numFontSize = circleR * 1.2;
        const roomNum = String(visibleRoomNumber.get(room.id) ?? "?");

        // Show circle only when there's room for it
        const showCircle = lod === "full" || lod === "compact";

        // Vertical layout heights
        const circleBlock = showCircle ? circleR * 2 + 4 : 0;
        const nameBlock = baseFontSize + 2;
        const dimBlock = lod === "full" ? dimFontSize + 2 : 0;
        const areaBlock = (lod === "full" || lod === "compact") ? areaFontSize + 2 : 0;
        const totalH = circleBlock + nameBlock + dimBlock + areaBlock;
        const startY = labelScreen.y - totalH / 2;

        // Background rect
        const bgPadH = 6;
        const bgPadV = 4;
        const bgW = Math.min(textW, Math.max(50, displayName.length * baseFontSize * 0.55 + 20));

        return (
          <Group key={`room-label-${room.id}`}>
            {/* Semi-transparent background for readability */}
            {(lod === "full" || lod === "compact") && (
              <Rect
                x={labelScreen.x - bgW / 2}
                y={startY - bgPadV}
                width={bgW}
                height={totalH + bgPadV * 2}
                fill="rgba(255,255,255,0.7)"
                cornerRadius={3}
                listening={false}
              />
            )}

            {/* Room number circle */}
            {showCircle && (
              <>
                <Circle
                  x={labelScreen.x}
                  y={startY + circleR}
                  radius={circleR}
                  fill={isCAD ? "#333333" : colors.label}
                  listening={false}
                />
                <Text
                  x={labelScreen.x}
                  y={startY + circleR - numFontSize / 2}
                  text={roomNum}
                  fontSize={numFontSize}
                  fontFamily="DM Sans, system-ui, sans-serif"
                  fontStyle="bold"
                  fill="#FFFFFF"
                  align="center"
                  width={circleR * 2}
                  offsetX={circleR}
                  listening={false}
                />
              </>
            )}

            {/* Room name */}
            <Text
              x={labelScreen.x}
              y={startY + circleBlock}
              text={displayName}
              fontSize={baseFontSize}
              fontFamily="DM Sans, system-ui, sans-serif"
              fontStyle="600"
              fill={labelColor}
              align="center"
              width={textW}
              offsetX={textW / 2}
              listening={false}
            />

            {/* Dimensions (full LOD only) */}
            {lod === "full" && (
              <Text
                x={labelScreen.x}
                y={startY + circleBlock + nameBlock}
                text={`${formatDimension(roomW_mm, displayUnit)} × ${formatDimension(roomH_mm, displayUnit)}`}
                fontSize={dimFontSize}
                fontFamily="DM Sans, system-ui, sans-serif"
                fontStyle="normal"
                fill={dimColor}
                align="center"
                width={textW}
                offsetX={textW / 2}
                listening={false}
              />
            )}

            {/* Area */}
            {(lod === "full" || lod === "compact") && (
              <Text
                x={labelScreen.x}
                y={startY + circleBlock + nameBlock + dimBlock}
                text={formatArea(room.area_sqm, displayUnit)}
                fontSize={areaFontSize}
                fontFamily="DM Sans, system-ui, sans-serif"
                fontStyle="bold"
                fill={areaColor}
                align="center"
                width={textW}
                offsetX={textW / 2}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

export const RoomRenderer = React.memo(RoomRendererBase);
