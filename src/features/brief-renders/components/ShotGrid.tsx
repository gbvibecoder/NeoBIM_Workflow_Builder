/**
 * ShotGrid — N-cell grid of `ShotCell`s for a Brief-to-Renders job.
 *
 * Cell count is derived from the spec (apartments × shots), NOT from a
 * hardcoded constant. Includes lightbox for full-size image viewing.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import s from "@/app/dashboard/brief-renders/page.module.css";
import type {
  BriefSpec,
  ShotResult,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";
import { ShotCell } from "@/features/brief-renders/components/ShotCell";

export interface ShotGridProps {
  jobId: string;
  spec: BriefSpec;
  shots: ShotResult[];
  /** When true, regen is disabled across all cells. */
  busy?: boolean;
  onAnyRegen?: () => void;
  /** Whether regen buttons should be suppressed (e.g. during PDF recompile). */
  regenDisabled?: boolean;
}

interface CellInput {
  shot: ShotResult;
  label: string;
  shotSpec: ShotSpec | null;
}

function composeLabel(spec: BriefSpec, shot: ShotResult): string {
  const apt =
    shot.apartmentIndex !== null && shot.apartmentIndex !== undefined
      ? spec.apartments[shot.apartmentIndex] ?? null
      : null;
  const aptLabel =
    apt && typeof apt.label === "string" && apt.label.trim().length > 0
      ? apt.label.trim()
      : "";
  const shotSpec =
    apt && shot.shotIndexInApartment >= 0
      ? apt.shots[shot.shotIndexInApartment] ?? null
      : null;
  const room =
    shotSpec && typeof shotSpec.roomNameEn === "string"
      ? shotSpec.roomNameEn.trim()
      : "";
  if (aptLabel && room) return `${aptLabel} · ${room}`;
  if (aptLabel) return aptLabel;
  if (room) return room;
  return `Shot ${shot.shotIndex + 1}`;
}

function findShotSpec(spec: BriefSpec, shot: ShotResult): ShotSpec | null {
  const apt =
    shot.apartmentIndex !== null && shot.apartmentIndex !== undefined
      ? spec.apartments[shot.apartmentIndex] ?? null
      : null;
  if (!apt || shot.shotIndexInApartment < 0) return null;
  return apt.shots[shot.shotIndexInApartment] ?? null;
}

export function ShotGrid({
  jobId,
  spec,
  shots,
  busy = false,
  onAnyRegen,
  regenDisabled = false,
}: ShotGridProps) {
  const cells = useMemo<CellInput[]>(
    () =>
      shots.map((shot) => ({
        shot,
        label: composeLabel(spec, shot),
        shotSpec: findShotSpec(spec, shot),
      })),
    [spec, shots],
  );

  const successCount = cells.filter((c) => c.shot.status === "success").length;
  const runningCount = cells.filter((c) => c.shot.status === "running").length;
  const pendingCount = cells.filter((c) => c.shot.status === "pending").length;
  const heroCount = cells.filter((c) => c.shotSpec?.isHero).length;

  // Lightbox state
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const lightboxCell = lightboxIdx !== null ? cells[lightboxIdx] : null;

  const handleShotClick = useCallback(
    (shotIndex: number) => {
      const idx = cells.findIndex((c) => c.shot.shotIndex === shotIndex);
      if (idx >= 0 && cells[idx].shot.status === "success" && cells[idx].shot.imageUrl) {
        setLightboxIdx(idx);
      }
    },
    [cells],
  );

  // Esc closes lightbox
  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIdx(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIdx]);

  if (cells.length === 0) {
    return (
      <p
        style={{
          color: "var(--rs-text-mute)",
          fontSize: 13,
          fontStyle: "italic",
        }}
        data-testid="shot-grid-empty"
      >
        No shots yet — the spec extractor hasn&apos;t finished.
      </p>
    );
  }

  return (
    <div>
      <div className={s.gridBlock}>
        <div className={s.sectionHead}>
          <div>
            <div className={s.sectionEyebrow}>
              <span className={s.sectionNum}>01 –</span> Live renders
            </div>
            <h2 className={s.sectionTitle}>
              {cells.length} shots ·{" "}
              <em className={s.sectionTitleEm}>{heroCount} hero.</em>
            </h2>
          </div>
          <div className={s.gridStats}>
            <span style={{ color: "var(--rs-sage)" }}>
              ✓ {successCount} done
            </span>
            {runningCount > 0 && (
              <span style={{ color: "var(--rs-blueprint)" }}>
                ▸ {runningCount} rendering
              </span>
            )}
            {pendingCount > 0 && <span>{pendingCount} pending</span>}
          </div>
        </div>
      </div>

      <div
        role="list"
        aria-label="Generated shots"
        data-testid="shot-grid"
        data-shot-count={cells.length}
        className={s.gridContainer}
      >
        {cells.map(({ shot, label, shotSpec }) => (
          <div role="listitem" key={shot.shotIndex}>
            <ShotCell
              jobId={jobId}
              shot={shot}
              label={label}
              shotSpec={shotSpec}
              disabled={busy || regenDisabled}
              onRegenerated={onAnyRegen}
              onImageClick={handleShotClick}
            />
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxCell && lightboxCell.shot.imageUrl && (
        <div
          className={s.lightbox}
          onClick={() => setLightboxIdx(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Full size: ${lightboxCell.label}`}
        >
          <button
            type="button"
            className={s.lightboxClose}
            onClick={() => setLightboxIdx(null)}
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className={s.lightboxContent}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxCell.shot.imageUrl}
              alt={lightboxCell.label}
              className={s.lightboxImg}
            />
            <div className={s.lightboxMeta}>
              <div className={s.lightboxMetaTitle}>{lightboxCell.label}</div>
              <div className={s.lightboxMetaInfo}>
                {lightboxCell.shot.aspectRatio}
                {lightboxCell.shot.costUsd
                  ? ` · $${lightboxCell.shot.costUsd.toFixed(3)}`
                  : ""}
                {lightboxCell.shotSpec?.isHero ? " · ★ HERO" : ""}
              </div>
            </div>
            <div className={s.lightboxActions}>
              <a
                href={lightboxCell.shot.imageUrl}
                download
                className={s.lightboxDownload}
              >
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
