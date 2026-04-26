"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";

interface HeroGenericProps {
  projectTitle: string;
  totalArtifacts: number;
}

export function HeroGeneric({ projectTitle, totalArtifacts }: HeroGenericProps) {
  const accent = getWorkflowAccent("generic");
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        borderRadius: 20,
        background: accent.gradient,
        border: `1px solid ${accent.ring}`,
        padding: "clamp(28px, 5vw, 40px)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "#10B981" }}>
        <CheckCircle2 size={16} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Run complete
        </span>
      </div>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#F5F5FA", letterSpacing: "-0.01em" }}>
        {projectTitle}
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: "rgba(245,245,250,0.6)", lineHeight: 1.6 }}>
        {totalArtifacts > 0
          ? `${totalArtifacts} artifact${totalArtifacts === 1 ? "" : "s"} produced. Browse the tabs below to explore each output.`
          : "Workflow finished. Open the Diagnostics tab for the full execution trace."}
      </p>
    </motion.section>
  );
}
