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

import s from "@/app/dashboard/brief-renders/page.module.css";
import { BriefUploader } from "@/features/brief-renders/components/BriefUploader";
import { CancelJobButton } from "@/features/brief-renders/components/CancelJobButton";
import { CompleteHero } from "@/features/brief-renders/components/CompleteHero";
import { DetailedLogsSection } from "@/features/brief-renders/components/DetailedLogsSection";
import { JobCancelledBanner } from "@/features/brief-renders/components/JobCancelledBanner";
import { JobErrorBanner } from "@/features/brief-renders/components/JobErrorBanner";
import { JobLogsPanel } from "@/features/brief-renders/components/JobLogsPanel";
import { JobStatusBanner } from "@/features/brief-renders/components/JobStatusBanner";
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

function formatElapsed(ms: number): string {
  if (ms <= 0) return "—";
  const m = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1_000);
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

type HeaderState = "idle" | "running" | "approval" | "generating" | "complete";

export function BriefRenderShell() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [recentlyRegen, setRecentlyRegen] = useState(false);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const detailedLogsRef = useRef<HTMLDivElement | null>(null);
  const { data: session } = useSession();
  const sessionUser = session?.user as { role?: string } | undefined;
  const isAdmin =
    isPlatformAdmin(session?.user?.email) ||
    sessionUser?.role === "PLATFORM_ADMIN" ||
    sessionUser?.role === "TEAM_ADMIN";

  const handleViewLogs = useCallback(() => {
    setShowDetailedLogs(true);
    requestAnimationFrame(() => {
      detailedLogsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  useEffect(() => {
    const fromUrl = readJobIdFromUrl();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL hydration
    if (fromUrl) setJobId(fromUrl);
  }, []);

  const { job, status, isLoading, error: pollError } = useBriefRenderJob({
    jobId,
    enabled: jobId !== null,
  });

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
    resetBriefRenderUploadIdempotencyKey();
    setJobId(null);
    writeJobIdToUrl(null);
  }, []);

  const handleSelectJob = useCallback((selected: string) => {
    setJobId(selected);
    writeJobIdToUrl(selected);
  }, []);

  // Derived state for header
  const headerState: HeaderState = !job
    ? "idle"
    : job.status === "AWAITING_APPROVAL"
      ? "approval"
      : job.status === "COMPLETED"
        ? "complete"
        : job.status === "RUNNING" && job.currentStage === "rendering"
          ? "generating"
          : job.status === "RUNNING" || job.status === "QUEUED"
            ? "running"
            : "idle";

  const shots = Array.isArray(job?.shots) ? (job.shots as ShotResult[]) : [];
  const spec = job?.specResult as BriefSpec | null;
  const totalShots = shots.length || 12;
  const completedShots = shots.filter(
    (sh) => sh.status === "success",
  ).length;

  const elapsed =
    job?.completedAt && job?.startedAt
      ? new Date(job.completedAt).getTime() -
        new Date(job.startedAt).getTime()
      : 0;

  return (
    <>
      {/* In-page beta banner */}
      <div className={s.betaBanner}>
        <div className={s.betaBannerDot} />
        <span>
          <strong>You&apos;re using BuildFlow Beta.</strong> Workflows are
          improving daily. Some outputs are AI-generated estimates — always
          verify before production use.
        </span>
        <div className={s.betaBannerSpacer} />
        <a href="/dashboard/feedback" className={s.betaBannerLink}>
          Give feedback
        </a>
        <a href="/blog" className={s.betaBannerLink}>
          What&apos;s new
        </a>
      </div>

      {/* Page header */}
      <header className={s.pageHead}>
        <div className={s.pageHeadInner}>
          <div className={s.pageHeadLeft}>
            <div className={s.pageEyebrowRow}>
              <div className={s.pageEyebrow} data-state={headerState}>
                <div className={s.pageEyebrowDot} />
                {headerState === "idle" && "Brief → Renders"}
                {headerState === "running" && "Reading your brief"}
                {headerState === "approval" && "Awaiting approval"}
                {headerState === "generating" &&
                  `Generating · ${completedShots} / ${totalShots}`}
                {headerState === "complete" &&
                  `Complete · ${totalShots}/${totalShots} renders`}
              </div>
              <span className={s.pageBetaPill}>Beta</span>
            </div>

            <h1 className={s.pageTitle}>
              {headerState === "idle" && (
                <>
                  From brief to{" "}
                  <em className={s.pageTitleEm}>magazine,</em> in one upload.
                </>
              )}
              {headerState === "running" && (
                <>
                  Reading your <em className={s.pageTitleEm}>brief.</em>
                </>
              )}
              {headerState === "approval" && (
                <>
                  Spec extracted.{" "}
                  <em className={s.pageTitleEm}>Your turn.</em>
                </>
              )}
              {headerState === "generating" && (
                <>
                  Building your{" "}
                  <em className={s.pageTitleEm}>magazine,</em> shot by shot.
                </>
              )}
              {headerState === "complete" && (
                <>
                  {spec?.projectTitle ?? "Your project"}.{" "}
                  <em className={s.pageTitleEm}>Ready to send.</em>
                </>
              )}
            </h1>

            <p className={s.pageLead}>
              {headerState === "idle" &&
                "Drop an architectural brief in PDF or DOCX. We read it, extract the spec, surface every shot for review, and render twelve photoreal interiors plus the editorial PDF."}
              {headerState === "running" &&
                "Extracting spec via Claude Sonnet. This usually takes 1–2 minutes."}
              {headerState === "approval" &&
                "Every field below was extracted directly from your brief. Empty fields mean the source was silent. Approve to begin generating renders."}
              {headerState === "generating" &&
                "~46 seconds per shot. Tab can stay backgrounded — we'll keep rendering."}
              {headerState === "complete" &&
                `${totalShots + 1}-page editorial PDF + ${totalShots} standalone 4K renders. Total: $${job?.costUsd.toFixed(3) ?? "—"} · ${formatElapsed(elapsed)}.`}
            </p>
          </div>

          <div className={s.pageActions}>
            {isAdmin && jobId && job && (
              <button
                type="button"
                onClick={handleViewLogs}
                data-testid="view-logs-button"
                className={s.btnGhost}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                View Logs
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content area */}
      <div
        className={s.section}
        key={`${jobId ?? "idle"}-${job?.status ?? "none"}-${job?.currentStage ?? ""}`}
      >
        {/* ─── No active job ─── */}
        {!jobId && (
          <>
            <BriefUploader onJobCreated={handleJobCreated} />
            <RecentJobsDrawer
              activeJobId={jobId}
              onSelect={handleSelectJob}
            />
          </>
        )}

        {/* ─── Loading / error ─── */}
        {jobId && pollError && !job && (
          <div className={s.errorAlert} role="alert">
            Failed to load job: {pollError}
          </div>
        )}

        {jobId && isLoading && !job && (
          <p style={{ color: "var(--rs-text-mute)", fontSize: 14 }}>
            Loading job…
          </p>
        )}

        {/* ─── Active job ─── */}
        {jobId && job && (
          <>
            {/* Status banner + cancel for spec_extracting / queued */}
            {(status === "QUEUED" ||
              (status === "RUNNING" &&
                job.currentStage === "spec_extracting")) && (
              <>
                <JobStatusBanner job={job} />
                <CancelJobButton jobId={jobId} />
              </>
            )}

            {/* Awaiting approval */}
            {status === "AWAITING_APPROVAL" && (
              <>
                <JobStatusBanner job={job} variant="compact" />
                <SpecReviewGate jobId={jobId} />
              </>
            )}

            {/* Generating images */}
            {status === "RUNNING" && job.currentStage === "rendering" && (
              <>
                <JobStatusBanner job={job} variant="rendering" />
                {spec && (
                  <ShotGrid
                    jobId={jobId}
                    spec={spec}
                    shots={shots}
                    busy={false}
                    onAnyRegen={() => setRecentlyRegen(true)}
                  />
                )}
                <div className={s.cancelRow}>
                  <CancelJobButton jobId={jobId} />
                </div>
              </>
            )}

            {/* Awaiting compile / compiling */}
            {status === "RUNNING" &&
              (job.currentStage === "awaiting_compile" ||
                job.currentStage === "compiling") && (
              <>
                <JobStatusBanner job={job} variant="compiling" />
                {spec && (
                  <ShotGrid
                    jobId={jobId}
                    spec={spec}
                    shots={shots}
                    busy={false}
                  />
                )}
              </>
            )}

            {/* Complete */}
            {status === "COMPLETED" && (
              <>
                <CompleteHero job={job} onStartNew={handleStartOver} />
                {spec && (
                  <ShotGrid
                    jobId={jobId}
                    spec={spec}
                    shots={shots}
                    busy={false}
                    onAnyRegen={() => setRecentlyRegen(true)}
                    regenDisabled={recentlyRegen}
                  />
                )}
              </>
            )}

            {/* Failed */}
            {status === "FAILED" && (
              <>
                {spec && (
                  <ShotGrid
                    jobId={jobId}
                    spec={spec}
                    shots={shots}
                    busy={true}
                  />
                )}
                <JobErrorBanner job={job} onDismiss={handleStartOver} />
              </>
            )}

            {/* Cancelled */}
            {status === "CANCELLED" && (
              <>
                {spec && (
                  <ShotGrid
                    jobId={jobId}
                    spec={spec}
                    shots={shots}
                    busy={true}
                  />
                )}
                <JobCancelledBanner job={job} onDismiss={handleStartOver} />
              </>
            )}

            {/* Admin panels — diagnostics dock */}
            {isAdmin && (
              <div className={s.diagDock}>
                <button
                  type="button"
                  onClick={() => setShowDetailedLogs((v) => !v)}
                  className={s.diagHead}
                >
                  <div className={s.diagHeadLabel}>
                    <div
                      className={s.diagHeadDot}
                      data-status={
                        job.status === "RUNNING"
                          ? undefined
                          : job.status === "COMPLETED"
                            ? "complete"
                            : "idle"
                      }
                    />
                    Pipeline · Admin
                  </div>
                  <span className={s.diagHeadCollapse}>
                    {showDetailedLogs ? "▼ Collapse" : "▸ Expand"}
                  </span>
                </button>
                {showDetailedLogs && (
                  <div className={s.diagContent} ref={detailedLogsRef}>
                    <JobLogsPanel job={job} visible={true} />
                    <DetailedLogsSection
                      job={job}
                      visible={true}
                      onClose={() => setShowDetailedLogs(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
