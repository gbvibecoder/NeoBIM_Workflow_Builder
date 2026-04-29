/**
 * BriefRenderShell — top-level state-machine router for the
 * Brief-to-Renders dashboard page.
 *
 * Owns:
 *   • The active jobId (synced to `?jobId=` so refresh + share work).
 *   • The polling subscription via `useBriefRenderJob`.
 *   • Composition of the status-aware sections:
 *       no jobId           → BriefUploader
 *       AWAITING_APPROVAL  → SpecReviewGate
 *       any other status   → JobStatusBanner + ShotGrid (when shots exist)
 *                            + PdfDownloadButton (when COMPLETED + pdfUrl)
 *                            + JobErrorBanner   (when FAILED)
 *                            + JobCancelledBanner (when CANCELLED)
 *
 * The shell is fully client-side; the parent page server component is
 * responsible for canary-gating before the shell ever mounts.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { BriefUploader } from "@/features/brief-renders/components/BriefUploader";
import { CancelJobButton } from "@/features/brief-renders/components/CancelJobButton";
import { DetailedLogsSection } from "@/features/brief-renders/components/DetailedLogsSection";
import { JobCancelledBanner } from "@/features/brief-renders/components/JobCancelledBanner";
import { JobErrorBanner } from "@/features/brief-renders/components/JobErrorBanner";
import { JobLogsPanel } from "@/features/brief-renders/components/JobLogsPanel";
import { JobStatusBanner } from "@/features/brief-renders/components/JobStatusBanner";
import { PdfDownloadButton } from "@/features/brief-renders/components/PdfDownloadButton";
import { RecentJobsDrawer } from "@/features/brief-renders/components/RecentJobsDrawer";
import { ShotGrid } from "@/features/brief-renders/components/ShotGrid";
import { SpecReviewGate } from "@/features/brief-renders/components/SpecReviewGate";
import { useBriefRenderJob } from "@/features/brief-renders/hooks/useBriefRenderJob";
import { resetBriefRenderUploadIdempotencyKey } from "@/features/brief-renders/hooks/useBriefRenderUpload";
import { isPlatformAdmin } from "@/lib/platform-admin";
import type {
  BriefSpec,
  ShotResult,
} from "@/features/brief-renders/services/brief-pipeline/types";

const QUERY_KEY = "jobId";

function readJobIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get(QUERY_KEY);
  return id && id.trim().length > 0 ? id.trim() : null;
}

function writeJobIdToUrl(id: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set(QUERY_KEY, id);
  } else {
    url.searchParams.delete(QUERY_KEY);
  }
  window.history.replaceState(null, "", url.toString());
}

export function BriefRenderShell() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [recentlyRegen, setRecentlyRegen] = useState(false);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const detailedLogsRef = useRef<HTMLElement | null>(null);
  const { data: session } = useSession();
  // Admin-only debug surface. Permissive: either env-based platform-admin
  // allowlist or a privileged DB role unlocks the JobLogsPanel. Beta
  // testers can use whichever mechanism is easier to set up.
  const sessionUser = session?.user as { role?: string } | undefined;
  const isAdmin =
    isPlatformAdmin(session?.user?.email) ||
    sessionUser?.role === "PLATFORM_ADMIN" ||
    sessionUser?.role === "TEAM_ADMIN";

  const handleViewLogs = useCallback(() => {
    setShowDetailedLogs(true);
    // Defer scroll to next tick so the DetailedLogsSection has a chance
    // to render and attach the ref before we measure its position.
    requestAnimationFrame(() => {
      detailedLogsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  // Hydrate jobId from URL on mount so refresh + share work.
  useEffect(() => {
    const fromUrl = readJobIdFromUrl();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL hydration
    if (fromUrl) setJobId(fromUrl);
  }, []);

  const { job, status, isLoading, error: pollError } = useBriefRenderJob({
    jobId,
    enabled: jobId !== null,
  });

  // When a regen lands successfully on the server, we briefly suppress
  // the PDF download button until the shot transitions back to success.
  // Listening to job.status flips back to RUNNING is the natural signal.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirroring polled status into a transient UI flag
    if (status === "RUNNING") setRecentlyRegen(true);
    if (status === "COMPLETED") setRecentlyRegen(false);
  }, [status]);

  const handleJobCreated = useCallback((newJobId: string) => {
    setJobId(newJobId);
    writeJobIdToUrl(newJobId);
  }, []);

  const handleStartOver = useCallback(() => {
    // Clear the localStorage idempotency key so the next upload mints
    // a fresh `requestId` on the server — without this, the
    // create-job route's idempotency cache would replay the previous
    // (terminal-failure) row even though the user has explicitly
    // chosen to start over.
    resetBriefRenderUploadIdempotencyKey();
    setJobId(null);
    writeJobIdToUrl(null);
  }, []);

  const handleSelectJob = useCallback((selected: string) => {
    setJobId(selected);
    writeJobIdToUrl(selected);
  }, []);

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-100">
            Brief → Renders
          </h1>
          <p className="text-sm text-zinc-400">
            Upload an architectural brief; review the spec we extract; approve
            to render twelve photoreal interior shots and the editorial PDF.
            <span className="ml-2 px-2 py-0.5 text-[10px] uppercase tracking-wider bg-amber-900/40 text-amber-300 rounded">
              Beta
            </span>
          </p>
        </div>
        {isAdmin && jobId && job && (
          <button
            type="button"
            onClick={handleViewLogs}
            data-testid="view-logs-button"
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded border border-cyan-700/40 bg-cyan-950/30 hover:bg-cyan-900/40 text-xs font-medium text-cyan-300"
          >
            <span aria-hidden>📋</span>
            View Logs
          </button>
        )}
      </header>

      <RecentJobsDrawer activeJobId={jobId} onSelect={handleSelectJob} />

      {!jobId && <BriefUploader onJobCreated={handleJobCreated} />}

      {jobId && pollError && !job && (
        <div
          role="alert"
          className="bg-red-950 border border-red-700 text-red-100 px-4 py-3 rounded text-sm"
        >
          Failed to load job: {pollError}
        </div>
      )}

      {jobId && isLoading && !job && (
        <div className="text-sm text-zinc-400" role="status" aria-live="polite">
          Loading job…
        </div>
      )}

      {jobId && job && (
        <>
          {/* ─── Status pill ──────────────────────────────────────────
              Always at top so users (admin + non-admin) can read job
              state without scrolling. Compact — doesn't compete with
              the primary content below. */}
          <JobStatusBanner job={job} />

          {/* ─── Cancel button (TOP-of-content, prominent) ──────────
              Sits right under the status pill so users can abort
              from any non-terminal state without scrolling past 12
              tiles. Styled as a red destructive button per the
              user's "looks like a button" feedback. Hidden on
              terminal states — there's nothing to cancel. */}
          {(status === "QUEUED" ||
            status === "RUNNING" ||
            status === "AWAITING_APPROVAL") && (
            <CancelJobButton jobId={jobId} />
          )}

          {/* ─── PRIMARY content ──────────────────────────────────────
              `AWAITING_APPROVAL` → SpecReviewGate (the user's action
              surface — they MUST review before approving, no images
              exist yet).
              Everything else → ShotGrid (the 12 image tiles, where
              the visual progress lives). */}
          {status === "AWAITING_APPROVAL" && <SpecReviewGate jobId={jobId} />}

          {status !== "AWAITING_APPROVAL" && job.specResult && job.shots && (
            <ShotGrid
              jobId={jobId}
              spec={job.specResult as BriefSpec}
              shots={job.shots as ShotResult[]}
              busy={status === "FAILED" || status === "CANCELLED"}
              onAnyRegen={() => setRecentlyRegen(true)}
            />
          )}

          {/* ─── Terminal-state CTAs / banners ───────────────────────
              Sit immediately after the primary content so the user's
              eye reaches them naturally after scanning the grid /
              spec. Pre-Phase-6.x had these mixed in with the admin
              panel which buried the Approve / Download buttons. */}
          {status === "COMPLETED" && (
            <div className="flex items-center gap-3">
              <PdfDownloadButton
                pdfUrl={job.pdfUrl}
                disabled={recentlyRegen}
              />
              <button
                type="button"
                onClick={handleStartOver}
                className="text-sm text-zinc-400 hover:text-zinc-200"
              >
                Start a new brief
              </button>
            </div>
          )}

          {status === "FAILED" && (
            <JobErrorBanner job={job} onDismiss={handleStartOver} />
          )}
          {status === "CANCELLED" && (
            <JobCancelledBanner job={job} onDismiss={handleStartOver} />
          )}

          {/* ─── Pipeline · Admin (mid-page) ─────────────────────────
              Compact admin debug strip. Sits BELOW the primary content
              so users / admins focus on the renders first, then drop
              into pipeline detail if they need to. Renders null for
              non-admins (so non-admin layout collapses to just the
              primary content + CTA). */}
          <JobLogsPanel job={job} visible={isAdmin} />

          {/* ─── Detailed logs (always last, admin-only) ─────────────
              Hidden until the user clicks "View Logs" in the page
              header (which smooth-scrolls here). Comprehensive
              snapshot of every piece of state — full prompts, raw
              stageLog JSON, per-shot lifecycle, cost breakdown.
              Renders null when `visible=false`. */}
          <DetailedLogsSection
            ref={detailedLogsRef}
            job={job}
            visible={isAdmin && showDetailedLogs}
            onClose={() => setShowDetailedLogs(false)}
          />
        </>
      )}
    </div>
  );
}
