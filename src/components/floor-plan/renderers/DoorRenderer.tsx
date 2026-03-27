"use client";

import React, { useMemo } from "react";
import { Arc, Line as KLine, Circle, Group } from "react-konva";
import type { Door, Wall, ViewMode } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import {
  worldToScreen,
  worldToScreenDistance,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  wallAngle,
} from "@/lib/floor-plan/geometry";

interface DoorRendererProps {
  doors: Door[];
  walls: Wall[];
  viewport: Viewport;
  viewMode: ViewMode;
}

export function DoorRenderer({ doors, walls, viewport, viewMode }: DoorRendererProps) {
  const doorShapes = useMemo(() => {
    return doors.map((door) => {
      const wall = walls.find((w) => w.id === door.wall_id);
      if (!wall) return null;

      const wallDir = lineDirection(wall.centerline);
      const wallNorm = perpendicularLeft(wallDir);
      const angle = wallAngle(wall);
      const halfThick = wall.thickness_mm / 2;

      // Door position along wall centerline
      const doorStart = addPoints(
        wall.centerline.start,
        scalePoint(wallDir, door.position_along_wall_mm)
      );
      const doorEnd = addPoints(doorStart, scalePoint(wallDir, door.width_mm));

      // Hinge point (on one face of the wall)
      const hingeWorld = door.swing_direction === "left"
        ? addPoints(doorStart, scalePoint(wallNorm, halfThick))
        : addPoints(doorEnd, scalePoint(wallNorm, halfThick));

      // Door leaf end point (open position)
      const leafOpenWorld = door.swing_direction === "left"
        ? addPoints(hingeWorld, scalePoint(wallNorm, door.width_mm))
        : addPoints(hingeWorld, scalePoint(wallNorm, door.width_mm));

      // Screen coordinates
      const hingeScreen = worldToScreen(hingeWorld, viewport);
      const leafOpenScreen = worldToScreen(leafOpenWorld, viewport);
      const arcRadius = worldToScreenDistance(door.width_mm, viewport.zoom);

      // Wall break points (to clear the wall fill)
      const breakStart = worldToScreen(
        addPoints(doorStart, scalePoint(wallNorm, -halfThick)),
        viewport
      );
      const breakEnd = worldToScreen(
        addPoints(doorEnd, scalePoint(wallNorm, halfThick)),
        viewport
      );

      // Arc angles (in degrees, Konva convention)
      // Wall angle in degrees, adjusted for screen Y-flip
      const wallAngleDeg = -(angle * 180) / Math.PI;
      let arcStartAngle: number;
      let arcEndAngle: number;

      if (door.swing_direction === "left") {
        arcStartAngle = wallAngleDeg - 180; // along wall
        arcEndAngle = 90; // sweep 90 degrees
      } else {
        arcStartAngle = wallAngleDeg;
        arcEndAngle = 90;
      }

      return {
        id: door.id,
        hingeScreen,
        leafOpenScreen,
        arcRadius,
        arcStartAngle,
        arcEndAngle,
        breakStart,
        breakEnd,
        doorType: door.type,
        wallAngleDeg,
        halfThick: worldToScreenDistance(halfThick, viewport.zoom),
      };
    }).filter(Boolean);
  }, [doors, walls, viewport]);

  const strokeColor = viewMode === "cad" ? "#1A1A1A" : "#555555";
  const arcColor = viewMode === "cad" ? "#444444" : "#888888";

  return (
    <>
      {doorShapes.map((shape) => {
        if (!shape) return null;

        return (
          <Group key={shape.id}>
            {/* Wall break (white rectangle to clear wall) */}
            <KLine
              points={[
                shape.breakStart.x, shape.breakStart.y,
                shape.breakEnd.x, shape.breakStart.y,
                shape.breakEnd.x, shape.breakEnd.y,
                shape.breakStart.x, shape.breakEnd.y,
              ]}
              closed
              fill="#FFFFFF"
              stroke="transparent"
              listening={false}
            />

            {/* Door leaf line (hinge to open position) */}
            <KLine
              points={[
                shape.hingeScreen.x, shape.hingeScreen.y,
                shape.leafOpenScreen.x, shape.leafOpenScreen.y,
              ]}
              stroke={strokeColor}
              strokeWidth={1.2}
              listening={false}
            />

            {/* Door swing arc */}
            <Arc
              x={shape.hingeScreen.x}
              y={shape.hingeScreen.y}
              innerRadius={shape.arcRadius}
              outerRadius={shape.arcRadius}
              angle={shape.arcEndAngle}
              rotation={shape.arcStartAngle}
              stroke={arcColor}
              strokeWidth={0.8}
              dash={[4, 3]}
              listening={false}
            />

            {/* Hinge point (small filled circle) */}
            <Circle
              x={shape.hingeScreen.x}
              y={shape.hingeScreen.y}
              radius={Math.max(2, viewport.zoom * 30)}
              fill={strokeColor}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
