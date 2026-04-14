"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { SceneBackdrop } from "@/features/onboarding-survey/components/SceneBackdrop";
import { ProgressDots } from "@/features/onboarding-survey/components/ProgressDots";
import { SkipLink } from "@/features/onboarding-survey/components/SkipLink";
import { BackButton } from "@/features/onboarding-survey/components/BackButton";
import { Scene1_Discovery } from "@/features/onboarding-survey/components/scenes/Scene1_Discovery";
import { Scene2_Profession } from "@/features/onboarding-survey/components/scenes/Scene2_Profession";
import { Scene3_TeamSize } from "@/features/onboarding-survey/components/scenes/Scene3_TeamSize";
import { Scene4_Pricing } from "@/features/onboarding-survey/components/scenes/Scene4_Pricing";
import { useSurveyState } from "@/features/onboarding-survey/hooks/useSurveyState";
import { useKeyboardNav } from "@/features/onboarding-survey/hooks/useKeyboardNav";
import { useSceneTimer } from "@/features/onboarding-survey/hooks/useSceneTimer";
import { sceneSlide } from "@/features/onboarding-survey/lib/scene-motion";
import { DASHBOARD_ONBOARDED_KEY } from "@/features/onboarding-survey/lib/survey-constants";
import {
  trackComplete,
  trackDiscovery,
  trackPricing,
  trackProfession,
  trackSkip,
  trackTeamSize,
} from "@/features/onboarding-survey/lib/survey-analytics";
import type { PricingAction, SceneNumber, SurveyRecord } from "@/features/onboarding-survey/types/survey";

interface SurveyShellProps {
  initial: SurveyRecord | null;
}

export function SurveyShell({ initial }: SurveyShellProps) {
  const { t } = useLocale();
  const router = useRouter();
  const { state, scene, setScene, patch, finalize, saving } = useSurveyState(initial);
  const timer = useSceneTimer();

  const [redirecting, setRedirecting] = useState(false);
  const [hoverRgb, setHoverRgb] = useState<string | null>(null);

  // Which scenes the user has answered — drives dot fill / heartbeat.
  const completed = useMemo(() => {
    const s = new Set<SceneNumber>();
    if (state.discoverySource) s.add(1);
    if (state.profession) s.add(2);
    if (state.teamSize) s.add(3);
    if (state.pricingAction) s.add(4);
    return s;
  }, [state.discoverySource, state.profession, state.teamSize, state.pricingAction]);

  const markOnboarded = useCallback(() => {
    try {
      localStorage.setItem(DASHBOARD_ONBOARDED_KEY, "1");
    } catch {
      /* private mode — survive */
    }
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────
  const advance = useCallback(() => {
    setScene((cur) => (Math.min(cur + 1, 4) as SceneNumber));
  }, [setScene]);

  const goBack = useCallback(() => {
    setScene((cur) => (Math.max(cur - 1, 1) as SceneNumber));
  }, [setScene]);

  const goToDashboard = useCallback(
    async (reason: "skip" | "complete") => {
      if (redirecting) return;
      setRedirecting(true);
      markOnboarded();
      if (reason === "skip") {
        trackSkip(scene);
        await finalize({ skippedAtScene: scene });
      } else {
        trackComplete(timer.elapsedSeconds());
        await finalize({ completedAt: true });
      }
      router.push("/dashboard");
    },
    [finalize, markOnboarded, redirecting, router, scene, timer]
  );

  // Scene 4 pick → track + finalize + route Pro to billing, Free to dashboard.
  const handlePricingPick = useCallback(
    async (action: PricingAction) => {
      if (redirecting) return;
      setRedirecting(true);
      markOnboarded();
      trackPricing(action);
      trackComplete(timer.elapsedSeconds());
      await finalize({ pricingAction: action, completedAt: true });
      router.push(action === "chose_pro" ? "/dashboard/billing" : "/dashboard");
    },
    [finalize, markOnboarded, redirecting, router, timer]
  );

  // ── Keyboard nav ────────────────────────────────────────────────────────
  useKeyboardNav({
    onPrev: scene > 1 ? goBack : undefined,
    onNext: scene < 4 ? advance : undefined,
    onSkip: () => void goToDashboard("skip"),
    enabled: !redirecting,
  });

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      <SceneBackdrop scene={scene} overrideRgb={hoverRgb} />

      {/* ── Top bar — back button + progress dots ─────────────────────── */}
      <div
        style={{
          position: "relative",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px clamp(16px, 4vw, 40px)",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 80 }}>
          <BackButton onBack={goBack} visible={scene > 1 && !redirecting} />
        </div>

        <ProgressDots current={scene} completed={completed} />

        <div style={{ minWidth: 80, display: "flex", justifyContent: "flex-end" }}>
          <motion.span
            animate={{ opacity: saving ? 1 : 0 }}
            transition={{ duration: 0.2 }}
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-jetbrains), monospace",
            }}
            aria-live="polite"
          >
            {t("survey.saving")}
          </motion.span>
        </div>
      </div>

      {/* ── Scene surface ─────────────────────────────────────────────── */}
      <main
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "clamp(16px, 3vw, 48px) clamp(16px, 4vw, 40px) 80px",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.section
            key={scene}
            variants={sceneSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            aria-live="polite"
            aria-atomic="true"
            style={{
              width: "100%",
              maxWidth: 1040,
            }}
          >
            {/* Scenes land in separate commits. Wiring hooks first.       */}
            {/* setHoverRgb is passed through once the real scenes exist.  */}
            {scene === 1 && (
              <Scene1_Discovery
                initial={{ source: state.discoverySource, other: state.discoveryOther }}
                onHoverChange={setHoverRgb}
                onPatch={patch}
                onAdvance={advance}
                onTrack={trackDiscovery}
              />
            )}
            {scene === 2 && (
              <Scene2_Profession
                initial={{ profession: state.profession, other: state.professionOther }}
                onPatch={patch}
                onAdvance={advance}
                onTrack={trackProfession}
              />
            )}
            {scene === 3 && (
              <Scene3_TeamSize
                initial={{ teamSize: state.teamSize }}
                onPatch={patch}
                onAdvance={advance}
                onTrack={trackTeamSize}
              />
            )}
            {scene === 4 && <Scene4_Pricing onPick={handlePricingPick} />}
          </motion.section>
        </AnimatePresence>
      </main>

      <SkipLink onSkip={() => void goToDashboard("skip")} disabled={redirecting} />
    </div>
  );
}
