"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import { FLOOR_PLAN_ACCENT, NEUTRAL, MOTION, HERO_HEIGHT } from "@/features/results-v2/constants";
import type { AccentGradient, ResultFloorPlan } from "@/features/results-v2/types";
import { GradientMesh } from "@/features/results-v2/components/primitives/GradientMesh";

interface HeroFloorPlanProps {
  floorPlan: ResultFloorPlan;
  /** Workflow accent — kept in signature for callers, but HeroFloorPlan
   *  overrides with a warm sunset palette regardless (architectural feel). */
  accent: AccentGradient;
  workflowName: string;
}

export function HeroFloorPlan({ floorPlan, workflowName }: HeroFloorPlanProps) {
  const reducedMotion = useReducedMotion();
  const initialScale = reducedMotion ? 1 : 0.92;
  // Phase D: warm sunset tones override — floor plans read as architectural
  // blueprints and deserve that feel regardless of pipeline accent.
  const accent = FLOOR_PLAN_ACCENT;

  const roomLabels = [
    floorPlan.roomCount != null ? `${floorPlan.roomCount} rooms` : null,
    floorPlan.wallCount != null ? `${floorPlan.wallCount} walls` : null,
    floorPlan.totalArea != null ? `${Math.round(floorPlan.totalArea).toLocaleString()} m²` : null,
    floorPlan.buildingType ?? null,
  ].filter(Boolean) as string[];

  return (
    <motion.section
      initial={{ opacity: 0, scale: initialScale }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: MOTION.heroReveal.ease }}
      aria-label={`${workflowName} — floor plan`}
      className="results-v2-hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: HERO_HEIGHT.desktop,
        background: NEUTRAL.BG_BASE,
        overflow: "hidden",
      }}
    >
      <GradientMesh accent={accent} intensity={0.26} />

      <div
        style={{
          position: "absolute",
          inset: "clamp(24px, 5vw, 64px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {floorPlan.svg ? (
          <div
            aria-label="Floor plan SVG"
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              filter: `drop-shadow(0 20px 60px ${accent.start}44) drop-shadow(0 6px 16px rgba(0,0,0,0.45))`,
              color: NEUTRAL.TEXT_PRIMARY,
            }}
            dangerouslySetInnerHTML={{ __html: floorPlan.svg }}
          />
        ) : floorPlan.sourceImageUrl ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              filter: `drop-shadow(0 20px 60px ${accent.start}44) drop-shadow(0 6px 16px rgba(0,0,0,0.45))`,
            }}
          >
            <Image
              src={floorPlan.sourceImageUrl}
              alt={floorPlan.label}
              fill
              sizes="100vw"
              unoptimized
              style={{ objectFit: "contain" }}
            />
          </div>
        ) : (
          <LayoutGrid size={96} strokeWidth={1} style={{ color: accent.start, opacity: 0.45 }} />
        )}
      </div>

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)`,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "clamp(20px, 4vw, 48px)",
          right: "clamp(20px, 4vw, 48px)",
          bottom: "clamp(20px, 4vw, 40px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: NEUTRAL.TEXT_SECONDARY,
              fontVariantCaps: "all-small-caps",
            }}
          >
            <LayoutGrid size={12} aria-hidden /> {floorPlan.label}
          </span>
          <motion.h1
            initial={{ fontWeight: 500 }}
            animate={{ fontWeight: 600 }}
            transition={{ duration: 0.6, ease: MOTION.heroReveal.ease, delay: 0.15 }}
            style={{
              margin: 0,
              fontSize: "clamp(22px, 2.4vw, 36px)",
              letterSpacing: "-0.02em",
              color: NEUTRAL.TEXT_PRIMARY,
              lineHeight: 1.2,
              fontVariationSettings: '"wght" 600',
            }}
          >
            {workflowName}
          </motion.h1>

          {/* Staggered room metadata labels — the audit's missing-stagger complaint. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              fontSize: 11,
              fontFamily: "var(--font-jetbrains), monospace",
              color: NEUTRAL.TEXT_SECONDARY,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {roomLabels.map((label, idx) => (
              <motion.span
                key={label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 0.85, y: 0 }}
                transition={{ duration: 0.35, delay: 0.4 + idx * 0.06, ease: MOTION.entrance.ease }}
              >
                {label}
              </motion.span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1279px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.tablet}; }
        }
        @media (max-width: 767px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.mobile}; }
        }
      `}</style>
    </motion.section>
  );
}
