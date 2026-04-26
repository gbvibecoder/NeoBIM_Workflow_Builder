/**
 * Pure helper: derives a workflow-type accent palette (gradient + ring colors)
 * from the chosen hero variant. Drives the active-tab underline, hero-CTA
 * accent, and primary KPI text-shadow.
 */

import type { HeroKind } from "@/features/result-page/lib/select-hero";

export interface WorkflowAccent {
  /** Solid base color (hex) */
  base: string;
  /** Background tint with low opacity */
  tint: string;
  /** Border / ring color */
  ring: string;
  /** CSS gradient string suitable for `background: <gradient>` */
  gradient: string;
  /** Soft glow (box-shadow rgba) */
  glow: string;
}

const ACCENTS: Record<HeroKind, WorkflowAccent> = {
  failure: {
    base: "#EF4444",
    tint: "rgba(239,68,68,0.10)",
    ring: "rgba(239,68,68,0.40)",
    gradient: "linear-gradient(135deg, rgba(239,68,68,0.18) 0%, rgba(239,68,68,0.05) 100%)",
    glow: "0 8px 32px rgba(239,68,68,0.18)",
  },
  pending: {
    base: "#00F5FF",
    tint: "rgba(0,245,255,0.08)",
    ring: "rgba(0,245,255,0.35)",
    gradient: "linear-gradient(135deg, rgba(0,245,255,0.18) 0%, rgba(0,245,255,0.05) 100%)",
    glow: "0 8px 32px rgba(0,245,255,0.20)",
  },
  video: {
    base: "#A78BFA",
    tint: "rgba(167,139,250,0.10)",
    ring: "rgba(167,139,250,0.40)",
    gradient: "linear-gradient(135deg, rgba(139,92,246,0.20) 0%, rgba(168,85,247,0.10) 100%)",
    glow: "0 12px 36px rgba(139,92,246,0.22)",
  },
  "floor-plan-interactive": {
    base: "#00F5FF",
    tint: "rgba(0,245,255,0.08)",
    ring: "rgba(0,245,255,0.35)",
    gradient: "linear-gradient(135deg, rgba(0,245,255,0.16) 0%, rgba(79,138,255,0.08) 100%)",
    glow: "0 12px 36px rgba(0,245,255,0.20)",
  },
  "3d-model": {
    base: "#10B981",
    tint: "rgba(16,185,129,0.10)",
    ring: "rgba(16,185,129,0.40)",
    gradient: "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(20,184,166,0.08) 100%)",
    glow: "0 12px 36px rgba(16,185,129,0.20)",
  },
  "floor-plan-svg": {
    base: "#14B8A6",
    tint: "rgba(20,184,166,0.10)",
    ring: "rgba(20,184,166,0.40)",
    gradient: "linear-gradient(135deg, rgba(20,184,166,0.16) 0%, rgba(99,102,241,0.06) 100%)",
    glow: "0 12px 36px rgba(20,184,166,0.20)",
  },
  boq: {
    base: "#00F5FF",
    tint: "rgba(0,245,255,0.10)",
    ring: "rgba(0,245,255,0.40)",
    gradient: "linear-gradient(135deg, rgba(0,245,255,0.18) 0%, rgba(79,138,255,0.10) 100%)",
    glow: "0 12px 40px rgba(0,245,255,0.22)",
  },
  image: {
    base: "#10B981",
    tint: "rgba(16,185,129,0.08)",
    ring: "rgba(16,185,129,0.32)",
    gradient: "linear-gradient(135deg, rgba(16,185,129,0.14) 0%, rgba(99,102,241,0.06) 100%)",
    glow: "0 8px 32px rgba(16,185,129,0.18)",
  },
  clash: {
    base: "#F59E0B",
    tint: "rgba(245,158,11,0.10)",
    ring: "rgba(245,158,11,0.40)",
    gradient: "linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(239,68,68,0.08) 100%)",
    glow: "0 12px 36px rgba(245,158,11,0.20)",
  },
  table: {
    base: "#6366F1",
    tint: "rgba(99,102,241,0.10)",
    ring: "rgba(99,102,241,0.35)",
    gradient: "linear-gradient(135deg, rgba(99,102,241,0.16) 0%, rgba(139,92,246,0.06) 100%)",
    glow: "0 8px 32px rgba(99,102,241,0.18)",
  },
  text: {
    base: "#8B5CF6",
    tint: "rgba(139,92,246,0.10)",
    ring: "rgba(139,92,246,0.35)",
    gradient: "linear-gradient(135deg, rgba(139,92,246,0.14) 0%, rgba(99,102,241,0.06) 100%)",
    glow: "0 8px 32px rgba(139,92,246,0.18)",
  },
  generic: {
    base: "#9090A8",
    tint: "rgba(144,144,168,0.08)",
    ring: "rgba(144,144,168,0.30)",
    gradient: "linear-gradient(135deg, rgba(144,144,168,0.10) 0%, rgba(60,60,80,0.04) 100%)",
    glow: "0 6px 24px rgba(0,0,0,0.30)",
  },
};

export function getWorkflowAccent(kind: HeroKind): WorkflowAccent {
  return ACCENTS[kind] ?? ACCENTS.generic;
}
