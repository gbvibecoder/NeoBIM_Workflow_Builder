"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

interface MaterialChipsCascadeProps {
  /** Optional override of chip labels. Defaults to the 5-stage BOQ recipe. */
  chips?: ReadonlyArray<{ label: string; dotColor: string }>;
  /** Total cost in rupees — drives whether to render this at all (skip if 0). */
  totalCost?: number;
}

const DEFAULT_CHIPS: ReadonlyArray<{ label: string; dotColor: string }> = [
  { label: "Concrete", dotColor: "#475569" },
  { label: "Steel", dotColor: "#0EA5E9" },
  { label: "Bricks", dotColor: "#B45309" },
  { label: "Labor", dotColor: "#0D9488" },
  { label: "Finishings", dotColor: "#7C3AED" },
];

/**
 * Phase 4.1 · Fix 1 — BOQ "estimate coming together" theater.
 *
 * Plays once on first viewport entry (30% threshold). Each chip:
 *   - enters with overshoot (back-out ease) for a springy "BING I'm here"
 *   - has its dot pulse 1 → 1.6 → 1 with a separate halo ring expanding
 *     outward and fading (the "this material was just added" beat)
 *   - is connected to the previous chip by a 1px teal line that draws
 *     in as it activates (circuit lighting up sequentially)
 *
 * Timing: 200ms / 440ms / 680ms / 920ms / 1160ms — 240ms apart, one chip
 * per beat. By 1.16s all five chips are lit. The hero's KPI number ticks
 * up over 1.6s in parallel, so the number lands ~400ms after the last
 * chip — anchoring the "we just calculated this" moment.
 *
 * Reduced motion: chips render fully visible, no entrance, no pulse, no
 * connecting-line draw.
 */
export function MaterialChipsCascade({ chips = DEFAULT_CHIPS, totalCost }: MaterialChipsCascadeProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  if (totalCost !== undefined && totalCost <= 0) return null;

  const STEP = 0.24; // seconds between chip activations
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
        marginTop: 18,
        marginBottom: 8,
      }}
    >
      {chips.map((chip, i) => {
        const chipDelay = baseDelay + i * STEP;
        const chipKey = `${chip.label}-${i}`;
        return (
          <span
            key={chipKey}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0,
            }}
          >
            {/* Connecting line — only between consecutive chips */}
            {i > 0 ? (
              <motion.span
                aria-hidden="true"
                initial={reduce || !inView ? { width: 18 } : { width: 0 }}
                animate={inView ? { width: 18 } : undefined}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { delay: chipDelay - 0.06, duration: 0.18, ease: "easeOut" }
                }
                style={{
                  display: "inline-block",
                  height: 1,
                  background: "#0D9488",
                  opacity: 0.55,
                  margin: "0 4px",
                }}
              />
            ) : null}

            {/* Chip */}
            <motion.span
              initial={
                reduce || !inView
                  ? { opacity: 1, scale: 1, y: 0 }
                  : { opacity: 0, scale: 0.85, y: 6 }
              }
              animate={inView ? { opacity: 1, scale: 1, y: 0 } : undefined}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      delay: chipDelay,
                      duration: 0.42,
                      ease: [0.34, 1.56, 0.64, 1] as const,
                    }
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 13px",
                borderRadius: 9999,
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "#0F172A",
                letterSpacing: "0.05em",
              }}
            >
              {/* Dot + halo cluster */}
              <span
                aria-hidden="true"
                style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}
              >
                <motion.span
                  initial={reduce || !inView ? { scale: 1 } : { scale: 0.4 }}
                  animate={inView ? (reduce ? { scale: 1 } : { scale: [0.4, 1.6, 1] }) : undefined}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          delay: chipDelay + 0.06,
                          duration: 0.5,
                          times: [0, 0.45, 1],
                          ease: "easeOut" as const,
                        }
                  }
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    background: chip.dotColor,
                    boxShadow: `0 0 0 2px ${chip.dotColor}1a`,
                  }}
                />
                {/* Halo ring */}
                {!reduce ? (
                  <motion.span
                    aria-hidden="true"
                    initial={{ scale: 0, opacity: 0.55 }}
                    animate={inView ? { scale: 2.6, opacity: 0 } : undefined}
                    transition={{
                      delay: chipDelay + 0.06,
                      duration: 0.5,
                      ease: "easeOut",
                    }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: 8,
                      height: 8,
                      borderRadius: 9999,
                      background: chip.dotColor,
                      pointerEvents: "none",
                    }}
                  />
                ) : null}
              </span>
              {chip.label}
            </motion.span>
          </span>
        );
      })}
    </div>
  );
}
