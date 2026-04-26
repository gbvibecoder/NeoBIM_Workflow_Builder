"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import type { VideoInfo, VideoSegmentInfo } from "@/features/result-page/hooks/useResultPageData";

interface ShotTimelineProps {
  video: VideoInfo;
  videoRef: RefObject<HTMLVideoElement | null>;
}

/**
 * Phase 4.2 · Fix 3 — clickable shot timeline beneath the video player.
 *
 * Renders one pill per video segment. If the artifact has only one shot/no
 * segments, falls back to a single full-width WALKTHROUGH pill. Active
 * shot (computed from <video>.currentTime) gets a teal underline + halo
 * dot. Click a pill to seek to that timecode.
 *
 * Reduced motion: pills render fully formed; no halo / underline animation.
 */
export function ShotTimeline({ video, videoRef }: ShotTimelineProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [currentTime, setCurrentTime] = useState(0);

  // Derive ordered shots with cumulative start offsets
  const shots = useMemo<Array<VideoSegmentInfo & { start: number }>>(() => {
    const segs = video.segments ?? [];
    let cumulative = 0;
    if (segs.length === 0) {
      return [
        {
          videoUrl: video.videoUrl,
          downloadUrl: video.downloadUrl,
          durationSeconds: video.durationSeconds,
          label: "Walkthrough",
          start: 0,
        },
      ];
    }
    return segs.map(seg => {
      const out = { ...seg, start: cumulative };
      cumulative += seg.durationSeconds;
      return out;
    });
  }, [video]);

  // Listen to <video>.timeupdate to drive the active-shot highlight
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const handler = () => setCurrentTime(el.currentTime || 0);
    el.addEventListener("timeupdate", handler);
    return () => el.removeEventListener("timeupdate", handler);
  }, [videoRef]);

  const activeIdx = useMemo(() => {
    let active = 0;
    for (let i = 0; i < shots.length; i++) {
      if (currentTime >= shots[i].start) active = i;
    }
    return active;
  }, [currentTime, shots]);

  const handleSeek = (shot: { start: number }) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = shot.start;
    if (el.paused) void el.play().catch(() => {});
  };

  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 14,
      }}
    >
      {shots.map((shot, i) => {
        const isActive = i === activeIdx;
        return (
          <motion.button
            key={`${shot.label}-${i}`}
            type="button"
            onClick={() => handleSeek(shot)}
            initial={
              reduce || !inView
                ? { opacity: 1, y: 0 }
                : { opacity: 0, y: 4 }
            }
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    delay: 0.18 + i * 0.07,
                    duration: 0.35,
                    ease: [0.25, 0.46, 0.45, 0.94] as const,
                  }
            }
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              borderRadius: 9999,
              background: isActive ? "#7C3AED" : "#FFFFFF",
              border: isActive ? "1px solid #7C3AED" : "1px solid rgba(0,0,0,0.08)",
              color: isActive ? "#FFFFFF" : "#0F172A",
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              boxShadow: isActive ? "0 2px 8px rgba(124,58,237,0.22)" : "0 1px 2px rgba(15,23,42,0.04)",
              transition: "background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 9999,
                background: isActive ? "#FFFFFF" : "#7C3AED",
                flexShrink: 0,
              }}
            />
            <span style={{ opacity: 0.7 }}>{String(i + 1).padStart(2, "0")}</span>
            <span>{shot.label}</span>
            <span style={{ opacity: 0.7 }}>
              · {shot.durationSeconds.toFixed(1)}s
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
