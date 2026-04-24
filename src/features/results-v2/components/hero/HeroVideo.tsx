"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Film, Maximize2 } from "lucide-react";
import { NEUTRAL, MOTION, HERO_HEIGHT } from "@/features/results-v2/constants";
import type { AccentGradient, ResultVideo } from "@/features/results-v2/types";
import { accentLinearGradient } from "@/features/results-v2/lib/workflow-accent";
import { ShotChip } from "@/features/results-v2/components/primitives/ShotChip";
import { VideoControls } from "@/features/results-v2/components/controls/VideoControls";
import { HeroSkeleton } from "@/features/results-v2/components/hero/HeroSkeleton";
import { useDominantColor } from "@/features/results-v2/hooks/useDominantColor";

interface HeroVideoProps {
  video: ResultVideo;
  accent: AccentGradient;
  workflowName: string;
}

/**
 * Full-bleed cinematic video hero.
 *
 * Phase D upgrades over Phase C:
 *   - **Ambient color signature**: dominant color sampled once from the
 *     video's first frame and painted as a breathing 20vw radial behind
 *     the hero at 8-10% opacity.
 *   - **Chromatic aberration flash**: 120ms 2-px RGB split on first
 *     `onLoadedData`. Exactly one frame of cinema. Never runs again.
 *   - **Inner accent glow**: 1px inset accent ring at 22% — the video
 *     container stops looking like a flat rectangle.
 *   - **Corner Maximize button**: second fullscreen lever top-right, in
 *     addition to the one inside `VideoControls` — matches Vercel's
 *     lock-corner affordance.
 *   - **Active shot chip**: upgraded `ShotChip` with clip-path sweep +
 *     inner edge highlight when active.
 */
export function HeroVideo({ video, accent, workflowName }: HeroVideoProps) {
  const reducedMotion = useReducedMotion();
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [aberrating, setAberrating] = useState(false);
  const [segmentIdx, setSegmentIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasSegments = (video.segments?.length ?? 0) > 1;
  const segments = video.segments ?? [];
  const currentUrl = hasSegments ? segments[segmentIdx]?.videoUrl : video.videoUrl;

  const dominantColor = useDominantColor(currentUrl ?? null);
  const glow = dominantColor ?? accent.start;

  const shotChips = hasSegments
    ? segments.map(s => ({ label: s.label.toUpperCase(), duration: s.durationSeconds }))
    : [{ label: `${video.shotCount} CINEMATIC SHOTS`, duration: video.durationSeconds }];

  const aberrateHandleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!videoEl) return;
    const triggerAberration = () => {
      setLoaded(true);
      if (reducedMotion) return;
      setAberrating(true);
      if (aberrateHandleRef.current != null) window.clearTimeout(aberrateHandleRef.current);
      aberrateHandleRef.current = window.setTimeout(
        () => setAberrating(false),
        MOTION.chromatic.durationMs,
      );
    };
    videoEl.addEventListener("loadeddata", triggerAberration);
    if (videoEl.readyState >= 2) {
      queueMicrotask(triggerAberration);
    }
    return () => {
      videoEl.removeEventListener("loadeddata", triggerAberration);
      if (aberrateHandleRef.current != null) window.clearTimeout(aberrateHandleRef.current);
    };
  }, [videoEl, reducedMotion]);

  const handleVideoEnded = () => {
    if (hasSegments && segmentIdx < segments.length - 1) {
      setSegmentIdx(i => i + 1);
    } else if (hasSegments) {
      setSegmentIdx(0);
    }
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void containerRef.current.requestFullscreen().catch(() => undefined);
    }
  };

  if (!currentUrl) {
    return (
      <HeroSkeleton
        accent={accent}
        workflowName={workflowName}
        copy="Rendering cinematic walkthrough"
        progress={video.progress}
      />
    );
  }

  return (
    <motion.section
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION.heroReveal.duration, ease: MOTION.heroReveal.ease }}
      aria-label={`${workflowName} — cinematic walkthrough`}
      className="results-v2-hero results-v2-hero-video"
      style={{
        position: "relative",
        width: "100%",
        minHeight: HERO_HEIGHT.desktop,
        background: NEUTRAL.BG_BASE,
        overflow: "hidden",
      }}
    >
      {/* Ambient glow — dominant-color breathing radial behind the hero. */}
      <motion.div
        aria-hidden
        animate={reducedMotion ? { opacity: 0.06 } : { opacity: [0.06, 0.1, 0.06] }}
        transition={reducedMotion ? undefined : { duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: "-20%",
          background: `radial-gradient(55% 55% at 50% 50%, ${glow}, transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      <motion.video
        key={currentUrl}
        ref={setVideoEl}
        autoPlay
        muted
        loop={!hasSegments}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        src={currentUrl}
        onEnded={handleVideoEnded}
        initial={reducedMotion ? { filter: "blur(0px)" } : { filter: "blur(18px)", opacity: 0.55 }}
        animate={
          loaded || reducedMotion
            ? {
                filter: aberrating ? "blur(0px) saturate(1.08)" : "blur(0px) saturate(1)",
                opacity: 1,
              }
            : { filter: "blur(18px)", opacity: 0.55 }
        }
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          inset: 0,
          objectFit: "cover",
          display: "block",
        }}
      />

      {/* Chromatic aberration flash — 120ms RGB split on first frame. */}
      {aberrating && !reducedMotion ? (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(40% 40% at 50% 50%, rgba(255,40,60,0.22), transparent 70%)`,
              mixBlendMode: "screen",
              transform: "translate3d(2px, 0, 0)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(40% 40% at 50% 50%, rgba(40,180,255,0.22), transparent 70%)`,
              mixBlendMode: "screen",
              transform: "translate3d(-2px, 0, 0)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}

      {/* Accent vignette — ~35% opacity. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, ${accentLinearGradient(accent, 0.35)} 0%, transparent 55%)`,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      {/* Darker base vignette for text contrast. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 45%)",
          pointerEvents: "none",
        }}
      />

      {/* Inner accent glow — 1px inset ring at 22%. Subtle premium feel. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: `inset 0 0 0 1px ${glow}38, inset 0 0 60px ${glow}1a`,
          pointerEvents: "none",
        }}
      />

      {/* Corner Maximize button — second fullscreen lever. */}
      <button
        type="button"
        onClick={handleFullscreen}
        aria-label="Fullscreen"
        style={{
          position: "absolute",
          top: "clamp(14px, 2.4vw, 22px)",
          right: "clamp(14px, 2.4vw, 22px)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          color: NEUTRAL.TEXT_PRIMARY,
          background: "rgba(8,9,12,0.55)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
          cursor: "pointer",
          transition: "border-color 160ms ease-out, background 160ms ease-out",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = glow;
          e.currentTarget.style.background = `${glow}22`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = NEUTRAL.BORDER_SUBTLE;
          e.currentTarget.style.background = "rgba(8,9,12,0.55)";
        }}
      >
        <Maximize2 size={14} />
      </button>

      {/* Caption + shot chips */}
      <div
        style={{
          position: "absolute",
          left: "clamp(20px, 4vw, 48px)",
          right: "clamp(20px, 4vw, 48px)",
          bottom: "clamp(20px, 4vw, 40px)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "60%" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: NEUTRAL.TEXT_SECONDARY,
              fontVariantCaps: "all-small-caps",
            }}
          >
            <Film size={12} aria-hidden /> Cinematic Walkthrough
          </span>
          <motion.h1
            initial={{ fontWeight: 500 }}
            animate={{ fontWeight: 600 }}
            transition={{ duration: 0.6, ease: MOTION.heroReveal.ease, delay: 0.15 }}
            style={{
              margin: 0,
              fontSize: "clamp(22px, 2.4vw, 36px)",
              letterSpacing: "-0.02em",
              color: NEUTRAL.TEXT_PRIMARY,
              lineHeight: 1.2,
              fontVariationSettings: '"wght" 600',
            }}
          >
            {workflowName}
          </motion.h1>
          <span
            style={{
              fontSize: 12,
              color: NEUTRAL.TEXT_SECONDARY,
              fontFamily: "var(--font-jetbrains), monospace",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {video.durationSeconds}s · {hasSegments ? `${segments.length} segments` : `${video.shotCount} shots`}
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
          {shotChips.map((chip, idx) => (
            <ShotChip
              key={`${chip.label}-${idx}`}
              label={chip.label}
              durationSeconds={chip.duration}
              active={hasSegments ? idx === segmentIdx : false}
              accentColor={glow}
              onClick={hasSegments ? () => setSegmentIdx(idx) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Controls overlay — top-right (below the corner fullscreen). */}
      <div
        style={{
          position: "absolute",
          top: "clamp(62px, 7vw, 78px)",
          right: "clamp(16px, 3vw, 28px)",
          maxWidth: "min(620px, calc(100% - 40px))",
        }}
      >
        <VideoControls
          videoEl={videoEl}
          downloadUrl={video.downloadUrl}
          accentColor={glow}
          onFullscreen={handleFullscreen}
        />
      </div>

      <style>{`
        .results-v2-hero {
          min-height: ${HERO_HEIGHT.desktop};
        }
        @media (max-width: 1279px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.tablet}; }
        }
        @media (max-width: 767px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.mobile}; }
        }
      `}</style>
    </motion.section>
  );
}
