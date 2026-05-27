"use client";

/**
 * 5I PR 4 — useDrawingArtifactHydration
 *
 * For every UIMessage with `attachmentRefs`, fetch the corresponding
 * `GET /api/kos/customer/drawings/[id]` summary endpoint and merge
 * the result into the ChatSurface's `drawingArtifacts` state so each
 * `ArtifactBubble` gets real download URLs.
 *
 * Design notes:
 *  - Fires on every `messages` change but de-dups via `hydratedIdsRef`
 *    so a single drawingId is fetched at most once per mount.
 *  - SSE state wins: if the bubble is already `COMPLETE` from live
 *    events, hydration merges download URLs but does NOT regress the
 *    status to e.g. PARSED.
 *  - Concurrency capped at HYDRATION_CONCURRENCY to be polite under
 *    a heavy reload (e.g. user pasted many drawingIds).
 *  - Cancellation: an in-flight fetch that completes after the hook
 *    is torn down does NOT push into the setter (closure flag).
 *
 * SCOPE NOTE: ChatSurface has no conversation-load mechanism today
 * (V9 in PR 4's V_RESULT). This hook activates DURING the live
 * session, providing download URLs once SSE has marked an artifact
 * `_ready`. Reload-hydration of past turns requires an upstream
 * message-load endpoint that does not yet exist; deferred to a
 * future slice.
 */

import { useEffect, useRef } from "react";

import type { UIMessage } from "@/features/kos/types/chat";
import type { KosDrawingArtifactSummary } from "@/features/kos/types/drawing-summary";
import type { ArtifactBubbleState } from "@/features/kos/components/ArtifactBubble";

/** Max parallel in-flight summary fetches. */
const HYDRATION_CONCURRENCY = 5;

type DrawingArtifactsSetter = (
  updater: (
    prev: Record<string, ArtifactBubbleState>,
  ) => Record<string, ArtifactBubbleState>,
) => void;

interface HydrationOptions {
  /** Override for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function useDrawingArtifactHydration(
  messages: UIMessage[],
  setDrawingArtifacts: DrawingArtifactsSetter,
  options: HydrationOptions = {},
): void {
  const hydratedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const f = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
    if (!f) return;

    // Collect unique drawing IDs from customer messages.
    const drawingIds = new Set<string>();
    for (const m of messages) {
      if (m.role !== "customer") continue;
      if (!m.attachmentRefs) continue;
      for (const ref of m.attachmentRefs) {
        if (typeof ref === "string" && ref.length > 0) drawingIds.add(ref);
      }
    }

    const toHydrate = Array.from(drawingIds).filter(
      (id) => !hydratedIdsRef.current.has(id),
    );
    if (toHydrate.length === 0) return;

    let cancelled = false;

    void (async () => {
      // Concurrency-capped sequential chunks.
      for (let i = 0; i < toHydrate.length; i += HYDRATION_CONCURRENCY) {
        if (cancelled) return;
        const chunk = toHydrate.slice(i, i + HYDRATION_CONCURRENCY);
        await Promise.all(
          chunk.map(async (id) => {
            try {
              const res = await f(
                `/api/kos/customer/drawings/${encodeURIComponent(id)}`,
                { credentials: "include" },
              );
              if (cancelled) return;

              // Whether success or 404, mark as hydrated so we don't
              // retry on subsequent re-renders within this mount.
              hydratedIdsRef.current.add(id);

              if (!res.ok) {
                // 404 (cross-customer / not-found) → no bubble; SSE
                // will populate it if the customer actually owns it.
                console.warn(
                  `[kos] artifact hydration: HTTP ${res.status} for drawingId=${id}`,
                );
                return;
              }

              const summary = (await res.json()) as KosDrawingArtifactSummary;
              if (cancelled) return;

              setDrawingArtifacts((prev) => {
                const existing = prev[id];

                // SSE-fresh state wins: if the bubble is already
                // COMPLETE we only merge download URLs (which the SSE
                // path doesn't carry today), never demote status.
                const nextStatus = existing?.status ?? deriveStatus(summary);
                const merged: ArtifactBubbleState = {
                  drawingId: summary.drawingId,
                  filename: summary.filename,
                  status: nextStatus,
                  message: existing?.message,
                  errorCode: existing?.errorCode ?? summary.errorCode ?? undefined,
                  errorMessage:
                    existing?.errorMessage ?? summary.errorMessage ?? undefined,
                  summary: existing?.summary ?? mapToBubbleSummary(summary.drawingSummary ?? undefined),
                  boq: existing?.boq ?? mapBoq(summary.boq ?? undefined),
                  formwork: existing?.formwork ?? mapFormwork(summary.formwork ?? undefined),
                  boqDownloadUrl: summary.boq?.downloadUrl ?? existing?.boqDownloadUrl,
                  formworkDownloadUrl:
                    summary.formwork?.downloadUrl ?? existing?.formworkDownloadUrl,
                  boqError: existing?.boqError,
                  formworkError: existing?.formworkError,
                };
                return { ...prev, [id]: merged };
              });
            } catch (err) {
              hydratedIdsRef.current.add(id);
              console.warn(
                `[kos] artifact hydration failed for drawingId=${id}`,
                err,
              );
            }
          }),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, setDrawingArtifacts, options.fetchImpl]);
}

// ── Mappers ────────────────────────────────────────────────────────────

function deriveStatus(summary: KosDrawingArtifactSummary): ArtifactBubbleState["status"] {
  if (summary.status === "FAILED") return "FAILED";
  if (summary.boq && summary.formwork) return "COMPLETE";
  if (summary.status === "PARSED") return summary.hasMapper ? "READY_FOR_GENERATION" : "NEEDS_CLASSIFICATION";
  if (summary.status === "PARSING") return "PROCESSING_PARSE";
  if (summary.status === "UPLOADED") return "PROCESSING_PARSE";
  if (summary.status === "AWAITING_UPLOAD") return "PROCESSING_PARSE";
  return "PROCESSING_PARSE";
}

function mapToBubbleSummary(
  s: KosDrawingArtifactSummary["drawingSummary"] | undefined,
): ArtifactBubbleState["summary"] {
  if (!s) return undefined;
  return {
    walls: s.walls,
    junctions: s.junctions,
    openings: s.openings,
    titleBlockDrawingTitle: s.titleBlockDrawingTitle,
  };
}

function mapBoq(
  s: KosDrawingArtifactSummary["boq"] | undefined,
): ArtifactBubbleState["boq"] {
  if (!s) return undefined;
  return {
    s3Key: s.downloadUrl, // Bubble doesn't render the S3 key directly; reuse field
    summary: {
      boqId: s.boqId,
      totalStandardPanels: s.totalStandardPanels,
      grandTotalInrFormatted: s.grandTotalInrFormatted,
      customQuotesPendingCount: s.customQuotesPendingCount,
      warningsCount: s.warningsCount,
    },
  };
}

function mapFormwork(
  s: KosDrawingArtifactSummary["formwork"] | undefined,
): ArtifactBubbleState["formwork"] {
  if (!s) return undefined;
  return {
    s3Key: s.downloadUrl,
    summary: {
      formworkId: s.formworkId,
      propsCount: s.propsCount,
      walersCount: s.walersCount,
      kickersCount: s.kickersCount,
      warningsCount: s.warningsCount,
    },
  };
}
