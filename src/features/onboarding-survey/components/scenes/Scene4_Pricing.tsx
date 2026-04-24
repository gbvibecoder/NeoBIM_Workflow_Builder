"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PlanCard } from "@/features/onboarding-survey/components/primitives/PlanCard";
import { ConfettiBurst } from "@/features/onboarding-survey/components/primitives/ConfettiBurst";
import { ScrollingAvatars } from "@/features/onboarding-survey/components/primitives/ScrollingAvatars";
import {
  trackPricingView,
  trackSceneView,
} from "@/features/onboarding-survey/lib/survey-analytics";
import { textPullFocus } from "@/features/onboarding-survey/lib/scene-motion";
import type { PricingAction } from "@/features/onboarding-survey/types/survey";

interface Scene4Props {
  onPick: (action: PricingAction) => void;
  /** Which paid plan is mid-checkout — used to show per-card spinner. */
  loadingPlan?: "mini" | "starter" | "pro" | null;
}

export function Scene4_Pricing({ onPick, loadingPlan }: Scene4Props) {
  const { t } = useLocale();
  // Pre-flight celebratory moment: fires on entry, fades after ~1.5s.
  const [celebrating, setCelebrating] = useState(true);

  useEffect(() => {
    trackSceneView(4, "pricing");
    trackPricingView();
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setCelebrating(false), 1500);
    return () => clearTimeout(t1);
  }, []);

  const miniFeatures = [
    t("survey.scene4.mini.f1"),
    t("survey.scene4.mini.f2"),
    t("survey.scene4.mini.f3"),
    t("survey.scene4.mini.f4"),
    t("survey.scene4.mini.f5"),
  ];

  const starterFeatures = [
    t("survey.scene4.starter.f1"),
    t("survey.scene4.starter.f2"),
    t("survey.scene4.starter.f3"),
    t("survey.scene4.starter.f4"),
    t("survey.scene4.starter.f5"),
  ];

  const proFeatures = [
    t("survey.scene4.pro.f1"),
    t("survey.scene4.pro.f2"),
    t("survey.scene4.pro.f3"),
    t("survey.scene4.pro.f4"),
    t("survey.scene4.pro.f5"),
  ];

  const anyLoading = Boolean(loadingPlan);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, alignItems: "center", position: "relative" }}>
      {/* Brief celebratory burst on entry */}
      <AnimatePresence>
        {celebrating && (
          <motion.div
            key="celebration"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              zIndex: 4,
            }}
          >
            <ConfettiBurst active count={42} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Celebratory line — appears first, then dissolves into the header */}
      <motion.div
        variants={textPullFocus}
        initial="initial"
        animate="animate"
        style={{ textAlign: "center", maxWidth: 720 }}
      >
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "#FCD34D",
            marginBottom: 12,
          }}
        >
          {t("survey.scene4.celebration")}
        </motion.div>
        <div
          style={{
            display: "inline-block",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-jetbrains), monospace",
            marginBottom: 12,
          }}
        >
          {t("survey.scene4.eyebrow")}
        </div>
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4.5vw, 2.75rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            margin: 0,
            background: "linear-gradient(135deg, #FFFFFF 0%, #FEF3C7 50%, #F59E0B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {t("survey.scene4.headline")}
        </h1>
        <p style={{ marginTop: 10, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>
          {t("survey.scene4.subheadline")}
        </p>
      </motion.div>

      {/* Plans — Mini (₹99) / Starter (Most Popular) / Pro */}
      <div className="survey-plans-grid" style={{ width: "100%", maxWidth: 1080 }}>
        <style>{`
          .survey-plans-grid {
            display: grid;
            grid-template-columns: 1fr 1.18fr 1fr;
            gap: 16px;
            align-items: stretch;
          }
          @media (max-width: 980px) {
            .survey-plans-grid { grid-template-columns: 1fr; max-width: 480px; margin: 0 auto; }
          }
        `}</style>

        <PlanCard
          kind="mini"
          label={t("survey.scene4.mini.label")}
          priceLabel="₹"
          priceNumeric={99}
          priceSuffix={t("survey.scene4.mini.priceSuffix")}
          tagline={t("survey.scene4.mini.tagline")}
          ctaLabel={t("survey.scene4.mini.cta")}
          ctaSubtitle={t("survey.scene4.mini.ctaSub")}
          honestNote={t("survey.scene4.mini.honest")}
          featureLabels={miniFeatures}
          onSelect={() => onPick("chose_mini")}
          badgeLabel={t("survey.scene4.mini.badge")}
          loading={loadingPlan === "mini"}
        />

        <PlanCard
          kind="starter"
          label={t("survey.scene4.starter.label")}
          priceLabel="₹"
          priceNumeric={799}
          priceSuffix={t("survey.scene4.starter.priceSuffix")}
          tagline={t("survey.scene4.starter.tagline")}
          ctaLabel={t("survey.scene4.starter.cta")}
          ctaSubtitle={t("survey.scene4.starter.ctaSub")}
          honestNote={t("survey.scene4.starter.honest")}
          featureLabels={starterFeatures}
          onSelect={() => onPick("chose_starter")}
          emphasized
          badgeLabel={t("survey.scene4.starter.badge")}
          loading={loadingPlan === "starter"}
        />

        <PlanCard
          kind="pro"
          label={t("survey.scene4.pro.label")}
          priceLabel="₹"
          priceNumeric={1999}
          priceSuffix={t("survey.scene4.pro.priceSuffix")}
          tagline={t("survey.scene4.pro.tagline")}
          ctaLabel={t("survey.scene4.pro.cta")}
          ctaSubtitle={t("survey.scene4.pro.ctaSub")}
          honestNote={t("survey.scene4.pro.honest")}
          featureLabels={proFeatures}
          onSelect={() => onPick("chose_pro")}
          badgeLabel={t("survey.scene4.pro.recommended")}
          loading={loadingPlan === "pro"}
        />
      </div>

      {/* Tertiary affordance — bail-out path to the free/limited experience.
          Mirrors the old "chose_free" flow: finalize + redirect straight to
          /dashboard. Kept as a low-emphasis dashed pill so it doesn't steal
          attention from the paid CTAs, but now clearly labelled. */}
      <motion.button
        type="button"
        onClick={() => onPick("chose_free")}
        disabled={anyLoading}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        whileHover={{ y: anyLoading ? 0 : -1, color: anyLoading ? undefined : "var(--text-primary)" }}
        whileTap={{ scale: anyLoading ? 1 : 0.98 }}
        style={{
          marginTop: -8,
          padding: "10px 18px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.03)",
          border: "1px dashed rgba(255,255,255,0.18)",
          color: "var(--text-secondary)",
          fontSize: 13,
          fontWeight: 600,
          cursor: anyLoading ? "not-allowed" : "pointer",
          opacity: anyLoading ? 0.5 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          letterSpacing: "0.005em",
        }}
      >
        {t("survey.scene4.tryFree")}
        <ArrowUpRight size={14} />
      </motion.button>
      <div
        style={{
          marginTop: -28,
          fontSize: 11,
          color: "var(--text-tertiary)",
          textAlign: "center",
        }}
      >
        {t("survey.scene4.tryFreeSub")}
      </div>

      {/* Social proof */}
      <ScrollingAvatars />
    </div>
  );
}
