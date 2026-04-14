"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface TypewriterTextProps {
  text: string;
  /** Delay before typing starts (ms) */
  startDelay?: number;
  /** Ms per character */
  charMs?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Honors prefers-reduced-motion: swap to instant reveal. */
  reducedMotion?: boolean;
}

export function TypewriterText({
  text,
  startDelay = 150,
  charMs = 26,
  className,
  style,
  reducedMotion,
}: TypewriterTextProps) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      setShown(text);
      setDone(true);
      return;
    }
    setShown("");
    setDone(false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const kickoff = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval);
          setDone(true);
        }
      }, charMs);
      // Capture for cleanup
      timers.push(interval as unknown as ReturnType<typeof setTimeout>);
    }, startDelay);
    timers.push(kickoff);

    return () => timers.forEach(clearTimeout);
  }, [text, startDelay, charMs, reducedMotion]);

  return (
    <span className={className} style={style} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
      <motion.span
        aria-hidden="true"
        animate={{ opacity: done ? 0 : [1, 0, 1] }}
        transition={{ duration: 0.9, repeat: done ? 0 : Infinity }}
        style={{
          display: "inline-block",
          width: "0.07em",
          height: "1em",
          verticalAlign: "baseline",
          marginLeft: 2,
          background: "currentColor",
          opacity: 0.7,
        }}
      />
    </span>
  );
}
