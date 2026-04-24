import type { ExecutionResult, HeroVariant } from "@/features/results-v2/types";

/**
 * Pure deterministic hero selector. Given the same ExecutionResult, returns
 * the same variant every render. Never reads costUsd or price fields.
 *
 * Priority order (locked in the Phase A audit, §A.5):
 *   1. pending/running with no terminal artifacts → skeleton
 *   2. video ready (any of three signals) → video
 *   3. 3D model available → viewer3d
 *   4. floor plan / svg available → floorPlan
 *   5. image available → image
 *   6. metrics or BOQ summary → kpi
 *   7. fallback → skeleton
 */
export function selectHero(result: ExecutionResult): HeroVariant {
  const { status, video, model3d, floorPlan, images, metrics, boqTotalGfa } = result;

  const hasTerminalArtifact =
    Boolean(video) || Boolean(model3d) || Boolean(floorPlan) || images.length > 0 || metrics.length > 0;

  if ((status.state === "pending" || status.state === "running") && !hasTerminalArtifact) {
    return "skeleton";
  }

  if (video && isVideoPlayable(video.status, video.videoUrl, video.videoJobId)) {
    return "video";
  }

  if (
    model3d &&
    (model3d.kind === "procedural" || model3d.kind === "glb" || model3d.kind === "html-iframe")
  ) {
    return "viewer3d";
  }

  if (floorPlan) {
    return "floorPlan";
  }

  if (images.length > 0) {
    return "image";
  }

  if (metrics.length >= 2 || boqTotalGfa != null) {
    return "kpi";
  }

  return "skeleton";
}

function isVideoPlayable(
  status: "pending" | "rendering" | "complete" | "failed",
  videoUrl: string,
  videoJobId: string | undefined,
): boolean {
  if (status === "complete" && videoUrl.length > 0) return true;
  // The VIDEO_BG_JOBS path resolves URLs inside the SegmentedVideoPlayer —
  // presence of a job id means HeroVideo is the right variant, even if the
  // top-level videoUrl is still empty.
  if (videoJobId && status !== "failed") return true;
  return false;
}
