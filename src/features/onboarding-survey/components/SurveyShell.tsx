"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
  trackPricingClick,
  trackProfession,
  trackSkip,
  trackSurveyStart,
  trackTeamSize,
} from "@/features/onboarding-survey/lib/survey-analytics";
import type { PricingAction, SceneNumber, SurveyRecord } from "@/features/onboarding-survey/types/survey";

interface SurveyShellProps {
  initial: SurveyRecord | null;
}

/** Razorpay plan key as understood by /api/razorpay/checkout. */
type PaidPlanKey = "STARTER" | "PRO";

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: () => void) => void;
}
interface RazorpayCtor {
  new (opts: Record<string, unknown>): RazorpayInstance;
}

export function SurveyShell({ initial }: SurveyShellProps) {
  const { t } = useLocale();
  const router = useRouter();
  const { state, scene, setScene, patch, finalize, saving } = useSurveyState(initial);
  const timer = useSceneTimer();

  const [redirecting, setRedirecting] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<"starter" | "pro" | null>(null);
  const [hoverRgb, setHoverRgb] = useState<string | null>(null);

  // Funnel top — fire once on mount so GA4 can measure register → survey_start drop-off.
  useEffect(() => {
    trackSurveyStart();
  }, []);

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
        trackComplete(timer.elapsedSeconds(), {
          discovery_source: state.discoverySource,
          profession: state.profession,
          team_size: state.teamSize,
          pricing_action: state.pricingAction,
        });
        await finalize({ completedAt: true });
      }
      router.push("/dashboard");
    },
    [finalize, markOnboarded, redirecting, router, scene, state, timer]
  );

  /**
   * Open Razorpay checkout for a paid plan directly from the onboarding step.
   * Mirrors the dashboard billing flow:
   *   POST /api/razorpay/checkout → open widget → verify → /thank-you/subscription.
   * The survey itself is finalized first so we have an attribution row even
   * if the user closes the widget mid-checkout.
   */
  const openRazorpay = useCallback(
    async (planKey: PaidPlanKey, action: PricingAction) => {
      const planLower = planKey.toLowerCase() as "starter" | "pro";
      setLoadingPlan(planLower);
      try {
        const res = await fetch("/api/razorpay/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: planKey }),
        });
        const data = await res.json();
        if (!res.ok || !data.subscriptionId || !data.razorpayKeyId) {
          throw new Error(data?.error?.message || "checkout init failed");
        }

        const Razorpay = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
        if (!Razorpay) {
          toast.error(t("survey.scene4.checkoutError"));
          setLoadingPlan(null);
          return;
        }

        const rzp = new Razorpay({
          key: data.razorpayKeyId,
          subscription_id: data.subscriptionId,
          name: "BuildFlow",
          description: `${planKey} Plan Subscription`,
          prefill: {
            email: data.email || "",
            name: data.name || "",
          },
          theme: { color: planKey === "STARTER" ? "#10B981" : "#4F8AFF" },
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_subscription_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await fetch("/api/razorpay/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(response),
              });
              const verifyData = await verifyRes.json();
              if (verifyData.success) {
                // Hard-redirect so /thank-you owns the GA4 purchase event +
                // forces the next session refresh to pick up the new role.
                window.location.href = `/thank-you/subscription?plan=${planKey}`;
              } else {
                toast.error(verifyData?.error?.message || t("survey.scene4.checkoutError"));
                setLoadingPlan(null);
              }
            } catch {
              toast.error(t("survey.scene4.checkoutError"));
              setLoadingPlan(null);
            }
          },
          modal: {
            // User dismissed without paying — let them retry / pick another plan.
            ondismiss: () => {
              setLoadingPlan(null);
            },
          },
        });

        rzp.on("payment.failed", () => {
          toast.error(t("survey.scene4.checkoutError"));
          setLoadingPlan(null);
        });

        rzp.open();
      } catch {
        toast.error(t("survey.scene4.checkoutError"));
        setLoadingPlan(null);
      }
      // Action is referenced for analytics symmetry / future webhook tagging.
      void action;
    },
    [t]
  );

  // Scene 4 pick → track + finalize, then route based on action.
  const handlePricingPick = useCallback(
    async (action: PricingAction) => {
      if (redirecting || loadingPlan) return;

      // Analytics — fire before any await so events land even if checkout aborts.
      if (action === "chose_pro") trackPricingClick("pro");
      else if (action === "chose_starter") trackPricingClick("starter");
      else if (action === "explore_more") trackPricingClick("explore_more");
      else trackPricingClick("free");
      trackPricing(action);
      trackComplete(timer.elapsedSeconds(), {
        discovery_source: state.discoverySource,
        profession: state.profession,
        team_size: state.teamSize,
        pricing_action: action,
      });

      // Free / explore_more → simple route; finalize then redirect.
      if (action === "chose_free" || action === "explore_more") {
        setRedirecting(true);
        markOnboarded();
        await finalize({ pricingAction: action, completedAt: true });
        router.push(action === "explore_more" ? "/dashboard/billing" : "/dashboard");
        return;
      }

      // Paid plan → finalize survey first (attribution), then open Razorpay.
      if (action === "chose_starter" || action === "chose_pro") {
        markOnboarded();
        // Don't flip `redirecting`: the user must be able to dismiss the
        // Razorpay widget and retry without reloading the page.
        await finalize({ pricingAction: action, completedAt: true });
        const planKey: PaidPlanKey = action === "chose_pro" ? "PRO" : "STARTER";
        await openRazorpay(planKey, action);
      }
    },
    [
      finalize,
      loadingPlan,
      markOnboarded,
      openRazorpay,
      redirecting,
      router,
      state,
      timer,
    ]
  );

  // ── Keyboard nav ────────────────────────────────────────────────────────
  useKeyboardNav({
    onPrev: scene > 1 ? goBack : undefined,
    onNext: scene < 4 ? advance : undefined,
    onSkip: () => void goToDashboard("skip"),
    enabled: !redirecting && !loadingPlan,
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
      {/* Razorpay widget loader — needed only because Scene 4 can fire a
          direct UPI/card checkout. Cheap script (~12kb), one-time load. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />

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
          <BackButton onBack={goBack} visible={scene > 1 && !redirecting && !loadingPlan} />
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
              maxWidth: 1100,
            }}
          >
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
            {scene === 4 && (
              <Scene4_Pricing onPick={handlePricingPick} loadingPlan={loadingPlan} />
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      <SkipLink onSkip={() => void goToDashboard("skip")} disabled={redirecting || Boolean(loadingPlan)} />
    </div>
  );
}
