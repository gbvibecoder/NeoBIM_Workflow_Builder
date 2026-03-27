"use client";

import React, { useMemo } from "react";
import { Line as KLine, Group } from "react-konva";
import type { CadWindow, Wall, ViewMode } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import {
  worldToScreen,
  worldToScreenDistance,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
} from "@/lib/floor-plan/geometry";

interface WindowRendererProps {
  windows: CadWindow[];
  walls: Wall[];
  viewport: Viewport;
  viewMode: ViewMode;
}

export function WindowRenderer({ windows, walls, viewport, viewMode }: WindowRendererProps) {
  const windowShapes = useMemo(() => {
    return windows.map((win) => {
      const wall = walls.find((w) => w.id === win.wall_id);
      if (!wall) return null;

      const wallDir = lineDirection(wall.centerline);
      const wallNorm = perpendicularLeft(wallDir);
      const halfThick = wall.thickness_mm / 2;

      // Window position along wall
      const winStart = addPoints(
        wall.centerline.start,
        scalePoint(wallDir, win.position_along_wall_mm)
      );
      const winEnd = addPoints(winStart, scalePoint(wallDir, win.width_mm));
      const winMid = addPoints(winStart, scalePoint(wallDir, win.width_mm / 2));

      // Three parallel lines (outer face, glass, inner face)
      const outerStart = addPoints(winStart, scalePoint(wallNorm, halfThick));
      const outerEnd = addPoints(winEnd, scalePoint(wallNorm, halfThick));
      const innerStart = addPoints(winStart, scalePoint(wallNorm, -halfThick));
      const innerEnd = addPoints(winEnd, scalePoint(wallNorm, -halfThick));
      const glassStart = winStart; // centerline
      const glassEnd = winEnd;

      return {
        id: win.id,
        outer: [worldToScreen(outerStart, viewport), worldToScreen(outerEnd, viewport)],
        inner: [worldToScreen(innerStart, viewport), worldToScreen(innerEnd, viewport)],
        glass: [worldToScreen(glassStart, viewport), worldToScreen(glassEnd, viewport)],
        // Wall break rectangle (to clear wall fill)
        breakTopLeft: worldToScreen(addPoints(winStart, scalePoint(wallNorm, halfThick + 2)), viewport),
        breakBottomRight: worldToScreen(addPoints(winEnd, scalePoint(wallNorm, -halfThick - 2)), viewport),
        type: win.type,
      };
    }).filter(Boolean);
  }, [windows, walls, viewport]);

  const lineColor = viewMode === "cad" ? "#1A1A1A" : "#444444";
  const glassColor = viewMode === "cad" ? "#3B82F6" : "#60A5FA";

  return (
    <>
      {windowShapes.map((shape) => {
        if (!shape) return null;

        return (
          <Group key={shape.id}>
            {/* Wall break (clear the wall fill) */}
            <KLine
              points={[
                shape.breakTopLeft.x, shape.breakTopLeft.y,
                shape.breakBottomRight.x, shape.breakTopLeft.y,
                shape.breakBottomRight.x, shape.breakBottomRight.y,
                shape.breakTopLeft.x, shape.breakBottomRight.y,
              ]}
              closed
              fill="#FFFFFF"
              stroke="transparent"
              listening={false}
            />

            {/* Outer wall face line */}
            <KLine
              points={[
                shape.outer[0].x, shape.outer[0].y,
                shape.outer[1].x, shape.outer[1].y,
              ]}
              stroke={lineColor}
              strokeWidth={1.2}
              listening={false}
            />

            {/* Inner wall face line */}
            <KLine
              points={[
                shape.inner[0].x, shape.inner[0].y,
                shape.inner[1].x, shape.inner[1].y,
              ]}
              stroke={lineColor}
              strokeWidth={1.2}
              listening={false}
            />

            {/* Glass pane (center line, colored) */}
            <KLine
              points={[
                shape.glass[0].x, shape.glass[0].y,
                shape.glass[1].x, shape.glass[1].y,
              ]}
              stroke={glassColor}
              strokeWidth={1.5}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
