import { NextResponse, formatErrorResponse, generateId } from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-007 — Image to 3D (SAM 3D via fal.ai)
 * Pure copy from execute-node/route.ts (lines 3899-3950 of the pre-decomposition file).
 */
export const handleGN007: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // Image to 3D (SAM 3D) — fal.ai
  const imageUrl = inputData?.url ?? inputData?.imageUrl ?? null;
  const imageBase64 = inputData?.fileData ?? inputData?.imageBase64 ?? inputData?.base64 ?? null;

  if (!imageUrl && !imageBase64) {
    return NextResponse.json(
      formatErrorResponse({ title: "Missing image", message: "Provide a building image for 3D conversion.", code: "SAM3D_003" }),
      { status: 400 }
    );
  }

  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      formatErrorResponse({ title: "API key required", message: "FAL_KEY is not configured. Add your fal.ai API key in environment variables.", code: "SAM3D_001" }),
      { status: 400 }
    );
  }

  const { convertImageTo3D } = await import("@/features/3d-render/services/sam3d-service");

  let resolvedUrl = imageUrl;
  if (!resolvedUrl && imageBase64) {
    const prefix = typeof imageBase64 === "string" && imageBase64.startsWith("data:") ? "" : "data:image/png;base64,";
    resolvedUrl = `${prefix}${imageBase64}`;
  }

  const job = await convertImageTo3D(resolvedUrl, {
    seed: inputData?.seed as number | undefined,
    textPrompt: inputData?.textPrompt as string | undefined,
  });

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "3d",
    data: {
      glbUrl: job.glbModel?.downloadUrl,
      plyUrl: job.plyModel?.downloadUrl,
      seed: job.glbModel?.seed,
      label: "3D Model (SAM 3D)",
      metadata: {
        glbFileSize: job.glbModel?.fileSize,
        plyFileSize: job.plyModel?.fileSize,
        expiresAt: job.glbModel?.expiresAt,
        costUsd: job.glbModel?.costUsd,
      },
    },
    metadata: { engine: "fal-ai/sam-3", real: true, jobId: job.id },
    createdAt: new Date(),
  };
};
