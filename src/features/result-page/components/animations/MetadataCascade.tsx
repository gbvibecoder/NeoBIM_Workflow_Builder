"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

interface MetadataChip {
  label: string;
  value: string;
  color?: string;
}

interface MetadataCascadeProps {
  chips: MetadataChip[];
}

/**
 * Phase 4.2 · Fix 4 — Image-only signature theater (light version).
 *
 * Sequential reveal of image metadata chips: MODEL · DALL-E 3, SIZE ·
 * 1024×1024, etc. Same back-out + halo recipe as RoomScheduleCascade,
 * but smaller (no connector line — image hero is more horizontal).
 *
 * Reduced motion: chips render fully formed.
 */
export function MetadataCascade({ chips }: MetadataCascadeProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  if (chips.length === 0) return null;

  const STEP = 0.18;
  const baseDelay = 0.15;

  return (
    <div
      ref={ref}
      role="presentation"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      {chips.map((chip, i) => {
        const chipDelay = baseDelay + i * STEP;
        const dotColor = chip.color ?? "#0D9488";
        return (
          <motion.span
            key={`${chip.label}-${i}`}
            initial={
              reduce || !inView
                ? { opacity: 1, scale: 1, y: 0 }
                : { opacity: 0, scale: 0.9, y: 4 }
            }
            animate={inView ? { opacity: 1, scale: 1, y: 0 } : undefined}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    delay: chipDelay,
                    duration: 0.36,
                    ease: [0.34, 1.56, 0.64, 1] as const,
                  }
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 11px",
              borderRadius: 9999,
              background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 600,
              color: "#0F172A",
              letterSpacing: "0.04em",
            }}
          >
            <span aria-hidden="true" style={{ position: "relative", display: "inline-flex", width: 6, height: 6 }}>
              <motion.span
                initial={reduce || !inView ? { scale: 1 } : { scale: 0.4 }}
                animate={inView ? (reduce ? { scale: 1 } : { scale: [0.4, 1.4, 1] }) : undefined}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { delay: chipDelay + 0.04, duration: 0.4, times: [0, 0.45, 1], ease: "easeOut" as const }
                }
                style={{
                  position: "absolute",
                  inset: 0,
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  background: dotColor,
                }}
              />
            </span>
            <span style={{ color: "#94A3B8", fontWeight: 500 }}>{chip.label}</span>
            <span>{chip.value}</span>
          </motion.span>
        );
      })}
    </div>
  );
}
