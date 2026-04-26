"use client";

import { motion, useReducedMotion } from "framer-motion";

interface RegistrationMarkProps {
  size?: number;
  color?: string;
}

/**
 * Architectural alignment mark — a circle with a crosshair through it.
 *
 * Used as an ambient "still working" indicator in the pending-render
 * state, slowly rotating. The shape itself is a registration mark
 * (printers / drafting use these to align color separations). Quietly
 * domain-specific.
 *
 * Reduced motion: renders static (no rotation).
 */
export function RegistrationMark({ size = 18, color = "#0D9488" }: RegistrationMarkProps) {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      animate={reduce ? undefined : { rotate: 360 }}
      transition={reduce ? undefined : { duration: 4, repeat: Infinity, ease: "linear" }}
      style={{ display: "inline-block" }}
    >
      <circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={1.4} />
      <line x1={2} y1={12} x2={22} y2={12} stroke={color} strokeWidth={1.4} />
      <line x1={12} y1={2} x2={12} y2={22} stroke={color} strokeWidth={1.4} />
      <circle cx={12} cy={12} r={2} fill={color} />
    </motion.svg>
  );
}
