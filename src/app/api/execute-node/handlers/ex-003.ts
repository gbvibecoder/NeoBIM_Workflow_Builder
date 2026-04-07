import { generatePDFBase64, uploadBase64ToR2, generateId } from "./deps";
import type { NodeHandler } from "./types";

/**
 * EX-003 — PDF Report Export
 * Pure copy from execute-node/route.ts (lines 3762-3840 of the pre-decomposition file).
 */
export const handleEX003: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // PDF Report Export — collect upstream artifacts and generate PDF
  const workflowName = String(inputData?.workflowName ?? inputData?.content ?? "BuildFlow Workflow");

  // Collect upstream artifacts passed through inputData
  const upstreamArtifacts: Array<{ nodeLabel: string; type: string; data: Record<string, unknown> }> = [];

  // The execution engine passes the previous artifact's data as inputData
  // We reconstruct what we can from the available data
  if (inputData?.metrics) {
    upstreamArtifacts.push({
      nodeLabel: String(inputData?._nodeLabel ?? "Massing / KPIs"),
      type: "kpi",
      data: inputData as Record<string, unknown>,
    });
  }
  if (inputData?.content && typeof inputData.content === "string" && inputData.content.length > 20) {
    upstreamArtifacts.push({
      nodeLabel: String(inputData?._nodeLabel ?? "Building Description"),
      type: "text",
      data: { content: inputData.content },
    });
  }
  if (inputData?.rows && inputData?.headers) {
    upstreamArtifacts.push({
      nodeLabel: String(inputData?._nodeLabel ?? "BOQ / Table"),
      type: "table",
      data: inputData as Record<string, unknown>,
    });
  }
  if (inputData?._raw && typeof inputData._raw === "object") {
    const raw = inputData._raw as Record<string, unknown>;
    if (raw.narrative || raw.projectName) {
      upstreamArtifacts.push({
        nodeLabel: "Building Description",
        type: "text",
        data: { content: String(raw.narrative ?? raw.projectName ?? "") },
      });
    }
    if (raw.metrics) {
      upstreamArtifacts.push({
        nodeLabel: "Design Metrics",
        type: "kpi",
        data: raw as Record<string, unknown>,
      });
    }
  }

  // Fallback: if no artifacts extracted, add a summary
  if (upstreamArtifacts.length === 0) {
    upstreamArtifacts.push({
      nodeLabel: "Workflow Output",
      type: "text",
      data: { content: typeof inputData?.content === "string" ? inputData.content : "Workflow executed successfully. Detailed results available in the application." },
    });
  }

  const { base64, fileSize } = generatePDFBase64(workflowName, upstreamArtifacts);
  const filename = `BuildFlow_Report_${new Date().toISOString().split("T")[0]}.pdf`;

  // Upload to R2 (falls back to base64 data URI if R2 unavailable)
  const downloadUrl = await uploadBase64ToR2(base64, filename, "application/pdf");

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "file",
    data: {
      name: filename,
      type: "PDF Report",
      size: fileSize,
      downloadUrl,
      label: `Execution Report (${upstreamArtifacts.length} sections)`,
      content: `Professional PDF report with ${upstreamArtifacts.length} sections from workflow execution`,
    },
    metadata: { real: true },
    createdAt: new Date(),
  };
};
