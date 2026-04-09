/**
 * Aggregated dependency re-exports for the execute-node handlers.
 *
 * Each handler imports the symbols it needs from THIS module, so handler
 * bodies can be lifted verbatim from the original route.ts without rewriting
 * any function calls. The bundler tree-shakes unused re-exports.
 *
 * IMPORTANT: this is a STRUCTURAL convenience — it exists because the
 * decomposition refactor must not change any business logic, only file
 * organisation. Do not add new functionality here.
 */

// Next.js / framework
export { NextResponse } from "next/server";

// Project-internal
export { generateId } from "@/lib/utils";
export { logger } from "@/lib/logger";
export {
  APIError,
  UserErrors,
  formatErrorResponse,
} from "@/lib/user-errors";
export { assertValidInput } from "@/lib/validation";
export {
  logRateLimit,
  logNodeStart,
  logNodeSuccess,
  logNodeError,
  logValidationError,
  logInfo,
} from "@/lib/workflow-logger";
export { uploadBase64ToR2 } from "@/lib/r2";
export {
  findUnitRate,
  applyRegionalFactor,
  calculateTotalCost,
  calculateLineItemCost,
  calculateEscalation,
  detectProjectType,
  COST_DISCLAIMERS,
  buildDynamicDisclaimer,
  getWasteFactor,
  getCostBreakdown,
} from "@/features/boq/lib/cost-database";
export { VIDEO_NODES, MODEL_3D_NODES, RENDER_NODES, getNodeTypeLimits } from "@/lib/stripe";

// Services
export {
  generateBuildingDescription,
  generateConceptImage,
  generateRenovationRender,
  generateFloorPlan,
  parseBriefDocument,
  analyzeImage,
  enhanceArchitecturalPrompt,
  validateRenderWithClaude,
} from "@/features/ai/services/openai";
export type { BuildingDescription, RenderQAResult } from "@/features/ai/services/openai";
export { analyzeSite } from "@/features/ai/services/site-analysis";
export { generatePDFBase64 } from "@/services/pdf-report-server";
export { reconstructHiFi3D, isMeshyConfigured } from "@/features/3d-render/services/meshy-service";
export { generateMassingGeometry } from "@/features/3d-render/services/massing-generator";
export {
  generate3DModel,
  is3DAIConfigured,
  calculateKPIs,
} from "@/features/3d-render/services/threedai-studio";
export type { BuildingRequirements } from "@/features/3d-render/services/threedai-studio";
export { generateWithMeshy, isMeshyTextTo3DConfigured } from "@/features/3d-render/services/meshy-ai";
export { generateIFCFile } from "@/features/ifc/services/ifc-exporter";
export { parsePromptToStyle } from "@/features/3d-render/services/prompt-style-parser";
export { extractMetadata } from "@/features/ai/services/metadata-extractor";
export {
  submitDualWalkthrough,
  submitDualTextToVideo,
  submitSingleWalkthrough,
  submitFloorPlanWalkthrough,
  buildFloorPlanCombinedPrompt,
} from "@/features/3d-render/services/video-service";

// Types
export type { ExecutionArtifact } from "@/types/execution";

// Local shared helpers (lifted from the pre-decomposition route.ts file)
export {
  detectRegionFromText,
  extractBuildingTypeFromText,
  formatBuildingDescription,
} from "./shared";
