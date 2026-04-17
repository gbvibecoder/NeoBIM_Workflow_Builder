"use client";

/**
 * GenerationLoader — Phase 1 honest indeterminate progress.
 *
 * Replaces the previous 8-step theatrical UI that fired fake stage labels on
 * fixed setTimeout delays. The backend is currently one HTTP POST, so we show
 * a single honest "working" state with an indeterminate progress bar. Real
 * per-stage progress will come back when the multi-agent pipeline ships
 * (Phase 3) and can drive milestones via SSE.
 */
import React from "react";

interface GenerationLoaderProps {
  /** Reserved for future per-stage drive (e.g. SSE milestones). Phase 1 ignores it. */
  step: string;
  /** Reserved. Phase 1 uses an indeterminate bar instead. */
  progress: number;
  prompt?: string;
}

export function GenerationLoader({ prompt }: GenerationLoaderProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-50 via-white to-blue-50/30">
      <div className="w-full max-w-md px-6 text-center">
        {/* Animated floor-plan icon */}
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

        <h2 className="mb-1 text-lg font-bold text-gray-900">Generating your floor plan…</h2>
        {prompt && (
          <p className="mb-6 text-xs text-gray-500 truncate max-w-sm mx-auto">
            &ldquo;{prompt}&rdquo;
          </p>
        )}

        {/* Indeterminate progress bar — visible motion, no fake percentage. */}
        <div className="mx-auto mb-4 w-full max-w-xs overflow-hidden rounded-full bg-gray-100 h-1.5">
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-[fp-loader-bar_1.4s_ease-in-out_infinite]" />
        </div>

        <p className="text-[11px] text-gray-500">
          This usually takes 10–30 seconds. We&rsquo;ll show real metrics once the plan is ready.
        </p>
      </div>

      <style jsx global>{`
        @keyframes fp-loader-bar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(150%); }
        }
      `}</style>
    </div>
  );
}
