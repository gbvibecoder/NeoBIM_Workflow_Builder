"use client";

import React, { useMemo } from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import { analyzeVastuCompliance, type VastuReport, type VastuReportItem } from "@/features/floor-plan/lib/vastu-analyzer";
import { suggestRoomSwaps, type SwapSuggestion } from "@/features/floor-plan/lib/room-optimizer";
import { DIRECTION_LABELS } from "@/features/floor-plan/lib/vastu-rules";

export function VastuPanel() {
  const floor = useFloorPlanStore((s) => s.getActiveFloor());
  const setSelectedIds = useFloorPlanStore((s) => s.setSelectedIds);
  const vastuOverlayVisible = useFloorPlanStore((s) => s.vastuOverlayVisible);
  const toggleVastuOverlay = useFloorPlanStore((s) => s.toggleVastuOverlay);
  const northAngle = useFloorPlanStore((s) => s.project?.settings.north_angle_deg ?? 0);

  const applySwapSuggestion = useFloorPlanStore((s) => s.applySwapSuggestion);

  const report = useMemo<VastuReport | null>(() => {
    if (!floor) return null;
    return analyzeVastuCompliance(floor, northAngle);
  }, [floor, northAngle]);

  const swapSuggestions = useMemo<SwapSuggestion[]>(() => {
    if (!floor) return [];
    return suggestRoomSwaps(floor, northAngle, 3);
  }, [floor, northAngle]);

  if (!report) {
    return (
      <div className="p-4 text-sm text-gray-400">
        No floor plan loaded.
      </div>
    );
  }

  const handleClickRoom = (roomId: string | null) => {
    if (roomId) setSelectedIds([roomId]);
  };

  return (
    <div className="flex flex-col text-xs">
      {/* Score Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Vastu Compliance</h3>
          <button
            onClick={toggleVastuOverlay}
            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              vastuOverlayVisible
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {vastuOverlayVisible ? "Hide Overlay" : "Show Overlay"}
          </button>
        </div>

        {/* Score ring */}
        <div className="flex items-center gap-4">
          <ScoreRing score={report.score} grade={report.grade} />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <StatusDot color="#22c55e" />
              <span className="text-gray-600">Pass: {report.passes}</span>
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              <StatusDot color="#eab308" />
              <span className="text-gray-600">Acceptable: {report.acceptable}</span>
            </div>
            {report.advisories > 0 && (
              <div className="flex items-center gap-1.5 mb-1">
                <StatusDot color="#8b5cf6" />
                <span className="text-gray-600">Advisory: {report.advisories}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <StatusDot color="#ef4444" />
              <span className="text-gray-600">Violations: {report.violations}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-400px)]">
        {/* Violations first */}
        {report.items.filter((i) => i.status === "violation").length > 0 && (
          <Section title="Violations" count={report.violations} color="#ef4444">
            {report.items
              .filter((i) => i.status === "violation")
              .map((item) => (
                <VastuItem
                  key={item.rule_id + item.room_id}
                  item={item}
                  onClick={() => handleClickRoom(item.room_id)}
                />
              ))}
          </Section>
        )}

        {/* Acceptable */}
        {report.acceptable > 0 && (
          <Section title="Acceptable" count={report.acceptable} color="#eab308">
            {report.items
              .filter((i) => i.status === "acceptable")
              .map((item) => (
                <VastuItem
                  key={item.rule_id + item.room_id}
                  item={item}
                  onClick={() => handleClickRoom(item.room_id)}
                />
              ))}
          </Section>
        )}

        {/* Advisory */}
        {report.advisories > 0 && (
          <Section title="Advisory" count={report.advisories} color="#8b5cf6">
            {report.items
              .filter((i) => i.status === "advisory")
              .map((item) => (
                <VastuItem
                  key={item.rule_id + item.room_id}
                  item={item}
                  onClick={() => handleClickRoom(item.room_id)}
                />
              ))}
          </Section>
        )}

        {/* Passes */}
        {report.passes > 0 && (
          <Section title="Passing" count={report.passes} color="#22c55e">
            {report.items
              .filter((i) => i.status === "pass")
              .map((item) => (
                <VastuItem
                  key={item.rule_id + item.room_id}
                  item={item}
                  onClick={() => handleClickRoom(item.room_id)}
                />
              ))}
          </Section>
        )}
      </div>

      {/* Swap Suggestions with Apply buttons */}
      {swapSuggestions.length > 0 && (
        <div className="border-t border-gray-200 p-3">
          <h4 className="text-[10px] font-semibold text-violet-500 uppercase mb-2">AI Swap Suggestions</h4>
          {swapSuggestions.map((suggestion) => (
            <div key={suggestion.id} className="mb-2 rounded border border-gray-100 p-2 bg-white">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-semibold ${
                  suggestion.priority === "high" ? "text-green-600" :
                  suggestion.priority === "medium" ? "text-amber-600" : "text-gray-500"
                }`}>
                  +{suggestion.improvement} pts
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                  suggestion.priority === "high" ? "bg-green-50 text-green-700" :
                  suggestion.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"
                }`}>
                  {suggestion.priority}
                </span>
              </div>
              <p className="text-gray-600 text-[11px] mb-1.5">
                Swap <strong>{suggestion.room_a_name}</strong> with <strong>{suggestion.room_b_name}</strong>
              </p>
              <p className="text-gray-400 text-[10px] mb-2">{suggestion.reason}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedIds([suggestion.room_a_id, suggestion.room_b_id]);
                  }}
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Preview
                </button>
                <button
                  onClick={() => {
                    applySwapSuggestion(suggestion.room_a_id, suggestion.room_b_id);
                  }}
                  className="flex-1 rounded bg-violet-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-violet-700 transition-colors"
                >
                  Apply Swap
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* General Suggestions */}
      {report.suggestions.length > 0 && (
        <div className="border-t border-gray-200 p-3">
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Remedies</h4>
          {report.suggestions.map((s, i) => (
            <p key={i} className="text-gray-600 mb-1 leading-relaxed">{s}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";

  return (
    <div className="relative w-16 h-16">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#f1f5f9" strokeWidth="4" />
        <circle
          cx="32" cy="32" r="28"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] font-semibold text-gray-400">{grade}</span>
      </div>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />;
}

function Section({
  title,
  count,
  color,
  children,
}: {
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-100">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-semibold text-gray-500 uppercase">{title}</span>
        <span className="text-[10px] text-gray-400">({count})</span>
      </div>
      {children}
    </div>
  );
}

function VastuItem({ item, onClick }: { item: VastuReportItem; onClick: () => void }) {
  const statusColor =
    item.status === "violation" ? "#ef4444" : item.status === "acceptable" ? "#eab308" : item.status === "advisory" ? "#8b5cf6" : "#22c55e";

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50"
    >
      <div className="flex items-start gap-2">
        <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: statusColor }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-gray-700 truncate">{item.room_name ?? "General"}</span>
            <span className="text-gray-300">—</span>
            <span className="text-gray-400">{DIRECTION_LABELS[item.actual_direction]}</span>
          </div>
          <p className="text-gray-500 mt-0.5 leading-relaxed">{item.message}</p>
          {item.remedy && item.status !== "pass" && (
            <p className="text-gray-400 mt-0.5 italic">{item.remedy}</p>
          )}
        </div>
      </div>
    </button>
  );
}
