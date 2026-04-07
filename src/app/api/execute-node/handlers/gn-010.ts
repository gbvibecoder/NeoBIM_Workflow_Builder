import {
  NextResponse,
  formatErrorResponse,
  generateId,
  reconstructHiFi3D,
  isMeshyConfigured,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-010 — Hi-Fi 3D Reconstructor (Meshy v4)
 * Pure copy from execute-node/route.ts (lines 4502-4572 of the pre-decomposition file).
 */
export const handleGN010: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // ── Hi-Fi 3D Reconstructor ─────────────────────────────────────────
  // Takes multi-view renders (from GN-003) + building description
  // and reconstructs a hyper-detailed textured 3D mesh via Meshy API.

  if (!isMeshyConfigured()) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Meshy API key required",
        message: "MESHY_API_KEY is not configured. Add your Meshy API key to enable Hi-Fi 3D reconstruction.",
        code: "MISSING_API_KEY",
      }),
      { status: 400 }
    );
  }

  // Extract image URL from upstream GN-003 (concept renders)
  const imageUrl =
    (inputData?.url as string) ??
    (inputData?.images_out as string) ??
    (inputData?.imageUrl as string) ??
    "";

  if (!imageUrl) {
    return NextResponse.json(
      formatErrorResponse({
        title: "No render image provided",
        message: "GN-010 requires upstream concept render images. Connect a Concept Render Generator (GN-003) node.",
        code: "NODE_001",
      }),
      { status: 400 }
    );
  }

  // Extract building description for guidance
  const description =
    (inputData?.content as string) ??
    (inputData?.description as string) ??
    (inputData?.prompt as string) ??
    "Architectural building";

  const result = await reconstructHiFi3D({
    imageUrl,
    description,
    topology: "quad",
    targetPolycount: 30000,
  });

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "3d",
    data: {
      glbUrl: result.glbUrl,
      thumbnailUrl: result.thumbnailUrl,
      textureUrls: result.textureUrls,
      label: "Hi-Fi 3D Model (Meshy v4)",
      content: description.slice(0, 200),
      metadata: {
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        taskId: result.taskId,
        pipeline: "multi-view renders → Meshy v4 → textured GLB",
        topology: "quad",
        polycount: 30000,
      },
    },
    metadata: { engine: "meshy-v4", real: true, jobId: result.taskId },
    createdAt: new Date(),
  };
};
