"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, Info } from "lucide-react";
import { NEUTRAL, MOTION } from "@/features/results-v2/constants";
import type { AccentGradient, ExecutionResult, ModelAttribution } from "@/features/results-v2/types";
import { PanelHeader } from "@/features/results-v2/components/panels/OverviewPanel";

interface AINotesPanelProps {
  result: ExecutionResult;
  accent: AccentGradient;
}

/**
 * Where the orange "AI-Generated Estimate" banner was moved to — now a
 * single quiet footnote at the bottom, not a hero-hogging banner.
 * The panel also credits the models used.
 */
export function AINotesPanel({ result, accent }: AINotesPanelProps) {
  const reducedMotion = useReducedMotion();
  const models = result.models;

  return (
    <motion.section
      id="results-v2-panel-notes"
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" }}
      whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: MOTION.entrance.duration, ease: MOTION.entrance.ease }}
      aria-labelledby="notes-heading"
      style={{
        padding: "clamp(40px, 6vw, 88px) clamp(20px, 4vw, 48px) clamp(72px, 10vw, 120px)",
        borderTop: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_BASE,
        backgroundImage: `linear-gradient(180deg, ${accent.start}0d 0%, transparent 18%)`,
      }}
    >
      <PanelHeader id="notes-heading" label="AI notes" />

      {models.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
          {models.map(m => (
            <ModelPill key={m.name} model={m} accent={accent.start} />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: NEUTRAL.TEXT_MUTED, marginBottom: 28 }}>
          Model attribution was not recorded for this execution.
        </p>
      )}

      <div
        role="note"
        aria-label="AI estimate disclaimer"
        style={{
          display: "flex",
          gap: 10,
          padding: "14px 16px",
          borderRadius: 10,
          border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
          background: "rgba(255,255,255,0.02)",
          color: NEUTRAL.TEXT_SECONDARY,
          fontSize: 13,
          lineHeight: 1.5,
          maxWidth: 820,
        }}
      >
        <Info size={16} style={{ color: NEUTRAL.TEXT_MUTED, flexShrink: 0, marginTop: 2 }} aria-hidden />
        <span>
          Outputs on this page are AI-generated estimates inferred from your inputs.
          Verify critical measurements and specifications before using them in
          contract, construction, or procurement decisions.
        </span>
      </div>
    </motion.section>
  );
}

function ModelPill({ model, accent }: { model: ModelAttribution; accent: string }) {
  const familyColor: Record<ModelAttribution["family"], string> = {
    openai: "#10B981",
    anthropic: "#F59E0B",
    kling: "#8B5CF6",
    replicate: "#EC4899",
    other: accent,
  };
  const dot = familyColor[model.family];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        border: `1px solid ${NEUTRAL.BORDER_SUBTLE}`,
        background: NEUTRAL.BG_ELEVATED,
        color: NEUTRAL.TEXT_PRIMARY,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <Sparkles size={12} style={{ color: dot }} aria-hidden />
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: dot,
          boxShadow: `0 0 8px ${dot}88`,
        }}
      />
      {model.name}
    </span>
  );
}
