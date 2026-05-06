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

import s from "@/app/dashboard/brief-renders/page.module.css";

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

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    COMPLETED: "Complete",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
    RUNNING: "Running",
    AWAITING_APPROVAL: "Awaiting you",
    QUEUED: "Queued",
  };
  return map[status] ?? status;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fetch trigger
    void fetchJobs();
  }, [fetchJobs]);

  return (
    <aside className={s.jobsBlock} data-testid="recent-jobs-drawer">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={s.jobsHead}
        aria-expanded={open}
        aria-controls="recent-jobs-list"
      >
        <span>Recent jobs {jobs ? `(${jobs.length})` : ""}</span>
        <span className={s.jobsHeadCount}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div
          id="recent-jobs-list"
          style={{ borderTop: "1px solid var(--rs-rule)" }}
        >
          {error && (
            <div
              role="alert"
              style={{ padding: "12px 20px", fontSize: 12, color: "#b44" }}
            >
              Failed to load: {error}
              <button
                type="button"
                onClick={fetchJobs}
                style={{
                  marginLeft: 8,
                  textDecoration: "underline",
                  background: "none",
                  border: "none",
                  color: "var(--rs-blueprint)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                Retry
              </button>
            </div>
          )}
          {jobs && jobs.length === 0 && !error && (
            <div className={s.jobsEmpty}>No previous jobs yet.</div>
          )}
          {jobs && jobs.length > 0 && (
            <ul className={s.jobsList}>
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(j.id)}
                    className={s.jobItem}
                    data-active={j.id === activeJobId ? "true" : undefined}
                    data-testid={`recent-job-${j.id}`}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 4,
                        }}
                      >
                        <span className={s.jobItemId}>
                          Job {j.id.slice(0, 8)}
                        </span>
                        <span
                          className={s.jobItemStatus}
                          data-status={j.status}
                        >
                          {formatStatus(j.status)}
                        </span>
                      </div>
                      <div className={s.jobItemMeta}>
                        <span>{formatRelativeDate(j.createdAt)}</span>
                        {j.costUsd > 0 && (
                          <>
                            <span
                              style={{
                                width: 2,
                                height: 2,
                                borderRadius: 99,
                                background: "var(--rs-text-mute)",
                              }}
                            />
                            <span>${j.costUsd.toFixed(3)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        color: "var(--rs-text-mute)",
                        transition: "transform 0.2s var(--rs-ease)",
                        flexShrink: 0,
                      }}
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
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
