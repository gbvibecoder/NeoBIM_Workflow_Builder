"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { NEUTRAL, MOTION, HERO_HEIGHT } from "@/features/results-v2/constants";
import type { AccentGradient } from "@/features/results-v2/types";
import { useDominantColor } from "@/features/results-v2/hooks/useDominantColor";

interface HeroImageProps {
  images: string[];
  accent: AccentGradient;
  workflowName: string;
}

export function HeroImage({ images, accent, workflowName }: HeroImageProps) {
  const reducedMotion = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const { scrollY } = useScroll();
  const parallaxY = useTransform(scrollY, [0, 400], [0, 40]);

  const primary = images[idx] ?? images[0];
  const dominantColor = useDominantColor(primary ?? null);
  const glow = dominantColor ?? accent.start;

  useEffect(() => {
    if (images.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setDirection(-1);
        setIdx(i => (i - 1 + images.length) % images.length);
      }
      if (e.key === "ArrowRight") {
        setDirection(1);
        setIdx(i => (i + 1) % images.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length]);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION.heroReveal.duration, ease: MOTION.heroReveal.ease }}
      aria-label={`${workflowName} — primary render`}
      className="results-v2-hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: HERO_HEIGHT.desktop,
        background: NEUTRAL.BG_BASE,
        overflow: "hidden",
      }}
    >
      {/* Ambient glow using the dominant color of the active image. */}
      <motion.div
        aria-hidden
        animate={reducedMotion ? { opacity: 0.08 } : { opacity: [0.06, 0.11, 0.06] }}
        transition={reducedMotion ? undefined : { duration: 4.6, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: "-15%",
          background: `radial-gradient(55% 55% at 50% 50%, ${glow}, transparent 70%)`,
          filter: "blur(80px)",
          pointerEvents: "none",
        }}
      />

      <motion.div style={{ position: "absolute", inset: 0, y: reducedMotion ? 0 : parallaxY }}>
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={primary}
            custom={direction}
            initial={
              reducedMotion
                ? { opacity: 0, scale: 1 }
                : { opacity: 0, x: direction === 1 ? "6%" : "-6%", scale: 1.02 }
            }
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={
              reducedMotion
                ? { opacity: 0, scale: 1 }
                : { opacity: 0, x: direction === 1 ? "-4%" : "4%", scale: 1 }
            }
            transition={{ duration: 0.55, ease: MOTION.heroReveal.ease }}
            style={{ position: "absolute", inset: 0 }}
          >
            <motion.div
              animate={reducedMotion ? { scale: 1 } : { scale: [1.0, 1.04, 1.0] }}
              transition={reducedMotion ? undefined : { duration: 20, repeat: Infinity, ease: "easeInOut" }}
              style={{ position: "absolute", inset: 0 }}
            >
              <Image
                src={primary}
                alt={`${workflowName} render`}
                fill
                sizes="100vw"
                priority
                unoptimized
                style={{ objectFit: "cover" }}
              />
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Readability vignette */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 45%)`,
          pointerEvents: "none",
        }}
      />

      {/* Inner accent ring for subtle depth */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: `inset 0 0 0 1px ${glow}2a, inset 0 0 80px ${glow}16`,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "clamp(20px, 4vw, 48px)",
          right: "clamp(20px, 4vw, 48px)",
          bottom: "clamp(20px, 4vw, 40px)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "65%" }}>
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
            <ImageIcon size={12} aria-hidden /> Generated Renders
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

        {images.length > 1 ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => {
                setDirection(-1);
                setIdx(i => (i - 1 + images.length) % images.length);
              }}
              aria-label="Previous render"
              style={arrowStyle(glow)}
            >
              <ChevronLeft size={16} />
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              {images.map((_, i) => (
                <span
                  key={i}
                  aria-current={i === idx}
                  style={{
                    width: i === idx ? 22 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: i === idx ? glow : "rgba(255,255,255,0.3)",
                    boxShadow: i === idx ? `0 0 14px ${glow}77` : "none",
                    transition: "width 220ms ease-out, background 220ms ease-out, box-shadow 220ms ease-out",
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setDirection(1);
                setIdx(i => (i + 1) % images.length);
              }}
              aria-label="Next render"
              style={arrowStyle(glow)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
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
    </motion.section>
  );
}

function arrowStyle(accent: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 10,
    color: NEUTRAL.TEXT_PRIMARY,
    background: "rgba(8,9,12,0.6)",
    border: `1px solid ${accent}55`,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    cursor: "pointer",
  };
}
