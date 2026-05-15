/**
 * Brief-to-IFC v2 queued-pipeline polling hook.
 *
 * Mirrors `src/features/brief-renders/hooks/useBriefRenderJob.ts`:
 *   • Adaptive cadence — 4 s for the first 5 min, 8 s for 5–10 min,
 *     15 s after.
 *   • No hard timeout — the server (worker + cleanup cron) is the source
 *     of truth for terminal status.
 *   • Stops polling on a terminal status (`COMPLETED`, `FAILED`).
 *   • Cleans up on unmount and cancels the in-flight fetch via
 *     `AbortController`.
 *
 * The canvas run path (`runBriefToIfcQueued`) polls imperatively and does
 * NOT use this hook — this is the reactive variant for any component
 * (e.g. a job-status panel) that wants to observe a job by id.
 *
 * Returns a `BriefToIfcJobView` snapshot — the exact shape
 * `GET /api/brief-to-ifc-job/:id` returns.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import {
  isBriefToIfcTerminal,
  type BriefToIfcJobView,
  type BriefToIfcJobStatus,
} from "@/features/ifc/services/brief-to-ifc-v2/job-types";

export interface UseBriefToIfcJobResult {
  job: BriefToIfcJobView | null;
  status: BriefToIfcJobStatus | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseBriefToIfcJobOptions {
  jobId: string | null;
  enabled?: boolean;
}

const FIVE_MIN_MS = 5 * 60_000;
const TEN_MIN_MS = 10 * 60_000;

function pollIntervalMs(elapsedMs: number): number {
  if (elapsedMs < FIVE_MIN_MS) return 4_000;
  if (elapsedMs < TEN_MIN_MS) return 8_000;
  return 15_000;
}

export function useBriefToIfcJob({
  jobId,
  enabled = true,
}: UseBriefToIfcJobOptions): UseBriefToIfcJobResult {
  const [job, setJob] = useState<BriefToIfcJobView | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(jobId && enabled),
  );
  const [error, setError] = useState<string | null>(null);

  const pollStartedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!jobId || !enabled) return;
    pollStartedAtRef.current = Date.now();
    const abort = new AbortController();
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch(`/api/brief-to-ifc-job/${jobId}`, {
          method: "GET",
          credentials: "include",
          signal: abort.signal,
        });
        if (cancelled || !mountedRef.current) return;

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          setError(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`);
          setIsLoading(false);
          // 4xx/5xx — back off, keep polling. State may flip later.
          scheduleNext();
          return;
        }

        const view = (await res.json()) as BriefToIfcJobView;
        setJob(view);
        setIsLoading(false);
        setError(null);

        if (isBriefToIfcTerminal(view.status)) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = null;
          return;
        }
        scheduleNext();
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        // AbortError from cleanup → silently exit; any other transient
        // error → back off and retry on the next tick.
        if (err instanceof Error && err.name === "AbortError") return;
        scheduleNext();
      }
    }

    function scheduleNext() {
      if (!mountedRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      const started = pollStartedAtRef.current ?? Date.now();
      const delay = pollIntervalMs(Date.now() - started);
      timerRef.current = setTimeout(fetchOnce, delay);
    }

    fetchOnce();

    return () => {
      cancelled = true;
      abort.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [jobId, enabled]);

  if (!jobId || !enabled) {
    return { job: null, status: null, isLoading: false, error: null };
  }
  return { job, status: job?.status ?? null, isLoading, error };
}
