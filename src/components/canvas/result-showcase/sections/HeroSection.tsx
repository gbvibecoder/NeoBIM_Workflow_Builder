"use client";

import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Maximize2, Loader2, Download, RefreshCw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useExecutionStore } from "@/stores/execution-store";
import { COLORS } from "../constants";
import type { VideoInfo } from "../useShowcaseData";

interface HeroSectionProps {
  videoData: VideoInfo | null;
  heroImageUrl: string | null;
  onExpandVideo: () => void;
  onRetryVideo?: () => void;
}

const RENDER_PHASES = ["Exterior Pull-in", "Building Orbit", "Interior Walkthrough", "Section Rise"];

export function HeroSection({ videoData, heroImageUrl, onExpandVideo, onRetryVideo }: HeroSectionProps) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);

  // Check for video generation progress
  const videoGenProgress = useExecutionStore(s => {
    if (!videoData?.nodeId) return null;
    return s.videoGenProgress.get(videoData.nodeId) ?? null;
  });

  const segments = videoData?.segments;
  const hasSegments = segments && segments.length > 1;
  const currentUrl = hasSegments ? segments[segmentIndex]?.videoUrl : videoData?.videoUrl;

  const handleVideoEnded = useCallback(() => {
    if (hasSegments && segmentIndex < segments.length - 1) {
      setSegmentIndex(prev => prev + 1);
    } else if (hasSegments) {
      setSegmentIndex(0); // loop back
    }
  }, [hasSegments, segments, segmentIndex]);

  const isGenerating = videoGenProgress && (videoGenProgress.status === "rendering" || videoGenProgress.status === "processing" || videoGenProgress.status === "submitting");
  const isFailed = videoGenProgress?.status === "failed";

  if (!videoData?.videoUrl && !heroImageUrl && !isGenerating && !isFailed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        background: "#000",
      }}
    >
      {currentUrl ? (
        <video
          ref={videoRef}
          key={currentUrl}
          autoPlay
          muted
          loop={!hasSegments}
          playsInline
          crossOrigin="anonymous"
          src={currentUrl}
          onEnded={handleVideoEnded}
          style={{
            width: "100%",
            height: "100%",
            minHeight: 280,
            maxHeight: 400,
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : isGenerating ? (
        /* ── Video Generation Progress ── */
        <div style={{
          width: "100%",
          minHeight: 280,
          maxHeight: 400,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          background: "linear-gradient(135deg, #0a0a0f 0%, #111122 100%)",
        }}>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          >
            <Loader2 size={32} style={{ color: COLORS.CYAN }} />
          </motion.div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
              Rendering Walkthrough
            </div>
            <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED }}>
              {videoGenProgress.phase ?? "Initializing"} — {Math.min(Math.max(videoGenProgress.progress ?? 0, 0), 100)}%
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            width: "70%",
            maxWidth: 320,
            height: 6,
            borderRadius: 3,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}>
            <motion.div
              initial={{ width: "0%" }}
              animate={{ width: `${Math.min(Math.max(videoGenProgress.progress ?? 0, 0), 100)}%` }}
              transition={{ duration: 0.3 }}
              style={{
                height: "100%",
                borderRadius: 3,
                background: `linear-gradient(90deg, ${COLORS.CYAN}, #00d4ff)`,
                boxShadow: `0 0 8px ${COLORS.CYAN}40`,
              }}
            />
          </div>

          {/* Phase indicators */}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {RENDER_PHASES.map((phase) => {
              const isActive = videoGenProgress.phase === phase;
              const isPast = RENDER_PHASES.indexOf(phase) < RENDER_PHASES.indexOf(videoGenProgress.phase ?? "");
              return (
                <div
                  key={phase}
                  style={{
                    fontSize: 8,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: isActive ? `${COLORS.CYAN}20` : isPast ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isActive ? `${COLORS.CYAN}40` : "rgba(255,255,255,0.06)"}`,
                    color: isActive ? COLORS.CYAN : isPast ? COLORS.TEXT_MUTED : "rgba(255,255,255,0.2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {phase}
                </div>
              );
            })}
          </div>
        </div>
      ) : isFailed ? (
        /* ── Video Generation Failed ── */
        <div style={{
          width: "100%",
          minHeight: 280,
          maxHeight: 400,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "linear-gradient(135deg, #0a0a0f 0%, #1a1111 100%)",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "rgba(255,80,80,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 18, color: "#ff5050" }}>!</span>
          </div>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#ff5050", marginBottom: 6 }}>
              Video Rendering Failed
            </div>
            <div style={{ fontSize: 11, color: COLORS.TEXT_MUTED, lineHeight: 1.5 }}>
              {videoGenProgress.failureMessage ?? "An error occurred during video rendering. Please try again."}
            </div>
          </div>
          {onRetryVideo && (
            <button
              onClick={onRetryVideo}
              style={{
                marginTop: 4, padding: "8px 20px", borderRadius: 8,
                background: "rgba(0,245,255,0.12)", border: "1px solid rgba(0,245,255,0.3)",
                color: COLORS.CYAN, fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(0,245,255,0.2)";
                e.currentTarget.style.boxShadow = "0 0 16px rgba(0,245,255,0.15)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(0,245,255,0.12)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <RefreshCw size={12} />
              Retry Video
            </button>
          )}
        </div>
      ) : heroImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroImageUrl}
          alt="Project render"
          style={{
            width: "100%",
            height: "100%",
            minHeight: 240,
            maxHeight: 360,
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : null}

      {/* Segment indicator */}
      {hasSegments && (
        <div style={{
          position: "absolute", top: 12, left: 12,
          display: "flex", gap: 4,
        }}>
          {segments.map((seg, i) => (
            <button
              key={i}
              onClick={() => setSegmentIndex(i)}
              style={{
                padding: "3px 8px", borderRadius: 4,
                background: i === segmentIndex ? "rgba(0,245,255,0.2)" : "rgba(0,0,0,0.6)",
                border: `1px solid ${i === segmentIndex ? "rgba(0,245,255,0.4)" : "rgba(255,255,255,0.1)"}`,
                color: i === segmentIndex ? COLORS.CYAN : "#999",
                fontSize: 9, fontWeight: 600, cursor: "pointer",
                fontFamily: "'Space Mono', monospace",
              }}
            >
              {seg.label} ({seg.durationSeconds}s)
            </button>
          ))}
        </div>
      )}

      {/* Gradient overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 100,
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          display: "flex",
          alignItems: "flex-end",
          padding: "0 20px 14px",
          justifyContent: "space-between",
        }}
      >
        {videoData && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Play size={12} style={{ color: COLORS.CYAN }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>
                {t('showcase.cinematicWalkthrough')}
              </span>
              <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED }}>
                {videoData.durationSeconds}s · {hasSegments ? `${segments.length} parts` : `${videoData.shotCount} shots`}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {videoData.downloadUrl && (
                <a href={videoData.downloadUrl} download style={{ textDecoration: "none" }}>
                  <button
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 12px", borderRadius: 6,
                      background: "rgba(0,245,255,0.15)", border: "1px solid rgba(0,245,255,0.3)",
                      color: COLORS.CYAN, fontSize: 11, fontWeight: 600,
                      cursor: "pointer", transition: "all 0.15s ease",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "rgba(0,245,255,0.25)";
                      e.currentTarget.style.boxShadow = "0 0 16px rgba(0,245,255,0.15)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "rgba(0,245,255,0.15)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <Download size={10} />
                    Download
                  </button>
                </a>
              )}
              <button
                onClick={onExpandVideo}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 6,
                  background: "rgba(0,245,255,0.15)", border: "1px solid rgba(0,245,255,0.3)",
                  color: COLORS.CYAN, fontSize: 11, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.15s ease",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "rgba(0,245,255,0.25)";
                  e.currentTarget.style.boxShadow = "0 0 16px rgba(0,245,255,0.15)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "rgba(0,245,255,0.15)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <Maximize2 size={10} />
                {t('showcase.fullscreen')}
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
