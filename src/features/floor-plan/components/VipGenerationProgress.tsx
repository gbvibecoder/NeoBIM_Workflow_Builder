"use client";

/**
 * VIP Generation Progress Overlay
 *
 * Shows during VIP background job execution:
 * - Progress bar (0-100%)
 * - Current stage label
 * - Elapsed time
 * - Cancel button (stops polling, not backend)
 */

import { useEffect, useState } from "react";
import type { VipGenerationStatus } from "../hooks/useVipGeneration";

interface VipGenerationProgressProps {
  status: VipGenerationStatus;
  progress: number;
  stageLabel: string;
  costUsd: number;
  errorMessage: string | null;
  onCancel: () => void;
  onRetry?: () => void;
}

export function VipGenerationProgress({
  status,
  progress,
  stageLabel,
  costUsd,
  errorMessage,
  onCancel,
  onRetry,
}: VipGenerationProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== "creating" && status !== "polling") {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (status === "idle" || status === "completed") return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        {status === "failed" ? (
          <>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20">
                <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">Generation Failed</h3>
            </div>
            <p className="mb-4 text-sm text-zinc-400">
              {errorMessage ?? "Something went wrong. Please try again."}
            </p>
            <div className="flex gap-2">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="flex-1 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
                >
                  Try Again
                </button>
              )}
              <button
                onClick={onCancel}
                className="flex-1 rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Generating Floor Plan
              </h3>
              <span className="text-sm text-zinc-500">{formatTime(elapsed)}</span>
            </div>

            {/* Progress bar */}
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-700"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>

            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-zinc-400">{stageLabel || "Starting..."}</p>
              <span className="text-sm font-mono text-zinc-500">{progress}%</span>
            </div>

            {costUsd > 0 && (
              <p className="mb-4 text-xs text-zinc-600">
                Cost: ${costUsd.toFixed(3)}
              </p>
            )}

            <button
              onClick={onCancel}
              className="w-full rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>

            <p className="mt-3 text-center text-xs text-zinc-600">
              AI is designing your floor plan. This typically takes 60-90 seconds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
