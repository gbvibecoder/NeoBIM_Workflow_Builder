"use client";

import type { CSSProperties, ReactNode } from "react";

interface MonoLabelProps {
  children: ReactNode;
  size?: 10 | 11 | 12 | 13;
  color?: string;
  uppercase?: boolean;
  style?: CSSProperties;
}

/**
 * Monospace technical label — mirrors the way dimensions, plan codes, and
 * sheet references are typeset on architectural drawings.
 *
 * Used for: timecodes, project tags, engine badges, file metadata,
 * pipeline-step durations, anything that wants the look of a stamp on a
 * drawing.
 */
export function MonoLabel({
  children,
  size = 11,
  color = "#475569",
  uppercase = true,
  style,
}: MonoLabelProps) {
  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains), ui-monospace, 'JetBrains Mono', SFMono-Regular, monospace",
        fontSize: size,
        fontWeight: 500,
        color,
        letterSpacing: uppercase ? "0.08em" : "0.02em",
        textTransform: uppercase ? "uppercase" : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
