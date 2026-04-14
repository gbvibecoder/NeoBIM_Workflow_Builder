"use client";

import React, { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { IconReaction } from "@/features/onboarding-survey/components/primitives/IconReaction";
import {
  SPRING,
  cardSelectAnimation,
} from "@/features/onboarding-survey/lib/scene-motion";
import type { DiscoveryOption } from "@/features/onboarding-survey/types/survey";

interface LivingCardProps {
  option: DiscoveryOption;
  label: string;
  subtitle: string;
  selected: boolean;
  dimmed: boolean; // true when another card is selected — this one shrinks
  shortcutNumber: number;
  onHover: (rgb: string | null) => void;
  onSelect: () => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
}

/**
 * Scene-1 card: each is alive — the icon reacts differently per option, and
 * while the cursor is inside, tiny particles fan out behind the pointer,
 * briefly, to give the card that "come play" feeling.
 */
export function LivingCard({
  option,
  label,
  subtitle,
  selected,
  dimmed,
  shortcutNumber,
  onHover,
  onSelect,
}: LivingCardProps) {
  const [hovered, setHovered] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const rootRef = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const lastEmit = useRef(0);

  const handleMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // Throttle — we don't need a particle per pixel.
    const now = performance.now();
    if (now - lastEmit.current < 28) return;
    lastEmit.current = now;

    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = ++seq.current;
    setParticles((prev) => [...prev.slice(-7), { id, x, y }]);

    // Auto-remove after animation ends
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 650);
  }, []);

  const handleEnter = useCallback(() => {
    setHovered(true);
    onHover(option.colorRgb);
  }, [onHover, option.colorRgb]);

  const handleLeave = useCallback(() => {
    setHovered(false);
    onHover(null);
    setParticles([]);
  }, [onHover]);

  return (
    <motion.button
      ref={rootRef}
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={String(shortcutNumber)}
      animate={{
        scale: selected ? 1 : dimmed ? 0.94 : 1,
        opacity: dimmed ? 0.55 : 1,
        ...(selected ? cardSelectAnimation : {}),
      }}
      transition={selected ? cardSelectAnimation.transition : SPRING.smooth}
      whileHover={!selected && !dimmed ? { y: -4 } : undefined}
      whileTap={!selected ? { scale: 0.97 } : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseMove={handleMove}
      onClick={onSelect}
      style={{
        position: "relative",
        minHeight: 132,
        padding: "18px 16px 16px",
        borderRadius: 16,
        background: selected
          ? `linear-gradient(135deg, rgba(${option.colorRgb},0.16), rgba(${option.colorRgb},0.04))`
          : "rgba(18,18,30,0.72)",
        border: `1px solid ${selected ? `rgba(${option.colorRgb},0.55)` : "rgba(255,255,255,0.08)"}`,
        backdropFilter: "blur(14px) saturate(1.25)",
        WebkitBackdropFilter: "blur(14px) saturate(1.25)",
        boxShadow: selected
          ? `0 8px 32px rgba(${option.colorRgb},0.25), 0 0 0 1px rgba(${option.colorRgb},0.3), inset 0 1px 0 rgba(255,255,255,0.04)`
          : hovered
          ? `0 10px 32px rgba(0,0,0,0.35), 0 0 24px rgba(${option.colorRgb},0.12), inset 0 1px 0 rgba(255,255,255,0.05)`
          : "0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.03)",
        cursor: "pointer",
        textAlign: "left",
        overflow: "hidden",
        color: "var(--text-primary)",
        width: "100%",
      }}
    >
      {/* Top port dot (architectural node feel) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: `rgb(${option.colorRgb})`,
          boxShadow: `0 0 8px rgba(${option.colorRgb},0.7)`,
          opacity: hovered || selected ? 1 : 0.6,
          transition: "opacity 160ms ease",
        }}
      />

      {/* Keyboard shortcut tag */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--text-disabled)",
          fontFamily: "var(--font-jetbrains), monospace",
          opacity: hovered ? 0.9 : 0.45,
          transition: "opacity 160ms ease",
        }}
      >
        {shortcutNumber}
      </span>

      {/* Icon + copy */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginTop: 6 }}>
        <IconReaction
          emoji={option.emoji}
          reaction={option.reaction}
          active={hovered || selected}
          colorRgb={option.colorRgb}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
              marginBottom: 3,
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            {subtitle}
          </div>
        </div>
      </div>

      {/* Particle trail — follows cursor while hovered */}
      {particles.map((p) => (
        <motion.span
          key={p.id}
          aria-hidden="true"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 0.3, y: p.y - 16 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{
            position: "absolute",
            left: p.x - 3,
            top: p.y - 3,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: `rgb(${option.colorRgb})`,
            boxShadow: `0 0 6px rgba(${option.colorRgb},0.8)`,
            pointerEvents: "none",
          }}
        />
      ))}
    </motion.button>
  );
}
