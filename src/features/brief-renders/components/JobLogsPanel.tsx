/**
 * JobLogsPanel — terminal-style real-time view of pipeline progress.
 *
 * Admin-only debug surface. Renders three things:
 *   1. Current state strip — status / current stage / elapsed / cost.
 *   2. Stage history timeline — every entry from `job.stageLog` with
 *      timestamps, durations, costs, summaries, and inline error text.
 *   3. Per-shot table — when Stage 3 is in flight, surfaces per-shot
 *      status that the public ShotGrid doesn't show numerically.
 *
 * Polling cadence is owned by the parent's `useBriefRenderJob`, so this
 * panel re-renders on every poll tick (5–15 s adaptive). For
 * sub-stage liveness (a 30-second Stage 1 with no log update), an
 * `Elapsed: <seconds>` ticker runs locally so the panel stays
 * obviously-alive even between polls.
 *
 * The panel uses inline styles (rather than Tailwind) for the
 * terminal-style chrome because the rest of the brief-renders UI is
 * Tailwind but mixing the two for this dense table felt cleaner with
 * inline. Cost: small visual divergence; benefit: zero global CSS.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";
import type {
  BriefStageLogEntry,
  ShotResult,
} from "@/features/brief-renders/services/brief-pipeline/types";

export interface JobLogsPanelProps {
  job: BriefRenderJobView;
  /** When false, the panel renders nothing. Caller's responsibility. */
  visible: boolean;
}

interface ForceKickResponse {
  ok: boolean;
  gate: string;
  picked?: {
    apartmentIndex: number;
    shotIndexInApartment: number;
    flatIndex: number;
  };
  result?: {
    status: string;
    error?: string;
    reason?: string;
    kind?: string;
    costUsd?: number;
    imageUrl?: string;
  };
  nextPending?: {
    apartmentIndex: number;
    shotIndexInApartment: number;
  } | null;
  reEnqueue?: {
    attempted: boolean;
    ok: boolean;
    messageId?: string;
    error?: string;
    workerUrl?: string;
  };
  job?: {
    status: string | null;
    currentStage: string | null;
    costUsd: number | null;
    shotCounts?: Record<string, number> | null;
    progress?: number | null;
    pdfUrl?: string | null;
  };
  error?: string;
  message?: string;
  shotCounts?: Record<string, number>;
}

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  QUEUED: { fg: "#FBBF24", bg: "rgba(251,191,36,0.12)" },
  RUNNING: { fg: "#22D3EE", bg: "rgba(34,211,238,0.12)" },
  AWAITING_APPROVAL: { fg: "#FBBF24", bg: "rgba(251,191,36,0.12)" },
  COMPLETED: { fg: "#34D399", bg: "rgba(52,211,153,0.12)" },
  FAILED: { fg: "#F87171", bg: "rgba(248,113,113,0.12)" },
  CANCELLED: { fg: "#9CA3AF", bg: "rgba(156,163,175,0.12)" },
};

const STAGE_TONE: Record<BriefStageLogEntry["status"], { fg: string; icon: string }> = {
  running: { fg: "#22D3EE", icon: "▸" },
  success: { fg: "#34D399", icon: "✓" },
  failed: { fg: "#F87171", icon: "✗" },
};

const SHOT_STATUS_TONE: Record<ShotResult["status"], string> = {
  pending: "#9CA3AF",
  running: "#22D3EE",
  success: "#34D399",
  failed: "#F87171",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

function formatCost(usd: number | null): string {
  if (usd === null || usd === undefined) return "—";
  return `$${usd.toFixed(3)}`;
}

function useElapsedTicker(startIso: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startIso]);
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, now - start);
}

export function JobLogsPanel({ job, visible }: JobLogsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [kickInFlight, setKickInFlight] = useState(false);
  const [kickResult, setKickResult] = useState<ForceKickResponse | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);
  const [retryInFlight, setRetryInFlight] = useState(false);
  const [retryResult, setRetryResult] = useState<ForceKickResponse | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const stageLog = useMemo<BriefStageLogEntry[]>(() => {
    if (!Array.isArray(job.stageLog)) return [];
    return job.stageLog as BriefStageLogEntry[];
  }, [job.stageLog]);

  const shots = useMemo<ShotResult[]>(() => {
    if (!Array.isArray(job.shots)) return [];
    return job.shots as ShotResult[];
  }, [job.shots]);

  const hasPendingShot = useMemo(
    () => shots.some((s) => s.status === "pending"),
    [shots],
  );
  const hasRunningShot = useMemo(
    () => shots.some((s) => s.status === "running"),
    [shots],
  );
  const showForceKick =
    job.status === "RUNNING" &&
    hasPendingShot &&
    !hasRunningShot &&
    job.currentStage === "rendering";

  // S4 retry button: surface when the job is stuck mid-compile (most
  // commonly when Stage 4 returned `failed` and the worker exited
  // without flipping to FAILED — `retries: 0` means QStash never re-fires).
  const showRetryCompile =
    job.status === "RUNNING" &&
    (job.currentStage === "compiling" ||
      job.currentStage === "awaiting_compile");

  const handleForceKick = useCallback(async () => {
    setKickInFlight(true);
    setKickError(null);
    try {
      const res = await fetch(
        `/api/brief-renders/${job.id}/admin-force-kick`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const text = await res.text();
      let parsed: ForceKickResponse | null = null;
      try {
        parsed = text ? (JSON.parse(text) as ForceKickResponse) : null;
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        setKickError(
          parsed?.error ??
            parsed?.message ??
            `HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        setKickResult(parsed);
      } else {
        setKickResult(parsed);
      }
    } catch (err) {
      setKickError(err instanceof Error ? err.message : String(err));
    } finally {
      setKickInFlight(false);
    }
  }, [job.id]);

  const handleRetryCompile = useCallback(async () => {
    setRetryInFlight(true);
    setRetryError(null);
    try {
      const res = await fetch(
        `/api/brief-renders/${job.id}/admin-retry-compile`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const text = await res.text();
      let parsed: ForceKickResponse | null = null;
      try {
        parsed = text ? (JSON.parse(text) as ForceKickResponse) : null;
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        setRetryError(
          parsed?.error ??
            parsed?.message ??
            `HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        setRetryResult(parsed);
      } else {
        setRetryResult(parsed);
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryInFlight(false);
    }
  }, [job.id]);

  const runningStage = useMemo(
    () => stageLog.find((e) => e.status === "running") ?? null,
    [stageLog],
  );

  // Live-elapsed ticker for the most recent running stage. Uses
  // `runningStage?.startedAt` as the anchor; falls back to the job's
  // own startedAt if no running stage is logged yet.
  const elapsedAnchor = runningStage?.startedAt ?? job.startedAt;
  const liveElapsedMs = useElapsedTicker(elapsedAnchor);

  const shotProgress = useMemo(() => {
    if (shots.length === 0) return null;
    const success = shots.filter((s) => s.status === "success").length;
    const failed = shots.filter((s) => s.status === "failed").length;
    const running = shots.filter((s) => s.status === "running").length;
    return { success, failed, running, total: shots.length };
  }, [shots]);

  if (!visible) return null;

  const statusTone = STATUS_TONE[job.status] ?? {
    fg: "#E5E7EB",
    bg: "rgba(229,231,235,0.12)",
  };

  return (
    <section
      data-testid="job-logs-panel"
      style={{
        background: "#0a0c10",
        border: "1px solid rgba(184,115,51,0.18)",
        borderRadius: 12,
        fontFamily:
          "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        color: "#D1D5DB",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "rgba(184,115,51,0.06)",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid rgba(184,115,51,0.18)",
          color: "#F0F2F8",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 11,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
        }}
        data-testid="job-logs-panel-toggle"
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background:
                job.status === "RUNNING" || job.status === "QUEUED"
                  ? "#22D3EE"
                  : statusTone.fg,
              animation:
                job.status === "RUNNING" || job.status === "QUEUED"
                  ? "pulse 2s ease-in-out infinite"
                  : "none",
              boxShadow:
                job.status === "RUNNING" || job.status === "QUEUED"
                  ? "0 0 8px rgba(34,211,238,0.6)"
                  : "none",
            }}
          />
          Pipeline · Admin
        </span>
        <span style={{ color: "rgba(255,255,255,0.45)" }}>
          {collapsed ? "▸ expand" : "▾ collapse"}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ─── Current state strip ─── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
            data-testid="job-logs-current"
          >
            <Cell label="Status">
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: statusTone.bg,
                  color: statusTone.fg,
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                }}
              >
                {job.status}
              </span>
            </Cell>
            <Cell label="Stage">
              <span style={{ color: "#F0F2F8" }}>
                {job.currentStage ?? "—"}
              </span>
            </Cell>
            <Cell label="Elapsed">
              <span style={{ color: "#22D3EE" }}>
                {formatDuration(liveElapsedMs)}
              </span>
            </Cell>
            <Cell label="Cost">
              <span style={{ color: "#FBBF24" }}>{formatCost(job.costUsd)}</span>
            </Cell>
          </div>

          {shotProgress && (
            <div
              data-testid="job-logs-shot-progress"
              style={{
                padding: 10,
                borderRadius: 8,
                background: "rgba(34,211,238,0.04)",
                border: "1px solid rgba(34,211,238,0.18)",
                display: "flex",
                gap: 16,
                alignItems: "center",
                fontSize: 11,
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.6)" }}>Shots:</span>
              <span style={{ color: "#34D399" }}>
                ✓ {shotProgress.success} success
              </span>
              {shotProgress.running > 0 && (
                <span style={{ color: "#22D3EE" }}>
                  ▸ {shotProgress.running} running
                </span>
              )}
              {shotProgress.failed > 0 && (
                <span style={{ color: "#F87171" }}>
                  ✗ {shotProgress.failed} failed
                </span>
              )}
              <span style={{ color: "rgba(255,255,255,0.45)" }}>
                of {shotProgress.total}
              </span>
            </div>
          )}

          {/* ─── Force-kick admin emergency button ───
              Bypasses QStash entirely — runs the next pending shot
              synchronously so an admin can prove the post-QStash flow
              works AND immediately unstick a hung job. */}
          {showForceKick && (
            <ForceKickPanel
              inFlight={kickInFlight}
              result={kickResult}
              error={kickError}
              onClick={handleForceKick}
            />
          )}

          {/* ─── Retry compile admin button ───
              Surface when stuck in compile. Stage 4 failures (e.g. PDF
              over R2 cap, R2 creds drifted, jspdf font load) leave the
              job in RUNNING+compiling with QStash retries disabled —
              this is the manual unstick. */}
          {showRetryCompile && (
            <RetryCompilePanel
              inFlight={retryInFlight}
              result={retryResult}
              error={retryError}
              onClick={handleRetryCompile}
            />
          )}

          {/* ─── Stage timeline ─── */}
          <div
            data-testid="job-logs-stage-list"
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              Stage timeline ({stageLog.length})
            </div>
            {stageLog.length === 0 && (
              <div
                style={{
                  padding: "8px 10px",
                  color: "rgba(255,255,255,0.4)",
                  fontStyle: "italic",
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: 6,
                }}
              >
                No stages logged yet — waiting for the worker to pick up the
                job. If this stays empty for &gt; 30 s, check that QStash
                dispatched (server log will show
                <code style={{ marginLeft: 4, color: "#FBBF24" }}>
                  POST /api/brief-renders/worker
                </code>
                ).
              </div>
            )}
            {stageLog.map((entry, i) => (
              <StageLogEntryRow key={`${entry.stage}-${i}`} entry={entry} />
            ))}
          </div>

          {/* ─── Per-shot activity feed (admin-only) ─── */}
          {shots.length > 0 && (
            <div
              data-testid="job-logs-shot-activity"
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.4)",
                  marginTop: 4,
                }}
              >
                Per-shot activity ({shots.length})
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "26px 60px 1fr 90px 90px",
                  gap: 4,
                  fontSize: 11,
                }}
              >
                {shots.map((s) => (
                  <ShotActivityRow key={s.shotIndex} shot={s} />
                ))}
              </div>
            </div>
          )}

          {/* ─── Job error / footer info ─── */}
          {job.errorMessage && (
            <div
              role="alert"
              style={{
                padding: 10,
                borderRadius: 6,
                background: "rgba(248,113,113,0.06)",
                border: "1px solid rgba(248,113,113,0.3)",
                color: "#FCA5A5",
              }}
            >
              <strong>Job error:</strong> {job.errorMessage}
            </div>
          )}

          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.35)",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              paddingTop: 8,
            }}
          >
            jobId <code style={{ color: "rgba(255,255,255,0.6)" }}>{job.id}</code>
            {" · "}
            requestId{" "}
            <code style={{ color: "rgba(255,255,255,0.6)" }}>
              {job.requestId.slice(0, 16)}…
            </code>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.85); }
        }
      `}</style>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12 }}>{children}</span>
    </div>
  );
}

function StageLogEntryRow({ entry }: { entry: BriefStageLogEntry }) {
  const tone = STAGE_TONE[entry.status];
  return (
    <div
      data-testid={`stage-log-entry-${entry.stage}`}
      data-status={entry.status}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 90px 1fr 80px 70px",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        alignItems: "start",
      }}
    >
      <span style={{ color: tone.fg, fontWeight: 700 }}>{tone.icon}</span>
      <span style={{ color: "#F0F2F8" }}>
        S{entry.stage} · {entry.name}
      </span>
      <span style={{ color: "rgba(255,255,255,0.7)" }}>
        {entry.summary ?? <span style={{ opacity: 0.4 }}>—</span>}
        {entry.error && (
          <span style={{ color: "#F87171", display: "block", marginTop: 4 }}>
            error: {entry.error}
          </span>
        )}
      </span>
      <span style={{ color: "rgba(255,255,255,0.55)", textAlign: "right" }}>
        {formatTime(entry.startedAt)}
      </span>
      <span
        style={{
          color: tone.fg,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {entry.status === "running"
          ? "running…"
          : `${formatDuration(entry.durationMs)}${
              entry.costUsd && entry.costUsd > 0
                ? ` · ${formatCost(entry.costUsd)}`
                : ""
            }`}
      </span>
    </div>
  );
}

/** Re-export for convenience consumers. */
export type { BriefRenderJobView };

/**
 * One row per shot in the admin activity feed. Shows status icon,
 * shot index, label-or-prompt-preview, started/completed timestamps
 * + cost. Designed to be a dense, glanceable timeline so admins can
 * trace a stuck job to a specific shot/state without leaving the UI.
 */
function ForceKickPanel({
  inFlight,
  result,
  error,
  onClick,
}: {
  inFlight: boolean;
  result: ForceKickResponse | null;
  error: string | null;
  onClick: () => void;
}) {
  return (
    <div
      data-testid="job-logs-force-kick"
      style={{
        padding: 12,
        borderRadius: 8,
        background: "rgba(248,113,113,0.06)",
        border: "1px solid rgba(248,113,113,0.3)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={onClick}
          disabled={inFlight}
          data-testid="force-kick-button"
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            background: inFlight ? "rgba(248,113,113,0.25)" : "#dc2626",
            color: "#fff",
            border: "1px solid rgba(248,113,113,0.5)",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: inFlight ? "wait" : "pointer",
            letterSpacing: "0.3px",
            whiteSpace: "nowrap",
          }}
        >
          {inFlight ? "▸ Rendering shot…" : "▶ Force kick worker"}
        </button>
        <div
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          Worker hasn&apos;t started any shot. This bypasses QStash and
          renders the next pending shot synchronously (≈30 s). On success,
          re-enqueues via QStash for the rest.
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 6,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.4)",
            color: "#FCA5A5",
            fontSize: 11,
            wordBreak: "break-word",
          }}
        >
          <strong>Force kick failed:</strong> {error}
        </div>
      )}

      {result && (
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 11,
            color: "rgba(255,255,255,0.75)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
          data-testid="force-kick-result"
        >
          <div>
            <span style={{ color: "rgba(255,255,255,0.45)" }}>gate: </span>
            <code style={{ color: "#FBBF24" }}>{result.gate}</code>
          </div>
          {result.picked && (
            <div>
              <span style={{ color: "rgba(255,255,255,0.45)" }}>picked: </span>
              S{result.picked.apartmentIndex + 1}.
              {result.picked.shotIndexInApartment + 1} (flat #
              {result.picked.flatIndex})
            </div>
          )}
          {result.result && (
            <div>
              <span style={{ color: "rgba(255,255,255,0.45)" }}>result: </span>
              <code
                style={{
                  color:
                    result.result.status === "success"
                      ? "#34D399"
                      : result.result.status === "failed"
                        ? "#F87171"
                        : "#22D3EE",
                }}
              >
                {result.result.status}
              </code>
              {result.result.reason && (
                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                  {" "}
                  reason: {result.result.reason}
                </span>
              )}
              {result.result.kind && (
                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                  {" "}
                  kind: {result.result.kind}
                </span>
              )}
              {result.result.error && (
                <div
                  style={{
                    color: "#FCA5A5",
                    marginTop: 4,
                    wordBreak: "break-word",
                  }}
                >
                  error: {result.result.error}
                </div>
              )}
              {typeof result.result.costUsd === "number" && (
                <span style={{ color: "#FBBF24" }}>
                  {" "}
                  · cost: ${result.result.costUsd.toFixed(3)}
                </span>
              )}
            </div>
          )}
          {result.reEnqueue && result.reEnqueue.attempted && (
            <div>
              <span style={{ color: "rgba(255,255,255,0.45)" }}>
                re-enqueue:{" "}
              </span>
              <code
                style={{
                  color: result.reEnqueue.ok ? "#34D399" : "#F87171",
                }}
              >
                {result.reEnqueue.ok ? "ok" : "failed"}
              </code>
              {result.reEnqueue.messageId && (
                <span style={{ color: "rgba(255,255,255,0.5)" }}>
                  {" "}
                  · messageId: {result.reEnqueue.messageId.slice(0, 12)}…
                </span>
              )}
              {result.reEnqueue.error && (
                <div style={{ color: "#FCA5A5", marginTop: 4 }}>
                  error: {result.reEnqueue.error}
                </div>
              )}
              {result.reEnqueue.workerUrl && (
                <div
                  style={{
                    color: "rgba(255,255,255,0.4)",
                    marginTop: 2,
                    fontSize: 10,
                    wordBreak: "break-all",
                  }}
                >
                  workerUrl: {result.reEnqueue.workerUrl}
                </div>
              )}
            </div>
          )}
          {result.job?.shotCounts && (
            <div>
              <span style={{ color: "rgba(255,255,255,0.45)" }}>
                shots now:{" "}
              </span>
              {Object.entries(result.job.shotCounts).map(([k, v]) => (
                <span key={k} style={{ marginRight: 8 }}>
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RetryCompilePanel({
  inFlight,
  result,
  error,
  onClick,
}: {
  inFlight: boolean;
  result: ForceKickResponse | null;
  error: string | null;
  onClick: () => void;
}) {
  return (
    <div
      data-testid="job-logs-retry-compile"
      style={{
        padding: 12,
        borderRadius: 8,
        background: "rgba(251,191,36,0.06)",
        border: "1px solid rgba(251,191,36,0.3)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={onClick}
          disabled={inFlight}
          data-testid="retry-compile-button"
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            background: inFlight ? "rgba(251,191,36,0.25)" : "#d97706",
            color: "#fff",
            border: "1px solid rgba(251,191,36,0.5)",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: inFlight ? "wait" : "pointer",
            letterSpacing: "0.3px",
            whiteSpace: "nowrap",
          }}
        >
          {inFlight ? "▸ Compiling PDF…" : "▶ Retry compile"}
        </button>
        <div
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          PDF compile is stuck. Re-runs Stage 4 synchronously
          (≈30 s for 12 shots). On success the job flips to COMPLETED
          and the &quot;Get PDF&quot; button appears.
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 6,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.4)",
            color: "#FCA5A5",
            fontSize: 11,
            wordBreak: "break-word",
          }}
        >
          <strong>Retry compile failed:</strong> {error}
        </div>
      )}

      {result && (
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 11,
            color: "rgba(255,255,255,0.75)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
          data-testid="retry-compile-result"
        >
          <div>
            <span style={{ color: "rgba(255,255,255,0.45)" }}>gate: </span>
            <code style={{ color: "#FBBF24" }}>{result.gate}</code>
          </div>
          {result.result && (
            <div>
              <span style={{ color: "rgba(255,255,255,0.45)" }}>result: </span>
              <code
                style={{
                  color:
                    result.result.status === "success"
                      ? "#34D399"
                      : result.result.status === "failed"
                        ? "#F87171"
                        : "#22D3EE",
                }}
              >
                {result.result.status}
              </code>
              {result.result.reason && (
                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                  {" "}
                  reason: {result.result.reason}
                </span>
              )}
              {result.result.error && (
                <div
                  style={{
                    color: "#FCA5A5",
                    marginTop: 4,
                    wordBreak: "break-word",
                  }}
                >
                  error: {result.result.error}
                </div>
              )}
            </div>
          )}
          {result.job && (
            <div>
              <span style={{ color: "rgba(255,255,255,0.45)" }}>job now: </span>
              status={result.job.status} · stage={result.job.currentStage}
              {result.job.progress !== null &&
                ` · ${result.job.progress}%`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShotActivityRow({ shot }: { shot: ShotResult }) {
  const tone = SHOT_STATUS_TONE[shot.status];
  const icon =
    shot.status === "success"
      ? "✓"
      : shot.status === "failed"
        ? "✗"
        : shot.status === "running"
          ? "▸"
          : "·";
  const promptPreview = shot.prompt
    ? shot.prompt.slice(0, 80) + (shot.prompt.length > 80 ? "…" : "")
    : "";
  return (
    <>
      <span style={{ color: tone, fontWeight: 700, textAlign: "center" }}>
        {icon}
      </span>
      <span style={{ color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
        S{(shot.apartmentIndex ?? 0) + 1}.{shot.shotIndexInApartment + 1}
      </span>
      <span
        style={{
          color: "rgba(255,255,255,0.55)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={shot.prompt}
      >
        {shot.errorMessage ? (
          <span style={{ color: "#FCA5A5" }}>error: {shot.errorMessage}</span>
        ) : (
          promptPreview
        )}
      </span>
      <span style={{ color: "rgba(255,255,255,0.4)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {shot.startedAt ? formatTime(shot.startedAt) : "—"}
      </span>
      <span style={{ color: tone, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {shot.status === "running"
          ? "running…"
          : shot.completedAt
            ? formatTime(shot.completedAt)
            : shot.status === "pending"
              ? "pending"
              : "—"}
      </span>
    </>
  );
}
