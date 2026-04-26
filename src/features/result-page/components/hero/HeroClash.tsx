"use client";

import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { AnimatedCounter } from "@/features/result-page/components/primitives/AnimatedCounter";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";
import type { ClashSummary } from "@/features/result-page/lib/extract-clash-summary";

interface HeroClashProps {
  summary: ClashSummary;
  onViewAll: () => void;
}

export function HeroClash({ summary, onViewAll }: HeroClashProps) {
  const accent = getWorkflowAccent("clash");
  const hasClashes = summary.total > 0;

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
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minHeight: 320,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
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
          <AlertTriangle size={26} />
        </span>
        <div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: accent.base,
              display: "block",
            }}
          >
            Clash Detection Summary
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
              color: "#F5F5FA",
              letterSpacing: "-0.01em",
              marginTop: 4,
            }}
          >
            {hasClashes ? "Conflicts to coordinate" : "No clashes detected"}
          </h2>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 92,
            fontWeight: 700,
            color: "#F5F5FA",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: "'tnum'",
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            textShadow: `0 0 32px ${accent.base}40`,
          }}
        >
          <AnimatedCounter value={summary.total} duration={1400} />
        </span>
        <span style={{ fontSize: 14, color: "rgba(245,245,250,0.62)", paddingBottom: 8 }}>
          total clashes detected
        </span>
      </div>

      {hasClashes ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SeverityChip label="Critical" count={summary.critical} color="#EF4444" />
          <SeverityChip label="Major" count={summary.major} color="#F59E0B" />
          <SeverityChip label="Minor" count={summary.minor} color="#FACC15" />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "rgba(245,245,250,0.6)", lineHeight: 1.6, maxWidth: 540 }}>
          No spatial conflicts found between elements. The model is clean for this pass — open Data tab for the
          full report if you want details.
        </p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <HeroCta
          label={hasClashes ? "View All Clashes" : "View Full Report"}
          icon={<ArrowRight size={18} aria-hidden="true" />}
          accent={accent}
          onClick={onViewAll}
          size="lg"
        />
      </div>
    </motion.section>
  );
}

function SeverityChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        background: `${color}15`,
        border: `1px solid ${color}45`,
        color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      <span style={{ letterSpacing: "0.04em" }}>{label}</span>
    </span>
  );
}
