/**
 * 5I PR 4 — Drawing artifact summary response shape.
 *
 * Returned by `GET /api/kos/customer/drawings/[id]`. Used by the
 * client-side `useDrawingArtifactHydration` hook to populate
 * `ArtifactBubble` with real download URLs after the bot has finished
 * generating BOQ + Formwork.
 *
 * Every artifact-summary field is optional/nullable so a partially-
 * processed drawing (e.g. mapper done, BOQ generation pending) still
 * yields a usable response.
 */

import type { KosDrawingStatus } from "@prisma/client";

export interface KosDrawingArtifactSummary {
  drawingId: string;
  /** Sanitized-display filename from `KosCustomerDrawing.originalFilename`. */
  filename: string;
  /** DB-side persisted status (NOT the wider SSE live status from PR 3). */
  status: KosDrawingStatus;
  /** Populated when status === "FAILED". */
  errorCode?: string | null;
  errorMessage?: string | null;

  /**
   * True iff `parseResult.kind === "mapper"` (inline) OR `"mapper_s3"`
   * (overflow to S3). Tells the UI whether BOQ/Formwork can be
   * generated yet.
   */
  hasMapper: boolean;

  /**
   * Top-level parser stats (walls / junctions / openings / title block).
   * Null when `parseResult` is null/missing OR could not be fetched.
   */
  drawingSummary?: {
    walls: number | null;
    junctions: number | null;
    openings: number | null;
    titleBlockDrawingTitle: string | null;
    drawingType: string | null;
    drawingTypeConfidence: number | null;
  } | null;

  /**
   * BOQ artifact summary + download URL. Null when:
   *   - `boqResultS3Key` is null (not generated), OR
   *   - the S3 fetch failed (graceful degradation — UI shows "BOQ unavailable")
   */
  boq?: {
    boqId: string;
    totalStandardPanels: number | null;
    grandTotalInrFormatted: string | null;
    customQuotesPendingCount: number | null;
    warningsCount: number;
    /** Same-origin path: `/api/kos/customer/drawings/<id>/boq/download`. */
    downloadUrl: string;
  } | null;

  /** Same shape as `boq` but for Formwork. */
  formwork?: {
    formworkId: string;
    propsCount: number | null;
    walersCount: number | null;
    kickersCount: number | null;
    warningsCount: number;
    /** Same-origin path: `/api/kos/customer/drawings/<id>/formwork/download`. */
    downloadUrl: string;
  } | null;
}
