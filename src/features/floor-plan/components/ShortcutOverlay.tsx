"use client";

import React, { useState, useEffect } from "react";

const SHORTCUT_GROUPS = [
  {
    title: "Tools",
    shortcuts: [
      { key: "V", desc: "Select" },
      { key: "L", desc: "Draw Wall" },
      { key: "D", desc: "Place Door" },
      { key: "W", desc: "Place Window" },
      { key: "M", desc: "Measure" },
      { key: "T", desc: "Annotate" },
    ],
  },
  {
    title: "View",
    shortcuts: [
      { key: "1", desc: "CAD mode" },
      { key: "2", desc: "Presentation mode" },
      { key: "3", desc: "Construction mode" },
      { key: "F", desc: "Fit to View" },
      { key: "G", desc: "Toggle Grid" },
      { key: "S", desc: "Toggle Snap" },
      { key: "O", desc: "Toggle Ortho" },
    ],
  },
  {
    title: "Edit",
    shortcuts: [
      { key: "\u2318Z", desc: "Undo" },
      { key: "\u2318\u21E7Z", desc: "Redo" },
      { key: "Del", desc: "Delete Selected" },
      { key: "F", desc: "Flip Door Swing" },
      { key: "Esc", desc: "Cancel / Deselect" },
    ],
  },
  {
    title: "Measure",
    shortcuts: [
      { key: "P", desc: "Pin Measurement" },
      { key: "Esc", desc: "Clear Measurement" },
    ],
  },
  {
    title: "Export",
    shortcuts: [
      { key: "\u2318E", desc: "Open Export Menu" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { key: "?", desc: "Toggle this overlay" },
      { key: "Space", desc: "Pan (hold)" },
      { key: "Scroll", desc: "Zoom in/out" },
      { key: "Shift+Click", desc: "Multi-select" },
    ],
  },
];

export function ShortcutOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => setVisible(false)}
    >
      <div
        className="max-h-[80vh] w-[640px] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Keyboard Shortcuts</h2>
          <button
            onClick={() => setVisible(false)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((s) => (
                  <div
                    key={s.key + s.desc}
                    className="flex items-center justify-between rounded px-2 py-1 hover:bg-gray-50"
                  >
                    <span className="text-xs text-gray-600">{s.desc}</span>
                    <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-gray-100 pt-3 text-center">
          <span className="text-[10px] text-gray-400">
            Press <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] font-mono">?</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
