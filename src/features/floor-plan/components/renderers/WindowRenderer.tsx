"use client";

import React, { useMemo } from "react";
import { Line as KLine, Group } from "react-konva";
import type { CadWindow, Wall, ViewMode } from "@/types/floor-plan-cad";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import {
  worldToScreen,
  worldToScreenDistance,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  midpoint,
} from "@/features/floor-plan/lib/geometry";
import { lw } from "@/features/floor-plan/lib/line-weights";

interface WindowRendererProps {
  windows: CadWindow[];
  walls: Wall[];
  viewport: Viewport;
  viewMode: ViewMode;
}

interface WinShape {
  id: string;
  type: CadWindow["type"];
  outer: [{ x: number; y: number }, { x: number; y: number }];
  inner: [{ x: number; y: number }, { x: number; y: number }];
  glass: [{ x: number; y: number }, { x: number; y: number }];
  breakTopLeft: { x: number; y: number };
  breakBottomRight: { x: number; y: number };
  // Casement swing indicator
  swingTri?: number[];
  // Sliding overlap indicator
  glass2?: [{ x: number; y: number }, { x: number; y: number }];
}

function WindowRendererBase({ windows, walls, viewport, viewMode }: WindowRendererProps) {
  const zoom = viewport.zoom;

  const windowShapes = useMemo(() => {
    return windows.map((win): WinShape | null => {
      const wall = walls.find((w) => w.id === win.wall_id);
      if (!wall) return null;

      const wallDir = lineDirection(wall.centerline);
      const wallNorm = perpendicularLeft(wallDir);
      const halfThick = wall.thickness_mm / 2;

      const winStart = addPoints(
        wall.centerline.start,
        scalePoint(wallDir, win.position_along_wall_mm),
      );
      const winEnd = addPoints(winStart, scalePoint(wallDir, win.width_mm));

      // Three parallel lines
      const outerStart = addPoints(winStart, scalePoint(wallNorm, halfThick));
      const outerEnd = addPoints(winEnd, scalePoint(wallNorm, halfThick));
      const innerStart = addPoints(winStart, scalePoint(wallNorm, -halfThick));
      const innerEnd = addPoints(winEnd, scalePoint(wallNorm, -halfThick));

      const shape: WinShape = {
        id: win.id,
        type: win.type,
        outer: [worldToScreen(outerStart, viewport), worldToScreen(outerEnd, viewport)],
        inner: [worldToScreen(innerStart, viewport), worldToScreen(innerEnd, viewport)],
        glass: [worldToScreen(winStart, viewport), worldToScreen(winEnd, viewport)],
        breakTopLeft: worldToScreen(
          addPoints(winStart, scalePoint(wallNorm, halfThick + 2)),
          viewport,
        ),
        breakBottomRight: worldToScreen(
          addPoints(winEnd, scalePoint(wallNorm, -halfThick - 2)),
          viewport,
        ),
      };

      // ── Casement: small triangle showing swing direction ──
      if (win.type === "casement" || win.type === "awning") {
        const midPt = midpoint(winStart, winEnd);
        const triTip = addPoints(midPt, scalePoint(wallNorm, halfThick * 1.8));
        const triBase1 = addPoints(
          midPt,
          addPoints(scalePoint(wallDir, win.width_mm * 0.15), scalePoint(wallNorm, halfThick * 0.4)),
        );
        const triBase2 = addPoints(
          midPt,
          addPoints(scalePoint(wallDir, -win.width_mm * 0.15), scalePoint(wallNorm, halfThick * 0.4)),
        );
        const t = worldToScreen(triTip, viewport);
        const b1 = worldToScreen(triBase1, viewport);
        const b2 = worldToScreen(triBase2, viewport);
        shape.swingTri = [t.x, t.y, b1.x, b1.y, b2.x, b2.y];
      }

      // ── Sliding: two overlapping glass panes ──
      if (win.type === "sliding" || win.type === "double_hung") {
        const offset = scalePoint(wallDir, win.width_mm * 0.08);
        const g2Start = addPoints(winStart, addPoints(offset, scalePoint(wallNorm, halfThick * 0.25)));
        const g2End = addPoints(winEnd, addPoints(offset, scalePoint(wallNorm, halfThick * 0.25)));
        shape.glass2 = [worldToScreen(g2Start, viewport), worldToScreen(g2End, viewport)];
      }

      return shape;
    }).filter(Boolean) as WinShape[];
  }, [windows, walls, viewport]);

  const lineColor = viewMode === "cad" ? "#1A1A1A" : "#444444";
  const glassColor = viewMode === "cad" ? "#3B82F6" : "#60A5FA";
  const frameWeight = lw("win-frame", zoom);
  const glassWeight = lw("win-glass", zoom);

  return (
    <>
      {windowShapes.map((s) => (
        <Group key={s.id}>
          {/* Wall break */}
          <KLine
            points={[
              s.breakTopLeft.x, s.breakTopLeft.y,
              s.breakBottomRight.x, s.breakTopLeft.y,
              s.breakBottomRight.x, s.breakBottomRight.y,
              s.breakTopLeft.x, s.breakBottomRight.y,
            ]}
            closed fill="#FFFFFF" stroke="transparent" listening={false}
          />
          {/* Outer wall face */}
          <KLine
            points={[s.outer[0].x, s.outer[0].y, s.outer[1].x, s.outer[1].y]}
            stroke={lineColor} strokeWidth={frameWeight} listening={false}
          />
          {/* Inner wall face */}
          <KLine
            points={[s.inner[0].x, s.inner[0].y, s.inner[1].x, s.inner[1].y]}
            stroke={lineColor} strokeWidth={frameWeight} listening={false}
          />
          {/* Glass pane */}
          <KLine
            points={[s.glass[0].x, s.glass[0].y, s.glass[1].x, s.glass[1].y]}
            stroke={glassColor} strokeWidth={glassWeight} listening={false}
          />
          {/* Casement swing triangle */}
          {s.swingTri && (
            <KLine
              points={s.swingTri}
              closed
              stroke={lineColor}
              strokeWidth={lw("dim-line", zoom)}
              fill="rgba(59,130,246,0.06)"
              listening={false}
            />
          )}
          {/* Sliding: second glass pane (offset) */}
          {s.glass2 && (
            <KLine
              points={[s.glass2[0].x, s.glass2[0].y, s.glass2[1].x, s.glass2[1].y]}
              stroke={glassColor} strokeWidth={glassWeight * 0.7}
              dash={[6, 3]}
              listening={false}
            />
          )}
        </Group>
      ))}
    </>
  );
}

export const WindowRenderer = React.memo(WindowRendererBase);
