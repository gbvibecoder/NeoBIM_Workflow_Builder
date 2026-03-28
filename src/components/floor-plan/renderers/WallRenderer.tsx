"use client";

import React, { useMemo } from "react";
import { Line as KLine, Shape } from "react-konva";
import type { Wall, ViewMode } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import {
  wallToRectangle,
  worldToScreen,
} from "@/lib/floor-plan/geometry";

interface WallRendererProps {
  walls: Wall[];
  viewport: Viewport;
  viewMode: ViewMode;
  selectedIds: string[];
}

export function WallRenderer({ walls, viewport, viewMode, selectedIds }: WallRendererProps) {
  // Compute wall polygons (rectangles for each wall)
  const wallShapes = useMemo(() => {
    return walls.map((wall) => {
      const corners = wallToRectangle(wall);
      const screenCorners = corners.map((p) => worldToScreen(p, viewport));

      // Flatten to points array for Konva Line (closed polygon)
      const points = screenCorners.flatMap((p) => [p.x, p.y]);

      // Line weight based on wall type
      let strokeWidth: number;
      switch (wall.type) {
        case "exterior":
          strokeWidth = viewMode === "cad" ? 2.0 : 1.5;
          break;
        case "interior":
          strokeWidth = viewMode === "cad" ? 1.2 : 1.0;
          break;
        case "partition":
          strokeWidth = viewMode === "cad" ? 0.8 : 0.6;
          break;
        default:
          strokeWidth = 1.0;
      }

      const isSelected = selectedIds.includes(wall.id);
      const strokeColor = isSelected
        ? "#3B82F6"
        : viewMode === "cad"
        ? "#1A1A1A"
        : "#404040";

      const fillColor = isSelected
        ? "rgba(59, 130, 246, 0.08)"
        : viewMode === "cad"
        ? "#FFFFFF"
        : "#F0F0F0";

      return {
        id: wall.id,
        points,
        strokeWidth,
        strokeColor,
        fillColor,
        type: wall.type,
      };
    });
  }, [walls, viewport, viewMode, selectedIds]);

  // Draw wall junction fills using convex hull of near-junction corners
  const junctionFills = useMemo(() => {
    const fills: Array<{ points: number[] }> = [];
    const SNAP = 100; // mm tolerance
    const endpointMap = new Map<string, number[]>();

    walls.forEach((wall, idx) => {
      for (const p of [wall.centerline.start, wall.centerline.end]) {
        const key = `${Math.round(p.x / SNAP) * SNAP},${Math.round(p.y / SNAP) * SNAP}`;
        if (!endpointMap.has(key)) endpointMap.set(key, []);
        endpointMap.get(key)!.push(idx);
      }
    });

    for (const [key, wallIndices] of endpointMap) {
      if (wallIndices.length < 2) continue;

      const [jx, jy] = key.split(",").map(Number);

      // Collect only the 2 near-junction corners per wall (not far-end corners)
      const nearCorners: { x: number; y: number }[] = [];
      for (const idx of wallIndices) {
        const wall = walls[idx];
        const corners = wallToRectangle(wall);
        // corners: [start-left, end-left, end-right, start-right]
        const sDist = Math.hypot(wall.centerline.start.x - jx, wall.centerline.start.y - jy);
        const eDist = Math.hypot(wall.centerline.end.x - jx, wall.centerline.end.y - jy);

        if (sDist <= eDist) {
          // Start is at junction → corners[0] (start-left) + corners[3] (start-right)
          nearCorners.push(worldToScreen(corners[0], viewport));
          nearCorners.push(worldToScreen(corners[3], viewport));
        } else {
          // End is at junction → corners[1] (end-left) + corners[2] (end-right)
          nearCorners.push(worldToScreen(corners[1], viewport));
          nearCorners.push(worldToScreen(corners[2], viewport));
        }
      }

      if (nearCorners.length < 3) continue;

      // Convex hull (Andrew's monotone chain)
      const sorted = [...nearCorners].sort((a, b) => a.x - b.x || a.y - b.y);
      const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

      const lower: { x: number; y: number }[] = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper: { x: number; y: number }[] = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      lower.pop();
      upper.pop();
      const hull = [...lower, ...upper];

      if (hull.length >= 3) {
        fills.push({ points: hull.flatMap((p) => [p.x, p.y]) });
      }
    }

    return fills;
  }, [walls, viewport]);

  return (
    <>
      {/* Junction fills first (behind walls) */}
      {junctionFills.map((fill, i) => (
        <KLine
          key={`junction-${i}`}
          points={fill.points}
          closed
          fill={viewMode === "cad" ? "#FFFFFF" : "#F0F0F0"}
          stroke={viewMode === "cad" ? "#1A1A1A" : "#404040"}
          strokeWidth={viewMode === "cad" ? 2.0 : 1.5}
          listening={false}
        />
      ))}

      {/* Wall polygons */}
      {wallShapes.map((shape) => (
        <KLine
          key={shape.id}
          points={shape.points}
          closed
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={shape.strokeWidth}
          hitStrokeWidth={8}
        />
      ))}
    </>
  );
}
