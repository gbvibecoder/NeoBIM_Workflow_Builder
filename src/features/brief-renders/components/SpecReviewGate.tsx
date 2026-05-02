/**
 * SpecReviewGate — editorial spec review interstitial.
 *
 * Shows the parsed `BriefSpec` + assembled prompts for the user to
 * review before Phase 4's image gen kicks off. Two actions: approve
 * (triggers Phase 4) and cancel.
 *
 * Renders nothing (returns `null`) when:
 *   • The polled job is still loading.
 *   • Status is anything other than `AWAITING_APPROVAL`.
 */

"use client";

import { useState } from "react";

import s from "@/app/dashboard/brief-renders/page.module.css";
import {
  useBriefRenderJob,
  type BriefRenderJobView,
} from "@/features/brief-renders/hooks/useBriefRenderJob";
import type {
  ApartmentSpec,
  BriefSpec,
  ShotResult,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

export interface SpecReviewGateProps {
  jobId: string;
}

const PROMPT_PREVIEW_CHARS = 200;

function dashIfNull<T>(value: T | null | undefined): T | "—" {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim().length === 0) return "—";
  return value;
}

export function SpecReviewGate({ jobId }: SpecReviewGateProps) {
  const { job, isLoading } = useBriefRenderJob({ jobId, enabled: true });
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedShot, setExpandedShot] = useState<number | null>(null);

  if (isLoading || !job) return null;
  if (job.status !== "AWAITING_APPROVAL") return null;

  const spec = job.specResult as BriefSpec | null;
  const shots = (job.shots as ShotResult[] | null) ?? [];

  if (!spec) return null;

  async function handleApprove() {
    setBusy("approve");
    setActionError(null);
    try {
      const res = await fetch(`/api/brief-renders/${jobId}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setActionError(
          `Approve failed (${res.status})${txt ? `: ${txt.slice(0, 200)}` : ""}`,
        );
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    setBusy("cancel");
    setActionError(null);
    try {
      const res = await fetch(`/api/brief-renders/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setActionError(
          `Cancel failed (${res.status})${txt ? `: ${txt.slice(0, 200)}` : ""}`,
        );
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }

  const totalShots = shots.length;

  // Pair each ShotResult back to its source ShotSpec
  const sourceShots = shots.map((shotResult) => {
    const apt =
      shotResult.apartmentIndex !== null &&
      shotResult.apartmentIndex !== undefined
        ? spec.apartments[shotResult.apartmentIndex] ?? null
        : null;
    const shotSpec =
      apt && shotResult.shotIndexInApartment >= 0
        ? apt.shots[shotResult.shotIndexInApartment] ?? null
        : null;
    return {
      shotResult,
      shotSpec,
      apartmentLabel: apt?.label ?? null,
    };
  });

  return (
    <div className={s.reviewBlock}>
      {/* Head */}
      <div className={s.reviewHead}>
        <div className={s.reviewHeadEyebrow}>
          <div className={s.reviewHeadEyebrowDot} />
          Step 2 of 4 · Review specification
        </div>
        <h2 className={s.reviewHeadTitle}>
          We read your brief.{" "}
          <em className={s.reviewHeadTitleEm}>Now check our work.</em>
        </h2>
        <p className={s.reviewHeadSub}>
          Approve to start image generation. Every field below was extracted
          directly from your brief — empty fields mean the source was silent.
        </p>
      </div>

      {/* Project metadata */}
      <div className={s.projectMeta}>
        <div className={s.metaEyebrow}>Project</div>
        <div className={s.metaGrid}>
          <div className={s.metaLabel}>Title</div>
          <div className={s.metaValueDisplay}>
            {dashIfNull(spec.projectTitle)}
          </div>
          <div className={s.metaLabel}>Location</div>
          <div className={s.metaValue}>
            {dashIfNull(spec.projectLocation)}
          </div>
          <div className={s.metaLabel}>Type</div>
          <div className={s.metaValue}>{dashIfNull(spec.projectType)}</div>
        </div>
      </div>

      {/* Apartments */}
      <div className={s.aptBlock}>
        <div className={s.metaEyebrow}>
          Apartments ({spec.apartments.length})
        </div>
        <div className={s.aptTable}>
          <div className={`${s.aptRow} ${s.aptRowHead}`}>
            <div className={s.aptCell}>Label</div>
            <div className={s.aptCell}>German</div>
            <div className={s.aptCell}>Total m²</div>
            <div className={s.aptCell}>Beds</div>
            <div className={s.aptCell}>Baths</div>
            <div className={s.aptCell}>Shots</div>
          </div>
          {spec.apartments.map((apt: ApartmentSpec, idx: number) => (
            <div key={idx} className={s.aptRow}>
              <div className={`${s.aptCell} ${s.aptCellLabel}`}>
                {dashIfNull(apt.label)}
              </div>
              <div className={`${s.aptCell} ${s.aptCellMono}`}>
                {dashIfNull(apt.labelDe)}
              </div>
              <div className={`${s.aptCell} ${s.aptCellMono}`}>
                {dashIfNull(apt.totalAreaSqm)}
              </div>
              <div className={s.aptCell}>{dashIfNull(apt.bedrooms)}</div>
              <div className={s.aptCell}>{dashIfNull(apt.bathrooms)}</div>
              <div className={s.aptCell}>{apt.shots.length}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Shots */}
      <div className={s.shotsBlock}>
        <div className={s.metaEyebrow}>Shots ({totalShots})</div>
        <div className={s.shotsGrid}>
          {sourceShots.map(({ shotResult, shotSpec, apartmentLabel }) => {
            const isHero = shotSpec?.isHero === true;
            const isExpanded = expandedShot === shotResult.shotIndex;
            const preview =
              shotResult.prompt.length > PROMPT_PREVIEW_CHARS
                ? shotResult.prompt.slice(0, PROMPT_PREVIEW_CHARS) + "…"
                : shotResult.prompt;

            return (
              <div
                key={shotResult.shotIndex}
                className={s.shotCard}
                data-hero={isHero ? "true" : undefined}
              >
                <div className={s.shotRow1}>
                  <span className={s.shotNum}>
                    #{shotResult.shotIndex}
                  </span>
                  <span className={s.shotApt}>
                    {dashIfNull(apartmentLabel)}
                  </span>
                  <span className={s.shotAspect}>
                    {shotResult.aspectRatio}
                  </span>
                  {isHero && (
                    <span className={s.shotHeroMark}>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      Hero
                    </span>
                  )}
                </div>
                <div className={s.shotName}>
                  {dashIfNull(shotSpec?.roomNameEn ?? null)}
                </div>
                <div className={s.shotNameDe}>
                  {shotSpec?.roomNameDe ? `${shotSpec.roomNameDe} · ` : ""}
                  {shotSpec?.areaSqm ? `${shotSpec.areaSqm} m²` : ""}
                </div>
                <div className={s.shotPrompt}>
                  {isExpanded ? shotResult.prompt : preview}
                </div>
                {shotResult.prompt.length > PROMPT_PREVIEW_CHARS && (
                  <button
                    type="button"
                    className={s.shotExpand}
                    onClick={() =>
                      setExpandedShot(
                        isExpanded ? null : shotResult.shotIndex,
                      )
                    }
                  >
                    {isExpanded ? "Collapse" : "Expand prompt"}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline
                        points={isExpanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}
                      />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Approve footer */}
      <div className={s.approveRow}>
        <div className={s.approveCost}>
          Spec extraction cost so far:{" "}
          <span className={s.approveCostNum}>
            ${job.costUsd.toFixed(3)}
          </span>
        </div>
        <div className={s.approveActions}>
          {actionError && (
            <div className={s.errorAlert} role="alert">
              {actionError}
            </div>
          )}
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy !== null}
            className={s.btnSecondary}
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy !== null}
            className={s.btnPrimary}
          >
            {busy === "approve" ? "Approving…" : "Approve & Generate"}
            <svg
              width="14"
              height="14"
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
          </button>
        </div>
      </div>
    </div>
  );
}
