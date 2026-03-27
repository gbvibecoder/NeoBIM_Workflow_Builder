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
        <p className="text-xs font-medium text-gray-500">No quantities to estimate</p>
        <p className="mt-1 text-[10px] text-gray-400">
          Add walls, doors, and rooms to generate a Bill of Quantities
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

  // Category totals for chart
  const categoryTotals = Array.from(categories.entries()).map(([cat, items]) => ({
    name: cat,
    total: items.reduce((s, i) => s + (i.amount_inr ?? 0), 0),
    color: CATEGORY_COLORS[cat] ?? "#6B7280",
  })).sort((a, b) => b.total - a.total);

  const maxCatTotal = Math.max(...categoryTotals.map((c) => c.total), 1);

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-800">Bill of Quantities</h3>
          <button
            onClick={() => exportBOQAsCSV(report)}
            className="rounded-md bg-green-50 px-2.5 py-1 text-[10px] font-semibold text-green-700 hover:bg-green-100 transition-colors"
          >
            Export CSV
          </button>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold text-gray-900">
            {formatINR(report.total_estimated_cost)}
          </span>
          <span className="text-[10px] text-gray-400 font-medium">estimated total</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {report.items.length} line items &middot; {report.floor_name}
        </p>
      </div>

      {/* Cost breakdown chart */}
      <div className="p-3 border-b border-gray-200">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Cost Breakdown
        </p>
        <div className="space-y-1.5">
          {categoryTotals.map((cat) => (
            <div key={cat.name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-medium text-gray-600">{cat.name}</span>
                <span className="text-[10px] font-mono text-gray-500">{formatINR(cat.total)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(cat.total / maxCatTotal) * 100}%`,
                    backgroundColor: cat.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed items */}
      <div className="p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Detailed Items
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
                ({formatINR(items.reduce((s, i) => s + (i.amount_inr ?? 0), 0))})
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
                    <span className="text-[10px] text-gray-500">
                      {item.quantity} {item.unit}
                    </span>
                    {item.rate_inr && (
                      <span className="text-[10px] text-gray-400">
                        @ {formatINR(item.rate_inr)}/{item.unit}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-semibold text-gray-700">
                      {item.amount_inr ? formatINR(item.amount_inr) : "—"}
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
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Grand Total
          </span>
          <span className="text-sm font-bold text-gray-900">
            {formatINR(report.total_estimated_cost)}
          </span>
        </div>
        <p className="text-[9px] text-gray-400 mt-1">
          Rates: 2024 Pune metro approximates. Actual costs may vary.
        </p>
      </div>
    </div>
  );
}

function formatINR(amount: number): string {
  if (amount >= 10_000_000) return `\u20B9${(amount / 10_000_000).toFixed(2)} Cr`;
  if (amount >= 100_000) return `\u20B9${(amount / 100_000).toFixed(2)} L`;
  if (amount >= 1_000) return `\u20B9${(amount / 1_000).toFixed(1)}K`;
  return `\u20B9${amount.toFixed(0)}`;
}
