"use client";

import { motion } from "framer-motion";
import { confettiParticle } from "@/features/onboarding-survey/lib/scene-motion";

interface ConfettiBurstProps {
  /** When true, particles animate out. Render the component conditionally to replay. */
  active: boolean;
  /** Number of particles. 40 on desktop, reduce on mobile. */
  count?: number;
}

const PARTICLE_COLORS = [
  "245, 158, 11",   // amber
  "212, 149, 106",  // copper
  "255, 191, 0",    // gold
  "139, 92, 246",   // violet
  "79, 138, 255",   // blue
  "16, 185, 129",   // green
  "0, 245, 255",    // cyan
];

export function ConfettiBurst({ active, count = 40 }: ConfettiBurstProps) {
  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5,
      }}
    >
      <div style={{ position: "relative", width: 0, height: 0 }}>
        {Array.from({ length: count }).map((_, i) => {
          const spec = confettiParticle(i, 0.37);
          const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
          const shape = i % 3;
          const base: React.CSSProperties = {
            position: "absolute",
            top: 0,
            left: 0,
            background: `rgb(${color})`,
            boxShadow: `0 0 8px rgba(${color}, 0.6)`,
            pointerEvents: "none",
          };
          const size: React.CSSProperties =
            shape === 0
              ? { width: 6, height: 6, borderRadius: "50%" }
              : shape === 1
              ? { width: 8, height: 3, borderRadius: 1 }
              : { width: 4, height: 10, borderRadius: 1 };
          return (
            <motion.span
              key={i}
              initial={spec.initial}
              animate={spec.animate}
              transition={spec.transition}
              style={{ ...base, ...size }}
            />
          );
        })}
      </div>
    </div>
  );
}
