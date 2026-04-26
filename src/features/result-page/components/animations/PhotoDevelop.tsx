"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

interface PhotoDevelopProps {
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Image signature animation — "the print develops."
 *
 * Wraps an `<img>` (or any element). On first reveal, applies a
 * desaturated/low-contrast filter and eases it back to neutral over 800ms.
 * Feels like a darkroom print coming up to color. Plays once.
 *
 * Reduced motion: filter starts at neutral, no transition.
 */
export function PhotoDevelop({ children, style }: PhotoDevelopProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={
        reduce
          ? { filter: "saturate(1) contrast(1) brightness(1)" }
          : { filter: "saturate(0.55) contrast(0.88) brightness(0.95)" }
      }
      animate={{ filter: "saturate(1) contrast(1) brightness(1)" }}
      transition={reduce ? { duration: 0 } : { duration: 0.85, ease: "easeOut" }}
      style={style}
    >
      {children}
    </motion.div>
  );
}
