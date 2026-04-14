"use client";

import React from "react";
import { motion } from "framer-motion";

type ReactionKind =
  | "bounce"
  | "spin"
  | "wave"
  | "wink"
  | "scan"
  | "shuffle"
  | "sparkle"
  | "pulse"
  | "edit";

interface IconReactionProps {
  emoji: string;
  reaction: ReactionKind;
  /** When true, the animation plays. Paused otherwise to keep the grid calm. */
  active: boolean;
  colorRgb: string;
}

/**
 * A 64px square that renders an emoji and animates differently per reaction
 * kind. The goal is that every card on Scene 1 feels personally alive.
 */
export function IconReaction({ emoji, reaction, active, colorRgb }: IconReactionProps) {
  const base = (
    <div
      style={{
        fontSize: 38,
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
      }}
      aria-hidden="true"
    >
      {emoji}
    </div>
  );

  const size = 64;
  const container: React.CSSProperties = {
    position: "relative",
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  switch (reaction) {
    case "bounce":
      return (
        <div style={container}>
          <motion.div animate={active ? { y: [0, -8, 0, -4, 0] } : { y: 0 }} transition={active ? { duration: 0.9, ease: "easeOut" } : { duration: 0.25 }}>
            {base}
          </motion.div>
        </div>
      );

    case "spin":
      return (
        <div style={container}>
          <motion.div animate={active ? { rotate: 360 } : { rotate: 0 }} transition={active ? { duration: 1.1, ease: [0.22, 1, 0.36, 1] } : { duration: 0.25 }}>
            {base}
          </motion.div>
        </div>
      );

    case "wave":
      return (
        <div style={container}>
          <motion.div
            animate={active ? { rotate: [0, 16, -12, 10, -6, 0] } : { rotate: 0 }}
            transition={active ? { duration: 0.9 } : { duration: 0.25 }}
            style={{ transformOrigin: "70% 70%" }}
          >
            {base}
          </motion.div>
        </div>
      );

    case "wink":
      return (
        <div style={container}>
          <motion.div
            animate={active ? { scaleY: [1, 0.15, 1] } : { scaleY: 1 }}
            transition={active ? { duration: 0.55, times: [0, 0.45, 1] } : { duration: 0.2 }}
          >
            {base}
          </motion.div>
        </div>
      );

    case "scan": {
      // Horizontal scan bar sweeps across — LinkedIn "stalker" vibe
      return (
        <div style={{ ...container, overflow: "hidden", borderRadius: 12 }}>
          {base}
          <motion.div
            aria-hidden="true"
            initial={false}
            animate={active ? { x: ["-120%", "120%"] } : { x: "-120%" }}
            transition={active ? { duration: 1.1, ease: "easeOut" } : { duration: 0 }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: "35%",
              background: `linear-gradient(90deg, transparent, rgba(${colorRgb},0.5), transparent)`,
              filter: "blur(1px)",
              pointerEvents: "none",
            }}
          />
        </div>
      );
    }

    case "shuffle":
      return (
        <div style={container}>
          <motion.div
            animate={
              active
                ? { x: [0, -4, 3, -2, 1, 0], y: [0, 2, -1, 3, -2, 0], rotate: [0, -8, 6, -4, 2, 0] }
                : { x: 0, y: 0, rotate: 0 }
            }
            transition={active ? { duration: 0.7 } : { duration: 0.25 }}
          >
            {base}
          </motion.div>
        </div>
      );

    case "sparkle": {
      // 4 sparkle particles radiate out on active
      const sparks = [0, 1, 2, 3];
      return (
        <div style={container}>
          <motion.div animate={active ? { scale: [1, 1.1, 1] } : { scale: 1 }} transition={active ? { duration: 0.7 } : { duration: 0.25 }}>
            {base}
          </motion.div>
          {sparks.map((i) => {
            const angle = (i * Math.PI) / 2 + Math.PI / 4;
            const dx = Math.cos(angle) * 26;
            const dy = Math.sin(angle) * 26;
            return (
              <motion.div
                key={i}
                aria-hidden="true"
                initial={false}
                animate={active ? { opacity: [0, 1, 0], x: [0, dx], y: [0, dy], scale: [0.4, 1, 0.6] } : { opacity: 0 }}
                transition={active ? { duration: 0.9, delay: i * 0.04, ease: "easeOut" } : { duration: 0 }}
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: `rgba(${colorRgb}, 1)`,
                  boxShadow: `0 0 6px rgba(${colorRgb}, 0.9)`,
                  pointerEvents: "none",
                  marginTop: -2.5,
                  marginLeft: -2.5,
                }}
              />
            );
          })}
        </div>
      );
    }

    case "pulse": {
      // Concentric ring pulses out
      return (
        <div style={container}>
          {base}
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              aria-hidden="true"
              initial={false}
              animate={active ? { scale: [0.5, 1.9], opacity: [0.6, 0] } : { scale: 0.5, opacity: 0 }}
              transition={active ? { duration: 1.0, delay: i * 0.2, ease: "easeOut" } : { duration: 0 }}
              style={{
                position: "absolute",
                inset: 4,
                borderRadius: "50%",
                border: `2px solid rgba(${colorRgb}, 0.6)`,
                pointerEvents: "none",
              }}
            />
          ))}
        </div>
      );
    }

    case "edit":
      return (
        <div style={container}>
          {base}
          <motion.div
            aria-hidden="true"
            initial={false}
            animate={active ? { scaleX: [0, 1], opacity: [0, 1] } : { scaleX: 0, opacity: 0 }}
            transition={active ? { duration: 0.6, ease: [0.22, 1, 0.36, 1] } : { duration: 0.2 }}
            style={{
              position: "absolute",
              bottom: 8,
              left: "20%",
              right: "20%",
              height: 2,
              borderRadius: 2,
              background: `linear-gradient(90deg, rgba(${colorRgb},0), rgba(${colorRgb},1), rgba(${colorRgb},0))`,
              transformOrigin: "left",
              pointerEvents: "none",
            }}
          />
        </div>
      );
  }
}
