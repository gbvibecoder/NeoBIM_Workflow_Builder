"use client";

import React, { useMemo } from "react";
import { Arc, Line as KLine, Circle, Group, Rect } from "react-konva";
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
import { lw } from "@/lib/floor-plan/line-weights";

interface DoorRendererProps {
  doors: Door[];
  walls: Wall[];
  viewport: Viewport;
  viewMode: ViewMode;
}

// Shared computation for all door types
interface DoorGeom {
  id: string;
  type: Door["type"];
  // Screen positions
  hingeScreen: { x: number; y: number };
  leafOpenScreen: { x: number; y: number };
  arcRadius: number;
  arcStartAngle: number;
  breakStart: { x: number; y: number };
  breakEnd: { x: number; y: number };
  wallAngleDeg: number;
  swingDir: "left" | "right";
  halfThick: number;
  // For double doors
  hinge2Screen?: { x: number; y: number };
  leaf2OpenScreen?: { x: number; y: number };
  arc2StartAngle?: number;
  // For sliding doors
  panelPoints?: number[];
  travelStart?: { x: number; y: number };
  travelEnd?: { x: number; y: number };
}

function DoorRendererBase({ doors, walls, viewport, viewMode }: DoorRendererProps) {
  const zoom = viewport.zoom;

  const doorShapes = useMemo(() => {
    return doors.map((door): DoorGeom | null => {
      const wall = walls.find((w) => w.id === door.wall_id);
      if (!wall) return null;

      const wallDir = lineDirection(wall.centerline);
      const wallNorm = perpendicularLeft(wallDir);
      const angle = wallAngle(wall);
      const halfThick = wall.thickness_mm / 2;

      const doorStart = addPoints(
        wall.centerline.start,
        scalePoint(wallDir, door.position_along_wall_mm),
      );
      const doorEnd = addPoints(doorStart, scalePoint(wallDir, door.width_mm));
      const doorCenter = addPoints(doorStart, scalePoint(wallDir, door.width_mm / 2));

      // Hinge (on wall face, at one edge of opening)
      const hingeWorld = door.swing_direction === "left"
        ? addPoints(doorStart, scalePoint(wallNorm, halfThick))
        : addPoints(doorEnd, scalePoint(wallNorm, halfThick));

      const leafOpenWorld = addPoints(hingeWorld, scalePoint(wallNorm, door.width_mm));

      const hingeScreen = worldToScreen(hingeWorld, viewport);
      const leafOpenScreen = worldToScreen(leafOpenWorld, viewport);
      const arcRadius = worldToScreenDistance(door.width_mm, viewport.zoom);

      const breakStart = worldToScreen(
        addPoints(doorStart, scalePoint(wallNorm, -halfThick)),
        viewport,
      );
      const breakEnd = worldToScreen(
        addPoints(doorEnd, scalePoint(wallNorm, halfThick)),
        viewport,
      );

      const wallAngleDeg = -(angle * 180) / Math.PI;
      let arcStartAngle: number;
      if (door.swing_direction === "left") {
        arcStartAngle = wallAngleDeg - 180;
      } else {
        arcStartAngle = wallAngleDeg;
      }

      const geom: DoorGeom = {
        id: door.id,
        type: door.type,
        hingeScreen,
        leafOpenScreen,
        arcRadius,
        arcStartAngle,
        breakStart,
        breakEnd,
        wallAngleDeg,
        swingDir: door.swing_direction,
        halfThick: worldToScreenDistance(halfThick, viewport.zoom),
      };

      // ── Double swing / French: second hinge at opposite side ──
      if (door.type === "double_swing" || door.type === "french") {
        const hinge2World = door.swing_direction === "left"
          ? addPoints(doorEnd, scalePoint(wallNorm, halfThick))
          : addPoints(doorStart, scalePoint(wallNorm, halfThick));
        const leaf2OpenWorld = addPoints(hinge2World, scalePoint(wallNorm, door.width_mm / 2));
        geom.hinge2Screen = worldToScreen(hinge2World, viewport);
        geom.leaf2OpenScreen = worldToScreen(leaf2OpenWorld, viewport);
        geom.arc2StartAngle = door.swing_direction === "left"
          ? wallAngleDeg
          : wallAngleDeg - 180;
        // Each leaf is half width
        geom.arcRadius = worldToScreenDistance(door.width_mm / 2, viewport.zoom);
      }

      // ── Sliding: panel rectangle + travel line ──
      if (door.type === "sliding" || door.type === "pocket" || door.type === "barn") {
        // Panel slides along wall, outside the opening
        const panelOffset = scalePoint(wallDir, -door.width_mm); // slides to start side
        const p1 = addPoints(doorStart, scalePoint(wallNorm, halfThick * 0.4));
        const p2 = addPoints(doorStart, scalePoint(wallNorm, -halfThick * 0.4));
        const p3 = addPoints(addPoints(p1, panelOffset), { x: 0, y: 0 });
        const p4 = addPoints(addPoints(p2, panelOffset), { x: 0, y: 0 });

        const s1 = worldToScreen(p1, viewport);
        const s2 = worldToScreen(p2, viewport);
        const s3 = worldToScreen(p3, viewport);
        const s4 = worldToScreen(p4, viewport);

        geom.panelPoints = [s3.x, s3.y, s1.x, s1.y, s2.x, s2.y, s4.x, s4.y];

        // Travel line (center of opening, along wall)
        const tc1 = worldToScreen(addPoints(doorStart, scalePoint(wallNorm, 0)), viewport);
        const tc2 = worldToScreen(addPoints(doorEnd, scalePoint(wallNorm, 0)), viewport);
        geom.travelStart = tc1;
        geom.travelEnd = tc2;
      }

      return geom;
    }).filter(Boolean) as DoorGeom[];
  }, [doors, walls, viewport.x, viewport.y, viewport.zoom, viewport.canvasWidth, viewport.canvasHeight]);

  const strokeColor = viewMode === "cad" ? "#1A1A1A" : "#555555";
  const arcColor = viewMode === "cad" ? "#444444" : "#888888";
  const leafWeight = lw("door-leaf", zoom);
  const arcWeight = lw("door-arc", zoom);
  const hingeRadius = Math.max(2, zoom * 30);

  return (
    <>
      {doorShapes.map((g) => {
        // ── Sliding / Pocket / Barn ──
        if (g.type === "sliding" || g.type === "pocket" || g.type === "barn") {
          const bMinX = Math.min(g.breakStart.x, g.breakEnd.x);
          const bMinY = Math.min(g.breakStart.y, g.breakEnd.y);
          const bMaxX = Math.max(g.breakStart.x, g.breakEnd.x);
          const bMaxY = Math.max(g.breakStart.y, g.breakEnd.y);
          return (
            <Group key={g.id}>
              {/* Wall break */}
              <KLine
                points={[
                  bMinX, bMinY,
                  bMaxX, bMinY,
                  bMaxX, bMaxY,
                  bMinX, bMaxY,
                ]}
                closed fill="#FFFFFF" stroke="transparent" listening={false}
              />
              {/* Door panel (solid filled rectangle) */}
              {g.panelPoints && (
                <KLine
                  points={g.panelPoints}
                  closed
                  stroke={strokeColor}
                  strokeWidth={leafWeight}
                  fill={viewMode === "cad" ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.03)"}
                  listening={false}
                />
              )}
              {/* Travel line (dashed) */}
              {g.travelStart && g.travelEnd && (
                <KLine
                  points={[g.travelStart.x, g.travelStart.y, g.travelEnd.x, g.travelEnd.y]}
                  stroke={arcColor}
                  strokeWidth={arcWeight}
                  dash={[4, 3]}
                  listening={false}
                />
              )}
              {/* Direction arrow (small triangle at travel end) */}
              {g.travelStart && g.travelEnd && (
                <KLine
                  points={[
                    g.travelEnd.x, g.travelEnd.y,
                    g.travelEnd.x + (g.travelStart.x - g.travelEnd.x) * 0.15 + (g.travelStart.y - g.travelEnd.y) * 0.08,
                    g.travelEnd.y + (g.travelStart.y - g.travelEnd.y) * 0.15 - (g.travelStart.x - g.travelEnd.x) * 0.08,
                    g.travelEnd.x + (g.travelStart.x - g.travelEnd.x) * 0.15 - (g.travelStart.y - g.travelEnd.y) * 0.08,
                    g.travelEnd.y + (g.travelStart.y - g.travelEnd.y) * 0.15 + (g.travelStart.x - g.travelEnd.x) * 0.08,
                  ]}
                  closed fill={arcColor}
                  stroke="transparent"
                  listening={false}
                />
              )}
            </Group>
          );
        }

        // ── Double Swing / French ──
        if ((g.type === "double_swing" || g.type === "french") && g.hinge2Screen) {
          const halfRadius = g.arcRadius;
          const dMinX = Math.min(g.breakStart.x, g.breakEnd.x);
          const dMinY = Math.min(g.breakStart.y, g.breakEnd.y);
          const dMaxX = Math.max(g.breakStart.x, g.breakEnd.x);
          const dMaxY = Math.max(g.breakStart.y, g.breakEnd.y);
          return (
            <Group key={g.id}>
              {/* Wall break */}
              <KLine
                points={[
                  dMinX, dMinY,
                  dMaxX, dMinY,
                  dMaxX, dMaxY,
                  dMinX, dMaxY,
                ]}
                closed fill="#FFFFFF" stroke="transparent" listening={false}
              />
              {/* Leaf 1 */}
              <KLine
                points={[g.hingeScreen.x, g.hingeScreen.y, g.leafOpenScreen.x, g.leafOpenScreen.y]}
                stroke={strokeColor} strokeWidth={leafWeight} listening={false}
              />
              {/* Arc 1 */}
              <Arc
                x={g.hingeScreen.x} y={g.hingeScreen.y}
                innerRadius={halfRadius} outerRadius={halfRadius}
                angle={90} rotation={g.arcStartAngle}
                stroke={arcColor} strokeWidth={arcWeight}
                dash={[4, 3]} listening={false}
              />
              {/* Hinge 1 */}
              <Circle
                x={g.hingeScreen.x} y={g.hingeScreen.y}
                radius={hingeRadius} fill={strokeColor} listening={false}
              />
              {/* Leaf 2 */}
              <KLine
                points={[g.hinge2Screen.x, g.hinge2Screen.y, g.leaf2OpenScreen!.x, g.leaf2OpenScreen!.y]}
                stroke={strokeColor} strokeWidth={leafWeight} listening={false}
              />
              {/* Arc 2 */}
              <Arc
                x={g.hinge2Screen.x} y={g.hinge2Screen.y}
                innerRadius={halfRadius} outerRadius={halfRadius}
                angle={90} rotation={g.arc2StartAngle!}
                stroke={arcColor} strokeWidth={arcWeight}
                dash={[4, 3]} listening={false}
              />
              {/* Hinge 2 */}
              <Circle
                x={g.hinge2Screen.x} y={g.hinge2Screen.y}
                radius={hingeRadius} fill={strokeColor} listening={false}
              />
              {/* French: glass lines on leaves */}
              {g.type === "french" && (
                <>
                  <KLine
                    points={[
                      (g.hingeScreen.x + g.leafOpenScreen.x) / 2 - 1,
                      (g.hingeScreen.y + g.leafOpenScreen.y) / 2 - 1,
                      (g.hingeScreen.x + g.leafOpenScreen.x) / 2 + 1,
                      (g.hingeScreen.y + g.leafOpenScreen.y) / 2 + 1,
                    ]}
                    stroke="#3B82F6" strokeWidth={arcWeight} dash={[2, 2]} listening={false}
                  />
                </>
              )}
            </Group>
          );
        }

        // ── Single Swing / Main Entrance (default) ──
        const isEntrance = g.type === "main_entrance";
        const lfW = isEntrance ? leafWeight * 1.4 : leafWeight;
        const hR = isEntrance ? hingeRadius * 1.3 : hingeRadius;
        const sMinX = Math.min(g.breakStart.x, g.breakEnd.x);
        const sMinY = Math.min(g.breakStart.y, g.breakEnd.y);
        const sMaxX = Math.max(g.breakStart.x, g.breakEnd.x);
        const sMaxY = Math.max(g.breakStart.y, g.breakEnd.y);

        return (
          <Group key={g.id}>
            {/* Wall break */}
            <KLine
              points={[
                sMinX, sMinY,
                sMaxX, sMinY,
                sMaxX, sMaxY,
                sMinX, sMaxY,
              ]}
              closed fill="#FFFFFF" stroke="transparent" listening={false}
            />
            {/* Door leaf */}
            <KLine
              points={[g.hingeScreen.x, g.hingeScreen.y, g.leafOpenScreen.x, g.leafOpenScreen.y]}
              stroke={strokeColor} strokeWidth={lfW} listening={false}
            />
            {/* Swing arc */}
            <Arc
              x={g.hingeScreen.x} y={g.hingeScreen.y}
              innerRadius={g.arcRadius} outerRadius={g.arcRadius}
              angle={90} rotation={g.arcStartAngle}
              stroke={arcColor} strokeWidth={arcWeight}
              dash={[4, 3]} listening={false}
            />
            {/* Hinge dot */}
            <Circle
              x={g.hingeScreen.x} y={g.hingeScreen.y}
              radius={hR} fill={strokeColor} listening={false}
            />
            {/* Main entrance: threshold line */}
            {isEntrance && (
              <KLine
                points={[
                  g.breakStart.x, (g.breakStart.y + g.breakEnd.y) / 2,
                  g.breakEnd.x, (g.breakStart.y + g.breakEnd.y) / 2,
                ]}
                stroke={strokeColor} strokeWidth={lfW * 0.6} listening={false}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

export const DoorRenderer = React.memo(DoorRendererBase);
