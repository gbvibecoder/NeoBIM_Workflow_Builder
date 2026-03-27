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
  Column,
  Stair,
  EditorTool,
  ViewMode,
  LayerConfig,
  Point,
} from "@/types/floor-plan-cad";
import { DEFAULT_LAYERS } from "@/types/floor-plan-cad";
import { floorBounds, zoomToFit, distance, wallLength, type Viewport } from "@/lib/floor-plan/geometry";
import type { SnapResult } from "@/lib/floor-plan/snap-engine";
import type { HandleType } from "@/lib/floor-plan/hit-detection";
import { findConnectedWalls } from "@/lib/floor-plan/hit-detection";
import type { FloorPlanGeometry } from "@/types/floor-plan";
import { convertGeometryToProject } from "@/lib/floor-plan/pipeline-adapter";
import { saveProject, loadProject } from "@/lib/floor-plan/project-persistence";
import { createSample2BHK } from "@/lib/floor-plan/sample-data";

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
  rightPanelTab: "properties" | "vastu" | "code" | "analytics" | "boq";

  // Vastu overlay
  vastuOverlayVisible: boolean;

  // Data source & generation
  dataSource: "pipeline" | "saved" | "sample" | "blank" | null;
  isGenerating: boolean;
  generationStep: string;
  generationProgress: number;
  originalPrompt: string | null;
  projectModified: boolean;

  // ========== ACTIONS ==========

  // Project
  setProject: (project: FloorPlanProject) => void;
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
  setRightPanelTab: (tab: "properties" | "vastu" | "code" | "analytics" | "boq") => void;

  // Vastu overlay
  toggleVastuOverlay: () => void;

  // Data source & generation
  loadFromGeometry: (geometry: FloorPlanGeometry, name?: string, prompt?: string) => void;
  loadFromSaved: (projectId: string) => void;
  loadSample: () => void;
  startBlank: () => void;
  startGeneration: (prompt: string) => void;
  updateGenerationStep: (step: string, progress: number) => void;
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

const MAX_HISTORY = 100;

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
  dataSource: null,
  isGenerating: false,
  generationStep: "",
  generationProgress: 0,
  originalPrompt: null,
  projectModified: false,

  // ---- Project ----
  setProject: (project) => set({
    project,
    activeFloorId: project.floors[0]?.id ?? null,
    layers: [...DEFAULT_LAYERS],
    projectModified: true,
  }),

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
    s.updateWall; // ensure we use the store pattern
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
    set({ selectedIds: [wall.id], wallDrawStart: null });
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

    // Check overlap with existing doors/windows on this wall
    for (const d of floor.doors) {
      if (d.wall_id !== wallId) continue;
      if (clampedPos < d.position_along_wall_mm + d.width_mm && clampedPos + doorWidth > d.position_along_wall_mm) return;
    }
    for (const w of floor.windows) {
      if (w.wall_id !== wallId) continue;
      if (clampedPos < w.position_along_wall_mm + w.width_mm && clampedPos + doorWidth > w.position_along_wall_mm) return;
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
    const copy: Floor = JSON.parse(JSON.stringify(srcFloor));
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
    copy.doors.forEach((d) => { d.id = genId("d"); d.wall_id = idMap.get(d.wall_id) ?? d.wall_id; });
    copy.windows.forEach((w) => { w.id = genId("win"); w.wall_id = idMap.get(w.wall_id) ?? w.wall_id; });
    copy.stairs.forEach((st) => { st.id = genId("stair"); });
    copy.columns.forEach((c) => { c.id = genId("col"); });
    copy.furniture.forEach((fi) => { fi.id = genId("furn"); });
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
      newHistory.push({ floor: JSON.parse(JSON.stringify(floor)), timestamp: Date.now() });
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return { _history: newHistory, _historyIndex: newHistory.length - 1 };
    });
  },

  undo: () => {
    const s = get();
    if (s._historyIndex <= 0 || !s.project || !s.activeFloorId) return;
    const prev = s._history[s._historyIndex - 1];
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
    // Auto-save after loading
    setTimeout(() => get().saveToStorage(), 100);
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
  },

  startGeneration: (prompt) => set({
    isGenerating: true,
    generationStep: "analyzing",
    generationProgress: 5,
    originalPrompt: prompt,
  }),

  updateGenerationStep: (step, progress) => set({
    generationStep: step,
    generationProgress: progress,
  }),

  completeGeneration: (geometry, name) => {
    get().loadFromGeometry(geometry, name, get().originalPrompt ?? undefined);
  },

  saveToStorage: () => {
    const { project } = get();
    if (!project) return;
    try {
      saveProject(project);
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
