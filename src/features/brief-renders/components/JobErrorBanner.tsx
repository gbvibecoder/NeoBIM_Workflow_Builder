/**
 * JobErrorBanner — terminal failure state.
 *
 * Renders only when `status === "FAILED"`. Surfaces the server's
 * `errorMessage` verbatim and offers a "Start a new brief" action.
 */

"use client";

import s from "@/app/dashboard/brief-renders/page.module.css";
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
      className={s.errorBanner}
      data-testid="job-error-banner"
    >
      <div className={s.errorBannerTitle}>Job failed</div>
      <div className={s.errorBannerMsg}>
        {job.errorMessage ?? "An unknown error occurred."}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={s.errorBannerLink}
      >
        Start a new brief
      </button>
    </div>
  );
}
