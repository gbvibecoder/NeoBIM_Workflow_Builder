/**
 * Survey motion vocabulary.
 *
 * Every spring config here matches a pattern already shipped elsewhere in the
 * codebase (Button primitive, OnboardingModal, thank-you reveal, ChatBubble,
 * landing sections) — deliberately. Consistency > novelty.
 */
import type { Transition, Variants } from "framer-motion";

// ── Canonical spring configs (lifted from existing component patterns) ─────
export const SPRING: Record<string, Transition> = {
  // Button primitive (src/shared/components/ui/Button.tsx)
  snappy:      { type: "spring", stiffness: 400, damping: 25 },
  // OnboardingModal (src/features/onboarding/components/OnboardingModal.tsx)
  smooth:      { type: "spring", stiffness: 300, damping: 30 },
  // ChatBubbleButton
  bouncy:      { type: "spring", stiffness: 400, damping: 17 },
  // thank-you / feedback success reveal
  celebration: { type: "spring", stiffness: 200, damping: 12 },
  // Survey-specific fluid transition: damping ratio ≈ 0.85 (per spec)
  fluid:       { type: "spring", stiffness: 100, damping: 18, mass: 0.9 },
};

export const EASE_OUT_EXPO: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Scene transition ────────────────────────────────────────────────────────
export const sceneSlide: Variants = {
  initial: { x: 80, opacity: 0, filter: "blur(6px)" },
  animate: { x: 0,  opacity: 1, filter: "blur(0px)", transition: SPRING.fluid },
  exit:    { x: -80, opacity: 0, filter: "blur(6px)", transition: SPRING.fluid },
};

// ── Card entrance stagger ────────────────────────────────────────────────────
export const cardContainer: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } },
};
export const cardItem: Variants = {
  hidden:  { opacity: 0, y: 24, scale: 0.94, filter: "blur(4px)" },
  visible: {
    opacity: 1, y: 0, scale: 1, filter: "blur(0px)",
    transition: { type: "spring", stiffness: 180, damping: 14 },
  },
};

// ── Card select (haptic overshoot) ──────────────────────────────────────────
export const cardSelectAnimation = {
  scale: [1, 1.08, 1],
  transition: { duration: 0.45, times: [0, 0.4, 1], ease: EASE_OUT_EXPO },
};

// ── Card hover tilt (3D — matches Card primitive's tilt variant) ───────────
export const cardHoverTilt = {
  whileHover: {
    y: -6, rotateX: 3, rotateY: -3, scale: 1.015,
    transition: SPRING.snappy,
  },
  style: {
    transformStyle: "preserve-3d" as const,
    perspective: 1000,
  },
};

// ── Progress dot heartbeat (completed-dot transient expand/contract) ────────
export const dotHeartbeat = {
  animate: { scale: [1, 1.3, 1] },
  transition: { duration: 0.6, ease: EASE_OUT_EXPO },
};

// ── Text entrance (fade-up + blur-to-sharp pull-focus) ──────────────────────
export const textPullFocus: Variants = {
  initial: { opacity: 0, y: 12, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0,  filter: "blur(0px)",
             transition: { duration: 0.55, ease: EASE_OUT_EXPO } },
};

// ── Confetti particle factory (scene 3 → 4 transition) ──────────────────────
export function confettiParticle(i: number, seed = 0.5) {
  const angle = i * 0.55 + seed;
  const dist = 90 + (i % 6) * 26;
  return {
    initial: { opacity: 0, scale: 0, x: 0, y: 0, rotate: 0 },
    animate: {
      opacity: [0, 1, 0],
      scale:   [0, 1.1, 0.8],
      x:  Math.cos(angle) * dist,
      y:  Math.sin(angle) * dist - 40,
      rotate: (i % 2 ? 1 : -1) * (180 + (i % 4) * 60),
    },
    transition: {
      duration: 1.1 + (i % 4) * 0.1,
      ease: EASE_OUT_EXPO,
      delay: i * 0.015,
    },
  };
}
