"use client";

import React from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";

export function ExplainPanel() {
  const project = useFloorPlanStore(s => s.project);
  const metrics = useFloorPlanStore(s => s.lastLayoutMetrics);
  const qualityFlags = useFloorPlanStore(s => s.lastQualityFlags);
  const prompt = useFloorPlanStore(s => s.originalPrompt);

  if (!project) return <EmptyState />;

  const floor = project.floors[0];
  if (!floor) return <EmptyState />;

  const rooms = floor.rooms;
  const doors = floor.doors;
  const windows = floor.windows;

  // Parse prompt hints for comparison
  const roomsWithDoors = new Set<string>();
  for (const d of doors) {
    for (const id of d.connects_rooms) {
      if (id) roomsWithDoors.add(id);
    }
  }

  const criticals = qualityFlags.filter(f => f.severity === "critical");
  const warnings = qualityFlags.filter(f => f.severity === "warning");

  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">What We Generated</h3>
        {prompt && (
          <p className="mt-1 text-[10px] text-gray-400 italic line-clamp-2">
            &ldquo;{prompt}&rdquo;
          </p>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Rooms" value={rooms.length} />
        <StatCard label="Doors" value={doors.length} />
        <StatCard label="Windows" value={windows.length} />
        <StatCard
          label="Quality"
          value={metrics ? `${Math.round(metrics.efficiency_pct)}%` : "—"}
          sub="efficiency"
        />
      </div>

      {/* Room list with areas */}
      <div>
        <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Room Breakdown
        </h4>
        <div className="divide-y divide-gray-50 rounded-lg border border-gray-100">
          {rooms.map(room => {
            const hasDoor = roomsWithDoors.has(room.id);
            const areaSqft = Math.round(room.area_sqm * 10.764);
            return (
              <div key={room.id} className="flex items-center justify-between px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: getRoomColor(room.type) }}
                  />
                  <span className="text-[11px] text-gray-700 truncate">{room.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-medium text-gray-500">{areaSqft} sqft</span>
                  {hasDoor ? (
                    <span className="text-green-500" title="Has door">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  ) : (
                    <span className="text-red-400" title="No door">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round"/>
                      </svg>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quality flags */}
      {(criticals.length > 0 || warnings.length > 0) && (
        <div>
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Issues Found
          </h4>
          <div className="space-y-1.5">
            {criticals.map((f, i) => (
              <div key={i} className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-2">
                <p className="text-[11px] font-medium text-red-700">{f.message}</p>
                <p className="text-[10px] text-red-500 mt-0.5">{f.suggestion}</p>
              </div>
            ))}
            {warnings.map((f, i) => (
              <div key={i} className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2">
                <p className="text-[11px] font-medium text-amber-700">{f.message}</p>
                <p className="text-[10px] text-amber-500 mt-0.5">{f.suggestion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics detail */}
      {metrics && (
        <div>
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Metrics
          </h4>
          <div className="space-y-1">
            <MetricRow label="Plot efficiency" value={`${metrics.efficiency_pct}%`} good={metrics.efficiency_pct >= 75} />
            <MetricRow label="Door coverage" value={`${metrics.door_coverage_pct}%`} good={metrics.door_coverage_pct >= 90} />
            <MetricRow label="Orphan rooms" value={String(metrics.orphan_rooms.length)} good={metrics.orphan_rooms.length === 0} />
            <MetricRow label="Void area" value={`${metrics.void_area_sqft} sqft`} good={metrics.void_area_sqft < 200} />
            {metrics.dim_deviations.length > 0 && (
              <MetricRow label="Dim deviation" value={`${metrics.mean_dim_deviation_pct}%`} good={metrics.mean_dim_deviation_pct < 15} />
            )}
          </div>
        </div>
      )}

      {/* Orphan rooms list */}
      {metrics && metrics.orphan_rooms.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-2">
          <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-1">
            Unreachable Rooms ({metrics.orphan_rooms.length})
          </p>
          <p className="text-[11px] text-red-700">
            {metrics.orphan_rooms.join(", ")}
          </p>
          <p className="text-[10px] text-red-500 mt-1">
            These rooms can&apos;t be reached from the entrance. Try regenerating.
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round"/>
      </svg>
      <p className="mt-3 text-xs text-gray-400">Generate a floor plan to see the explanation</p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2.5">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-gray-800 leading-tight">{value}</p>
      {sub && <p className="text-[9px] text-gray-400">{sub}</p>}
    </div>
  );
}

function MetricRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className={`text-[11px] font-medium ${good ? "text-green-600" : "text-amber-600"}`}>
        {value}
      </span>
    </div>
  );
}

function getRoomColor(type: string): string {
  const colors: Record<string, string> = {
    living_room: "#82E0AA", dining_room: "#82E0AA", bedroom: "#85C1E9",
    master_bedroom: "#85C1E9", guest_bedroom: "#85C1E9", kitchen: "#F9E79F",
    bathroom: "#F5B7B1", wc: "#F5B7B1", toilet: "#F5B7B1",
    corridor: "#BDC3C7", lobby: "#BDC3C7", foyer: "#BDC3C7",
    balcony: "#76D7C4", utility: "#BDC3C7", store_room: "#BDC3C7",
    puja_room: "#F5CBA7", study: "#BB8FCE",
  };
  return colors[type] ?? "#BDC3C7";
}
