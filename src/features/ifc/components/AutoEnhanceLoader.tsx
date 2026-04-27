"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { EnhanceStatus } from "@/features/ifc/enhance/types";

const STEPS = [
  { label: "Materials", range: [0, 0.3] },
  { label: "Ground",    range: [0.3, 0.55] },
  { label: "Roof",      range: [0.55, 0.8] },
  { label: "Details",   range: [0.8, 1.0] },
] as const;

function activeStepIndex(progress: number): number {
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if (progress >= STEPS[i].range[0]) return i;
  }
  return 0;
}

interface AutoEnhanceLoaderProps {
  status: EnhanceStatus;
  visible: boolean;
}

export function AutoEnhanceLoader({ status, visible }: AutoEnhanceLoaderProps) {
  const [show, setShow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // SSR-safe responsive detection via matchMedia
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Delay mount slightly so the viewport renders first
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => setShow(true), 200);
      return () => clearTimeout(t);
    }
    // Delay unmount for fade-out
    const t = setTimeout(() => setShow(false), 600);
    return () => clearTimeout(t);
  }, [visible]);

  const progress = status.kind === "loading" ? status.progress : 0;
  const step = status.kind === "loading" ? status.step : "";
  const currentIdx = activeStepIndex(progress);

  return (
    <AnimatePresence>
      {show && visible && (
        <motion.div
          key="auto-enhance-loader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            position: "absolute",
            bottom: isMobile ? 0 : 24,
            left: isMobile ? 0 : "50%",
            right: isMobile ? 0 : "auto",
            transform: isMobile ? "none" : "translateX(-50%)",
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            background: "rgba(10, 12, 16, 0.92)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(0, 245, 255, 0.12)",
            borderRadius: isMobile ? "14px 14px 0 0" : 14,
            padding: "14px 24px",
            minWidth: isMobile ? "unset" : 280,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Step indicators */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {STEPS.map((s, i) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background:
                      i < currentIdx
                        ? "#0D9488"
                        : i === currentIdx
                          ? "#00F5FF"
                          : "rgba(255,255,255,0.15)",
                    transition: "background 0.3s",
                    boxShadow: i === currentIdx ? "0 0 8px rgba(0,245,255,0.4)" : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: i === currentIdx ? 600 : 400,
                    color: i <= currentIdx ? "#E2E8F0" : "rgba(255,255,255,0.35)",
                    letterSpacing: "0.02em",
                    transition: "color 0.3s",
                  }}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <div
                    style={{
                      width: 12,
                      height: 1,
                      background: i < currentIdx ? "#0D9488" : "rgba(255,255,255,0.1)",
                      transition: "background 0.3s",
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div
            style={{
              width: "100%",
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <motion.div
              style={{
                height: "100%",
                borderRadius: 2,
                background: "linear-gradient(90deg, #0D9488, #00F5FF)",
              }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>

          {/* Current step label */}
          <span
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {step || "Enhancing..."}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
