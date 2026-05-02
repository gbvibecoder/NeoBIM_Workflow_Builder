/**
 * CancelJobButton — DELETEs the job, transitioning it to CANCELLED.
 *
 * Confirms before sending so users don't lose work to a stray click.
 * The actual cancellation is the responsibility of the API; the
 * component only fires the request and lets the polling hook surface
 * the new status on the next tick.
 */

"use client";

import { useCallback, useState } from "react";

import s from "@/app/dashboard/brief-renders/page.module.css";

export interface CancelJobButtonProps {
  jobId: string;
  /** Disabled in terminal states (parent decides). */
  disabled?: boolean;
}

export function CancelJobButton({
  jobId,
  disabled = false,
}: CancelJobButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (busy || disabled) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Cancel this job? Already-generated shots will be kept but no new work will run.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brief-renders/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setError(txt.slice(0, 160) || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [jobId, busy, disabled]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        data-testid="cancel-job-button"
        className={s.btnCancel}
      >
        ✕ {busy ? "Cancelling…" : "Cancel job"}
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 12, color: "#b44" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
