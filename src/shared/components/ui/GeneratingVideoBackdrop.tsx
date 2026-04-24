"use client";

/**
 * GeneratingVideoBackdrop — looping blurred sample video behind the "Rendering
 * Walkthrough" / "Generating..." loading UI. Goal: users waiting for their
 * Kling dual video (2–8 min) don't stare at a static spinner — the blurred
 * video-motion signals "something is actively happening."
 *
 * Usage:
 *   <GeneratingVideoBackdrop> ... existing loading UI ... </GeneratingVideoBackdrop>
 *
 * Plays the R2-hosted sample video (see SAMPLE_VIDEO_SRC below) on an
 * infinite loop, blurred + darkened so it's clearly not the user's actual
 * video (no confusion), and unmounts when the caller switches back to the
 * real player.
 *
 * The video element is decorative (aria-hidden, no controls, no audio).
 * Autoplay works because it's muted + playsInline.
 */

import React, { useState } from "react";
import { useReducedMotion } from "framer-motion";

interface GeneratingVideoBackdropProps {
  children: React.ReactNode;
  /**
   * Compact mode — shorter min-height, smaller border-radius. Use in the
   * canvas node body (VideoBody) and the SegmentedVideoPlayer's canvas-
   * compact render. Default false = showcase-sized (Hero / MediaTab).
   */
  compact?: boolean;
  /** Override min-height if the surrounding layout needs a specific size. */
  minHeightPx?: number;
  /**
   * Override border-radius to match the surrounding card style. Defaults:
   * 8 in compact mode, 12 otherwise.
   */
  borderRadiusPx?: number;
}

/**
 * R2-hosted sample video URL. Demo videos are served from the R2 CDN, not
 * tracked in git (see .gitignore: `public/videos/*.mp4`). Same CDN base used
 * by dashboard/page.tsx and workflows/page.tsx.
 */
const SAMPLE_VIDEO_SRC =
  "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos/sample_video.mp4";

export function GeneratingVideoBackdrop({
  children,
  compact = false,
  minHeightPx,
  borderRadiusPx,
}: GeneratingVideoBackdropProps) {
  const resolvedMinHeight = minHeightPx ?? (compact ? 140 : 280);
  const resolvedRadius = borderRadiusPx ?? (compact ? 8 : 12);

  // Accessibility: respect the user's `prefers-reduced-motion` preference.
  // framer-motion's hook returns null before hydration and then the resolved
  // boolean. Treat null as "no preference = animate" (matches framer-motion's
  // internal default).
  const prefersReducedMotion = useReducedMotion() === true;

  // Defensive: if the R2 URL 404s or the browser rejects the codec, the <video>
  // element fires `error`. We unmount it so the dark gradient fallback remains
  // clean (no broken-video icon peeking through the blur + overlay).
  const [videoFailed, setVideoFailed] = useState<boolean>(false);

  const shouldRenderVideo = !prefersReducedMotion && !videoFailed;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: resolvedRadius,
        minHeight: resolvedMinHeight,
        // Dark fallback while the video is loading / if autoplay is blocked /
        // if the user prefers reduced motion / if R2 404s.
        background: "linear-gradient(135deg, #0a0a0f 0%, #111122 100%)",
        border: "1px solid rgba(0,245,255,0.12)",
        isolation: "isolate", // new stacking context so z-index stays local
      }}
    >
      {shouldRenderVideo && (
        <video
          src={SAMPLE_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          // Decorative — no captions, no controls, no tab-focus.
          tabIndex={-1}
          onError={() => setVideoFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // Heavy blur + darken so it reads as "ambient motion" not a usable
            // video. Scale slightly to hide the blur-edge artifacts that
            // filter: blur produces at the boundary.
            filter: "blur(22px) brightness(0.35) saturate(1.2)",
            transform: "scale(1.15)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      {/* Subtle vignette / dark overlay on top of the video for text legibility.
          The existing loader + progress UI is white/cyan on dark; this overlay
          keeps it visible even on frames where the blurred video is light. Also
          renders (marginally dimmer) when the video isn't rendered at all —
          preserves consistent look across the reduced-motion / 404 fallbacks. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at center, rgba(10,10,15,0.25) 0%, rgba(10,10,15,0.55) 80%, rgba(10,10,15,0.75) 100%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      <div style={{ position: "relative", zIndex: 2 }}>{children}</div>
    </div>
  );
}
