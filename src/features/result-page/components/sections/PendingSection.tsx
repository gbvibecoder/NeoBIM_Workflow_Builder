"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, Film } from "lucide-react";
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
  previewImageUrls?: string[];
}

/** In-progress hero — blurred render preview background + progress overlay. */
export function PendingSection({ progress, previewImageUrls = [] }: PendingSectionProps) {
  const reduce = useReducedMotion();
  const pct = Math.min(Math.max(progress?.progress ?? 0, 0), 100);
  const activeIdx = progress?.phase ? PHASES.findIndex(p => p === progress.phase) : -1;
  const [imgIdx, setImgIdx] = useState(0);
  const hasPreview = previewImageUrls.length > 0;

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
        overflow: "hidden",
        minHeight: hasPreview ? 340 : undefined,
        padding: hasPreview ? 0 : "32px clamp(24px, 4vw, 40px)",
      }}
    >
      {/* ── Blurred render preview background ── */}
      {hasPreview && (
        <>
          {/* Ken Burns animated render image */}
          <motion.div
            key={imgIdx}
            initial={{ scale: 1.05, opacity: 0 }}
            animate={{ scale: reduce ? 1.05 : 1.15, opacity: 1 }}
            transition={{ scale: { duration: 12, ease: "linear" }, opacity: { duration: 1 } }}
            onAnimationComplete={() => {
              if (previewImageUrls.length > 1) setImgIdx(i => (i + 1) % previewImageUrls.length);
            }}
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${previewImageUrls[imgIdx % previewImageUrls.length]})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(18px) saturate(1.1)",
              transform: "scale(1.1)",
            }}
          />
          {/* Dark overlay for readability */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.70) 50%, rgba(255,255,255,0.85) 100%)",
              backdropFilter: "blur(2px)",
            }}
          />
        </>
      )}

      {/* ── Content overlay ── */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: hasPreview ? "32px clamp(24px, 4vw, 40px)" : 0,
        }}
      >
        {/* Top accent line */}
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

        {/* Video preview badge */}
        {hasPreview && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 9999,
              background: "rgba(13,148,136,0.08)",
              border: "1px solid rgba(13,148,136,0.18)",
              fontSize: 10,
              fontWeight: 600,
              color: "#0D9488",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            <Film size={12} />
            Video rendering from your renders
          </div>
        )}

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
              background: hasPreview ? "rgba(240,253,250,0.9)" : "#F0FDFA",
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
            background: hasPreview ? "rgba(243,244,246,0.8)" : "#F3F4F6",
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
                  background: isActive
                    ? (hasPreview ? "rgba(240,253,250,0.9)" : "#F0FDFA")
                    : isPast
                      ? (hasPreview ? "rgba(249,250,251,0.8)" : "#F9FAFB")
                      : (hasPreview ? "rgba(255,255,255,0.8)" : "#FFFFFF"),
                  border: `1px solid ${isActive ? "rgba(13,148,136,0.32)" : "rgba(0,0,0,0.06)"}`,
                  color: isActive ? "#0D9488" : isPast ? "#6B7280" : "#9CA3AF",
                }}
              >
                {p}
              </span>
            );
          })}
        </div>

        {/* ETA strip */}
        {pct > 0 && pct < 100 ? (
          <div
            style={{
              marginTop: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 12px",
              borderRadius: 9999,
              background: hasPreview ? "rgba(240,253,250,0.9)" : "#F0FDFA",
              border: "1px solid rgba(13,148,136,0.20)",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 500,
              color: "#0D9488",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#0D9488" }} />
            ETA · ~{etaForProgress(pct)}
          </div>
        ) : null}

        <p style={{ margin: 0, marginTop: 16, fontSize: 13, color: "#64748B", lineHeight: 1.6 }}>
          Three to eight minutes is usual. Close this tab if you need to — when you come back, the render will have kept going.
        </p>
      </div>
    </motion.section>
  );
}

/** Phase 4.2 — best-effort ETA from progress %. Assumes a 5-minute typical
 *  render (Kling-grade). Returns "Xm Ys" or "Xm" depending on remaining. */
function etaForProgress(pct: number): string {
  if (pct >= 99) return "moments";
  const remainingPct = 100 - pct;
  const totalRenderSec = 5 * 60; // 5-minute typical
  const remainingSec = Math.ceil((remainingPct / 100) * totalRenderSec);
  if (remainingSec >= 60) {
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${remainingSec}s`;
}
