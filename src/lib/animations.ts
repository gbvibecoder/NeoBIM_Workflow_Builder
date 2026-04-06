/**
 * Shared Framer Motion animation variants for the BuildFlow design system.
 * Import these instead of defining ad-hoc variants per component.
 */
import type { Variants, Transition } from "framer-motion";

// ── Transitions ─────────────────────────────────────────────────────

export const springTransition: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 25,
};

export const gentleSpring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 20,
};

export const smoothEase: Transition = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1],
};

// ── Page transitions ────────────────────────────────────────────────

export const pageVariants: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

export const pageTransition: Transition = {
  duration: 0.3,
  ease: "easeOut",
};

// ── Stagger container ───────────────────────────────────────────────

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
};

// ── Stagger children ────────────────────────────────────────────────

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

export const fadeInScale: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

// ── Interactive ─────────────────────────────────────────────────────

export const hoverLift = {
  whileHover: { y: -4, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
  whileTap: { y: 0, scale: 0.98, transition: { duration: 0.1 } },
};

export const hoverScale = {
  whileHover: { scale: 1.02, transition: springTransition },
  whileTap: { scale: 0.98, transition: { duration: 0.1 } },
};

export const hoverGlow = {
  whileHover: {
    boxShadow: "0 0 24px rgba(108, 92, 231, 0.3), 0 8px 32px rgba(0, 0, 0, 0.3)",
    transition: smoothEase,
  },
};

// ── Modal / Overlay ─────────────────────────────────────────────────

export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 400, damping: 30 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 8,
    transition: { duration: 0.2, ease: "easeIn" },
  },
};

// ── Pulse (for active indicators) ───────────────────────────────────

export const pulseVariants: Variants = {
  initial: { scale: 1, opacity: 0.8 },
  animate: {
    scale: [1, 1.15, 1],
    opacity: [0.8, 1, 0.8],
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
  },
};

// ── Text reveal ─────────────────────────────────────────────────────

export const textRevealContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03 },
  },
};

export const textRevealChar: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};
