"use client";

import { motion, AnimatePresence } from "framer-motion";
import { SCENE_PALETTES } from "@/features/onboarding-survey/lib/survey-constants";
import type { SceneNumber } from "@/features/onboarding-survey/types/survey";

interface SceneBackdropProps {
  scene: SceneNumber;
  /** Optional RGB override — used by Scene 1 hover to shift the mesh toward the hovered option. */
  overrideRgb?: string | null;
}

/**
 * Persistent animated gradient mesh. Uses the established dotted-grid
 * (`.canvas-grid-bg`) as a base layer — same architectural treatment as
 * the dashboard / landing hero — then overlays two large radial orbs
 * that cross-fade per scene.
 */
export function SceneBackdrop({ scene, overrideRgb }: SceneBackdropProps) {
  const palette = SCENE_PALETTES[scene];
  const primary = overrideRgb ?? palette.primary;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        background: "var(--bg-base)",
      }}
    >
      {/* Dotted architectural grid (same vocabulary as dashboard canvas) */}
      <div
        className="canvas-grid-bg"
        style={{ position: "absolute", inset: 0, opacity: 0.5 }}
      />

      {/* Blueprint grid overlay — subtle crosshatch */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(rgba(79,138,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.04) 1px, transparent 1px)",
          backgroundSize: "120px 120px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 45%, black 10%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 45%, black 10%, transparent 70%)",
          opacity: 0.5,
        }}
      />

      {/* Two radial orbs — cross-fade per scene. Transition is fluid, not abrupt. */}
      <AnimatePresence mode="sync">
        <motion.div
          key={`orb-primary-${scene}-${primary}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.55 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "absolute",
            top: "-20%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(1000px, 90vw)",
            height: 600,
            borderRadius: "50%",
            pointerEvents: "none",
            background: `radial-gradient(ellipse, rgba(${primary},0.14) 0%, transparent 70%)`,
            filter: "blur(20px)",
          }}
        />
        <motion.div
          key={`orb-secondary-${scene}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.45 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.0, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "absolute",
            bottom: "-20%",
            left: "20%",
            width: 520,
            height: 520,
            borderRadius: "50%",
            pointerEvents: "none",
            background: `radial-gradient(circle, rgba(${palette.secondary},0.10) 0%, transparent 70%)`,
            filter: "blur(28px)",
          }}
        />
        <motion.div
          key={`orb-glow-${scene}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.35 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.0, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "absolute",
            bottom: "-10%",
            right: "10%",
            width: 420,
            height: 420,
            borderRadius: "50%",
            pointerEvents: "none",
            background: `radial-gradient(circle, rgba(${palette.glow},0.08) 0%, transparent 70%)`,
            filter: "blur(32px)",
          }}
        />
      </AnimatePresence>
    </div>
  );
}
