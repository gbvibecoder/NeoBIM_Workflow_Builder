/**
 * Text styles for content rendered inside canvas nodes.
 *
 * Why this exists: node content sits on rgba(10,12,14,0.75) glass over a dark
 * radial gradient. Hard-coded grays scattered across node files were landing
 * well below WCAG AA (some as low as 2.0:1). These styles use the nodeText
 * token tier, which is calibrated to pass AA against the rendered node bg.
 *
 * Import this anywhere you'd otherwise inline `color`, `fontSize`, and
 * `fontWeight` for text inside a node.
 */

import type { CSSProperties } from "react";
import { colors } from "@/constants/design-tokens";

// Subtle text-shadow to keep small labels crisp against the canvas dot grid
// that bleeds through the node's translucent background.
const SHADOW_SMALL = "0 1px 2px rgba(0,0,0,0.65)";

export const nodeText = {
  /** Primary form value — textarea content, selected dropdown values. */
  value: {
    fontSize: 13,
    fontWeight: 400,
    color: colors.nodeText.value,
    letterSpacing: "0.005em",
  } satisfies CSSProperties,

  /** Section header — "ESTIMATE ACCURACY", "BOOST ACCURACY". */
  sectionHdr: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.nodeText.secondary,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  } satisfies CSSProperties,

  /** Field label above an input — "Country", "City", "Floors". */
  label: {
    fontSize: 11,
    fontWeight: 500,
    color: colors.nodeText.label,
    letterSpacing: "0.02em",
    textShadow: SHADOW_SMALL,
  } satisfies CSSProperties,

  /** Helper / hint text — "optional", "max 100MB", drop-zone prompts. */
  helper: {
    fontSize: 10,
    fontWeight: 400,
    color: colors.nodeText.helper,
    lineHeight: 1.5,
    textShadow: SHADOW_SMALL,
  } satisfies CSSProperties,

  /** Cyan accent span used INSIDE helper text — "click to browse". */
  hintLink: {
    color: colors.nodeText.hint,
    fontWeight: 600,
  } satisfies CSSProperties,

  /** Small meta pill — time badge "< 2s", character counter. */
  meta: {
    fontSize: 10,
    fontWeight: 500,
    color: colors.nodeText.helper,
    fontFamily: "var(--font-jetbrains), monospace",
    letterSpacing: "0.05em",
  } satisfies CSSProperties,
} as const;
