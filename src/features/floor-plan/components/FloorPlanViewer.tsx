"use client";

import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import { FloorPlanCanvas } from "@/features/floor-plan/components/FloorPlanCanvas";
import { Toolbar } from "@/features/floor-plan/components/Toolbar";
import { StatusBar } from "@/features/floor-plan/components/StatusBar";
import { ToolPanel } from "@/features/floor-plan/components/panels/ToolPanel";
import { PropertiesPanel } from "@/features/floor-plan/components/panels/PropertiesPanel";
import { LayerPanel } from "@/features/floor-plan/components/panels/LayerPanel";
import { ContextMenu } from "@/features/floor-plan/components/ContextMenu";
import { ShortcutOverlay } from "@/features/floor-plan/components/ShortcutOverlay";
import { FurniturePanel } from "@/features/floor-plan/components/panels/FurniturePanel";
import { VastuPanel } from "@/features/floor-plan/components/panels/VastuPanel";
import { CodeCompliancePanel } from "@/features/floor-plan/components/panels/CodeCompliancePanel";
import { AnalyticsPanel } from "@/features/floor-plan/components/panels/AnalyticsPanel";
import { BOQPanel } from "@/features/floor-plan/components/panels/BOQPanel";
import { ProgramPanel } from "@/features/floor-plan/components/panels/ProgramPanel";
import { WelcomeScreen } from "@/features/floor-plan/components/WelcomeScreen";
import { GenerationLoader } from "@/features/floor-plan/components/GenerationLoader";
import { getProjectIndex, importProjectFile } from "@/features/floor-plan/lib/project-persistence";
import { getSampleProjectForPrompt } from "@/features/floor-plan/lib/sample-layouts";
import { FloorPlanErrorBoundary } from "@/features/floor-plan/components/ErrorBoundary";
import { displayToMm, formatDimension, type DisplayUnit } from "@/features/floor-plan/lib/unit-conversion";
import { worldToScreen, screenToWorld } from "@/features/floor-plan/lib/geometry";

interface FloorPlanViewerProps {
  /** Pre-loaded geometry from pipeline (e.g. navigated from result showcase) */
  initialGeometry?: import("@/features/floor-plan/types/floor-plan").FloorPlanGeometry;
  initialPrompt?: string;
  initialProjectId?: string;
  /** Pre-loaded FloorPlanProject from workflow node (GN-012) */
  initialProject?: import("@/types/floor-plan-cad").FloorPlanProject;
}

export function FloorPlanViewer({ initialGeometry, initialPrompt, initialProjectId, initialProject }: FloorPlanViewerProps) {
  const project = useFloorPlanStore((s) => s.project);
  const leftPanelOpen = useFloorPlanStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useFloorPlanStore((s) => s.rightPanelOpen);
  const furniturePanelOpen = useFloorPlanStore((s) => s.furniturePanelOpen);
  const rightPanelTab = useFloorPlanStore((s) => s.rightPanelTab);
  const setRightPanelTab = useFloorPlanStore((s) => s.setRightPanelTab);
  const isGenerating = useFloorPlanStore((s) => s.isGenerating);
  const generationStep = useFloorPlanStore((s) => s.generationStep);
  const generationProgress = useFloorPlanStore((s) => s.generationProgress);
  const originalPrompt = useFloorPlanStore((s) => s.originalPrompt);
  const dataSource = useFloorPlanStore((s) => s.dataSource);

  const loadFromGeometry = useFloorPlanStore((s) => s.loadFromGeometry);
  const loadFromSaved = useFloorPlanStore((s) => s.loadFromSaved);
  const loadSample = useFloorPlanStore((s) => s.loadSample);
  const startBlank = useFloorPlanStore((s) => s.startBlank);

  // Load from props on mount (e.g. navigated from result showcase or URL params)
  useEffect(() => {
    if (initialProject) {
      // Direct FloorPlanProject from workflow node (GN-012)
      const store = useFloorPlanStore.getState();
      store.setProject(initialProject);
      useFloorPlanStore.setState({
        dataSource: "pipeline",
        originalPrompt: null,
        projectModified: false,
      });
    } else if (initialGeometry) {
      loadFromGeometry(initialGeometry, undefined, initialPrompt);
    } else if (initialProjectId) {
      loadFromSaved(initialProjectId);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on project changes (debounced)
  useEffect(() => {
    if (!project || dataSource === null) return;
    const timer = setTimeout(() => {
      const { saveToStorage, setProjectModified } = useFloorPlanStore.getState();
      saveToStorage();
      setProjectModified(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [project, dataSource]);

  // Saved projects for welcome screen (only compute when no project loaded)
  const savedProjects = useMemo(() => {
    if (project) return []; // Don't need this when editor is open
    try { return getProjectIndex(); }
    catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!project]); // Re-check when project presence changes

  const [fallbackBanner, setFallbackBanner] = React.useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const undoToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleGenerateFromPrompt = useCallback(async (prompt: string) => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const store = useFloorPlanStore.getState();
    store.startGeneration(prompt);
    setFallbackBanner(null);

    // Show progress steps while API call runs
    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    const steps = [
      { step: "analyzing", progress: 10, delay: 300 },
      { step: "generating", progress: 25, delay: 500 },
      { step: "placing_walls", progress: 40, delay: 600 },
      { step: "adding_rooms", progress: 55, delay: 700 },
      { step: "doors_windows", progress: 70, delay: 800 },
    ];
    let cum = 0;
    for (const s of steps) {
      cum += s.delay;
      stepTimers.push(setTimeout(() => store.updateGenerationStep(s.step, s.progress), cum));
    }

    try {
      const res = await fetch("/api/generate-floor-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      // Clear animation timers
      for (const t of stepTimers) clearTimeout(t);

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      store.updateGenerationStep("finalizing", 90);

      // Brief pause to show finalizing step
      await new Promise((r) => setTimeout(r, 400));
      store.updateGenerationStep("complete", 100);
      await new Promise((r) => setTimeout(r, 600));

      // Load the AI-generated project
      store.setProject(data.project);
      useFloorPlanStore.setState({
        isGenerating: false,
        dataSource: "pipeline",
        originalPrompt: prompt,
        projectModified: false,
      });
    } catch (err) {
      // Clear animation timers
      for (const t of stepTimers) clearTimeout(t);

      if (controller.signal.aborted) return; // User navigated away

      console.warn("[FloorPlanViewer] AI generation failed, using BHK-matched sample:", err);

      // Fallback: load BHK-matched sample data instead of always 2BHK
      store.updateGenerationStep("finalizing", 90);
      await new Promise((r) => setTimeout(r, 300));
      store.updateGenerationStep("complete", 100);
      await new Promise((r) => setTimeout(r, 500));

      const fallbackProject = getSampleProjectForPrompt(prompt);
      store.setProject(fallbackProject);
      useFloorPlanStore.setState({
        isGenerating: false,
        dataSource: "sample",
        originalPrompt: prompt,
        projectModified: false,
      });

      const message = err instanceof Error ? err.message : String(err);
      if (message === "NO_API_KEY") {
        setFallbackBanner("AI generation unavailable (no API key configured). Showing sample layout.");
      } else {
        setFallbackBanner(`AI generation failed: ${message}. Showing sample layout.`);
      }
    }
  }, []);

  const handleImportFile = useCallback(async () => {
    const project = await importProjectFile();
    if (project) {
      const store = useFloorPlanStore.getState();
      store.setProject(project);
      useFloorPlanStore.setState({
        dataSource: "saved",
        originalPrompt: null,
        projectModified: false,
      });
    }
  }, []);

  // Undo toast helper
  const showUndoToast = useCallback((label: string) => {
    if (undoToastTimer.current) clearTimeout(undoToastTimer.current);
    setUndoToast(label);
    undoToastTimer.current = setTimeout(() => setUndoToast(null), 1500);
  }, []);

  // Double-click room label → inline edit
  const handleCanvasDblClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    try {
      const store = useFloorPlanStore.getState();
      if (store.activeTool !== "select") return;
      const floor = store.getActiveFloor();
      if (!floor) return;

      // Get canvas container and compute click position relative to it
      const container = (e.currentTarget as HTMLElement);
      const rect = container.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPt = screenToWorld(screenPt, store.viewport);

      // Hit-test rooms by checking if click is inside room label area
      for (const room of floor.rooms) {
        const lp = room.label_position;
        if (!lp) continue;
        // ~500mm radius around label center
        const dx = worldPt.x - lp.x;
        const dy = worldPt.y - lp.y;
        if (dx * dx + dy * dy < 500 * 500) {
          setEditingRoomId(room.id);
          return;
        }
      }
    } catch { /* non-critical */ }
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const store = useFloorPlanStore.getState();
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    switch (e.key.toLowerCase()) {
      case "escape":
        if (store.contextMenu) {
          store.setContextMenu(null);
        } else if (store.wallDrawStart) {
          store.setWallDrawStart(null);
        } else if (store.activeTool === "measure" && (store.measureStart || store.measureEnd)) {
          store.setMeasureStart(null);
          store.setMeasureEnd(null);
        } else if (store.exportMenuOpen) {
          store.setExportMenuOpen(false);
        } else if (store.activeTool !== "select") {
          store.setActiveTool("select");
        } else if (store.selectedIds.length > 0) {
          store.clearSelection();
        }
        break;
      case "v":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          store.pasteAtCursor();
        } else {
          store.setActiveTool("select");
        }
        break;
      case "l":
        store.setActiveTool("wall");
        break;
      case "d":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          store.duplicateSelected();
        } else {
          store.setActiveTool("door");
        }
        break;
      case "w":
        store.setActiveTool("window");
        break;
      case "m":
        store.setActiveTool("measure");
        break;
      case "t":
        store.setActiveTool("annotate");
        break;
      case "g":
        store.toggleGrid();
        break;
      case "s":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          store.saveToStorage();
        } else {
          store.toggleSnap();
        }
        break;
      case "o":
        store.toggleOrtho();
        break;
      case "f":
        if (e.ctrlKey || e.metaKey) break;
        if (store.selectedIds.length > 0) {
          const flr = store.getActiveFloor();
          if (flr) {
            const hasDoor = store.selectedIds.some((id) => flr.doors.some((d) => d.id === id));
            if (hasDoor) {
              store.flipSelectedDoor();
              break;
            }
          }
        }
        store.fitToView();
        break;
      case "1":
        store.setViewMode("cad");
        break;
      case "2":
        store.setViewMode("presentation");
        break;
      case "3":
        store.setViewMode("construction");
        break;
      case "p":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          // Print
          window.print();
        } else if (store.activeTool === "measure" && store.measureStart && store.measureEnd) {
          store.pinMeasurement();
        }
        break;
      case "e":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          store.setExportMenuOpen(!store.exportMenuOpen);
        }
        break;
      case "r":
        if (!e.ctrlKey && !e.metaKey && store.selectedIds.length > 0) {
          const flr = store.getActiveFloor();
          if (flr) {
            const furnId = store.selectedIds.find((id) => flr.furniture.some((fi) => fi.id === id));
            if (furnId) {
              store.rotateFurniture(furnId, 90);
            }
          }
        }
        break;
      case "c":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          store.copySelected();
        } else {
          store.setActiveTool("column");
        }
        break;
      case "x":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          store.cutSelected();
        }
        break;
      case "z":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) {
            if (store.canRedo()) {
              store.redo();
              showUndoToast("Redo");
            }
          } else {
            if (store.canUndo()) {
              store.undo();
              showUndoToast("Undo");
            }
          }
        }
        break;
      case "delete":
      case "backspace":
        if (store.selectedIds.length > 0) {
          store.deleteSelectedEntities();
        }
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Show generation loader
  if (isGenerating) {
    return (
      <div className="flex h-screen flex-col bg-white overflow-hidden select-none">
        <GenerationLoader
          step={generationStep}
          progress={generationProgress}
          prompt={originalPrompt ?? undefined}
        />
      </div>
    );
  }

  // Show welcome screen when no project
  if (!project) {
    return (
      <div className="flex h-screen flex-col bg-white overflow-hidden select-none">
        <WelcomeScreen
          onGenerateFromPrompt={handleGenerateFromPrompt}
          onOpenSample={loadSample}
          onStartBlank={startBlank}
          onOpenSaved={loadFromSaved}
          onImportFile={handleImportFile}
          savedProjects={savedProjects}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white overflow-hidden select-none print:overflow-visible">
      {/* Fallback warning banner */}
      {fallbackBanner && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 print:hidden">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
            <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="truncate">{fallbackBanner}</span>
          <button
            onClick={() => setFallbackBanner(null)}
            className="ml-auto shrink-0 text-amber-500 hover:text-amber-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* "Generated from" banner */}
      {dataSource === "pipeline" && originalPrompt && (
        <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-700 print:hidden">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="truncate">
            Generated from: &ldquo;{originalPrompt}&rdquo;
          </span>
          <button
            onClick={() => handleGenerateFromPrompt(originalPrompt)}
            className="ml-auto shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
          >
            Regenerate
          </button>
        </div>
      )}

      {/* Top Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden print:block">
        {/* Left Panel: Tools + Layers (+ Furniture) */}
        {leftPanelOpen && (
          <div className="flex w-[240px] flex-col border-r border-gray-200 bg-gray-50 overflow-y-auto print:hidden">
            <FloorPlanErrorBoundary fallbackLabel="Tools">
              <ToolPanel />
              <div className="border-t border-gray-200" />
              {furniturePanelOpen && (
                <>
                  <FurniturePanel />
                  <div className="border-t border-gray-200" />
                </>
              )}
              <LayerPanel />
            </FloorPlanErrorBoundary>
          </div>
        )}

        {/* Canvas */}
        <div className="relative flex-1 overflow-hidden" onDoubleClick={handleCanvasDblClick}>
          <FloorPlanErrorBoundary fallbackLabel="Canvas">
            <FloorPlanCanvas />
          </FloorPlanErrorBoundary>

          {/* Ruler overlay (top + left) */}
          <RulerOverlay />

          {/* Wall length input (appears when wall first point is placed) */}
          <WallLengthInput />

          {/* Room name inline edit overlay */}
          {editingRoomId && (
            <RoomNameEditOverlay
              roomId={editingRoomId}
              onClose={() => setEditingRoomId(null)}
            />
          )}

          {/* Undo/Redo toast */}
          {undoToast && (
            <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-pulse">
              <div className="rounded-lg bg-gray-900/80 px-4 py-1.5 text-xs font-medium text-white shadow-lg">
                {undoToast}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Tabbed */}
        {rightPanelOpen && (
          <div className="w-[280px] flex flex-col border-l border-gray-200 bg-gray-50 print:hidden">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 bg-white shrink-0">
              {([
                { id: "properties", label: "Props" },
                { id: "vastu", label: "Vastu" },
                { id: "code", label: "Code" },
                { id: "analytics", label: "Stats" },
                { id: "boq", label: "BOQ" },
                { id: "program", label: "Program" },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setRightPanelTab(tab.id)}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors ${
                    rightPanelTab === tab.id
                      ? "text-gray-800 border-b-2 border-gray-800"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              <FloorPlanErrorBoundary fallbackLabel="Panel">
                {rightPanelTab === "properties" && <PropertiesPanel />}
                {rightPanelTab === "vastu" && <VastuPanel />}
                {rightPanelTab === "code" && <CodeCompliancePanel />}
                {rightPanelTab === "analytics" && <AnalyticsPanel />}
                {rightPanelTab === "boq" && <BOQPanel />}
                {rightPanelTab === "program" && <ProgramPanel />}
              </FloorPlanErrorBoundary>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar />

      {/* Context menu */}
      <ContextMenu />

      {/* Keyboard shortcuts overlay */}
      <ShortcutOverlay />

      {/* Print stylesheet */}
      <style jsx global>{`
        @media print {
          body { margin: 0; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:overflow-visible { overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// WALL LENGTH INPUT (Feature 2)
// ============================================================

function WallLengthInput() {
  const wallDrawStart = useFloorPlanStore((s) => s.wallDrawStart);
  const activeTool = useFloorPlanStore((s) => s.activeTool);
  const displayUnit = useFloorPlanStore((s) => (s.project?.settings.display_unit ?? "m") as DisplayUnit);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (wallDrawStart && activeTool === "wall") {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [wallDrawStart, activeTool]);

  if (!wallDrawStart || activeTool !== "wall") return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const store = useFloorPlanStore.getState();
        const start = store.wallDrawStart;
        if (!start) return;

        const parsed = parseFloat(value);
        if (isNaN(parsed) || parsed <= 0) return;
        const length_mm = displayToMm(parsed, displayUnit);

        // Direction from start to cursor (with ortho constraint)
        let target = store.cursorWorldPos;
        if (store.orthoEnabled) {
          const dx = Math.abs(target.x - start.x);
          const dy = Math.abs(target.y - start.y);
          target = dx >= dy ? { x: target.x, y: start.y } : { x: start.x, y: target.y };
        }

        const dx = target.x - start.x;
        const dy = target.y - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
          store.addNewWall(start, { x: start.x + length_mm, y: start.y });
        } else {
          const scale = length_mm / dist;
          store.addNewWall(start, { x: start.x + dx * scale, y: start.y + dy * scale });
        }
        setValue("");
      } catch { /* non-critical */ }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      useFloorPlanStore.getState().setWallDrawStart(null);
      setValue("");
    }
  };

  const unitLabel = displayUnit === "m" ? "m" : displayUnit === "ft" ? "ft" : displayUnit === "cm" ? "cm" : displayUnit === "in" ? "in" : "mm";

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-lg bg-gray-900/90 px-3 py-1.5 shadow-lg print:hidden">
      <span className="text-[11px] text-gray-400">Length:</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-20 bg-transparent text-white text-sm font-mono outline-none border-b border-gray-600 focus:border-blue-400 px-1"
        placeholder="0"
        autoComplete="off"
      />
      <span className="text-[11px] text-gray-400">{unitLabel}</span>
      <span className="text-[10px] text-gray-500 ml-1">↵ apply</span>
    </div>
  );
}

// ============================================================
// ROOM NAME EDIT OVERLAY (Feature 5)
// ============================================================

function RoomNameEditOverlay({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const viewport = useFloorPlanStore((s) => s.viewport);
  const room = floor?.rooms.find((r) => r.id === roomId);
  const [name, setName] = useState(room?.name ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 50);
  }, []);

  if (!room || !room.label_position) { onClose(); return null; }

  const screenPos = worldToScreen(room.label_position, viewport);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (name.trim()) {
        const store = useFloorPlanStore.getState();
        store.pushHistory();
        store.updateRoom(roomId, { name: name.trim() });
      }
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="absolute z-50 print:hidden"
      style={{ left: screenPos.x - 60, top: screenPos.y - 12 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onClose}
        className="w-[120px] rounded border border-blue-400 bg-white px-2 py-0.5 text-xs font-medium text-gray-800 shadow-lg outline-none ring-2 ring-blue-200"
        autoComplete="off"
      />
    </div>
  );
}

// ============================================================
// RULER OVERLAY (Feature 4)
// ============================================================

const RULER_SIZE = 22; // px

function RulerOverlay() {
  const viewport = useFloorPlanStore((s) => s.viewport);
  const displayUnit = useFloorPlanStore((s) => (s.project?.settings.display_unit ?? "m") as DisplayUnit);

  if (!viewport.canvasWidth || !viewport.canvasHeight) return null;

  // Choose tick spacing so ticks are 60-200px apart on screen
  const niceIntervals = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const interval = niceIntervals.find((i) => i * viewport.zoom >= 50) ?? 50000;

  // Visible world range — using screenToWorld for edges
  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToWorld({ x: viewport.canvasWidth, y: viewport.canvasHeight }, viewport);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  // X ticks (horizontal ruler at top)
  const xTicks: number[] = [];
  const firstX = Math.floor(minX / interval) * interval;
  for (let x = firstX; x <= maxX; x += interval) xTicks.push(x);

  // Y ticks (vertical ruler at left)
  const yTicks: number[] = [];
  const firstY = Math.floor(minY / interval) * interval;
  for (let y = firstY; y <= maxY; y += interval) yTicks.push(y);

  return (
    <>
      {/* Top ruler */}
      <div
        className="absolute top-0 left-0 overflow-hidden bg-gray-50/90 border-b border-gray-200 pointer-events-none print:hidden"
        style={{ height: RULER_SIZE, width: viewport.canvasWidth, paddingLeft: RULER_SIZE }}
      >
        {xTicks.map((wx) => {
          const sx = worldToScreen({ x: wx, y: 0 }, viewport).x;
          if (sx < RULER_SIZE || sx > viewport.canvasWidth) return null;
          return (
            <div key={wx} className="absolute" style={{ left: sx }}>
              <div className="w-px h-2 bg-gray-400" style={{ marginTop: RULER_SIZE - 8 }} />
              <div className="text-[8px] text-gray-500 font-mono -translate-x-1/2 whitespace-nowrap" style={{ marginTop: -RULER_SIZE + 2 }}>
                {formatDimension(wx, displayUnit, 0)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Left ruler */}
      <div
        className="absolute top-0 left-0 overflow-hidden bg-gray-50/90 border-r border-gray-200 pointer-events-none print:hidden"
        style={{ width: RULER_SIZE, height: viewport.canvasHeight, paddingTop: RULER_SIZE }}
      >
        {yTicks.map((wy) => {
          const sy = worldToScreen({ x: 0, y: wy }, viewport).y;
          if (sy < RULER_SIZE || sy > viewport.canvasHeight) return null;
          return (
            <div key={wy} className="absolute" style={{ top: sy, left: 0 }}>
              <div className="h-px w-2 bg-gray-400" style={{ marginLeft: RULER_SIZE - 8 }} />
              <div
                className="text-[8px] text-gray-500 font-mono whitespace-nowrap"
                style={{
                  position: "absolute",
                  left: 2,
                  top: -4,
                  transformOrigin: "left center",
                  transform: "rotate(-90deg) translateX(-100%)",
                }}
              >
                {formatDimension(wy, displayUnit, 0)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Corner square */}
      <div
        className="absolute top-0 left-0 bg-gray-100/90 border-b border-r border-gray-200 pointer-events-none print:hidden"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />
    </>
  );
}
