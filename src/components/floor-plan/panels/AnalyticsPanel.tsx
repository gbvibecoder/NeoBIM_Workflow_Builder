"use client";

import React, { useMemo } from "react";
import { useFloorPlanStore } from "@/stores/floor-plan-store";
import { polygonBounds, wallLength, polygonArea } from "@/features/floor-plan/lib/geometry";
import type { Floor, Room, Wall } from "@/types/floor-plan-cad";
import { analyzeNaturalLight, type LightAnalysisResult, type LightGrade } from "@/lib/floor-plan/light-analysis";

// ============================================================
// TYPES
// ============================================================

interface AreaMetrics {
  total_area_sqm: number;
  carpet_area_sqm: number;
  rooms: Array<{
    id: string;
    name: string;
    type: string;
    area_sqm: number;
    percentage: number;
  }>;
  by_zone: Record<string, { area_sqm: number; percentage: number }>;
}

interface ProportionMetrics {
  rooms: Array<{
    id: string;
    name: string;
    width_m: number;
    depth_m: number;
    ratio: number;
    rating: "excellent" | "good" | "fair" | "poor";
  }>;
}

interface CirculationMetrics {
  total_circulation_sqm: number;
  total_floor_sqm: number;
  percentage: number;
  rating: "optimal" | "acceptable" | "excessive" | "insufficient";
  corridors: Array<{
    id: string;
    name: string;
    width_m: number;
    length_m: number;
    area_sqm: number;
  }>;
}

interface OpeningMetrics {
  rooms: Array<{
    id: string;
    name: string;
    window_area_sqm: number;
    floor_area_sqm: number;
    ratio: number;
    doors_count: number;
    windows_count: number;
    rating: "excellent" | "adequate" | "insufficient";
  }>;
}

interface WallMetrics {
  total_wall_length_m: number;
  exterior_length_m: number;
  interior_length_m: number;
  exterior_percent: number;
  wall_to_floor_ratio: number;
  by_material: Record<string, { length_m: number; percentage: number }>;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function AnalyticsPanel() {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const northAngle = useFloorPlanStore((s) => s.project?.settings.north_angle_deg ?? 0);
  const lightOverlayVisible = useFloorPlanStore((s) => s.lightOverlayVisible);
  const toggleLightOverlay = useFloorPlanStore((s) => s.toggleLightOverlay);

  const metrics = useMemo(() => {
    if (!floor) return null;
    return {
      area: computeAreaMetrics(floor),
      proportions: computeProportionMetrics(floor),
      circulation: computeCirculationMetrics(floor),
      openings: computeOpeningMetrics(floor),
      walls: computeWallMetrics(floor),
      light: analyzeNaturalLight(floor, northAngle),
    };
  }, [floor, northAngle]);

  if (!metrics) {
    return <div className="p-4 text-sm text-gray-400">No floor plan loaded.</div>;
  }

  return (
    <div className="flex flex-col text-xs overflow-y-auto max-h-[calc(100vh-200px)]">
      <AreaSection data={metrics.area} />
      <LightSection data={metrics.light} overlayVisible={lightOverlayVisible} onToggle={toggleLightOverlay} />
      <ProportionsSection data={metrics.proportions} />
      <CirculationSection data={metrics.circulation} />
      <OpeningsSection data={metrics.openings} />
      <WallSection data={metrics.walls} />
    </div>
  );
}

// ============================================================
// SECTIONS
// ============================================================

function AreaSection({ data }: { data: AreaMetrics }) {
  const maxArea = Math.max(...data.rooms.map((r) => r.area_sqm), 1);

  return (
    <div className="border-b border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Area Analysis</h3>
      <div className="flex gap-4 mb-3">
        <div>
          <div className="text-lg font-bold text-gray-800">{data.total_area_sqm.toFixed(1)}</div>
          <div className="text-[9px] text-gray-400 uppercase">Total sq.m</div>
        </div>
        <div>
          <div className="text-lg font-bold text-blue-600">{data.carpet_area_sqm.toFixed(1)}</div>
          <div className="text-[9px] text-gray-400 uppercase">Carpet sq.m</div>
        </div>
        <div>
          <div className="text-lg font-bold text-green-600">{data.rooms.length}</div>
          <div className="text-[9px] text-gray-400 uppercase">Rooms</div>
        </div>
      </div>

      {/* Bar chart */}
      {data.rooms.map((room) => (
        <div key={room.id} className="flex items-center gap-2 mb-1.5">
          <span className="w-24 truncate text-gray-600">{room.name}</span>
          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-400"
              style={{ width: `${(room.area_sqm / maxArea) * 100}%` }}
            />
          </div>
          <span className="w-12 text-right text-gray-500">{room.area_sqm.toFixed(1)}</span>
          <span className="w-8 text-right text-gray-400">{room.percentage.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function ProportionsSection({ data }: { data: ProportionMetrics }) {
  return (
    <div className="border-b border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Room Proportions</h3>
      {data.rooms.map((room) => (
        <div key={room.id} className="flex items-center gap-2 mb-1.5">
          <span className="w-24 truncate text-gray-600">{room.name}</span>
          <span className="text-gray-400">{room.width_m.toFixed(1)}m x {room.depth_m.toFixed(1)}m</span>
          <span className="text-gray-500 ml-auto">{room.ratio.toFixed(2)}</span>
          <RatingBadge rating={room.rating} />
        </div>
      ))}
      <p className="text-gray-400 mt-2 text-[10px]">Ideal ratio: 1.0–1.5 (close to square). Acceptable: up to 2.0.</p>
    </div>
  );
}

function CirculationSection({ data }: { data: CirculationMetrics }) {
  const ratingColor = {
    optimal: "#22c55e",
    acceptable: "#3b82f6",
    excessive: "#eab308",
    insufficient: "#ef4444",
  }[data.rating];

  return (
    <div className="border-b border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Circulation Analysis</h3>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-lg font-bold" style={{ color: ratingColor }}>
          {data.percentage.toFixed(1)}%
        </div>
        <div className="text-gray-500">of total area is circulation</div>
      </div>
      {/* Donut-like bar */}
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden mb-2">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(data.percentage, 100)}%`,
            backgroundColor: ratingColor,
          }}
        />
      </div>
      <div className="flex justify-between text-gray-400">
        <span>10%</span>
        <span>15% (ideal)</span>
        <span>25%</span>
        <span>40%</span>
      </div>
      {data.corridors.map((c) => (
        <div key={c.id} className="flex items-center gap-2 mt-2 text-gray-500">
          <span className="truncate">{c.name}</span>
          <span className="ml-auto">{c.width_m.toFixed(1)}m wide</span>
          <span>{c.area_sqm.toFixed(1)} sq.m</span>
        </div>
      ))}
    </div>
  );
}

function OpeningsSection({ data }: { data: OpeningMetrics }) {
  return (
    <div className="border-b border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Openings Analysis</h3>
      {data.rooms.map((room) => (
        <div key={room.id} className="mb-2 pb-2 border-b border-gray-50 last:border-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-700 truncate">{room.name}</span>
            <RatingBadge rating={room.rating} />
          </div>
          <div className="flex items-center gap-3 text-gray-500">
            <span>{room.windows_count} window{room.windows_count !== 1 ? "s" : ""}</span>
            <span>{room.doors_count} door{room.doors_count !== 1 ? "s" : ""}</span>
            <span className="ml-auto">W/F: {(room.ratio * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(room.ratio * 100 * 5, 100)}%`, // Scale for visibility (20% = full)
                backgroundColor: room.rating === "excellent" ? "#22c55e" : room.rating === "adequate" ? "#3b82f6" : "#ef4444",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function LightSection({
  data,
  overlayVisible,
  onToggle,
}: {
  data: LightAnalysisResult;
  overlayVisible: boolean;
  onToggle: () => void;
}) {
  const GRADE_COLORS: Record<string, string> = {
    excellent: "#ca8a04",
    good: "#65a30d",
    fair: "#3b82f6",
    poor: "#64748b",
  };

  const GRADE_ICONS: Record<string, string> = {
    excellent: "\u2600",
    good: "\u2600",
    fair: "\u26C5",
    poor: "\u2601",
  };

  return (
    <div className="border-b border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Natural Light</h3>
        <button
          onClick={onToggle}
          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            overlayVisible
              ? "bg-yellow-100 text-yellow-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {overlayVisible ? "Hide Heatmap" : "Show Heatmap"}
        </button>
      </div>

      {/* Average score */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-2xl font-bold" style={{ color: GRADE_COLORS[data.averageGrade] }}>
          {data.averageScore}
        </div>
        <div>
          <div className="font-medium text-gray-600 capitalize">{data.averageGrade} Average</div>
          <div className="text-gray-400">{data.rooms.length} rooms analyzed</div>
        </div>
      </div>

      {/* Per-room scores */}
      {data.rooms
        .sort((a, b) => a.score - b.score)
        .map((room) => (
          <div key={room.roomId} className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px]">{GRADE_ICONS[room.grade]}</span>
            <span className="w-24 truncate text-gray-600">{room.roomName}</span>
            <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${room.score}%`,
                  backgroundColor: GRADE_COLORS[room.grade],
                }}
              />
            </div>
            <span className="w-8 text-right font-medium" style={{ color: GRADE_COLORS[room.grade] }}>
              {room.score}
            </span>
          </div>
        ))}

      {/* Recommendations */}
      {data.recommendations.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-500 uppercase">Recommendations</span>
          {data.recommendations.map((rec, i) => (
            <p key={i} className={`mt-1 leading-relaxed ${rec.severity === "warning" ? "text-amber-600" : "text-gray-500"}`}>
              {rec.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function WallSection({ data }: { data: WallMetrics }) {
  const materials = Object.entries(data.by_material);

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Wall Metrics</h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricCard label="Total Length" value={`${data.total_wall_length_m.toFixed(1)} m`} />
        <MetricCard label="Wall/Floor Ratio" value={data.wall_to_floor_ratio.toFixed(2)} />
        <MetricCard label="Exterior" value={`${data.exterior_length_m.toFixed(1)} m (${data.exterior_percent.toFixed(0)}%)`} />
        <MetricCard label="Interior" value={`${data.interior_length_m.toFixed(1)} m`} />
      </div>

      {materials.length > 0 && (
        <div className="mt-2">
          <span className="text-[10px] font-semibold text-gray-500 uppercase">By Material</span>
          {materials.map(([mat, val]) => (
            <div key={mat} className="flex items-center gap-2 mt-1">
              <span className="capitalize text-gray-600">{mat}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gray-400"
                  style={{ width: `${val.percentage}%` }}
                />
              </div>
              <span className="text-gray-500">{val.length_m.toFixed(1)} m</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function RatingBadge({ rating }: { rating: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    excellent: { bg: "bg-green-50", text: "text-green-600" },
    good: { bg: "bg-blue-50", text: "text-blue-600" },
    optimal: { bg: "bg-green-50", text: "text-green-600" },
    adequate: { bg: "bg-blue-50", text: "text-blue-600" },
    fair: { bg: "bg-yellow-50", text: "text-yellow-600" },
    acceptable: { bg: "bg-yellow-50", text: "text-yellow-600" },
    poor: { bg: "bg-red-50", text: "text-red-600" },
    insufficient: { bg: "bg-red-50", text: "text-red-600" },
    excessive: { bg: "bg-yellow-50", text: "text-yellow-600" },
  };
  const c = colors[rating] ?? { bg: "bg-gray-50", text: "text-gray-500" };

  return (
    <span className={`px-1.5 py-0 rounded text-[9px] font-medium ${c.bg} ${c.text}`}>
      {rating}
    </span>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <div className="text-[9px] text-gray-400 uppercase">{label}</div>
      <div className="text-sm font-semibold text-gray-700 mt-0.5">{value}</div>
    </div>
  );
}

// ============================================================
// COMPUTE FUNCTIONS
// ============================================================

function computeAreaMetrics(floor: Floor): AreaMetrics {
  const total = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
  const circulationTypes = ["corridor", "lobby", "foyer", "staircase", "elevator"];
  const carpet = floor.rooms
    .filter((r) => !circulationTypes.includes(r.type))
    .reduce((s, r) => s + r.area_sqm, 0);

  const rooms = floor.rooms
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      area_sqm: r.area_sqm,
      percentage: total > 0 ? (r.area_sqm / total) * 100 : 0,
    }))
    .sort((a, b) => b.area_sqm - a.area_sqm);

  return { total_area_sqm: total, carpet_area_sqm: carpet, rooms, by_zone: {} };
}

function computeProportionMetrics(floor: Floor): ProportionMetrics {
  return {
    rooms: floor.rooms.map((r) => {
      const b = polygonBounds(r.boundary.points);
      const w = b.width / 1000;
      const h = b.height / 1000;
      const ratio = Math.max(w, h) / Math.max(Math.min(w, h), 0.01);
      let rating: "excellent" | "good" | "fair" | "poor" = "poor";
      if (ratio <= 1.3) rating = "excellent";
      else if (ratio <= 1.6) rating = "good";
      else if (ratio <= 2.0) rating = "fair";
      return { id: r.id, name: r.name, width_m: w, depth_m: h, ratio, rating };
    }),
  };
}

function computeCirculationMetrics(floor: Floor): CirculationMetrics {
  const circulationTypes = ["corridor", "lobby", "foyer", "staircase", "elevator"];
  const corridors = floor.rooms.filter((r) => circulationTypes.includes(r.type));
  const totalFloor = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
  const totalCirc = corridors.reduce((s, r) => s + r.area_sqm, 0);
  const percentage = totalFloor > 0 ? (totalCirc / totalFloor) * 100 : 0;

  let rating: CirculationMetrics["rating"] = "optimal";
  if (percentage < 10) rating = "insufficient";
  else if (percentage > 25) rating = "excessive";
  else if (percentage > 20) rating = "acceptable";

  return {
    total_circulation_sqm: totalCirc,
    total_floor_sqm: totalFloor,
    percentage,
    rating,
    corridors: corridors.map((c) => {
      const b = polygonBounds(c.boundary.points);
      return {
        id: c.id,
        name: c.name,
        width_m: Math.min(b.width, b.height) / 1000,
        length_m: Math.max(b.width, b.height) / 1000,
        area_sqm: c.area_sqm,
      };
    }),
  };
}

function computeOpeningMetrics(floor: Floor): OpeningMetrics {
  return {
    rooms: floor.rooms
      .filter((r) => !["corridor", "lobby", "staircase", "elevator"].includes(r.type))
      .map((r) => {
        const wallIds = new Set(r.wall_ids);
        const windows = floor.windows.filter((w) => wallIds.has(w.wall_id));
        const doors = floor.doors.filter((d) => wallIds.has(d.wall_id));
        const winArea = windows.reduce((s, w) => s + (w.width_mm * w.height_mm) / 1_000_000, 0);
        const ratio = r.area_sqm > 0 ? winArea / r.area_sqm : 0;

        let rating: "excellent" | "adequate" | "insufficient" = "insufficient";
        if (ratio >= 0.15) rating = "excellent";
        else if (ratio >= 0.10) rating = "adequate";

        return {
          id: r.id,
          name: r.name,
          window_area_sqm: winArea,
          floor_area_sqm: r.area_sqm,
          ratio,
          doors_count: doors.length,
          windows_count: windows.length,
          rating,
        };
      }),
  };
}

function computeWallMetrics(floor: Floor): WallMetrics {
  let totalLen = 0;
  let extLen = 0;
  let intLen = 0;
  const byMaterial: Record<string, number> = {};

  for (const wall of floor.walls) {
    const len = wallLength(wall);
    totalLen += len;
    if (wall.type === "exterior") extLen += len;
    else intLen += len;

    const mat = wall.material || "unknown";
    byMaterial[mat] = (byMaterial[mat] ?? 0) + len;
  }

  const totalM = totalLen / 1000;
  const floorArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);

  return {
    total_wall_length_m: totalM,
    exterior_length_m: extLen / 1000,
    interior_length_m: intLen / 1000,
    exterior_percent: totalLen > 0 ? (extLen / totalLen) * 100 : 0,
    wall_to_floor_ratio: floorArea > 0 ? totalM / floorArea : 0,
    by_material: Object.fromEntries(
      Object.entries(byMaterial).map(([mat, len]) => [
        mat,
        {
          length_m: len / 1000,
          percentage: totalLen > 0 ? (len / totalLen) * 100 : 0,
        },
      ])
    ),
  };
}
