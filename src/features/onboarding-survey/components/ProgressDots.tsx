"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import type { SceneNumber } from "@/features/onboarding-survey/types/survey";
import { dotHeartbeat, SPRING } from "@/features/onboarding-survey/lib/scene-motion";

interface ProgressDotsProps {
  current: SceneNumber;
  /** Scenes the user has already answered. Drives check-mark + heartbeat. */
  completed: Set<SceneNumber>;
}

const SCENES: SceneNumber[] = [1, 2, 3, 4];

export function ProgressDots({ current, completed }: ProgressDotsProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={4}
      aria-valuenow={current}
      aria-label={`Scene ${current} of 4`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 999,
        background: "rgba(18,18,30,0.55)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px) saturate(1.2)",
        WebkitBackdropFilter: "blur(12px) saturate(1.2)",
      }}
    >
      {SCENES.map((n) => {
        const isDone = completed.has(n);
        const isActive = current === n;
        const widthPx = isActive ? 28 : 8;

        return (
          <motion.div
            key={n}
            animate={isDone ? dotHeartbeat.animate : {}}
            transition={isDone ? dotHeartbeat.transition : undefined}
            style={{
              position: "relative",
              height: 8,
              borderRadius: 999,
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <motion.div
              animate={{
                width: widthPx,
                background: isActive
                  ? "linear-gradient(90deg, #4F8AFF, #6366F1, #8B5CF6)"
                  : isDone
                  ? "rgba(16, 185, 129, 0.9)"
                  : "rgba(255,255,255,0.1)",
                boxShadow: isActive
                  ? "0 0 12px rgba(79,138,255,0.45)"
                  : isDone
                  ? "0 0 8px rgba(16,185,129,0.35)"
                  : "none",
              }}
              transition={SPRING.smooth}
              style={{
                height: 8,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AnimatePresence>
                {isDone && !isActive && (
                  <motion.span
                    key="check"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={SPRING.bouncy}
                    style={{ display: "flex", color: "#fff" }}
                  >
                    <Check size={6} strokeWidth={4} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Pulsing inner ring on the active dot — heartbeat rhythm */}
            {isActive && (
              <motion.div
                animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0.2, 0.6] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  border: "1.5px solid rgba(79,138,255,0.6)",
                  pointerEvents: "none",
                }}
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
