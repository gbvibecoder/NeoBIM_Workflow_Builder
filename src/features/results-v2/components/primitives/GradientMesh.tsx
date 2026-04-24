"use client";

import { motion, useReducedMotion } from "framer-motion";
import { MOTION } from "@/features/results-v2/constants";
import type { AccentGradient } from "@/features/results-v2/types";

interface GradientMeshProps {
  accent: AccentGradient;
  intensity?: number;
  /** When true, all four radials stay put (for heroes that already animate). */
  still?: boolean;
}

/**
 * Four-radial breathing mesh with prime-period drift.
 *
 * Each radial lives in its own absolute-positioned layer so its `animate`
 * driver doesn't compound with its neighbors. Periods (17 / 23 / 29 / 31 s)
 * are coprime, so the composition never visually repeats — yet each single
 * layer stays slow enough (~2s per perceivable delta) to read as organic.
 *
 * Opacity cap: 0.22 by default so text over the mesh stays ≥ 4.5:1 contrast.
 * Respects `useReducedMotion()` — pauses entirely when the user prefers it.
 */
export function GradientMesh({ accent, intensity = 0.22, still = false }: GradientMeshProps) {
  const reducedMotion = useReducedMotion();
  const animate = !still && !reducedMotion;

  const palette = [
    { color: accent.start, alpha: intensity * 1.0 },
    { color: accent.end, alpha: intensity * 0.9 },
    { color: accent.end, alpha: intensity * 0.75 },
    { color: accent.start, alpha: intensity * 0.85 },
  ];

  const anchors: Array<{ x: string; y: string; size: string }> = [
    { x: "22%", y: "28%", size: "62%" },
    { x: "78%", y: "22%", size: "58%" },
    { x: "24%", y: "78%", size: "56%" },
    { x: "76%", y: "76%", size: "60%" },
  ];

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {palette.map((p, i) => {
        const period = MOTION.meshPeriods[i];
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              x: animate ? ["0%", "3.5%", "-2.5%", "0%"] : "0%",
              y: animate ? ["0%", "-2.5%", "3%", "0%"] : "0%",
              scale: animate ? [1, 1.05, 0.97, 1] : 1,
            }}
            transition={{
              opacity: { duration: 1.2, delay: i * 0.12 },
              x: { duration: period, repeat: Infinity, ease: "easeInOut", repeatType: "mirror" },
              y: { duration: period + 3, repeat: Infinity, ease: "easeInOut", repeatType: "mirror" },
              scale: { duration: period + 7, repeat: Infinity, ease: "easeInOut", repeatType: "mirror" },
            }}
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(${anchors[i].size} ${anchors[i].size} at ${anchors[i].x} ${anchors[i].y}, ${withAlpha(p.color, p.alpha)} 0%, transparent 70%)`,
              mixBlendMode: "screen",
              willChange: "transform, opacity",
            }}
          />
        );
      })}
    </div>
  );
}

function withAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
