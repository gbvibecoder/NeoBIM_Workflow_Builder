"use client";

import type { CSSProperties } from "react";

interface DraftingMarksProps {
  /** Corner accent color. Defaults to a soft graphite. */
  color?: string;
  /** Stroke width in px. Defaults to 1. */
  width?: number;
  /** Mark length in px. Defaults to 12. */
  length?: number;
  /** Inset from each corner in px. Defaults to 8. */
  inset?: number;
  /** Optional opacity override (0-1). Defaults to 0.55. */
  opacity?: number;
}

/**
 * Four small corner brackets, like architects mark drawings before cutting.
 * Renders as an absolute-positioned overlay — must be inside a `position:
 * relative` parent. Pointer-events: none, so it never intercepts clicks.
 *
 * Subliminally architectural; stops a card from looking like a div.
 */
export function DraftingMarks({
  color = "#94A3B8",
  width = 1,
  length = 12,
  inset = 8,
  opacity = 0.55,
}: DraftingMarksProps) {
  const baseStyle: CSSProperties = {
    position: "absolute",
    width: length,
    height: length,
    borderColor: color,
    opacity,
    pointerEvents: "none",
  };
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          ...baseStyle,
          top: inset,
          left: inset,
          borderTop: `${width}px solid currentColor`,
          borderLeft: `${width}px solid currentColor`,
          color,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...baseStyle,
          top: inset,
          right: inset,
          borderTop: `${width}px solid currentColor`,
          borderRight: `${width}px solid currentColor`,
          color,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...baseStyle,
          bottom: inset,
          left: inset,
          borderBottom: `${width}px solid currentColor`,
          borderLeft: `${width}px solid currentColor`,
          color,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...baseStyle,
          bottom: inset,
          right: inset,
          borderBottom: `${width}px solid currentColor`,
          borderRight: `${width}px solid currentColor`,
          color,
        }}
      />
    </>
  );
}
