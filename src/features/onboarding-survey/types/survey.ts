export type SceneNumber = 1 | 2 | 3 | 4;

export type PricingAction =
  | "chose_free"
  | "chose_mini"
  | "chose_starter"
  | "chose_pro"
  | "explore_more"
  | "skipped";

export interface SurveyRecord {
  id?: string;
  userId?: string;
  discoverySource: string | null;
  discoveryOther: string | null;
  profession: string | null;
  professionOther: string | null;
  teamSize: string | null;
  pricingAction: PricingAction | null;
  completedAt: string | null;
  skippedAt: string | null;
  skippedAtScene: number | null;
}

export interface SurveyPatch {
  discoverySource?: string | null;
  discoveryOther?: string | null;
  profession?: string | null;
  professionOther?: string | null;
  teamSize?: string | null;
  pricingAction?: PricingAction | null;
  completedAt?: true;
  skippedAtScene?: number;
}

export interface DiscoveryOption {
  id: string;
  emoji: string;
  labelKey: string;
  subtitleKey: string;
  colorRgb: string;
  reaction:
    | "bounce"
    | "spin"
    | "wave"
    | "wink"
    | "scan"
    | "shuffle"
    | "sparkle"
    | "pulse"
    | "edit";
  isOther?: boolean;
}

export interface ProfessionOption {
  id: string;
  emoji: string;
  labelKey: string;
  subtitleKey: string;
  colorRgb: string;
  isOther?: boolean;
}

export interface TeamSizeOption {
  id: string;
  emoji: string;
  labelKey: string;
  illustrationKey: "solo" | "squad" | "company" | "academic" | "exploring";
  colorRgb: string;
}
