import type {
  DiscoveryOption,
  ProfessionOption,
  TeamSizeOption,
} from "@/features/onboarding-survey/types/survey";

// ── Scene 1: Discovery sources ─────────────────────────────────────────────
export const DISCOVERY_OPTIONS: DiscoveryOption[] = [
  { id: "social",      emoji: "📸",  labelKey: "survey.discovery.social",      subtitleKey: "survey.discovery.socialSub",      colorRgb: "225, 48, 108",  reaction: "spin"    },
  { id: "linkedin",    emoji: "🕵️",  labelKey: "survey.discovery.linkedin",    subtitleKey: "survey.discovery.linkedinSub",    colorRgb: "10, 102, 194",  reaction: "scan"    },
  { id: "twitter",     emoji: "🐦",  labelKey: "survey.discovery.twitter",     subtitleKey: "survey.discovery.twitterSub",     colorRgb: "29, 161, 242",  reaction: "bounce"  },
  { id: "friend",      emoji: "👥",  labelKey: "survey.discovery.friend",      subtitleKey: "survey.discovery.friendSub",      colorRgb: "16, 185, 129",  reaction: "wave"    },
  { id: "google",      emoji: "🔍",  labelKey: "survey.discovery.google",      subtitleKey: "survey.discovery.googleSub",      colorRgb: "234, 67, 53",   reaction: "pulse"   },
  { id: "accident",    emoji: "🎲",  labelKey: "survey.discovery.accident",    subtitleKey: "survey.discovery.accidentSub",    colorRgb: "245, 158, 11",  reaction: "shuffle" },
  { id: "youtube",     emoji: "📺",  labelKey: "survey.discovery.youtube",     subtitleKey: "survey.discovery.youtubeSub",     colorRgb: "255, 0, 0",     reaction: "wink"    },
  { id: "ai",          emoji: "🤖",  labelKey: "survey.discovery.ai",          subtitleKey: "survey.discovery.aiSub",          colorRgb: "0, 245, 255",   reaction: "sparkle" },
  { id: "other",       emoji: "✏️",  labelKey: "survey.discovery.other",       subtitleKey: "survey.discovery.otherSub",       colorRgb: "156, 163, 175", reaction: "edit", isOther: true },
];

// ── Scene 2: Profession ─────────────────────────────────────────────────────
export const PROFESSION_OPTIONS: ProfessionOption[] = [
  { id: "architect",          emoji: "🏛️",  labelKey: "survey.profession.architect",          subtitleKey: "survey.profession.architectSub",          colorRgb: "79, 138, 255"  },
  { id: "construction",       emoji: "🏗️",  labelKey: "survey.profession.construction",       subtitleKey: "survey.profession.constructionSub",       colorRgb: "245, 158, 11"  },
  { id: "structural",         emoji: "📐",  labelKey: "survey.profession.structural",         subtitleKey: "survey.profession.structuralSub",         colorRgb: "139, 92, 246"  },
  { id: "qs",                 emoji: "💰",  labelKey: "survey.profession.qs",                 subtitleKey: "survey.profession.qsSub",                 colorRgb: "16, 185, 129"  },
  { id: "pm",                 emoji: "📋",  labelKey: "survey.profession.pm",                 subtitleKey: "survey.profession.pmSub",                 colorRgb: "6, 182, 212"   },
  { id: "student",            emoji: "🎓",  labelKey: "survey.profession.student",            subtitleKey: "survey.profession.studentSub",            colorRgb: "236, 72, 153"  },
  { id: "bim",                emoji: "💻",  labelKey: "survey.profession.bim",                subtitleKey: "survey.profession.bimSub",                colorRgb: "0, 245, 255"   },
  { id: "developer",          emoji: "🏢",  labelKey: "survey.profession.developer",          subtitleKey: "survey.profession.developerSub",          colorRgb: "212, 149, 106" },
  { id: "other",              emoji: "✏️",  labelKey: "survey.profession.other",              subtitleKey: "survey.profession.otherSub",              colorRgb: "156, 163, 175", isOther: true },
];

// ── Scene 3: Team size ──────────────────────────────────────────────────────
export const TEAM_SIZE_OPTIONS: TeamSizeOption[] = [
  { id: "solo",      emoji: "🧑",  labelKey: "survey.teamSize.solo",      illustrationKey: "solo",      colorRgb: "79, 138, 255"  },
  { id: "squad",     emoji: "👥",  labelKey: "survey.teamSize.squad",     illustrationKey: "squad",     colorRgb: "16, 185, 129"  },
  { id: "company",   emoji: "🏢",  labelKey: "survey.teamSize.company",   illustrationKey: "company",   colorRgb: "245, 158, 11"  },
  { id: "academic",  emoji: "🔬",  labelKey: "survey.teamSize.academic",  illustrationKey: "academic",  colorRgb: "139, 92, 246"  },
  { id: "browsing",  emoji: "🤷",  labelKey: "survey.teamSize.browsing",  illustrationKey: "exploring", colorRgb: "212, 149, 106" },
];

// ── Scene backdrop palette shifts ──────────────────────────────────────────
// Each scene has a signature palette that drives the animated mesh.
export const SCENE_PALETTES: Record<1 | 2 | 3 | 4, { primary: string; secondary: string; glow: string }> = {
  1: { primary: "79, 138, 255",  secondary: "99, 102, 241", glow: "139, 92, 246"  },  // cool blue → indigo
  2: { primary: "139, 92, 246",  secondary: "168, 85, 247", glow: "236, 72, 153"  },  // violet → pink
  3: { primary: "16, 185, 129",  secondary: "6, 182, 212",  glow: "34, 197, 94"   },  // green → teal
  4: { primary: "245, 158, 11",  secondary: "212, 149, 106", glow: "255, 191, 0"  },  // amber → copper
};

// localStorage key used by OnboardingModal on /dashboard. When survey
// completes or is skipped, we write this so users don't see two
// onboardings back-to-back.
export const DASHBOARD_ONBOARDED_KEY = "buildflow_dashboard_onboarded";
