"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Box } from "lucide-react";
import { NEUTRAL, MOTION, HERO_HEIGHT } from "@/features/results-v2/constants";
import type { AccentGradient, Result3D } from "@/features/results-v2/types";
import { GradientMesh } from "@/features/results-v2/components/primitives/GradientMesh";
import { HeroSkeleton } from "@/features/results-v2/components/hero/HeroSkeleton";

interface HeroViewer3DProps {
  model: Result3D;
  accent: AccentGradient;
  workflowName: string;
}

export function HeroViewer3D({ model, accent, workflowName }: HeroViewer3DProps) {
  const reducedMotion = useReducedMotion();
  const hasIframe = model.kind === "html-iframe" && Boolean(model.iframeUrl);
  const hasGlb = model.kind === "glb" && Boolean(model.glbUrl);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION.heroReveal.duration, ease: MOTION.heroReveal.ease }}
      aria-label={`${workflowName} — 3D model`}
      className="results-v2-hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: HERO_HEIGHT.desktop,
        background: NEUTRAL.BG_BASE,
        overflow: "hidden",
      }}
    >
      {hasIframe && model.iframeUrl ? (
        <>
          <iframe
            title={`${workflowName} — interactive 3D`}
            src={model.iframeUrl}
            onLoad={() => setIframeLoaded(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
              background: NEUTRAL.BG_BASE,
              opacity: iframeLoaded ? 1 : 0,
              transition: "opacity 500ms ease-out",
            }}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          />
          {!iframeLoaded ? (
            <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <HeroSkeleton
                accent={accent}
                workflowName={workflowName}
                copy="Loading interactive 3D"
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <GradientMesh accent={accent} intensity={0.22} />
          {/* Double counter-rotating ring — restrained, premium */}
          <motion.div
            aria-hidden
            animate={reducedMotion ? undefined : { rotate: 360 }}
            transition={reducedMotion ? undefined : { duration: 36, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(60vw, 620px)",
              height: "min(60vw, 620px)",
              borderRadius: "50%",
              border: `1px solid ${accent.start}44`,
              boxShadow: `inset 0 0 100px ${accent.start}22`,
            }}
          />
          <motion.div
            aria-hidden
            animate={reducedMotion ? undefined : { rotate: -360 }}
            transition={reducedMotion ? undefined : { duration: 54, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(36vw, 370px)",
              height: "min(36vw, 370px)",
              borderRadius: "50%",
              border: `1px dashed ${accent.end}55`,
              boxShadow: `inset 0 0 60px ${accent.end}18`,
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              color: NEUTRAL.TEXT_PRIMARY,
            }}
          >
            <Box size={56} strokeWidth={1.1} style={{ color: accent.start, opacity: 0.8, filter: `drop-shadow(0 0 24px ${accent.start}66)` }} />
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: NEUTRAL.TEXT_SECONDARY,
                fontVariantCaps: "all-small-caps",
              }}
            >
              {hasGlb ? "GLB model ready" : "Procedural building"}
            </div>
          </div>
        </>
      )}

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 55%)`,
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
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
            <Box size={12} aria-hidden /> Interactive 3D Model
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
          {model.kind === "procedural" ? (
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
              {model.floors ? <span>{model.floors} floors</span> : null}
              {model.gfa ? <span>{Math.round(model.gfa).toLocaleString()} m² GFA</span> : null}
              {model.footprint ? <span>{Math.round(model.footprint).toLocaleString()} m² footprint</span> : null}
              {model.buildingType ? <span>{model.buildingType}</span> : null}
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
        }
      `}</style>
    </motion.section>
  );
}
