"use client";

import { create } from "zustand";
import type {
  FloorPlanProject,
  Floor,
  Wall,
  Room,
  Door,
  CadWindow,
  FurnitureInstance,
  Annotation,
  Column,
  Stair,
  EditorTool,
  ViewMode,
  LayerConfig,
  Point,
} from "@/types/floor-plan-cad";
import { DEFAULT_LAYERS } from "@/types/floor-plan-cad";
import { floorBounds, zoomToFit, distance, wallLength, type Viewport } from "@/features/floor-plan/lib/geometry";
import type { SnapResult } from "@/features/floor-plan/lib/snap-engine";
import type { HandleType } from "@/features/floor-plan/lib/hit-detection";
import { findConnectedWalls } from "@/features/floor-plan/lib/hit-detection";
import type { FloorPlanGeometry } from "@/features/floor-plan/types/floor-plan";
import { convertGeometryToProject } from "@/features/floor-plan/lib/pipeline-adapter";
import {
  saveProject,
  loadProject,
  setActiveProjectId,
  clearActiveProjectId,
} from "@/features/floor-plan/lib/project-persistence";
import { createSample2BHK } from "@/features/floor-plan/lib/sample-data";
import type { LayoutMetrics, QualityFlag } from "@/features/floor-plan/lib/layout-metrics";
import type { InfeasibilityWarning } from "@/features/floor-plan/lib/infeasibility-detector";
import type { FloorPlanOption } from "@/features/floor-plan/components/OptionPicker";

// ============================================================
// SAFE DEEP CLONE (structuredClone with JSON fallback)
// ============================================================

function deepClone<T>(obj: T): T {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// ============================================================
// HISTORY (Undo/Redo)
// ============================================================

interface HistoryEntry {
  floor: Floor;
  timestamp: number;
}

// ============================================================
// INTERACTION TYPES
// ============================================================

export interface ContextMenuState {
  x: number; // screen px
  y: number; // screen px
  entityType: "wall" | "door" | "window" | "room" | "empty" | "measurement" | "furniture";
  entityId: string | null;
}

export interface DragState {
  type: HandleType | "rubber-band";
  entityId: string | null;
  startWorld: Point;
  currentWorld: Point;
}

export interface GhostPlacement {
  wallId: string;
  position_mm: number;
}

// ============================================================
// STORE STATE
// ============================================================

interface FloorPlanState {
  // Project data
  project: FloorPlanProject | null;
  activeFloorId: string | null;

  // Viewport
  viewport: Viewport;

  // Editor state
  activeTool: EditorTool;
  viewMode: ViewMode;
  selectedIds: string[];
  hoveredId: string | null;

  // Layers
  layers: LayerConfig[];

  // Snap & Grid
  snapEnabled: boolean;
  orthoEnabled: boolean;
  gridVisible: boolean;
  gridSize_mm: number;

  // Cursor
  cursorWorldPos: Point;

  // Measurement tool
  measureStart: Point | null;
  measureEnd: Point | null;
  pinnedMeasurements: Array<{ id: string; start: Point; end: Point }>;

  // Export
  exportMenuOpen: boolean;

  // Context menu
  contextMenu: ContextMenuState | null;

  // Interaction state
  wallDrawStart: Point | null;
  ghostDoor: GhostPlacement | null;
  ghostWindow: GhostPlacement | null;
  rubberBandStart: Point | null;
  rubberBandEnd: Point | null;
  lastSnap: SnapResult | null;
  dragState: DragState | null;

  // History
  _history: HistoryEntry[];
  _historyIndex: number;

  // Panels
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;

  // Furniture panel tab
  furniturePanelOpen: boolean;

  // Adjacent floor ghost
  showAdjacentFloor: boolean;

  // Right panel tab system
  rightPanelTab: "properties" | "vastu" | "code" | "analytics" | "boq" | "program" | "quality" | "explain";

  // Vastu overlay
  vastuOverlayVisible: boolean;

  // Data source & generation
  dataSource: "pipeline" | "saved" | "sample" | "blank" | null;
  isGenerating: boolean;
  generationStep: string;
  generationProgress: number;
  originalPrompt: string | null;
  projectModified: boolean;

  // Phase 1 — honest post-solve metrics surfaced from /api/generate-floor-plan
  lastLayoutMetrics: LayoutMetrics | null;
  lastQualityFlags: QualityFlag[];
  lastFeasibilityWarnings: InfeasibilityWarning[];

  // Phase 2 — multi-option generation (Midjourney approach)
  generatedOptions: FloorPlanOption[] | null;
  selectedOptionIndex: number;
  setGeneratedOptions: (options: FloorPlanOption[] | null) => void;
  setSelectedOptionIndex: (index: number) => void;

  // ========== ACTIONS ==========

  // Project
  setProject: (project: FloorPlanProject) => void;
  resetToWelcome: () => void;
  setActiveFloor: (floorId: string) => void;
  getActiveFloor: () => Floor | null;

  // Viewport
  setViewport: (viewport: Partial<Viewport>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;

  // Editor
  setActiveTool: (tool: EditorTool) => void;
  setViewMode: (mode: ViewMode) => void;
  setSelectedIds: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  setHoveredId: (id: string | null) => void;

  // Layers
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerLock: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;

  // Snap/Grid
  toggleSnap: () => void;
  toggleOrtho: () => void;
  toggleGrid: () => void;
  setGridSize: (size: number) => void;

  // Cursor
  setCursorWorldPos: (pos: Point) => void;

  // Measurement
  setMeasureStart: (p: Point | null) => void;
  setMeasureEnd: (p: Point | null) => void;
  pinMeasurement: () => void;
  removePinnedMeasurement: (id: string) => void;
  clearPinnedMeasurements: () => void;

  // Export
  setExportMenuOpen: (open: boolean) => void;

  // Context menu
  setContextMenu: (menu: ContextMenuState | null) => void;

  // Interaction state
  setWallDrawStart: (p: Point | null) => void;
  setGhostDoor: (ghost: GhostPlacement | null) => void;
  setGhostWindow: (ghost: GhostPlacement | null) => void;
  setRubberBandStart: (p: Point | null) => void;
  setRubberBandEnd: (p: Point | null) => void;
  setLastSnap: (snap: SnapResult | null) => void;
  setDragState: (drag: DragState | null) => void;

  // Floor mutations
  updateWall: (wallId: string, updates: Partial<Wall>) => void;
  updateRoom: (roomId: string, updates: Partial<Room>) => void;
  addWall: (wall: Wall) => void;
  removeWall: (wallId: string) => void;
  addDoor: (door: Door) => void;
  removeDoor: (doorId: string) => void;
  addWindow: (window: CadWindow) => void;
  removeWindow: (windowId: string) => void;

  // Generic entity updates (for properties panel two-way binding)
  updateDoor: (doorId: string, updates: Partial<Door>) => void;
  updateWindowEntity: (windowId: string, updates: Partial<CadWindow>) => void;
  updateFurnitureProps: (id: string, updates: Partial<FurnitureInstance>) => void;

  // Clipboard
  _clipboard: { walls: Wall[]; doors: Door[]; windows: CadWindow[]; furniture: FurnitureInstance[]; annotations: Annotation[] } | null;
  copySelected: () => void;
  pasteAtCursor: () => void;
  duplicateSelected: () => void;
  cutSelected: () => void;

  // Annotations
  addAnnotation: (text: string, position: Point, leaderTarget?: Point) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;

  // Editing actions
  deleteSelectedEntities: () => void;
  flipSelectedDoor: () => void;
  addNewWall: (start: Point, end: Point, type?: Wall["type"]) => void;
  addNewDoor: (wallId: string, position_mm: number) => void;
  addNewWindow: (wallId: string, position_mm: number) => void;
  moveWallPerpendicular: (wallId: string, delta_mm: number) => void;
  moveWallEndpoint: (wallId: string, endpoint: "start" | "end", newPos: Point) => void;
  updateDoorPosition: (doorId: string, position_mm: number) => void;
  updateWindowPosition: (windowId: string, position_mm: number) => void;

  // Furniture
  addFurniture: (data: Omit<FurnitureInstance, "id">) => void;
  removeFurniture: (id: string) => void;
  moveFurniture: (id: string, position: Point) => void;
  rotateFurniture: (id: string, angleDeg: number) => void;
  duplicateFurniture: (id: string) => void;

  // Floor management
  addFloor: (name: string) => void;
  copyFloor: (floorId: string, newName: string) => void;
  deleteFloor: (floorId: string) => void;
  toggleAdjacentFloor: () => void;

  // History
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Panels
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleFurniturePanel: () => void;

  // Right panel tabs
  setRightPanelTab: (tab: "properties" | "vastu" | "code" | "analytics" | "boq" | "program" | "quality" | "explain") => void;

  // Vastu overlay
  toggleVastuOverlay: () => void;
  lightOverlayVisible: boolean;
  toggleLightOverlay: () => void;
  codeOverlayVisible: boolean;
  toggleCodeOverlay: () => void;

  // Project settings
  setDisplayUnit: (unit: "mm" | "cm" | "m" | "ft" | "in") => void;
  setNorthAngle: (deg: number) => void;
  mirrorFloor: (axis: "horizontal" | "vertical") => void;

  // AI actions (Sprint 4)
  autoPlaceDoors: () => Promise<void> | void;
  autoPlaceWindows: () => Promise<void> | void;
  autoFurnishRoom: (roomId: string) => Promise<void> | void;
  autoFurnishAll: () => Promise<void> | void;
  applySwapSuggestion: (roomAId: string, roomBId: string) => void;

  // Data source & generation
  loadFromGeometry: (geometry: FloorPlanGeometry, name?: string, prompt?: string) => void;
  loadFromSaved: (projectId: string) => void;
  loadSample: () => void;
  startBlank: () => void;
  startGeneration: (prompt: string) => void;
  updateGenerationStep: (step: string, progress: number) => void;
  setQualityResults: (
    metrics: LayoutMetrics | null,
    flags: QualityFlag[],
    warnings: InfeasibilityWarning[],
  ) => void;
  completeGeneration: (geometry: FloorPlanGeometry, name?: string) => void;
  saveToStorage: () => void;
  setProjectModified: (v: boolean) => void;
}

// ============================================================
// ID GENERATION
// ============================================================

let _idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

// ============================================================
// STORE IMPLEMENTATION
// ============================================================

const MAX_HISTORY = 50;

export const useFloorPlanStore = create<FloorPlanState>()((set, get) => ({
  project: null,
  activeFloorId: null,
  viewport: { x: 5000, y: 4000, zoom: 0.08, canvasWidth: 1200, canvasHeight: 800 },
  activeTool: "select",
  viewMode: "cad",
  selectedIds: [],
  hoveredId: null,
  layers: [...DEFAULT_LAYERS],
  snapEnabled: true,
  orthoEnabled: true,
  gridVisible: false,
  gridSize_mm: 100,
  cursorWorldPos: { x: 0, y: 0 },
  measureStart: null,
  measureEnd: null,
  pinnedMeasurements: [],
  exportMenuOpen: false,
  contextMenu: null,
  wallDrawStart: null,
  ghostDoor: null,
  ghostWindow: null,
  rubberBandStart: null,
  rubberBandEnd: null,
  lastSnap: null,
  dragState: null,
  _history: [],
  _historyIndex: -1,
  leftPanelOpen: true,
  rightPanelOpen: true,
  furniturePanelOpen: false,
  showAdjacentFloor: false,
  rightPanelTab: "properties",
  vastuOverlayVisible: false,
  lightOverlayVisible: false,
  codeOverlayVisible: false,
  dataSource: null,
  isGenerating: false,
  generationStep: "",
  generationProgress: 0,
  originalPrompt: null,
  projectModified: false,
  lastLayoutMetrics: null,
  lastQualityFlags: [],
  lastFeasibilityWarnings: [],
  generatedOptions: null,
  selectedOptionIndex: 0,
  _clipboard: null,

  // ---- Multi-option ----
  setGeneratedOptions: (options) => set({ generatedOptions: options }),
  setSelectedOptionIndex: (index) => set({ selectedOptionIndex: index }),

  // ---- Project ----
  setProject: (project) => {
    set({
      project,
      activeFloorId: project.floors[0]?.id ?? null,
      layers: [...DEFAULT_LAYERS],
      projectModified: true,
    });
    // Persist synchronously so a refresh before the 3s auto-save still restores.
    try { saveProject(project); } catch { /* best-effort */ }
    setActiveProjectId(project.id);
  },

  resetToWelcome: () => {
    // User explicitly went back to the welcome screen — forget which project
    // was active so the next page load doesn't silently restore them into it.
    clearActiveProjectId();
    set({
      project: null,
      activeFloorId: null,
      dataSource: null,
      originalPrompt: null,
      isGenerating: false,
      generationStep: "",
      generationProgress: 0,
      projectModified: false,
      selectedIds: [],
      hoveredId: null,
      _history: [],
      _historyIndex: -1,
      activeTool: "select",
      generatedOptions: null,
      selectedOptionIndex: 0,
    });
  },

  setActiveFloor: (floorId) => set({ activeFloorId: floorId }),

  getActiveFloor: () => {
    const { project, activeFloorId } = get();
    if (!project || !activeFloorId) return null;
    return project.floors.find((f) => f.id === activeFloorId) ?? null;
  },

  // ---- Viewport ----
  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),

  zoomIn: () => set((s) => ({
    viewport: { ...s.viewport, zoom: Math.min(s.viewport.zoom * 1.25, 10) },
  })),

  zoomOut: () => set((s) => ({
    viewport: { ...s.viewport, zoom: Math.max(s.viewport.zoom / 1.25, 0.005) },
  })),

  fitToView: () => {
    const floor = get().getActiveFloor();
    if (!floor) return;
    const bounds = floorBounds(floor.walls, floor.rooms);
    const vp = get().viewport;
    const newVp = zoomToFit(bounds, vp.canvasWidth, vp.canvasHeight, 0.12);
    set({ viewport: newVp });
  },

  // ---- Editor ----
  setActiveTool: (tool) => set({
    activeTool: tool,
    // Clear tool-specific state when switching
    wallDrawStart: null,
    ghostDoor: null,
    ghostWindow: null,
    rubberBandStart: null,
    rubberBandEnd: null,
    contextMenu: null,
  }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  addToSelection: (id) => set((s) => ({
    selectedIds: s.selectedIds.includes(id) ? s.selectedIds : [...s.selectedIds, id],
  })),
  removeFromSelection: (id) => set((s) => ({
    selectedIds: s.selectedIds.filter((i) => i !== id),
  })),
  clearSelection: () => set({ selectedIds: [] }),
  setHoveredId: (id) => set({ hoveredId: id }),

  // ---- Layers ----
  toggleLayerVisibility: (layerId) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, visible: !l.visible } : l),
  })),
  toggleLayerLock: (layerId) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, locked: !l.locked } : l),
  })),
  setLayerOpacity: (layerId, opacity) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, opacity } : l),
  })),

  // ---- Snap/Grid ----
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  toggleOrtho: () => set((s) => ({ orthoEnabled: !s.orthoEnabled })),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  setGridSize: (size) => set({ gridSize_mm: size }),

  // ---- Cursor ----
  setCursorWorldPos: (pos) => set({ cursorWorldPos: pos }),

  // ---- Measurement ----
  setMeasureStart: (p) => set({ measureStart: p }),
  setMeasureEnd: (p) => set({ measureEnd: p }),
  pinMeasurement: () => {
    const { measureStart, measureEnd } = get();
    if (!measureStart || !measureEnd) return;
    set((s) => ({
      pinnedMeasurements: [
        ...s.pinnedMeasurements,
        { id: `m-${Date.now()}`, start: measureStart, end: measureEnd },
      ],
      measureStart: null,
      measureEnd: null,
    }));
  },
  removePinnedMeasurement: (id) => set((s) => ({
    pinnedMeasurements: s.pinnedMeasurements.filter((m) => m.id !== id),
  })),
  clearPinnedMeasurements: () => set({ pinnedMeasurements: [] }),

  // ---- Export ----
  setExportMenuOpen: (open) => set({ exportMenuOpen: open }),

  // ---- Context menu ----
  setContextMenu: (menu) => set({ contextMenu: menu }),

  // ---- Interaction state ----
  setWallDrawStart: (p) => set({ wallDrawStart: p }),
  setGhostDoor: (ghost) => set({ ghostDoor: ghost }),
  setGhostWindow: (ghost) => set({ ghostWindow: ghost }),
  setRubberBandStart: (p) => set({ rubberBandStart: p }),
  setRubberBandEnd: (p) => set({ rubberBandEnd: p }),
  setLastSnap: (snap) => set({ lastSnap: snap }),
  setDragState: (drag) => set({ dragState: drag }),

  // ---- Floor mutations ----
  updateWall: (wallId, updates) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, walls: f.walls.map((w) => w.id === wallId ? { ...w, ...updates } : w) }
            : f
        ),
      },
    };
  }),

  updateRoom: (roomId, updates) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, rooms: f.rooms.map((r) => r.id === roomId ? { ...r, ...updates } : r) }
            : f
        ),
      },
    };
  }),

  addWall: (wall) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, walls: [...f.walls, wall] } : f
        ),
      },
    };
  }),

  removeWall: (wallId) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, walls: f.walls.filter((w) => w.id !== wallId) } : f
        ),
      },
    };
  }),

  addDoor: (door) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, doors: [...f.doors, door] } : f
        ),
      },
    };
  }),

  removeDoor: (doorId) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, doors: f.doors.filter((d) => d.id !== doorId) } : f
        ),
      },
    };
  }),

  addWindow: (window) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, windows: [...f.windows, window] } : f
        ),
      },
    };
  }),

  removeWindow: (windowId) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, windows: f.windows.filter((w) => w.id !== windowId) } : f
        ),
      },
    };
  }),

  // ============================================================
  // EDITING ACTIONS
  // ============================================================

  deleteSelectedEntities: () => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId || s.selectedIds.length === 0) return;

    // Push history before deletion
    s.pushHistory();

    const ids = new Set(s.selectedIds);

    // For walls: also remove doors/windows on those walls
    const wallIdsToRemove = floor.walls.filter((w) => ids.has(w.id)).map((w) => w.id);
    const doorIdsOnWalls = floor.doors.filter((d) => wallIdsToRemove.includes(d.wall_id)).map((d) => d.id);
    const windowIdsOnWalls = floor.windows.filter((w) => wallIdsToRemove.includes(w.wall_id)).map((w) => w.id);

    const allRemoveIds = new Set([...ids, ...doorIdsOnWalls, ...windowIdsOnWalls]);

    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? {
                ...f,
                walls: f.walls.filter((w) => !allRemoveIds.has(w.id)),
                doors: f.doors.filter((d) => !allRemoveIds.has(d.id)),
                windows: f.windows.filter((w) => !allRemoveIds.has(w.id)),
                furniture: f.furniture.filter((fi) => !ids.has(fi.id)),
                columns: f.columns.filter((c) => !ids.has(c.id)),
                annotations: f.annotations.filter((a) => !ids.has(a.id)),
                // Clean orphaned wall references from rooms
                rooms: wallIdsToRemove.length > 0
                  ? f.rooms.map((r) =>
                      r.wall_ids.some((wid) => allRemoveIds.has(wid))
                        ? { ...r, wall_ids: r.wall_ids.filter((wid) => !allRemoveIds.has(wid)) }
                        : r
                    )
                  : f.rooms,
              }
            : f
        ),
      },
      selectedIds: [],
    });
  },

  flipSelectedDoor: () => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor) return;

    const doorId = s.selectedIds.find((id) => floor.doors.some((d) => d.id === id));
    if (!doorId) return;

    const door = floor.doors.find((d) => d.id === doorId);
    if (!door) return;

    s.pushHistory();
    set((state) => {
      if (!state.project || !state.activeFloorId) return state;
      return {
        project: {
          ...state.project,
          floors: state.project.floors.map((f) =>
            f.id === state.activeFloorId
              ? {
                  ...f,
                  doors: f.doors.map((d) =>
                    d.id === doorId
                      ? { ...d, swing_direction: d.swing_direction === "left" ? ("right" as const) : ("left" as const) }
                      : d
                  ),
                }
              : f
          ),
        },
      };
    });
  },

  addNewWall: (start, end, type = "interior") => {
    const s = get();
    if (!s.project || !s.activeFloorId) return;

    const len = distance(start, end);
    if (len < 300) return; // Minimum wall length

    s.pushHistory();

    const wall: Wall = {
      id: genId("w"),
      type,
      material: type === "exterior" ? "concrete" : "brick",
      centerline: { start: { ...start }, end: { ...end } },
      thickness_mm: s.project.settings.wall_thickness_mm || 150,
      height_mm: 3000,
      openings: [],
      line_weight: type === "exterior" ? "thick" as const : "medium" as const,
      hatch_pattern: "solid",
      is_load_bearing: type === "exterior",
    };

    s.addWall(wall);
    // Continuous wall drawing: start next wall from this wall's end point
    set({ selectedIds: [wall.id], wallDrawStart: { ...end } });
  },

  addNewDoor: (wallId, position_mm) => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor) return;

    const wall = floor.walls.find((w) => w.id === wallId);
    if (!wall) return;

    const doorWidth = 900;
    const wLen = wallLength(wall);

    // Clamp position: min 100mm from corners
    const minPos = 100;
    const maxPos = wLen - doorWidth - 100;
    if (maxPos < minPos) return; // Wall too short
    const clampedPos = Math.max(minPos, Math.min(position_mm - doorWidth / 2, maxPos));

    // Check overlap with existing doors/windows on this wall (min 50mm gap required)
    const MIN_GAP = 50;
    for (const d of floor.doors) {
      if (d.wall_id !== wallId) continue;
      if (clampedPos < d.position_along_wall_mm + d.width_mm + MIN_GAP && clampedPos + doorWidth + MIN_GAP > d.position_along_wall_mm) return;
    }
    for (const w of floor.windows) {
      if (w.wall_id !== wallId) continue;
      if (clampedPos < w.position_along_wall_mm + w.width_mm + MIN_GAP && clampedPos + doorWidth + MIN_GAP > w.position_along_wall_mm) return;
    }

    s.pushHistory();

    const door: Door = {
      id: genId("d"),
      wall_id: wallId,
      type: "single_swing",
      width_mm: doorWidth,
      height_mm: 2100,
      thickness_mm: 45,
      position_along_wall_mm: clampedPos,
      swing_direction: "left",
      swing_angle_deg: 90,
      opens_to: "inside",
      symbol: {
        hinge_point: { x: 0, y: 0 },
        arc_radius_mm: doorWidth,
        arc_start_angle_deg: 0,
        arc_end_angle_deg: 90,
        leaf_end_point: { x: 0, y: doorWidth },
      },
      connects_rooms: ["", ""] as [string, string],
    };

    s.addDoor(door);
    set({ selectedIds: [door.id], ghostDoor: null });
  },

  addNewWindow: (wallId, position_mm) => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor) return;

    const wall = floor.walls.find((w) => w.id === wallId);
    if (!wall) return;

    const winWidth = 1200;
    const wLen = wallLength(wall);

    const minPos = 100;
    const maxPos = wLen - winWidth - 100;
    if (maxPos < minPos) return;
    const clampedPos = Math.max(minPos, Math.min(position_mm - winWidth / 2, maxPos));

    // Check overlap
    for (const d of floor.doors) {
      if (d.wall_id !== wallId) continue;
      if (clampedPos < d.position_along_wall_mm + d.width_mm && clampedPos + winWidth > d.position_along_wall_mm) return;
    }
    for (const w of floor.windows) {
      if (w.wall_id !== wallId) continue;
      if (clampedPos < w.position_along_wall_mm + w.width_mm && clampedPos + winWidth > w.position_along_wall_mm) return;
    }

    s.pushHistory();

    const win: CadWindow = {
      id: genId("win"),
      wall_id: wallId,
      type: "casement",
      width_mm: winWidth,
      height_mm: 1200,
      sill_height_mm: 900,
      position_along_wall_mm: clampedPos,
      symbol: {
        start_point: { x: 0, y: 0 },
        end_point: { x: winWidth, y: 0 },
        glass_lines: [],
      },
      glazing: "double",
      operable: true,
    };

    s.addWindow(win);
    set({ selectedIds: [win.id], ghostWindow: null });
  },

  moveWallPerpendicular: (wallId, delta_mm) => {
    const floor = get().getActiveFloor();
    if (!floor) return;

    const wall = floor.walls.find((w) => w.id === wallId);
    if (!wall) return;

    const s = wall.centerline.start;
    const e = wall.centerline.end;

    // Determine if wall is horizontal or vertical
    const isHorizontal = Math.abs(s.y - e.y) < Math.abs(s.x - e.x);

    // Move wall centerline perpendicular to its direction
    let newStart: Point, newEnd: Point;
    if (isHorizontal) {
      // Horizontal wall: perpendicular move = Y
      newStart = { x: s.x, y: s.y + delta_mm };
      newEnd = { x: e.x, y: e.y + delta_mm };
    } else {
      // Vertical wall: perpendicular move = X
      newStart = { x: s.x + delta_mm, y: s.y };
      newEnd = { x: e.x + delta_mm, y: e.y };
    }

    // Update the wall
    get().updateWall(wallId, {
      centerline: { start: newStart, end: newEnd },
    });

    // Update connected walls
    const connected = findConnectedWalls(wall, floor.walls);
    for (const conn of connected) {
      const cw = conn.wall;
      const matchEnd = conn.matchedEndpoint;

      // The connected wall's matching endpoint should follow
      if (conn.sharedEndpoint === "start") {
        // Our start moved
        const newMatchPos = { ...newStart };
        if (matchEnd === "start") {
          get().updateWall(cw.id, { centerline: { start: newMatchPos, end: { ...cw.centerline.end } } });
        } else {
          get().updateWall(cw.id, { centerline: { start: { ...cw.centerline.start }, end: newMatchPos } });
        }
      } else {
        // Our end moved
        const newMatchPos = { ...newEnd };
        if (matchEnd === "start") {
          get().updateWall(cw.id, { centerline: { start: newMatchPos, end: { ...cw.centerline.end } } });
        } else {
          get().updateWall(cw.id, { centerline: { start: { ...cw.centerline.start }, end: newMatchPos } });
        }
      }
    }

    // Update room boundaries that reference this wall
    _updateRoomBoundaries(get, wallId, wall, isHorizontal, delta_mm);
  },

  moveWallEndpoint: (wallId, endpoint, newPos) => {
    const floor = get().getActiveFloor();
    if (!floor) return;

    const wall = floor.walls.find((w) => w.id === wallId);
    if (!wall) return;

    // Check minimum wall length
    const otherEnd = endpoint === "start" ? wall.centerline.end : wall.centerline.start;
    if (distance(newPos, otherEnd) < 300) return;

    // Update the wall
    if (endpoint === "start") {
      get().updateWall(wallId, { centerline: { start: { ...newPos }, end: { ...wall.centerline.end } } });
    } else {
      get().updateWall(wallId, { centerline: { start: { ...wall.centerline.start }, end: { ...newPos } } });
    }

    // Update connected walls at this endpoint
    const oldPos = endpoint === "start" ? wall.centerline.start : wall.centerline.end;
    const connected = findConnectedWalls(wall, floor.walls);
    for (const conn of connected) {
      if (conn.sharedEndpoint !== endpoint) continue;
      const cw = conn.wall;
      if (conn.matchedEndpoint === "start") {
        get().updateWall(cw.id, { centerline: { start: { ...newPos }, end: { ...cw.centerline.end } } });
      } else {
        get().updateWall(cw.id, { centerline: { start: { ...cw.centerline.start }, end: { ...newPos } } });
      }
    }
  },

  updateDoorPosition: (doorId, position_mm) => {
    const s = get();
    if (!s.project || !s.activeFloorId) return;
    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, doors: f.doors.map((d) => d.id === doorId ? { ...d, position_along_wall_mm: position_mm } : d) }
            : f
        ),
      },
    });
  },

  updateWindowPosition: (windowId, position_mm) => {
    const s = get();
    if (!s.project || !s.activeFloorId) return;
    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, windows: f.windows.map((w) => w.id === windowId ? { ...w, position_along_wall_mm: position_mm } : w) }
            : f
        ),
      },
    });
  },

  // ---- Generic entity updates ----
  updateDoor: (doorId, updates) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, doors: f.doors.map((d) => d.id === doorId ? { ...d, ...updates } : d) }
            : f
        ),
      },
    };
  }),

  updateWindowEntity: (windowId, updates) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, windows: f.windows.map((w) => w.id === windowId ? { ...w, ...updates } : w) }
            : f
        ),
      },
    };
  }),

  updateFurnitureProps: (id, updates) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, furniture: f.furniture.map((fi) => fi.id === id ? { ...fi, ...updates } : fi) }
            : f
        ),
      },
    };
  }),

  // ---- Clipboard ----
  copySelected: () => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || s.selectedIds.length === 0) return;
    const ids = new Set(s.selectedIds);

    const walls = floor.walls.filter((w) => ids.has(w.id));
    const wallIdSet = new Set(walls.map((w) => w.id));
    // Also grab doors/windows on copied walls
    const doors = floor.doors.filter((d) => ids.has(d.id) || wallIdSet.has(d.wall_id));
    const windows = floor.windows.filter((w) => ids.has(w.id) || wallIdSet.has(w.wall_id));
    const furniture = floor.furniture.filter((f) => ids.has(f.id));
    const annotations = floor.annotations.filter((a) => ids.has(a.id));

    set({ _clipboard: deepClone({ walls, doors, windows, furniture, annotations }) });
  },

  pasteAtCursor: () => {
    const s = get();
    if (!s._clipboard || !s.project || !s.activeFloorId) return;
    const floor = s.getActiveFloor();
    if (!floor) return;

    s.pushHistory();

    const clip = s._clipboard;
    const OFFSET = 200; // mm offset from original
    const wallIdMap = new Map<string, string>();
    const newIds: string[] = [];

    // Paste walls with offset
    const newWalls: Wall[] = [];
    for (const w of clip.walls) {
      const newId = genId("w");
      wallIdMap.set(w.id, newId);
      newWalls.push({
        ...w,
        id: newId,
        centerline: {
          start: { x: w.centerline.start.x + OFFSET, y: w.centerline.start.y + OFFSET },
          end: { x: w.centerline.end.x + OFFSET, y: w.centerline.end.y + OFFSET },
        },
      });
      newIds.push(newId);
    }

    // Paste doors with remapped wall_id
    const newDoors: Door[] = [];
    for (const d of clip.doors) {
      const newId = genId("d");
      newDoors.push({ ...d, id: newId, wall_id: wallIdMap.get(d.wall_id) ?? d.wall_id });
      newIds.push(newId);
    }

    // Paste windows with remapped wall_id
    const newWindows: CadWindow[] = [];
    for (const w of clip.windows) {
      const newId = genId("win");
      newWindows.push({ ...w, id: newId, wall_id: wallIdMap.get(w.wall_id) ?? w.wall_id });
      newIds.push(newId);
    }

    // Paste furniture with offset
    const newFurniture: FurnitureInstance[] = [];
    for (const f of clip.furniture) {
      const newId = genId("furn");
      newFurniture.push({
        ...f,
        id: newId,
        position: { x: f.position.x + OFFSET, y: f.position.y + OFFSET },
      });
      newIds.push(newId);
    }

    // Paste annotations with offset
    const newAnnotations: Annotation[] = [];
    for (const a of clip.annotations) {
      const newId = genId("ann");
      newAnnotations.push({
        ...a,
        id: newId,
        position: { x: a.position.x + OFFSET, y: a.position.y + OFFSET },
      });
    }

    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? {
                ...f,
                walls: [...f.walls, ...newWalls],
                doors: [...f.doors, ...newDoors],
                windows: [...f.windows, ...newWindows],
                furniture: [...f.furniture, ...newFurniture],
                annotations: [...f.annotations, ...newAnnotations],
              }
            : f
        ),
      },
      selectedIds: newIds,
    });
  },

  duplicateSelected: () => {
    get().copySelected();
    get().pasteAtCursor();
  },

  cutSelected: () => {
    get().copySelected();
    get().deleteSelectedEntities();
  },

  // ---- Annotations ----
  addAnnotation: (text, position, leaderTarget) => {
    const s = get();
    if (!s.project || !s.activeFloorId) return;
    s.pushHistory();
    const ann: Annotation = {
      id: genId("ann"),
      type: leaderTarget ? "leader" : "text",
      position: { ...position },
      text,
      font_size_mm: 150,
      rotation_deg: 0,
      leader_line: leaderTarget ? [{ ...leaderTarget }, { ...position }] : undefined,
    };
    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, annotations: [...f.annotations, ann] } : f
        ),
      },
      selectedIds: [ann.id],
    });
  },

  removeAnnotation: (id) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, annotations: f.annotations.filter((a) => a.id !== id) } : f
        ),
      },
    };
  }),

  updateAnnotation: (id, updates) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, annotations: f.annotations.map((a) => a.id === id ? { ...a, ...updates } : a) }
            : f
        ),
      },
    };
  }),

  // ---- Furniture ----
  addFurniture: (data) => {
    const s = get();
    if (!s.project || !s.activeFloorId) return;
    s.pushHistory();
    const inst = { ...data, id: genId("furn") };
    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, furniture: [...f.furniture, inst] } : f
        ),
      },
      selectedIds: [inst.id],
    });
  },

  removeFurniture: (id) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, furniture: f.furniture.filter((fi) => fi.id !== id) } : f
        ),
      },
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    };
  }),

  moveFurniture: (id, position) => set((s) => {
    if (!s.project || !s.activeFloorId) return s;
    return {
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, furniture: f.furniture.map((fi) => fi.id === id ? { ...fi, position } : fi) }
            : f
        ),
      },
    };
  }),

  rotateFurniture: (id, angleDeg) => {
    const s = get();
    if (!s.project || !s.activeFloorId) return;
    s.pushHistory();
    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId
            ? { ...f, furniture: f.furniture.map((fi) => fi.id === id ? { ...fi, rotation_deg: (fi.rotation_deg + angleDeg) % 360 } : fi) }
            : f
        ),
      },
    });
  },

  duplicateFurniture: (id) => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;
    const orig = floor.furniture.find((fi) => fi.id === id);
    if (!orig) return;
    s.pushHistory();
    const dup = { ...orig, id: genId("furn"), position: { x: orig.position.x + 200, y: orig.position.y + 200 } };
    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, furniture: [...f.furniture, dup] } : f
        ),
      },
      selectedIds: [dup.id],
    });
  },

  // ---- Floor management ----
  addFloor: (name) => {
    const s = get();
    if (!s.project) return;
    const maxLevel = Math.max(0, ...s.project.floors.map((f) => f.level));
    const newFloor: Floor = {
      id: genId("floor"),
      name,
      level: maxLevel + 1,
      floor_to_floor_height_mm: 3000,
      slab_thickness_mm: 150,
      boundary: { points: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 8000 }, { x: 0, y: 8000 }] },
      walls: [],
      rooms: [],
      doors: [],
      windows: [],
      stairs: [],
      columns: [],
      furniture: [],
      fixtures: [],
      annotations: [],
      dimensions: [],
      zones: [],
    };
    set({
      project: { ...s.project, floors: [...s.project.floors, newFloor] },
      activeFloorId: newFloor.id,
    });
  },

  copyFloor: (floorId, newName) => {
    const s = get();
    if (!s.project) return;
    const srcFloor = s.project.floors.find((f) => f.id === floorId);
    if (!srcFloor) return;
    const maxLevel = Math.max(0, ...s.project.floors.map((f) => f.level));
    const copy: Floor = deepClone(srcFloor);
    copy.id = genId("floor");
    copy.name = newName;
    copy.level = maxLevel + 1;
    // Regenerate IDs
    const idMap = new Map<string, string>();
    copy.walls.forEach((w) => { const nid = genId("w"); idMap.set(w.id, nid); w.id = nid; });
    copy.rooms.forEach((r) => {
      const nid = genId("r"); idMap.set(r.id, nid); r.id = nid;
      r.wall_ids = r.wall_ids.map((wid) => idMap.get(wid) ?? wid);
    });
    copy.doors.forEach((d) => {
      d.id = genId("d");
      d.wall_id = idMap.get(d.wall_id) ?? d.wall_id;
      d.connects_rooms = d.connects_rooms.map((rid) => idMap.get(rid) ?? rid) as [string, string];
    });
    copy.windows.forEach((w) => { w.id = genId("win"); w.wall_id = idMap.get(w.wall_id) ?? w.wall_id; });
    copy.stairs.forEach((st) => { st.id = genId("stair"); });
    copy.columns.forEach((c) => { c.id = genId("col"); });
    copy.furniture.forEach((fi) => { fi.id = genId("furn"); fi.room_id = idMap.get(fi.room_id) ?? fi.room_id; });
    set({
      project: { ...s.project, floors: [...s.project.floors, copy] },
      activeFloorId: copy.id,
    });
  },

  deleteFloor: (floorId) => {
    const s = get();
    if (!s.project || s.project.floors.length <= 1) return;
    const remaining = s.project.floors.filter((f) => f.id !== floorId);
    set({
      project: { ...s.project, floors: remaining },
      activeFloorId: remaining[0]?.id ?? null,
    });
  },

  toggleAdjacentFloor: () => set((s) => ({ showAdjacentFloor: !s.showAdjacentFloor })),

  // ---- History ----
  pushHistory: () => {
    const floor = get().getActiveFloor();
    if (!floor) return;
    set((s) => {
      const newHistory = s._history.slice(0, s._historyIndex + 1);
      newHistory.push({ floor: deepClone(floor), timestamp: Date.now() });
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return { _history: newHistory, _historyIndex: newHistory.length - 1 };
    });
  },

  undo: () => {
    const s = get();
    if (s._historyIndex <= 0 || !s.project || !s.activeFloorId) return;
    const prev = s._history[s._historyIndex - 1];
    if (!prev) return; // Bounds safety
    set({
      _historyIndex: s._historyIndex - 1,
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? prev.floor : f
        ),
      },
    });
  },

  redo: () => {
    const s = get();
    if (s._historyIndex >= s._history.length - 1 || !s.project || !s.activeFloorId) return;
    const next = s._history[s._historyIndex + 1];
    if (!next) return; // Bounds safety
    set({
      _historyIndex: s._historyIndex + 1,
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? next.floor : f
        ),
      },
    });
  },

  canUndo: () => get()._historyIndex > 0,
  canRedo: () => get()._historyIndex < get()._history.length - 1,

  // ---- Panels ----
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleFurniturePanel: () => set((s) => ({ furniturePanelOpen: !s.furniturePanelOpen })),

  // ---- Right panel tabs ----
  setRightPanelTab: (tab) => set({ rightPanelTab: tab, rightPanelOpen: true }),

  // ---- Vastu overlay ----
  toggleVastuOverlay: () => set((s) => ({ vastuOverlayVisible: !s.vastuOverlayVisible })),
  toggleLightOverlay: () => set((s) => ({ lightOverlayVisible: !s.lightOverlayVisible })),
  toggleCodeOverlay: () => set((s) => ({ codeOverlayVisible: !s.codeOverlayVisible })),

  // ---- Project Settings ----
  setDisplayUnit: (unit) => {
    const s = get();
    if (!s.project) return;
    set({
      project: { ...s.project, settings: { ...s.project.settings, display_unit: unit } },
      projectModified: true,
    });
  },

  setNorthAngle: (deg) => {
    const s = get();
    if (!s.project) return;
    set({
      project: { ...s.project, settings: { ...s.project.settings, north_angle_deg: deg } },
      projectModified: true,
    });
  },

  mirrorFloor: (axis) => {
    try {
      const s = get();
      const floor = s.getActiveFloor();
      if (!floor || !s.project || !s.activeFloorId) return;

      s.pushHistory();

      // Compute bounding box center
      const allX: number[] = [];
      const allY: number[] = [];
      for (const w of floor.walls) {
        allX.push(w.centerline.start.x, w.centerline.end.x);
        allY.push(w.centerline.start.y, w.centerline.end.y);
      }
      if (allX.length === 0) return;
      const cx = (Math.min(...allX) + Math.max(...allX)) / 2;
      const cy = (Math.min(...allY) + Math.max(...allY)) / 2;

      const flipPt = (p: Point): Point => {
        if (axis === "horizontal") return { x: 2 * cx - p.x, y: p.y };
        return { x: p.x, y: 2 * cy - p.y };
      };

      const newWalls = floor.walls.map((w) => ({
        ...w,
        centerline: { start: flipPt(w.centerline.start), end: flipPt(w.centerline.end) },
      }));

      const newRooms = floor.rooms.map((r) => ({
        ...r,
        boundary: { ...r.boundary, points: r.boundary.points.map(flipPt) },
        label_position: flipPt(r.label_position),
      }));

      const newFurniture = floor.furniture.map((f) => ({
        ...f,
        position: flipPt(f.position),
        rotation_deg: axis === "horizontal" ? 360 - f.rotation_deg : f.rotation_deg + 180,
      }));

      const newAnnotations = floor.annotations.map((a) => ({
        ...a,
        position: flipPt(a.position),
        leader_line: a.leader_line ? a.leader_line.map(flipPt) : undefined,
      }));

      const updatedFloor: Floor = {
        ...floor,
        walls: newWalls,
        rooms: newRooms,
        furniture: newFurniture,
        annotations: newAnnotations,
      };

      set({
        project: {
          ...s.project,
          floors: s.project.floors.map((f) => (f.id === s.activeFloorId ? updatedFloor : f)),
        },
        projectModified: true,
      });
    } catch {
      // Non-critical: mirror failed, no-op
    }
  },

  // ---- AI Actions (Sprint 4) ----
  autoPlaceDoors: async () => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;

    s.pushHistory();

    try {
      const { smartPlaceDoors } = await import("@/features/floor-plan/lib/smart-placement");
      const result = smartPlaceDoors(floor);

      set({
        project: {
          ...s.project,
          floors: s.project.floors.map((f) =>
            f.id === s.activeFloorId ? { ...f, doors: result.doors } : f
          ),
        },
        projectModified: true,
      });
    } catch (e) {
      console.error("Failed to load smart-placement module:", e);
    }
  },

  autoPlaceWindows: async () => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;

    s.pushHistory();

    try {
      const { smartPlaceWindows } = await import("@/features/floor-plan/lib/smart-placement");
      const result = smartPlaceWindows(floor);

      set({
        project: {
          ...s.project,
          floors: s.project.floors.map((f) =>
            f.id === s.activeFloorId ? { ...f, windows: result.windows } : f
          ),
        },
        projectModified: true,
      });
    } catch (e) {
      console.error("Failed to load smart-placement module:", e);
    }
  },

  autoFurnishRoom: async (roomId) => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;

    s.pushHistory();

    try {
      const { layoutRoomFurniture } = await import("@/features/floor-plan/lib/furniture-layout");
      const room = floor.rooms.find((r) => r.id === roomId);
      if (!room) return;

      const result = layoutRoomFurniture(room, floor);
      // Remove existing furniture in this room, add new
      const otherFurniture = floor.furniture.filter((f) => f.room_id !== roomId);

      set({
        project: {
          ...s.project,
          floors: s.project.floors.map((f) =>
            f.id === s.activeFloorId
              ? { ...f, furniture: [...otherFurniture, ...result.furniture] }
              : f
          ),
        },
        projectModified: true,
      });
    } catch (e) {
      console.error("Failed to load furniture-layout module:", e);
    }
  },

  autoFurnishAll: async () => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;

    s.pushHistory();

    try {
      const { layoutAllFurniture } = await import("@/features/floor-plan/lib/furniture-layout");
      const result = layoutAllFurniture(floor);

      set({
        project: {
          ...s.project,
          floors: s.project.floors.map((f) =>
            f.id === s.activeFloorId ? { ...f, furniture: result.furniture } : f
          ),
        },
        projectModified: true,
      });
    } catch (e) {
      console.error("Failed to load furniture-layout module:", e);
    }
  },

  applySwapSuggestion: (roomAId, roomBId) => {
    const s = get();
    const floor = s.getActiveFloor();
    if (!floor || !s.project || !s.activeFloorId) return;

    s.pushHistory();

    const roomA = floor.rooms.find((r) => r.id === roomAId);
    const roomB = floor.rooms.find((r) => r.id === roomBId);
    if (!roomA || !roomB) return;

    // Swap room names, types, and vastu metadata — keep boundaries/positions
    const updatedRooms = floor.rooms.map((r) => {
      if (r.id === roomAId) {
        return {
          ...r,
          name: roomB.name,
          type: roomB.type,
          vastu_direction: roomB.vastu_direction,
          vastu_compliant: roomB.vastu_compliant,
          vastu_notes: roomB.vastu_notes,
          natural_light_required: roomB.natural_light_required,
          ventilation_required: roomB.ventilation_required,
        };
      }
      if (r.id === roomBId) {
        return {
          ...r,
          name: roomA.name,
          type: roomA.type,
          vastu_direction: roomA.vastu_direction,
          vastu_compliant: roomA.vastu_compliant,
          vastu_notes: roomA.vastu_notes,
          natural_light_required: roomA.natural_light_required,
          ventilation_required: roomA.ventilation_required,
        };
      }
      return r;
    });

    set({
      project: {
        ...s.project,
        floors: s.project.floors.map((f) =>
          f.id === s.activeFloorId ? { ...f, rooms: updatedRooms } : f
        ),
      },
      projectModified: true,
    });
  },

  // ---- Data source & generation ----
  loadFromGeometry: (geometry, name, prompt) => {
    const project = convertGeometryToProject(geometry, name ?? "AI-Generated Floor Plan", prompt);
    set({
      project,
      activeFloorId: project.floors[0]?.id ?? null,
      layers: [...DEFAULT_LAYERS],
      dataSource: "pipeline",
      originalPrompt: prompt ?? null,
      isGenerating: false,
      generationStep: "",
      generationProgress: 100,
      projectModified: false,
    });
    // Persist immediately — a refresh right after generation would otherwise
    // find no saved record and drop the user back on the welcome screen.
    try { saveProject(project); } catch { /* best-effort */ }
    setActiveProjectId(project.id);
  },

  loadFromSaved: (projectId) => {
    const project = loadProject(projectId);
    if (project) {
      set({
        project,
        activeFloorId: project.floors[0]?.id ?? null,
        layers: [...DEFAULT_LAYERS],
        dataSource: "saved",
        originalPrompt: null,
        projectModified: false,
      });
      setActiveProjectId(project.id);
    }
  },

  loadSample: () => {
    const project = createSample2BHK();
    set({
      project,
      activeFloorId: project.floors[0]?.id ?? null,
      layers: [...DEFAULT_LAYERS],
      dataSource: "sample",
      originalPrompt: null,
      projectModified: false,
    });
    try { saveProject(project); } catch { /* best-effort */ }
    setActiveProjectId(project.id);
  },

  startBlank: () => {
    const blankProject: FloorPlanProject = {
      id: genId("proj"),
      name: "Untitled Floor Plan",
      version: "1.0",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        project_type: "residential",
        building_type: "custom",
        num_floors: 1,
        plot_area_sqm: 0,
        carpet_area_sqm: 0,
      },
      settings: {
        units: "metric",
        display_unit: "m",
        scale: "1:100",
        grid_size_mm: 100,
        wall_thickness_mm: 150,
        paper_size: "A3",
        orientation: "landscape",
        north_angle_deg: 0,
        vastu_compliance: true,
        feng_shui_compliance: false,
        ada_compliance: false,
        nbc_compliance: true,
      },
      floors: [{
        id: genId("floor"),
        name: "Ground Floor",
        level: 0,
        floor_to_floor_height_mm: 3000,
        slab_thickness_mm: 150,
        boundary: { points: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 10000 }, { x: 0, y: 10000 }] },
        walls: [],
        rooms: [],
        doors: [],
        windows: [],
        stairs: [],
        columns: [],
        furniture: [],
        fixtures: [],
        annotations: [],
        dimensions: [],
        zones: [],
      }],
    };
    set({
      project: blankProject,
      activeFloorId: blankProject.floors[0].id,
      layers: [...DEFAULT_LAYERS],
      dataSource: "blank",
      originalPrompt: null,
      projectModified: false,
    });
    try { saveProject(blankProject); } catch { /* best-effort */ }
    setActiveProjectId(blankProject.id);
  },

  startGeneration: (prompt) => set({
    isGenerating: true,
    // Phase 1 — single honest "working" state, no fake stage labels.
    generationStep: "working",
    generationProgress: 0,
    originalPrompt: prompt,
    // Reset the previous generation's metrics so we never accidentally show
    // them under a new project.
    lastLayoutMetrics: null,
    lastQualityFlags: [],
    lastFeasibilityWarnings: [],
  }),

  updateGenerationStep: (step, progress) => set({
    generationStep: step,
    generationProgress: progress,
  }),

  setQualityResults: (
    metrics: LayoutMetrics | null,
    flags: QualityFlag[],
    warnings: InfeasibilityWarning[],
  ) => set({
    lastLayoutMetrics: metrics,
    lastQualityFlags: flags,
    lastFeasibilityWarnings: warnings,
  }),

  completeGeneration: (geometry, name) => {
    get().loadFromGeometry(geometry, name, get().originalPrompt ?? undefined);
  },

  saveToStorage: () => {
    const { project } = get();
    if (!project) return;
    try {
      saveProject(project);
      setActiveProjectId(project.id);
    } catch (e) {
      console.warn("Failed to save project:", e);
    }
    set({ projectModified: false });
  },

  setProjectModified: (v) => set({ projectModified: v }),
}));

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Updates room boundary vertices that are close to a moved wall's face positions.
 * This handles the common case of rectangular rooms with axis-aligned walls.
 */
function _updateRoomBoundaries(
  get: () => FloorPlanState,
  wallId: string,
  oldWall: Wall,
  isHorizontal: boolean,
  delta_mm: number
) {
  const floor = get().getActiveFloor();
  if (!floor) return;

  const TOLERANCE = 100; // mm — how close a vertex must be to a wall face to be adjusted

  // Find rooms that reference this wall
  const affectedRooms = floor.rooms.filter((r) => r.wall_ids?.includes(wallId));

  for (const room of affectedRooms) {
    const oldHalfT = oldWall.thickness_mm / 2;
    const newPoints = room.boundary.points.map((p) => {
      if (isHorizontal) {
        // Wall was horizontal; check if vertex Y is near the old top/bottom face
        const oldTopY = Math.max(oldWall.centerline.start.y, oldWall.centerline.end.y) + oldHalfT;
        const oldBotY = Math.min(oldWall.centerline.start.y, oldWall.centerline.end.y) - oldHalfT;
        const oldCenterY = (oldWall.centerline.start.y + oldWall.centerline.end.y) / 2;

        if (Math.abs(p.y - oldTopY) < TOLERANCE || Math.abs(p.y - oldCenterY) < TOLERANCE) {
          return { x: p.x, y: p.y + delta_mm };
        }
        if (Math.abs(p.y - oldBotY) < TOLERANCE) {
          return { x: p.x, y: p.y + delta_mm };
        }
      } else {
        // Wall was vertical; check if vertex X is near the old left/right face
        const oldRightX = Math.max(oldWall.centerline.start.x, oldWall.centerline.end.x) + oldHalfT;
        const oldLeftX = Math.min(oldWall.centerline.start.x, oldWall.centerline.end.x) - oldHalfT;
        const oldCenterX = (oldWall.centerline.start.x + oldWall.centerline.end.x) / 2;

        if (Math.abs(p.x - oldRightX) < TOLERANCE || Math.abs(p.x - oldCenterX) < TOLERANCE) {
          return { x: p.x + delta_mm, y: p.y };
        }
        if (Math.abs(p.x - oldLeftX) < TOLERANCE) {
          return { x: p.x + delta_mm, y: p.y };
        }
      }
      return p;
    });

    // Recompute area from new boundary
    const area = Math.abs(polygonAreaFromPoints(newPoints)) / 1_000_000; // mm² to m²

    get().updateRoom(room.id, {
      boundary: { ...room.boundary, points: newPoints },
      area_sqm: area,
      label_position: polygonCentroidFromPoints(newPoints),
    });
  }
}

function polygonAreaFromPoints(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

function polygonCentroidFromPoints(points: Point[]): Point {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  return { x: cx / points.length, y: cy / points.length };
}
