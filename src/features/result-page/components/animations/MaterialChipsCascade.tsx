"use client";

import { motion, useReducedMotion } from "framer-motion";

interface MaterialChipsCascadeProps {
  /** Optional override of chip labels. Defaults to the 5-stage BOQ recipe. */
  chips?: ReadonlyArray<{ label: string; dotColor: string }>;
  /** Total cost in rupees — drives whether to render this at all (skip if 0). */
  totalCost?: number;
}

const DEFAULT_CHIPS: ReadonlyArray<{ label: string; dotColor: string }> = [
  { label: "Concrete", dotColor: "#94A3B8" },
  { label: "Steel", dotColor: "#0EA5E9" },
  { label: "Bricks", dotColor: "#B45309" },
  { label: "Labor", dotColor: "#0D9488" },
  { label: "Finishings", dotColor: "#7C3AED" },
];

/**
 * BOQ signature animation — sequential material-chip cascade.
 *
 * Chips reveal one at a time (240ms apart) in sync with the ₹ KPI ticking
 * up. By the time the final chip lights up, the cost number lands at its
 * final value. The dimension line below (Phase 3's `DimensionLine`) draws
 * in afterwards, completing the "we just calculated this" sequence.
 *
 * Plays once. Settles. Reduced-motion safe (chips appear instantly).
 */
export function MaterialChipsCascade({ chips = DEFAULT_CHIPS, totalCost }: MaterialChipsCascadeProps) {
  const reduce = useReducedMotion();
  if (totalCost !== undefined && totalCost <= 0) return null;

  return (
    <div
      role="presentation"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 14,
        marginBottom: 4,
      }}
    >
      {chips.map((chip, i) => (
        <motion.span
          key={chip.label}
          initial={reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
          animate={reduce ? undefined : { opacity: 1, scale: 1 }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  delay: 0.05 + i * 0.24,
                  duration: 0.28,
                  ease: [0.25, 0.46, 0.45, 0.94],
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
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 600,
            color: "#475569",
            letterSpacing: "0.04em",
          }}
        >
          <motion.span
            aria-hidden="true"
            initial={reduce ? { scale: 1 } : { scale: 0.4 }}
            animate={reduce ? undefined : { scale: [0.4, 1.5, 1] }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    delay: 0.05 + i * 0.24,
                    duration: 0.5,
                    times: [0, 0.4, 1],
                    ease: "easeOut",
                  }
            }
            style={{
              width: 7,
              height: 7,
              borderRadius: 9999,
              background: chip.dotColor,
              boxShadow: `0 0 0 2px ${chip.dotColor}22`,
            }}
          />
          {chip.label}
        </motion.span>
      ))}
    </div>
  );
}
