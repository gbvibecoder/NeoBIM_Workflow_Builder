"use client";

import { motion } from "framer-motion";
import type { PrimaryKpi as PrimaryKpiData } from "@/features/result-page/lib/select-primary-kpi";
import type { WorkflowAccent } from "@/features/result-page/lib/workflow-accent";

interface PrimaryKpiProps {
  kpi: PrimaryKpiData;
  accent: WorkflowAccent;
  /** "lg" = standard hero overlay, "xl" = full BOQ-hero treatment */
  size?: "lg" | "xl";
}

/** A single tasteful KPI display. The wrapper renders at most one. */
export function PrimaryKpi({ kpi, accent, size = "lg" }: PrimaryKpiProps) {
  const valueSize = size === "xl" ? 72 : 56;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textAlign: "left",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(245,245,250,0.62)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {kpi.label}
      </span>
      <span
        style={{
          fontSize: valueSize,
          fontWeight: 700,
          color: "#F5F5FA",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: "'tnum'",
          lineHeight: 1.0,
          letterSpacing: "-0.02em",
          textShadow: `0 0 28px ${accent.base}40`,
        }}
      >
        {kpi.value}
      </span>
      {kpi.sublabel ? (
        <span
          style={{
            fontSize: 13,
            color: "rgba(245,245,250,0.58)",
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
          {kpi.sublabel}
        </span>
      ) : null}
    </motion.div>
  );
}
