import { pushToDataLayer } from "@/lib/gtm";
import {
  trackInitiateCheckout,
  trackLead,
  trackViewContent,
} from "@/lib/meta-pixel";
import type { PricingAction } from "@/features/onboarding-survey/types/survey";

// ── Funnel impressions ─────────────────────────────────────────────────
export function trackSurveyStart() {
  pushToDataLayer("survey_start");
}

export function trackSceneView(
  scene_number: 1 | 2 | 3 | 4,
  scene_name: "discovery" | "profession" | "team_size" | "pricing"
) {
  pushToDataLayer("survey_scene_view", { scene_number, scene_name });
}

// ── Scene completions (per-scene + kept as granular per-field events) ─
export function trackDiscovery(source: string) {
  pushToDataLayer("survey_discovery", { source });
  pushToDataLayer("survey_scene_complete", {
    scene_number: 1,
    scene_name: "discovery",
    answer: source,
  });
}

export function trackProfession(profession: string) {
  pushToDataLayer("survey_profession", { profession });
  pushToDataLayer("survey_scene_complete", {
    scene_number: 2,
    scene_name: "profession",
    answer: profession,
  });
}

export function trackTeamSize(team_size: string) {
  pushToDataLayer("survey_team_size", { team_size });
  pushToDataLayer("survey_scene_complete", {
    scene_number: 3,
    scene_name: "team_size",
    answer: team_size,
  });
}

// ── Pricing scene (impression vs click distinction) ────────────────────
export function trackPricingView() {
  pushToDataLayer("pricing_view");
  // Meta Pixel: user saw pricing page
  trackViewContent({
    content_name: "onboarding_pricing",
    content_category: "pricing",
    content_type: "product_group",
  });
}

export function trackPricingClick(plan: "free" | "pro") {
  pushToDataLayer("pricing_cta_click", { plan });
  // Pro click = InitiateCheckout conversion signal (Meta + GA4).
  if (plan === "pro") {
    trackInitiateCheckout({
      value: 499,
      currency: "INR",
      content_name: "pro_plan",
      content_category: "onboarding",
    });
  }
}

// ── Legacy pricing-action event (kept for backward-compatible GTM tags) ─
export function trackPricing(action: PricingAction) {
  pushToDataLayer("survey_pricing", { action });
}

// ── Skip ───────────────────────────────────────────────────────────────
export function trackSkip(scene: 1 | 2 | 3 | 4) {
  pushToDataLayer("survey_skip", { scene });
}

// ── Terminal completion ────────────────────────────────────────────────
interface SurveyProfile {
  discovery_source?: string | null;
  profession?: string | null;
  team_size?: string | null;
  pricing_action?: string | null;
}

/**
 * Fires when the user picks a plan on Scene 4 (the only "real" completion path).
 * Pushes THREE things:
 *   1. survey_complete — terminal event with total_time_seconds + full profile,
 *      so one conversion point in GA4 carries all the audience dimensions.
 *   2. Meta Pixel Lead — a qualified lead signal (user gave us role + team size),
 *      more valuable than the earlier CompleteRegistration event.
 *   3. user_properties_set — audience-segmentation properties so GTM can forward
 *      to GA4 User Properties (profession, team size, discovery source) and
 *      Google Ads can build audiences like "all architects" / "small teams".
 */
export function trackComplete(total_time_seconds: number, profile: SurveyProfile) {
  const profileClean: Record<string, string | number> = { total_time_seconds };
  if (profile.discovery_source) profileClean.discovery_source = profile.discovery_source;
  if (profile.profession) profileClean.profession = profile.profession;
  if (profile.team_size) profileClean.team_size = profile.team_size;
  if (profile.pricing_action) profileClean.pricing_action = profile.pricing_action;

  // 1. Terminal funnel event — single payload, full profile.
  pushToDataLayer("survey_complete", profileClean);

  // 2. Meta Pixel Lead — qualified lead (profile survey completed).
  //    Pixel params must be primitives; profession + team_size are user-safe strings.
  const leadParams: Record<string, string> = { content_name: "onboarding_survey_complete" };
  if (profile.profession) leadParams.profession = profile.profession;
  if (profile.team_size) leadParams.team_size = profile.team_size;
  trackLead(leadParams);

  // 3. User properties — separate dataLayer event with user_* prefix so
  //    GTM's GA4 "User Properties" field can pick them up.
  pushToDataLayer("user_properties_set", {
    user_profession: profile.profession ?? undefined,
    user_team_size: profile.team_size ?? undefined,
    user_discovery_source: profile.discovery_source ?? undefined,
    user_survey_completed: true,
  });
}
