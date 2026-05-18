/**
 * Brief-to-IFC v3 — public surface.
 *
 * Entry points the API routes / canvas wiring import. The feature
 * folder is otherwise internal: anything not re-exported here is
 * implementation detail.
 */

export type {
  BriefSpec,
  BriefSpace,
  BriefElement,
  BriefMaterial,
  BriefFurniture,
  FurniturePart,
  BriefEnrichmentResult,
  GeneratorResult,
  AgentTokenLedgerEntry,
  AgentTurnRecord,
  SandboxExecResult,
  SandboxValidateResult,
  SandboxSummaryResult,
  SandboxFinalizeResult,
  DesignRationale,
  TrimItem,
  VisionIssue,
  VisionReport,
} from "./types";

export {
  briefSpecSchema,
  briefProjectSchema,
  briefSiteSchema,
  briefSpaceSchema,
  briefElementSchema,
  briefMaterialSchema,
  furniturePartSchema,
  designRationaleSchema,
  trimItemSchema,
  visionIssueSchema,
  visionReportSchema,
} from "./types";

export {
  isBriefToIfcV3MasterEnabled,
  isBriefToIfcV3AdminOverride,
  shouldUseBriefToIfcV3,
} from "./canary";

export { enrichBrief } from "./brief-enrichment";
export { runGenerator } from "./generator/driver";
export { decomposeBriefSpecItems } from "./item-decomposer";
export type { DecomposerMetrics, DecomposerResult } from "./item-decomposer";
export { applyArchitecturalReasoning } from "./architectural-reasoner";
export { applyTrimSpecification } from "./trim-specifier";
export { resolveMaterials } from "./material-resolver";
export { validateSpec } from "./spec-validator-node";
export { inspectIFC } from "./vision-inspector";
