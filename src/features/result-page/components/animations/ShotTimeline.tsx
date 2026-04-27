"use client";

import { useMemo, useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { VideoInfo, VideoSegmentInfo } from "@/features/result-page/hooks/useResultPageData";

interface ShotTimelineProps {
  video: VideoInfo;
  /** Called when user clicks a different segment — parent switches the <video> src */
  onSegmentSelect?: (segment: VideoSegmentInfo, index: number) => void;
  activeSegmentIndex?: number;
}

/**
 * Clickable shot timeline — one pill per video segment.
 *
 * Segments are SEPARATE MP4 files (not concatenated), so clicking a pill
 * fires `onSegmentSelect` to switch the <video> src in the parent.
 * Segments without a URL show as "generating…" (disabled).
 */
export function ShotTimeline({ video, onSegmentSelect, activeSegmentIndex = 0 }: ShotTimelineProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  const shots = useMemo<VideoSegmentInfo[]>(() => {
    const segs = video.segments ?? [];
    if (segs.length === 0) {
      return [
        {
          videoUrl: video.videoUrl,
          downloadUrl: video.downloadUrl,
          durationSeconds: video.durationSeconds,
          label: "Walkthrough",
        },
      ];
    }
    return segs;
  }, [video]);

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
        const isActive = i === activeSegmentIndex;
        const isPlayable = !!shot.videoUrl;
        const isGenerating = !isPlayable && shot.durationSeconds > 0;
        return (
          <motion.button
            key={`${shot.label}-${i}`}
            type="button"
            disabled={!isPlayable}
            onClick={() => {
              if (isPlayable && onSegmentSelect) onSegmentSelect(shot, i);
            }}
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
              background: isActive ? "#7C3AED" : isGenerating ? "#F9FAFB" : "#FFFFFF",
              border: isActive ? "1px solid #7C3AED" : isGenerating ? "1px dashed rgba(0,0,0,0.12)" : "1px solid rgba(0,0,0,0.08)",
              color: isActive ? "#FFFFFF" : isGenerating ? "#9CA3AF" : "#0F172A",
              cursor: isPlayable ? "pointer" : "default",
              opacity: isPlayable || isActive ? 1 : 0.7,
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              boxShadow: isActive ? "0 2px 8px rgba(124,58,237,0.22)" : "0 1px 2px rgba(15,23,42,0.04)",
              transition: "background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
            }}
          >
            {isGenerating ? (
              <Loader2 size={10} style={{ animation: "spin 1.2s linear infinite" }} />
            ) : (
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
            )}
            <span style={{ opacity: 0.7 }}>{String(i + 1).padStart(2, "0")}</span>
            <span>{shot.label}</span>
            {isGenerating ? (
              <span style={{ opacity: 0.6 }}>· generating…</span>
            ) : (
              <span style={{ opacity: 0.7 }}>
                · {shot.durationSeconds.toFixed(1)}s
              </span>
            )}
          </motion.button>
        );
      })}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
