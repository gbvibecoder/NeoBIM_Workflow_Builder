/**
 * Client wrapper for the v3 run page. Polls status every 5s until
 * terminal, renders the 4-state UI tree, and never sits blank — every
 * state branch is explicit.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import {
  ExecutionStatusBadge,
  type BriefToIfcV3StatusForBadge,
} from "@/components/execution/execution-status-badge";
import { ExecutionLogPane } from "@/components/execution/execution-log-pane";

interface StatusView {
  id: string;
  status: BriefToIfcV3StatusForBadge;
  ifcUrl: string | null;
  entityCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  generatorCostUsd: number;
  generatorMs: number;
  turns: number;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 5_000;

function isTerminal(s: BriefToIfcV3StatusForBadge): boolean {
  return s === "COMPLETED" || s === "FAILED" || s === "CANCELLED";
}

export function ExecutionRunRoot({ runId }: { runId: string }) {
  const [view, setView] = useState<StatusView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;

    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/brief-to-ifc/v3/runs/${runId}/status`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as StatusView;
        setView(json);
        setFetchError(null);
        if (isTerminal(json.status)) {
          stoppedRef.current = true;
        }
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : String(err));
      }
    };

    void fetchOnce();
    const interval = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(interval);
        return;
      }
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      clearInterval(interval);
    };
  }, [runId]);

  if (!view) {
    return (
      <div data-testid="execution-run-loading" style={panelStyle}>
        <div style={{ color: "#6B7280" }}>Loading run {runId}…</div>
        {fetchError && (
          <div style={{ color: "#DC2626", fontSize: 12, marginTop: 8 }}>
            {fetchError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid={`execution-run-${view.status}`} style={panelStyle}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          AI IFC run
        </h1>
        <ExecutionStatusBadge status={view.status} />
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#6B7280" }}>
          {view.id}
        </span>
      </header>

      {view.status === "PENDING" && (
        <PendingState />
      )}

      {view.status === "RUNNING" && (
        <RunningState view={view} runId={runId} />
      )}

      {view.status === "COMPLETED" && (
        <CompletedState view={view} />
      )}

      {(view.status === "FAILED" || view.status === "CANCELLED") && (
        <FailedState view={view} runId={runId} />
      )}
    </div>
  );
}

// --- State branches --------------------------------------------------

function PendingState() {
  return (
    <div data-testid="state-pending" style={blockStyle}>
      <p style={{ margin: 0, color: "#374151" }}>
        Queued. The background runner is about to claim this run. If it stays
        queued for more than a minute, check the diagnostic CLI.
      </p>
    </div>
  );
}

function RunningState({ view, runId }: { view: StatusView; runId: string }) {
  const heartbeatAge = view.lastHeartbeatAt
    ? Math.max(0, Date.now() - new Date(view.lastHeartbeatAt).getTime())
    : null;
  const heartbeatHealthy = heartbeatAge !== null && heartbeatAge < 30_000;
  return (
    <div data-testid="state-running" style={blockStyle}>
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#374151" }}>
        <span>Turns: <strong>{view.turns}</strong></span>
        <span>Cost so far: <strong>${view.generatorCostUsd.toFixed(4)}</strong></span>
        <span
          data-testid="heartbeat-indicator"
          style={{ color: heartbeatHealthy ? "#065F46" : "#92400E" }}
        >
          Heartbeat: {heartbeatAge === null ? "never" : `${(heartbeatAge / 1000).toFixed(0)}s ago`}
        </span>
      </div>
      <ExecutionLogPane runId={runId} />
    </div>
  );
}

function CompletedState({ view }: { view: StatusView }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!view.ifcUrl) return;
    try {
      await navigator.clipboard.writeText(view.ifcUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Older browsers / non-secure context — fallback: select-friendly anchor.
    }
  };
  return (
    <div data-testid="state-completed" style={blockStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 14, color: "#065F46" }}>
          IFC generated. <strong>{view.entityCount ?? 0}</strong> entities,
          {" "}{view.turns} agent turns, ${view.generatorCostUsd.toFixed(4)} spent.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {view.ifcUrl && (
            <a
              href={view.ifcUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="ifc-download-link"
              style={primaryButtonStyle}
            >
              Download IFC
            </a>
          )}
          {view.ifcUrl && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              data-testid="copy-share-link"
              style={secondaryButtonStyle}
            >
              {copied ? "Link copied ✓" : "Copy share link"}
            </button>
          )}
          {view.ifcUrl && (
            <a
              href={`/dashboard/ifc-viewer?url=${encodeURIComponent(view.ifcUrl)}`}
              data-testid="open-viewer-link"
              style={secondaryButtonStyle}
            >
              Open in viewer
            </a>
          )}
          <a
            href="/dashboard/brief-to-ifc/v3/new"
            data-testid="try-another-link"
            style={secondaryButtonStyle}
          >
            Try another brief
          </a>
        </div>
      </div>
    </div>
  );
}

function FailedState({ view, runId }: { view: StatusView; runId: string }) {
  const [logExpanded, setLogExpanded] = useState(false);
  // Bug-report link pre-fills mail body with runId + errorCode so it's
  // immediately actionable.
  const bugBody = encodeURIComponent(
    [
      `Run ID: ${view.id}`,
      `Status: ${view.status}`,
      `Error code: ${view.errorCode ?? "UNKNOWN"}`,
      `Error message: ${view.errorMessage ?? "(none)"}`,
      `Cost incurred: $${view.generatorCostUsd.toFixed(4)}`,
      `Turns: ${view.turns}`,
      "",
      "What happened (please add):",
      "",
    ].join("\n"),
  );
  const bugSubject = encodeURIComponent(
    `[AI IFC v3] Run ${view.id} failed: ${view.errorCode ?? "UNKNOWN"}`,
  );
  return (
    <div data-testid="state-failed" style={blockStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          data-testid="error-summary"
          style={{
            border: "1px solid #FECACA",
            background: "#FEF2F2",
            borderRadius: 6,
            padding: 12,
            color: "#7F1D1D",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {view.errorCode ?? "UNKNOWN"}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {view.errorMessage ?? "No detail available."}
          </div>
          <div style={{ fontSize: 11, marginTop: 8, color: "#991B1B" }}>
            Cost incurred: ${view.generatorCostUsd.toFixed(4)} · Turns: {view.turns}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a
            href="/dashboard/brief-to-ifc/v3/new"
            data-testid="try-different-brief"
            style={primaryButtonStyle}
          >
            Try a different brief
          </a>
          <a
            href={`mailto:vibecoders786@gmail.com?subject=${bugSubject}&body=${bugBody}`}
            data-testid="report-bug-link"
            style={secondaryButtonStyle}
          >
            Report this bug
          </a>
          <button
            type="button"
            onClick={() => setLogExpanded((v) => !v)}
            data-testid="toggle-log"
            style={secondaryButtonStyle}
          >
            {logExpanded ? "Hide" : "Show"} log
          </button>
        </div>
        {logExpanded && <ExecutionLogPane runId={runId} />}
      </div>
    </div>
  );
}

// --- Styles ----------------------------------------------------------

const panelStyle = {
  padding: 24,
  maxWidth: 960,
  margin: "0 auto",
  fontFamily: "system-ui, -apple-system, sans-serif",
} as const;

const blockStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  marginTop: 16,
};

const primaryButtonStyle = {
  padding: "8px 16px",
  background: "#065F46",
  color: "#FFFFFF",
  borderRadius: 6,
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
  display: "inline-block",
} as const;

const secondaryButtonStyle = {
  padding: "8px 14px",
  background: "#FFFFFF",
  color: "#374151",
  borderRadius: 6,
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid #D1D5DB",
  cursor: "pointer",
  display: "inline-block",
} as const;
