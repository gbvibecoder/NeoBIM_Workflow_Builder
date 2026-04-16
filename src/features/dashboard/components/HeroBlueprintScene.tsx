"use client";

import { motion } from "framer-motion";

/**
 * HeroBlueprintScene — dashboard hero background.
 *
 * Layers (back → front):
 *  1. Drifting cyan + violet radial glows (ambient color)
 *  2. Dual blueprint grid (48 px main + 12 px fine), masked to center
 *  3. Architect corner marks + dimension-line fragment
 *  4. Slow vertical scan-line sweep
 *
 * Pure CSS + SVG. No WebGL, no 3D libraries.
 * Video is now rendered in the page layout itself for proper centering.
 */
export function HeroBlueprintScene() {
  const gridMask =
    "radial-gradient(ellipse 90% 82% at 50% 50%, #000 30%, transparent 80%)";

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
            "radial-gradient(ellipse 52% 56% at 50% 38%, rgba(6,182,212,0.18) 0%, transparent 62%)",
        }}
      />
      <motion.div
        animate={{ x: [0, -24, 0], y: [0, 16, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 42% 44% at 55% 60%, rgba(168,85,247,0.14) 0%, transparent 58%)",
        }}
      />

      {/* ── Blueprint grid (main + fine) ─────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(125,249,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(125,249,255,0.05) 1px, transparent 1px)",
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
            "linear-gradient(rgba(125,249,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(125,249,255,0.025) 1px, transparent 1px)",
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
          right: "6%",
          width: 160,
          height: 160,
          opacity: 0.35,
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
          top: "6%",
          left: "6%",
          width: 140,
          height: 140,
          opacity: 0.3,
        }}
        viewBox="0 0 140 140"
        fill="none"
      >
        <path d="M0,0 L0,32 M0,0 L32,0" stroke="rgba(168,85,247,0.4)" strokeWidth="1" />
        <circle cx="16" cy="16" r="2" fill="rgba(168,85,247,0.5)" />
      </svg>
      <svg
        style={{
          position: "absolute",
          bottom: "6%",
          right: "6%",
          width: 140,
          height: 140,
          opacity: 0.35,
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
          left: "20%",
          width: 2,
          background:
            "linear-gradient(180deg, transparent 0%, rgba(125,249,255,0.2) 50%, transparent 100%)",
          filter: "blur(2px)",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
