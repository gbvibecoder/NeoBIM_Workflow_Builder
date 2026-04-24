"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { MOTION } from "@/features/results-v2/constants";

interface AnimatedCounterProps {
  target: number;
  unit?: string;
  decimals?: number;
  className?: string;
  delayMs?: number;
  locale?: string;
}

/**
 * Counter with a spring-based tick that lands with a tiny overshoot (~3%).
 * Uses framer-motion's imperative `animate()` — no new dependencies.
 *
 * Reduced-motion users get the target value immediately via a render-time
 * fallback; the effect body still runs but sets state only inside an async
 * callback, never synchronously, so React Compiler's
 * `set-state-in-effect` lint is satisfied.
 */
export function AnimatedCounter({
  target,
  unit,
  decimals = 0,
  className,
  delayMs = 200,
  locale,
}: AnimatedCounterProps) {
  const reducedMotion = useReducedMotion();
  const [animated, setAnimated] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);
  const delayHandleRef = useRef<number | null>(null);

  useEffect(() => {
    cancelRef.current?.();
    if (delayHandleRef.current != null) window.clearTimeout(delayHandleRef.current);
    if (reducedMotion) {
      // No RAF; the render-time fallback below renders target directly.
      return;
    }

    delayHandleRef.current = window.setTimeout(() => {
      const controls = animate(0, target, {
        type: "spring",
        stiffness: MOTION.counterSpring.stiffness,
        damping: MOTION.counterSpring.damping,
        mass: MOTION.counterSpring.mass,
        onUpdate: value => setAnimated(value),
      });
      cancelRef.current = () => controls.stop();
    }, delayMs);

    return () => {
      if (delayHandleRef.current != null) window.clearTimeout(delayHandleRef.current);
      cancelRef.current?.();
    };
  }, [target, delayMs, reducedMotion]);

  const display = reducedMotion ? target : animated;

  const formatted = display.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum", "ss01"',
      }}
    >
      {formatted}
      {unit ? <span style={{ fontSize: "0.55em", marginLeft: 6, opacity: 0.8 }}>{unit}</span> : null}
    </span>
  );
}
