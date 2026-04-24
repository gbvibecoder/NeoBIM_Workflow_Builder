"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Clock, Layers } from "lucide-react";
import { NEUTRAL, MOTION } from "@/features/results-v2/constants";
import type { AccentGradient, ExecutionResult, ResultMetric } from "@/features/results-v2/types";
import { MetricStrip } from "@/features/results-v2/components/primitives/MetricStrip";

interface OverviewPanelProps {
  result: ExecutionResult;
  accent: AccentGradient;
}

const PANEL_ENTRANCE_HIDDEN = { opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" };
const PANEL_ENTRANCE_VISIBLE = { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" };

export function OverviewPanel({ result, accent }: OverviewPanelProps) {
  const reducedMotion = useReducedMotion();
  const { star, supporting } = buildMetrics(result);

  const hidden = reducedMotion ? { opacity: 1 } : PANEL_ENTRANCE_HIDDEN;
  const visible = reducedMotion ? { opacity: 1 } : PANEL_ENTRANCE_VISIBLE;

  return (
    <motion.section
      id="results-v2-panel-overview"
      initial={hidden}
      whileInView={visible}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: MOTION.entrance.duration, ease: MOTION.entrance.ease }}
      aria-labelledby="overview-heading"
      style={sectionStyle(accent)}
    >
      <PanelHeader id="overview-heading" label="Overview">
        <span style={{ display: "inline-flex", gap: 16, color: NEUTRAL.TEXT_SECONDARY, fontSize: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Clock size={12} aria-hidden /> {formatDuration(result.status.durationMs)}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Layers size={12} aria-hidden /> {result.pipeline.length} steps
          </span>
        </span>
      </PanelHeader>

      {result.summaryText ? (
        <motion.p
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
          whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{
            duration: MOTION.entrance.duration,
            delay: MOTION.entrance.stagger,
            ease: MOTION.entrance.ease,
          }}
          style={{
            margin: "0 0 8px",
            fontSize: 15,
            lineHeight: 1.6,
            color: NEUTRAL.TEXT_SECONDARY,
            maxWidth: 780,
          }}
        >
          {result.summaryText.slice(0, 360)}
          {result.summaryText.length > 360 ? "…" : ""}
        </motion.p>
      ) : null}

      {star || supporting.length > 0 ? (
        <MetricStrip star={star} supporting={supporting} accentColor={accent.start} />
      ) : null}
    </motion.section>
  );
}

function buildMetrics(result: ExecutionResult): { star: ResultMetric | undefined; supporting: ResultMetric[] } {
  const supporting: ResultMetric[] = [];
  if (result.status.durationMs != null) {
    supporting.push({ label: "Duration", value: Math.round(result.status.durationMs / 1000), unit: "s" });
  }
  if (result.video) {
    supporting.push({ label: "Shots", value: result.video.shotCount });
  }
  if (result.pipeline.length > 0) {
    supporting.push({ label: "Nodes", value: result.pipeline.length });
  }
  if (result.downloads.length > 0) {
    supporting.push({ label: "Assets", value: result.downloads.length });
  }

  const metricsWithoutSupporting = result.metrics.filter(m => !supporting.some(s => s.label === m.label));
  const star = metricsWithoutSupporting.find(m => typeof m.value === "number")
    ?? metricsWithoutSupporting[0]
    ?? supporting[0];

  return { star, supporting: supporting.filter(s => s !== star).slice(0, 4) };
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null || durationMs <= 0) return "—";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function sectionStyle(accent: AccentGradient): React.CSSProperties {
  return {
    padding: "clamp(40px, 6vw, 88px) clamp(20px, 4vw, 48px)",
    borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
    background: NEUTRAL.BG_BASE,
    position: "relative",
    // A whisper of accent glow at the top edge so the seam isn't dead.
    backgroundImage: `linear-gradient(180deg, ${accent.start}0f 0%, transparent 20%)`,
  };
}

export function PanelHeader({ id, label, children }: { id: string; label: string; children?: React.ReactNode }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <h2
        id={id}
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: NEUTRAL.TEXT_PRIMARY,
        }}
      >
        {label}
      </h2>
      {children}
    </header>
  );
}
