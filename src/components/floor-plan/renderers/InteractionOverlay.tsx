"use client";

import React from "react";
import { Line as KLine, Rect, Circle, Group, Text } from "react-konva";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import type { Viewport } from "@/lib/floor-plan/geometry";
import type { SnapResult } from "@/lib/floor-plan/snap-engine";
import type { Floor } from "@/types/floor-plan-cad";
import {
  worldToScreen,
  distance,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
} from "@/lib/floor-plan/geometry";
import { formatDimension } from "@/lib/floor-plan/unit-conversion";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";
import type { Point } from "@/types/floor-plan-cad";

interface InteractionOverlayProps {
  viewport: Viewport;
}

/**
 * Renders transient interaction visuals:
 * - Wall drawing preview
 * - Ghost door/window placement
 * - Snap indicators
 * - Rubber band selection rectangle
 */
export function InteractionOverlay({ viewport }: InteractionOverlayProps) {
  const activeTool = useFloorPlanStore((s) => s.activeTool);
  const wallDrawStart = useFloorPlanStore((s) => s.wallDrawStart);
  const cursorWorldPos = useFloorPlanStore((s) => s.cursorWorldPos);
  const orthoEnabled = useFloorPlanStore((s) => s.orthoEnabled);
  const lastSnap = useFloorPlanStore((s) => s.lastSnap);
  const ghostDoor = useFloorPlanStore((s) => s.ghostDoor);
  const ghostWindow = useFloorPlanStore((s) => s.ghostWindow);
  const rubberBandStart = useFloorPlanStore((s) => s.rubberBandStart);
  const rubberBandEnd = useFloorPlanStore((s) => s.rubberBandEnd);
  const displayUnit = useFloorPlanStore((s) => s.project?.settings.display_unit ?? "m");
  const floor = useFloorPlanStore((s) => s.getActiveFloor());

  return (
    <>
      {/* Snap indicator */}
      {lastSnap && <SnapIndicator snap={lastSnap} viewport={viewport} />}

      {/* Wall drawing preview */}
      {activeTool === "wall" && wallDrawStart && (
        <WallPreview
          start={wallDrawStart}
          cursor={cursorWorldPos}
          ortho={orthoEnabled}
          viewport={viewport}
          displayUnit={displayUnit}
        />
      )}

      {/* Ghost door */}
      {activeTool === "door" && ghostDoor && floor && (
        <GhostDoor ghostDoor={ghostDoor} floor={floor} viewport={viewport} />
      )}

      {/* Ghost window */}
      {activeTool === "window" && ghostWindow && floor && (
        <GhostWindow ghostWindow={ghostWindow} floor={floor} viewport={viewport} />
      )}

      {/* Rubber band selection */}
      {rubberBandStart && rubberBandEnd && (
        <RubberBand start={rubberBandStart} end={rubberBandEnd} viewport={viewport} />
      )}
    </>
  );
}

// ============================================================
// SNAP INDICATOR
// ============================================================

function SnapIndicator({ snap, viewport }: { snap: SnapResult; viewport: Viewport }) {
  const screen = worldToScreen(snap.point, viewport);
  const size = 5;
  const color = "#FF00FF"; // Magenta — visible in all modes

  switch (snap.type) {
    case "endpoint":
      return (
        <Rect
          x={screen.x - size}
          y={screen.y - size}
          width={size * 2}
          height={size * 2}
          stroke={color}
          strokeWidth={1.5}
          listening={false}
        />
      );
    case "midpoint":
      return (
        <KLine
          points={[screen.x, screen.y - size, screen.x - size, screen.y + size, screen.x + size, screen.y + size]}
          closed
          stroke={color}
          strokeWidth={1.5}
          listening={false}
        />
      );
    case "intersection":
      return (
        <Group listening={false}>
          <KLine points={[screen.x - size, screen.y - size, screen.x + size, screen.y + size]} stroke={color} strokeWidth={1.5} />
          <KLine points={[screen.x + size, screen.y - size, screen.x - size, screen.y + size]} stroke={color} strokeWidth={1.5} />
        </Group>
      );
    case "face":
      return (
        <Circle x={screen.x} y={screen.y} radius={size} stroke={color} strokeWidth={1.5} listening={false} />
      );
    case "grid":
      return (
        <Group listening={false}>
          <KLine points={[screen.x - size, screen.y, screen.x + size, screen.y]} stroke={color} strokeWidth={1} />
          <KLine points={[screen.x, screen.y - size, screen.x, screen.y + size]} stroke={color} strokeWidth={1} />
        </Group>
      );
    default:
      return null;
  }
}

// ============================================================
// WALL DRAWING PREVIEW
// ============================================================

function WallPreview({
  start,
  cursor,
  ortho,
  viewport,
  displayUnit,
}: {
  start: Point;
  cursor: Point;
  ortho: boolean;
  viewport: Viewport;
  displayUnit: DisplayUnit;
}) {
  const wallThickness = useFloorPlanStore.getState().project?.settings.wall_thickness_mm || 150;

  // Apply ortho constraint
  let endWorld = cursor;
  if (ortho) {
    const dx = Math.abs(cursor.x - start.x);
    const dy = Math.abs(cursor.y - start.y);
    endWorld = dx >= dy ? { x: cursor.x, y: start.y } : { x: start.x, y: cursor.y };
  }

  const startScreen = worldToScreen(start, viewport);
  const endScreen = worldToScreen(endWorld, viewport);
  const len = distance(start, endWorld);
  const midX = (startScreen.x + endScreen.x) / 2;
  const midY = (startScreen.y + endScreen.y) / 2;

  // Wall thickness preview — compute quad corners
  const halfT = wallThickness / 2;
  const dir = len > 1 ? lineDirection({ start, end: endWorld }) : { x: 1, y: 0 };
  const norm = perpendicularLeft(dir);

  const c1 = worldToScreen(addPoints(start, scalePoint(norm, halfT)), viewport);
  const c2 = worldToScreen(addPoints(endWorld, scalePoint(norm, halfT)), viewport);
  const c3 = worldToScreen(addPoints(endWorld, scalePoint(norm, -halfT)), viewport);
  const c4 = worldToScreen(addPoints(start, scalePoint(norm, -halfT)), viewport);

  // Angle indicator
  const angleDeg = len > 50 ? Math.round(Math.atan2(-(endWorld.y - start.y), endWorld.x - start.x) * 180 / Math.PI) : 0;
  const normalizedAngle = ((angleDeg % 360) + 360) % 360;

  return (
    <Group listening={false}>
      {/* Wall thickness rectangle */}
      <KLine
        points={[c1.x, c1.y, c2.x, c2.y, c3.x, c3.y, c4.x, c4.y]}
        closed
        fill="rgba(239, 68, 68, 0.08)"
        stroke="#EF4444"
        strokeWidth={1}
        dash={[6, 3]}
      />

      {/* Centerline */}
      <KLine
        points={[startScreen.x, startScreen.y, endScreen.x, endScreen.y]}
        stroke="#EF4444"
        strokeWidth={1.5}
        dash={[8, 4]}
      />

      {/* Start dot */}
      <Circle x={startScreen.x} y={startScreen.y} radius={4} fill="#EF4444" />

      {/* End dot */}
      <Circle x={endScreen.x} y={endScreen.y} radius={4} fill="#EF4444" stroke="#FFFFFF" strokeWidth={1} />

      {/* Length label */}
      {len > 100 && (
        <>
          <Rect
            x={midX - 35}
            y={midY - 22}
            width={70}
            height={18}
            fill="rgba(239,68,68,0.9)"
            cornerRadius={3}
          />
          <Text
            x={midX - 35}
            y={midY - 19}
            width={70}
            text={formatDimension(len, displayUnit)}
            fontSize={11}
            fontFamily="Inter, system-ui, sans-serif"
            fontStyle="bold"
            fill="#FFFFFF"
            align="center"
          />
        </>
      )}

      {/* Angle indicator near start point */}
      {len > 200 && (
        <>
          <Rect
            x={startScreen.x + 12}
            y={startScreen.y - 20}
            width={36}
            height={16}
            fill="rgba(0,0,0,0.65)"
            cornerRadius={2}
          />
          <Text
            x={startScreen.x + 12}
            y={startScreen.y - 18}
            width={36}
            text={`${normalizedAngle}°`}
            fontSize={10}
            fontFamily="Inter, system-ui, sans-serif"
            fill="#FFFFFF"
            align="center"
          />
        </>
      )}
    </Group>
  );
}

// ============================================================
// GHOST DOOR
// ============================================================

function GhostDoor({
  ghostDoor,
  floor,
  viewport,
}: {
  ghostDoor: { wallId: string; position_mm: number };
  floor: Floor;
  viewport: Viewport;
}) {
  const wall = floor.walls.find((w) => w.id === ghostDoor.wallId);
  if (!wall) return null;

  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2;
  // Use context-aware width: bathroom=750, lobby/foyer=1050, default=900
  const adjRoomTypes: string[] = [wall.left_room_id, wall.right_room_id]
    .filter(Boolean)
    .map((rid) => floor.rooms.find((r) => r.id === rid)?.type ?? "")
    .filter(Boolean);
  const hasBathroom = adjRoomTypes.some((t: string) => ["bathroom", "toilet", "wc", "utility"].includes(t));
  const hasLobby = adjRoomTypes.some((t: string) => ["lobby", "foyer"].includes(t));
  const doorWidth = hasLobby ? 1050 : hasBathroom ? 750 : 900;

  const doorStart = addPoints(wall.centerline.start, scalePoint(dir, ghostDoor.position_mm));
  const doorEnd = addPoints(doorStart, scalePoint(dir, doorWidth));

  const hinge = addPoints(doorStart, scalePoint(norm, halfT));
  const leafEnd = addPoints(hinge, scalePoint(norm, doorWidth));

  const hingeScreen = worldToScreen(hinge, viewport);
  const leafScreen = worldToScreen(leafEnd, viewport);

  return (
    <Group listening={false} opacity={0.5}>
      {/* Door leaf line */}
      <KLine
        points={[hingeScreen.x, hingeScreen.y, leafScreen.x, leafScreen.y]}
        stroke="#EF4444"
        strokeWidth={2}
        dash={[6, 3]}
      />
      {/* Hinge dot */}
      <Circle x={hingeScreen.x} y={hingeScreen.y} radius={4} fill="#EF4444" />
    </Group>
  );
}

// ============================================================
// GHOST WINDOW
// ============================================================

function GhostWindow({
  ghostWindow,
  floor,
  viewport,
}: {
  ghostWindow: { wallId: string; position_mm: number };
  floor: Floor;
  viewport: Viewport;
}) {
  const wall = floor.walls.find((w) => w.id === ghostWindow.wallId);
  if (!wall) return null;

  const dir = lineDirection(wall.centerline);
  const norm = perpendicularLeft(dir);
  const halfT = wall.thickness_mm / 2;
  // Use context-aware width: bathroom=600, kitchen=900, default=1200
  const adjRoomTypes: string[] = [wall.left_room_id, wall.right_room_id]
    .filter(Boolean)
    .map((rid) => floor.rooms.find((r) => r.id === rid)?.type ?? "")
    .filter(Boolean);
  const hasBathroom = adjRoomTypes.some((t: string) => ["bathroom", "toilet", "wc"].includes(t));
  const hasKitchen = adjRoomTypes.some((t: string) => ["kitchen"].includes(t));
  const winWidth = hasBathroom ? 600 : hasKitchen ? 900 : 1200;

  const winStart = addPoints(wall.centerline.start, scalePoint(dir, ghostWindow.position_mm));
  const winEnd = addPoints(winStart, scalePoint(dir, winWidth));

  const outer1 = worldToScreen(addPoints(winStart, scalePoint(norm, halfT)), viewport);
  const outer2 = worldToScreen(addPoints(winEnd, scalePoint(norm, halfT)), viewport);
  const inner1 = worldToScreen(addPoints(winStart, scalePoint(norm, -halfT)), viewport);
  const inner2 = worldToScreen(addPoints(winEnd, scalePoint(norm, -halfT)), viewport);
  const glass1 = worldToScreen(winStart, viewport);
  const glass2 = worldToScreen(winEnd, viewport);

  return (
    <Group listening={false} opacity={0.5}>
      <KLine points={[outer1.x, outer1.y, outer2.x, outer2.y]} stroke="#10B981" strokeWidth={2} dash={[6, 3]} />
      <KLine points={[glass1.x, glass1.y, glass2.x, glass2.y]} stroke="#3B82F6" strokeWidth={3} dash={[6, 3]} />
      <KLine points={[inner1.x, inner1.y, inner2.x, inner2.y]} stroke="#10B981" strokeWidth={2} dash={[6, 3]} />
    </Group>
  );
}

// ============================================================
// RUBBER BAND SELECTION
// ============================================================

function RubberBand({
  start,
  end,
  viewport,
}: {
  start: Point;
  end: Point;
  viewport: Viewport;
}) {
  const s = worldToScreen(start, viewport);
  const e = worldToScreen(end, viewport);

  const x = Math.min(s.x, e.x);
  const y = Math.min(s.y, e.y);
  const w = Math.abs(e.x - s.x);
  const h = Math.abs(e.y - s.y);

  return (
    <Rect
      x={x}
      y={y}
      width={w}
      height={h}
      stroke="#3B82F6"
      strokeWidth={1}
      dash={[6, 3]}
      fill="rgba(59, 130, 246, 0.08)"
      listening={false}
    />
  );
}
