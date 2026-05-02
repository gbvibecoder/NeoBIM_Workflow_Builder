"use client";

import { useEffect, useRef } from "react";
import s from "./page.module.css";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function WorkflowContextMenu({
  x, y, onClose, onOpen, onRename, onDuplicate, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const adjustedX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 220);
  const adjustedY = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - 260);

  return (
    <div ref={ref} className={s.contextMenu} style={{ left: adjustedX, top: adjustedY }}>
      <button className={s.contextMenuItem} onClick={onOpen}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
        Open in canvas
        <span className={s.contextMenuShortcut}>{"\u23CE"}</span>
      </button>
      <div className={s.contextMenuDivider} />
      <button className={s.contextMenuItem} onClick={onRename}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
        Rename
        <span className={s.contextMenuShortcut}>F2</span>
      </button>
      <button className={s.contextMenuItem} onClick={onDuplicate}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
        Duplicate
        <span className={s.contextMenuShortcut}>{"\u2318"}D</span>
      </button>
      <div className={s.contextMenuDivider} />
      <button className={s.contextMenuItem} data-danger="true" onClick={onDelete}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
        Delete workflow
        <span className={s.contextMenuShortcut}>{"\u232B"}</span>
      </button>
    </div>
  );
}
