/**
 * JobStatusBanner — stage progress visualization.
 *
 * Renders for every non-terminal status (QUEUED, RUNNING, AWAITING_APPROVAL).
 * Terminal banners are handled by separate components.
 *
 * Variants:
 *   - default:   Full stage flow (4 pills + arrows + progress bar)
 *   - compact:   Small 4-pill track (used in awaiting-approval state)
 *   - rendering: Progress bar with shot completion counter
 */

"use client";

import s from "@/app/dashboard/brief-renders/page.module.css";
import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";
import type { ShotResult } from "@/features/brief-renders/services/brief-pipeline/types";

function mapStageToNumber(stage: string | null): number {
  switch (stage) {
    case "spec_extracting":
      return 1;
    case "awaiting_approval":
      return 2;
    case "rendering":
      return 3;
    case "awaiting_compile":
    case "compiling":
      return 4;
    case "completed":
      return 5;
    default:
      return 1;
  }
}

function stageEyebrow(job: BriefRenderJobView): string {
  const stage = mapStageToNumber(job.currentStage);
  if (job.status === "QUEUED") return "Stage 1 of 4 · Queued";
  return `Stage ${Math.min(stage, 4)} of 4 · Running`;
}

function ArrowSvg() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CheckSvg() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StagePill({
  num,
  name,
  state,
}: {
  num: string;
  name: string;
  state: "done" | "active" | undefined;
}) {
  return (
    <div className={s.stagePill} data-state={state}>
      <div className={s.stagePillIcon}>
        {state === "done" ? <CheckSvg /> : null}
      </div>
      <div className={s.stagePillLabel}>{num}</div>
      <div className={s.stagePillName}>
        {state === "active" ? (
          <em className={s.stagePillNameEm}>{name}</em>
        ) : (
          name
        )}
      </div>
    </div>
  );
}

function StageArrow({ active }: { active?: boolean }) {
  return (
    <div className={`${s.stageArrow}${active ? ` ${s.stageArrowActive}` : ""}`}>
      <ArrowSvg />
    </div>
  );
}

export interface JobStatusBannerProps {
  job: BriefRenderJobView;
  variant?: "default" | "compact" | "rendering" | "compiling";
}

export function JobStatusBanner({
  job,
  variant = "default",
}: JobStatusBannerProps) {
  if (
    job.status === "COMPLETED" ||
    job.status === "FAILED" ||
    job.status === "CANCELLED"
  ) {
    return null;
  }

  const currentStageNum = mapStageToNumber(job.currentStage);
  const stageState = (stage: number): "done" | "active" | undefined => {
    if (stage < currentStageNum) return "done";
    if (stage === currentStageNum) return "active";
    return undefined;
  };

  const shots = Array.isArray(job.shots)
    ? (job.shots as ShotResult[])
    : [];
  const totalShots = shots.length || 12;
  const completedShots = shots.filter((sh) => sh.status === "success").length;
  const runningShot = shots.find((sh) => sh.status === "running");

  const pct = (() => {
    if (job.currentStage === "rendering" && totalShots > 0) {
      return 35 + Math.round((completedShots / totalShots) * 45);
    }
    return Math.max(0, Math.min(100, Math.round(job.progress)));
  })();

  if (variant === "rendering") {
    return (
      <div
        className={s.stageTrack}
        role="status"
        aria-live="polite"
        data-testid="job-status-banner"
        data-status={job.status}
      >
        <div className={s.stageTrackRow}>
          <div>
            <div className={s.stageTrackEyebrow}>
              <div className={s.stageTrackEyebrowDot} />
              Stage 3 of 4 · Image Gen · {completedShots} of {totalShots}
            </div>
            <h2 className={s.stageTrackTitle}>
              Generating <em className={s.stageTrackTitleEm}>renders…</em>
            </h2>
          </div>
          <div className={s.stageTrackCost}>
            <div className={s.stageTrackCostLabel}>Cost so far</div>$
            {job.costUsd.toFixed(3)}
          </div>
        </div>
        <div className={s.stageProgress}>
          <div
            className={s.stageProgressFill}
            style={{ width: `${pct}%` }}
          >
            <div className={s.stageProgressShimmer} />
          </div>
        </div>
        <div className={s.stageProgressMeta}>
          <span className={s.stageProgressMetaLabel}>
            {completedShots} of {totalShots} complete
            {runningShot
              ? ` · Currently rendering shot #${runningShot.shotIndex + 1}`
              : ""}
          </span>
          <span className={s.stageProgressMetaPct}>{pct}%</span>
        </div>
      </div>
    );
  }

  if (variant === "compiling") {
    return (
      <div
        className={s.stageTrack}
        role="status"
        aria-live="polite"
        data-testid="job-status-banner"
        data-status={job.status}
      >
        <div className={s.stageTrackRow}>
          <div>
            <div className={s.stageTrackEyebrow}>
              <div className={s.stageTrackEyebrowDot} />
              Stage 4 of 4 · Compiling PDF
            </div>
            <h2 className={s.stageTrackTitle}>
              Compiling <em className={s.stageTrackTitleEm}>your PDF…</em>
            </h2>
          </div>
          {job.costUsd > 0 && (
            <div className={s.stageTrackCost}>
              <div className={s.stageTrackCostLabel}>Cost so far</div>$
              {job.costUsd.toFixed(3)}
            </div>
          )}
        </div>
        <div className={s.stageProgress}>
          <div
            className={s.stageProgressFill}
            style={{ width: `${Math.max(0, Math.min(100, Math.round(job.progress)))}%` }}
          >
            <div className={s.stageProgressShimmer} />
          </div>
        </div>
        <div className={s.stageProgressMeta}>
          <span className={s.stageProgressMetaLabel}>
            Laying out editorial PDF · ~30 seconds
          </span>
          <span className={s.stageProgressMetaPct}>
            {Math.round(job.progress)}%
          </span>
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div
        className={s.stageTrack}
        style={{ padding: "18px 12px" }}
        role="status"
        aria-live="polite"
        data-testid="job-status-banner"
        data-status={job.status}
      >
        <div className={s.stageFlow} style={{ marginTop: 0 }}>
          <StagePill num="S1" name="Spec Extract" state="done" />
          <StageArrow active />
          <StagePill num="—" name="Awaiting you" state="active" />
          <StageArrow />
          <StagePill num="S3" name="Image Gen ×12" state={undefined} />
          <StageArrow />
          <StagePill num="S4" name="PDF Compile" state={undefined} />
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div
      className={s.stageTrack}
      role="status"
      aria-live="polite"
      data-testid="job-status-banner"
      data-status={job.status}
    >
      <div className={s.stageTrackRow}>
        <div>
          <div className={s.stageTrackEyebrow}>
            <div className={s.stageTrackEyebrowDot} />
            {stageEyebrow(job)}
          </div>
          <h2 className={s.stageTrackTitle}>
            {job.currentStage === "spec_extracting" && (
              <>
                Reading your{" "}
                <em className={s.stageTrackTitleEm}>brief…</em>
              </>
            )}
            {job.currentStage === "awaiting_approval" && (
              <>
                Awaiting{" "}
                <em className={s.stageTrackTitleEm}>your approval</em>
              </>
            )}
            {job.currentStage === "rendering" && (
              <>
                Generating{" "}
                <em className={s.stageTrackTitleEm}>renders…</em>
              </>
            )}
            {(job.currentStage === "awaiting_compile" ||
              job.currentStage === "compiling") && (
              <>
                Compiling{" "}
                <em className={s.stageTrackTitleEm}>your PDF…</em>
              </>
            )}
            {!job.currentStage && <>Working…</>}
          </h2>
        </div>
        {job.costUsd > 0 && (
          <div className={s.stageTrackCost}>
            <div className={s.stageTrackCostLabel}>Cost so far</div>$
            {job.costUsd.toFixed(3)}
          </div>
        )}
      </div>

      <div className={s.stageFlow}>
        <StagePill num="S1" name="Spec Extract" state={stageState(1)} />
        <StageArrow active={stageState(1) === "done"} />
        <StagePill num="S2" name="Prompt Gen" state={stageState(2)} />
        <StageArrow active={stageState(2) === "done"} />
        <StagePill num="S3 · ×12" name="Image Gen" state={stageState(3)} />
        <StageArrow active={stageState(3) === "done"} />
        <StagePill num="S4" name="PDF Compile" state={stageState(4)} />
      </div>

      <div className={s.stageProgress}>
        <div className={s.stageProgressFill} style={{ width: `${pct}%` }}>
          <div className={s.stageProgressShimmer} />
        </div>
      </div>
      <div className={s.stageProgressMeta}>
        <span className={s.stageProgressMetaLabel}>
          {job.currentStage === "spec_extracting"
            ? "Reading brief · Identifying apartments + shots"
            : job.currentStage === "compiling"
              ? "Laying out editorial PDF"
              : ""}
        </span>
        <span className={s.stageProgressMetaPct}>{pct}%</span>
      </div>

      {/* "What we're extracting" educational panel — Stage 1 only */}
      {job.currentStage === "spec_extracting" && (
        <div className={s.extractingPanel}>
          <div className={s.extractingPanelEyebrow}>
            What we&apos;re reading from your brief
          </div>
          <div className={s.extractingGrid}>
            <div className={s.extractingItem}>
              <div className={s.extractingItemIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="18" rx="1" />
                  <line x1="9" y1="7" x2="9" y2="7.01" />
                  <line x1="15" y1="7" x2="15" y2="7.01" />
                  <line x1="9" y1="11" x2="9" y2="11.01" />
                  <line x1="15" y1="11" x2="15" y2="11.01" />
                  <line x1="9" y1="15" x2="9" y2="15.01" />
                  <line x1="15" y1="15" x2="15" y2="15.01" />
                </svg>
              </div>
              <div className={s.extractingItemLabel}>Apartments</div>
              <div className={s.extractingItemDesc}>
                Unit labels, areas, bedrooms, bathrooms
              </div>
            </div>
            <div className={s.extractingItem}>
              <div className={s.extractingItemIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <div className={s.extractingItemLabel}>Shots</div>
              <div className={s.extractingItemDesc}>
                Room types, hero distinction, aspect ratios
              </div>
            </div>
            <div className={s.extractingItem}>
              <div className={s.extractingItemIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                </svg>
              </div>
              <div className={s.extractingItemLabel}>Materials &amp; Lighting</div>
              <div className={s.extractingItemDesc}>
                Visual style, palette, camera spec
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
