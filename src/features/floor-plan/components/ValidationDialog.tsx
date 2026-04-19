"use client";

import React, { useState } from "react";

// ── Types (match the API response) ───────────────────────────────────────────

interface ValidatedRoom {
  name: string;
  type: string;
  requested_sqft: number | null;
  adjusted_sqft: number;
  width_ft: number;
  depth_ft: number;
  source: "user" | "inferred" | "added";
  adjustment_reason: string | null;
}

interface ValidationIssue {
  type: string;
  message: string;
  severity: "error" | "warning" | "info";
}

interface OptionalRoom {
  name: string;
  type: string;
  default_sqft: number;
  default_width: number;
  default_depth: number;
  description: string;
  checked_by_default: boolean;
}

export interface ValidationResult {
  understood: {
    plot: { width_ft: number; depth_ft: number; total_sqft: number; facing: string | null; plot_source: string };
    rooms: ValidatedRoom[];
    total_requested_sqft: number;
  };
  issues: ValidationIssue[];
  adjustments: Array<{
    room_name: string;
    original_sqft: number | null;
    adjusted_sqft: number;
    reason: string;
    type: "shrunk" | "expanded" | "added" | "unchanged";
    user_can_undo: boolean;
  }>;
  optional_rooms: OptionalRoom[];
  adjusted_program: {
    rooms: ValidatedRoom[];
    total_sqft: number;
    fits_plot: boolean;
    hallway_sqft: number;
    wall_overhead_sqft: number;
  };
}

interface ValidationDialogProps {
  result: ValidationResult;
  onGenerate: (adjustedRooms: ValidatedRoom[], optionalAdded: OptionalRoom[]) => void;
  onEditPrompt: () => void;
  onSkip: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ValidationDialog({ result, onGenerate, onEditPrompt, onSkip }: ValidationDialogProps) {
  const [rooms, setRooms] = useState<ValidatedRoom[]>([...result.adjusted_program.rooms]);
  const [optionalChecked, setOptionalChecked] = useState<Set<string>>(
    new Set(result.optional_rooms.filter(r => r.checked_by_default).map(r => r.name)),
  );
  const [removedRooms, setRemovedRooms] = useState<Set<string>>(new Set());

  const plotArea = result.understood.plot.total_sqft;
  const activeRooms = rooms.filter(r => !removedRooms.has(r.name));
  const totalRoomArea = activeRooms.reduce((s, r) => s + r.adjusted_sqft, 0);
  const optionalArea = result.optional_rooms
    .filter(r => optionalChecked.has(r.name))
    .reduce((s, r) => s + r.default_sqft, 0);
  const grandTotal = totalRoomArea + optionalArea;
  const usagePct = Math.round((grandTotal / (plotArea * 0.85)) * 100);

  const handleRemove = (name: string) => {
    setRemovedRooms(prev => new Set([...prev, name]));
  };

  const handleRestore = (name: string) => {
    setRemovedRooms(prev => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const toggleOptional = (name: string) => {
    setOptionalChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleGenerate = () => {
    const finalRooms = activeRooms;
    const addedOptional = result.optional_rooms.filter(r => optionalChecked.has(r.name));
    onGenerate(finalRooms, addedOptional);
  };

  const issuesBySeverity = {
    error: result.issues.filter(i => i.severity === "error"),
    warning: result.issues.filter(i => i.severity === "warning"),
    info: result.issues.filter(i => i.severity === "info"),
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl border border-gray-100">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-6 py-4 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Review your floor plan</h2>
              <p className="text-[11px] text-gray-400">We parsed your description. Review before generating.</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Plot info */}
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Plot</span>
              {result.understood.plot.plot_source === "inferred" && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">Inferred</span>
              )}
            </div>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="text-lg font-bold text-gray-800">
                {result.understood.plot.width_ft} x {result.understood.plot.depth_ft} ft
              </span>
              <span className="text-xs text-gray-400">
                {plotArea} sqft
                {result.understood.plot.facing && ` | ${result.understood.plot.facing}-facing`}
              </span>
            </div>
          </div>

          {/* Issues */}
          {result.issues.length > 0 && (
            <div className="space-y-2">
              {issuesBySeverity.error.map((issue, i) => (
                <div key={i} className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <span className="font-semibold">Error: </span>{issue.message}
                </div>
              ))}
              {issuesBySeverity.warning.map((issue, i) => (
                <div key={i} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <span className="font-semibold">Note: </span>{issue.message}
                </div>
              ))}
              {issuesBySeverity.info.map((issue, i) => (
                <div key={i} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-600">
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          {/* Room table */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Rooms ({activeRooms.length})
              </span>
              <span className="text-[11px] text-gray-400">
                {Math.round(grandTotal)} / {plotArea} sqft ({usagePct}%)
              </span>
            </div>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100">
              {rooms.map((room) => {
                const isRemoved = removedRooms.has(room.name);
                const adj = result.adjustments.find(a => a.room_name === room.name);
                return (
                  <div
                    key={room.name}
                    className={`flex items-center gap-3 px-3 py-2 transition-opacity ${isRemoved ? "opacity-30" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-gray-700 truncate">{room.name}</span>
                        {room.source === "added" && (
                          <span className="rounded bg-green-50 px-1.5 py-0.5 text-[9px] font-semibold text-green-600">ADDED</span>
                        )}
                        {room.source === "inferred" && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400">default size</span>
                        )}
                      </div>
                      {adj && adj.type === "shrunk" && (
                        <p className="text-[10px] text-amber-500 mt-0.5">{adj.reason}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {room.requested_sqft && room.requested_sqft !== room.adjusted_sqft ? (
                        <div>
                          <span className="text-[10px] text-gray-300 line-through mr-1">{room.requested_sqft}</span>
                          <span className="text-xs font-semibold text-gray-700">{room.adjusted_sqft} sqft</span>
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-gray-600">{room.adjusted_sqft} sqft</span>
                      )}
                    </div>
                    {room.source === "added" && !isRemoved && (
                      <button
                        onClick={() => handleRemove(room.name)}
                        className="shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round"/>
                        </svg>
                      </button>
                    )}
                    {isRemoved && (
                      <button
                        onClick={() => handleRestore(room.name)}
                        className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-blue-500 hover:bg-blue-50 transition-colors"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Optional rooms */}
          {result.optional_rooms.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Add optional rooms
              </span>
              <div className="mt-2 space-y-1.5">
                {result.optional_rooms.map(opt => (
                  <label
                    key={opt.name}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={optionalChecked.has(opt.name)}
                      onChange={() => toggleOptional(opt.name)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-200"
                    />
                    <div className="flex-1">
                      <span className="text-xs font-medium text-gray-700">{opt.name}</span>
                      <span className="ml-1.5 text-[10px] text-gray-400">{opt.description}</span>
                    </div>
                    <span className="text-[11px] text-gray-400">{opt.default_sqft} sqft</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-gray-100 bg-white px-6 py-4 rounded-b-2xl">
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={issuesBySeverity.error.length > 0}
              className="flex-1 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400"
            >
              Generate Floor Plan
            </button>
            <button
              onClick={onEditPrompt}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50"
            >
              Edit Prompt
            </button>
          </div>
          <button
            onClick={onSkip}
            className="mt-2 w-full text-center text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip review, generate directly
          </button>
        </div>
      </div>
    </div>
  );
}
