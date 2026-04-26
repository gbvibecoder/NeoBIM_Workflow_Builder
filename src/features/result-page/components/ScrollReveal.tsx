"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import type { ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  delay?: number;
  /** Pixel offset for the IntersectionObserver root margin (negative = trigger before fully in view) */
  margin?: string;
  /** Vertical offset to slide from. Default 24px — same as BOQ visualizer. */
  y?: number;
}

/**
 * Cinematic scroll-reveal wrapper. Mirrors the pattern used inside the BOQ
 * visualizer's `ScrollReveal` so sections feel like they belong to the same
 * design family. Respects `prefers-reduced-motion`.
 */
export function ScrollReveal({ children, delay = 0, margin = "-60px", y = 24 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: margin as `${number}px` });
  const reduce = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      animate={isInView ? { opacity: 1, y: 0 } : undefined}
      transition={reduce ? { duration: 0 } : { duration: 0.55, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  );
}
