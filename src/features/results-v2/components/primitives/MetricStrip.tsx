"use client";

import { motion } from "framer-motion";
import { NEUTRAL, MOTION } from "@/features/results-v2/constants";
import { AnimatedCounter } from "@/features/results-v2/components/primitives/AnimatedCounter";
import { isPriceLike } from "@/features/results-v2/lib/strip-price";
import type { ResultMetric } from "@/features/results-v2/types";

interface MetricStripProps {
  /** Primary "star" metric rendered at ~72px. */
  star?: ResultMetric;
  /** Up to 4 supporting metrics rendered at ~32px. */
  supporting: ResultMetric[];
  /** Accent glow color for the star metric. */
  accentColor: string;
}

/**
 * Replaces the 3-column equal-weight KPI tiles from the legacy surface.
 * One star metric leads; supporting metrics trail smaller.
 */
export function MetricStrip({ star, supporting, accentColor }: MetricStripProps) {
  // Defensive final filter — stripPrice already handled this, but the
  // legacy execution store can still push arbitrary labels during a live run.
  const safeSupporting = supporting.filter(m => !isPriceLike(m.label, m.value)).slice(0, 4);
  const safeStar = star && !isPriceLike(star.label, star.value) ? star : undefined;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: safeStar ? "minmax(260px, 1fr) minmax(0, 2fr)" : "1fr",
        gap: 28,
        alignItems: "center",
        padding: "28px 0",
      }}
      className="results-v2-metric-strip"
    >
      {safeStar ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: MOTION.entrance.duration, ease: MOTION.entrance.ease }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: NEUTRAL.TEXT_MUTED,
            }}
          >
            {safeStar.label}
          </span>
          <span
            style={{
              fontSize: "clamp(56px, 7vw, 96px)",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: NEUTRAL.TEXT_PRIMARY,
              textShadow: `0 0 32px ${accentColor}33`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {typeof safeStar.value === "number" ? (
              <AnimatedCounter target={safeStar.value} unit={safeStar.unit} />
            ) : (
              <>
                {safeStar.value}
                {safeStar.unit ? (
                  <span style={{ fontSize: "0.45em", marginLeft: 8, color: NEUTRAL.TEXT_SECONDARY }}>
                    {safeStar.unit}
                  </span>
                ) : null}
              </>
            )}
          </span>
        </motion.div>
      ) : null}

      {safeSupporting.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(safeSupporting.length, 4)}, minmax(0, 1fr))`,
            gap: 16,
          }}
          className="results-v2-metric-strip-supporting"
        >
          {safeSupporting.map((m, idx) => (
            <motion.div
              key={`${m.label}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: MOTION.entrance.duration,
                delay: (idx + 1) * MOTION.entrance.stagger,
                ease: MOTION.entrance.ease,
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "14px 16px",
                borderRadius: 12,
                border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
                background: NEUTRAL.BG_ELEVATED,
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
                  lineHeight: 1.1,
                  letterSpacing: "-0.01em",
                  color: NEUTRAL.TEXT_PRIMARY,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {typeof m.value === "number" ? (
                  <AnimatedCounter target={m.value} unit={m.unit} delayMs={300 + idx * 80} />
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

      <style>{`
        @media (max-width: 767px) {
          .results-v2-metric-strip {
            grid-template-columns: 1fr !important;
            padding: 20px 0 !important;
          }
          .results-v2-metric-strip-supporting {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}
