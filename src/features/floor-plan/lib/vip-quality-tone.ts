/**
 * Phase 2.7A — pure banner-tone helper shared by FloorPlanViewer and its
 * unit tests. Given a VIP quality score + stamped recommendation, pick
 * the banner colour. The contract mirrors the thresholds in
 * `stage-7-deliver.ts`'s `deriveQualityRecommendation`:
 *
 *   score >= 80 OR recommendation === "pass"  → "green"
 *   score >= 65 OR recommendation === "retry" → "yellow"
 *   score <  65 OR recommendation === "fail"  → "red"
 *
 * The OR is intentional. If Stage 6 ever emits a recommendation that
 * disagrees with its own score (LLM being conservative, manual override
 * later), the harsher verdict wins — we never tell the user their
 * layout is great when any signal says otherwise.
 */

export type VipQualityTone = "red" | "yellow" | "green";
export type VipQualityRecommendation = "pass" | "retry" | "fail";

export function vipQualityTone(
  score: number | null,
  recommendation: VipQualityRecommendation | null,
): VipQualityTone {
  // Red — hardest verdict, anything flagging failure.
  if (recommendation === "fail") return "red";
  if (typeof score === "number" && Number.isFinite(score) && score < 65) return "red";
  // Yellow — retry band.
  if (recommendation === "retry") return "yellow";
  if (typeof score === "number" && Number.isFinite(score) && score < 80) return "yellow";
  // Green — either an explicit "pass" or an unambiguous score >= 80.
  // If BOTH score and recommendation are null, we return "green" because
  // FloorPlanViewer gates the VIP banner on vipQualityScore !== null — we
  // shouldn't reach here with null score in practice.
  return "green";
}

export interface VipQualityBannerState {
  tone: VipQualityTone;
  headline: string;
  score: number | null;
}

export function vipQualityBannerState(
  score: number | null,
  recommendation: VipQualityRecommendation | null,
): VipQualityBannerState {
  const tone = vipQualityTone(score, recommendation);
  const scoreLabel = typeof score === "number" ? ` (score ${Math.round(score)}/100)` : "";
  let headline: string;
  if (tone === "red") headline = `Quality check FAILED${scoreLabel}`;
  else if (tone === "yellow") headline = `Quality below target${scoreLabel}`;
  else headline = `Quality passed${scoreLabel}`;
  return { tone, headline, score };
}
