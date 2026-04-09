"use client";

import React from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { formatDimension } from "@/features/floor-plan/lib/unit-conversion";

export function StatusBar() {
  const cursorWorldPos = useFloorPlanStore((s) => s.cursorWorldPos);
  const snapEnabled = useFloorPlanStore((s) => s.snapEnabled);
  const orthoEnabled = useFloorPlanStore((s) => s.orthoEnabled);
  const gridVisible = useFloorPlanStore((s) => s.gridVisible);
  const gridSize_mm = useFloorPlanStore((s) => s.gridSize_mm);
  const activeTool = useFloorPlanStore((s) => s.activeTool);
  const viewMode = useFloorPlanStore((s) => s.viewMode);
  const displayUnit = useFloorPlanStore((s) => s.project?.settings.display_unit ?? "m");
  const selectedIds = useFloorPlanStore((s) => s.selectedIds);
  const activeFloorName = useFloorPlanStore((s) => {
    const p = s.project;
    if (!p || !s.activeFloorId) return "";
    return p.floors.find((f) => f.id === s.activeFloorId)?.name ?? "";
  });
  const toggleSnap = useFloorPlanStore((s) => s.toggleSnap);
  const toggleOrtho = useFloorPlanStore((s) => s.toggleOrtho);
  const toggleGrid = useFloorPlanStore((s) => s.toggleGrid);

  return (
    <div className="flex h-7 items-center border-t border-gray-200 bg-gray-50 px-3 gap-4 text-[11px] text-gray-500 font-mono">
      {/* Cursor coordinates */}
      <div className="flex items-center gap-2">
        <span>
          X: {formatDimension(cursorWorldPos.x, displayUnit)}
        </span>
        <span>
          Y: {formatDimension(cursorWorldPos.y, displayUnit)}
        </span>
      </div>

      {/* Separator */}
      <div className="h-3 w-px bg-gray-300" />

      {/* Active tool */}
      <span className="text-gray-600 font-semibold uppercase">{activeTool}</span>

      {/* Separator */}
      <div className="h-3 w-px bg-gray-300" />

      {/* View mode */}
      <span>{viewMode.toUpperCase()}</span>

      {/* Separator */}
      <div className="h-3 w-px bg-gray-300" />

      {/* Floor name */}
      {activeFloorName && <span>{activeFloorName}</span>}

      {/* Selection count */}
      {selectedIds.length > 0 && (
        <>
          <div className="h-3 w-px bg-gray-300" />
          <span className="text-blue-600 font-semibold">{selectedIds.length} selected</span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Shortcut hint */}
      <span className="text-gray-400">Press ? for shortcuts</span>

      {/* Separator */}
      <div className="h-3 w-px bg-gray-300" />

      {/* Unit toggle */}
      <select
        value={displayUnit}
        onChange={(e) => useFloorPlanStore.getState().setDisplayUnit(e.target.value as any)}
        className="rounded border border-gray-200 bg-white px-1 py-0 text-[10px] font-bold text-gray-600 cursor-pointer outline-none"
        title="Display unit"
      >
        <option value="mm">MM</option>
        <option value="cm">CM</option>
        <option value="m">M</option>
        <option value="ft">FT</option>
        <option value="in">IN</option>
      </select>

      {/* Grid size selector */}
      <select
        value={gridSize_mm}
        onChange={(e) => useFloorPlanStore.getState().setGridSize(Number(e.target.value))}
        className="rounded border border-gray-200 bg-white px-1 py-0 text-[10px] text-gray-600 cursor-pointer outline-none"
        title="Grid size"
      >
        <option value="50">Grid 50mm</option>
        <option value="100">Grid 100mm</option>
        <option value="200">Grid 200mm</option>
        <option value="250">Grid 250mm</option>
        <option value="500">Grid 500mm</option>
        <option value="1000">Grid 1m</option>
      </select>

      {/* Toggle buttons */}
      <button
        onClick={toggleSnap}
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
          snapEnabled ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"
        }`}
        title="Toggle Snap (S)"
      >
        SNAP
      </button>
      <button
        onClick={toggleOrtho}
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
          orthoEnabled ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"
        }`}
        title="Toggle Ortho (O)"
      >
        ORTHO
      </button>
      <button
        onClick={toggleGrid}
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
          gridVisible ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"
        }`}
        title="Toggle Grid (G)"
      >
        GRID
      </button>
    </div>
  );
}
