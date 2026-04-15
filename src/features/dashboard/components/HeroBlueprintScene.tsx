"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

// Space in filename → URL-encoded
const DASHBOARD_VIDEO_URL = "/videos/dashboard%20video.mp4";

/**
 * HeroBlueprintScene — dashboard hero background.
 *
 * Layers (back → front):
 *  1. Drifting cyan + violet radial glows (ambient color)
 *  2. Dual blueprint grid (48 px main + 12 px fine), masked to the right
 *  3. Architect corner marks + dimension-line fragment
 *  4. Slow vertical scan-line sweep
 *  5. Single prominent product-preview video panel on the right 40%
 *
 * Pure CSS + SVG + HTML5 video. No WebGL, no 3D libraries.
 */
export function HeroBlueprintScene() {
  const [showPanel, setShowPanel] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 960px)");
    const update = () => setShowPanel(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!showPanel) return;
    videoRef.current?.play().catch(() => {});
  }, [showPanel]);

  const gridMask =
    "radial-gradient(ellipse 78% 82% at 72% 50%, #000 30%, transparent 80%)";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* ── Ambient radial glows ─────────────────────────────────────── */}
      <motion.div
        animate={{ x: [0, 28, 0], y: [0, -20, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 52% 56% at 72% 48%, rgba(6,182,212,0.22) 0%, transparent 62%)",
        }}
      />
      <motion.div
        animate={{ x: [0, -24, 0], y: [0, 16, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 42% 44% at 66% 58%, rgba(168,85,247,0.16) 0%, transparent 58%)",
        }}
      />

      {/* ── Blueprint grid (main + fine) ─────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(125,249,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(125,249,255,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: gridMask,
          WebkitMaskImage: gridMask,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(125,249,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(125,249,255,0.03) 1px, transparent 1px)",
          backgroundSize: "12px 12px",
          maskImage: gridMask,
          WebkitMaskImage: gridMask,
        }}
      />

      {/* ── Architect corner marks ───────────────────────────────────── */}
      <svg
        style={{
          position: "absolute",
          top: "6%",
          right: "4%",
          width: 160,
          height: 160,
          opacity: 0.45,
        }}
        viewBox="0 0 160 160"
        fill="none"
      >
        <path d="M0,0 L0,32 M0,0 L32,0" stroke="rgba(125,249,255,0.55)" strokeWidth="1" />
        <path d="M160,0 L160,32 M160,0 L128,0" stroke="rgba(125,249,255,0.35)" strokeWidth="1" />
        <circle cx="16" cy="16" r="2" fill="rgba(125,249,255,0.6)" />
      </svg>
      <svg
        style={{
          position: "absolute",
          bottom: "6%",
          right: "4%",
          width: 140,
          height: 140,
          opacity: 0.4,
        }}
        viewBox="0 0 140 140"
        fill="none"
      >
        <path d="M140,140 L140,108 M140,140 L108,140" stroke="rgba(168,85,247,0.5)" strokeWidth="1" />
        <path d="M0,140 L32,140 M0,140 L0,108" stroke="rgba(168,85,247,0.3)" strokeWidth="1" />
      </svg>

      {/* ── Slow scan-line sweep ─────────────────────────────────────── */}
      <motion.div
        initial={{ x: "0%" }}
        animate={{ x: ["0%", "100%"] }}
        transition={{ duration: 14, repeat: Infinity, ease: "linear", delay: 2 }}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "40%",
          width: 2,
          background:
            "linear-gradient(180deg, transparent 0%, rgba(125,249,255,0.25) 50%, transparent 100%)",
          filter: "blur(2px)",
          mixBlendMode: "screen",
        }}
      />

      {/* ── Hero video panel — single prominent frame on the right ───── */}
      {showPanel && (
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: [0, -6, 0], scale: 1 }}
          transition={{
            opacity: { duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] },
            scale: { duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] },
            y: { duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1.2 },
          }}
          style={{
            position: "absolute",
            top: "50%",
            right: "clamp(24px, 4vw, 56px)",
            transform: "translateY(-50%)",
            width: "min(42vw, 640px)",
            aspectRatio: "16 / 9",
            borderRadius: 22,
            overflow: "hidden",
            background: "#05070e",
            border: "1px solid rgba(125, 249, 255, 0.22)",
            boxShadow: [
              "0 40px 80px rgba(0, 0, 0, 0.6)",
              "0 12px 32px rgba(0, 0, 0, 0.35)",
              "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
              "0 0 80px rgba(6, 182, 212, 0.18)",
              "0 0 160px rgba(168, 85, 247, 0.08)",
            ].join(", "),
          }}
        >
          {/* Top accent line */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "10%",
              right: "10%",
              height: 1,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(125,249,255,0.7) 50%, transparent 100%)",
              zIndex: 2,
              pointerEvents: "none",
            }}
          />

          {/* The video itself */}
          <video
            ref={videoRef}
            src={DASHBOARD_VIDEO_URL}
            muted
            loop
            playsInline
            preload="metadata"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />

          {/* Subtle inner edge glow */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 22,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
              pointerEvents: "none",
            }}
          />

          {/* Corner tick marks for that architect-spec-sheet feel */}
          <svg
            style={{ position: "absolute", top: 10, left: 10, width: 22, height: 22, opacity: 0.7, pointerEvents: "none" }}
            viewBox="0 0 22 22"
            fill="none"
          >
            <path d="M0,0 L0,8 M0,0 L8,0" stroke="rgba(125,249,255,0.9)" strokeWidth="1.2" />
          </svg>
          <svg
            style={{ position: "absolute", bottom: 10, right: 10, width: 22, height: 22, opacity: 0.7, pointerEvents: "none" }}
            viewBox="0 0 22 22"
            fill="none"
          >
            <path d="M22,22 L22,14 M22,22 L14,22" stroke="rgba(125,249,255,0.9)" strokeWidth="1.2" />
          </svg>
        </motion.div>
      )}
    </div>
  );
}

