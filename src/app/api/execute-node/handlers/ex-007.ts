/**
 * EX-007 — IFC Export
 *
 * Canvas-visible export stage. Takes the validated IFC URL from TR-027
 * and emits a `file` artifact with the download link, viewer deep link,
 * and engine metadata. No rendering — just passthrough of the finalized
 * IFC asset from R2.
 *
 * Why `type: "file"` (not `"image"`)? The result page categorises
 * artifacts by type when picking the workflow badge ("IFC Export" vs
 * "Concept Renders") and the hero kind.
 *
 * Inputs (from TR-027 upstream):
 *   - `ifcUrl: string`    — required
 *   - `runId: string`     — optional, used for deep link
 *   - `entityCount: number` — optional, passed through to result page
 *   - `verdict: string`   — optional, passed through
 *   - `worldBbox: [n,n,n]` — optional, passed through
 */

import type { NodeHandler } from "./types";

export const handleEX007: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const ifcUrl =
    typeof inputData?.ifcUrl === "string" && inputData.ifcUrl.length > 8
      ? inputData.ifcUrl
      : null;

  if (!ifcUrl) {
    throw new Error(
      "EX-007 (IFC Export) requires an `ifcUrl` from upstream TR-027.",
    );
  }

  const ifcViewerUrl = `/dashboard/ifc-viewer?url=${encodeURIComponent(ifcUrl)}`;
  const fileName = `ai-ifc-${tileInstanceId}.ifc`;

  // Pass through upstream metadata (entityCount, verdict, bbox) for the
  // result page hero card without re-fetching.
  const entityCount = typeof inputData?.entityCount === "number" ? inputData.entityCount : null;
  const verdict = typeof inputData?.verdict === "string" ? inputData.verdict : null;
  const worldBbox = Array.isArray(inputData?.worldBbox) ? inputData.worldBbox : null;

  const summary = `IFC exported — ${entityCount ?? "?"} entities. Open in viewer or download.`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "file",
    dataUri: ifcUrl,
    data: {
      url: ifcUrl,
      downloadUrl: ifcUrl,
      fileName,
      name: fileName,
      type: "application/x-step",
      ifcUrl,
      ifcViewerUrl,
      // Engine metadata for the result page stat strip badge
      ifcEngine: "ifcopenshell" as const,
      ifcServicePath: "python" as const,
      runId: typeof inputData?.runId === "string" ? inputData.runId : null,
      runUrl: typeof inputData?.runId === "string"
        ? `/dashboard/brief-to-ifc/v3/runs/${inputData.runId}`
        : null,
      entityCount,
      verdict,
      worldBbox,
      summary,
    },
    metadata: {
      stage: "ifc-export",
      filename: fileName,
      mimeType: "application/x-step",
      engine: "ifcopenshell",
      ifcUrl,
    },
    createdAt: new Date(),
  };
};
