/**
 * JobErrorBanner — terminal failure state.
 *
 * Renders only when `status === "FAILED"`. Surfaces the server's
 * `errorMessage` verbatim and offers a "Start a new brief" action that
 * clears the parent's selected `jobId`. We don't auto-retry — most
 * failures are spec-extraction issues that need a re-edited brief.
 */

"use client";

import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";

export interface JobErrorBannerProps {
  job: BriefRenderJobView;
  onDismiss: () => void;
}

export function JobErrorBanner({ job, onDismiss }: JobErrorBannerProps) {
  if (job.status !== "FAILED") return null;

  return (
    <div
      role="alert"
      className="bg-red-950 border border-red-700 rounded-lg p-4 space-y-3"
      data-testid="job-error-banner"
    >
      <div>
        <div className="text-sm font-semibold text-red-100">
          Job failed
        </div>
        <div className="text-sm text-red-200 mt-1">
          {job.errorMessage ?? "An unknown error occurred."}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs underline text-red-200 hover:text-white"
      >
        Start a new brief
      </button>
    </div>
  );
}
