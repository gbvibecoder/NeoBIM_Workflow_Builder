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
    if (typeof window !== "undefined" && !window.confirm("Cancel this job? Already-generated shots will be kept but no new work will run.")) {
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
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        data-testid="cancel-job-button"
        className={[
          "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold",
          "border border-red-700/60 bg-red-950/40 text-red-200",
          "hover:bg-red-900/60 hover:text-red-100 hover:border-red-600",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors",
        ].join(" ")}
      >
        <span aria-hidden>✕</span>
        {busy ? "Cancelling…" : "Cancel job"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
