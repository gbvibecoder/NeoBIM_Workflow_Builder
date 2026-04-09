"use client";

import React from "react";
import { Group, Line, Rect, Text, Arrow } from "react-konva";
import type { Stair, Point } from "@/types/floor-plan-cad";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import { worldToScreen } from "@/features/floor-plan/lib/geometry";
import { lw } from "@/features/floor-plan/lib/line-weights";

interface StairRendererProps {
  stairs: Stair[];
  viewport: Viewport;
  selectedIds: string[];
}

function StairRendererBase({ stairs, viewport, selectedIds }: StairRendererProps) {
  return (
    <>
      {stairs.map((stair) => (
        <StairItem
          key={stair.id}
          stair={stair}
          viewport={viewport}
          isSelected={selectedIds.includes(stair.id)}
        />
      ))}
    </>
  );
}

function StairItem({
  stair,
  viewport,
  isSelected,
}: {
  stair: Stair;
  viewport: Viewport;
  isSelected: boolean;
}) {
  const { zoom } = viewport;
  const strokeColor = isSelected ? "#3B82F6" : "#444444";

  // Boundary outline in screen coords
  const boundaryFlat: number[] = [];
  for (const p of stair.boundary.points) {
    const s = worldToScreen(p, viewport);
    boundaryFlat.push(s.x, s.y);
  }

  // Treads in screen coords
  const treadLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const tread of stair.treads) {
    const s1 = worldToScreen(tread.start, viewport);
    const s2 = worldToScreen(tread.end, viewport);
    treadLines.push({ x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y });
  }

  // Up direction arrow
  const arrowStart = worldToScreen(stair.up_direction.start, viewport);
  const arrowEnd = worldToScreen(stair.up_direction.end, viewport);

  // Midpoint for label
  const midX = (arrowStart.x + arrowEnd.x) / 2;
  const midY = (arrowStart.y + arrowEnd.y) / 2;

  return (
    <Group>
      {/* Boundary */}
      <Line
        points={boundaryFlat}
        closed
        stroke={strokeColor}
        strokeWidth={isSelected ? 2 : lw("stair", zoom)}
        fill="rgba(200, 200, 210, 0.1)"
      />

      {/* Tread lines */}
      {treadLines.map((t, i) => (
        <Line
          key={i}
          points={[t.x1, t.y1, t.x2, t.y2]}
          stroke={strokeColor}
          strokeWidth={lw("stair-tread", zoom)}
          opacity={0.5}
        />
      ))}

      {/* Break line (halfway) — dashed diagonal */}
      {stair.landing_depth_mm && treadLines.length > 2 && (() => {
        const halfIdx = Math.floor(treadLines.length / 2);
        const t = treadLines[halfIdx];
        return (
          <Line
            points={[t.x1, t.y1, t.x2, t.y2]}
            stroke={strokeColor}
            strokeWidth={lw("stair", zoom)}
            dash={[6, 4]}
          />
        );
      })()}

      {/* Up arrow */}
      <Arrow
        points={[arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y]}
        stroke={strokeColor}
        fill={strokeColor}
        strokeWidth={lw("stair", zoom)}
        pointerLength={8}
        pointerWidth={6}
      />

      {/* UP/DN label */}
      <Text
        x={midX - 10}
        y={midY - 6}
        text="UP"
        fontSize={Math.max(8, Math.min(16, 100 * viewport.zoom))}
        fill={strokeColor}
        fontStyle="bold"
      />

      {/* Railing indicators */}
      {stair.has_railing && (stair.railing_side === "left" || stair.railing_side === "both") && (
        <Line
          points={boundaryFlat.slice(0, 4)} // First two points = left side
          stroke="#888"
          strokeWidth={lw("stair", zoom) * 1.5}
          lineCap="round"
        />
      )}
    </Group>
  );
}

export const StairRenderer = React.memo(StairRendererBase);
