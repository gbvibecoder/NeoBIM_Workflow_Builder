/**
 * Barrel export for the PDF layout module.
 *
 * Stage 4 imports composers + chrome helpers from here so the
 * orchestrator's import section stays compact.
 */

export * from "./constants";
export * from "./labels";
export * from "./page-chrome";
export { renderCoverPage, type RenderCoverPageArgs } from "./cover";
export {
  renderShotPage,
  type RenderShotPageArgs,
  type ShotImageMimeType,
} from "./per-shot-page";
