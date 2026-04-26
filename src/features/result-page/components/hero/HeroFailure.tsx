"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertOctagon, RotateCcw } from "lucide-react";
import { HeroCta } from "@/features/result-page/components/primitives/HeroCta";
import { getWorkflowAccent } from "@/features/result-page/lib/workflow-accent";

interface HeroFailureProps {
  errorMessage: string | null;
  workflowId: string | null;
}

export function HeroFailure({ errorMessage, workflowId }: HeroFailureProps) {
  const accent = getWorkflowAccent("failure");
  const router = useRouter();
  const backToCanvas = () => {
    router.push(workflowId ? `/dashboard/canvas?id=${workflowId}` : "/dashboard/canvas");
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "relative",
        borderRadius: 20,
        background: accent.gradient,
        border: `1px solid ${accent.ring}`,
        padding: "clamp(28px, 5vw, 48px)",
        boxShadow: accent.glow,
        overflow: "hidden",
        minHeight: 320,
        display: "flex",
        flexDirection: "column",
        gap: 20,
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
          <AlertOctagon size={26} />
        </span>
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
            Workflow Failed
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
            This run didn&apos;t reach the finish line
          </h2>
        </div>
      </div>

      <div
        style={{
          background: "rgba(0,0,0,0.32)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: "16px 18px",
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: 13,
          color: "rgba(245,245,250,0.85)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {errorMessage?.trim() ||
          "The execution didn't produce any artifacts and no specific error message was recorded. Open the canvas to inspect the failed nodes — the per-node status will tell you which step broke."}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "rgba(245,245,250,0.65)", lineHeight: 1.6, maxWidth: 640 }}>
        Open the Diagnostics tab below to walk through every node in this run. Most failures are recoverable — fix
        the upstream input on the canvas and run again.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <HeroCta
          label="Retry from canvas"
          icon={<RotateCcw size={18} aria-hidden="true" />}
          accent={accent}
          onClick={backToCanvas}
          size="lg"
        />
      </div>
    </motion.section>
  );
}
