/**
 * Workflow-type accent palette (light theme — Phase 2).
 *
 * Maps each hero variant to a small palette compatible with the BOQ
 * visualizer's design language: white card, soft tint background, restrained
 * brand color. Replaces Phase 1's dark glass gradients.
 */

import type { HeroKind } from "@/features/result-page/lib/select-hero";

export interface WorkflowAccent {
  /** Solid brand color (hex) — used for icons, dividers, hero KPI text */
  base: string;
  /** Soft background tint — used as icon-tile fill */
  tint: string;
  /** Border color (used for ring around icon tiles, accent stripes) */
  ring: string;
  /** A 2px top accent stripe gradient (matches BOQ HeroStats top stripe) */
  stripe: string;
  /** A subtle radial halo behind the hero, alpha kept under 8% */
  halo: string;
}

const ACCENTS: Record<HeroKind, WorkflowAccent> = {
  failure: {
    base: "#DC2626",
    tint: "#FEE2E2",
    ring: "rgba(220,38,38,0.18)",
    stripe: "linear-gradient(90deg, #DC2626, #DC262640, transparent)",
    halo: "rgba(220,38,38,0.06)",
  },
  pending: {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.20)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.08)",
  },
  video: {
    base: "#7C3AED",
    tint: "#F5F3FF",
    ring: "rgba(124,58,237,0.18)",
    stripe: "linear-gradient(90deg, #7C3AED, #7C3AED40, transparent)",
    halo: "rgba(124,58,237,0.06)",
  },
  "floor-plan-interactive": {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.20)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.06)",
  },
  "3d-model": {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.20)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.06)",
  },
  "floor-plan-svg": {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.20)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.06)",
  },
  boq: {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.22)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.10)",
  },
  image: {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.18)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.05)",
  },
  clash: {
    base: "#D97706",
    tint: "#FEF3C7",
    ring: "rgba(217,119,6,0.20)",
    stripe: "linear-gradient(90deg, #D97706, #D9770640, transparent)",
    halo: "rgba(217,119,6,0.07)",
  },
  table: {
    base: "#1E40AF",
    tint: "#EFF6FF",
    ring: "rgba(30,64,175,0.18)",
    stripe: "linear-gradient(90deg, #1E40AF, #1E40AF40, transparent)",
    halo: "rgba(30,64,175,0.06)",
  },
  text: {
    base: "#0D9488",
    tint: "#F0FDFA",
    ring: "rgba(13,148,136,0.18)",
    stripe: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
    halo: "rgba(13,148,136,0.05)",
  },
  generic: {
    base: "#4B5563",
    tint: "#F3F4F6",
    ring: "rgba(75,85,99,0.18)",
    stripe: "linear-gradient(90deg, #4B5563, #4B556340, transparent)",
    halo: "rgba(75,85,99,0.04)",
  },
};

export function getWorkflowAccent(kind: HeroKind): WorkflowAccent {
  return ACCENTS[kind] ?? ACCENTS.generic;
}
