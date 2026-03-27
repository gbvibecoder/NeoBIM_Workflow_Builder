"use client";

import React from "react";

interface GenerationLoaderProps {
  step: string;
  progress: number; // 0-100
  prompt?: string;
}

const GENERATION_STEPS = [
  { key: "analyzing", label: "Analyzing requirements", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { key: "generating", label: "Generating layout", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
  { key: "placing_walls", label: "Placing walls & partitions", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" },
  { key: "adding_rooms", label: "Defining room boundaries", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { key: "doors_windows", label: "Adding doors & windows", icon: "M8 7h4m-2-2v4M3 12h18M12 3v18" },
  { key: "vastu_check", label: "Checking Vastu compliance", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "finalizing", label: "Finalizing floor plan", icon: "M5 13l4 4L19 7" },
  { key: "complete", label: "Floor plan ready!", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export function GenerationLoader({ step, progress, prompt }: GenerationLoaderProps) {
  const rawIdx = GENERATION_STEPS.findIndex((s) => s.key === step);
  const currentIdx = rawIdx >= 0 ? rawIdx : 0;

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-50 via-white to-blue-50/30">
      <div className="w-full max-w-md px-6 text-center">
        {/* Animated floor plan icon */}
        <div className="mx-auto mb-6 relative h-20 w-20">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 opacity-20 animate-pulse" />
          <div className="absolute inset-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="animate-[spin_3s_linear_infinite]">
              <path d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="mb-1 text-lg font-bold text-gray-900">Generating Floor Plan</h2>
        {prompt && (
          <p className="mb-6 text-xs text-gray-500 truncate max-w-sm mx-auto">
            &ldquo;{prompt}&rdquo;
          </p>
        )}

        {/* Progress bar */}
        <div className="mb-6 rounded-full bg-gray-100 h-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(progress, 5)}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-2 text-left">
          {GENERATION_STEPS.map((s, idx) => {
            const isActive = s.key === step;
            const isDone = idx < currentIdx;
            const isPending = idx > currentIdx;

            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all ${
                  isActive ? "bg-blue-50 border border-blue-100" : ""
                } ${isDone ? "opacity-60" : ""} ${isPending ? "opacity-30" : ""}`}
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  isDone ? "bg-green-100 text-green-600" :
                  isActive ? "bg-blue-100 text-blue-600" :
                  "bg-gray-100 text-gray-400"
                }`}>
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : isActive ? (
                    <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <span className={`text-xs font-medium ${
                  isDone ? "text-green-700" :
                  isActive ? "text-blue-700" :
                  "text-gray-400"
                }`}>
                  {s.label}
                </span>
                {isActive && (
                  <div className="ml-auto flex gap-0.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
