"use client";

import React, { useMemo } from "react";
import { Rect, Group } from "react-konva";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import type { Viewport } from "@/lib/floor-plan/geometry";
import { worldToScreen, polygonBounds } from "@/lib/floor-plan/geometry";
import { validateBuildingCode } from "@/lib/floor-plan/code-validator";

interface CodeOverlayRendererProps {
  viewport: Viewport;
}

export function CodeOverlayRenderer({ viewport }: CodeOverlayRendererProps) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const codeVisible = useFloorPlanStore((s) => s.codeOverlayVisible);
  const projectType = useFloorPlanStore((s) => s.project?.metadata.project_type ?? "residential");

  const violatingRoomIds = useMemo(() => {
    if (!floor || !codeVisible) return new Set<string>();
    const report = validateBuildingCode(floor, projectType);
    const ids = new Set<string>();
    for (const v of report.violations) {
      if (v.entity_id) {
        // Check if entity is a room
        const isRoom = floor.rooms.some((r) => r.id === v.entity_id);
        if (isRoom) ids.add(v.entity_id);
      }
    }
    return ids;
  }, [floor, codeVisible, projectType]);

  if (!floor || !codeVisible || violatingRoomIds.size === 0) return null;

  return (
    <>
      {floor.rooms
        .filter((r) => violatingRoomIds.has(r.id))
        .map((room) => {
          const bounds = polygonBounds(room.boundary.points);
          const topLeft = worldToScreen(bounds.min, viewport);
          const bottomRight = worldToScreen(bounds.max, viewport);

          const x = Math.min(topLeft.x, bottomRight.x);
          const y = Math.min(topLeft.y, bottomRight.y);
          const w = Math.abs(bottomRight.x - topLeft.x);
          const h = Math.abs(bottomRight.y - topLeft.y);

          if (w < 5 || h < 5) return null;

          return (
            <Group key={room.id}>
              <Rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="rgba(239, 68, 68, 0.15)"
                stroke="rgba(239, 68, 68, 0.5)"
                strokeWidth={1.5}
                dash={[6, 3]}
                listening={false}
              />
            </Group>
          );
        })}
    </>
  );
}
