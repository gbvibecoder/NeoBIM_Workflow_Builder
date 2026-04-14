"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Box, Film, FileSpreadsheet, Zap, ArrowRight } from "lucide-react";
import { SPRING } from "@/features/onboarding-survey/lib/scene-motion";
import { PREBUILT_WORKFLOWS_MAP } from "@/features/workflows/constants/prebuilt-workflows";

interface PlanCardProps {
  kind: "free" | "pro";
  label: string;          // plan name
  priceLabel?: string;    // for pro: currency + price (animated), for free: "Free"
  priceNumeric?: number;  // for pro only — count-up target
  priceSuffix?: string;   // e.g. "/month"
  tagline: string;
  ctaLabel: string;
  ctaSubtitle?: string;
  honestNote: string;
  featureLabels: string[];
  onSelect: () => void;
  emphasized?: boolean;
}

const FEATURE_ICONS = [Sparkles, Box, Film, FileSpreadsheet, Zap, Check];

/**
 * Free plan visual: 3 actual prebuilt workflow thumbnails as mini chain
 * SVGs (real data — the user sees what Free actually unlocks).
 * Pro plan visual: aurora-shimmer border + animated feature icons.
 */
export function PlanCard(props: PlanCardProps) {
  return props.kind === "free" ? <FreePlan {...props} /> : <ProPlan {...props} />;
}

// ── Free plan ──────────────────────────────────────────────────────────
function FreePlan(props: PlanCardProps) {
  // Three actual prebuilt workflows — keeps the visual honest.
  const showcaseIds = ["wf-01", "wf-03", "wf-08"];
  const showcases = showcaseIds
    .map((id) => PREBUILT_WORKFLOWS_MAP.get(id))
    .filter((w): w is NonNullable<ReturnType<typeof PREBUILT_WORKFLOWS_MAP.get>> => Boolean(w));

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={SPRING.smooth}
      style={{
        position: "relative",
        padding: "28px 26px",
        borderRadius: 18,
        background: "rgba(18,18,30,0.7)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(14px) saturate(1.25)",
        WebkitBackdropFilter: "blur(14px) saturate(1.25)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        color: "var(--text-primary)",
      }}
    >
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains), monospace" }}>
          {props.label}
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 8 }}>
          {props.priceLabel ?? "Free"}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginTop: 6 }}>
          {props.tagline}
        </p>
      </div>

      {/* Mini workflow chips — real prebuilt names */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {showcases.map((wf) => (
          <div
            key={wf.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(7,8,9,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {/* Tiny node-chain SVG — 3 dots + 2 edges */}
            <svg width="44" height="12" viewBox="0 0 44 12" aria-hidden="true">
              <circle cx="6" cy="6" r="4" fill="rgba(59,130,246,0.85)" />
              <line x1="10" y1="6" x2="18" y2="6" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="2 2" />
              <circle cx="22" cy="6" r="4" fill="rgba(139,92,246,0.85)" />
              <line x1="26" y1="6" x2="34" y2="6" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="2 2" />
              <circle cx="38" cy="6" r="4" fill="rgba(16,185,129,0.85)" />
            </svg>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {wf.name}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.55, fontStyle: "italic" }}>
        {props.honestNote}
      </div>

      <motion.button
        type="button"
        onClick={props.onSelect}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        style={{
          padding: "12px 18px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "var(--text-primary)",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {props.ctaLabel}
        <ArrowRight size={14} />
      </motion.button>
      {props.ctaSubtitle && (
        <div style={{ fontSize: 11, color: "var(--text-disabled)", textAlign: "center", marginTop: -8 }}>
          {props.ctaSubtitle}
        </div>
      )}
    </motion.div>
  );
}

// ── Pro plan ───────────────────────────────────────────────────────────
function ProPlan(props: PlanCardProps) {
  const [price, setPrice] = useState(0);
  const target = props.priceNumeric ?? 0;

  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    const duration = 1200;
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setPrice(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <motion.div
      whileHover={{ y: -8 }}
      transition={SPRING.smooth}
      style={{
        position: "relative",
        padding: "32px 28px",
        borderRadius: 20,
        background: "linear-gradient(145deg, rgba(79,138,255,0.06), rgba(139,92,246,0.05), rgba(236,72,153,0.05))",
        border: "1px solid rgba(79,138,255,0.3)",
        backdropFilter: "blur(16px) saturate(1.4)",
        WebkitBackdropFilter: "blur(16px) saturate(1.4)",
        boxShadow: "0 18px 56px rgba(0,0,0,0.45), 0 0 40px rgba(79,138,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      {/* Aurora shimmer sweep across the border */}
      <motion.div
        aria-hidden="true"
        animate={{ x: ["-120%", "120%"] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "45%",
          height: 2,
          background: "linear-gradient(90deg, transparent, rgba(79,138,255,0.9), rgba(139,92,246,0.9), rgba(236,72,153,0.9), transparent)",
          filter: "blur(0.5px)",
          pointerEvents: "none",
        }}
      />

      {/* Recommended badge */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 10px",
          borderRadius: 999,
          background: "linear-gradient(135deg, rgba(79,138,255,0.2), rgba(139,92,246,0.2))",
          border: "1px solid rgba(79,138,255,0.35)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#A5B4FC",
        }}
      >
        <Sparkles size={10} />
        Recommended
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#A5B4FC", fontFamily: "var(--font-jetbrains), monospace" }}>
          {props.label}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 18, color: "var(--text-secondary)" }}>{props.priceLabel}</span>
          <span
            style={{
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              background: "linear-gradient(135deg, #4F8AFF, #8B5CF6, #EC4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              fontFamily: "var(--font-jetbrains), monospace",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {price}
          </span>
          <span style={{ fontSize: 14, color: "var(--text-tertiary)" }}>{props.priceSuffix}</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginTop: 6 }}>
          {props.tagline}
        </p>
      </div>

      {/* Feature rows with animated icons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {props.featureLabels.map((f, i) => {
          const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
          return (
            <motion.div
              key={f}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: "rgba(79,138,255,0.14)",
                  border: "1px solid rgba(79,138,255,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#A5B4FC",
                  flexShrink: 0,
                }}
              >
                <Icon size={13} />
              </div>
              <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{f}</span>
            </motion.div>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.55, fontStyle: "italic" }}>
        {props.honestNote}
      </div>

      <motion.button
        type="button"
        onClick={props.onSelect}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        style={{
          padding: "14px 22px",
          borderRadius: 12,
          background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 50%, #8B5CF6 100%)",
          border: "none",
          color: "#fff",
          fontSize: 14.5,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: "0 8px 28px rgba(79,138,255,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
          letterSpacing: "-0.005em",
        }}
      >
        {props.ctaLabel}
        <ArrowRight size={14} />
      </motion.button>
      {props.ctaSubtitle && (
        <div style={{ fontSize: 11, color: "var(--text-disabled)", textAlign: "center", marginTop: -8 }}>
          {props.ctaSubtitle}
        </div>
      )}
    </motion.div>
  );
}
