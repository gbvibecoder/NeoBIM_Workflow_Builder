"use client";

import React, { useEffect, useRef } from "react";
import { EyeOff, Scan, RotateCcw, Maximize, MousePointerClick } from "lucide-react";
import { UI } from "./constants";

export interface ContextMenuData {
  x: number;
  y: number;
  expressID: number;
  typeName: string;
}

interface ContextMenuProps {
  data: ContextMenuData;
  onHide: () => void;
  onIsolate: () => void;
  onSelectSimilar: () => void;
  onShowAll: () => void;
  onFitToElement: () => void;
  onClose: () => void;
}

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 12px",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: UI.text.secondary,
  fontSize: 13,
  cursor: "pointer",
  textAlign: "left",
  transition: "background 0.08s",
};

function Item({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={itemStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(99,130,255,0.08)";
        e.currentTarget.style.color = UI.text.primary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = UI.text.secondary;
      }}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

export function ContextMenu({
  data,
  onHide,
  onIsolate,
  onSelectSimilar,
  onShowAll,
  onFitToElement,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /* Keep menu within viewport bounds */
  const style: React.CSSProperties = {
    position: "fixed",
    left: data.x,
    top: data.y,
    zIndex: 9999,
    minWidth: 180,
    padding: 4,
    borderRadius: UI.radius.md,
    background: UI.bg.elevated,
    border: `1px solid ${UI.border.default}`,
    boxShadow: UI.shadow.panel,
  };

  return (
    <div ref={ref} style={style}>
      <Item icon={EyeOff} label="Hide Element" onClick={() => { onHide(); onClose(); }} />
      <Item icon={Scan} label="Isolate Element" onClick={() => { onIsolate(); onClose(); }} />
      <Item icon={Maximize} label="Zoom to Element" onClick={() => { onFitToElement(); onClose(); }} />
      <div style={{ height: 1, background: UI.border.subtle, margin: "4px 0" }} />
      <Item
        icon={MousePointerClick}
        label={`Select All ${data.typeName}`}
        onClick={() => { onSelectSimilar(); onClose(); }}
      />
      <Item icon={RotateCcw} label="Show All" onClick={() => { onShowAll(); onClose(); }} />
    </div>
  );
}
