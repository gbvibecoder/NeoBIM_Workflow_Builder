"use client";

import { motion } from "framer-motion";
import { SPRING, cardSelectAnimation } from "@/features/onboarding-survey/lib/scene-motion";
import type { TeamSizeOption } from "@/features/onboarding-survey/types/survey";

interface ScalePillProps {
  option: TeamSizeOption;
  label: string;
  selected: boolean;
  dimmed: boolean;
  shortcutNumber: number;
  onHover: () => void;
  onSelect: () => void;
}

export function ScalePill({
  option,
  label,
  selected,
  dimmed,
  shortcutNumber,
  onHover,
  onSelect,
}: ScalePillProps) {
  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={String(shortcutNumber)}
      onClick={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
      animate={{
        scale: selected ? 1 : dimmed ? 0.96 : 1,
        opacity: dimmed ? 0.45 : 1,
        ...(selected ? cardSelectAnimation : {}),
      }}
      transition={selected ? cardSelectAnimation.transition : SPRING.smooth}
      whileHover={!selected ? { x: 4 } : undefined}
      whileTap={!selected ? { scale: 0.97 } : undefined}
      style={{
        position: "relative",
        width: "100%",
        padding: "16px 20px",
        borderRadius: 16,
        background: selected
          ? `linear-gradient(90deg, rgba(${option.colorRgb},0.22), rgba(${option.colorRgb},0.04))`
          : "rgba(18,18,30,0.7)",
        border: `1px solid ${selected ? `rgba(${option.colorRgb},0.55)` : "rgba(255,255,255,0.08)"}`,
        backdropFilter: "blur(14px) saturate(1.25)",
        WebkitBackdropFilter: "blur(14px) saturate(1.25)",
        boxShadow: selected
          ? `0 10px 32px rgba(${option.colorRgb},0.25), 0 0 0 1px rgba(${option.colorRgb},0.35), inset 0 1px 0 rgba(255,255,255,0.04)`
          : "0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.03)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: "var(--text-primary)",
        textAlign: "left",
      }}
    >
      {/* Leading dot */}
      <div
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: `rgb(${option.colorRgb})`,
          boxShadow: selected
            ? `0 0 14px rgba(${option.colorRgb},0.9)`
            : `0 0 8px rgba(${option.colorRgb},0.4)`,
          flexShrink: 0,
          transition: "box-shadow 220ms ease",
        }}
      />

      {/* Emoji */}
      <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>{option.emoji}</div>

      {/* Label */}
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em" }}>{label}</span>

      {/* Keyboard shortcut */}
      <span
        aria-hidden="true"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: selected ? `rgba(${option.colorRgb},0.9)` : "var(--text-disabled)",
          fontFamily: "var(--font-jetbrains), monospace",
          padding: "3px 7px",
          borderRadius: 6,
          border: `1px solid ${selected ? `rgba(${option.colorRgb},0.4)` : "rgba(255,255,255,0.1)"}`,
          background: selected ? `rgba(${option.colorRgb},0.1)` : "transparent",
          transition: "all 200ms ease",
        }}
      >
        {shortcutNumber}
      </span>

      {/* Active accent bar (architectural port annotation) */}
      {selected && (
        <motion.div
          layoutId="scene3-active-bar"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: "12%",
            bottom: "12%",
            width: 3,
            borderRadius: "0 4px 4px 0",
            background: `linear-gradient(180deg, rgba(${option.colorRgb},0.9), rgba(${option.colorRgb},0.4))`,
            boxShadow: `0 0 8px rgba(${option.colorRgb},0.7)`,
          }}
        />
      )}
    </motion.button>
  );
}
