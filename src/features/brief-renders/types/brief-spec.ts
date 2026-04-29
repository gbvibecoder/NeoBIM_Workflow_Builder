/**
 * Public type re-exports for the Brief-to-Renders feature.
 *
 * Consumers outside `services/brief-pipeline/` (Phase 3 dashboard page,
 * Phase 4 worker, Phase 5 PDF compile) import from here so the
 * pipeline-internal `types.ts` can evolve without rippling rename
 * churn through every call site.
 */

export type {
  BaselineSpec,
  ApartmentSpec,
  ShotSpec,
  BriefSpec,
  ShotStatus,
  ShotResult,
  BriefRenderJobConfig,
  BriefStageLogEntry,
} from "@/features/brief-renders/services/brief-pipeline/types";
