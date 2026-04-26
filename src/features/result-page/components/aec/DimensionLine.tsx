"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

interface DimensionLineProps {
  /** Line color. Defaults to teal `#0D9488`. */
  color?: string;
  /** Width in px. Defaults to fill container. */
  width?: number | string;
  /** Stroke thickness. Defaults to 1.5. */
  strokeWidth?: number;
  /** End-tick height in px. Defaults to 6. */
  tickHeight?: number;
  /** Animate-in delay in seconds. Defaults to 0.2. */
  delay?: number;
  /** Animation duration in seconds. Defaults to 0.7. */
  duration?: number;
}

/**
 * Architectural dimension line — a horizontal stroke with two short
 * vertical end-ticks, drawn left→right on first reveal.
 *
 * Used UNDER primary KPI numbers to read like a dimensional callout
 * on a drawing. Not just decorative — it tells the eye "this is a
 * measurement."
 */
export function DimensionLine({
  color = "#0D9488",
  width = "100%",
  strokeWidth = 1.5,
  tickHeight = 6,
  delay = 0.2,
  duration = 0.7,
}: DimensionLineProps) {
  const reduce = useReducedMotion();
  const id = useId();
  const lineHeight = tickHeight * 2;
  return (
    <svg
      width={width}
      height={lineHeight}
      viewBox={`0 0 100 ${lineHeight}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      {/* Left tick */}
      <motion.line
        x1={0.5}
        y1={tickHeight - tickHeight / 2}
        x2={0.5}
        y2={tickHeight + tickHeight / 2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        transition={reduce ? { duration: 0 } : { delay, duration: 0.18 }}
      />
      {/* Right tick */}
      <motion.line
        x1={99.5}
        y1={tickHeight - tickHeight / 2}
        x2={99.5}
        y2={tickHeight + tickHeight / 2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        transition={reduce ? { duration: 0 } : { delay: delay + duration - 0.1, duration: 0.18 }}
      />
      {/* Main line */}
      <motion.line
        id={id}
        x1={0.5}
        y1={tickHeight}
        x2={99.5}
        y2={tickHeight}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        initial={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 1 }}
        animate={reduce ? undefined : { pathLength: 1 }}
        transition={reduce ? { duration: 0 } : { delay, duration, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ pathLength: 1 }}
      />
    </svg>
  );
}
