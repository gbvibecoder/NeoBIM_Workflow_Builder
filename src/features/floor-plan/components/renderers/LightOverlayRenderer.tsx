"use client";

import React, { useMemo } from "react";
import { Rect, Text, Group } from "react-konva";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import { worldToScreen, polygonBounds } from "@/features/floor-plan/lib/geometry";
import { analyzeNaturalLight, type RoomLightScore } from "@/features/floor-plan/lib/light-analysis";

interface LightOverlayRendererProps {
  viewport: Viewport;
}

const GRADE_COLORS: Record<string, string> = {
  excellent: "rgba(250, 204, 21, 0.25)",  // warm yellow
  good:      "rgba(163, 230, 53, 0.20)",  // yellow-green
  fair:      "rgba(96, 165, 250, 0.20)",   // cool blue
  poor:      "rgba(100, 116, 139, 0.25)",  // gray-blue
};

const GRADE_ICONS: Record<string, string> = {
  excellent: "☀",
  good:      "☀",
  fair:      "⛅",
  poor:      "☁",
};

const GRADE_LABELS: Record<string, string> = {
  excellent: "Excellent",
  good:      "Good",
  fair:      "Fair",
  poor:      "Poor",
};

export function LightOverlayRenderer({ viewport }: LightOverlayRendererProps) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const lightVisible = useFloorPlanStore((s) => s.lightOverlayVisible);
  const northAngle = useFloorPlanStore((s) => s.project?.settings.north_angle_deg ?? 0);

  const analysis = useMemo(() => {
    if (!floor || !lightVisible) return null;
    return analyzeNaturalLight(floor, northAngle);
  }, [floor, lightVisible, northAngle]);

  if (!analysis || !floor || !lightVisible) return null;

  return (
    <>
      {analysis.rooms.map((score) => (
        <RoomLightOverlay
          key={score.roomId}
          score={score}
          floor={floor}
          viewport={viewport}
        />
      ))}
    </>
  );
}

function RoomLightOverlay({
  score,
  floor,
  viewport,
}: {
  score: RoomLightScore;
  floor: import("@/types/floor-plan-cad").Floor;
  viewport: Viewport;
}) {
  const room = floor.rooms.find((r) => r.id === score.roomId);
  if (!room) return null;

  const bounds = polygonBounds(room.boundary.points);
  const topLeft = worldToScreen(bounds.min, viewport);
  const bottomRight = worldToScreen(bounds.max, viewport);

  // In screen coords, Y is flipped
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const w = Math.abs(bottomRight.x - topLeft.x);
  const h = Math.abs(bottomRight.y - topLeft.y);

  if (w < 20 || h < 20) return null; // Too small to render

  const fillColor = GRADE_COLORS[score.grade] ?? GRADE_COLORS.fair;
  const icon = GRADE_ICONS[score.grade] ?? "⛅";
  const label = GRADE_LABELS[score.grade] ?? "Fair";

  const showDetails = w > 60 && h > 40;

  return (
    <Group>
      {/* Heat map fill */}
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={fillColor}
        listening={false}
      />

      {/* Score label */}
      {showDetails && (
        <>
          <Text
            x={x + w / 2 - 12}
            y={y + h / 2 - 10}
            text={`${icon} ${score.score}`}
            fontSize={Math.min(14, Math.max(9, w * 0.12))}
            fontFamily="Inter, system-ui, sans-serif"
            fontStyle="bold"
            fill={score.grade === "poor" ? "#64748B" : score.grade === "fair" ? "#3B82F6" : "#CA8A04"}
            listening={false}
          />
          {w > 80 && (
            <Text
              x={x + w / 2 - 20}
              y={y + h / 2 + 6}
              text={label}
              fontSize={Math.min(10, Math.max(7, w * 0.08))}
              fontFamily="Inter, system-ui, sans-serif"
              fill={score.grade === "poor" ? "#94A3B8" : "#78716C"}
              listening={false}
            />
          )}
        </>
      )}
    </Group>
  );
}
