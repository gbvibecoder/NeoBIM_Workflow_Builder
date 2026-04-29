/**
 * Brief-to-Renders polling hook.
 *
 * Mirrors `src/features/execution/hooks/useVideoJob.ts` shape:
 *   • Adaptive cadence — 5 s for first 5 min, 8 s for 5–10 min, 15 s after.
 *   • No hard timeout — client polls forever; server is the source of
 *     truth for terminal status.
 *   • Stops polling when status is terminal (`COMPLETED`, `FAILED`,
 *     `CANCELLED`).
 *   • Keeps polling on `AWAITING_APPROVAL` so an approve POST → RUNNING
 *     transition is observed by the next tick.
 *   • Cleans up on unmount + cancels in-flight fetch via AbortController.
 *
 * Returns a `BriefRenderJobView` snapshot — not the raw row, since the
 * route returns Date strings and the heavier `specResult`/`shots`/
 * `stageLog` JSON blobs that downstream UI consumes lazily.
 */

"use client";

import { useEffect, useRef, useState } from "react";

export type BriefRenderJobStatusClient =
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface BriefRenderJobView {
  id: string;
  requestId: string;
  briefUrl: string;
  status: BriefRenderJobStatusClient;
  progress: number;
  currentStage: string | null;
  specResult: unknown | null;
  shots: unknown | null;
  pdfUrl: string | null;
  errorMessage: string | null;
  costUsd: number;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  userApproval: string | null;
  stageLog: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface UseBriefRenderJobResult {
  job: BriefRenderJobView | null;
  status: BriefRenderJobStatusClient | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseBriefRenderJobOptions {
  jobId: string | null;
  enabled?: boolean;
}

const FIVE_MIN_MS = 5 * 60_000;
const TEN_MIN_MS = 10 * 60_000;

function pollIntervalMs(elapsedMs: number): number {
  if (elapsedMs < FIVE_MIN_MS) return 5_000;
  if (elapsedMs < TEN_MIN_MS) return 8_000;
  return 15_000;
}

function isTerminal(status: BriefRenderJobStatusClient | null | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

export function useBriefRenderJob({
  jobId,
  enabled = true,
}: UseBriefRenderJobOptions): UseBriefRenderJobResult {
  const [job, setJob] = useState<BriefRenderJobView | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(jobId && enabled));
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
        const res = await fetch(`/api/brief-renders/${jobId}`, {
          method: "GET",
          credentials: "include",
          signal: abort.signal,
        });
        if (cancelled || !mountedRef.current) return;

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          setError(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`);
          setIsLoading(false);
          // 4xx/5xx — back off, keep polling. State may flip later
          // (e.g. session refresh, eventual consistency).
          scheduleNext();
          return;
        }

        const view = (await res.json()) as BriefRenderJobView;
        setJob(view);
        setIsLoading(false);
        setError(null);

        if (isTerminal(view.status)) {
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
