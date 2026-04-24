"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Box, Film, FileSpreadsheet, Zap, ArrowRight, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { SPRING } from "@/features/onboarding-survey/lib/scene-motion";
import { PREBUILT_WORKFLOWS_MAP } from "@/features/workflows/constants/prebuilt-workflows";

type PlanKind = "free" | "mini" | "starter" | "pro";

interface PlanCardProps {
  kind: PlanKind;
  label: string;          // plan name
  priceLabel?: string;    // for paid: currency symbol; for free: "Free"
  priceNumeric?: number;  // for paid only — count-up target
  priceSuffix?: string;   // e.g. "/month"
  tagline: string;
  ctaLabel: string;
  ctaSubtitle?: string;
  honestNote: string;
  featureLabels: string[];
  onSelect: () => void;
  emphasized?: boolean;   // visually dominant card (Most Popular)
  badgeLabel?: string;    // "Most Popular" / "Premium" — paid plans only
  loading?: boolean;      // CTA shows spinner + disables when true
}

const FEATURE_ICONS = [Sparkles, Box, Film, FileSpreadsheet, Zap, Check];

/**
 * Aurora-themed colour palette for paid plans.
 *
 * Tuned for a left-to-right temperature progression:
 *   MINI → warm amber (entry, chai vibe)
 *   STARTER → cool emerald/teal (featured, fresh)
 *   PRO → deep indigo/violet (premium)
 *
 * Previously MINI slid into rose (#F43F5E) and PRO into hot pink (#EC4899).
 * Together with Starter's green, the three cards read like a rainbow.
 * The updated palette keeps each tier distinguishable but stays within a
 * coherent family — amber stays amber, pro stays blue-violet, no stray
 * pinks bleeding into either card.
 */
const PAID_THEME = {
  mini: {
    bgGradient:
      "linear-gradient(145deg, rgba(245,158,11,0.08), rgba(249,115,22,0.06), rgba(217,119,6,0.05))",
    border: "rgba(245,158,11,0.32)",
    shadow:
      "0 18px 56px rgba(0,0,0,0.45), 0 0 36px rgba(245,158,11,0.14), inset 0 1px 0 rgba(255,255,255,0.06)",
    auroraGradient:
      "linear-gradient(90deg, transparent, rgba(245,158,11,0.9), rgba(249,115,22,0.9), rgba(217,119,6,0.9), transparent)",
    accentText: "#FCD34D",
    priceGradient: "linear-gradient(135deg, #F59E0B, #F97316, #D97706)",
    iconBg: "rgba(245,158,11,0.14)",
    iconBorder: "rgba(245,158,11,0.28)",
    iconColor: "#FCD34D",
    ctaGradient: "linear-gradient(135deg, #F59E0B 0%, #F97316 50%, #D97706 100%)",
    ctaShadow: "0 8px 28px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
    badgeBg: "linear-gradient(135deg, rgba(245,158,11,0.28), rgba(249,115,22,0.28))",
    badgeBorder: "rgba(245,158,11,0.5)",
    badgeText: "#FDE68A",
  },
  starter: {
    bgGradient:
      "linear-gradient(145deg, rgba(16,185,129,0.08), rgba(20,184,166,0.06), rgba(34,211,238,0.06))",
    border: "rgba(16,185,129,0.4)",
    shadow:
      "0 18px 56px rgba(0,0,0,0.45), 0 0 44px rgba(16,185,129,0.15), inset 0 1px 0 rgba(255,255,255,0.06)",
    auroraGradient:
      "linear-gradient(90deg, transparent, rgba(16,185,129,0.95), rgba(45,212,191,0.95), rgba(34,211,238,0.95), transparent)",
    accentText: "#5EEAD4",
    priceGradient: "linear-gradient(135deg, #10B981, #2DD4BF, #5EEAD4)",
    iconBg: "rgba(16,185,129,0.16)",
    iconBorder: "rgba(16,185,129,0.3)",
    iconColor: "#5EEAD4",
    ctaGradient: "linear-gradient(135deg, #10B981 0%, #14B8A6 50%, #06B6D4 100%)",
    ctaShadow: "0 8px 28px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
    badgeBg: "linear-gradient(135deg, rgba(16,185,129,0.28), rgba(45,212,191,0.28))",
    badgeBorder: "rgba(16,185,129,0.5)",
    badgeText: "#A7F3D0",
  },
  pro: {
    bgGradient:
      "linear-gradient(145deg, rgba(79,138,255,0.06), rgba(99,102,241,0.06), rgba(139,92,246,0.05))",
    border: "rgba(79,138,255,0.3)",
    shadow:
      "0 18px 56px rgba(0,0,0,0.45), 0 0 40px rgba(99,102,241,0.10), inset 0 1px 0 rgba(255,255,255,0.06)",
    auroraGradient:
      "linear-gradient(90deg, transparent, rgba(79,138,255,0.9), rgba(99,102,241,0.9), rgba(139,92,246,0.9), transparent)",
    accentText: "#A5B4FC",
    priceGradient: "linear-gradient(135deg, #4F8AFF, #6366F1, #8B5CF6)",
    iconBg: "rgba(99,102,241,0.16)",
    iconBorder: "rgba(99,102,241,0.28)",
    iconColor: "#A5B4FC",
    ctaGradient: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 50%, #8B5CF6 100%)",
    ctaShadow: "0 8px 28px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
    badgeBg: "linear-gradient(135deg, rgba(79,138,255,0.22), rgba(139,92,246,0.22))",
    badgeBorder: "rgba(99,102,241,0.45)",
    badgeText: "#C7D2FE",
  },
} as const;

/**
 * Free plan visual: 3 actual prebuilt workflow thumbnails as mini chain
 * SVGs (real data — the user sees what Free actually unlocks).
 * Paid plans: aurora-shimmer border + animated feature icons, themed per tier.
 */
export function PlanCard(props: PlanCardProps) {
  if (props.kind === "free") return <FreePlan {...props} />;
  return <PaidPlan {...props} kind={props.kind} />;
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
        disabled={props.loading}
        whileHover={{ scale: props.loading ? 1 : 1.01 }}
        whileTap={{ scale: props.loading ? 1 : 0.98 }}
        style={{
          padding: "12px 18px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "var(--text-primary)",
          fontSize: 14,
          fontWeight: 700,
          cursor: props.loading ? "wait" : "pointer",
          opacity: props.loading ? 0.7 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {props.loading ? <Loader2 size={14} className="spin-anim" /> : null}
        {props.ctaLabel}
        {!props.loading && <ArrowRight size={14} />}
      </motion.button>
      {props.ctaSubtitle && (
        <div style={{ fontSize: 11, color: "var(--text-disabled)", textAlign: "center", marginTop: -8 }}>
          {props.ctaSubtitle}
        </div>
      )}
    </motion.div>
  );
}

// ── Paid plan (Mini, Starter, or Pro — themed) ─────────────────────────
function PaidPlan(props: PlanCardProps & { kind: "mini" | "starter" | "pro" }) {
  const { t } = useLocale();
  const theme = PAID_THEME[props.kind];
  const [price, setPrice] = useState(0);
  const target = props.priceNumeric ?? 0;
  const emphasized = Boolean(props.emphasized);

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
      whileHover={{ y: -6 }}
      transition={SPRING.smooth}
      style={{
        position: "relative",
        // Uniform padding so all three cards share the same geometry.
        // Starter still reads as "featured" via its stronger glow, faster
        // aurora shimmer, larger price, and the centered top badge — but
        // the cards are pixel-symmetric.
        padding: "32px 26px",
        borderRadius: 20,
        background: theme.bgGradient,
        border: `1px solid ${theme.border}`,
        backdropFilter: "blur(16px) saturate(1.4)",
        WebkitBackdropFilter: "blur(16px) saturate(1.4)",
        boxShadow: theme.shadow,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      {/* Aurora shimmer sweep across the top border */}
      <motion.div
        aria-hidden="true"
        animate={{ x: ["-120%", "120%"] }}
        transition={{ duration: emphasized ? 2.6 : 3.5, repeat: Infinity, ease: "linear" }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "45%",
          height: 2,
          background: theme.auroraGradient,
          filter: "blur(0.5px)",
          pointerEvents: "none",
        }}
      />

      {/* Badge — Most Popular / Best Value / Recommended.
          All three cards now use the SAME top-right position for full
          symmetry. Previously Starter's badge was centered on the card's
          top border via a translate(-50%, -50%) trick — but because the
          card has overflow:hidden (needed to clip the aurora shimmer),
          the upper half of a "floating" badge got visually sliced off.
          Keeping the badge fully inside the card fixes the clipping,
          matches MINI/PRO positioning exactly, and leaves Starter's
          "featured" emphasis to the stronger glow + faster shimmer +
          larger price + distinct green theme. */}
      {props.badgeLabel && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 2,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 10px",
              borderRadius: 999,
              background: theme.badgeBg,
              border: `1px solid ${theme.badgeBorder}`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: theme.badgeText,
              whiteSpace: "nowrap",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          >
            <Sparkles size={10} />
            {props.badgeLabel}
          </motion.div>
        </div>
      )}

      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: theme.accentText,
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          {props.label}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 18, color: "var(--text-secondary)" }}>{props.priceLabel}</span>
          <span
            style={{
              fontSize: emphasized ? 50 : 44,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              background: theme.priceGradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              fontFamily: "var(--font-jetbrains), monospace",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {price.toLocaleString("en-IN")}
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
                  background: theme.iconBg,
                  border: `1px solid ${theme.iconBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: theme.iconColor,
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

      {/* Bottom cluster — honest note + CTA + subtitle anchored to the
          card's bottom edge via `marginTop: "auto"`. Because the grid has
          `align-items: stretch`, all three cards share the tallest card's
          height. Without this anchor the CTA buttons would sit at
          different y-positions (taglines and honest-notes have different
          line counts). With the anchor, Get Mini / Get Starter / Go Pro
          all share the same baseline. */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.55, fontStyle: "italic" }}>
          {props.honestNote}
        </div>

        <motion.button
          type="button"
          onClick={props.onSelect}
          disabled={props.loading}
          whileHover={{ scale: props.loading ? 1 : 1.02 }}
          whileTap={{ scale: props.loading ? 1 : 0.97 }}
          style={{
            padding: "14px 22px",
            borderRadius: 12,
            background: theme.ctaGradient,
            border: "none",
            color: "#fff",
            fontSize: 14.5,
            fontWeight: 700,
            cursor: props.loading ? "wait" : "pointer",
            opacity: props.loading ? 0.85 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            boxShadow: theme.ctaShadow,
            letterSpacing: "-0.005em",
          }}
        >
          {props.loading ? (
            <>
              <Loader2 size={14} className="spin-anim" />
              {t("survey.scene4.processing")}
            </>
          ) : (
            <>
              {props.ctaLabel}
              <ArrowRight size={14} />
            </>
          )}
        </motion.button>
        {props.ctaSubtitle && (
          <div style={{ fontSize: 11, color: "var(--text-disabled)", textAlign: "center", marginTop: -6 }}>
            {props.ctaSubtitle}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes plancardSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        :global(.spin-anim) {
          animation: plancardSpin 0.9s linear infinite;
        }
      `}</style>
    </motion.div>
  );
}
