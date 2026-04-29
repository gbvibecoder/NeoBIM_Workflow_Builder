/**
 * Floor-plan local re-export of the cross-cutting `useFeatureFlags`.
 *
 * Kept as a re-export so existing call sites in this feature don't have
 * to change paths. New consumers (and any cross-feature code) should
 * import from `@/hooks/useFeatureFlags` directly.
 */

export { useFeatureFlags } from "@/hooks/useFeatureFlags";
export type { FeatureFlags } from "@/hooks/useFeatureFlags";
