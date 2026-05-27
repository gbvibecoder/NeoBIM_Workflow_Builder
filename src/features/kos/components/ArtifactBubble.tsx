"use client";

/**
 * 5I PR 3 — ArtifactBubble.
 *
 * Inline chat tile that updates live as the bot processes a customer-
 * uploaded drawing. Renders the current SSE-driven state — spinner +
 * progress label during processing, summary tiles + (stub) Download
 * buttons when artifacts are ready.
 *
 * Fully prop-driven. The reducer in ChatSurface is the source of
 * truth; this component holds zero internal state.
 *
 * Styling mirrors AttachmentBubble (PR 1): inline `style={{...}}`
 * objects + the existing KOS_STYLES keyframes injected via <KosStyles />
 * (PR 3 adds a new `kos-spinner` keyframe; see ChatSurface.tsx).
 *
 * Accessibility: outer container is `role="region"` with an
 * aria-label; failures use `role="alert"`; spinners are
 * `aria-hidden="true"` with adjacent visible status text.
 *
 * Download button is a STUB in PR 3. PR 4 wires real download routes.
 */

import React from "react";

import type {
  ArtifactReadyEvent,
  DrawingSseStatus,
  DrawingStatusEvent,
} from "@/features/kos/lib/kos-sse-events";

const GOLD = "var(--kos-secondary, #c9a55a)";

// ── State the ChatSurface reducer hands to this component ─────────────

export interface ArtifactBubbleState {
  drawingId: string;
  filename: string;
  status: DrawingSseStatus;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  summary?: DrawingStatusEvent["summary"];
  boq?: { s3Key: string; summary: ArtifactReadyEvent["summary"] };
  formwork?: { s3Key: string; summary: ArtifactReadyEvent["summary"] };
  boqError?: { errorCode: string; errorMessage: string };
  formworkError?: { errorCode: string; errorMessage: string };
  /** 5I PR 4 — real download URL once the summary endpoint hydrates. */
  boqDownloadUrl?: string;
  /** 5I PR 4 — real download URL once the summary endpoint hydrates. */
  formworkDownloadUrl?: string;
}

export interface ArtifactBubbleProps {
  state: ArtifactBubbleState;
  /**
   * 5I PR 3 stub callback. Still accepted for back-compat — if a real
   * download URL is also passed, the URL wins and this is unused.
   */
  onDownloadStub?: (kind: "boq" | "formwork", drawingId: string) => void;
  /**
   * 5I PR 4 — real Excel download URL. When set, the BOQ tile renders
   * an `<a href download>` anchor instead of the stub button.
   */
  boqDownloadUrl?: string;
  /**
   * 5I PR 4 — real PDF download URL. When set, the Formwork tile
   * renders an anchor.
   */
  formworkDownloadUrl?: string;
}

// ── Status copy ────────────────────────────────────────────────────────

const STATUS_LABEL: Record<DrawingSseStatus, string> = {
  PROCESSING_PARSE: "Parsing…",
  PROCESSING_MAPPER: "Mapping panels…",
  READY_FOR_GENERATION: "Ready — generating…",
  GENERATING_BOQ: "Generating BOQ…",
  GENERATING_FORMWORK: "Generating Formwork…",
  COMPLETE: "Complete",
  FAILED: "Failed",
  NEEDS_CLASSIFICATION: "Needs input",
};

function isSpinningStatus(s: DrawingSseStatus): boolean {
  return (
    s === "PROCESSING_PARSE" ||
    s === "PROCESSING_MAPPER" ||
    s === "READY_FOR_GENERATION" ||
    s === "GENERATING_BOQ" ||
    s === "GENERATING_FORMWORK"
  );
}

function statusBadgeColor(s: DrawingSseStatus): {
  bg: string;
  fg: string;
  border: string;
} {
  if (s === "FAILED") {
    return {
      bg: "rgba(220,38,38,0.16)",
      fg: "#fca5a5",
      border: "rgba(220,38,38,0.4)",
    };
  }
  if (s === "COMPLETE") {
    return {
      bg: "rgba(34,197,94,0.16)",
      fg: "#86efac",
      border: "rgba(34,197,94,0.4)",
    };
  }
  if (s === "NEEDS_CLASSIFICATION") {
    return {
      bg: "rgba(245,158,11,0.16)",
      fg: "#fcd34d",
      border: "rgba(245,158,11,0.4)",
    };
  }
  return {
    bg: "rgba(201,165,90,0.16)",
    fg: GOLD,
    border: "rgba(201,165,90,0.4)",
  };
}

// ── Sub-components ─────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="kos-spinner"
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.18)",
        borderTopColor: GOLD,
        animation: "kos-spin 0.9s linear infinite",
        verticalAlign: "middle",
      }}
      data-testid="kos-artifact-spinner"
      title={label}
    />
  );
}

function StatusBadge({ status }: { status: DrawingSseStatus }) {
  const c = statusBadgeColor(status);
  return (
    <span
      data-testid="kos-artifact-status-badge"
      data-status={status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {isSpinningStatus(status) && <Spinner label={STATUS_LABEL[status]} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function ArtifactTile({
  label,
  kind,
  drawingId,
  data,
  error,
  downloadUrl,
  onDownloadStub,
}: {
  label: string;
  kind: "boq" | "formwork";
  drawingId: string;
  data?: { summary: ArtifactReadyEvent["summary"] };
  error?: { errorCode: string; errorMessage: string };
  /** 5I PR 4 — when set, render `<a href download>` instead of the stub button. */
  downloadUrl?: string;
  onDownloadStub?: (kind: "boq" | "formwork", drawingId: string) => void;
}) {
  if (error) {
    return (
      <div
        role="alert"
        data-testid={`kos-artifact-tile-${kind}`}
        data-state="failed"
        style={{
          marginTop: 8,
          padding: 8,
          background: "rgba(220,38,38,0.08)",
          border: "1px solid rgba(220,38,38,0.4)",
          borderRadius: 6,
          color: "#fca5a5",
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        <strong style={{ display: "block", marginBottom: 2 }}>{label} failed</strong>
        {error.errorMessage}
        <span
          style={{
            display: "block",
            marginTop: 2,
            opacity: 0.6,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 10.5,
          }}
        >
          ({error.errorCode})
        </span>
      </div>
    );
  }
  const s = data?.summary ?? {};
  return (
    <div
      data-testid={`kos-artifact-tile-${kind}`}
      data-state="ready"
      style={{
        marginTop: 8,
        padding: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(201,165,90,0.25)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 12.5,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: "block", marginBottom: 4 }}>{label}</strong>
        <span style={{ color: "rgba(255,255,255,0.75)" }}>
          {kind === "boq"
            ? formatBoqSummary(s)
            : formatFormworkSummary(s)}
        </span>
      </div>
      {downloadUrl ? (
        // 5I PR 4 — real download anchor. `download` attribute hints
        // the browser; server's Content-Disposition carries the
        // actual filename so we don't need to set it here.
        <a
          href={downloadUrl}
          download
          role="button"
          aria-label={`Download ${label}`}
          data-testid={`kos-artifact-download-${kind}`}
          onClick={() => {
            // Lightweight client-side trace; no network.
            // eslint-disable-next-line no-console
            console.info(
              `[kos] download_clicked drawingId=${drawingId} kind=${kind}`,
            );
          }}
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            borderRadius: 7,
            border: "1px solid rgba(201,165,90,0.45)",
            background: "transparent",
            color: GOLD,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Download
        </a>
      ) : onDownloadStub ? (
      // 5I PR 3 stub fallback. PR 4's hydration hook supplies the URL
      // shortly after the artifact_ready event arrives — until then this
      // button keeps the customer feedback consistent.
      <button
        type="button"
        onClick={() => onDownloadStub(kind, drawingId)}
        aria-label={`Download ${label}`}
        data-testid={`kos-artifact-download-${kind}-stub`}
        style={{
          flexShrink: 0,
          padding: "6px 12px",
          borderRadius: 7,
          border: "1px solid rgba(201,165,90,0.45)",
          background: "transparent",
          color: GOLD,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Download
      </button>
      ) : (
        // No URL, no stub — show a non-interactive label so the user
        // knows the file is on its way (the URL arrives shortly after
        // the artifact_ready SSE event via the hydration hook).
        <span
          data-testid={`kos-artifact-download-${kind}-preparing`}
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            color: "rgba(255,255,255,0.5)",
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          Preparing…
        </span>
      )}
    </div>
  );
}

function formatBoqSummary(s: ArtifactReadyEvent["summary"]): string {
  const parts: string[] = [];
  if (typeof s.totalStandardPanels === "number") {
    parts.push(`${formatNumber(s.totalStandardPanels)} panels`);
  }
  if (typeof s.grandTotalInrFormatted === "string" && s.grandTotalInrFormatted) {
    parts.push(s.grandTotalInrFormatted);
  }
  if (typeof s.customQuotesPendingCount === "number" && s.customQuotesPendingCount > 0) {
    parts.push(`${s.customQuotesPendingCount} custom-quote items`);
  }
  return parts.length ? parts.join(" · ") : "Ready to download";
}

function formatFormworkSummary(s: ArtifactReadyEvent["summary"]): string {
  const parts: string[] = [];
  if (typeof s.propsCount === "number") parts.push(`${formatNumber(s.propsCount)} props`);
  if (typeof s.walersCount === "number") parts.push(`${formatNumber(s.walersCount)} walers`);
  if (typeof s.kickersCount === "number") parts.push(`${formatNumber(s.kickersCount)} kickers`);
  return parts.length ? parts.join(" · ") : "Ready to download";
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

// ── Top-level component ────────────────────────────────────────────────

export function ArtifactBubble({
  state,
  onDownloadStub,
  boqDownloadUrl,
  formworkDownloadUrl,
}: ArtifactBubbleProps) {
  // PR 4: prefer download URL passed via prop, fall back to URL on
  // state (set by the hydration hook), then to nothing.
  const effectiveBoqUrl = boqDownloadUrl ?? state.boqDownloadUrl;
  const effectiveFormworkUrl = formworkDownloadUrl ?? state.formworkDownloadUrl;
  const summary = state.summary;
  const hasSummaryStats =
    summary != null &&
    (summary.walls != null || summary.junctions != null || summary.openings != null);

  return (
    <div
      role="region"
      aria-label={`Drawing processing — ${state.filename}`}
      data-testid="kos-artifact-bubble"
      data-drawing-id={state.drawingId}
      data-status={state.status}
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 12,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        fontSize: 13,
        lineHeight: 1.4,
        color: "rgba(255,255,255,0.92)",
        maxWidth: "100%",
      }}
    >
      {/* Header row: drawing icon + filename + status badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>
          📐
        </span>
        <strong
          title={state.filename}
          style={{
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {state.filename}
        </strong>
        <StatusBadge status={state.status} />
      </div>

      {/* Failure banner */}
      {state.status === "FAILED" && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: 8,
            background: "rgba(220,38,38,0.12)",
            border: "1px solid rgba(220,53,69,0.4)",
            borderRadius: 6,
            color: "#fca5a5",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {state.errorMessage ?? "Drawing processing failed."}
          {state.errorCode && (
            <span
              style={{
                marginLeft: 6,
                opacity: 0.6,
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 10.5,
              }}
            >
              ({state.errorCode})
            </span>
          )}
        </div>
      )}

      {/* Needs-classification prompt */}
      {state.status === "NEEDS_CLASSIFICATION" && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.3)",
            borderRadius: 6,
            color: "rgba(255,255,255,0.85)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          Reply with the drawing type to continue (the assistant has
          listed the options above).
        </div>
      )}

      {/* Walls / junctions / openings summary line */}
      {hasSummaryStats && summary && (
        <div
          style={{
            marginTop: 8,
            color: "rgba(255,255,255,0.75)",
            fontSize: 12.5,
          }}
        >
          Found{" "}
          {summary.walls != null && <strong>{summary.walls} walls</strong>}
          {summary.junctions != null && (
            <>
              {summary.walls != null ? ", " : ""}
              <strong>{summary.junctions} junctions</strong>
            </>
          )}
          {summary.openings != null && summary.openings > 0 && (
            <>
              , <strong>{summary.openings} openings</strong>
            </>
          )}
        </div>
      )}

      {/* BOQ tile */}
      {(state.boq || state.boqError) && (
        <ArtifactTile
          label="Bill of Quantities"
          kind="boq"
          drawingId={state.drawingId}
          data={state.boq}
          error={state.boqError}
          downloadUrl={effectiveBoqUrl}
          onDownloadStub={onDownloadStub}
        />
      )}

      {/* Formwork tile */}
      {(state.formwork || state.formworkError) && (
        <ArtifactTile
          label="Formwork Quantities"
          kind="formwork"
          drawingId={state.drawingId}
          data={state.formwork}
          error={state.formworkError}
          downloadUrl={effectiveFormworkUrl}
          onDownloadStub={onDownloadStub}
        />
      )}
    </div>
  );
}
