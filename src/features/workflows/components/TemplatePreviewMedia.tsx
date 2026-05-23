"use client";

import React from "react";
import { TEMPLATE_PREVIEWS } from "@/features/workflows/constants/template-previews";

interface Props {
  wfId: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  /** Rendered when TEMPLATE_PREVIEWS has no entry for `wfId`, or when the
   *  entry's `type` is "svg" (no live <svg> consumer in the new path —
   *  callers pass their existing SVG illustration here for a graceful
   *  preview-first / SVG-fallback degradation). */
  fallback?: React.ReactNode;
}

/**
 * Single render surface for template preview assets.
 *
 *   "image" → <img loading="lazy">           — bitmap thumbnail
 *   "video" → <video preload="none" muted    — hover-to-play, paused +
 *              playsInline> on hover            reset on mouse-leave so
 *                                              grids never autoplay
 *   "svg" | missing → `fallback` prop        — existing ILLUS_MAP SVG
 *
 * Performance contract (videos in a grid):
 *   - preload="none" so cards off-screen never fetch the file
 *   - no autoplay; play only on per-card hover
 *   - currentTime is reset to `start` on mouse-leave so the next hover
 *     replays from the same intro frame
 *
 * Used by:
 *   - renderLightCard / light featured card in /dashboard/templates
 *   - hero deck Illus slot (wrapped to satisfy DeckTemplate.Illus shape)
 *   - public /templates card media pane
 *
 * NOT used by DarkFeaturedTemplate — that component retains its inline
 * render path verbatim (per the wiring brief).
 */
export function TemplatePreviewMedia({
  wfId,
  alt,
  className,
  style,
  fallback,
}: Props) {
  const preview = TEMPLATE_PREVIEWS[wfId];

  if (preview?.type === "image") {
    return (
      <img
        src={preview.url}
        alt={alt}
        loading="lazy"
        className={className}
        style={style}
      />
    );
  }

  if (preview?.type === "video") {
    const startAt = preview.start;
    return (
      <video
        src={preview.url}
        muted
        playsInline
        preload="none"
        className={className}
        style={style}
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = startAt;
        }}
        onMouseEnter={(e) => {
          e.currentTarget.play().catch(() => {});
        }}
        onMouseLeave={(e) => {
          e.currentTarget.pause();
          e.currentTarget.currentTime = startAt;
        }}
      />
    );
  }

  return <>{fallback ?? null}</>;
}
