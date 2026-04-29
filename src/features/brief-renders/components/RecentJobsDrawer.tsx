/**
 * RecentJobsDrawer — collapsible list of the user's recent BriefRenderJobs.
 *
 * Fetches `/api/brief-renders` once on mount; doesn't poll (the active
 * job is polled by the parent shell). Click a row to load that job's
 * full state — caller decides what "load" means (typically updating a
 * URL search param so the shell switches its active jobId).
 */

"use client";

import { useCallback, useEffect, useState } from "react";

interface RecentJob {
  id: string;
  status: string;
  currentStage: string | null;
  createdAt: string;
  costUsd: number;
  errorMessage: string | null;
}

interface ListResponse {
  jobs: RecentJob[];
  nextCursor?: string;
}

export interface RecentJobsDrawerProps {
  activeJobId: string | null;
  onSelect: (jobId: string) => void;
}

const STATUS_TONE: Record<string, string> = {
  COMPLETED: "text-emerald-400",
  FAILED: "text-red-400",
  CANCELLED: "text-zinc-500",
  RUNNING: "text-cyan-400",
  AWAITING_APPROVAL: "text-amber-400",
  QUEUED: "text-zinc-300",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function RecentJobsDrawer({
  activeJobId,
  onSelect,
}: RecentJobsDrawerProps) {
  const [jobs, setJobs] = useState<RecentJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const fetchJobs = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/brief-renders?limit=10", {
        credentials: "include",
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        setJobs([]);
        return;
      }
      const body = (await res.json()) as ListResponse;
      setJobs(body.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fetch trigger; setState happens inside fetchJobs after the await resolves, not synchronously here
    void fetchJobs();
  }, [fetchJobs]);

  return (
    <aside
      className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
      data-testid="recent-jobs-drawer"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800/50"
        aria-expanded={open}
        aria-controls="recent-jobs-list"
      >
        <span>Recent jobs {jobs ? `(${jobs.length})` : ""}</span>
        <span className="text-zinc-500 text-xs">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div id="recent-jobs-list" className="border-t border-zinc-800">
          {error && (
            <div role="alert" className="px-4 py-2 text-xs text-red-300">
              Failed to load: {error}
              <button
                type="button"
                onClick={fetchJobs}
                className="ml-2 underline text-red-200 hover:text-white"
              >
                Retry
              </button>
            </div>
          )}
          {jobs && jobs.length === 0 && !error && (
            <div className="px-4 py-3 text-xs text-zinc-500 italic">
              No previous jobs yet.
            </div>
          )}
          {jobs && jobs.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {jobs.map((j) => {
                const isActive = j.id === activeJobId;
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(j.id)}
                      className={[
                        "w-full text-left px-4 py-2 text-xs flex flex-col gap-0.5 hover:bg-zinc-800/40",
                        isActive ? "bg-zinc-800/60" : "",
                      ].join(" ")}
                      data-testid={`recent-job-${j.id}`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-zinc-300 truncate">
                          {j.id.slice(0, 12)}…
                        </span>
                        <span
                          className={STATUS_TONE[j.status] ?? "text-zinc-300"}
                        >
                          {j.status}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between text-zinc-500">
                        <span>{formatDate(j.createdAt)}</span>
                        {j.costUsd > 0 && (
                          <span className="font-mono">
                            ${j.costUsd.toFixed(3)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
