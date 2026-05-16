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
  BriefEnrichmentResult,
  GeneratorResult,
  AgentTokenLedgerEntry,
  AgentTurnRecord,
  SandboxExecResult,
  SandboxValidateResult,
  SandboxSummaryResult,
  SandboxFinalizeResult,
} from "./types";

export {
  briefSpecSchema,
  briefProjectSchema,
  briefSiteSchema,
  briefSpaceSchema,
  briefElementSchema,
  briefMaterialSchema,
} from "./types";

export {
  isBriefToIfcV3MasterEnabled,
  isBriefToIfcV3AdminOverride,
  shouldUseBriefToIfcV3,
} from "./canary";

export { enrichBrief } from "./brief-enrichment";
export { runGenerator } from "./generator/driver";
