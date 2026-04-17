/**
 * Design Tokens — Single source of truth for colors, spacing, radii, and typography.
 * Replaces magic values scattered across 10+ files (#43).
 *
 * Usage:  import { colors, radii, spacing } from "@/constants/design-tokens";
 */

// ─── Brand Colors ────────────────────────────────────────────────────────────

export const colors = {
  // Primary accent
  cyan: "#00F5FF",
  cyanDim: "rgba(0, 245, 255, 0.15)",
  cyanBorder: "rgba(0, 245, 255, 0.3)",
  cyanGlow: "rgba(0, 245, 255, 0.25)",

  // Secondary accent
  copper: "#B87333",
  copperDim: "rgba(184, 115, 51, 0.15)",
  copperBorder: "rgba(184, 115, 51, 0.3)",

  // Backgrounds
  bgDeep: "#06080C",
  bgBase: "#07070D",
  bgCard: "#0A0A0F",
  bgSurface: "#0D0D1A",
  bgElevated: "#12121E",
  bgInput: "rgba(10, 12, 14, 0.7)",

  // Text
  textPrimary: "#F0F0F5",
  textSecondary: "#9898B0",
  textTertiary: "#6B6B80",
  textMuted: "#5C5C78",
  textDim: "#3A3A50",

  // Canvas-node text — WCAG AA guaranteed on rgba(10,12,14,0.75) node bg.
  // Use these inside BaseNode / InputNode content, not textDim/textMuted
  // (those are reserved for disabled/placeholder on lighter surfaces).
  nodeText: {
    primary:   "#F2F4F8",   // values, filenames                      — 14:1
    value:     "#E6E9F0",   // dropdown selection, parameter values   — 12:1
    label:     "#C8CEDC",   // field labels (Country, Floors)         — 10:1
    secondary: "#B8C0D0",   // section headers (BOOST ACCURACY)       — 8.6:1
    helper:    "#A8B0C4",   // hints, "max 100MB", "optional"         — 7.3:1
    hint:      "#00F5FF",   // cyan CTA accent ("click to browse")
  },

  // Borders
  borderSubtle: "rgba(255, 255, 255, 0.06)",
  borderLight: "rgba(255, 255, 255, 0.10)",
  borderMedium: "rgba(255, 255, 255, 0.15)",

  // Semantic
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#4FC3F7",

  // Node categories (synced with node-catalogue.ts CATEGORY_CONFIG)
  nodeInput: "#4F8AFF",
  nodeTransform: "#A855F7",
  nodeGenerate: "#22C55E",
  nodeExport: "#F59E0B",
} as const;

// ─── Spacing Scale (px) ─────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 48,
} as const;

// ─── Border Radius ──────────────────────────────────────────────────────────

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
  full: 9999,
} as const;

// ─── Shadows ────────────────────────────────────────────────────────────────

export const shadows = {
  card: "0 4px 16px rgba(0, 0, 0, 0.25)",
  modal: "0 24px 64px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
  glow: "0 4px 16px rgba(0, 245, 255, 0.25)",
  glowHover: "0 4px 24px rgba(0, 245, 255, 0.4)",
  toast: "0 16px 48px rgba(0, 0, 0, 0.35), 0 4px 16px rgba(0, 0, 0, 0.25)",
} as const;

// ─── Glass / Backdrop ───────────────────────────────────────────────────────

export const glass = {
  backdrop: "rgba(0, 0, 0, 0.6)",
  blur: "blur(4px)",
  card: "rgba(7, 8, 9, 0.92)",
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────

export const fontSizes = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  "2xl": 24,
  "3xl": 32,
} as const;

export type DesignColor = keyof typeof colors;
export type DesignRadius = keyof typeof radii;
export type DesignSpacing = keyof typeof spacing;
