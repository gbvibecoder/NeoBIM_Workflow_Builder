"use client";

import React from "react";
import { Line as KLine, Text, Circle, Group, Rect } from "react-konva";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import type { Point } from "@/types/floor-plan-cad";
import { worldToScreen, distance } from "@/features/floor-plan/lib/geometry";
import { formatDimension } from "@/features/floor-plan/lib/unit-conversion";

interface MeasurementOverlayProps {
  viewport: Viewport;
}

export function MeasurementOverlay({ viewport }: MeasurementOverlayProps) {
  const measureStart = useFloorPlanStore((s) => s.measureStart);
  const measureEnd = useFloorPlanStore((s) => s.measureEnd);
  const activeTool = useFloorPlanStore((s) => s.activeTool);
  const cursorWorldPos = useFloorPlanStore((s) => s.cursorWorldPos);
  const pinnedMeasurements = useFloorPlanStore((s) => s.pinnedMeasurements);
  const displayUnit = useFloorPlanStore((s) => s.project?.settings.display_unit ?? "m");

  return (
    <>
      {/* Pinned measurements (always visible) */}
      {pinnedMeasurements.map((m) => (
        <MeasurementLine
          key={m.id}
          start={m.start}
          end={m.end}
          viewport={viewport}
          displayUnit={displayUnit}
          color="#2563EB"
          pinned
        />
      ))}

      {/* Active measurement (only when tool is active) */}
      {activeTool === "measure" && measureStart && (
        <MeasurementLine
          start={measureStart}
          end={measureEnd ?? cursorWorldPos}
          viewport={viewport}
          displayUnit={displayUnit}
          color="#EF4444"
          pinned={false}
        />
      )}

      {/* Instruction hint when measure tool active but no start point */}
      {activeTool === "measure" && !measureStart && (
        <Group listening={false}>
          <Rect
            x={viewport.canvasWidth / 2 - 120}
            y={20}
            width={240}
            height={28}
            fill="rgba(0,0,0,0.75)"
            cornerRadius={6}
          />
          <Text
            x={viewport.canvasWidth / 2 - 120}
            y={26}
            width={240}
            text="Click to set start point"
            fontSize={12}
            fontFamily="Inter, system-ui, sans-serif"
            fill="#FFFFFF"
            align="center"
          />
        </Group>
      )}

      {/* Hint for second point */}
      {activeTool === "measure" && measureStart && !measureEnd && (
        <Group listening={false}>
          <Rect
            x={viewport.canvasWidth / 2 - 140}
            y={20}
            width={280}
            height={28}
            fill="rgba(0,0,0,0.75)"
            cornerRadius={6}
          />
          <Text
            x={viewport.canvasWidth / 2 - 140}
            y={26}
            width={280}
            text="Click end point \u00b7 Esc to cancel \u00b7 P to pin"
            fontSize={11}
            fontFamily="Inter, system-ui, sans-serif"
            fill="#FFFFFF"
            align="center"
          />
        </Group>
      )}
    </>
  );
}

// ============================================================
// Reusable measurement line component
// ============================================================

function MeasurementLine({
  start,
  end,
  viewport,
  displayUnit,
  color,
  pinned,
}: {
  start: Point;
  end: Point;
  viewport: Viewport;
  displayUnit: string;
  color: string;
  pinned: boolean;
}) {
  const startScreen = worldToScreen(start, viewport);
  const endScreen = worldToScreen(end, viewport);
  const dist = distance(start, end);
  const midX = (startScreen.x + endScreen.x) / 2;
  const midY = (startScreen.y + endScreen.y) / 2;

  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  // Angle from horizontal
  const angleDeg = Math.atan2(Math.abs(end.y - start.y), Math.abs(end.x - start.x)) * (180 / Math.PI);

  // Label background dimensions
  const mainLabel = formatDimension(dist, displayUnit as "m");
  const labelWidth = Math.max(60, mainLabel.length * 8 + 16);

  return (
    <Group listening={false}>
      {/* Measurement line */}
      <KLine
        points={[startScreen.x, startScreen.y, endScreen.x, endScreen.y]}
        stroke={color}
        strokeWidth={pinned ? 1.2 : 1.5}
        dash={pinned ? [8, 4] : [6, 3]}
      />

      {/* Start point */}
      <Circle x={startScreen.x} y={startScreen.y} radius={3.5} fill={color} />

      {/* End point */}
      <Circle x={endScreen.x} y={endScreen.y} radius={3.5} fill={color} />

      {/* Main distance label with background */}
      <Rect
        x={midX - labelWidth / 2}
        y={midY - 22}
        width={labelWidth}
        height={18}
        fill="rgba(255,255,255,0.92)"
        cornerRadius={3}
        stroke={color}
        strokeWidth={0.5}
      />
      <Text
        x={midX - labelWidth / 2}
        y={midY - 19}
        width={labelWidth}
        text={mainLabel}
        fontSize={12}
        fontFamily="Inter, system-ui, sans-serif"
        fontStyle="bold"
        fill={color}
        align="center"
      />

      {/* H/V breakdown + angle (when both components significant) */}
      {dx > 200 && dy > 200 && (
        <>
          <Rect
            x={midX - 90}
            y={midY + 2}
            width={180}
            height={14}
            fill="rgba(255,255,255,0.85)"
            cornerRadius={2}
          />
          <Text
            x={midX - 90}
            y={midY + 3}
            width={180}
            text={`H: ${formatDimension(dx, displayUnit as "m")}  V: ${formatDimension(dy, displayUnit as "m")}  ${angleDeg.toFixed(1)}°`}
            fontSize={9}
            fontFamily="Inter, system-ui, sans-serif"
            fill={color}
            align="center"
            opacity={0.8}
          />
        </>
      )}

      {/* Cross-hair at endpoints */}
      {!pinned && (
        <>
          <KLine points={[startScreen.x - 6, startScreen.y, startScreen.x + 6, startScreen.y]} stroke={color} strokeWidth={0.5} />
          <KLine points={[startScreen.x, startScreen.y - 6, startScreen.x, startScreen.y + 6]} stroke={color} strokeWidth={0.5} />
          <KLine points={[endScreen.x - 6, endScreen.y, endScreen.x + 6, endScreen.y]} stroke={color} strokeWidth={0.5} />
          <KLine points={[endScreen.x, endScreen.y - 6, endScreen.x, endScreen.y + 6]} stroke={color} strokeWidth={0.5} />
        </>
      )}
    </Group>
  );
}
