"use client";

import React from "react";
import { Group, Rect, Line, Text } from "react-konva";
import type { FurnitureInstance, Floor, Point } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import { worldToScreen } from "@/lib/floor-plan/geometry";
import { getCatalogItem } from "@/lib/floor-plan/furniture-catalog";

interface FurnitureRendererProps {
  floor: Floor;
  viewport: Viewport;
  selectedIds: string[];
  showClearances?: boolean;
}

export function FurnitureRenderer({
  floor,
  viewport,
  selectedIds,
  showClearances = false,
}: FurnitureRendererProps) {
  return (
    <>
      {floor.furniture.map((inst) => (
        <FurnitureItem
          key={inst.id}
          instance={inst}
          viewport={viewport}
          isSelected={selectedIds.includes(inst.id)}
          showClearance={showClearances && selectedIds.includes(inst.id)}
        />
      ))}
    </>
  );
}

function FurnitureItem({
  instance,
  viewport,
  isSelected,
  showClearance,
}: {
  instance: FurnitureInstance;
  viewport: Viewport;
  isSelected: boolean;
  showClearance: boolean;
}) {
  const catalog = getCatalogItem(instance.catalog_id);
  if (!catalog) return null;

  const w = catalog.width_mm * instance.scale;
  const d = catalog.depth_mm * instance.scale;

  // Position in screen space
  const screen = worldToScreen(instance.position, viewport);
  const sw = w * viewport.zoom;
  const sd = d * viewport.zoom;

  // Rotation in degrees (canvas uses clockwise)
  const rotDeg = -instance.rotation_deg;

  // Render the outline and plan symbol paths as Konva primitives
  const outlinePoints = catalog.outline.points.map((p) => {
    const scaled: Point = { x: p.x * instance.scale, y: p.y * instance.scale };
    return scaled;
  });

  // Convert outline to screen-space flat array for Konva Line
  const flatOutline: number[] = [];
  for (const p of outlinePoints) {
    flatOutline.push(p.x * viewport.zoom, -p.y * viewport.zoom);
  }

  const strokeColor = isSelected ? "#3B82F6" : "#555555";
  const strokeW = isSelected ? 2 : 1;

  return (
    <Group
      x={screen.x}
      y={screen.y}
      rotation={rotDeg}
    >
      {/* Clearance zone */}
      {showClearance && (
        <Rect
          x={-catalog.clearance.left_mm * instance.scale * viewport.zoom}
          y={-catalog.clearance.back_mm * instance.scale * viewport.zoom}
          width={(w + catalog.clearance.left_mm + catalog.clearance.right_mm) * viewport.zoom}
          height={(d + catalog.clearance.front_mm + catalog.clearance.back_mm) * viewport.zoom}
          fill="rgba(255, 200, 0, 0.08)"
          stroke="#F59E0B"
          strokeWidth={0.5}
          dash={[4, 4]}
        />
      )}

      {/* Main outline */}
      <Line
        points={flatOutline}
        closed
        stroke={strokeColor}
        strokeWidth={strokeW}
        fill={isSelected ? "rgba(59, 130, 246, 0.06)" : "rgba(200, 200, 200, 0.1)"}
      />

      {/* Inner detail lines from plan_symbol */}
      {catalog.plan_symbol.paths.slice(1).map((pathDef, i) => {
        // Parse simple M/L path commands to line points
        const linePoints = parseSimplePath(pathDef.d, instance.scale, viewport.zoom);
        if (linePoints.length >= 4) {
          return (
            <Line
              key={i}
              points={linePoints}
              stroke={strokeColor}
              strokeWidth={pathDef.stroke_width * viewport.zoom * 0.5}
              opacity={0.6}
              dash={pathDef.dash ? pathDef.dash.map((v) => v * viewport.zoom * 0.05) : undefined}
            />
          );
        }
        return null;
      })}

      {/* Label (only at reasonable zoom) */}
      {viewport.zoom > 0.03 && (
        <Text
          x={0}
          y={-sd - 8}
          text={catalog.name}
          fontSize={Math.max(8, Math.min(11, 10 * viewport.zoom * 12))}
          fill={isSelected ? "#3B82F6" : "#888888"}
          align="left"
          opacity={0.7}
        />
      )}
    </Group>
  );
}

/**
 * Parse simple SVG path with M, L, Z commands into flat Konva points.
 * Only handles straight-line segments (ignores arcs/curves).
 */
function parseSimplePath(d: string, scale: number, zoom: number): number[] {
  const points: number[] = [];
  const commands = d.match(/[MLZ][^MLZ]*/gi);
  if (!commands) return points;

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    if (type === "Z") continue;
    const nums = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      if (i + 1 < nums.length) {
        points.push(nums[i] * scale * zoom, -nums[i + 1] * scale * zoom);
      }
    }
  }

  return points;
}
