"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

interface RoomEntry {
  name: string;
  area: number; // m²
  type?: string; // e.g. "bedroom", "kitchen"
}

interface RoomScheduleCascadeProps {
  /** Room rows derived from the floor plan project. Empty array hides the component. */
  rooms: RoomEntry[];
  /** Cap the cascade — top N rooms by area. Default 6. */
  cap?: number;
}

/**
 * Phase 4.2 · Fix 1 — Floor Plan signature theater.
 *
 * Sequential room-name reveal in monospace pills, each with a colored
 * dot and connecting line — same recipe as the BOQ MaterialChipsCascade.
 * Drives the eye to read the floor plan's room schedule the way an
 * architect reads the sheet legend.
 *
 * Caps at top 6 rooms by area to avoid overflowing the hero. Truncates
 * room names at ~16 chars with an ellipsis. Shows area in mono after
 * the name.
 *
 * Reduced motion: pills appear fully formed, no halo, no connector draw.
 */
const ROOM_TYPE_COLORS: Record<string, string> = {
  bedroom: "#7C3AED",
  master: "#7C3AED",
  bathroom: "#0EA5E9",
  bath: "#0EA5E9",
  kitchen: "#D97706",
  living: "#0D9488",
  dining: "#0D9488",
  hall: "#475569",
  corridor: "#475569",
  passage: "#475569",
  utility: "#94A3B8",
  store: "#94A3B8",
  balcony: "#22C55E",
  default: "#475569",
};

function colorForRoom(name: string, type?: string): string {
  const probe = `${type ?? ""} ${name}`.toLowerCase();
  for (const [key, color] of Object.entries(ROOM_TYPE_COLORS)) {
    if (key === "default") continue;
    if (probe.includes(key)) return color;
  }
  return ROOM_TYPE_COLORS.default;
}

function truncate(s: string, max = 16): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function RoomScheduleCascade({ rooms, cap = 6 }: RoomScheduleCascadeProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  if (!rooms || rooms.length === 0) return null;

  // Sort by area desc, take top N
  const sorted = [...rooms]
    .filter(r => Number.isFinite(r.area) && r.area > 0)
    .sort((a, b) => b.area - a.area)
    .slice(0, cap);

  if (sorted.length === 0) return null;

  const STEP = 0.22;
  const baseDelay = 0.2;

  return (
    <div
      ref={ref}
      role="presentation"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 0,
        marginTop: 14,
        marginBottom: 6,
      }}
    >
      {sorted.map((room, i) => {
        const chipDelay = baseDelay + i * STEP;
        const dotColor = colorForRoom(room.name, room.type);
        return (
          <span key={`${room.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
            {i > 0 ? (
              <motion.span
                aria-hidden="true"
                initial={reduce || !inView ? { width: 16 } : { width: 0 }}
                animate={inView ? { width: 16 } : undefined}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { delay: chipDelay - 0.05, duration: 0.16, ease: "easeOut" }
                }
                style={{
                  display: "inline-block",
                  height: 1,
                  background: dotColor,
                  opacity: 0.45,
                  margin: "0 4px",
                }}
              />
            ) : null}
            <motion.span
              initial={
                reduce || !inView
                  ? { opacity: 1, scale: 1, y: 0 }
                  : { opacity: 0, scale: 0.88, y: 5 }
              }
              animate={inView ? { opacity: 1, scale: 1, y: 0 } : undefined}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      delay: chipDelay,
                      duration: 0.4,
                      ease: [0.34, 1.56, 0.64, 1] as const,
                    }
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 12px",
                borderRadius: 9999,
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "#0F172A",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              <span aria-hidden="true" style={{ position: "relative", display: "inline-flex", width: 7, height: 7 }}>
                <motion.span
                  initial={reduce || !inView ? { scale: 1 } : { scale: 0.4 }}
                  animate={inView ? (reduce ? { scale: 1 } : { scale: [0.4, 1.55, 1] }) : undefined}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          delay: chipDelay + 0.05,
                          duration: 0.45,
                          times: [0, 0.45, 1],
                          ease: "easeOut" as const,
                        }
                  }
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: 7,
                    height: 7,
                    borderRadius: 9999,
                    background: dotColor,
                  }}
                />
                {!reduce ? (
                  <motion.span
                    aria-hidden="true"
                    initial={{ scale: 0, opacity: 0.5 }}
                    animate={inView ? { scale: 2.4, opacity: 0 } : undefined}
                    transition={{ delay: chipDelay + 0.05, duration: 0.45, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: 7,
                      height: 7,
                      borderRadius: 9999,
                      background: dotColor,
                      pointerEvents: "none",
                    }}
                  />
                ) : null}
              </span>
              <span>{truncate(room.name)}</span>
              <span style={{ color: "#94A3B8", fontWeight: 500, marginLeft: 2 }}>
                {Math.round(room.area)} m²
              </span>
            </motion.span>
          </span>
        );
      })}
      {rooms.length > sorted.length ? (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 10,
            color: "#94A3B8",
            letterSpacing: "0.06em",
            marginLeft: 10,
            marginBottom: 6,
          }}
        >
          +{rooms.length - sorted.length} more
        </span>
      ) : null}
    </div>
  );
}
