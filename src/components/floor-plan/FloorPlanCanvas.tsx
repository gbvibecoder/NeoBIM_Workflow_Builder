"use client";

import React, { useRef, useCallback, useEffect, useState } from "react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { screenToWorld, worldToScreen, distance } from "@/lib/floor-plan/geometry";
import { hitTest, hitTestHandles, findNearestWall, rubberBandSelect } from "@/lib/floor-plan/hit-detection";
import { findSnap, applyOrthoConstraint } from "@/lib/floor-plan/snap-engine";
import type { HandleType } from "@/lib/floor-plan/hit-detection";
import { GridRenderer } from "./renderers/GridRenderer";
import { WallRenderer } from "./renderers/WallRenderer";
import { RoomRenderer } from "./renderers/RoomRenderer";
import { DoorRenderer } from "./renderers/DoorRenderer";
import { WindowRenderer } from "./renderers/WindowRenderer";
import { DimensionRenderer } from "./renderers/DimensionRenderer";
import { MeasurementOverlay } from "./renderers/MeasurementOverlay";
import { ScaleBarRenderer } from "./renderers/ScaleBarRenderer";
import { NorthArrowRenderer } from "./renderers/NorthArrowRenderer";
import { SelectionRenderer } from "./renderers/SelectionRenderer";
import { InteractionOverlay } from "./renderers/InteractionOverlay";
import { FurnitureRenderer } from "./renderers/FurnitureRenderer";
import { StairRenderer } from "./renderers/StairRenderer";
import { ColumnRenderer } from "./renderers/ColumnRenderer";
import { VastuOverlayRenderer } from "./renderers/VastuOverlayRenderer";
import { AnnotationRenderer } from "./renderers/AnnotationRenderer";
import { LightOverlayRenderer } from "./renderers/LightOverlayRenderer";
import { CodeOverlayRenderer } from "./renderers/CodeOverlayRenderer";
import { exportStageToPng } from "@/lib/floor-plan/export-png";
import type { PngExportOptions } from "@/lib/floor-plan/export-png";

// ============================================================
// DRAG STATE (transient, kept in refs)
// ============================================================

interface DragInfo {
  handleType: HandleType | "rubber-band";
  entityId: string | null;
  startWorld: { x: number; y: number };
  lastWorld: { x: number; y: number };
  historyPushed: boolean;
}

export function FloorPlanCanvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const isPanning = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const dragInfo = useRef<DragInfo | null>(null);

  const viewport = useFloorPlanStore((s) => s.viewport);
  const setViewport = useFloorPlanStore((s) => s.setViewport);
  const setCursorWorldPos = useFloorPlanStore((s) => s.setCursorWorldPos);
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const activeTool = useFloorPlanStore((s) => s.activeTool);
  const viewMode = useFloorPlanStore((s) => s.viewMode);
  const layers = useFloorPlanStore((s) => s.layers);
  const selectedIds = useFloorPlanStore((s) => s.selectedIds);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
        setViewport({ canvasWidth: width, canvasHeight: height });
      }
    });

    observer.observe(container);
    const rect = container.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
    setViewport({ canvasWidth: rect.width, canvasHeight: rect.height });

    return () => observer.disconnect();
  }, [setViewport]);

  // Fit to view on first load
  useEffect(() => {
    if (floor && dimensions.width > 100) {
      useFloorPlanStore.getState().fitToView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor?.id, dimensions.width]);

  // PNG export listener
  useEffect(() => {
    const handler = (e: Event) => {
      const stage = stageRef.current;
      if (!stage) return;
      const detail = (e as CustomEvent).detail as PngExportOptions & { filename: string };
      exportStageToPng(stage, detail.filename, {
        dpi: detail.dpi,
        transparentBackground: detail.transparentBackground,
      });
    };
    window.addEventListener("floor-plan-export-png", handler);
    return () => window.removeEventListener("floor-plan-export-png", handler);
  }, []);

  // ============================================================
  // MOUSE WHEEL ZOOM
  // ============================================================

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const vp = useFloorPlanStore.getState().viewport;
    const worldBefore = screenToWorld(pointer, vp);

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.max(0.005, Math.min(vp.zoom * factor, 10));

    const newVp = { ...vp, zoom: newZoom };
    const worldAfter = screenToWorld(pointer, newVp);

    setViewport({
      zoom: newZoom,
      x: vp.x + (worldBefore.x - worldAfter.x),
      y: vp.y + (worldBefore.y - worldAfter.y),
    });
  }, [setViewport]);

  // ============================================================
  // MOUSE DOWN — Unified handler
  // ============================================================

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const store = useFloorPlanStore.getState();
    const vp = store.viewport;
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const worldPos = screenToWorld(pointer, vp);

    // Close context menu on any click
    if (store.contextMenu) {
      store.setContextMenu(null);
    }

    // Right-click → context menu
    if (e.evt.button === 2) {
      e.evt.preventDefault();
      const flr = store.getActiveFloor();
      if (!flr) return;

      const hit = hitTest(worldPos, flr);
      const containerRect = containerRef.current?.getBoundingClientRect();
      const menuX = e.evt.clientX;
      const menuY = e.evt.clientY;

      if (hit) {
        store.setSelectedIds([hit.entityId]);
        const ctxType = hit.entityType;
        store.setContextMenu({
          x: menuX,
          y: menuY,
          entityType: ctxType as any,
          entityId: hit.entityId,
        });
      } else {
        store.clearSelection();
        store.setContextMenu({
          x: menuX,
          y: menuY,
          entityType: "empty",
          entityId: null,
        });
      }
      return;
    }

    // Middle mouse → pan
    if (e.evt.button === 1 || activeTool === "pan") {
      isPanning.current = true;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      if (stage) stage.container().style.cursor = "grabbing";
      return;
    }

    // Left click handling per tool
    if (e.evt.button !== 0) return;

    const flr = store.getActiveFloor();
    if (!flr) return;

    switch (activeTool) {
      case "select": {
        // Check if clicking a selection handle
        const handleRadius = 10 / vp.zoom; // 10px in world space
        const handleHit = hitTestHandles(worldPos, store.selectedIds, flr, handleRadius);
        if (handleHit) {
          // Start drag operation
          dragInfo.current = {
            handleType: handleHit.type,
            entityId: handleHit.entityId,
            startWorld: { ...worldPos },
            lastWorld: { ...worldPos },
            historyPushed: false,
          };
          store.setDragState({
            type: handleHit.type,
            entityId: handleHit.entityId,
            startWorld: { ...worldPos },
            currentWorld: { ...worldPos },
          });
          return;
        }

        // Hit test entities
        const hit = hitTest(worldPos, flr);
        if (hit) {
          if (e.evt.shiftKey) {
            // Shift+click: toggle selection
            if (store.selectedIds.includes(hit.entityId)) {
              store.removeFromSelection(hit.entityId);
            } else {
              store.addToSelection(hit.entityId);
            }
          } else {
            store.setSelectedIds([hit.entityId]);
          }
          // Start drag for furniture
          if (hit.entityType === "furniture") {
            dragInfo.current = {
              handleType: "wall-midpoint", // reuse for generic move
              entityId: hit.entityId,
              startWorld: { ...worldPos },
              lastWorld: { ...worldPos },
              historyPushed: false,
            };
            store.setDragState({
              type: "wall-midpoint",
              entityId: hit.entityId,
              startWorld: { ...worldPos },
              currentWorld: { ...worldPos },
            });
          }
        } else {
          // Click on empty space → start rubber band selection
          store.clearSelection();
          dragInfo.current = {
            handleType: "rubber-band",
            entityId: null,
            startWorld: { ...worldPos },
            lastWorld: { ...worldPos },
            historyPushed: false,
          };
          store.setRubberBandStart({ ...worldPos });
          store.setRubberBandEnd({ ...worldPos });
        }
        break;
      }

      case "wall": {
        if (!store.wallDrawStart) {
          // First click: set start point
          const snap = findSnap(worldPos, flr.walls, store.gridSize_mm, store.snapEnabled);
          const snappedPos = snap ? snap.point : worldPos;
          store.setWallDrawStart(snappedPos);
        } else {
          // Second click: create wall
          let endPos = worldPos;
          if (store.orthoEnabled) {
            endPos = applyOrthoConstraint(endPos, store.wallDrawStart);
          }
          const snap = findSnap(endPos, flr.walls, store.gridSize_mm, store.snapEnabled);
          if (snap) endPos = snap.point;

          store.addNewWall(store.wallDrawStart, endPos);
        }
        break;
      }

      case "door": {
        if (store.ghostDoor) {
          store.addNewDoor(store.ghostDoor.wallId, store.ghostDoor.position_mm);
          store.setActiveTool("select");
        }
        break;
      }

      case "window": {
        if (store.ghostWindow) {
          store.addNewWindow(store.ghostWindow.wallId, store.ghostWindow.position_mm);
          store.setActiveTool("select");
        }
        break;
      }

      case "measure": {
        if (!store.measureStart) {
          store.setMeasureStart({ ...worldPos });
        } else if (!store.measureEnd) {
          store.setMeasureEnd({ ...worldPos });
        } else {
          store.setMeasureStart({ ...worldPos });
          store.setMeasureEnd(null);
        }
        break;
      }

      case "annotate": {
        const text = window.prompt("Enter annotation text:");
        if (text && text.trim()) {
          store.addAnnotation(text.trim(), { ...worldPos });
          store.setActiveTool("select");
        }
        break;
      }
    }
  }, [activeTool]);

  // ============================================================
  // MOUSE MOVE — Unified handler
  // ============================================================

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const store = useFloorPlanStore.getState();
    const vp = store.viewport;
    const worldPos = screenToWorld(pointer, vp);
    setCursorWorldPos(worldPos);

    const flr = store.getActiveFloor();

    // Panning
    if (isPanning.current && lastPointer.current) {
      const dx = e.evt.clientX - lastPointer.current.x;
      const dy = e.evt.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      setViewport({
        x: vp.x - dx / vp.zoom,
        y: vp.y + dy / vp.zoom,
      });
      return;
    }

    // Dragging (select tool)
    if (dragInfo.current && flr) {
      const di = dragInfo.current;

      if (di.handleType === "rubber-band") {
        // Update rubber band end
        store.setRubberBandEnd({ ...worldPos });
        return;
      }

      // Push history once at start of drag
      if (!di.historyPushed) {
        store.pushHistory();
        di.historyPushed = true;
      }

      // Apply snap
      let snappedPos = worldPos;
      if (store.snapEnabled) {
        const snap = findSnap(worldPos, flr.walls, store.gridSize_mm, true);
        if (snap) {
          snappedPos = snap.point;
          store.setLastSnap(snap);
        } else {
          store.setLastSnap(null);
        }
      }

      // Handle specific drag types
      switch (di.handleType) {
        case "wall-midpoint": {
          if (!di.entityId) break;

          // Check if dragging furniture
          const draggedFurn = flr.furniture.find((fi) => fi.id === di.entityId);
          if (draggedFurn) {
            const dx = snappedPos.x - di.lastWorld.x;
            const dy = snappedPos.y - di.lastWorld.y;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
              store.moveFurniture(di.entityId, {
                x: draggedFurn.position.x + dx,
                y: draggedFurn.position.y + dy,
              });
              di.lastWorld = { ...snappedPos };
            }
            break;
          }

          const wall = flr.walls.find((w) => w.id === di.entityId);
          if (!wall) break;

          const isHoriz = Math.abs(wall.centerline.start.y - wall.centerline.end.y) <
                          Math.abs(wall.centerline.start.x - wall.centerline.end.x);
          const delta = isHoriz
            ? snappedPos.y - di.lastWorld.y
            : snappedPos.x - di.lastWorld.x;

          if (Math.abs(delta) > 1) {
            store.moveWallPerpendicular(di.entityId, delta);
            di.lastWorld = { ...snappedPos };
          }
          break;
        }

        case "wall-endpoint-start":
        case "wall-endpoint-end": {
          if (!di.entityId) break;
          let endPos = snappedPos;
          if (store.orthoEnabled) {
            const wall = flr.walls.find((w) => w.id === di.entityId);
            if (wall) {
              const otherEnd = di.handleType === "wall-endpoint-start"
                ? wall.centerline.end : wall.centerline.start;
              endPos = applyOrthoConstraint(snappedPos, otherEnd);
            }
          }
          const endpoint = di.handleType === "wall-endpoint-start" ? "start" : "end";
          store.moveWallEndpoint(di.entityId, endpoint, endPos);
          di.lastWorld = { ...endPos };
          break;
        }

        case "door-slide": {
          if (!di.entityId) break;
          const door = flr.doors.find((d) => d.id === di.entityId);
          if (!door) break;
          const wall = flr.walls.find((w) => w.id === door.wall_id);
          if (!wall) break;

          // Project cursor onto wall to get position along wall
          const s = wall.centerline.start;
          const ex = wall.centerline.end;
          const dx = ex.x - s.x;
          const dy = ex.y - s.y;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) break;
          const t = Math.max(0, Math.min(1, ((snappedPos.x - s.x) * dx + (snappedPos.y - s.y) * dy) / lenSq));
          const posAlongWall = t * Math.sqrt(lenSq) - door.width_mm / 2;
          const clamped = Math.max(100, Math.min(posAlongWall, Math.sqrt(lenSq) - door.width_mm - 100));
          store.updateDoorPosition(di.entityId, clamped);
          di.lastWorld = { ...snappedPos };
          break;
        }

        case "window-slide": {
          if (!di.entityId) break;
          const win = flr.windows.find((w) => w.id === di.entityId);
          if (!win) break;
          const wall = flr.walls.find((w) => w.id === win.wall_id);
          if (!wall) break;

          const s = wall.centerline.start;
          const ex = wall.centerline.end;
          const dx = ex.x - s.x;
          const dy = ex.y - s.y;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) break;
          const t = Math.max(0, Math.min(1, ((snappedPos.x - s.x) * dx + (snappedPos.y - s.y) * dy) / lenSq));
          const posAlongWall = t * Math.sqrt(lenSq) - win.width_mm / 2;
          const clamped = Math.max(100, Math.min(posAlongWall, Math.sqrt(lenSq) - win.width_mm - 100));
          store.updateWindowPosition(di.entityId, clamped);
          di.lastWorld = { ...snappedPos };
          break;
        }
      }

      // Update drag state for overlay
      store.setDragState({
        type: di.handleType,
        entityId: di.entityId,
        startWorld: di.startWorld,
        currentWorld: snappedPos,
      });

      return;
    }

    // Tool-specific mousemove
    if (flr) {
      // Snap indicator
      if (store.snapEnabled && (activeTool === "wall" || activeTool === "select")) {
        const snap = findSnap(worldPos, flr.walls, store.gridSize_mm, true);
        store.setLastSnap(snap);
      } else {
        if (store.lastSnap) store.setLastSnap(null);
      }

      // Ghost door placement
      if (activeTool === "door") {
        const nearest = findNearestWall(worldPos, flr.walls, 500);
        if (nearest) {
          const doorWidth = 900;
          const pos = Math.max(100, nearest.positionAlongWall_mm - doorWidth / 2);
          store.setGhostDoor({ wallId: nearest.wall.id, position_mm: pos });
        } else {
          store.setGhostDoor(null);
        }
      }

      // Ghost window placement
      if (activeTool === "window") {
        const nearest = findNearestWall(worldPos, flr.walls, 500);
        if (nearest) {
          const winWidth = 1200;
          const pos = Math.max(100, nearest.positionAlongWall_mm - winWidth / 2);
          store.setGhostWindow({ wallId: nearest.wall.id, position_mm: pos });
        } else {
          store.setGhostWindow(null);
        }
      }
    }
  }, [activeTool, setViewport, setCursorWorldPos]);

  // ============================================================
  // MOUSE UP — Finalize operations
  // ============================================================

  const handleMouseUp = useCallback(() => {
    const store = useFloorPlanStore.getState();

    // End panning
    isPanning.current = false;
    lastPointer.current = null;
    const stage = stageRef.current;
    if (stage) {
      stage.container().style.cursor =
        activeTool === "pan" ? "grab" :
        activeTool === "wall" ? "crosshair" :
        activeTool === "door" || activeTool === "window" ? "crosshair" :
        activeTool === "measure" ? "crosshair" :
        activeTool === "annotate" ? "text" :
        activeTool === "column" || activeTool === "stair" ? "crosshair" :
        "default";
    }

    // End drag
    if (dragInfo.current) {
      const di = dragInfo.current;

      if (di.handleType === "rubber-band") {
        // Finalize rubber band selection
        const flr = store.getActiveFloor();
        if (flr && store.rubberBandStart && store.rubberBandEnd) {
          const rbDist = distance(store.rubberBandStart, store.rubberBandEnd);
          if (rbDist > 50) { // Only if dragged a meaningful distance
            const ids = rubberBandSelect(store.rubberBandStart, store.rubberBandEnd, flr);
            store.setSelectedIds(ids);
          }
        }
        store.setRubberBandStart(null);
        store.setRubberBandEnd(null);
      }

      // Clear drag state
      dragInfo.current = null;
      store.setDragState(null);
      store.setLastSnap(null);
    }
  }, [activeTool]);

  // ============================================================
  // CONTEXT MENU PREVENTION
  // ============================================================

  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
  }, []);

  // ============================================================
  // LAYER VISIBILITY
  // ============================================================

  const isLayerVisible = useCallback((layerId: string) => {
    return layers.find((l) => l.id === layerId)?.visible ?? true;
  }, [layers]);

  if (!floor) return null;

  const showRoomFills = isLayerVisible("A-ROOM-FILL") && viewMode === "presentation";
  const showRoomLabels = isLayerVisible("A-ROOM-NAME");
  const showDimensions = isLayerVisible("A-DIM") && (viewMode === "construction" || viewMode === "cad");
  const showGrid = isLayerVisible("A-GRID") || useFloorPlanStore.getState().gridVisible;

  // Cursor style per tool
  const cursorStyle =
    activeTool === "pan" ? "grab" :
    activeTool === "wall" ? "crosshair" :
    activeTool === "door" || activeTool === "window" ? "crosshair" :
    activeTool === "measure" ? "crosshair" :
    activeTool === "annotate" ? "text" :
    activeTool === "column" || activeTool === "stair" ? "crosshair" :
    activeTool === "furniture" ? "copy" :
    "default";

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        background: viewMode === "cad" ? "#FFFFFF" : "#FAFAFA",
        cursor: cursorStyle,
      }}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      >
        {/* Layer 1: Grid */}
        <Layer listening={false}>
          {showGrid && (
            <GridRenderer
              viewport={viewport}
              gridSize_mm={useFloorPlanStore.getState().gridSize_mm}
              viewMode={viewMode}
            />
          )}
        </Layer>

        {/* Layer 2: Room fills (presentation mode) */}
        {showRoomFills && (
          <Layer listening={false}>
            <RoomRenderer
              rooms={floor.rooms}
              viewport={viewport}
              viewMode={viewMode}
              renderMode="fill"
            />
          </Layer>
        )}

        {/* Layer 3: Walls */}
        <Layer listening={false}>
          {(isLayerVisible("A-WALL-EXTR") || isLayerVisible("A-WALL-INTR")) && (
            <WallRenderer
              walls={floor.walls}
              viewport={viewport}
              viewMode={viewMode}
              selectedIds={selectedIds}
            />
          )}
        </Layer>

        {/* Layer 4: Doors & Windows */}
        <Layer listening={false}>
          {isLayerVisible("A-DOOR") && (
            <DoorRenderer
              doors={floor.doors}
              walls={floor.walls}
              viewport={viewport}
              viewMode={viewMode}
            />
          )}
          {isLayerVisible("A-WIND") && (
            <WindowRenderer
              windows={floor.windows}
              walls={floor.walls}
              viewport={viewport}
              viewMode={viewMode}
            />
          )}
        </Layer>

        {/* Layer 4b: Stairs & Columns */}
        <Layer listening={false}>
          {isLayerVisible("A-STRS") && floor.stairs.length > 0 && (
            <StairRenderer
              stairs={floor.stairs}
              viewport={viewport}
              selectedIds={selectedIds}
            />
          )}
          {isLayerVisible("A-COLS") && floor.columns.length > 0 && (
            <ColumnRenderer
              columns={floor.columns}
              viewport={viewport}
              selectedIds={selectedIds}
            />
          )}
        </Layer>

        {/* Layer 4c: Furniture */}
        {isLayerVisible("A-FURN") && floor.furniture.length > 0 && (
          <Layer listening={false}>
            <FurnitureRenderer
              floor={floor}
              viewport={viewport}
              selectedIds={selectedIds}
            />
          </Layer>
        )}

        {/* Layer 4d: Vastu Overlay */}
        {isLayerVisible("A-VASTU") && (
          <Layer listening={false}>
            <VastuOverlayRenderer viewport={viewport} />
          </Layer>
        )}

        {/* Layer 4d-2: Light Analysis Overlay */}
        <Layer listening={false}>
          <LightOverlayRenderer viewport={viewport} />
        </Layer>

        {/* Layer 4d-3: Code Violation Overlay */}
        <Layer listening={false}>
          <CodeOverlayRenderer viewport={viewport} />
        </Layer>

        {/* Layer 4e: Annotations */}
        {floor.annotations.length > 0 && (
          <Layer listening={false}>
            <AnnotationRenderer
              annotations={floor.annotations}
              viewport={viewport}
              selectedIds={selectedIds}
            />
          </Layer>
        )}

        {/* Layer 5: Room labels */}
        {showRoomLabels && (
          <Layer listening={false}>
            <RoomRenderer
              rooms={floor.rooms}
              viewport={viewport}
              viewMode={viewMode}
              renderMode="labels"
              displayUnit={useFloorPlanStore.getState().project?.settings.display_unit ?? "m"}
            />
          </Layer>
        )}

        {/* Layer 6: Dimensions */}
        {showDimensions && (
          <Layer listening={false}>
            <DimensionRenderer
              rooms={floor.rooms}
              walls={floor.walls}
              doors={floor.doors}
              windows={floor.windows}
              viewport={viewport}
              displayUnit={useFloorPlanStore.getState().project?.settings.display_unit ?? "m"}
              showChainDimensions
              showOpeningDimensions
            />
          </Layer>
        )}

        {/* Layer 7: Measurement tool overlay */}
        <Layer listening={false}>
          <MeasurementOverlay viewport={viewport} />
        </Layer>

        {/* Layer 8: Screen-fixed overlay (scale bar, north arrow) */}
        <Layer listening={false}>
          {isLayerVisible("A-SCALE") && (
            <ScaleBarRenderer
              viewport={viewport}
              displayUnit={useFloorPlanStore.getState().project?.settings.display_unit ?? "m"}
            />
          )}
          {isLayerVisible("A-NORTH") && (
            <NorthArrowRenderer
              viewport={viewport}
              northAngleDeg={useFloorPlanStore.getState().project?.settings.north_angle_deg ?? 0}
            />
          )}
        </Layer>

        {/* Layer 9: Selection overlay */}
        <Layer listening={false}>
          <SelectionRenderer
            selectedIds={selectedIds}
            floor={floor}
            viewport={viewport}
          />
        </Layer>

        {/* Layer 10: Interaction overlay (previews, snaps, rubber band) */}
        <Layer listening={false}>
          <InteractionOverlay viewport={viewport} />
        </Layer>
      </Stage>
    </div>
  );
}
