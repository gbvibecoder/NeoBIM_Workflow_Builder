/**
 * ShotCell — single tile inside the per-job shot grid.
 *
 * State surface (mirrors `ShotResult.status`):
 *   • pending  — placeholder skeleton, no image
 *   • running  — animated shimmer + "Rendering" label
 *   • success  — preview image + cost + Regenerate button
 *   • failed   — error icon + message + Regenerate button
 *
 * Regeneration uses the Phase 4 endpoint with a fresh `Idempotency-Key`
 * each click (a true click should produce a new generation, not a
 * cached one). We expose `onRegenerated` so the parent can briefly show
 * a "queued" state while polling catches up.
 */

"use client";

import { useCallback, useState } from "react";

import type { ShotResult } from "@/features/brief-renders/services/brief-pipeline/types";

export interface ShotCellProps {
  jobId: string;
  shot: ShotResult;
  /** Display label like "Apartment A · Living Room" — assembled by parent. */
  label: string;
  /** Disable regen while the parent knows another mutation is in flight. */
  disabled?: boolean;
  onRegenerated?: () => void;
}

interface RegenError {
  message: string;
  status?: number;
}

export function ShotCell({
  jobId,
  shot,
  label,
  disabled = false,
  onRegenerated,
}: ShotCellProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RegenError | null>(null);

  const handleRegenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/brief-renders/${jobId}/regenerate-shot`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            apartmentIndex: shot.apartmentIndex ?? 0,
            shotIndexInApartment: shot.shotIndexInApartment,
          }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setError({
          message: txt.slice(0, 160) || `HTTP ${res.status}`,
          status: res.status,
        });
        return;
      }
      onRegenerated?.();
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setBusy(false);
    }
  }, [jobId, shot.apartmentIndex, shot.shotIndexInApartment, onRegenerated]);

  const allowRegen =
    !disabled &&
    !busy &&
    (shot.status === "success" || shot.status === "failed");

  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col"
      data-testid={`shot-cell-${shot.shotIndex}`}
      data-status={shot.status}
    >
      <div className="aspect-[3/2] bg-zinc-950 relative overflow-hidden">
        {shot.status === "success" && shot.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.imageUrl}
            alt={label}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : shot.status === "running" ? (
          <RunningPlaceholder />
        ) : shot.status === "failed" ? (
          <FailedPlaceholder message={shot.errorMessage} />
        ) : (
          <PendingPlaceholder />
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-medium text-zinc-100 truncate" title={label}>
            {label}
          </div>
          <span className="font-mono text-[10px] text-zinc-500">
            #{shot.shotIndex + 1}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{shot.aspectRatio}</span>
          {shot.costUsd !== null && shot.costUsd > 0 && (
            <span className="font-mono">${shot.costUsd.toFixed(3)}</span>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="text-[11px] text-red-300 bg-red-950/50 border border-red-800 rounded px-2 py-1"
          >
            {error.message}
          </div>
        )}

        {allowRegen && (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy}
            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-zinc-600 self-start"
            data-testid={`regen-${shot.shotIndex}`}
          >
            {busy ? "Queuing…" : "Regenerate"}
          </button>
        )}
      </div>
    </div>
  );
}

function PendingPlaceholder() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
      Pending
    </div>
  );
}

function RunningPlaceholder() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900"
        aria-hidden
      />
      <span className="relative text-xs text-zinc-300 font-medium">
        Rendering…
      </span>
    </div>
  );
}

function FailedPlaceholder({ message }: { message: string | null }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center gap-1">
      <span className="text-red-400 text-xs font-medium">Render failed</span>
      {message && (
        <span className="text-[10px] text-zinc-500 line-clamp-3">{message}</span>
      )}
    </div>
  );
}
