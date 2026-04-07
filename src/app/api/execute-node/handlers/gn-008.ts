import {
  NextResponse,
  formatErrorResponse,
  generateId,
  type BuildingDescription,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-008 — Text to 3D Generator (DALL-E 3 + SAM 3D pipeline)
 * Pure copy from execute-node/route.ts (lines 3842-3897 of the pre-decomposition file).
 */
export const handleGN008: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // Text to 3D Generator — DALL-E 3 + SAM 3D pipeline
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      formatErrorResponse({ title: "API key required", message: "FAL_KEY is not configured. Add your fal.ai API key in environment variables.", code: "SAM3D_001" }),
      { status: 400 }
    );
  }

  const { textTo3D } = await import("@/services/text-to-3d-service");

  const prompt = String(inputData?.prompt ?? inputData?.content ?? "");
  const description = inputData?._raw as BuildingDescription | undefined;
  const viewType = ((inputData?.viewType as string) ?? "exterior") as "exterior" | "floor_plan" | "site_plan" | "interior";
  const style = (inputData?.style as string) ?? undefined;
  const seed = inputData?.seed as number | undefined;

  const result = await textTo3D({
    prompt,
    buildingDescription: description,
    viewType,
    style,
    seed,
    apiKey,
  });

  // Return a combined artifact with both the 3D model and the intermediate image
  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "3d",
    data: {
      glbUrl: result.job.glbModel?.downloadUrl,
      plyUrl: result.job.plyModel?.downloadUrl,
      seed: result.job.glbModel?.seed,
      label: "3D Model (Text to 3D)",
      // Include the generated image so the viewer can show both
      sourceImageUrl: result.imageUrl,
      revisedPrompt: result.revisedPrompt,
      metadata: {
        glbFileSize: result.job.glbModel?.fileSize,
        plyFileSize: result.job.plyModel?.fileSize,
        expiresAt: result.job.glbModel?.expiresAt,
        costUsd: (result.job.glbModel?.costUsd ?? 0) + 0.04, // DALL-E 3 HD cost + SAM 3D cost
        pipeline: "text → DALL-E 3 → SAM 3D",
      },
    },
    metadata: {
      engine: "dall-e-3 + fal-ai/sam-3",
      real: true,
      jobId: result.job.id,
      generatedAt: result.job.completedAt,
    },
    createdAt: new Date(),
  };
};
