/**
 * JobStatusBanner — small chrome strip showing status + progress + stage.
 *
 * Renders for every non-terminal status (QUEUED, RUNNING, AWAITING_APPROVAL).
 * Terminal banners are handled by separate components:
 *   • COMPLETED → no banner; the PdfDownloadButton + ShotGrid speak.
 *   • FAILED    → JobErrorBanner.
 *   • CANCELLED → JobCancelledBanner.
 */

"use client";

import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";

const STAGE_LABELS: Record<string, string> = {
  spec_extracting: "Reading your brief…",
  awaiting_approval: "Waiting for your approval",
  rendering: "Generating images",
  awaiting_compile: "Compiling PDF",
  compiling: "Compiling PDF",
  completed: "Done",
};

function stageLabel(stage: string | null): string {
  if (!stage) return "Working";
  return STAGE_LABELS[stage] ?? stage;
}

export function JobStatusBanner({ job }: { job: BriefRenderJobView }) {
  if (
    job.status === "COMPLETED" ||
    job.status === "FAILED" ||
    job.status === "CANCELLED"
  ) {
    return null;
  }

  const pct = Math.max(0, Math.min(100, Math.round(job.progress)));

  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center gap-4"
      role="status"
      aria-live="polite"
      data-testid="job-status-banner"
      data-status={job.status}
    >
      <div className="flex-1 space-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium text-zinc-100">
            {stageLabel(job.currentStage)}
          </span>
          <span className="text-xs text-zinc-500 font-mono">
            {job.status} · {pct}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded">
          <div
            className="h-full rounded bg-cyan-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {job.costUsd > 0 && (
        <div className="text-xs text-zinc-500 font-mono whitespace-nowrap">
          ${job.costUsd.toFixed(3)} so far
        </div>
      )}
    </div>
  );
}
