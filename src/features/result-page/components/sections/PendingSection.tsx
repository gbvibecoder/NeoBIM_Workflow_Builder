"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { VideoGenerationState } from "@/types/execution";
import { RegistrationMark } from "@/features/result-page/components/animations/RegistrationMark";

const PHASES = [
  "Exterior Pull-in",
  "Building Orbit",
  "Interior Walkthrough",
  "Section Rise",
] as const;

interface PendingSectionProps {
  progress: VideoGenerationState | null;
}

/** Beautiful in-progress card — replaces the audit-flagged "Initializing 5%" void. */
export function PendingSection({ progress }: PendingSectionProps) {
  const reduce = useReducedMotion();
  const pct = Math.min(Math.max(progress?.progress ?? 0, 0), 100);
  const activeIdx = progress?.phase ? PHASES.findIndex(p => p === progress.phase) : -1;

  const headline =
    progress?.status === "submitting"
      ? "Handing the scene to the renderer"
      : progress?.status === "rendering"
        ? "Composing your walkthrough — the renderer makes it look easy"
        : "Drawing the first frame";
  const subhead =
    progress?.phase ?? (pct < 5 ? "Loading the scene" : `Shot ${activeIdx + 1 || 1} of ${PHASES.length}`);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        position: "relative",
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 20,
        boxShadow: "0 4px 16px rgba(0,0,0,0.05)",
        padding: "32px clamp(24px, 4vw, 40px)",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "linear-gradient(90deg, #0D9488, #0D948840, transparent)",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
        <motion.span
          aria-hidden="true"
          animate={reduce ? undefined : { rotate: [0, 360] }}
          transition={reduce ? undefined : { duration: 9, repeat: Infinity, ease: "linear" }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 48,
            height: 48,
            borderRadius: 14,
            background: "#F0FDFA",
            color: "#0D9488",
            flexShrink: 0,
          }}
        >
          <Sparkles size={22} />
        </motion.span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#0D9488",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Generating · {pct}%
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(20px, 2.6vw, 26px)",
              fontWeight: 700,
              color: "#111827",
              letterSpacing: "-0.01em",
            }}
          >
            {headline}
          </h2>
          <span style={{ fontSize: 13, color: "#6B7280", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <RegistrationMark size={14} color="#0D9488" />
            {subhead}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 9999,
          background: "#F3F4F6",
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{
            height: "100%",
            background: "linear-gradient(90deg, #0D9488 0%, #14B8A6 100%)",
          }}
        />
      </div>

      {/* Phase chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PHASES.map((p, i) => {
          const isActive = activeIdx === i || (activeIdx === -1 && i === 0 && pct > 0);
          const isPast = activeIdx > i;
          return (
            <span
              key={p}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: 9999,
                background: isActive ? "#F0FDFA" : isPast ? "#F9FAFB" : "#FFFFFF",
                border: `1px solid ${isActive ? "rgba(13,148,136,0.32)" : "rgba(0,0,0,0.06)"}`,
                color: isActive ? "#0D9488" : isPast ? "#6B7280" : "#9CA3AF",
              }}
            >
              {p}
            </span>
          );
        })}
      </div>

      <p style={{ margin: 0, marginTop: 16, fontSize: 13, color: "#64748B", lineHeight: 1.6 }}>
        Three to eight minutes is usual. Close this tab if you need to — when you come back, the render will have kept going.
      </p>
    </motion.section>
  );
}
