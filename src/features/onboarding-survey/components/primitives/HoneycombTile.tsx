"use client";

import React, { useCallback, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  cardSelectAnimation,
  SPRING,
} from "@/features/onboarding-survey/lib/scene-motion";
import type { ProfessionOption } from "@/features/onboarding-survey/types/survey";

interface HoneycombTileProps {
  option: ProfessionOption;
  label: string;
  subtitle: string;
  selected: boolean;
  dimmed: boolean;
  shortcutNumber: number;
  onSelect: () => void;
}

/**
 * Profession tile with true 3D tilt: motion values track cursor position
 * inside the tile and map to rotateX/rotateY via springs. Selection briefly
 * "zooms to center" via an overshoot scale pulse (no physical translate —
 * the pulse-in-place reads more cleanly without disturbing the grid).
 */
export function HoneycombTile({
  option,
  label,
  subtitle,
  selected,
  dimmed,
  shortcutNumber,
  onSelect,
}: HoneycombTileProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

  // Cursor offset from tile center (−0.5 to 0.5)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotX = useTransform(my, [-0.5, 0.5], [6, -6]);
  const rotY = useTransform(mx, [-0.5, 0.5], [-8, 8]);

  const springRotX = useSpring(rotX, { stiffness: 200, damping: 18 });
  const springRotY = useSpring(rotY, { stiffness: 200, damping: 18 });

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      mx.set((e.clientX - rect.left) / rect.width - 0.5);
      my.set((e.clientY - rect.top) / rect.height - 0.5);
    },
    [mx, my]
  );

  const handleEnter = useCallback(() => setHovered(true), []);
  const handleLeave = useCallback(() => {
    setHovered(false);
    mx.set(0);
    my.set(0);
  }, [mx, my]);

  return (
    <motion.button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={String(shortcutNumber)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseMove={handleMove}
      onClick={onSelect}
      animate={{
        scale: selected ? 1 : dimmed ? 0.92 : 1,
        opacity: dimmed ? 0.5 : 1,
        ...(selected ? cardSelectAnimation : {}),
      }}
      transition={selected ? cardSelectAnimation.transition : SPRING.smooth}
      whileTap={!selected ? { scale: 0.96 } : undefined}
      style={{
        rotateX: springRotX,
        rotateY: springRotY,
        transformStyle: "preserve-3d",
        perspective: 900,
        position: "relative",
        minHeight: 172,
        padding: "22px 18px",
        borderRadius: 18,
        background: selected
          ? `linear-gradient(145deg, rgba(${option.colorRgb},0.18), rgba(${option.colorRgb},0.04))`
          : "rgba(18,18,30,0.7)",
        border: `1px solid ${selected ? `rgba(${option.colorRgb},0.6)` : "rgba(255,255,255,0.08)"}`,
        backdropFilter: "blur(14px) saturate(1.25)",
        WebkitBackdropFilter: "blur(14px) saturate(1.25)",
        boxShadow: selected
          ? `0 14px 40px rgba(${option.colorRgb},0.25), 0 0 0 1px rgba(${option.colorRgb},0.35), inset 0 1px 0 rgba(255,255,255,0.04)`
          : hovered
          ? `0 14px 36px rgba(0,0,0,0.4), 0 0 32px rgba(${option.colorRgb},0.14), inset 0 1px 0 rgba(255,255,255,0.05)`
          : "0 6px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)",
        cursor: "pointer",
        textAlign: "center",
        overflow: "hidden",
        color: "var(--text-primary)",
        width: "100%",
      }}
    >
      {/* Top-right keyboard shortcut + category annotation */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 10,
          right: 14,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "var(--text-disabled)",
          fontFamily: "var(--font-jetbrains), monospace",
          opacity: hovered ? 0.9 : 0.4,
          transition: "opacity 160ms ease",
        }}
      >
        {shortcutNumber}
      </span>

      {/* Icon + mini illustration: large emoji surrounded by architectural
         hash marks that gently spin while hovered. */}
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          width: 76,
          height: 76,
          margin: "4px auto 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Sketch rings */}
        <motion.div
          animate={{ rotate: hovered || selected ? 360 : 0 }}
          transition={{ duration: hovered || selected ? 12 : 0, ease: "linear", repeat: hovered || selected ? Infinity : 0 }}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `1.5px dashed rgba(${option.colorRgb},${selected ? 0.6 : hovered ? 0.35 : 0.18})`,
            transition: "border-color 260ms ease",
          }}
        />
        <motion.div
          animate={{ rotate: hovered || selected ? -360 : 0 }}
          transition={{ duration: hovered || selected ? 18 : 0, ease: "linear", repeat: hovered || selected ? Infinity : 0 }}
          style={{
            position: "absolute",
            inset: 10,
            borderRadius: "50%",
            border: `1px solid rgba(${option.colorRgb},${selected ? 0.4 : 0.15})`,
          }}
        />
        <div style={{ fontSize: 36, position: "relative" }}>{option.emoji}</div>
      </div>

      <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>
        {subtitle}
      </div>

      {/* Bottom annotation — blueprint caption feel */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 8,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: `rgba(${option.colorRgb},${selected ? 0.8 : 0.4})`,
          fontFamily: "var(--font-jetbrains), monospace",
          textTransform: "uppercase",
          pointerEvents: "none",
          transition: "color 200ms ease",
        }}
      >
        {option.id}
      </div>
    </motion.button>
  );
}
