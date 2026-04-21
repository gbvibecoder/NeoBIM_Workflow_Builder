"use client";

import React, { useMemo } from "react";
import { Line as KLine, Shape } from "react-konva";
import type { Context } from "konva/lib/Context";
import type { Shape as KonvaShape } from "konva/lib/Shape";
import type { Wall, ViewMode } from "@/types/floor-plan-cad";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import { wallToRectangle, worldToScreen } from "@/features/floor-plan/lib/geometry";
import { lw, computeHatchSegments } from "@/features/floor-plan/lib/line-weights";

interface WallRendererProps {
  walls: Wall[];
  viewport: Viewport;
  viewMode: ViewMode;
  selectedIds: string[];
}

function WallRendererBase({ walls, viewport, viewMode, selectedIds }: WallRendererProps) {
  const zoom = viewport.zoom;

  // Compute wall polygons
  const wallShapes = useMemo(() => {
    return walls.map((wall) => {
      const corners = wallToRectangle(wall);
      const screenCorners = corners.map((p) => worldToScreen(p, viewport));
      const points = screenCorners.flatMap((p) => [p.x, p.y]);

      // IS:962 line weight hierarchy
      let strokeWidth: number;
      switch (wall.type) {
        case "exterior":
          strokeWidth = lw("wall-ext", zoom);
          break;
        case "interior":
          strokeWidth = lw("wall-int", zoom);
          break;
        case "partition":
          strokeWidth = lw("wall-part", zoom);
          break;
        default:
          strokeWidth = lw("wall-int", zoom);
      }

      const isSelected = selectedIds.includes(wall.id);
      const strokeColor = isSelected
        ? "#3B82F6"
        : viewMode === "cad" ? "#1A1A1A" : "#404040";
      const fillColor = isSelected
        ? "rgba(59, 130, 246, 0.08)"
        : viewMode === "cad" ? "#FFFFFF" : "#F0F0F0";

      return {
        id: wall.id,
        points,
        screenCorners,
        strokeWidth,
        strokeColor,
        fillColor,
        type: wall.type,
        material: wall.material,
        thickness_mm: wall.thickness_mm,
      };
    });
  }, [walls, viewport, viewMode, selectedIds, zoom]);

  // ── Wall material hatching (ANSI31 diagonal for brick) ──
  const hatchSegments = useMemo(() => {
    if (viewMode !== "cad" && viewMode !== "construction") return [];
    const segs: [number, number, number, number][] = [];
    for (const shape of wallShapes) {
      // Only show hatching when wall is thick enough on screen
      const thickPx = shape.thickness_mm * zoom;
      if (thickPx < 7) continue;
      // Spacing adapts slightly to wall thickness for good density
      const spacing = Math.max(4, Math.min(8, thickPx * 0.3));
      const wallSegs = computeHatchSegments(shape.screenCorners, spacing);
      segs.push(...wallSegs);
    }
    return segs;
  }, [wallShapes, zoom, viewMode]);

  // ── Junction fills (convex hull of near-junction corners) ──
  const junctionFills = useMemo(() => {
    const fills: Array<{ points: number[] }> = [];
    const SNAP = 100;
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

      const nearCorners: { x: number; y: number }[] = [];
      for (const idx of wallIndices) {
        const wall = walls[idx];
        const corners = wallToRectangle(wall);
        const sDist = Math.hypot(wall.centerline.start.x - jx, wall.centerline.start.y - jy);
        const eDist = Math.hypot(wall.centerline.end.x - jx, wall.centerline.end.y - jy);
        if (sDist <= eDist) {
          nearCorners.push(worldToScreen(corners[0], viewport));
          nearCorners.push(worldToScreen(corners[3], viewport));
        } else {
          nearCorners.push(worldToScreen(corners[1], viewport));
          nearCorners.push(worldToScreen(corners[2], viewport));
        }
      }

      if (nearCorners.length < 3) continue;

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

  const juncStroke = viewMode === "cad" ? "#1A1A1A" : "#404040";
  const juncFill = viewMode === "cad" ? "#FFFFFF" : "#F0F0F0";
  const hatchColor = viewMode === "cad" ? "#666666" : "#888888";

  return (
    <>
      {/* Junction fills (behind walls) */}
      {junctionFills.map((fill, i) => (
        <KLine
          key={`junc-${i}`}
          points={fill.points}
          closed
          fill={juncFill}
          stroke={juncStroke}
          strokeWidth={lw("wall-junc", zoom)}
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

      {/* Brick masonry hatching — single Shape for all walls (efficient) */}
      {hatchSegments.length > 0 && (
        <Shape
          stroke={hatchColor}
          strokeWidth={lw("wall-hatch", zoom)}
          opacity={0.3}
          sceneFunc={(context: Context, shape: KonvaShape) => {
            context.beginPath();
            for (const seg of hatchSegments) {
              context.moveTo(seg[0], seg[1]);
              context.lineTo(seg[2], seg[3]);
            }
            context.fillStrokeShape(shape);
          }}
          listening={false}
        />
      )}
    </>
  );
}

export const WallRenderer = React.memo(WallRendererBase);
