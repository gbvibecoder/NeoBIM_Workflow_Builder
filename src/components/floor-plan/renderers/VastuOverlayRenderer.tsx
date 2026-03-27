"use client";

import React, { useMemo } from "react";
import { Group, Rect, Text, Line, Circle } from "react-konva";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { analyzeVastuCompliance } from "@/lib/floor-plan/vastu-analyzer";
import { DIRECTION_LABELS, type VastuDirection } from "@/lib/floor-plan/vastu-rules";
import { worldToScreen, worldToScreenDistance } from "@/lib/floor-plan/geometry";
import type { Viewport } from "@/lib/floor-plan/geometry";

interface Props {
  viewport: Viewport;
}

const ZONE_COLORS: Record<string, string> = {
  pass: "rgba(34,197,94,0.12)",
  acceptable: "rgba(234,179,8,0.10)",
  violation: "rgba(239,68,68,0.14)",
  empty: "rgba(148,163,184,0.06)",
};

const ZONE_BORDERS: Record<string, string> = {
  pass: "rgba(34,197,94,0.4)",
  acceptable: "rgba(234,179,8,0.35)",
  violation: "rgba(239,68,68,0.45)",
  empty: "rgba(148,163,184,0.2)",
};

const STATUS_ICONS: Record<string, string> = {
  pass: "\u2713",
  acceptable: "!",
  violation: "\u2717",
};

export function VastuOverlayRenderer({ viewport }: Props) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const vastuOverlayVisible = useFloorPlanStore((s) => s.vastuOverlayVisible);
  const northAngle = useFloorPlanStore((s) => s.project?.settings.north_angle_deg ?? 0);

  const analysis = useMemo(() => {
    if (!floor || !vastuOverlayVisible) return null;
    return analyzeVastuCompliance(floor, northAngle);
  }, [floor, vastuOverlayVisible, northAngle]);

  if (!floor || !vastuOverlayVisible || !analysis) return null;

  const toScreen = (wx: number, wy: number) => worldToScreen({ x: wx, y: wy }, viewport);
  const grid = analysis.zone_grid;
  const zoom = viewport.zoom;
  const fontSize = Math.max(10, Math.min(16, 800 * zoom));
  const smallFont = Math.max(8, Math.min(12, 600 * zoom));

  // Build a map: direction -> worst status
  const dirStatus = new Map<VastuDirection, "pass" | "acceptable" | "violation">();
  for (const item of analysis.items) {
    const dir = item.actual_direction;
    const current = dirStatus.get(dir);
    if (!current || statusPriority(item.status) > statusPriority(current)) {
      dirStatus.set(dir, item.status);
    }
  }

  return (
    <Group>
      {/* 3x3 Zone Grid */}
      {grid.cells.flatMap((row, ri) =>
        row.map((cell, ci) => {
          const topLeft = toScreen(cell.bounds.min.x, cell.bounds.max.y); // Y-flip: max.y is top
          const sw = worldToScreenDistance(grid.cell_width, zoom);
          const sh = worldToScreenDistance(grid.cell_height, zoom);
          const status = dirStatus.get(cell.direction) ?? "empty";

          return (
            <Group key={`zone-${ri}-${ci}`}>
              <Rect
                x={topLeft.x}
                y={topLeft.y}
                width={sw}
                height={sh}
                fill={ZONE_COLORS[status]}
                stroke={ZONE_BORDERS[status]}
                strokeWidth={1}
                dash={[6, 4]}
              />
              <Text
                x={topLeft.x + 4}
                y={topLeft.y + 3}
                text={DIRECTION_LABELS[cell.direction]}
                fontSize={smallFont}
                fontFamily="Inter, sans-serif"
                fontStyle="bold"
                fill="rgba(100,116,139,0.7)"
              />
              {status !== "empty" && (
                <Text
                  x={topLeft.x + sw - fontSize - 4}
                  y={topLeft.y + 3}
                  text={STATUS_ICONS[status]}
                  fontSize={fontSize}
                  fontFamily="Inter, sans-serif"
                  fontStyle="bold"
                  fill={
                    status === "pass"
                      ? "#16a34a"
                      : status === "acceptable"
                      ? "#ca8a04"
                      : "#dc2626"
                  }
                />
              )}
            </Group>
          );
        })
      )}

      {/* Room compliance indicators */}
      {floor.rooms.map((room) => {
        const item = analysis.items.find(
          (i) => i.room_id === room.id && i.status !== "pass"
        );
        if (!item) return null;

        const screenPos = toScreen(room.label_position.x, room.label_position.y);
        const r = Math.max(6, 300 * zoom);

        return (
          <Group key={`vastu-ind-${room.id}`}>
            <Circle
              x={screenPos.x + r * 2.5}
              y={screenPos.y - r * 1.5}
              radius={r}
              fill={item.status === "violation" ? "#dc2626" : "#eab308"}
              opacity={0.85}
            />
            <Text
              x={screenPos.x + r * 2.5 - r * 0.6}
              y={screenPos.y - r * 1.5 - r * 0.6}
              text={item.status === "violation" ? "\u2717" : "!"}
              fontSize={r * 1.2}
              fontFamily="Inter, sans-serif"
              fontStyle="bold"
              fill="white"
            />
          </Group>
        );
      })}

      {/* Compass indicator */}
      <CompassRose
        x={toScreen(grid.bounds.max.x, grid.bounds.max.y).x + 30}
        y={toScreen(grid.bounds.max.x, grid.bounds.max.y).y + 30}
        size={40}
        northAngle={northAngle}
      />
    </Group>
  );
}

function CompassRose({ x, y, size, northAngle }: { x: number; y: number; size: number; northAngle: number }) {
  const r = size / 2;
  const rad = (-northAngle * Math.PI) / 180;
  const nx = x + r * Math.sin(rad);
  const ny = y - r * Math.cos(rad);

  return (
    <Group>
      <Circle x={x} y={y} radius={r} fill="rgba(255,255,255,0.9)" stroke="#94a3b8" strokeWidth={1} />
      <Line points={[x, y, nx, ny]} stroke="#dc2626" strokeWidth={2} />
      <Text
        x={nx - 4}
        y={ny - 14}
        text="N"
        fontSize={10}
        fontStyle="bold"
        fontFamily="Inter, sans-serif"
        fill="#dc2626"
      />
      <Line
        points={[x, y, x - r * Math.sin(rad), y + r * Math.cos(rad)]}
        stroke="#94a3b8"
        strokeWidth={1}
      />
    </Group>
  );
}

function statusPriority(status: "pass" | "acceptable" | "violation"): number {
  if (status === "violation") return 2;
  if (status === "acceptable") return 1;
  return 0;
}
