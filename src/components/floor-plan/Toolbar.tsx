"use client";

import React, { useState, useRef, useEffect } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import type { ViewMode } from "@/types/floor-plan-cad";
import { ExportMenu } from "./ExportMenu";

const VIEW_MODES: { id: ViewMode; label: string; shortcut: string }[] = [
  { id: "cad", label: "CAD", shortcut: "1" },
  { id: "presentation", label: "Presentation", shortcut: "2" },
  { id: "construction", label: "Construction", shortcut: "3" },
];

export function Toolbar() {
  const project = useFloorPlanStore((s) => s.project);
  const activeFloorId = useFloorPlanStore((s) => s.activeFloorId);
  const viewMode = useFloorPlanStore((s) => s.viewMode);
  const setViewMode = useFloorPlanStore((s) => s.setViewMode);
  const setActiveFloor = useFloorPlanStore((s) => s.setActiveFloor);
  const fitToView = useFloorPlanStore((s) => s.fitToView);
  const zoomIn = useFloorPlanStore((s) => s.zoomIn);
  const zoomOut = useFloorPlanStore((s) => s.zoomOut);
  const viewport = useFloorPlanStore((s) => s.viewport);
  const toggleLeftPanel = useFloorPlanStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useFloorPlanStore((s) => s.toggleRightPanel);
  const leftPanelOpen = useFloorPlanStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useFloorPlanStore((s) => s.rightPanelOpen);
  const undo = useFloorPlanStore((s) => s.undo);
  const redo = useFloorPlanStore((s) => s.redo);
  const canUndo = useFloorPlanStore((s) => s.canUndo());
  const canRedo = useFloorPlanStore((s) => s.canRedo());
  const exportMenuOpen = useFloorPlanStore((s) => s.exportMenuOpen);
  const setExportMenuOpen = useFloorPlanStore((s) => s.setExportMenuOpen);
  const furniturePanelOpen = useFloorPlanStore((s) => s.furniturePanelOpen);
  const toggleFurniturePanel = useFloorPlanStore((s) => s.toggleFurniturePanel);
  const addFloor = useFloorPlanStore((s) => s.addFloor);
  const copyFloor = useFloorPlanStore((s) => s.copyFloor);
  const rightPanelTab = useFloorPlanStore((s) => s.rightPanelTab);
  const setRightPanelTab = useFloorPlanStore((s) => s.setRightPanelTab);
  const vastuOverlayVisible = useFloorPlanStore((s) => s.vastuOverlayVisible);
  const toggleVastuOverlay = useFloorPlanStore((s) => s.toggleVastuOverlay);
  const projectModified = useFloorPlanStore((s) => s.projectModified);
  const saveToStorage = useFloorPlanStore((s) => s.saveToStorage);

  if (!project) return null;

  const floors = project.floors;
  const activeFloor = floors.find((f) => f.id === activeFloorId);
  const zoomPercent = Math.round(viewport.zoom * 1250);

  return (
    <div className="flex h-11 items-center border-b border-gray-200 bg-white px-3 gap-2 text-sm print:hidden">
      {/* Back button */}
      <button
        onClick={() => window.history.back()}
        className="flex items-center gap-1 rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </button>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Project name + save indicator */}
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-gray-800 truncate max-w-[200px]">{project.name}</span>
        {projectModified ? (
          <span className="text-[9px] font-medium text-amber-500">Modified</span>
        ) : (
          <span className="text-[9px] font-medium text-green-500">Saved</span>
        )}
      </div>

      {/* Floor selector + management */}
      <div className="flex items-center gap-1">
        <select
          value={activeFloorId ?? ""}
          onChange={(e) => setActiveFloor(e.target.value)}
          className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700"
        >
          {floors.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <button
          onClick={() => addFloor(`Floor ${floors.length + 1}`)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Add Floor"
          aria-label="Add Floor"
        >
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 3V11M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        {activeFloorId && (
          <button
            onClick={() => copyFloor(activeFloorId, `${activeFloor?.name ?? "Floor"} (Copy)`)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Duplicate Floor"
            aria-label="Duplicate Floor"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M10 4V3C10 2.44772 9.55228 2 9 2H3C2.44772 2 2 2.44772 2 3V9C2 9.55228 2.44772 10 3 10H4" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        )}
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* View mode tabs */}
      <div className="flex rounded-md border border-gray-200 overflow-hidden">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setViewMode(mode.id)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === mode.id
                ? "bg-gray-800 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
            title={`${mode.label} mode (${mode.shortcut})`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Save button */}
      <button
        onClick={saveToStorage}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          projectModified
            ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
            : "text-gray-400 hover:bg-gray-100"
        }`}
        title="Save (Ctrl+S)"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <path d="M11 12H3a1 1 0 01-1-1V3a1 1 0 011-1h6l3 3v7a1 1 0 01-1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9 12V8H5v4" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5 2v3h3" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        Save
      </button>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:pointer-events-none"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8H10C11.6569 8 13 9.34315 13 11V11C13 12.6569 11.6569 14 10 14H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M5 5L3 8L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:pointer-events-none"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 8H6C4.34315 8 3 9.34315 3 11V11C3 12.6569 4.34315 14 6 14H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M11 5L13 8L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button onClick={zoomOut} className="rounded p-1 text-gray-500 hover:bg-gray-100" title="Zoom Out" aria-label="Zoom Out">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        <span className="w-10 text-center text-xs font-mono text-gray-600">{zoomPercent}%</span>
        <button onClick={zoomIn} className="rounded p-1 text-gray-500 hover:bg-gray-100" title="Zoom In" aria-label="Zoom In">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 3V11M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        <button onClick={fitToView} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" title="Fit to View (F)">
          Fit
        </button>
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Export */}
      <div className="relative">
        <button
          onClick={() => setExportMenuOpen(!exportMenuOpen)}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            exportMenuOpen
              ? "bg-gray-800 text-white"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
          }`}
          title="Export floor plan (Ctrl+E)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2V9M7 9L4.5 6.5M7 9L9.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 10V11.5C2 12.0523 2.44772 12.5 3 12.5H11C11.5523 12.5 12 12.0523 12 11.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Export
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <ExportMenu />
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Print */}
      <button
        onClick={() => window.print()}
        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors"
        title="Print (Ctrl+P)"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <path d="M3.5 5V2h7v3M3.5 10H2.5a1 1 0 01-1-1V6.5a1 1 0 011-1h9a1 1 0 011 1V9a1 1 0 01-1 1h-1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="3.5" y="8.5" width="7" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
        </svg>
        Print
      </button>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Furniture panel toggle */}
      <button
        onClick={toggleFurniturePanel}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          furniturePanelOpen
            ? "bg-amber-100 text-amber-700"
            : "text-gray-500 hover:bg-gray-100"
        }`}
        title="Toggle Furniture Library"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <rect x="2" y="5" width="10" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="4" y1="10" x2="4" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="10" y1="10" x2="10" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        Furniture
      </button>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* AI Actions dropdown */}
      <AIDropdown />

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Analysis buttons */}
      <button
        onClick={() => setRightPanelTab("vastu")}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          rightPanelTab === "vastu"
            ? "bg-orange-100 text-orange-700"
            : "text-gray-500 hover:bg-gray-100"
        }`}
        title="Vastu Compliance Analysis"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
          <line x1="1.5" y1="7" x2="12.5" y2="7" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
          <line x1="7" y1="1.5" x2="7" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        Vastu
      </button>
      <button
        onClick={() => setRightPanelTab("code")}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          rightPanelTab === "code"
            ? "bg-blue-100 text-blue-700"
            : "text-gray-500 hover:bg-gray-100"
        }`}
        title="NBC 2016 Code Compliance Check"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5 5L6.5 6.5L5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="7.5" y1="8" x2="9.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        Code
      </button>
      <button
        onClick={() => setRightPanelTab("analytics")}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          rightPanelTab === "analytics"
            ? "bg-purple-100 text-purple-700"
            : "text-gray-500 hover:bg-gray-100"
        }`}
        title="Floor Plan Analytics Dashboard"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <rect x="1" y="8" width="3" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
          <rect x="5.5" y="5" width="3" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
          <rect x="10" y="2" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
        </svg>
        Analytics
      </button>
      <button
        onClick={() => setRightPanelTab("boq")}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          rightPanelTab === "boq"
            ? "bg-green-100 text-green-700"
            : "text-gray-500 hover:bg-gray-100"
        }`}
        title="Bill of Quantities"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block mr-1">
          <path d="M2 2h10v10H2V2z" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M2 5h10M2 8h10M5 2v10M8 2v10" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
        </svg>
        BOQ
      </button>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200" />

      {/* Panel toggles */}
      <button
        onClick={toggleLeftPanel}
        className={`rounded p-1 ${leftPanelOpen ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:bg-gray-50"}`}
        title="Toggle Tools Panel"
        aria-label="Toggle Tools Panel"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="5" y1="2" x2="5" y2="14" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>
      <button
        onClick={toggleRightPanel}
        className={`rounded p-1 ${rightPanelOpen ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:bg-gray-50"}`}
        title="Toggle Properties Panel"
        aria-label="Toggle Properties Panel"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="11" y1="2" x2="11" y2="14" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>
    </div>
  );
}

// ============================================================
// AI ACTIONS DROPDOWN
// ============================================================

function AIDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const autoPlaceDoors = useFloorPlanStore((s) => s.autoPlaceDoors);
  const autoPlaceWindows = useFloorPlanStore((s) => s.autoPlaceWindows);
  const autoFurnishAll = useFloorPlanStore((s) => s.autoFurnishAll);
  const lightOverlayVisible = useFloorPlanStore((s) => s.lightOverlayVisible);
  const toggleLightOverlay = useFloorPlanStore((s) => s.toggleLightOverlay);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          open
            ? "bg-violet-600 text-white"
            : "bg-violet-50 text-violet-700 hover:bg-violet-100"
        }`}
        title="AI-powered auto-placement and analysis"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="inline-block">
          <path d="M7 1L8.5 5H12.5L9.5 7.5L10.5 11.5L7 9L3.5 11.5L4.5 7.5L1.5 5H5.5L7 1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
        </svg>
        AI
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg z-50">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Auto-Placement</div>
          <button
            onClick={() => { autoPlaceDoors(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            <span className="w-4 text-center text-violet-500">D</span>
            Auto-place Doors
          </button>
          <button
            onClick={() => { autoPlaceWindows(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            <span className="w-4 text-center text-violet-500">W</span>
            Auto-place Windows
          </button>
          <button
            onClick={() => { autoFurnishAll(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            <span className="w-4 text-center text-violet-500">F</span>
            Smart Furnish All Rooms
          </button>
          <div className="my-1 h-px bg-gray-100" />
          <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Analysis Overlays</div>
          <button
            onClick={() => { toggleLightOverlay(); setOpen(false); }}
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            <span className="flex items-center gap-2">
              <span className="w-4 text-center text-amber-500">L</span>
              Natural Light Heatmap
            </span>
            {lightOverlayVisible && <span className="text-[10px] text-green-600 font-medium">ON</span>}
          </button>
        </div>
      )}
    </div>
  );
}
