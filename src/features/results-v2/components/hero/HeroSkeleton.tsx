"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { NEUTRAL, HERO_HEIGHT, MOTION, SKELETON_COPY_VIDEO } from "@/features/results-v2/constants";
import type { AccentGradient } from "@/features/results-v2/types";
import { GradientMesh } from "@/features/results-v2/components/primitives/GradientMesh";

interface HeroSkeletonProps {
  accent: AccentGradient;
  workflowName: string;
  /** Baseline copy used on first render; after that, we rotate through COPY_SET. */
  copy: string;
  /** Optional determinate progress (0-100). Drives the determinate overlay bar. */
  progress?: number;
  /** Which copy rotation set to cycle through. Defaults to the video set. */
  copySet?: readonly string[];
}

/**
 * Loading / in-progress hero. Explicitly rejects "Initializing — 5%".
 *
 * Phase D upgrades:
 *   - Rotating copy every MOTION.skeletonCopyRotateMs (6s), locked on the
 *     last line once `progress > 85`.
 *   - Accent-colored shimmer bars (not gray).
 *   - Dual progress: an indeterminate 1.8s sweep at the very bottom + a
 *     determinate overlay that fills when `progress` is known.
 *   - 4-radial breathing gradient mesh with prime-period drift (via
 *     `GradientMesh`) — paused under reduced motion.
 */
export function HeroSkeleton({
  accent,
  workflowName,
  copy,
  progress,
  copySet = SKELETON_COPY_VIDEO,
}: HeroSkeletonProps) {
  const reducedMotion = useReducedMotion();
  const pct = typeof progress === "number" ? Math.max(2, Math.min(100, progress)) : undefined;
  const [copyIdx, setCopyIdx] = useState(0);

  // Rotate through the copy set every 6s. Lock on last entry once progress >= 85.
  useEffect(() => {
    if (pct != null && pct >= 85) {
      // Defer the lock to a microtask so the effect body itself never calls
      // setState synchronously (React Compiler rule).
      queueMicrotask(() => setCopyIdx(copySet.length - 1));
      return;
    }
    const id = window.setInterval(() => {
      setCopyIdx(idx => {
        const next = idx + 1;
        return next >= copySet.length - 1 ? copySet.length - 2 : next;
      });
    }, MOTION.skeletonCopyRotateMs);
    return () => window.clearInterval(id);
  }, [copySet, pct]);

  const currentCopy = pct != null && pct >= 85
    ? copySet[copySet.length - 1]
    : copySet[Math.min(copyIdx, copySet.length - 1)] ?? copy;

  return (
    <section
      aria-label={`${workflowName} — ${currentCopy}`}
      aria-busy="true"
      className="results-v2-hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: HERO_HEIGHT.desktop,
        background: NEUTRAL.BG_BASE,
        overflow: "hidden",
      }}
    >
      <GradientMesh accent={accent} intensity={0.32} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          padding: "clamp(20px, 4vw, 48px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
          <AnimatePresence mode="wait">
            <motion.span
              key={currentCopy}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 0.9, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: MOTION.entrance.ease }}
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: NEUTRAL.TEXT_PRIMARY,
                fontVariantCaps: "all-small-caps",
              }}
            >
              {currentCopy}
            </motion.span>
          </AnimatePresence>

          <h1
            style={{
              margin: 0,
              fontSize: "clamp(22px, 2.4vw, 36px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: NEUTRAL.TEXT_PRIMARY,
              lineHeight: 1.2,
            }}
          >
            {workflowName}
          </h1>

          {/* Accent-color shimmer bars — not gray. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-hidden>
            {[130, 82, 104, 70].map((w, idx) => (
              <motion.span
                key={idx}
                initial={{ opacity: 0.1 }}
                animate={reducedMotion ? { opacity: 0.25 } : { opacity: [0.1, 0.35, 0.1] }}
                transition={reducedMotion ? undefined : { duration: 1.6, delay: idx * 0.15, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  width: w,
                  height: 20,
                  borderRadius: 4,
                  background: `linear-gradient(90deg, ${accent.start}33, ${accent.end}33)`,
                  border: `1px solid ${accent.start}22`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Dual progress: indeterminate sweep on bottom edge, determinate overlay when known. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
        role={pct != null ? "progressbar" : undefined}
        aria-valuemin={pct != null ? 0 : undefined}
        aria-valuemax={pct != null ? 100 : undefined}
        aria-valuenow={pct}
      >
        {/* Indeterminate sweep — always running */}
        {!reducedMotion ? (
          <motion.div
            initial={{ x: "-40%" }}
            animate={{ x: "140%" }}
            transition={{ duration: MOTION.progressSweepMs / 1000, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute",
              inset: 0,
              width: "40%",
              background: `linear-gradient(90deg, transparent, ${accent.start}, transparent)`,
              opacity: 0.55,
            }}
          />
        ) : null}

        {/* Determinate overlay — only when progress is known */}
        {pct != null ? (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4 }}
            style={{
              position: "absolute",
              inset: 0,
              height: "100%",
              background: `linear-gradient(90deg, ${accent.start}, ${accent.end})`,
              boxShadow: `0 0 12px ${accent.start}88`,
            }}
          />
        ) : null}
      </div>

      <style>{`
        @media (max-width: 1279px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.tablet}; }
        }
        @media (max-width: 767px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.mobile}; }
        }
      `}</style>
    </section>
  );
}
