"use client";

import React, { useMemo } from "react";
import { Line as KLine, Rect, Circle, Group, Text } from "react-konva";
import type { Floor, Point } from "@/types/floor-plan-cad";
import type { Viewport } from "@/lib/floor-plan/geometry";
import {
  worldToScreen,
  wallToRectangle,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  midpoint,
  polygonBounds,
} from "@/lib/floor-plan/geometry";

interface SelectionRendererProps {
  selectedIds: string[];
  floor: Floor;
  viewport: Viewport;
}

const SEL_COLOR = "#3B82F6";
const HANDLE_SIZE = 8; // px

export function SelectionRenderer({ selectedIds, floor, viewport }: SelectionRendererProps) {
  const elements = useMemo(() => {
    if (selectedIds.length === 0) return [];
    return selectedIds.map((id) => {
      // Wall
      const wall = floor.walls.find((w) => w.id === id);
      if (wall) return { type: "wall" as const, id, entity: wall };
      // Door
      const door = floor.doors.find((d) => d.id === id);
      if (door) return { type: "door" as const, id, entity: door };
      // Window
      const win = floor.windows.find((w) => w.id === id);
      if (win) return { type: "window" as const, id, entity: win };
      // Room
      const room = floor.rooms.find((r) => r.id === id);
      if (room) return { type: "room" as const, id, entity: room };
      return null;
    }).filter(Boolean);
  }, [selectedIds, floor]);

  return (
    <>
      {elements.map((el) => {
        if (!el) return null;
        switch (el.type) {
          case "wall":
            return <WallSelection key={el.id} wall={el.entity} viewport={viewport} />;
          case "door":
            return <DoorSelection key={el.id} door={el.entity} floor={floor} viewport={viewport} />;
          case "window":
            return <WindowSelection key={el.id} window={el.entity} floor={floor} viewport={viewport} />;
          case "room":
            return <RoomSelection key={el.id} room={el.entity} viewport={viewport} />;
          default:
            return null;
        }
      })}
    </>
  );
}

// ============================================================
// WALL SELECTION
// ============================================================

function WallSelection({ wall, viewport }: { wall: any; viewport: Viewport }) {
  const corners = wallToRectangle(wall);
  const screenPts = corners.map((p: Point) => worldToScreen(p, viewport));
  const points = screenPts.flatMap((p: Point) => [p.x, p.y]);

  // Endpoint handles
  const startScreen = worldToScreen(wall.centerline.start, viewport);
  const endScreen = worldToScreen(wall.centerline.end, viewport);
  const mid = midpoint(wall.centerline.start, wall.centerline.end);
  const midScreen = worldToScreen(mid, viewport);

  const hs = HANDLE_SIZE / 2;

  return (
    <Group listening={false}>
      {/* Blue highlight overlay */}
      <KLine
        points={points}
        closed
        fill="rgba(59, 130, 246, 0.15)"
        stroke={SEL_COLOR}
        strokeWidth={2}
      />

      {/* Endpoint handle: start */}
      <Rect
        x={startScreen.x - hs}
        y={startScreen.y - hs}
        width={HANDLE_SIZE}
        height={HANDLE_SIZE}
        fill="#FFFFFF"
        stroke={SEL_COLOR}
        strokeWidth={1.5}
      />

      {/* Endpoint handle: end */}
      <Rect
        x={endScreen.x - hs}
        y={endScreen.y - hs}
        width={HANDLE_SIZE}
        height={HANDLE_SIZE}
        fill="#FFFFFF"
        stroke={SEL_COLOR}
        strokeWidth={1.5}
      />

      {/* Midpoint handle (diamond shape using rotated square) */}
      <Rect
        x={midScreen.x - hs}
        y={midScreen.y - hs}
        width={HANDLE_SIZE}
        height={HANDLE_SIZE}
        fill={SEL_COLOR}
        stroke="#FFFFFF"
        strokeWidth={1}
        rotation={45}
        offsetX={0}
        offsetY={0}
      />
    </Group>
  );
}

// ============================================================
// DOOR SELECTION
// ============================================================

function DoorSelection({ door, floor, viewport }: { door: any; floor: Floor; viewport: Viewport }) {
  const wall = floor.walls.find((w) => w.id === door.wall_id);
  if (!wall) return null;

  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2 + 50; // slight padding

  const start = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm));
  const end = addPoints(start, scalePoint(dir, door.width_mm));

  const p1 = worldToScreen(addPoints(start, scalePoint(norm, halfT)), viewport);
  const p2 = worldToScreen(addPoints(end, scalePoint(norm, halfT)), viewport);
  const p3 = worldToScreen(addPoints(end, scalePoint(norm, -halfT)), viewport);
  const p4 = worldToScreen(addPoints(start, scalePoint(norm, -halfT)), viewport);

  // Slide handle at center
  const center = worldToScreen(
    addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm + door.width_mm / 2)),
    viewport
  );

  return (
    <Group listening={false}>
      <KLine
        points={[p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y]}
        closed
        stroke={SEL_COLOR}
        strokeWidth={1.5}
        dash={[4, 3]}
        fill="rgba(59, 130, 246, 0.1)"
      />
      {/* Slide handle */}
      <Circle
        x={center.x}
        y={center.y}
        radius={5}
        fill={SEL_COLOR}
        stroke="#FFFFFF"
        strokeWidth={1.5}
      />
    </Group>
  );
}

// ============================================================
// WINDOW SELECTION
// ============================================================

function WindowSelection({ window: win, floor, viewport }: { window: any; floor: Floor; viewport: Viewport }) {
  const wall = floor.walls.find((w) => w.id === win.wall_id);
  if (!wall) return null;

  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2 + 50;

  const start = addPoints(wall.centerline.start, scalePoint(dir, win.position_along_wall_mm));
  const end = addPoints(start, scalePoint(dir, win.width_mm));

  const p1 = worldToScreen(addPoints(start, scalePoint(norm, halfT)), viewport);
  const p2 = worldToScreen(addPoints(end, scalePoint(norm, halfT)), viewport);
  const p3 = worldToScreen(addPoints(end, scalePoint(norm, -halfT)), viewport);
  const p4 = worldToScreen(addPoints(start, scalePoint(norm, -halfT)), viewport);

  const center = worldToScreen(
    addPoints(wall.centerline.start, scalePoint(dir, win.position_along_wall_mm + win.width_mm / 2)),
    viewport
  );

  return (
    <Group listening={false}>
      <KLine
        points={[p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y]}
        closed
        stroke={SEL_COLOR}
        strokeWidth={1.5}
        dash={[4, 3]}
        fill="rgba(59, 130, 246, 0.1)"
      />
      <Circle
        x={center.x}
        y={center.y}
        radius={5}
        fill={SEL_COLOR}
        stroke="#FFFFFF"
        strokeWidth={1.5}
      />
    </Group>
  );
}

// ============================================================
// ROOM SELECTION
// ============================================================

function RoomSelection({ room, viewport }: { room: any; viewport: Viewport }) {
  const screenPts = room.boundary.points.map((p: Point) => worldToScreen(p, viewport));
  const points = screenPts.flatMap((p: Point) => [p.x, p.y]);

  return (
    <Group listening={false}>
      <KLine
        points={points}
        closed
        fill="rgba(59, 130, 246, 0.1)"
        stroke={SEL_COLOR}
        strokeWidth={1.5}
        dash={[6, 4]}
      />
    </Group>
  );
}
