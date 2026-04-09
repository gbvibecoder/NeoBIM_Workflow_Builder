"use client";

import React, { useEffect, useRef } from "react";
import { useFloorPlanStore, type ContextMenuState } from "@/features/floor-plan/stores/floor-plan-store";

export function ContextMenu() {
  const contextMenu = useFloorPlanStore((s) => s.contextMenu);
  const setContextMenu = useFloorPlanStore((s) => s.setContextMenu);

  if (!contextMenu) return null;

  return (
    <ContextMenuPortal
      menu={contextMenu}
      onClose={() => setContextMenu(null)}
    />
  );
}

// ============================================================
// PORTAL (positioned at click location)
// ============================================================

function ContextMenuPortal({
  menu,
  onClose,
}: {
  menu: ContextMenuState;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use setTimeout to avoid immediately closing from the right-click event
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reposition if menu overflows the viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = menu.x;
    let y = menu.y;
    if (rect.right > vw - 8) x = Math.max(8, vw - rect.width - 8);
    if (rect.bottom > vh - 8) y = Math.max(8, vh - rect.height - 8);
    if (x !== menu.x || y !== menu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [menu.x, menu.y]);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-xl text-sm"
      style={{ left: menu.x, top: menu.y }}
    >
      <MenuContent menu={menu} onClose={onClose} />
    </div>
  );
}

// ============================================================
// MENU CONTENT (per entity type)
// ============================================================

function MenuContent({
  menu,
  onClose,
}: {
  menu: ContextMenuState;
  onClose: () => void;
}) {
  const store = useFloorPlanStore;

  switch (menu.entityType) {
    case "wall":
      return <WallMenu wallId={menu.entityId!} onClose={onClose} />;
    case "door":
      return <DoorMenu doorId={menu.entityId!} onClose={onClose} />;
    case "window":
      return <WindowMenu windowId={menu.entityId!} onClose={onClose} />;
    case "room":
      return <RoomMenu roomId={menu.entityId!} onClose={onClose} />;
    case "furniture":
      return <FurnitureMenu furnitureId={menu.entityId!} onClose={onClose} />;
    case "empty":
      return <EmptyMenu onClose={onClose} />;
    default:
      return null;
  }
}

// ============================================================
// WALL CONTEXT MENU
// ============================================================

function WallMenu({ wallId, onClose }: { wallId: string; onClose: () => void }) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const wall = floor?.walls.find((w) => w.id === wallId);

  const handleSetType = (type: "exterior" | "interior") => {
    const store = useFloorPlanStore.getState();
    store.pushHistory();
    store.updateWall(wallId, { type });
    onClose();
  };

  const handleAddDoor = () => {
    const store = useFloorPlanStore.getState();
    store.setActiveTool("door");
    onClose();
  };

  const handleAddWindow = () => {
    const store = useFloorPlanStore.getState();
    store.setActiveTool("window");
    onClose();
  };

  const handleDelete = () => {
    const store = useFloorPlanStore.getState();
    store.setSelectedIds([wallId]);
    store.deleteSelectedEntities();
    onClose();
  };

  return (
    <>
      <MenuItem label={`Wall — ${wall?.type ?? "unknown"}`} disabled />
      <MenuSep />
      <MenuItem label="Set as Exterior" onClick={() => handleSetType("exterior")} />
      <MenuItem label="Set as Interior" onClick={() => handleSetType("interior")} />
      <MenuSep />
      <MenuItem label="Add Door on This Wall" onClick={handleAddDoor} />
      <MenuItem label="Add Window on This Wall" onClick={handleAddWindow} />
      <MenuSep />
      <MenuItem label="Delete Wall" shortcut="Del" onClick={handleDelete} danger />
    </>
  );
}

// ============================================================
// DOOR CONTEXT MENU
// ============================================================

function DoorMenu({ doorId, onClose }: { doorId: string; onClose: () => void }) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const door = floor?.doors.find((d) => d.id === doorId);

  const handleFlip = () => {
    const store = useFloorPlanStore.getState();
    store.setSelectedIds([doorId]);
    store.flipSelectedDoor();
    onClose();
  };

  const handleDelete = () => {
    const store = useFloorPlanStore.getState();
    store.setSelectedIds([doorId]);
    store.deleteSelectedEntities();
    onClose();
  };

  return (
    <>
      <MenuItem label={`Door — ${door?.type.replace(/_/g, " ") ?? "unknown"}`} disabled />
      <MenuSep />
      <MenuItem label="Flip Swing Direction" shortcut="F" onClick={handleFlip} />
      <MenuSep />
      <MenuItem label="Delete Door" shortcut="Del" onClick={handleDelete} danger />
    </>
  );
}

// ============================================================
// WINDOW CONTEXT MENU
// ============================================================

function WindowMenu({ windowId, onClose }: { windowId: string; onClose: () => void }) {
  const handleDelete = () => {
    const store = useFloorPlanStore.getState();
    store.setSelectedIds([windowId]);
    store.deleteSelectedEntities();
    onClose();
  };

  return (
    <>
      <MenuItem label="Window" disabled />
      <MenuSep />
      <MenuItem label="Delete Window" shortcut="Del" onClick={handleDelete} danger />
    </>
  );
}

// ============================================================
// ROOM CONTEXT MENU
// ============================================================

function RoomMenu({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const room = floor?.rooms.find((r) => r.id === roomId);

  const handleChangeType = (type: string) => {
    const store = useFloorPlanStore.getState();
    store.pushHistory();
    store.updateRoom(roomId, { type: type as any });
    onClose();
  };

  const commonTypes = [
    "living_room", "bedroom", "kitchen", "bathroom",
    "dining_room", "study", "corridor", "balcony",
  ];

  const handleAutoFurnish = () => {
    useFloorPlanStore.getState().autoFurnishRoom(roomId);
    onClose();
  };

  return (
    <>
      <MenuItem label={`Room — ${room?.name ?? "unknown"}`} disabled />
      <MenuSep />
      {commonTypes.map((t) => (
        <MenuItem
          key={t}
          label={t.replace(/_/g, " ")}
          onClick={() => handleChangeType(t)}
          active={room?.type === t}
        />
      ))}
      <MenuSep />
      <MenuItem label="Smart Furnish" onClick={handleAutoFurnish} shortcut="AI" />
    </>
  );
}

// ============================================================
// FURNITURE CONTEXT MENU
// ============================================================

function FurnitureMenu({ furnitureId, onClose }: { furnitureId: string; onClose: () => void }) {
  const handleRotate = () => {
    useFloorPlanStore.getState().rotateFurniture(furnitureId, 90);
    onClose();
  };

  const handleDuplicate = () => {
    useFloorPlanStore.getState().duplicateFurniture(furnitureId);
    onClose();
  };

  const handleDelete = () => {
    const store = useFloorPlanStore.getState();
    store.setSelectedIds([furnitureId]);
    store.deleteSelectedEntities();
    onClose();
  };

  return (
    <>
      <MenuItem label="Furniture" disabled />
      <MenuSep />
      <MenuItem label="Rotate 90°" shortcut="R" onClick={handleRotate} />
      <MenuItem label="Duplicate" onClick={handleDuplicate} />
      <MenuSep />
      <MenuItem label="Delete" onClick={handleDelete} danger />
    </>
  );
}

// ============================================================
// EMPTY SPACE CONTEXT MENU
// ============================================================

function EmptyMenu({ onClose }: { onClose: () => void }) {
  const selectedIds = useFloorPlanStore((s) => s.selectedIds);

  const handleAddWall = () => {
    useFloorPlanStore.getState().setActiveTool("wall");
    onClose();
  };

  const handleZoomExtents = () => {
    useFloorPlanStore.getState().fitToView();
    onClose();
  };

  const handleToggleGrid = () => {
    useFloorPlanStore.getState().toggleGrid();
    onClose();
  };

  const handleDeleteSelected = () => {
    useFloorPlanStore.getState().deleteSelectedEntities();
    onClose();
  };

  const handlePaste = () => {
    useFloorPlanStore.getState().pasteAtCursor();
    onClose();
  };

  return (
    <>
      {selectedIds.length > 0 && (
        <>
          <MenuItem label={`Delete Selected (${selectedIds.length})`} shortcut="Del" onClick={handleDeleteSelected} danger />
          <MenuSep />
        </>
      )}
      <MenuItem label="Paste" shortcut="⌘V" onClick={handlePaste} />
      <MenuItem label="Add Wall Here" shortcut="L" onClick={handleAddWall} />
      <MenuSep />
      <MenuItem label="Zoom Extents" shortcut="F" onClick={handleZoomExtents} />
      <MenuItem label="Toggle Grid" shortcut="G" onClick={handleToggleGrid} />
    </>
  );
}

// ============================================================
// SHARED MENU PRIMITIVES
// ============================================================

function MenuItem({
  label,
  onClick,
  shortcut,
  danger,
  disabled,
  active,
}: {
  label: string;
  onClick?: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
        disabled
          ? "text-gray-400 font-medium cursor-default"
          : danger
          ? "text-red-600 hover:bg-red-50"
          : active
          ? "text-blue-600 bg-blue-50 font-medium"
          : "text-gray-700 hover:bg-gray-50"
      }`}
    >
      <span className="capitalize">{label}</span>
      {shortcut && <span className="text-gray-400 ml-4 text-[10px]">{shortcut}</span>}
    </button>
  );
}

function MenuSep() {
  return <div className="my-1 h-px bg-gray-100" />;
}
