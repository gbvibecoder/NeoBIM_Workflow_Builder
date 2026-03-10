"use client";

import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Maximize2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "../constants";
import type { VideoInfo } from "../useShowcaseData";

interface HeroSectionProps {
  videoData: VideoInfo | null;
  heroImageUrl: string | null;
  onExpandVideo: () => void;
}

export function HeroSection({ videoData, heroImageUrl, onExpandVideo }: HeroSectionProps) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);

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

  if (!videoData?.videoUrl && !heroImageUrl) return null;

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
            <button
              onClick={onExpandVideo}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 12px",
                borderRadius: 6,
                background: "rgba(0,245,255,0.15)",
                border: "1px solid rgba(0,245,255,0.3)",
                color: COLORS.CYAN,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
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
          </>
        )}
      </div>
    </motion.div>
  );
}
