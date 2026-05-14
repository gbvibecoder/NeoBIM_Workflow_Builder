"use client";

/**
 * Z.CANVAS.SCHEMA Phase 9 + Z.CANVAS.COLLAB-COMPLETE gaps 2-3.
 * Group frame: dashed rectangle with label pill, drag-to-move enclosed
 * nodes, corner resize handles.
 */

import React, { memo, useState, useCallback, useRef } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken, useIsLight, resolveGroupColor } from "@/features/canvas/lib/canvas-tokens";
import type { CanvasGroup, GroupColor } from "@/features/canvas/stores/canvas-groups-store";
import {
  useCanvasGroups,
  selectUpdateGroup,
  selectDeleteGroup,
  selectSetActiveGroup,
} from "@/features/canvas/stores/canvas-groups-store";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GroupFrameProps {
  group: CanvasGroup;
  isActive: boolean;
}

interface DragState {
  enclosedNodeIds: string[];
  startClientX: number;
  startClientY: number;
  nodeStartPositions: Record<string, { x: number; y: number }>;
  frameStartX: number;
  frameStartY: number;
}

interface ResizeState {
  corner: "nw" | "ne" | "sw" | "se";
  startClientX: number;
  startClientY: number;
  startFrame: { x: number; y: number; w: number; h: number };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MIN_W = 100;
const MIN_H = 80;

// ─── Component ──────────────────────────────────────────────────────────────

export const GroupFrame = memo(function GroupFrame({ group, isActive }: GroupFrameProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();
  const isLight = useIsLight();
  const { setNodes, getNodes } = useReactFlow();
  const viewport = useViewport();
  const updateGroup = useCanvasGroups(selectUpdateGroup);
  const deleteGroup = useCanvasGroups(selectDeleteGroup);
  const setActiveGroup = useCanvasGroups(selectSetActiveGroup);

  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(group.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Local offset state for smooth drag/resize ──
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [localFrame, setLocalFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const color = group.color as GroupColor;
  const groupColors = resolveGroupColor(color, isLight);
  const zoom = viewport.zoom;

  // Compute actual display position/size (local overrides during drag/resize)
  const frameX = localFrame?.x ?? (dragOffset ? group.positionX + dragOffset.dx : group.positionX);
  const frameY = localFrame?.y ?? (dragOffset ? group.positionY + dragOffset.dy : group.positionY);
  const frameW = localFrame?.w ?? group.width;
  const frameH = localFrame?.h ?? group.height;

  // ── Label editing ──

  const handleLabelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditLabel(group.label);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [group.label]);

  const handleLabelSubmit = useCallback(() => {
    const trimmed = editLabel.trim();
    if (trimmed && trimmed !== group.label) {
      updateGroup(group.id, { label: trimmed });
    }
    setIsEditing(false);
  }, [editLabel, group.id, group.label, updateGroup]);

  const handleLabelKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") handleLabelSubmit();
    if (e.key === "Escape") setIsEditing(false);
  }, [handleLabelSubmit]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm("Delete this group frame?")) {
      deleteGroup(group.id);
    }
  }, [deleteGroup, group.id]);

  // ── Frame drag (moves enclosed nodes) ──

  const onFramePointerDown = useCallback((e: React.PointerEvent) => {
    // Skip if clicking on label/input/handle
    const target = e.target as HTMLElement;
    if (target.dataset.handle || target.tagName === "INPUT" || target.closest("[data-label]")) return;

    e.stopPropagation();
    e.preventDefault();

    const nodes = getNodes();
    const enclosed = nodes.filter((n) => {
      const nw = n.measured?.width ?? 200;
      const nh = n.measured?.height ?? 80;
      return (
        n.position.x >= group.positionX &&
        n.position.y >= group.positionY &&
        n.position.x + nw <= group.positionX + group.width &&
        n.position.y + nh <= group.positionY + group.height
      );
    });

    dragRef.current = {
      enclosedNodeIds: enclosed.map((n) => n.id),
      startClientX: e.clientX,
      startClientY: e.clientY,
      nodeStartPositions: Object.fromEntries(enclosed.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
      frameStartX: group.positionX,
      frameStartY: group.positionY,
    };

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActiveGroup(group.id);
  }, [getNodes, group, setActiveGroup]);

  const onFramePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dx = (e.clientX - ds.startClientX) / zoom;
    const dy = (e.clientY - ds.startClientY) / zoom;

    setDragOffset({ dx, dy });

    // Batch-update enclosed node positions
    setNodes((nodes) =>
      nodes.map((n) => {
        const start = ds.nodeStartPositions[n.id];
        if (!start) return n;
        return { ...n, position: { x: start.x + dx, y: start.y + dy } };
      })
    );
  }, [zoom, setNodes]);

  const onFramePointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    const dx = (e.clientX - ds.startClientX) / zoom;
    const dy = (e.clientY - ds.startClientY) / zoom;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      updateGroup(group.id, {
        positionX: ds.frameStartX + dx,
        positionY: ds.frameStartY + dy,
      });
    }

    dragRef.current = null;
    setDragOffset(null);
  }, [zoom, group.id, updateGroup]);

  // ── Corner resize ──

  const onHandlePointerDown = useCallback((corner: "nw" | "ne" | "sw" | "se", e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    resizeRef.current = {
      corner,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startFrame: { x: group.positionX, y: group.positionY, w: group.width, h: group.height },
    };

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [group]);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    const rs = resizeRef.current;
    if (!rs) return;
    const dx = (e.clientX - rs.startClientX) / zoom;
    const dy = (e.clientY - rs.startClientY) / zoom;
    const { x, y, w, h } = rs.startFrame;

    let nf: { x: number; y: number; w: number; h: number };
    switch (rs.corner) {
      case "se": nf = { x, y, w: Math.max(MIN_W, w + dx), h: Math.max(MIN_H, h + dy) }; break;
      case "ne": nf = { x, y: y + Math.min(dy, h - MIN_H), w: Math.max(MIN_W, w + dx), h: Math.max(MIN_H, h - dy) }; break;
      case "sw": nf = { x: x + Math.min(dx, w - MIN_W), y, w: Math.max(MIN_W, w - dx), h: Math.max(MIN_H, h + dy) }; break;
      case "nw": nf = { x: x + Math.min(dx, w - MIN_W), y: y + Math.min(dy, h - MIN_H), w: Math.max(MIN_W, w - dx), h: Math.max(MIN_H, h - dy) }; break;
    }
    setLocalFrame(nf);
  }, [zoom]);

  const onHandlePointerUp = useCallback((e: React.PointerEvent) => {
    const rs = resizeRef.current;
    if (!rs || !localFrame) {
      resizeRef.current = null;
      setLocalFrame(null);
      return;
    }
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    updateGroup(group.id, {
      positionX: localFrame.x,
      positionY: localFrame.y,
      width: localFrame.w,
      height: localFrame.h,
    });

    resizeRef.current = null;
    setLocalFrame(null);
  }, [group.id, localFrame, updateGroup]);

  const isDragging = !!dragOffset;

  return (
          <div
        onPointerDown={onFramePointerDown}
        onPointerMove={onFramePointerMove}
        onPointerUp={onFramePointerUp}
        onClick={() => setActiveGroup(group.id)}
        onContextMenu={handleContextMenu}
        style={{
          position: "absolute",
          left: frameX,
          top: frameY,
          width: frameW,
          height: frameH,
          background: groupColors.bg,
          border: `2px dashed ${groupColors.border}`,
          borderRadius: 14,
          zIndex: 1,
          pointerEvents: "auto",
          cursor: isDragging ? "grabbing" : "grab",
          boxShadow: isDragging ? tk.groupDraggingShadow : "none",
          touchAction: "none",
        }}
      >
        {/* Label pill (top-left) */}
        <div
          data-label="true"
          style={{
            position: "absolute",
            top: -10,
            left: 12,
            background: tk.groupLabelBg,
            border: `1px solid ${tk.groupLabelBorder}`,
            borderRadius: 9999,
            padding: "2px 10px",
            zIndex: 2,
          }}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              className="nodrag nowheel nopan"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onBlur={handleLabelSubmit}
              onKeyDown={handleLabelKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                border: 0, outline: "none",
                background: "transparent",
                fontSize: 12, fontStyle: "italic",
                fontFamily: "var(--font-dm-sans), serif",
                color: groupColors.label,
                width: 100,
                padding: 0,
              }}
            />
          ) : (
            <span
              onClick={handleLabelClick}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                fontSize: 12, fontStyle: "italic",
                fontFamily: "var(--font-dm-sans), serif",
                color: groupColors.label,
                cursor: "text",
                userSelect: "none",
              }}
            >
              {group.label}
            </span>
          )}
        </div>

        {/* Resize handles (corners, only when active) */}
        {isActive && (
          <>
            {(["nw", "ne", "sw", "se"] as const).map((corner) => (
              <div
                key={corner}
                data-handle="true"
                role="button"
                aria-label={`Resize group from ${corner}`}
                tabIndex={0}
                onPointerDown={(e) => onHandlePointerDown(corner, e)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                style={{
                  position: "absolute",
                  width: 8, height: 8,
                  background: tk.groupResizeHandle,
                  borderRadius: 2,
                  cursor: `${corner}-resize`,
                  touchAction: "none",
                  ...(corner.includes("n") ? { top: -4 } : { bottom: -4 }),
                  ...(corner.includes("w") ? { left: -4 } : { right: -4 }),
                }}
              />
            ))}
          </>
        )}
      </div>
  );
});
