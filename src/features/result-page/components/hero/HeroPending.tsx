"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { VideoGenerationState } from "@/types/execution";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";

const PHASES = [
  "Exterior Pull-in",
  "Building Orbit",
  "Interior Walkthrough",
  "Section Rise",
] as const;

interface HeroPendingProps {
  progress: VideoGenerationState | null;
}

/** Replaces the audit-flagged "Initializing 5%" void with copy that explains
 *  what's happening + a phase indicator + a thin progress bar. */
export function HeroPending({ progress }: HeroPendingProps) {
  const accent = getWorkflowAccent("pending");
  const reduceMotion = useReducedMotion();
  const pct = Math.min(Math.max(progress?.progress ?? 0, 0), 100);
  const activePhaseIdx = progress?.phase ? PHASES.findIndex(p => p === progress.phase) : -1;
  const headline =
    progress?.status === "submitting"
      ? "Sending the build to the render farm"
      : progress?.status === "rendering"
        ? "Rendering your cinematic walkthrough"
        : "Generating your cinematic walkthrough";
  const subhead =
    progress?.phase ?? (pct < 5 ? "Initializing the pipeline…" : `Building shot ${activePhaseIdx + 1 || 1} of ${PHASES.length}`);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{
        position: "relative",
        borderRadius: 20,
        background: accent.gradient,
        border: `1px solid ${accent.ring}`,
        padding: "clamp(28px, 5vw, 48px)",
        boxShadow: accent.glow,
        overflow: "hidden",
        minHeight: 360,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Soft animated backdrop */}
      <motion.div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: -40,
          background: "radial-gradient(circle at 30% 30%, rgba(0,245,255,0.10) 0%, transparent 60%), radial-gradient(circle at 70% 70%, rgba(139,92,246,0.10) 0%, transparent 55%)",
          filter: "blur(40px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
        animate={reduceMotion ? undefined : { opacity: [0.65, 1, 0.65] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 14 }}>
        <motion.span
          animate={reduceMotion ? undefined : { rotate: [0, 360] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: 16,
            background: accent.tint,
            border: `1px solid ${accent.ring}`,
            color: accent.base,
          }}
        >
          <Sparkles size={26} />
        </motion.span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: accent.base,
            }}
          >
            Generating · {pct}%
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(20px, 3vw, 28px)",
              fontWeight: 700,
              color: "#F5F5FA",
              letterSpacing: "-0.01em",
            }}
          >
            {headline}
          </h2>
          <span style={{ fontSize: 13, color: "rgba(245,245,250,0.62)" }}>{subhead}</span>
        </div>
      </div>

      {/* Thin progress bar */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: 4,
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          width: "100%",
          maxWidth: 540,
        }}
      >
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{
            height: "100%",
            background: `linear-gradient(90deg, ${accent.base}, ${accent.base}cc)`,
            boxShadow: `0 0 12px ${accent.base}66`,
          }}
        />
      </div>

      {/* Phase chips */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PHASES.map((phase, i) => {
          const isActive = activePhaseIdx === i || (activePhaseIdx === -1 && i === 0 && pct > 0);
          const isPast = activePhaseIdx > i;
          return (
            <span
              key={phase}
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                padding: "6px 12px",
                borderRadius: 999,
                background: isActive ? `${accent.base}22` : isPast ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                border: isActive ? `1px solid ${accent.ring}` : "1px solid rgba(255,255,255,0.06)",
                color: isActive ? accent.base : isPast ? "rgba(245,245,250,0.6)" : "rgba(245,245,250,0.35)",
              }}
            >
              {phase}
            </span>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "rgba(245,245,250,0.55)", lineHeight: 1.6, maxWidth: 640, position: "relative", zIndex: 1 }}>
        Cinematic walkthroughs typically take 3-8 minutes. You can leave this page and return — progress is saved.
      </p>
    </motion.section>
  );
}
