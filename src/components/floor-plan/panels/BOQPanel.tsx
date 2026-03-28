"use client";

import React, { useMemo } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { generateBOQ, exportBOQAsCSV, type BOQReport } from "@/lib/floor-plan/boq-generator";

const CATEGORY_COLORS: Record<string, string> = {
  Masonry: "#8B5CF6",
  Plastering: "#3B82F6",
  Doors: "#F59E0B",
  Windows: "#06B6D4",
  Flooring: "#10B981",
  Painting: "#EC4899",
  Waterproofing: "#6366F1",
  Structural: "#EF4444",
};

export function BOQPanel() {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());

  const report: BOQReport | null = useMemo(() => {
    if (!floor) return null;
    return generateBOQ(floor);
  }, [floor]);

  if (!report || report.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-xs font-medium text-gray-500">No quantities to extract</p>
        <p className="mt-1 text-[10px] text-gray-400">
          Add walls, doors, and rooms to generate a material takeoff
        </p>
      </div>
    );
  }

  // Group by category
  const categories = new Map<string, typeof report.items>();
  for (const item of report.items) {
    if (!categories.has(item.category)) categories.set(item.category, []);
    categories.get(item.category)!.push(item);
  }

  // Category quantities for chart (use total quantity as metric)
  const categoryData = Array.from(categories.entries()).map(([cat, items]) => ({
    name: cat,
    count: items.length,
    color: CATEGORY_COLORS[cat] ?? "#6B7280",
  }));

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-800">Material Takeoff</h3>
          <button
            onClick={() => exportBOQAsCSV(report)}
            className="rounded-md bg-green-50 px-2.5 py-1 text-[10px] font-semibold text-green-700 hover:bg-green-100 transition-colors"
          >
            Export CSV
          </button>
        </div>
        <p className="text-[10px] text-gray-400">
          {report.items.length} line items &middot; {report.floor_name}
        </p>
        <p className="text-[9px] text-gray-400 mt-0.5">
          Quantities only — costing via TR-008 pipeline
        </p>
      </div>

      {/* Category summary */}
      <div className="p-3 border-b border-gray-200">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Categories
        </p>
        <div className="flex flex-wrap gap-1.5">
          {categoryData.map((cat) => (
            <span
              key={cat.name}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: cat.color + "15", color: cat.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
              {cat.name} ({cat.count})
            </span>
          ))}
        </div>
      </div>

      {/* Detailed items */}
      <div className="p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Detailed Quantities
        </p>
        {Array.from(categories.entries()).map(([category, items]) => (
          <div key={category} className="mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[category] ?? "#6B7280" }}
              />
              <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wide">
                {category}
              </span>
              <span className="text-[10px] text-gray-400">
                ({items.length} {items.length === 1 ? "item" : "items"})
              </span>
            </div>
            <div className="space-y-1 ml-3.5">
              {items.map((item) => (
                <div
                  key={item.sno}
                  className="rounded-md bg-gray-50 px-2.5 py-1.5 border border-gray-100"
                >
                  <div className="flex items-start justify-between">
                    <span className="text-[11px] font-medium text-gray-700 leading-tight flex-1">
                      {item.description}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] font-semibold text-gray-800">
                      {item.quantity} {item.unit}
                    </span>
                  </div>
                  {item.remarks && (
                    <p className="text-[9px] text-gray-400 mt-0.5">{item.remarks}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <p className="text-[9px] text-gray-400">
          Geometry-derived quantities. Cost estimation handled by the BOQ/Cost Mapper (TR-008) using live market rates.
        </p>
      </div>
    </div>
  );
}
