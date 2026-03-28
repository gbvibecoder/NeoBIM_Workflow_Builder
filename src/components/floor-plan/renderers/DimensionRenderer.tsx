"use client";

import React, { useMemo } from "react";
import { Line as KLine, Text, Group } from "react-konva";
import type { Room, Wall, Door, CadWindow } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import {
  worldToScreen,
  worldToScreenDistance,
  polygonBounds,
  floorBounds,
  wallLength,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
} from "@/lib/floor-plan/geometry";
import { formatDimension } from "@/lib/floor-plan/unit-conversion";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";

interface DimensionRendererProps {
  rooms: Room[];
  walls: Wall[];
  doors?: Door[];
  windows?: CadWindow[];
  viewport: Viewport;
  displayUnit: DisplayUnit;
  showChainDimensions?: boolean;
  showOpeningDimensions?: boolean;
}

interface DimLine {
  extStart1: { x: number; y: number };
  extEnd1: { x: number; y: number };
  extStart2: { x: number; y: number };
  extEnd2: { x: number; y: number };
  dimStart: { x: number; y: number };
  dimEnd: { x: number; y: number };
  textPos: { x: number; y: number };
  textRotation: number;
  label: string;
  isOverall?: boolean;
  isOpening?: boolean;
}

const EXT_GAP = 50;      // mm - gap between measured point and extension line
const EXT_OVERSHOOT = 100; // mm - extension line past dimension line
const TICK_PX = 3;        // px - tick mark half-size (reduced from 4)

export function DimensionRenderer({
  rooms,
  walls,
  doors = [],
  windows = [],
  viewport,
  displayUnit,
  showChainDimensions = true,
  showOpeningDimensions = true,
}: DimensionRendererProps) {
  // Zoom-based LOD for dimensions
  const zoom = viewport.zoom;
  const showRoomDims = zoom > 0.04;      // hide room dims when very zoomed out
  const showOpenings = zoom > 0.08;       // opening dims need more zoom
  const showChain = zoom > 0.03;          // chain dims visible earlier

  // ======== ROOM INTERNAL DIMENSIONS ========
  const roomDims = useMemo(() => {
    if (!showRoomDims) return [];
    const dims: DimLine[] = [];
    const OFFSET = 800; // mm from room boundary

    for (const room of rooms) {
      const bounds = polygonBounds(room.boundary.points);
      const roomW = bounds.width;
      const roomH = bounds.height;

      // Skip if too small on screen to show dimensions
      if (worldToScreenDistance(roomW, zoom) < 55) continue;

      // Horizontal dimension (below room)
      dims.push(createLinearDim(
        { x: bounds.min.x, y: bounds.min.y },
        { x: bounds.max.x, y: bounds.min.y },
        -OFFSET, "horizontal", roomW, viewport, displayUnit
      ));

      // Vertical dimension (left of room) — only if tall enough
      if (worldToScreenDistance(roomH, zoom) >= 55) {
        dims.push(createLinearDim(
          { x: bounds.min.x, y: bounds.min.y },
          { x: bounds.min.x, y: bounds.max.y },
          -OFFSET, "vertical", roomH, viewport, displayUnit
        ));
      }
    }
    return dims;
  }, [rooms, viewport, displayUnit, zoom, showRoomDims]);

  // ======== CHAIN DIMENSIONS (along exterior boundary) ========
  const chainDims = useMemo(() => {
    if (!showChainDimensions || !showChain) return [];
    const dims: DimLine[] = [];
    const bounds = floorBounds(walls, rooms);
    if (bounds.width === 0) return dims;

    const CHAIN_OFFSET = 1600; // mm from outer boundary (increased from 1400)
    const OVERALL_OFFSET = 2600; // increased from 2200 for more clearance

    // Collect all unique X positions of vertical wall faces
    const xPositions = new Set<number>();
    const yPositions = new Set<number>();

    for (const wall of walls) {
      const halfT = wall.thickness_mm / 2;
      const s = wall.centerline.start;
      const e = wall.centerline.end;

      if (Math.abs(s.x - e.x) < 10) {
        xPositions.add(Math.round(s.x - halfT));
        xPositions.add(Math.round(s.x + halfT));
      }
      if (Math.abs(s.y - e.y) < 10) {
        yPositions.add(Math.round(s.y - halfT));
        yPositions.add(Math.round(s.y + halfT));
      }
    }

    const sortedX = [...xPositions].sort((a, b) => a - b);
    const sortedY = [...yPositions].sort((a, b) => a - b);

    // Filter positions that are too close (< 300mm apart — skip tiny wall face offsets)
    const filteredX = filterClosePositions(sortedX, 300);
    const filteredY = filterClosePositions(sortedY, 300);

    // Bottom chain dimensions
    const chainY = bounds.min.y - CHAIN_OFFSET;
    for (let i = 0; i < filteredX.length - 1; i++) {
      const segWidth = filteredX[i + 1] - filteredX[i];
      if (segWidth < 400) continue; // skip segments too small to label
      if (worldToScreenDistance(segWidth, zoom) < 35) continue; // skip if screen-space too small
      dims.push(createLinearDim(
        { x: filteredX[i], y: chainY + EXT_GAP },
        { x: filteredX[i + 1], y: chainY + EXT_GAP },
        0, "horizontal", segWidth, viewport, displayUnit
      ));
    }

    // Bottom overall
    if (filteredX.length >= 2) {
      const totalW = filteredX[filteredX.length - 1] - filteredX[0];
      const overall = createLinearDim(
        { x: filteredX[0], y: bounds.min.y - OVERALL_OFFSET + EXT_GAP },
        { x: filteredX[filteredX.length - 1], y: bounds.min.y - OVERALL_OFFSET + EXT_GAP },
        0, "horizontal", totalW, viewport, displayUnit
      );
      overall.isOverall = true;
      dims.push(overall);
    }

    // Left chain dimensions
    const chainX = bounds.min.x - CHAIN_OFFSET;
    for (let i = 0; i < filteredY.length - 1; i++) {
      const segHeight = filteredY[i + 1] - filteredY[i];
      if (segHeight < 400) continue;
      if (worldToScreenDistance(segHeight, zoom) < 35) continue;
      dims.push(createLinearDim(
        { x: chainX + EXT_GAP, y: filteredY[i] },
        { x: chainX + EXT_GAP, y: filteredY[i + 1] },
        0, "vertical", segHeight, viewport, displayUnit
      ));
    }

    // Left overall
    if (filteredY.length >= 2) {
      const totalH = filteredY[filteredY.length - 1] - filteredY[0];
      const overall = createLinearDim(
        { x: bounds.min.x - OVERALL_OFFSET + EXT_GAP, y: filteredY[0] },
        { x: bounds.min.x - OVERALL_OFFSET + EXT_GAP, y: filteredY[filteredY.length - 1] },
        0, "vertical", totalH, viewport, displayUnit
      );
      overall.isOverall = true;
      dims.push(overall);
    }

    return dims;
  }, [showChainDimensions, showChain, walls, rooms, viewport, displayUnit, zoom]);

  // ======== OPENING DIMENSIONS ========
  const openingDims = useMemo(() => {
    if (!showOpeningDimensions || !showOpenings) return [];
    const dims: DimLine[] = [];
    const minScreenPx = 35; // increased threshold

    for (const door of doors) {
      const wall = walls.find((w) => w.id === door.wall_id);
      if (!wall) continue;
      if (worldToScreenDistance(door.width_mm, zoom) < minScreenPx) continue;

      const dir = lineDirection(wall.centerline);
      const doorStart = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm));
      const doorEnd = addPoints(doorStart, scalePoint(dir, door.width_mm));
      const norm = perpendicularLeft(dir);

      const offset = wall.thickness_mm * 0.8;
      const p1 = addPoints(doorStart, scalePoint(norm, offset));
      const p2 = addPoints(doorEnd, scalePoint(norm, offset));
      const p1s = worldToScreen(p1, viewport);
      const p2s = worldToScreen(p2, viewport);
      const isHoriz = Math.abs(p1s.y - p2s.y) < Math.abs(p1s.x - p2s.x);

      const dim: DimLine = {
        extStart1: p1s, extEnd1: p1s,
        extStart2: p2s, extEnd2: p2s,
        dimStart: p1s, dimEnd: p2s,
        textPos: { x: (p1s.x + p2s.x) / 2, y: (p1s.y + p2s.y) / 2 - 8 },
        textRotation: isHoriz ? 0 : -90,
        label: formatDimension(door.width_mm, displayUnit),
        isOpening: true,
      };
      dims.push(dim);
    }

    for (const win of windows) {
      const wall = walls.find((w) => w.id === win.wall_id);
      if (!wall) continue;
      if (worldToScreenDistance(win.width_mm, zoom) < minScreenPx) continue;

      const dir = lineDirection(wall.centerline);
      const winStart = addPoints(wall.centerline.start, scalePoint(dir, win.position_along_wall_mm));
      const winEnd = addPoints(winStart, scalePoint(dir, win.width_mm));
      const norm = perpendicularLeft(dir);

      const offset = -wall.thickness_mm * 0.8;
      const p1 = addPoints(winStart, scalePoint(norm, offset));
      const p2 = addPoints(winEnd, scalePoint(norm, offset));
      const p1s = worldToScreen(p1, viewport);
      const p2s = worldToScreen(p2, viewport);
      const isHoriz = Math.abs(p1s.y - p2s.y) < Math.abs(p1s.x - p2s.x);

      const dim: DimLine = {
        extStart1: p1s, extEnd1: p1s,
        extStart2: p2s, extEnd2: p2s,
        dimStart: p1s, dimEnd: p2s,
        textPos: { x: (p1s.x + p2s.x) / 2, y: (p1s.y + p2s.y) / 2 - 8 },
        textRotation: isHoriz ? 0 : -90,
        label: formatDimension(win.width_mm, displayUnit),
        isOpening: true,
      };
      dims.push(dim);
    }

    return dims;
  }, [showOpeningDimensions, showOpenings, doors, windows, walls, viewport, displayUnit, zoom]);

  const allDims = [...roomDims, ...chainDims, ...openingDims];
  const dimColor = "#777777";       // lighter than room labels
  const overallColor = "#444444";
  const openingColor = "#3388CC";
  // Dimension font is deliberately smaller than room name font (hierarchy)
  const fontSize = Math.max(7, Math.min(9.5, zoom * 95));

  return (
    <>
      {allDims.map((dim, i) => {
        const color = dim.isOverall ? overallColor
          : dim.isOpening ? openingColor
          : dimColor;
        const weight = dim.isOverall ? 0.7 : 0.4;
        const textSize = dim.isOverall ? fontSize + 1 : fontSize;

        return (
          <Group key={`dim-${i}`}>
            {/* Extension line 1 */}
            <KLine
              points={[dim.extStart1.x, dim.extStart1.y, dim.extEnd1.x, dim.extEnd1.y]}
              stroke={color}
              strokeWidth={0.3}
              listening={false}
            />
            {/* Extension line 2 */}
            <KLine
              points={[dim.extStart2.x, dim.extStart2.y, dim.extEnd2.x, dim.extEnd2.y]}
              stroke={color}
              strokeWidth={0.3}
              listening={false}
            />
            {/* Dimension line */}
            <KLine
              points={[dim.dimStart.x, dim.dimStart.y, dim.dimEnd.x, dim.dimEnd.y]}
              stroke={color}
              strokeWidth={weight}
              listening={false}
            />
            {/* Tick at start */}
            <KLine
              points={[
                dim.dimStart.x - TICK_PX, dim.dimStart.y + TICK_PX,
                dim.dimStart.x + TICK_PX, dim.dimStart.y - TICK_PX,
              ]}
              stroke={color}
              strokeWidth={0.8}
              listening={false}
            />
            {/* Tick at end */}
            <KLine
              points={[
                dim.dimEnd.x - TICK_PX, dim.dimEnd.y + TICK_PX,
                dim.dimEnd.x + TICK_PX, dim.dimEnd.y - TICK_PX,
              ]}
              stroke={color}
              strokeWidth={0.8}
              listening={false}
            />
            {/* Text */}
            <Text
              x={dim.textPos.x}
              y={dim.textPos.y}
              text={dim.label}
              fontSize={textSize}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle={dim.isOverall ? "bold" : "normal"}
              fill={color}
              align="center"
              rotation={dim.textRotation}
              offsetX={dim.textRotation === 0 ? 28 : 0}
              offsetY={dim.textRotation !== 0 ? 28 : 0}
              width={56}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}

// ============================================================
// HELPERS
// ============================================================

interface Pt { x: number; y: number }

function createLinearDim(
  p1World: Pt, p2World: Pt,
  offset_mm: number,
  direction: "horizontal" | "vertical",
  value_mm: number,
  viewport: Viewport,
  displayUnit: DisplayUnit,
): DimLine {
  if (direction === "horizontal") {
    const y_w = p1World.y + offset_mm;
    const s = worldToScreen({ x: p1World.x, y: y_w }, viewport);
    const e = worldToScreen({ x: p2World.x, y: y_w }, viewport);
    const es1 = worldToScreen({ x: p1World.x, y: p1World.y - EXT_GAP }, viewport);
    const ee1 = worldToScreen({ x: p1World.x, y: y_w - EXT_OVERSHOOT }, viewport);
    const es2 = worldToScreen({ x: p2World.x, y: p2World.y - EXT_GAP }, viewport);
    const ee2 = worldToScreen({ x: p2World.x, y: y_w - EXT_OVERSHOOT }, viewport);

    return {
      extStart1: es1, extEnd1: ee1,
      extStart2: es2, extEnd2: ee2,
      dimStart: s, dimEnd: e,
      textPos: { x: (s.x + e.x) / 2, y: s.y - 11 },
      textRotation: 0,
      label: formatDimension(value_mm, displayUnit),
    };
  } else {
    const x_w = p1World.x + offset_mm;
    const s = worldToScreen({ x: x_w, y: p1World.y }, viewport);
    const e = worldToScreen({ x: x_w, y: p2World.y }, viewport);
    const es1 = worldToScreen({ x: p1World.x - EXT_GAP, y: p1World.y }, viewport);
    const ee1 = worldToScreen({ x: x_w - EXT_OVERSHOOT, y: p1World.y }, viewport);
    const es2 = worldToScreen({ x: p2World.x - EXT_GAP, y: p2World.y }, viewport);
    const ee2 = worldToScreen({ x: x_w - EXT_OVERSHOOT, y: p2World.y }, viewport);

    return {
      extStart1: es1, extEnd1: ee1,
      extStart2: es2, extEnd2: ee2,
      dimStart: s, dimEnd: e,
      textPos: { x: s.x - 11, y: (s.y + e.y) / 2 },
      textRotation: -90,
      label: formatDimension(value_mm, displayUnit),
    };
  }
}

function filterClosePositions(sorted: number[], minGap: number): number[] {
  if (sorted.length <= 1) return sorted;
  const result = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - result[result.length - 1] >= minGap) {
      result.push(sorted[i]);
    }
  }
  return result;
}
