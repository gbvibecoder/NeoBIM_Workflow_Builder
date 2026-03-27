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

  // Draw wall junction fills (merged corners) using a custom shape
  const junctionFills = useMemo(() => {
    // For clean corners, we need to fill the gaps at wall junctions.
    // Simple approach: for each pair of connected walls, draw a filled rectangle
    // at their intersection to cover the gap.
    const fills: Array<{ points: number[] }> = [];

    // Build endpoint map: point → list of wall indices
    const SNAP = 100; // mm tolerance
    const endpointMap = new Map<string, number[]>();

    walls.forEach((wall, idx) => {
      const pts = [wall.centerline.start, wall.centerline.end];
      for (const p of pts) {
        const key = `${Math.round(p.x / SNAP) * SNAP},${Math.round(p.y / SNAP) * SNAP}`;
        if (!endpointMap.has(key)) endpointMap.set(key, []);
        endpointMap.get(key)!.push(idx);
      }
    });

    // For each junction with 2+ walls, compute the bounding box of
    // overlapping wall rectangles and fill it
    for (const [, wallIndices] of endpointMap) {
      if (wallIndices.length < 2) continue;

      // Get all corners from all walls at this junction
      const allCorners = wallIndices.flatMap((idx) => {
        const corners = wallToRectangle(walls[idx]);
        return corners.map((p) => worldToScreen(p, viewport));
      });

      // Compute convex hull-ish bounding — just use min/max for now
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of allCorners) {
        // Only include corners near the junction
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }

      // This is a simplified junction fill — works well for orthogonal walls
      fills.push({
        points: [minX, minY, maxX, minY, maxX, maxY, minX, maxY],
      });
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
