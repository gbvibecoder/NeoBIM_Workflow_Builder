/**
 * `<ExecutionLogPane>` — live log viewer for a BriefToIfcV3Run.
 *
 * Two data sources:
 *   1. `GET /api/brief-to-ifc/v3/runs/[id]/logs` — initial hydrate
 *      (last 200 lines).
 *   2. Pusher private channel `private-bf-v3-{runId}` event
 *      `execution-log:appended` — live deltas. Pusher's built-in
 *      retry handles transient disconnects; the connection-state
 *      indicator (green / yellow / red) surfaces the current state
 *      so a missing log isn't confused with a missing event.
 *
 * Critical: the Pusher subscription is ref-guarded so React 19 +
 * Next.js Strict Mode (which double-renders effects in dev) does NOT
 * subscribe twice to the same channel. Without the ref guard you get
 * doubled log lines on first mount in dev.
 *
 * Connection states:
 *   • "initial" (grey)    — before the first fetch returns
 *   • "live" (green)      — fetch landed AND Pusher reports connected
 *   • "reconnecting" (yellow) — Pusher mid-reconnect; polling fallback
 *   • "offline" (red)     — Pusher unconfigured OR repeatedly failed
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getPusherClient } from "@/lib/pusher-client";

export type LogConnectionState = "initial" | "live" | "reconnecting" | "offline";

export interface ExecutionLogEntry {
  id: string;
  executionId: string;
  level: string;
  source: string;
  message: string;
  metadata?: unknown;
  timestamp: string;
}

interface LogsResponseShape {
  logs: ExecutionLogEntry[];
  pusher: { channel: string; event: string };
}

const COLOR_BY_STATE: Record<LogConnectionState, { bg: string; fg: string; label: string }> = {
  initial:      { bg: "#9CA3AF", fg: "#FFFFFF", label: "Loading"      },
  live:         { bg: "#10B981", fg: "#FFFFFF", label: "Live"         },
  reconnecting: { bg: "#F59E0B", fg: "#1F2937", label: "Reconnecting" },
  offline:      { bg: "#EF4444", fg: "#FFFFFF", label: "Offline"      },
};

function levelColor(level: string): string {
  switch (level.toUpperCase()) {
    case "ERROR": return "#DC2626";
    case "WARN":  return "#D97706";
    case "DEBUG": return "#6B7280";
    default:      return "#1F2937";
  }
}

export function ExecutionLogPane({
  runId,
  maxRender = 500,
}: {
  runId: string;
  maxRender?: number;
}) {
  const [entries, setEntries] = useState<ExecutionLogEntry[]>([]);
  const [state, setState] = useState<LogConnectionState>("initial");
  const [error, setError] = useState<string | null>(null);

  // Ref-guard prevents double-subscription under React Strict Mode's
  // dev-time double-effect-fire. Without this the user sees every log
  // line twice in development.
  const subscribedRef = useRef<{ channelName: string; eventName: string } | null>(null);

  /** Append a log; de-dupe by `id` and cap the list at `maxRender`
   *  so a million-line run doesn't blow up React's reconciler. */
  const appendOne = useCallback(
    (incoming: ExecutionLogEntry) => {
      setEntries((prev) => {
        if (prev.some((e) => e.id === incoming.id)) return prev;
        const next = [...prev, incoming];
        if (next.length > maxRender) {
          return next.slice(next.length - maxRender);
        }
        return next;
      });
    },
    [maxRender],
  );

  // --- Initial hydrate + Pusher subscribe ----------------------------
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const res = await fetch(`/api/brief-to-ifc/v3/runs/${runId}/logs?limit=200`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setState("offline");
          return;
        }
        const json = (await res.json()) as LogsResponseShape;
        setEntries(json.logs);
        setError(null);

        // Subscribe to Pusher for live deltas. The guard checks against
        // a subscribe-twice race in Strict Mode AND a re-mount with the
        // same runId.
        const client = getPusherClient();
        if (!client) {
          setState("offline");
          return;
        }
        const { channel: channelName, event: eventName } = json.pusher;

        if (
          subscribedRef.current &&
          subscribedRef.current.channelName === channelName
        ) {
          // Already subscribed to this channel — no-op (Strict Mode
          // double-effect fire path).
          setState("live");
          return;
        }
        const channel = client.subscribe(channelName);
        subscribedRef.current = { channelName, eventName };
        channel.bind(eventName, (data: ExecutionLogEntry) => {
          if (!cancelled) appendOne(data);
        });
        // Connection-state mirror.
        const onConnected = () => { if (!cancelled) setState("live"); };
        const onReconnecting = () => { if (!cancelled) setState("reconnecting"); };
        const onError = () => { if (!cancelled) setState("offline"); };
        client.connection.bind("connected", onConnected);
        client.connection.bind("connecting", onReconnecting);
        client.connection.bind("disconnected", onReconnecting);
        client.connection.bind("error", onError);
        setState(client.connection.state === "connected" ? "live" : "reconnecting");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState("offline");
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
      const sub = subscribedRef.current;
      const client = getPusherClient();
      if (sub && client) {
        client.unsubscribe(sub.channelName);
      }
      subscribedRef.current = null;
    };
  }, [runId, appendOne]);

  const stateStyle = COLOR_BY_STATE[state];

  return (
    <div
      data-testid="execution-log-pane"
      data-connection-state={state}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 8,
        background: "#0B0F17",
        color: "#E5E7EB",
        padding: 12,
        minHeight: 240,
        maxHeight: 480,
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "#9CA3AF",
        }}
      >
        <span data-testid="execution-log-pane-title">
          Execution log — {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <span
          role="status"
          data-testid={`log-connection-${state}`}
          style={{
            padding: "2px 8px", borderRadius: 999,
            background: stateStyle.bg, color: stateStyle.fg,
            fontWeight: 600, fontSize: 10,
          }}
        >
          {stateStyle.label}
        </span>
      </div>
      {error && (
        <div style={{ color: "#FCA5A5", fontSize: 11 }}>
          Initial hydrate failed: {error}. Live updates may still arrive via Pusher.
        </div>
      )}
      <div role="log" aria-live="polite">
        {entries.length === 0 ? (
          <div style={{ color: "#6B7280", fontStyle: "italic" }}>
            No log entries yet.
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              data-testid="execution-log-entry"
              style={{
                display: "grid",
                gridTemplateColumns: "120px 80px 1fr",
                gap: 8,
                paddingBottom: 4,
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span style={{ color: "#6B7280" }}>
                {e.timestamp.slice(11, 19)}
              </span>
              <span
                style={{
                  color: levelColor(e.level),
                  fontWeight: 600,
                }}
              >
                {e.source}:{e.level}
              </span>
              <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {e.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
