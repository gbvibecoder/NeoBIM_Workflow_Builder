"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  decimals?: number;
  format?: (n: number) => string;
}

/** Spring-feel counter: lands gracefully with ~3% overshoot, respects reduced motion. */
export function AnimatedCounter({ value, duration = 1200, decimals = 0, format }: AnimatedCounterProps) {
  const prefersReducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(prefersReducedMotion ? value : 0);
  const startTimeRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayed(value);
      return;
    }
    fromRef.current = displayed;
    startTimeRef.current = null;
    let raf = 0;
    const tick = (ts: number) => {
      if (startTimeRef.current === null) startTimeRef.current = ts;
      const elapsed = ts - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      // Spring-ish ease with subtle overshoot
      const eased = t < 1 ? 1 - Math.pow(1 - t, 3.2) + Math.sin(t * Math.PI) * 0.025 * (1 - t) : 1;
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplayed(t === 1 ? value : next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, prefersReducedMotion]);

  if (format) return <>{format(displayed)}</>;
  return <>{displayed.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</>;
}
