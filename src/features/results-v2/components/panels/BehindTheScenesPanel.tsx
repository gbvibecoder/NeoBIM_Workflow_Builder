"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2, Circle, AlertTriangle, Loader2 } from "lucide-react";
import { NEUTRAL, MOTION } from "@/features/results-v2/constants";
import type { AccentGradient, ExecutionResult, PipelineNodeStatus } from "@/features/results-v2/types";
import { PanelHeader } from "@/features/results-v2/components/panels/OverviewPanel";

interface BehindTheScenesPanelProps {
  result: ExecutionResult;
  accent: AccentGradient;
}

/**
 * Promotes the legacy "bottom-right footer pill" into a first-class panel
 * with a horizontally scrollable node timeline and per-node status glyphs.
 */
export function BehindTheScenesPanel({ result, accent }: BehindTheScenesPanelProps) {
  const reducedMotion = useReducedMotion();
  const steps = result.pipeline;
  if (steps.length === 0) return null;

  return (
    <motion.section
      id="results-v2-panel-pipeline"
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" }}
      whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: MOTION.entrance.duration, ease: MOTION.entrance.ease }}
      aria-labelledby="pipeline-heading"
      style={{
        padding: "clamp(40px, 6vw, 88px) clamp(20px, 4vw, 48px)",
        borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_BASE,
        backgroundImage: `linear-gradient(180deg, ${accent.end}0d 0%, transparent 20%)`,
      }}
    >
      <PanelHeader id="pipeline-heading" label="Behind the scenes">
        <span style={{ fontSize: 12, color: NEUTRAL.TEXT_SECONDARY }}>{steps.length} nodes</span>
      </PanelHeader>

      <div
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          paddingBottom: 12,
          scrollbarWidth: "thin",
        }}
      >
        {steps.map((step, idx) => (
          <motion.div
            key={step.nodeId}
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
            whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{
              duration: MOTION.entrance.duration,
              delay: idx * MOTION.entrance.stagger,
              ease: MOTION.entrance.ease,
            }}
            style={{
              minWidth: 220,
              padding: "16px 18px",
              borderRadius: 12,
              border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
              background: NEUTRAL.BG_ELEVATED,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusGlyph status={step.status} accent={accent.start} />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: NEUTRAL.TEXT_MUTED,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {step.catalogueId || formatCategory(step.category)}
              </span>
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: NEUTRAL.TEXT_PRIMARY,
                lineHeight: 1.3,
              }}
            >
              {step.label}
            </span>
            <span style={{ fontSize: 11, color: NEUTRAL.TEXT_SECONDARY, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {step.artifactType ? (
                <>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: step.status === "success" ? accent.start : NEUTRAL.TEXT_MUTED,
                    }}
                  />
                  {step.artifactType}
                </>
              ) : (
                <span>—</span>
              )}
              {idx < steps.length - 1 ? (
                <ArrowRight size={12} style={{ color: NEUTRAL.TEXT_MUTED, marginLeft: "auto" }} aria-hidden />
              ) : null}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

function StatusGlyph({ status, accent }: { status: PipelineNodeStatus; accent: string }) {
  if (status === "success") {
    return <CheckCircle2 size={14} style={{ color: accent }} aria-label="Success" />;
  }
  if (status === "running") {
    return <Loader2 size={14} style={{ color: accent, animation: "spin 1.2s linear infinite" }} aria-label="Running" />;
  }
  if (status === "error") {
    return <AlertTriangle size={14} style={{ color: "#F43F5E" }} aria-label="Error" />;
  }
  return <Circle size={14} style={{ color: NEUTRAL.TEXT_MUTED }} aria-label={status} />;
}

function formatCategory(cat: string): string {
  return cat.toUpperCase();
}
