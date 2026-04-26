"use client";

import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

interface WorkflowTypeBadgeProps {
  data: ResultPageData;
}

/**
 * Tiny pill beside the page title that telegraphs the workflow's nature
 * at a glance. E.g. `BOQ ESTIMATE`, `RENDER + VIDEO`, `IFC EXPORT`,
 * `FLOOR PLAN`, `3D MODEL`, `CLASH REPORT`.
 *
 * Helps users scanning their history list disambiguate two runs of the
 * same workflow (different inputs).
 */
export function WorkflowTypeBadge({ data }: WorkflowTypeBadgeProps) {
  const label = pickLabel(data);
  if (!label) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 6,
        background: label.bg,
        color: label.color,
        fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        border: `1px solid ${label.border}`,
        flexShrink: 0,
      }}
    >
      {label.text}
    </span>
  );
}

function pickLabel(data: ResultPageData): { text: string; color: string; bg: string; border: string } | null {
  if (data.boqSummary) {
    return { text: "BOQ Estimate", color: "#0D9488", bg: "#F0FDFA", border: "rgba(13,148,136,0.20)" };
  }
  const ifc = data.fileDownloads.some(f => f.name.toLowerCase().endsWith(".ifc"));
  if (data.videoData?.videoUrl && data.allImageUrls.length > 0) {
    return { text: "Render + Video", color: "#7C3AED", bg: "#F5F3FF", border: "rgba(124,58,237,0.20)" };
  }
  if (data.videoData?.videoUrl) {
    return { text: "Walkthrough", color: "#7C3AED", bg: "#F5F3FF", border: "rgba(124,58,237,0.20)" };
  }
  if (data.clashSummary) {
    return { text: "Clash Report", color: "#D97706", bg: "#FEF3C7", border: "rgba(217,119,6,0.20)" };
  }
  if (ifc) {
    return { text: "IFC Export", color: "#D97706", bg: "#FEF3C7", border: "rgba(217,119,6,0.20)" };
  }
  if (data.model3dData?.kind === "floor-plan-interactive") {
    return { text: "Floor Plan · CAD", color: "#0D9488", bg: "#F0FDFA", border: "rgba(13,148,136,0.20)" };
  }
  if (data.svgContent && !data.model3dData) {
    return { text: "Floor Plan · SVG", color: "#0D9488", bg: "#F0FDFA", border: "rgba(13,148,136,0.20)" };
  }
  if (data.model3dData) {
    return { text: "3D Model", color: "#059669", bg: "#ECFDF5", border: "rgba(5,150,105,0.20)" };
  }
  if (data.allImageUrls.length > 0) {
    return { text: "Concept Renders", color: "#0D9488", bg: "#F0FDFA", border: "rgba(13,148,136,0.20)" };
  }
  return null;
}
