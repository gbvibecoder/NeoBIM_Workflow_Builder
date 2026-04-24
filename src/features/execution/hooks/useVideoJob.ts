/**
 * React hook — poll /api/video-jobs/[id] and expose the latest client view.
 *
 * Replaces pollSingleVideoGeneration + pollVideoGeneration from useExecution
 * for artifacts that carry a `videoJobId`. The worker in
 * /api/video-worker/poll owns the state; this hook is a thin cache.
 *
 * Behavior:
 *   • Fetches once on mount (if videoJobId provided).
 *   • Polls on an adaptive interval: 5s for first 5 min, 8s for 5–10 min,
 *     15s beyond 10 min. Client can poll forever — no hard timeout.
 *   • Stops polling when status becomes terminal (complete | partial | failed).
 *   • Cleans up interval on unmount.
 *   • Transient network errors don't bubble — they're swallowed and retried.
 *     Only 4xx/5xx responses from our own API surface as `error`.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoJobClientView } from "@/types/video-job";

export interface UseVideoJobResult {
  data: VideoJobClientView | null;
  isLoading: boolean;
  error: string | null;
}

function pollIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 5 * 60_000) return 5_000;
  if (elapsedMs < 10 * 60_000) return 8_000;
  return 15_000;
}

function isTerminal(status: VideoJobClientView["status"] | undefined): boolean {
  return status === "complete" || status === "partial" || status === "failed";
}

export function useVideoJob(videoJobId: string | null | undefined): UseVideoJobResult {
  const [data, setData] = useState<VideoJobClientView | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(videoJobId));
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
    // If caller passed a null id, do nothing — the derived return (below)
    // will mask any stale state so consumers see null cleanly. This avoids
    // the react-hooks/set-state-in-effect warning about synchronous resets.
    if (!videoJobId) return;

    // isLoading/error state is updated by fetchOnce() asynchronously (on
    // response / on error) — we deliberately do NOT call setIsLoading(true)
    // here because a synchronous setState at the top of an effect trips
    // react-hooks/set-state-in-effect. Initial state (useState default)
    // covers first mount; subsequent videoJobId changes accept a one-tick
    // stale flash of the previous job's state until fetchOnce resolves.
    pollStartedAtRef.current = Date.now();

    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch(`/api/video-jobs/${videoJobId}`, {
          method: "GET",
          credentials: "include",
        });
        if (cancelled || !mountedRef.current) return;

        if (!res.ok) {
          // Only surface our own 4xx/5xx as errors. These are actionable —
          // "not found" means the job was never created, 401 means session
          // expired, etc.
          const txt = await res.text().catch(() => "");
          setError(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`);
          setIsLoading(false);
          // On error, back off but keep polling — state may appear later.
          scheduleNext();
          return;
        }

        const view = (await res.json()) as VideoJobClientView;
        setData(view);
        setIsLoading(false);
        setError(null);

        if (isTerminal(view.status)) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = null;
          return;
        }
        scheduleNext();
      } catch {
        // Transient (offline, aborted) — swallow and retry. The user may have
        // closed a tab or roamed wifi; next interval tick covers it.
        if (!cancelled && mountedRef.current) scheduleNext();
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
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [videoJobId]);

  // Mask stale state when the caller has a null videoJobId — prevents a
  // previous job's result from bleeding into a fresh null render.
  if (!videoJobId) {
    return { data: null, isLoading: false, error: null };
  }
  return { data, isLoading, error };
}
