"use client";

import { motion, useReducedMotion } from "framer-motion";

interface IsometricBuildingProps {
  /** Stroke color. Defaults to teal. */
  color?: string;
  /** Final ambient opacity after the draw completes. Defaults to 0.10. */
  ambientOpacity?: number;
  /** Container width. Defaults to 320px. */
  width?: number;
}

/**
 * IFC / 3D signature backdrop — isometric wireframe of a small building.
 *
 * Draws path-by-path on first reveal (~1.2s total, 200ms per stroke,
 * staggered). After drawing, settles at low ambient opacity as a quiet
 * watermark. Pure SVG paths animated via framer-motion `pathLength`.
 *
 * 7 strokes (base, left wall, right wall, back wall, roof line, two
 * window panes). Each stroke 200ms with a 200ms stagger.
 *
 * Reduced motion: all paths render fully drawn immediately.
 */
export function IsometricBuilding({
  color = "#0D9488",
  ambientOpacity = 0.10,
  width = 320,
}: IsometricBuildingProps) {
  const reduce = useReducedMotion();
  const transitionFor = (i: number) =>
    reduce
      ? { duration: 0 }
      : {
          delay: 0.05 + i * 0.18,
          duration: 0.32,
          ease: "easeOut" as const,
        };
  const initial = reduce ? { pathLength: 1, opacity: ambientOpacity } : { pathLength: 0, opacity: 0 };
  const animate = { pathLength: 1, opacity: ambientOpacity };

  return (
    <svg
      width={width}
      height={width * 0.85}
      viewBox="0 0 200 170"
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 24,
        right: 24,
        pointerEvents: "none",
      }}
    >
      {/* Base footprint (isometric quad) */}
      <motion.path
        d="M 40 130 L 100 160 L 160 130 L 100 100 Z"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(0)}
      />
      {/* Front-right wall */}
      <motion.path
        d="M 100 100 L 100 50 L 160 80 L 160 130"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(1)}
      />
      {/* Front-left wall */}
      <motion.path
        d="M 100 100 L 100 50 L 40 80 L 40 130"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(2)}
      />
      {/* Rear ridge — barely visible from this angle, stays subtle */}
      <motion.path
        d="M 40 80 L 100 50 L 160 80"
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeOpacity={0.7}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(3)}
      />
      {/* Roof ridge / gable line */}
      <motion.path
        d="M 100 30 L 40 80 L 100 50 L 160 80 L 100 30"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(4)}
      />
      {/* Left-wall window pane */}
      <motion.path
        d="M 60 95 L 60 115 L 80 125 L 80 105 Z"
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.55}
        strokeLinejoin="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(5)}
      />
      {/* Right-wall window pane */}
      <motion.path
        d="M 120 105 L 120 125 L 140 115 L 140 95 Z"
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.55}
        strokeLinejoin="round"
        initial={initial}
        animate={animate}
        transition={transitionFor(6)}
      />
    </svg>
  );
}
