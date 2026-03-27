"use client";

import React, { useState, useCallback } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import type { Wall, Room, Door, CadWindow } from "@/types/floor-plan-cad";
import { formatDimension, formatArea, type DisplayUnit } from "@/lib/floor-plan/unit-conversion";
import { wallLength, polygonBounds } from "@/lib/floor-plan/geometry";

export function PropertiesPanel() {
  const project = useFloorPlanStore((s) => s.project);
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const selectedIds = useFloorPlanStore((s) => s.selectedIds);
  const displayUnit = (project?.settings.display_unit ?? "m") as DisplayUnit;

  if (!floor) return null;

  // Find selected entities
  const selectedWall = floor.walls.find((w) => selectedIds.includes(w.id));
  const selectedRoom = floor.rooms.find((r) => selectedIds.includes(r.id));
  const selectedDoor = floor.doors.find((d) => selectedIds.includes(d.id));
  const selectedWindow = floor.windows.find((w) => selectedIds.includes(w.id));

  const hasSelection = selectedWall || selectedRoom || selectedDoor || selectedWindow;

  return (
    <div className="p-3 text-xs">
      {/* Dynamic entity properties */}
      {selectedWall && (
        <WallProperties wall={selectedWall} displayUnit={displayUnit} />
      )}
      {selectedDoor && (
        <DoorProperties door={selectedDoor} displayUnit={displayUnit} />
      )}
      {selectedWindow && (
        <WindowProperties window={selectedWindow} displayUnit={displayUnit} />
      )}
      {selectedRoom && (
        <RoomProperties room={selectedRoom} displayUnit={displayUnit} />
      )}

      {/* Separator if we have selection AND room schedule */}
      {hasSelection && <div className="my-3 h-px bg-gray-200" />}

      {/* Room Schedule */}
      <div className="mb-4">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Room Schedule
        </h3>
        <div className="space-y-1">
          {floor.rooms.map((room) => {
            const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
            const isSelected = selectedIds.includes(room.id);
            return (
              <div
                key={room.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                  isSelected ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-gray-100"
                }`}
                onClick={() => useFloorPlanStore.getState().setSelectedIds([room.id])}
              >
                <div
                  className="h-3 w-3 rounded-sm border"
                  style={{ backgroundColor: colors.fill, borderColor: colors.stroke }}
                />
                <span className="flex-1 truncate text-gray-700">{room.name}</span>
                <span className="text-gray-400 font-mono">
                  {formatArea(room.area_sqm, displayUnit)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Statistics */}
      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Statistics
        </h3>
        <div className="space-y-1.5">
          <StatRow label="Total Area" value={formatArea(floor.rooms.reduce((s, r) => s + r.area_sqm, 0), displayUnit)} />
          <StatRow label="Rooms" value={String(floor.rooms.length)} />
          <StatRow label="Walls" value={String(floor.walls.length)} />
          <StatRow label="Doors" value={String(floor.doors.length)} />
          <StatRow label="Windows" value={String(floor.windows.length)} />
          {(() => {
            const carpetArea = project?.metadata?.carpet_area_sqm;
            const totalArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
            if (carpetArea && totalArea > 0) {
              return (
                <StatRow
                  label="Efficiency"
                  value={`${Math.round((carpetArea / totalArea) * 100)}%`}
                />
              );
            }
            return null;
          })()}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// WALL PROPERTIES
// ============================================================

function WallProperties({ wall, displayUnit }: { wall: Wall; displayUnit: DisplayUnit }) {
  const store = useFloorPlanStore;

  const handleTypeChange = useCallback((type: string) => {
    const s = store.getState();
    s.pushHistory();
    s.updateWall(wall.id, { type: type as Wall["type"] });
  }, [wall.id]);

  const handleThicknessChange = useCallback((value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 50 || num > 1000) return;
    const s = store.getState();
    s.pushHistory();
    s.updateWall(wall.id, { thickness_mm: num });
  }, [wall.id]);

  const handleLoadBearing = useCallback(() => {
    const s = store.getState();
    s.pushHistory();
    s.updateWall(wall.id, { is_load_bearing: !wall.is_load_bearing });
  }, [wall.id, wall.is_load_bearing]);

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Wall Properties
      </h3>
      <div className="space-y-2">
        <PropRow label="Length" value={formatDimension(wallLength(wall), displayUnit)} />

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Type</span>
          <select
            value={wall.type}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700"
          >
            <option value="exterior">Exterior</option>
            <option value="interior">Interior</option>
            <option value="partition">Partition</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Thickness</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={wall.thickness_mm}
              onChange={(e) => handleThicknessChange(e.target.value)}
              className="w-16 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-right text-gray-700"
              min={50}
              max={1000}
              step={10}
            />
            <span className="text-gray-400 text-[10px]">mm</span>
          </div>
        </div>

        <PropRow label="Material" value={wall.material} />
        <PropRow label="Height" value={formatDimension(wall.height_mm, displayUnit)} />

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Load Bearing</span>
          <button
            onClick={handleLoadBearing}
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              wall.is_load_bearing
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {wall.is_load_bearing ? "Yes" : "No"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DOOR PROPERTIES
// ============================================================

function DoorProperties({ door, displayUnit }: { door: Door; displayUnit: DisplayUnit }) {
  const store = useFloorPlanStore;

  const handleWidthChange = useCallback((width: number) => {
    const s = store.getState();
    s.pushHistory();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;
    s.updateWall; // ensure store pattern
    // Direct set for door width
    const project = s.project;
    useFloorPlanStore.setState({
      project: {
        ...project,
        floors: project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, doors: f.doors.map((d) => d.id === door.id ? { ...d, width_mm: width } : d) }
            : f
        ),
      },
    });
  }, [door.id]);

  const handleFlip = useCallback(() => {
    const s = store.getState();
    s.setSelectedIds([door.id]);
    s.flipSelectedDoor();
  }, [door.id]);

  const presetWidths = [800, 900, 1000, 1050, 1200];

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Door Properties
      </h3>
      <div className="space-y-2">
        <PropRow label="Type" value={door.type.replace(/_/g, " ")} />

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Width</span>
          <span className="font-medium text-gray-800">{formatDimension(door.width_mm, displayUnit)}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {presetWidths.map((w) => (
            <button
              key={w}
              onClick={() => handleWidthChange(w)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                door.width_mm === w
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        <PropRow label="Height" value={formatDimension(door.height_mm, displayUnit)} />

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Swing</span>
          <button
            onClick={handleFlip}
            className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-200"
          >
            {door.swing_direction === "left" ? "Left" : "Right"} — Click to flip
          </button>
        </div>

        <PropRow label="Opens To" value={door.opens_to ?? "inside"} />
      </div>
    </div>
  );
}

// ============================================================
// WINDOW PROPERTIES
// ============================================================

function WindowProperties({ window: win, displayUnit }: { window: CadWindow; displayUnit: DisplayUnit }) {
  const presetWidths = [600, 900, 1200, 1500, 1800];

  const handleWidthChange = useCallback((width: number) => {
    const s = useFloorPlanStore.getState();
    s.pushHistory();
    const project = s.project;
    if (!project || !s.activeFloorId) return;
    useFloorPlanStore.setState({
      project: {
        ...project,
        floors: project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, windows: f.windows.map((w) => w.id === win.id ? { ...w, width_mm: width } : w) }
            : f
        ),
      },
    });
  }, [win.id]);

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Window Properties
      </h3>
      <div className="space-y-2">
        <PropRow label="Type" value={win.type.replace(/_/g, " ")} />

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Width</span>
          <span className="font-medium text-gray-800">{formatDimension(win.width_mm, displayUnit)}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {presetWidths.map((w) => (
            <button
              key={w}
              onClick={() => handleWidthChange(w)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                win.width_mm === w
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        <PropRow label="Height" value={formatDimension(win.height_mm, displayUnit)} />
        <PropRow label="Sill Height" value={formatDimension(win.sill_height_mm, displayUnit)} />
        <PropRow label="Glazing" value={win.glazing ?? "single"} />
      </div>
    </div>
  );
}

// ============================================================
// ROOM PROPERTIES
// ============================================================

function RoomProperties({ room, displayUnit }: { room: Room; displayUnit: DisplayUnit }) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(room.name);

  const handleNameSave = useCallback(() => {
    if (nameValue.trim() && nameValue !== room.name) {
      const s = useFloorPlanStore.getState();
      s.pushHistory();
      s.updateRoom(room.id, { name: nameValue.trim() });
    }
    setEditingName(false);
  }, [room.id, room.name, nameValue]);

  const handleTypeChange = useCallback((type: string) => {
    const s = useFloorPlanStore.getState();
    s.pushHistory();
    s.updateRoom(room.id, { type: type as Room["type"] });
  }, [room.id]);

  const bounds = polygonBounds(room.boundary.points);

  const commonTypes = [
    "living_room", "bedroom", "master_bedroom", "kitchen", "bathroom",
    "dining_room", "study", "corridor", "balcony", "utility",
    "pooja_room", "store_room", "guest_room",
  ];

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Room Properties
      </h3>
      <div className="space-y-2">
        {/* Editable name */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Name</span>
          {editingName ? (
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); if (e.key === "Escape") setEditingName(false); }}
              className="w-28 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setNameValue(room.name); setEditingName(true); }}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-800 hover:bg-gray-100"
            >
              {room.name}
            </button>
          )}
        </div>

        {/* Type dropdown */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Type</span>
          <select
            value={room.type}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700 capitalize"
          >
            {commonTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <PropRow label="Area" value={formatArea(room.area_sqm, displayUnit)} />
        <PropRow label="Dimensions" value={`${formatDimension(bounds.width, displayUnit)} × ${formatDimension(bounds.height, displayUnit)}`} />
        <PropRow label="Perimeter" value={formatDimension(room.perimeter_mm ?? 0, displayUnit)} />

        {room.vastu_direction && (
          <PropRow label="Vastu Direction" value={room.vastu_direction} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 capitalize">{value}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded bg-gray-100 px-2 py-1.5">
      <span className="text-gray-500">{label}</span>
      <span className="font-bold text-gray-800">{value}</span>
    </div>
  );
}
