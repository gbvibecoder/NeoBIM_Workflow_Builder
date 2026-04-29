/**
 * ShotGrid — N-cell grid of `ShotCell`s for a Brief-to-Renders job.
 *
 * Cell count is derived from the spec (apartments × shots), NOT from a
 * hardcoded constant. The Brief-to-Renders pipeline supports any shot
 * count the brief specifies; the canonical "12 shots" is a Marx12-shaped
 * default, not a structural limit.
 *
 * Each cell label is composed from the parent apartment + the shot's
 * English room name, with a graceful fallback when either is null
 * (strict-faithfulness contract — we never invent a label).
 */

"use client";

import { useMemo } from "react";

import type {
  BriefSpec,
  ShotResult,
} from "@/features/brief-renders/services/brief-pipeline/types";
import { ShotCell } from "@/features/brief-renders/components/ShotCell";

export interface ShotGridProps {
  jobId: string;
  spec: BriefSpec;
  shots: ShotResult[];
  /** When true, regen is disabled across all cells. */
  busy?: boolean;
  onAnyRegen?: () => void;
}

interface CellInput {
  shot: ShotResult;
  label: string;
}

function composeLabel(
  spec: BriefSpec,
  shot: ShotResult,
): string {
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

export function ShotGrid({
  jobId,
  spec,
  shots,
  busy = false,
  onAnyRegen,
}: ShotGridProps) {
  const cells = useMemo<CellInput[]>(
    () =>
      shots.map((shot) => ({
        shot,
        label: composeLabel(spec, shot),
      })),
    [spec, shots],
  );

  if (cells.length === 0) {
    return (
      <div
        className="text-sm text-zinc-500 italic"
        data-testid="shot-grid-empty"
      >
        No shots yet — the spec extractor hasn&apos;t finished.
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label="Generated shots"
      data-testid="shot-grid"
      data-shot-count={cells.length}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      {cells.map(({ shot, label }) => (
        <div role="listitem" key={shot.shotIndex}>
          <ShotCell
            jobId={jobId}
            shot={shot}
            label={label}
            disabled={busy}
            onRegenerated={onAnyRegen}
          />
        </div>
      ))}
    </div>
  );
}
