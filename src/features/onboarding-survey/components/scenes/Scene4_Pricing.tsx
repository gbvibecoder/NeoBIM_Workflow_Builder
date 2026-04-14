"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
}

export function Scene4_Pricing({ onPick }: Scene4Props) {
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

  const proFeatures = [
    t("survey.scene4.pro.f1"),
    t("survey.scene4.pro.f2"),
    t("survey.scene4.pro.f3"),
    t("survey.scene4.pro.f4"),
    t("survey.scene4.pro.f5"),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40, alignItems: "center", position: "relative" }}>
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
        style={{ textAlign: "center", maxWidth: 680 }}
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

      {/* Plans */}
      <div className="survey-plans-grid" style={{ width: "100%", maxWidth: 820 }}>
        <style>{`
          .survey-plans-grid {
            display: grid;
            grid-template-columns: 1fr 1.1fr;
            gap: 18px;
            align-items: stretch;
          }
          @media (max-width: 720px) {
            .survey-plans-grid { grid-template-columns: 1fr; }
          }
        `}</style>

        <PlanCard
          kind="free"
          label={t("survey.scene4.free.label")}
          priceLabel={t("survey.scene4.free.price")}
          tagline={t("survey.scene4.free.tagline")}
          ctaLabel={t("survey.scene4.free.cta")}
          ctaSubtitle={t("survey.scene4.free.ctaSub")}
          honestNote={t("survey.scene4.free.honest")}
          featureLabels={[]}
          onSelect={() => onPick("chose_free")}
        />

        <PlanCard
          kind="pro"
          label={t("survey.scene4.pro.label")}
          priceLabel="₹"
          priceNumeric={499}
          priceSuffix={t("survey.scene4.pro.priceSuffix")}
          tagline={t("survey.scene4.pro.tagline")}
          ctaLabel={t("survey.scene4.pro.cta")}
          ctaSubtitle={t("survey.scene4.pro.ctaSub")}
          honestNote={t("survey.scene4.pro.honest")}
          featureLabels={proFeatures}
          onSelect={() => onPick("chose_pro")}
          emphasized
        />
      </div>

      {/* Social proof */}
      <ScrollingAvatars />
    </div>
  );
}
