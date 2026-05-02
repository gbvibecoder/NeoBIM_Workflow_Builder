/**
 * JobCancelledBanner — terminal cancellation state.
 *
 * Renders only when `status === "CANCELLED"`. Cleaner UI than
 * JobErrorBanner because cancellation is user-initiated, not a fault.
 */

"use client";

import s from "@/app/dashboard/brief-renders/page.module.css";
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
      className={s.cancelledBanner}
      data-testid="job-cancelled-banner"
    >
      <div className={s.cancelledBannerTitle}>Job cancelled</div>
      <div className={s.cancelledBannerMsg}>
        You cancelled this job. Any partially generated images stay on file
        for 30 days, but no new work will run on it.
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={s.cancelledBannerLink}
      >
        Start a new brief
      </button>
    </div>
  );
}
