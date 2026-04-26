/**
 * Pure helper: maps a normalized showcase data shape to one of the hero
 * variant kinds the redesigned wrapper renders. Replaces the old
 * useHeroDetection priority chain with a clearer, lifecycle-aware pick.
 *
 * Priority chain (highest first):
 *   failure   — exec.status === "failed" with no usable artifact
 *   pending   — a video is currently submitting/processing/rendering
 *   video     — a complete video artifact landed
 *   floor-plan-interactive — GN-012 produced an editable CAD project
 *   3d-model  — GLB / procedural / html-iframe model
 *   floor-plan-svg         — SVG-only floor plan
 *   boq       — TR-008 produced a BOQ summary (boqSummary set)
 *   image     — at least one image artifact
 *   clash     — TR-016 produced a clash report
 *   table     — generic tabular artifact
 *   text      — text artifact only
 *   generic   — nothing distinctive
 */

import type { ResultPageData } from "@/features/result-page/hooks/useResultPageData";

export type HeroKind =
  | "failure"
  | "pending"
  | "video"
  | "floor-plan-interactive"
  | "3d-model"
  | "floor-plan-svg"
  | "boq"
  | "image"
  | "clash"
  | "table"
  | "text"
  | "generic";

export function selectHero(data: ResultPageData): HeroKind {
  // 1. Hard-failure: status FAILED with no artifacts → failure hero with errorMessage
  if (data.lifecycle === "failed" && data.totalArtifacts === 0) return "failure";

  // 2. Pending video render (the "Initializing 5%" state replacement)
  if (data.isVideoGenerating) return "pending";

  // 3. Completed video wins over everything else
  if (data.videoData?.videoUrl) return "video";

  // 4. Interactive floor plan (full CAD project from GN-012)
  if (data.model3dData?.kind === "floor-plan-interactive") return "floor-plan-interactive";

  // 5. Any 3D model (GLB / procedural / html-iframe)
  if (data.model3dData) return "3d-model";

  // 6. SVG-only floor plan
  if (data.svgContent && !data.model3dData) return "floor-plan-svg";

  // 7. BOQ — promoted to hero per Phase 1 D1 (any TR-008 result)
  if (data.boqSummary) return "boq";

  // 8. Clash report — NEW per D3
  if (data.clashSummary) return "clash";

  // 9. Image-only workflows
  if (data.allImageUrls.length > 0) return "image";

  // 10. Table data
  if (data.tableData.length > 0) return "table";

  // 11. Text content
  if (data.textContent) return "text";

  return "generic";
}
