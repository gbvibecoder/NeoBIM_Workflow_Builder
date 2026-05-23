"use client";

import React, { useEffect, useRef } from "react";
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
 *   "video" → <video autoPlay loop muted     — continuous background
 *              playsInline> with an              loop; cards never
 *              IntersectionObserver hook         appear blank between
 *                                                hovers. Observer
 *                                                pauses videos that
 *                                                scroll off-screen so
 *                                                only what's actually
 *                                                visible is decoding.
 *   "svg" | missing → `fallback` prop        — existing ILLUS_MAP SVG
 *
 * Performance contract (videos):
 *   - muted + playsInline + autoPlay = the standard "background video"
 *     pattern that browsers allow without a user gesture.
 *   - preload="metadata" loads enough to paint the first frame; the
 *     full file streams in as the video plays.
 *   - IntersectionObserver pauses each <video> while it's scrolled
 *     off-screen and resumes it when it scrolls back, capping
 *     concurrent decoder count to whatever's in the viewport.
 *   - prefers-reduced-motion is honoured: those displays show the
 *     first frame and never auto-play.
 *   - loop=true repeats the file end-to-end. For templates whose
 *     `start` offset is non-zero (only wf-06 today, with start: 2),
 *     the loop restarts from 0 rather than from `start` — accepted
 *     trade-off, since the alternative is a custom onEnded handler.
 *
 * Used by:
 *   - renderLightCard / light featured card in /dashboard/templates
 *   - hero deck Illus slot (wrapped to satisfy DeckTemplate.Illus shape)
 *   - public /templates card media pane
 *   - DarkFeaturedTemplate (replaces its prior inline IIFE — single
 *     source of preview behaviour across light and dark themes)
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
    return (
      <PreviewVideo
        src={preview.url}
        startAt={preview.start}
        alt={alt}
        className={className}
        style={style}
      />
    );
  }

  return <>{fallback ?? null}</>;
}

/**
 * Internal helper. One <video> element with autoplay, looped playback,
 * IntersectionObserver-driven play/pause for off-screen efficiency,
 * and a prefers-reduced-motion escape hatch. Kept private to the
 * module — every consumer goes through TemplatePreviewMedia.
 */
function PreviewVideo({
  src,
  startAt,
  alt,
  className,
  style,
}: {
  src: string;
  startAt: number;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reduced-motion users: hold the first frame, never auto-play.
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      video.pause();
      if (Number.isFinite(video.duration)) {
        video.currentTime = startAt;
      }
      return;
    }

    // Pause off-screen, resume on re-entry. threshold:0 means "any
    // overlap with the viewport", which is correct for card grids
    // where only a sliver visible is still worth showing.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          // .play() returns a Promise that rejects if autoplay is
          // blocked (data-saver mode, low-power mode, browser policy).
          // We swallow the rejection so the first frame still paints.
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0 },
    );
    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, [startAt]);

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      loop
      autoPlay
      preload="metadata"
      aria-label={alt}
      className={className}
      style={style}
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = startAt;
      }}
    />
  );
}
