/**
 * 5I PR 3 — SSE event types for drawing-processing live UI.
 *
 * Existing SSE events (do NOT touch their names or payload shapes):
 *   text_delta, tool_call_start, tool_call_result, citations,
 *   escalation, done, error
 *
 * PR 3 ADDS four new event types — every name starts with `drawing_`,
 * `artifact_`, or `classification_` so handlers can group them and
 * future PRs can pattern-match on the prefix without enumerating each
 * event individually.
 *
 *   drawing_status        — drawing lifecycle: parsing → mapping → generating → complete
 *   artifact_ready        — BOQ or Formwork JSON persisted; carries S3 key + summary
 *   artifact_failed       — BOQ or Formwork generation failed; carries error code + message
 *   classification_needed — process_drawing returned needs_classification (PR 2b's UNKNOWN-classifier path)
 *
 * Per V3 of the PR 3 prompt, `DrawingSseStatus` is wider than the DB
 * `KosDrawingStatus` enum because the DB tracks persisted state
 * (was-it-processed?) and SSE tracks live progress (what's-happening-
 * now?). The two enums are deliberately decoupled. NO Prisma migration
 * in PR 3.
 */

import type { APPLICATION_HINT_SUGGESTIONS } from "@/features/kos/lib/kos-bot-constants";

// ── Event-type discriminator strings ─────────────────────────────────────

export const SSE_EVT_DRAWING_STATUS = "drawing_status";
export const SSE_EVT_ARTIFACT_READY = "artifact_ready";
export const SSE_EVT_ARTIFACT_FAILED = "artifact_failed";
export const SSE_EVT_CLASSIFICATION_NEEDED = "classification_needed";

// ── Live status — SSE-only, NOT persisted to DB ──────────────────────────

export type DrawingSseStatus =
  | "PROCESSING_PARSE"
  | "PROCESSING_MAPPER"
  | "READY_FOR_GENERATION"
  | "GENERATING_BOQ"
  | "GENERATING_FORMWORK"
  | "COMPLETE"
  | "FAILED"
  | "NEEDS_CLASSIFICATION";

// ── Event payloads ───────────────────────────────────────────────────────

export interface DrawingStatusEvent {
  type: typeof SSE_EVT_DRAWING_STATUS;
  drawingId: string;
  status: DrawingSseStatus;
  /**
   * Optional progress descriptor — the UI may render this verbatim or
   * substitute its own label. Examples: "Parsing drawing", "Mapping
   * panels", "Generating BOQ".
   */
  message?: string;
  /** Populated on FAILED status; otherwise undefined. */
  errorCode?: string;
  errorMessage?: string;
  /** Optional summary, typically set on READY_FOR_GENERATION or COMPLETE. */
  summary?: {
    walls?: number | null;
    junctions?: number | null;
    openings?: number | null;
    titleBlockDrawingTitle?: string | null;
  };
}

export interface ArtifactReadyEvent {
  type: typeof SSE_EVT_ARTIFACT_READY;
  drawingId: string;
  kind: "boq" | "formwork";
  s3Key: string;
  /**
   * Lightweight summary for the UI tile. Keep small — the full JSON
   * lives in S3 (PR 4 wires the download).
   */
  summary: {
    // BOQ-only
    boqId?: string;
    totalStandardPanels?: number | null;
    grandTotalInrFormatted?: string | null;
    customQuotesPendingCount?: number | null;
    // Formwork-only
    formworkId?: string;
    propsCount?: number | null;
    walersCount?: number | null;
    kickersCount?: number | null;
    starterTrackMeters?: number | null;
    // Common
    warningsCount?: number;
    pendingKarthikCount?: number;
  };
}

export interface ArtifactFailedEvent {
  type: typeof SSE_EVT_ARTIFACT_FAILED;
  drawingId: string;
  kind: "boq" | "formwork";
  errorCode: string;
  errorMessage: string;
}

export interface ClassificationNeededEvent {
  type: typeof SSE_EVT_CLASSIFICATION_NEEDED;
  drawingId: string;
  message: string;
  titleBlock?: {
    drawingTitle?: string | null;
    level?: string | null;
  };
  suggestedHints: typeof APPLICATION_HINT_SUGGESTIONS;
}

// ── Union for orchestrator yield + chat-route encoder + client decoder ───

export type KosDrawingSseEvent =
  | DrawingStatusEvent
  | ArtifactReadyEvent
  | ArtifactFailedEvent
  | ClassificationNeededEvent;

/** Type guard — true for any PR 3 SSE event. */
export function isDrawingSseEvent(
  e: { type: string },
): e is KosDrawingSseEvent {
  return (
    e.type === SSE_EVT_DRAWING_STATUS ||
    e.type === SSE_EVT_ARTIFACT_READY ||
    e.type === SSE_EVT_ARTIFACT_FAILED ||
    e.type === SSE_EVT_CLASSIFICATION_NEEDED
  );
}
