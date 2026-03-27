"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import {
  FURNITURE_CATEGORIES,
  getCatalogByCategory,
  searchCatalog,
  type FurnitureCategory,
} from "@/lib/floor-plan/furniture-catalog";
import type { CatalogItem } from "@/types/floor-plan-cad";

export function FurniturePanel() {
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState<string | null>("living");

  const handlePlace = useCallback((item: CatalogItem) => {
    const store = useFloorPlanStore.getState();
    const floor = store.getActiveFloor();
    if (!floor) return;

    // Place at center of current viewport
    const vp = store.viewport;
    const centerX = vp.x;
    const centerY = vp.y;

    store.addFurniture({
      catalog_id: item.id,
      position: { x: centerX, y: centerY },
      rotation_deg: 0,
      scale: 1,
      room_id: "",
      locked: false,
    });
  }, []);

  const searchResults = useMemo(() => {
    if (search.trim()) return searchCatalog(search);
    return null;
  }, [search]);

  return (
    <div className="p-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Furniture Library
      </h3>

      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search furniture..."
          className="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
      </div>

      {/* Search results */}
      {searchResults ? (
        <div className="space-y-0.5">
          {searchResults.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-gray-400">No items found</p>
          ) : (
            searchResults.map((item) => (
              <CatalogItemRow key={item.id} item={item} onPlace={handlePlace} />
            ))
          )}
        </div>
      ) : (
        /* Category accordions */
        <div className="space-y-1">
          {FURNITURE_CATEGORIES.map((cat) => (
            <CategoryAccordion
              key={cat.id}
              category={cat}
              expanded={expandedCat === cat.id}
              onToggle={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
              onPlace={handlePlace}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryAccordion({
  category,
  expanded,
  onToggle,
  onPlace,
}: {
  category: { id: string; label: string };
  expanded: boolean;
  onToggle: () => void;
  onPlace: (item: CatalogItem) => void;
}) {
  const items = getCatalogByCategory(category.id as FurnitureCategory);

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
      >
        <span className="font-medium">{category.label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{items.length}</span>
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="ml-2 space-y-0.5 border-l border-gray-100 pl-2 pt-1">
          {items.map((item) => (
            <CatalogItemRow key={item.id} item={item} onPlace={onPlace} />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogItemRow({
  item,
  onPlace,
}: {
  item: CatalogItem;
  onPlace: (item: CatalogItem) => void;
}) {
  return (
    <button
      onClick={() => onPlace(item)}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
    >
      {/* Mini icon (rectangle proportional to item) */}
      <div className="flex h-6 w-6 items-center justify-center">
        <div
          className="border border-current opacity-50"
          style={{
            width: Math.max(8, Math.min(22, (item.width_mm || 600) / 120)),
            height: Math.max(6, Math.min(22, (item.depth_mm || 400) / 120)),
          }}
        />
      </div>
      <div className="flex-1 truncate">{item.name}</div>
      <span className="text-[10px] text-gray-400 font-mono">
        {(item.width_mm / 1000).toFixed(1)}x{(item.depth_mm / 1000).toFixed(1)}
      </span>
    </button>
  );
}
