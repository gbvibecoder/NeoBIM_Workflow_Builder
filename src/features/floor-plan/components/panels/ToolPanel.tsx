"use client";

import React from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import type { EditorTool } from "@/types/floor-plan-cad";

interface ToolDef {
  id: EditorTool;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  {
    id: "select",
    label: "Select",
    shortcut: "V",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 2L4 14L7.5 10.5L10.5 16L12.5 15L9.5 9L14 9L4 2Z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: "wall",
    label: "Draw Wall",
    shortcut: "L",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="7" width="14" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="5" y1="7" x2="5" y2="11" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1.5 1"/>
        <line x1="9" y1="7" x2="9" y2="11" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1.5 1"/>
        <line x1="13" y1="7" x2="13" y2="11" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1.5 1"/>
      </svg>
    ),
  },
  {
    id: "door",
    label: "Place Door",
    shortcut: "D",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="3" width="8" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="9" cy="9" r="1" fill="currentColor"/>
        <path d="M11 3C11 3 15 6 15 9C15 12 11 15 11 15" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.5"/>
      </svg>
    ),
  },
  {
    id: "window",
    label: "Place Window",
    shortcut: "W",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="4" width="14" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="9" y1="4" x2="9" y2="14" stroke="currentColor" strokeWidth="1"/>
        <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1"/>
      </svg>
    ),
  },
  {
    id: "furniture",
    label: "Furniture",
    shortcut: "",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="6" width="12" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="4" y="4" width="10" height="3" rx="0.5" stroke="currentColor" strokeWidth="1"/>
        <line x1="5" y1="12" x2="5" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="13" y1="12" x2="13" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "column",
    label: "Place Column",
    shortcut: "C",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="5" y="3" width="8" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="5" y1="3" x2="13" y2="15" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
        <line x1="13" y1="3" x2="5" y2="15" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
      </svg>
    ),
  },
  {
    id: "stair",
    label: "Place Stair",
    shortcut: "",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 15H7V11H11V7H15V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="7" y1="15" x2="7" y2="11" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="11" y1="11" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="15" y1="7" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: "measure",
    label: "Measure",
    shortcut: "M",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <line x1="3" y1="15" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="3" y1="12" x2="3" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="3" y1="15" x2="6" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="12" y1="3" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="15" y1="3" x2="15" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "annotate",
    label: "Annotate",
    shortcut: "T",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <text x="3" y="14" fontSize="14" fontWeight="bold" fill="currentColor" fontFamily="serif">T</text>
      </svg>
    ),
  },
  {
    id: "pan",
    label: "Pan",
    shortcut: "Space",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2V6M9 12V16M2 9H6M12 9H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M9 2L7 4M9 2L11 4M9 16L7 14M9 16L11 14M2 9L4 7M2 9L4 11M16 9L14 7M16 9L14 11" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function ToolPanel() {
  const activeTool = useFloorPlanStore((s) => s.activeTool);
  const setActiveTool = useFloorPlanStore((s) => s.setActiveTool);

  return (
    <div className="p-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Tools
      </h3>
      <div className="flex flex-col gap-0.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
              activeTool === tool.id
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
            }`}
            title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
          >
            <span className={activeTool === tool.id ? "text-blue-600" : "text-gray-400"}>
              {tool.icon}
            </span>
            <span className="flex-1">{tool.label}</span>
            {tool.shortcut && (
              <span className="text-[10px] text-gray-400 font-mono">{tool.shortcut}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
