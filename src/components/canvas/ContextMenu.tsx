"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Copy, Trash2, Maximize2, Eraser, ZoomIn } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContextMenuType = "canvas" | "node";

export interface ContextMenuState {
  x: number;
  y: number;
  type: ContextMenuType;
  nodeId?: string;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  // Canvas actions
  onFitView: () => void;
  onClearCanvas: () => void;
  // Node actions
  onDuplicateNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onFitToNode: (nodeId: string) => void;
}

// ─── Menu item helpers ────────────────────────────────────────────────────────

interface MenuItemProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function MenuItem({ label, icon, onClick, danger, disabled }: MenuItemProps) {
  const [hovered, setHovered] = React.useState(false);

  const fg = danger
    ? (hovered ? "#FF6B6B" : "#EF4444")
    : (hovered ? "#F0F0F5" : "#C0C0D0");

  const bg = disabled
    ? "transparent"
    : hovered
      ? (danger ? "rgba(239,68,68,0.08)" : "rgba(0,245,255,0.07)")
      : "transparent";

  return (
    <button
      disabled={disabled}
      onClick={() => { if (!disabled) onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        width: "100%", padding: "6px 12px",
        background: bg, borderTop: "none", borderRight: "none", borderBottom: "none",
        cursor: disabled ? "default" : "pointer",
        borderLeft: hovered && !disabled ? `2px solid ${danger ? "#EF4444" : "#00F5FF"}` : "2px solid transparent",
        transition: "background 0.08s, border-color 0.08s",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <span style={{ color: hovered && !disabled ? fg : "#4A4A60", flexShrink: 0, transition: "color 0.08s", display: "flex" }}>
        {icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: fg, transition: "color 0.08s", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
  );
}

function Separator() {
  return <div style={{ height: 1, background: "#1A1A26", margin: "3px 0" }} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ContextMenu({
  menu, onClose,
  onFitView, onClearCanvas,
  onDuplicateNode, onDeleteNode, onFitToNode,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use mousedown so it fires before any click handlers
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Nudge menu into viewport
  const menuW = 180;
  const menuH = menu.type === "node" ? 130 : 120;
  const left = Math.min(menu.x, window.innerWidth  - menuW - 8);
  const top  = Math.min(menu.y, window.innerHeight - menuH - 8);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
      style={{
        position: "fixed",
        left, top,
        width: menuW,
        zIndex: 9990,
        background: "rgba(7,8,9,0.92)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 4,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
        overflow: "hidden",
        padding: "4px 0",
      }}
      // Prevent the right-click event from propagating to pane
      onContextMenu={e => e.preventDefault()}
    >
      {/* Section label */}
      <div style={{
        padding: "4px 12px 3px",
        fontSize: 9, fontWeight: 700, color: "#2E2E44",
        textTransform: "uppercase", letterSpacing: "0.6px",
      }}>
        {menu.type === "node" ? "Node" : "Canvas"}
      </div>

      {menu.type === "node" && menu.nodeId ? (
        <>
          <MenuItem
            label="Duplicate"
            icon={<Copy size={13} />}
            onClick={() => { onDuplicateNode(menu.nodeId!); onClose(); }}
          />
          <MenuItem
            label="Fit to Node"
            icon={<ZoomIn size={13} />}
            onClick={() => { onFitToNode(menu.nodeId!); onClose(); }}
          />
          <Separator />
          <MenuItem
            label="Delete Node"
            icon={<Trash2 size={13} />}
            onClick={() => { onDeleteNode(menu.nodeId!); onClose(); }}
            danger
          />
        </>
      ) : (
        <>
          <MenuItem
            label="Fit to View"
            icon={<Maximize2 size={13} />}
            onClick={() => { onFitView(); onClose(); }}
          />
          <Separator />
          <MenuItem
            label="Clear Canvas"
            icon={<Eraser size={13} />}
            onClick={() => { onClearCanvas(); onClose(); }}
            danger
          />
        </>
      )}
    </motion.div>
  );
}
