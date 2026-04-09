"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import type { Wall, Room, Door, CadWindow, DoorType, WindowType, FurnitureInstance } from "@/types/floor-plan-cad";
import { formatDimension, formatArea, type DisplayUnit } from "@/lib/floor-plan/unit-conversion";
import { wallLength, polygonBounds } from "@/features/floor-plan/lib/geometry";
import { getCatalogItem } from "@/features/floor-plan/lib/furniture-catalog";

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
  const selectedFurniture = floor.furniture.find((f) => selectedIds.includes(f.id));

  const hasSelection = selectedWall || selectedRoom || selectedDoor || selectedWindow || selectedFurniture;

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
      {selectedFurniture && (
        <FurnitureProperties furniture={selectedFurniture} displayUnit={displayUnit} />
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
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); useFloorPlanStore.getState().setSelectedIds([room.id]); } }}
                role="button"
                tabIndex={0}
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
            // Efficiency = total room area on THIS floor / floor footprint area
            // Per-floor calculation prevents >100% on multi-floor buildings
            const roomArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
            const bounds = floor.boundary?.points;
            if (bounds && bounds.length >= 3 && roomArea > 0) {
              const xs = bounds.map((p: { x: number }) => p.x);
              const ys = bounds.map((p: { y: number }) => p.y);
              const bw = (Math.max(...xs) - Math.min(...xs)) / 1000; // mm→m
              const bh = (Math.max(...ys) - Math.min(...ys)) / 1000;
              const footprint = bw * bh;
              if (footprint > 0) {
                const eff = Math.min(100, Math.round((roomArea / footprint) * 100));
                return <StatRow label="Efficiency" value={`${eff}%`} />;
              }
            }
            return null;
          })()}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DEBOUNCED NUMBER INPUT
// ============================================================

function DebouncedNumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "mm",
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(String(value));
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync when external value changes (e.g. undo)
  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const commit = useCallback((v: string) => {
    const num = parseInt(v, 10);
    if (!isNaN(num) && num >= min && num <= max) {
      onChange(num);
    }
  }, [onChange, min, max]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(v), 300);
  };

  const handleBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    commit(localValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (timerRef.current) clearTimeout(timerRef.current);
      commit(localValue);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-16 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-right text-gray-700 focus:border-blue-300 focus:ring-1 focus:ring-blue-200 focus:outline-none ${className}`}
        min={min}
        max={max}
        step={step}
      />
      <span className="text-gray-400 text-[10px]">{unit}</span>
    </div>
  );
}

// ============================================================
// WALL PROPERTIES
// ============================================================

function WallProperties({ wall, displayUnit }: { wall: Wall; displayUnit: DisplayUnit }) {
  const pushAndUpdate = useCallback((updates: Partial<Wall>) => {
    const s = useFloorPlanStore.getState();
    s.pushHistory();
    s.updateWall(wall.id, updates);
  }, [wall.id]);

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
            onChange={(e) => pushAndUpdate({ type: e.target.value as Wall["type"] })}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700"
          >
            <option value="exterior">Exterior</option>
            <option value="interior">Interior</option>
            <option value="partition">Partition</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Thickness</span>
          <DebouncedNumberInput
            value={wall.thickness_mm}
            onChange={(v) => pushAndUpdate({ thickness_mm: v })}
            min={50}
            max={1000}
            step={10}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Material</span>
          <select
            value={wall.material}
            onChange={(e) => pushAndUpdate({ material: e.target.value as Wall["material"] })}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700"
          >
            <option value="brick">Brick</option>
            <option value="concrete">Concrete</option>
            <option value="block">Block</option>
            <option value="drywall">Drywall</option>
            <option value="glass">Glass</option>
            <option value="stone">Stone</option>
            <option value="wood">Wood</option>
          </select>
        </div>

        <PropRow label="Height" value={formatDimension(wall.height_mm, displayUnit)} />

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Load Bearing</span>
          <button
            onClick={() => pushAndUpdate({ is_load_bearing: !wall.is_load_bearing })}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
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

const DOOR_TYPES: { value: DoorType; label: string }[] = [
  { value: "single_swing", label: "Single Swing" },
  { value: "double_swing", label: "Double Swing" },
  { value: "sliding", label: "Sliding" },
  { value: "pocket", label: "Pocket" },
  { value: "french", label: "French" },
  { value: "barn", label: "Barn" },
  { value: "bi_fold", label: "Bi-Fold" },
  { value: "pivot", label: "Pivot" },
  { value: "main_entrance", label: "Main Entrance" },
  { value: "service_entrance", label: "Service Entrance" },
];

function DoorProperties({ door, displayUnit }: { door: Door; displayUnit: DisplayUnit }) {
  const pushAndUpdate = useCallback((updates: Partial<Door>) => {
    const s = useFloorPlanStore.getState();
    s.pushHistory();
    s.updateDoor(door.id, updates);
  }, [door.id]);

  const handleFlip = useCallback(() => {
    const s = useFloorPlanStore.getState();
    s.setSelectedIds([door.id]);
    s.flipSelectedDoor();
  }, [door.id]);

  const presetWidths = [750, 800, 900, 1000, 1050, 1200];

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Door Properties
      </h3>
      <div className="space-y-2">
        {/* Type dropdown */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Type</span>
          <select
            value={door.type}
            onChange={(e) => pushAndUpdate({ type: e.target.value as DoorType })}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700"
          >
            {DOOR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Width with presets */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Width</span>
          <span className="font-medium text-gray-800">{formatDimension(door.width_mm, displayUnit)}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {presetWidths.map((w) => (
            <button
              key={w}
              onClick={() => pushAndUpdate({ width_mm: w })}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
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

        {/* Swing direction */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Swing</span>
          <button
            onClick={handleFlip}
            className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            {door.swing_direction === "left" ? "← Left" : "Right →"} — Flip
          </button>
        </div>

        {/* Opens to */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Opens To</span>
          <button
            onClick={() => pushAndUpdate({ opens_to: door.opens_to === "inside" ? "outside" : "inside" })}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              door.opens_to === "outside"
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {door.opens_to === "inside" ? "Inside" : "Outside"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// WINDOW PROPERTIES
// ============================================================

const WINDOW_TYPES: { value: WindowType; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "casement", label: "Casement" },
  { value: "sliding", label: "Sliding" },
  { value: "awning", label: "Awning" },
  { value: "hopper", label: "Hopper" },
  { value: "double_hung", label: "Double Hung" },
  { value: "louvered", label: "Louvered" },
  { value: "bay", label: "Bay" },
  { value: "french", label: "French" },
];

function WindowProperties({ window: win, displayUnit }: { window: CadWindow; displayUnit: DisplayUnit }) {
  const pushAndUpdate = useCallback((updates: Partial<CadWindow>) => {
    const s = useFloorPlanStore.getState();
    s.pushHistory();
    s.updateWindowEntity(win.id, updates);
  }, [win.id]);

  const presetWidths = [600, 900, 1200, 1500, 1800];

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Window Properties
      </h3>
      <div className="space-y-2">
        {/* Type dropdown */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Type</span>
          <select
            value={win.type}
            onChange={(e) => pushAndUpdate({ type: e.target.value as WindowType })}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700"
          >
            {WINDOW_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Width with presets */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Width</span>
          <span className="font-medium text-gray-800">{formatDimension(win.width_mm, displayUnit)}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {presetWidths.map((w) => (
            <button
              key={w}
              onClick={() => pushAndUpdate({ width_mm: w })}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                win.width_mm === w
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        {/* Height */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Height</span>
          <DebouncedNumberInput
            value={win.height_mm}
            onChange={(v) => pushAndUpdate({ height_mm: v })}
            min={300}
            max={3000}
            step={50}
          />
        </div>

        {/* Sill height */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Sill Height</span>
          <DebouncedNumberInput
            value={win.sill_height_mm}
            onChange={(v) => pushAndUpdate({ sill_height_mm: v })}
            min={0}
            max={2500}
            step={50}
          />
        </div>

        {/* Glazing */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Glazing</span>
          <select
            value={win.glazing}
            onChange={(e) => pushAndUpdate({ glazing: e.target.value as CadWindow["glazing"] })}
            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700"
          >
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="triple">Triple</option>
          </select>
        </div>
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

  // Sync when room changes (e.g. select different room)
  useEffect(() => {
    setNameValue(room.name);
    setEditingName(false);
  }, [room.id, room.name]);

  const handleNameSave = useCallback(() => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      // Revert to previous name if empty
      setNameValue(room.name);
    } else if (trimmed !== room.name) {
      const s = useFloorPlanStore.getState();
      s.pushHistory();
      s.updateRoom(room.id, { name: trimmed });
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
    "pooja_room", "store_room", "guest_room", "walk_in_closet",
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
// FURNITURE PROPERTIES
// ============================================================

function FurnitureProperties({ furniture, displayUnit }: { furniture: FurnitureInstance; displayUnit: DisplayUnit }) {
  const catalog = getCatalogItem(furniture.catalog_id);
  const name = catalog?.name ?? "Unknown";

  const pushAndUpdate = useCallback((updates: Partial<FurnitureInstance>) => {
    const s = useFloorPlanStore.getState();
    s.pushHistory();
    s.updateFurnitureProps(furniture.id, updates);
  }, [furniture.id]);

  const rotationPresets = [0, 90, 180, 270];

  return (
    <div className="mb-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Furniture Properties
      </h3>
      <div className="space-y-2">
        <PropRow label="Name" value={name} />
        {catalog && (
          <PropRow label="Size" value={`${formatDimension(catalog.width_mm, displayUnit)} × ${formatDimension(catalog.depth_mm, displayUnit)}`} />
        )}

        {/* Rotation presets */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Rotation</span>
          <span className="font-medium text-gray-800">{furniture.rotation_deg}°</span>
        </div>
        <div className="flex gap-1">
          {rotationPresets.map((deg) => (
            <button
              key={deg}
              onClick={() => pushAndUpdate({ rotation_deg: deg })}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                furniture.rotation_deg === deg
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {deg}°
            </button>
          ))}
        </div>

        {/* Position X */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Position X</span>
          <DebouncedNumberInput
            value={Math.round(furniture.position.x)}
            onChange={(v) => pushAndUpdate({ position: { ...furniture.position, x: v } })}
            min={-50000}
            max={50000}
            step={50}
          />
        </div>

        {/* Position Y */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Position Y</span>
          <DebouncedNumberInput
            value={Math.round(furniture.position.y)}
            onChange={(v) => pushAndUpdate({ position: { ...furniture.position, y: v } })}
            min={-50000}
            max={50000}
            step={50}
          />
        </div>

        {/* Lock toggle */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Locked</span>
          <button
            onClick={() => pushAndUpdate({ locked: !furniture.locked })}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              furniture.locked
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {furniture.locked ? "Locked" : "Unlocked"}
          </button>
        </div>
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
