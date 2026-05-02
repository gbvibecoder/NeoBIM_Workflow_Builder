/**
 * ShotCell — single tile inside the per-job shot grid.
 *
 * State surface (mirrors `ShotResult.status`):
 *   • pending  — placeholder skeleton, no image
 *   • running  — animated shimmer + "Rendering" label
 *   • success  — preview image + cost + Regenerate button
 *   • failed   — error icon + message + Regenerate button
 */

"use client";

import { useCallback, useState } from "react";

import s from "@/app/dashboard/brief-renders/page.module.css";
import type {
  ShotResult,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

export interface ShotCellProps {
  jobId: string;
  shot: ShotResult;
  /** Display label like "Apartment A · Living Room" — assembled by parent. */
  label: string;
  /** Source spec for hero detection. */
  shotSpec?: ShotSpec | null;
  /** Disable regen while the parent knows another mutation is in flight. */
  disabled?: boolean;
  onRegenerated?: () => void;
  /** Click handler for successful image — opens lightbox in parent. */
  onImageClick?: (shotIndex: number) => void;
}

interface RegenError {
  message: string;
  status?: number;
}

export function ShotCell({
  jobId,
  shot,
  label,
  shotSpec,
  disabled = false,
  onRegenerated,
  onImageClick,
}: ShotCellProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RegenError | null>(null);
  const isHero = shotSpec?.isHero === true;

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
      className={s.shotTile}
      data-hero={isHero ? "true" : undefined}
      data-testid={`shot-cell-${shot.shotIndex}`}
      data-status={shot.status}
    >
      <div className={s.shotTileImg}>
        {shot.status === "success" && shot.imageUrl ? (
          <button
            type="button"
            className={s.shotTileImgClickable}
            onClick={() => onImageClick?.(shot.shotIndex)}
            aria-label={`View ${label} full size`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.imageUrl}
              alt={label}
              className={s.shotTileSuccess}
              loading="lazy"
            />
          </button>
        ) : shot.status === "running" ? (
          <div className={`${s.shotTileStatus} ${s.shotTileRunning}`}>
            <div className={s.shotTileRunningLabel}>
              <div className={s.shotTileRunningSpinner} />
              Rendering…
            </div>
          </div>
        ) : shot.status === "failed" ? (
          <div className={`${s.shotTileStatus} ${s.shotTileFailed}`}>
            <div className={s.shotTileFailedLabel}>Render failed</div>
            {shot.errorMessage && (
              <div className={s.shotTileFailedMsg}>{shot.errorMessage}</div>
            )}
          </div>
        ) : (
          <div className={`${s.shotTileStatus} ${s.shotTilePending}`}>
            <div className={s.shotTilePendingLabel}>
              {isHero ? "★ Hero · Pending" : "Pending"}
            </div>
          </div>
        )}
      </div>

      <div className={s.shotTileMeta}>
        <div className={s.shotTileName} title={label}>
          {label}
        </div>
        <div className={s.shotTileInfo}>
          {isHero && (
            <>
              <span style={{ color: "var(--rs-burnt)", fontWeight: 500 }}>
                ★ HERO
              </span>
              <div className={s.shotTileInfoDot} />
            </>
          )}
          <span>{shot.aspectRatio}</span>
          {shot.costUsd !== null && shot.costUsd > 0 && (
            <>
              <div className={s.shotTileInfoDot} />
              <span>${shot.costUsd.toFixed(3)}</span>
            </>
          )}
        </div>

        {error && (
          <div className={s.errorAlert} role="alert" style={{ marginTop: 4, padding: "6px 10px", fontSize: 11 }}>
            {error.message}
          </div>
        )}

        {allowRegen && (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy}
            className={s.shotTileRegen}
            data-testid={`regen-${shot.shotIndex}`}
          >
            {busy ? "Queuing…" : "↻ Regenerate"}
          </button>
        )}
      </div>
    </div>
  );
}
