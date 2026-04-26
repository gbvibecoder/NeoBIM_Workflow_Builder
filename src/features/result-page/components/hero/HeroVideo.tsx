"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { Maximize2, Download } from "lucide-react";
import type { VideoInfo } from "@/features/result-page/hooks/useResultPageData";

interface HeroVideoProps {
  video: VideoInfo;
  onFullscreen?: () => void;
}

/** Full-bleed video hero — 60vh desktop, 50vh tablet, scales down on mobile.
 *  Replaces the cramped HeroSection from the old wrapper. */
export function HeroVideo({ video, onFullscreen }: HeroVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const url = video.videoUrl;

  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "relative",
        width: "100%",
        borderRadius: 20,
        overflow: "hidden",
        background: "#000",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.06)",
        height: "min(60vh, 720px)",
        minHeight: 320,
      }}
    >
      <video
        ref={ref}
        src={url}
        autoPlay
        muted
        loop
        playsInline
        controls
        crossOrigin="anonymous"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "flex",
          gap: 8,
          zIndex: 2,
        }}
      >
        {video.downloadUrl ? (
          <a
            href={video.downloadUrl}
            download={video.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#F5F5FA",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              backdropFilter: "blur(12px)",
            }}
          >
            <Download size={14} aria-hidden="true" />
            Download
          </a>
        ) : null}
        {onFullscreen ? (
          <button
            type="button"
            onClick={onFullscreen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#F5F5FA",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              backdropFilter: "blur(12px)",
            }}
          >
            <Maximize2 size={14} aria-hidden="true" />
            Theater
          </button>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "32px 20px 16px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "#F5F5FA",
          pointerEvents: "none",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Cinematic walkthrough</span>
        <span style={{ fontSize: 11, color: "rgba(245,245,250,0.65)" }}>
          {video.durationSeconds}s · {video.shotCount} {video.shotCount === 1 ? "shot" : "shots"}
        </span>
      </div>
    </motion.section>
  );
}
