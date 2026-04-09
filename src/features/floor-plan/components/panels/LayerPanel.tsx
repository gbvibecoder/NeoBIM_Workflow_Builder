"use client";

import React from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";

export function LayerPanel() {
  const layers = useFloorPlanStore((s) => s.layers);
  const toggleVisibility = useFloorPlanStore((s) => s.toggleLayerVisibility);
  const toggleLock = useFloorPlanStore((s) => s.toggleLayerLock);

  return (
    <div className="p-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Layers
      </h3>
      <div className="space-y-0.5">
        {layers.map((layer) => (
          <div
            key={layer.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-100"
          >
            {/* Visibility toggle */}
            <button
              onClick={() => toggleVisibility(layer.id)}
              className={`text-xs ${layer.visible ? "text-blue-500" : "text-gray-300"}`}
              title={layer.visible ? "Hide layer" : "Show layer"}
            >
              {layer.visible ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7C1 7 3 3 7 3C11 3 13 7 13 7C13 7 11 11 7 11C3 11 1 7 1 7Z" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7C1 7 3 3 7 3C11 3 13 7 13 7" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              )}
            </button>

            {/* Lock toggle */}
            <button
              onClick={() => toggleLock(layer.id)}
              className={`text-xs ${layer.locked ? "text-amber-500" : "text-gray-300"}`}
              title={layer.locked ? "Unlock layer" : "Lock layer"}
            >
              {layer.locked ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4 5V3.5C4 2.12 5.12 1 6.5 1H5.5C6.88 1 8 2.12 8 3.5V5" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4 5V3.5C4 2.12 5.12 1 6.5 1H5.5C6.88 1 8 2.12 8 3.5" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              )}
            </button>

            {/* Layer name */}
            <span className={`flex-1 text-xs truncate ${
              layer.visible ? "text-gray-700" : "text-gray-400"
            }`}>
              {layer.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
