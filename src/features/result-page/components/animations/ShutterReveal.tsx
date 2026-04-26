"use client";

import { motion, useReducedMotion } from "framer-motion";

interface ShutterRevealProps {
  /** Bar color. Black by default — works on any video frame. */
  color?: string;
}

/**
 * Video signature animation — cinema shutter opens.
 *
 * Two horizontal black bars cover the video frame entirely. They retract
 * simultaneously: top bar slides up, bottom bar slides down. ~600ms.
 * Reveals the video poster cleanly.
 *
 * Used as an overlay on top of the `<video>` element. Pointer-events:
 * none so it never intercepts the play control.
 *
 * Reduced motion: bars don't render.
 */
export function ShutterReveal({ color = "#0F172A" }: ShutterRevealProps) {
  const reduce = useReducedMotion();
  if (reduce) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <motion.div
        initial={{ y: "0%" }}
        animate={{ y: "-100%" }}
        transition={{ duration: 0.6, ease: [0.83, 0, 0.17, 1], delay: 0.15 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "50%",
          background: color,
        }}
      />
      <motion.div
        initial={{ y: "0%" }}
        animate={{ y: "100%" }}
        transition={{ duration: 0.6, ease: [0.83, 0, 0.17, 1], delay: 0.15 }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "50%",
          background: color,
        }}
      />
    </div>
  );
}
