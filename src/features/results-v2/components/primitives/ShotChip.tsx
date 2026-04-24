"use client";

import { useState } from "react";
import { NEUTRAL } from "@/features/results-v2/constants";

interface ShotChipProps {
  label: string;
  durationSeconds?: number;
  active?: boolean;
  accentColor: string;
  onClick?: () => void;
}

/**
 * Chip with a left-to-right clip-path sweep of the accent fill on hover
 * (240ms). Active state layers an inner edge-highlight + accent tint.
 */
export function ShotChip({ label, durationSeconds, active = false, accentColor, onClick }: ShotChipProps) {
  const interactive = Boolean(onClick);
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={!interactive}
      style={{
        appearance: "none",
        position: "relative",
        padding: "5px 10px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: active ? NEUTRAL.TEXT_PRIMARY : NEUTRAL.TEXT_SECONDARY,
        background: "rgba(0,0,0,0.42)",
        border: `1px solid ${active ? accentColor : NEUTRAL.BORDER_SUBTLE}`,
        cursor: interactive ? "pointer" : "default",
        transition: "color 160ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out, transform 160ms ease-out",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        fontFamily: "inherit",
        overflow: "hidden",
        isolation: "isolate",
        boxShadow: active ? `0 0 20px ${accentColor}44, inset 0 1px 0 ${accentColor}66` : "none",
        transform: active ? "translateY(-1px)" : "none",
      }}
      aria-pressed={active}
      aria-label={durationSeconds ? `${label} — ${durationSeconds} seconds` : label}
    >
      {/* Accent fill sweep — revealed via clip-path from left to right on hover. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(90deg, ${accentColor}55 0%, ${accentColor}22 100%)`,
          clipPath: hovered && !active ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: "clip-path 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          pointerEvents: "none",
          zIndex: -1,
        }}
      />
      {label}
      {durationSeconds != null ? (
        <span style={{ marginLeft: 6, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
          {durationSeconds}s
        </span>
      ) : null}
    </button>
  );
}
