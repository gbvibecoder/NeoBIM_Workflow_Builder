"use client";

import React, { useMemo } from "react";
import { Line, Text } from "react-konva";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import { worldToScreen, worldToScreenDistance } from "@/features/floor-plan/lib/geometry";
import type { ViewMode } from "@/types/floor-plan-cad";
import { lw } from "@/features/floor-plan/lib/line-weights";

interface GridRendererProps {
  viewport: Viewport;
  gridSize_mm: number;
  viewMode: ViewMode;
}

function GridRendererBase({ viewport, gridSize_mm, viewMode }: GridRendererProps) {
  const gridLines = useMemo(() => {
    const lines: Array<{ points: number[]; major: boolean }> = [];
    const labels: Array<{ x: number; y: number; text: string }> = [];

    // Determine visible world extent
    const zoom = viewport.zoom || 1;
    const topLeft = {
      x: viewport.x - viewport.canvasWidth / 2 / zoom,
      y: viewport.y + viewport.canvasHeight / 2 / zoom,
    };
    const bottomRight = {
      x: viewport.x + viewport.canvasWidth / 2 / zoom,
      y: viewport.y - viewport.canvasHeight / 2 / zoom,
    };

    // Grid spacing: minor = gridSize_mm, major = gridSize_mm * 10
    const minor = gridSize_mm;
    const major = gridSize_mm * 10;

    // Only show minor grid when zoomed in enough
    const showMinor = worldToScreenDistance(minor, viewport.zoom) > 8;
    const showMajor = worldToScreenDistance(major, viewport.zoom) > 15;

    if (!showMajor) return { lines: [], labels: [] };

    // Start from rounded world coordinates
    const startX = Math.floor(topLeft.x / major) * major;
    const endX = Math.ceil(bottomRight.x / major) * major;
    const startY = Math.floor(bottomRight.y / major) * major;
    const endY = Math.ceil(topLeft.y / major) * major;

    // Major grid lines
    for (let x = startX; x <= endX; x += major) {
      const screenX = worldToScreen({ x, y: 0 }, viewport).x;
      lines.push({
        points: [screenX, 0, screenX, viewport.canvasHeight],
        major: true,
      });
      // Label
      labels.push({
        x: screenX + 3,
        y: 4,
        text: `${(x / 1000).toFixed(1)}m`,
      });
    }
    for (let y = startY; y <= endY; y += major) {
      const screenY = worldToScreen({ x: 0, y }, viewport).y;
      lines.push({
        points: [0, screenY, viewport.canvasWidth, screenY],
        major: true,
      });
      labels.push({
        x: 4,
        y: screenY + 3,
        text: `${(y / 1000).toFixed(1)}m`,
      });
    }

    // Minor grid lines
    if (showMinor) {
      const minorStartX = Math.floor(topLeft.x / minor) * minor;
      const minorEndX = Math.ceil(bottomRight.x / minor) * minor;
      const minorStartY = Math.floor(bottomRight.y / minor) * minor;
      const minorEndY = Math.ceil(topLeft.y / minor) * minor;

      for (let x = minorStartX; x <= minorEndX; x += minor) {
        if (major > 0 && Math.abs(x % major) < 1) continue;
        const screenX = worldToScreen({ x, y: 0 }, viewport).x;
        lines.push({
          points: [screenX, 0, screenX, viewport.canvasHeight],
          major: false,
        });
      }
      for (let y = minorStartY; y <= minorEndY; y += minor) {
        if (major > 0 && Math.abs(y % major) < 1) continue;
        const screenY = worldToScreen({ x: 0, y }, viewport).y;
        lines.push({
          points: [0, screenY, viewport.canvasWidth, screenY],
          major: false,
        });
      }
    }

    return { lines, labels };
  }, [viewport.x, viewport.y, viewport.zoom, viewport.canvasWidth, viewport.canvasHeight, gridSize_mm]);

  const majorColor = viewMode === "cad" ? "#E0E0E0" : "#ECECEC";
  const minorColor = viewMode === "cad" ? "#F0F0F0" : "#F5F5F5";

  return (
    <>
      {gridLines.lines.map((line, i) => (
        <Line
          key={`grid-${i}`}
          points={line.points}
          stroke={line.major ? majorColor : minorColor}
          strokeWidth={line.major ? lw("grid-major", viewport.zoom) : lw("grid-minor", viewport.zoom)}
          listening={false}
        />
      ))}
      {gridLines.labels.map((label, i) => (
        <Text
          key={`grid-label-${i}`}
          x={label.x}
          y={label.y}
          text={label.text}
          fontSize={9}
          fontFamily="DM Sans, system-ui, sans-serif"
          fill="#BBBBBB"
          listening={false}
        />
      ))}
    </>
  );
}

export const GridRenderer = React.memo(GridRendererBase);
