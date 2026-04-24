import { ACCENT_MAP } from "@/features/results-v2/constants";
import type { AccentGradient, ExecutionResult } from "@/features/results-v2/types";

/**
 * Derive the accent gradient for a result from the terminal node's
 * catalogue prefix. Hero vignette, ribbon glow, counter glow, primary
 * button fills all read from this single source.
 */
export function pickAccent(result: ExecutionResult): AccentGradient {
  if (result.video) return ACCENT_MAP.video;
  if (result.model3d) return ACCENT_MAP.ifc;
  if (result.floorPlan) return ACCENT_MAP.ifc;
  if (result.boqTotalGfa != null) return ACCENT_MAP.boq;
  if (result.images.length > 0) return ACCENT_MAP.image;
  return ACCENT_MAP.default;
}

/** CSS linear-gradient for a full-bleed vignette overlay. */
export function accentLinearGradient(accent: AccentGradient, opacity = 0.28): string {
  return `linear-gradient(135deg, ${withAlpha(accent.start, opacity)}, ${withAlpha(accent.end, opacity)})`;
}

/** CSS radial gradient used by HeroSkeleton and HeroKPI background mesh. */
export function accentRadial(accent: AccentGradient, opacity = 0.22): string {
  return `radial-gradient(60% 80% at 30% 20%, ${withAlpha(accent.start, opacity)} 0%, transparent 60%), radial-gradient(50% 70% at 75% 75%, ${withAlpha(accent.end, opacity)} 0%, transparent 55%)`;
}

function withAlpha(hex: string, alpha: number): string {
  // hex is always `#RRGGBB` in our accent map
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
