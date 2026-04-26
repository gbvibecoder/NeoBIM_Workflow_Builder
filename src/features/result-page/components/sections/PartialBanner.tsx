"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface PartialBannerProps {
  data: ResultPageData;
}

/**
 * Soft amber inset banner shown above the hero when status === "partial".
 * Replaces the audit-flagged red "1 Issue ❌" pill from Phase 1.
 *
 * Tone is reassuring: most of the workflow finished, here's the one step
 * that didn't, and here's how to retry. Uses the actual failed-node label
 * from the pipeline trace when available.
 */
export function PartialBanner({ data }: PartialBannerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Find the failed step (best signal we have without direct error markers)
  const failed = data.pipelineSteps.find(s => s.status === "error" || s.status === "failed");
  const failedLabel = failed?.label ?? "One step";
  const succeededCount = data.pipelineSteps.filter(s => s.status === "success").length;
  const totalCount = data.pipelineSteps.length || data.totalNodes;

  // Build a contextual reassurance using known artifacts
  const positives: string[] = [];
  if (data.boqSummary) positives.push("BOQ");
  if (data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"))) positives.push("IFC export");
  if (data.svgContent || data.model3dData?.kind === "floor-plan-interactive") positives.push("floor plan");
  if (data.model3dData) positives.push("3D model");
  if (data.allImageUrls.length > 0) positives.push("renders");
  if (data.tableData.length > 0 && !data.boqSummary) positives.push("data tables");
  const positiveText = positives.length > 0 ? positives.slice(0, 3).join(", ") + (positives.length > 3 ? ", and more" : "") : "the artifacts that completed";
  const failureNoun =
    failed?.label.toLowerCase().includes("video") ? "video walkthrough"
    : failed?.label.toLowerCase().includes("render") ? "render"
    : failed?.label.toLowerCase().includes("ifc") ? "IFC export"
    : failed?.label.toLowerCase().includes("boq") ? "BOQ estimate"
    : "this step";

  const errorMessage = data.executionMeta.errorMessage?.trim();

  const handleRetry = () => {
    if (data.workflowId) {
      try {
        sessionStorage.setItem("prefill-from-execution", data.executionId);
        if (failed?.nodeId) sessionStorage.setItem("focus-failed-node", failed.nodeId);
      } catch {
        // sessionStorage may be unavailable
      }
      router.push(`/dashboard/canvas?id=${data.workflowId}`);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        background: "#FEF3C7",
        border: "1px solid rgba(217,119,6,0.22)",
        borderRadius: 16,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "#FFFBEB",
            color: "#D97706",
            flexShrink: 0,
            border: "1px solid rgba(217,119,6,0.18)",
          }}
        >
          <AlertTriangle size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 500,
              color: "#92400E",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {String(succeededCount).padStart(2, "0")}/{String(totalCount).padStart(2, "0")} · partial run
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#92400E", lineHeight: 1.55 }}>
            Most of the run cleared. The {failureNoun} stalled — your {positiveText} {positives.length > 0 ? "are intact below." : "are still below."}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingLeft: 44 }}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            borderRadius: 8,
            background: "#FFFFFF",
            border: "1px solid rgba(217,119,6,0.20)",
            color: "#92400E",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          The step that stalled · {failedLabel}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} style={{ display: "inline-flex" }}>
            <ChevronDown size={12} aria-hidden="true" />
          </motion.span>
        </button>
        {data.workflowId ? (
          <button
            type="button"
            onClick={handleRetry}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 8,
              background: "#D97706",
              border: "none",
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Retry from canvas
          </button>
        ) : null}
      </div>

      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ overflow: "hidden", paddingLeft: 44 }}
      >
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(217,119,6,0.18)",
            borderRadius: 10,
            padding: "12px 14px",
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 12,
            color: "#4B5563",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            marginTop: open ? 4 : 0,
          }}
        >
          {errorMessage ||
            `${failedLabel} did not produce its output. Open Diagnostics (bottom-right) to see the per-node trace, or retry from the canvas to fix the upstream input.`}
        </div>
      </motion.div>
    </motion.section>
  );
}
