import type { AccentGradient, AccentKind } from "@/features/results-v2/types";

export const MOTION = {
  entrance: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number], stagger: 0.06 },
  heroReveal: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  /** Spring tuning for counters, derived in Phase D to land with a ~3% micro-overshoot. */
  counterSpring: { stiffness: 80, damping: 14, mass: 1 },
  hoverLift: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  panelSwitch: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  microBounce: { duration: 0.12 },
  /** One-frame chromatic aberration on hero first-frame reveal. */
  chromatic: { durationMs: 120 },
  /** Prime-number periods for the 4-radial breathing mesh (in seconds). */
  meshPeriods: [17, 23, 29, 31] as const,
  /** Skeleton copy rotation cadence. */
  skeletonCopyRotateMs: 6000,
  /** Dual progress bar sweep cycle. */
  progressSweepMs: 1800,
} as const;

export const NEUTRAL = {
  BG_BASE: "#070809",
  BG_ELEVATED: "#0E1014",
  BG_SURFACE: "rgba(255,255,255,0.03)",
  BORDER_SUBTLE: "rgba(255,255,255,0.06)",
  BORDER_STRONG: "rgba(255,255,255,0.12)",
  TEXT_PRIMARY: "#F5F5FA",
  TEXT_SECONDARY: "#B8B8C8",
  TEXT_MUTED: "#9090A8",
} as const;

/**
 * Workflow accent map — every endpoint has HSL saturation ≥ 80%.
 * Verified against the Phase D.C.8 audit: the palette is "lived-in", not muted.
 *
 *   violet #8B5CF6  sat 93%  · cyan #06B6D4  sat 95%
 *   emerald #10B981 sat 84%  · amber #F59E0B sat 92%
 *   blue #3B82F6    sat 91%  · indigo #6366F1 sat 85%
 *   amber #F59E0B   sat 92%  · rose #F43F5E   sat 89%
 *   cyan #00F5FF    sat 100% · violet #8B5CF6 sat 93%
 *
 * Floor-plan override (warm sunset — amber → rose) is applied inside
 * HeroFloorPlan; the workflow-accent entry stays as the caller requested.
 */
export const ACCENT_MAP: Record<AccentKind, AccentGradient> = {
  video: { kind: "video", start: "#8B5CF6", end: "#06B6D4" },
  image: { kind: "image", start: "#10B981", end: "#F59E0B" },
  ifc: { kind: "ifc", start: "#3B82F6", end: "#6366F1" },
  boq: { kind: "boq", start: "#F59E0B", end: "#F43F5E" },
  default: { kind: "default", start: "#00F5FF", end: "#8B5CF6" },
};

/** Warm floor-plan palette — overrides workflow accent for HeroFloorPlan. */
export const FLOOR_PLAN_ACCENT: AccentGradient = {
  kind: "default",
  start: "#F59E0B",
  end: "#F43F5E",
};

export const BREAKPOINTS = {
  mobileMax: 767,
  tabletMax: 1279,
};

export const HERO_HEIGHT = {
  desktop: "65vh",
  tablet: "55vh",
  mobile: "82vh",
};

/** Cycled copy for HeroSkeleton — locks on the last line once progress > 85. */
export const SKELETON_COPY_VIDEO = [
  "Rendering cinematic walkthrough",
  "Composing the final cut",
  "Polishing the frames",
  "Almost there",
] as const;

export const SKELETON_COPY_IMAGE = [
  "Generating renders",
  "Sampling light and materials",
  "Refining details",
  "Almost there",
] as const;

export const SKELETON_COPY_DEFAULT = [
  "Preparing your result",
  "Wiring up the final stitches",
  "Making it cinematic",
  "Almost there",
] as const;
