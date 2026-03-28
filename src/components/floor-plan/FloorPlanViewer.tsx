"use client";

import React, { useEffect, useCallback, useMemo, useRef } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { FloorPlanCanvas } from "./FloorPlanCanvas";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { ToolPanel } from "./panels/ToolPanel";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { LayerPanel } from "./panels/LayerPanel";
import { ContextMenu } from "./ContextMenu";
import { ShortcutOverlay } from "./ShortcutOverlay";
import { FurniturePanel } from "./panels/FurniturePanel";
import { VastuPanel } from "./panels/VastuPanel";
import { CodeCompliancePanel } from "./panels/CodeCompliancePanel";
import { AnalyticsPanel } from "./panels/AnalyticsPanel";
import { BOQPanel } from "./panels/BOQPanel";
import { ProgramPanel } from "./panels/ProgramPanel";
import { WelcomeScreen } from "./WelcomeScreen";
import { GenerationLoader } from "./GenerationLoader";
import { getProjectIndex, importProjectFile } from "@/lib/floor-plan/project-persistence";
import { FloorPlanErrorBoundary } from "./ErrorBoundary";

interface FloorPlanViewerProps {
  /** Pre-loaded geometry from pipeline (e.g. navigated from result showcase) */
  initialGeometry?: import("@/types/floor-plan").FloorPlanGeometry;
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

  // TODO: Replace with real AI generation API call (POST /api/generate-floor-plan)
  // Currently loads sample data with simulated progress steps.
  // Real implementation should: 1) POST prompt to API, 2) poll for progress,
  // 3) load returned Floor data. See pipeline-adapter.ts for data format.
  const generationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up generation timers on unmount
  useEffect(() => {
    return () => {
      for (const t of generationTimers.current) clearTimeout(t);
      generationTimers.current = [];
    };
  }, []);

  const handleGenerateFromPrompt = useCallback((prompt: string) => {
    // Clear any pending timers from previous generation
    for (const t of generationTimers.current) clearTimeout(t);
    generationTimers.current = [];

    const store = useFloorPlanStore.getState();
    store.startGeneration(prompt);

    // Simulate generation steps — snappy 3-4s total
    const steps = [
      { step: "analyzing", progress: 10, delay: 350 },
      { step: "generating", progress: 25, delay: 400 },
      { step: "placing_walls", progress: 45, delay: 400 },
      { step: "adding_rooms", progress: 60, delay: 400 },
      { step: "doors_windows", progress: 75, delay: 350 },
      { step: "vastu_check", progress: 85, delay: 350 },
      { step: "finalizing", progress: 95, delay: 300 },
    ];

    let cumDelay = 0;
    for (const s of steps) {
      cumDelay += s.delay;
      generationTimers.current.push(
        setTimeout(() => store.updateGenerationStep(s.step, s.progress), cumDelay)
      );
    }

    // Show "complete" step briefly, then load the floor plan and dismiss loader
    cumDelay += 300;
    generationTimers.current.push(
      setTimeout(() => {
        store.updateGenerationStep("complete", 100);
      }, cumDelay)
    );

    // After showing "Floor plan ready!" for 800ms, load data and transition to editor
    cumDelay += 800;
    generationTimers.current.push(
      setTimeout(() => {
        store.loadSample();
        // loadSample sets project but doesn't clear isGenerating — clear it now
        useFloorPlanStore.setState({ isGenerating: false });
      }, cumDelay)
    );
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
          if (e.shiftKey) store.redo();
          else store.undo();
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
        <div className="relative flex-1 overflow-hidden">
          <FloorPlanErrorBoundary fallbackLabel="Canvas">
            <FloorPlanCanvas />
          </FloorPlanErrorBoundary>
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
