/**
 * JobCancelledBanner — terminal cancellation state.
 *
 * Renders only when `status === "CANCELLED"`. Cleaner UI than
 * JobErrorBanner because cancellation is user-initiated, not a fault.
 */

"use client";

import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";

export interface JobCancelledBannerProps {
  job: BriefRenderJobView;
  onDismiss: () => void;
}

export function JobCancelledBanner({ job, onDismiss }: JobCancelledBannerProps) {
  if (job.status !== "CANCELLED") return null;

  return (
    <div
      role="status"
      className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 space-y-3"
      data-testid="job-cancelled-banner"
    >
      <div className="text-sm text-zinc-100 font-semibold">Job cancelled</div>
      <div className="text-sm text-zinc-400">
        You cancelled this job. Any partially generated images stay on file
        for 30 days, but no new work will run on it.
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs underline text-zinc-300 hover:text-white"
      >
        Start a new brief
      </button>
    </div>
  );
}
