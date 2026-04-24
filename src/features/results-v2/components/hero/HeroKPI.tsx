"use client";

import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { NEUTRAL, MOTION, HERO_HEIGHT } from "@/features/results-v2/constants";
import type { AccentGradient, ResultMetric } from "@/features/results-v2/types";
import { GradientMesh } from "@/features/results-v2/components/primitives/GradientMesh";
import { AnimatedCounter } from "@/features/results-v2/components/primitives/AnimatedCounter";
import { isPriceLike } from "@/features/results-v2/lib/strip-price";

interface HeroKPIProps {
  metrics: ResultMetric[];
  accent: AccentGradient;
  workflowName: string;
  /** Optional BOQ-derived GFA used as the star metric when no KPI dominates. */
  boqTotalGfa?: number | null;
}

export function HeroKPI({ metrics, accent, workflowName, boqTotalGfa }: HeroKPIProps) {
  const safeMetrics = metrics.filter(m => !isPriceLike(m.label, m.value));
  const star = pickStar(safeMetrics, boqTotalGfa);
  const supporting = safeMetrics.filter(m => m !== star).slice(0, 4);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION.heroReveal.duration, ease: MOTION.heroReveal.ease }}
      aria-label={`${workflowName} — key metrics`}
      className="results-v2-hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: HERO_HEIGHT.desktop,
        background: NEUTRAL.BG_BASE,
        overflow: "hidden",
      }}
    >
      <GradientMesh accent={accent} intensity={0.3} />
      {/* Primary breathing spotlight for the star metric */}
      <motion.div
        aria-hidden
        animate={{ opacity: [0.08, 0.14, 0.08], scale: [1, 1.06, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: "-10%",
          background: `radial-gradient(40% 50% at 30% 55%, ${accent.start}, transparent 65%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          padding: "clamp(24px, 6vw, 72px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 960, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: NEUTRAL.TEXT_SECONDARY,
              }}
            >
              <BarChart3 size={12} aria-hidden /> Analysis Summary
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
          </div>

          {star ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: NEUTRAL.TEXT_MUTED,
                }}
              >
                {star.label}
              </span>
              <span
                style={{
                  fontSize: "clamp(56px, 9vw, 120px)",
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                  color: NEUTRAL.TEXT_PRIMARY,
                  textShadow: `0 0 48px ${accent.start}88, 0 0 96px ${accent.end}44`,
                  fontVariantNumeric: "tabular-nums",
                  fontFeatureSettings: '"tnum", "ss01"',
                }}
              >
                {typeof star.value === "number" ? (
                  <AnimatedCounter target={star.value} unit={star.unit} />
                ) : (
                  <>
                    {star.value}
                    {star.unit ? (
                      <span style={{ fontSize: "0.4em", marginLeft: 10, color: NEUTRAL.TEXT_SECONDARY }}>
                        {star.unit}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          ) : null}

          {supporting.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${Math.min(supporting.length, 4)}, minmax(0, 1fr))`,
                gap: 16,
              }}
              className="results-v2-herokpi-supporting"
            >
              {supporting.map((m, idx) => (
                <motion.div
                  key={`${m.label}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: MOTION.entrance.duration,
                    delay: 0.2 + idx * MOTION.entrance.stagger,
                    ease: MOTION.entrance.ease,
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "12px 16px",
                    borderRadius: 10,
                    border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
                    background: "rgba(10,12,16,0.65)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: NEUTRAL.TEXT_MUTED,
                    }}
                  >
                    {m.label}
                  </span>
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: NEUTRAL.TEXT_PRIMARY,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {typeof m.value === "number" ? (
                      <AnimatedCounter target={m.value} unit={m.unit} delayMs={400 + idx * 80} />
                    ) : (
                      <>
                        {m.value}
                        {m.unit ? (
                          <span style={{ fontSize: "0.6em", marginLeft: 4, color: NEUTRAL.TEXT_SECONDARY }}>
                            {m.unit}
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>
                </motion.div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 1279px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.tablet}; }
        }
        @media (max-width: 767px) {
          .results-v2-hero { min-height: ${HERO_HEIGHT.mobile}; }
          .results-v2-herokpi-supporting { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </motion.section>
  );
}

/** Pick the star metric: prefer numeric values with large magnitudes. */
function pickStar(metrics: ResultMetric[], boqTotalGfa?: number | null): ResultMetric | null {
  if (metrics.length === 0) {
    if (typeof boqTotalGfa === "number" && boqTotalGfa > 0) {
      return { label: "Total GFA", value: boqTotalGfa, unit: "m²" };
    }
    return null;
  }
  const numeric = metrics.filter(m => typeof m.value === "number" && (m.value as number) > 0);
  if (numeric.length === 0) return metrics[0];
  return numeric.reduce((best, m) => ((m.value as number) > (best.value as number) ? m : best), numeric[0]);
}
