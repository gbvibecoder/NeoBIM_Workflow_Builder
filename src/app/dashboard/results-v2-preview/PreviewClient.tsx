"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { HeroVideo } from "@/features/results-v2/components/hero/HeroVideo";
import { HeroImage } from "@/features/results-v2/components/hero/HeroImage";
import { HeroViewer3D } from "@/features/results-v2/components/hero/HeroViewer3D";
import { HeroFloorPlan } from "@/features/results-v2/components/hero/HeroFloorPlan";
import { HeroKPI } from "@/features/results-v2/components/hero/HeroKPI";
import { HeroSkeleton } from "@/features/results-v2/components/hero/HeroSkeleton";
import { ResultExperienceInner } from "@/features/results-v2/components/ResultExperience";
import { pickAccent } from "@/features/results-v2/lib/workflow-accent";
import { NEUTRAL } from "@/features/results-v2/constants";
import {
  FIXTURES,
  fixtureVideo,
  fixtureImage,
  fixtureViewer3D,
  fixtureFloorPlan,
  fixtureKpi,
  fixtureSkeleton,
} from "@/features/results-v2/fixtures";
import type { ExecutionResult } from "@/features/results-v2/types";

interface SectionProps {
  id: string;
  label: string;
  index: number;
  total: number;
  children: React.ReactNode;
}

function PreviewSection({ id, label, index, total, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-label={label}
      style={{
        position: "relative",
        borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 30,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderRadius: 999,
          background: "rgba(10,12,16,0.82)",
          border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
          color: NEUTRAL.TEXT_PRIMARY,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "var(--font-jetbrains), monospace",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <span style={{ color: NEUTRAL.TEXT_MUTED }}>
          Variant {index}/{total} ·
        </span>
        <span>{label}</span>
      </div>
      {children}
    </section>
  );
}

export function ResultsV2Preview() {
  const accents = useMemo(
    () => ({
      video: pickAccent(fixtureVideo),
      image: pickAccent(fixtureImage),
      viewer3d: pickAccent(fixtureViewer3D),
      floorPlan: pickAccent(fixtureFloorPlan),
      kpi: pickAccent(fixtureKpi),
      skeleton: pickAccent(fixtureSkeleton),
    }),
    [],
  );

  const total = FIXTURES.length;

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: NEUTRAL.BG_BASE,
        minHeight: "100vh",
        color: NEUTRAL.TEXT_PRIMARY,
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px clamp(16px, 4vw, 32px)",
          background: "rgba(7,8,9,0.88)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          borderBottom: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: NEUTRAL.TEXT_MUTED,
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          Results V2 · Visual Preview (dev only)
        </span>
        <span style={{ fontSize: 12, color: NEUTRAL.TEXT_SECONDARY }}>
          {total} hero variants · 1 full experience · fixtures only, no DB
        </span>
      </header>

      <PreviewSection id="section-video" label="HeroVideo — walkthrough" index={1} total={total}>
        <HeroVideo
          video={fixtureVideo.video as NonNullable<ExecutionResult["video"]>}
          accent={accents.video}
          workflowName={fixtureVideo.workflowName}
        />
      </PreviewSection>

      <PreviewSection id="section-image" label="HeroImage — renders" index={2} total={total}>
        <HeroImage images={fixtureImage.images} accent={accents.image} workflowName={fixtureImage.workflowName} />
      </PreviewSection>

      <PreviewSection id="section-3d" label="HeroViewer3D — procedural" index={3} total={total}>
        <HeroViewer3D
          model={fixtureViewer3D.model3d as NonNullable<ExecutionResult["model3d"]>}
          accent={accents.viewer3d}
          workflowName={fixtureViewer3D.workflowName}
        />
      </PreviewSection>

      <PreviewSection id="section-floor" label="HeroFloorPlan — SVG" index={4} total={total}>
        <HeroFloorPlan
          floorPlan={fixtureFloorPlan.floorPlan as NonNullable<ExecutionResult["floorPlan"]>}
          accent={accents.floorPlan}
          workflowName={fixtureFloorPlan.workflowName}
        />
      </PreviewSection>

      <PreviewSection id="section-kpi" label="HeroKPI — BOQ summary" index={5} total={total}>
        <HeroKPI
          metrics={fixtureKpi.metrics}
          accent={accents.kpi}
          workflowName={fixtureKpi.workflowName}
          boqTotalGfa={fixtureKpi.boqTotalGfa}
        />
      </PreviewSection>

      <PreviewSection id="section-skeleton" label="HeroSkeleton — rendering" index={6} total={total}>
        <HeroSkeleton
          accent={accents.skeleton}
          workflowName={fixtureSkeleton.workflowName}
          copy="Rendering cinematic walkthrough"
          progress={fixtureSkeleton.video?.progress}
        />
      </PreviewSection>

      {/* Full experience composition — the entire stack for the video fixture. */}
      <section
        id="section-full"
        aria-label="Full ResultExperience — hero + ribbon + all panels"
        style={{ position: "relative", borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}` }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 30,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(10,12,16,0.82)",
            border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
            color: NEUTRAL.TEXT_PRIMARY,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "var(--font-jetbrains), monospace",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <span style={{ color: NEUTRAL.TEXT_MUTED }}>Full stack ·</span>
          <span>Hero + Ribbon + Overview + Assets + Pipeline + Downloads + Notes</span>
        </div>
        <ResultExperienceInner result={fixtureVideo} />
      </section>

      <footer
        style={{
          padding: "48px clamp(16px, 4vw, 32px)",
          color: NEUTRAL.TEXT_MUTED,
          fontSize: 11,
          textAlign: "center",
          fontFamily: "var(--font-jetbrains), monospace",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Results V2 preview · fixtures under src/features/results-v2/fixtures/
      </footer>
    </motion.main>
  );
}
