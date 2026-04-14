import { pushToDataLayer } from "@/lib/gtm";
import type { PricingAction } from "@/features/onboarding-survey/types/survey";

export function trackDiscovery(source: string) {
  pushToDataLayer("survey_discovery", { source });
}
export function trackProfession(profession: string) {
  pushToDataLayer("survey_profession", { profession });
}
export function trackTeamSize(team_size: string) {
  pushToDataLayer("survey_team_size", { team_size });
}
export function trackPricing(action: PricingAction) {
  pushToDataLayer("survey_pricing", { action });
}
export function trackSkip(scene: 1 | 2 | 3 | 4) {
  pushToDataLayer("survey_skip", { scene });
}
export function trackComplete(total_time_seconds: number) {
  pushToDataLayer("survey_complete", { total_time_seconds });
}
