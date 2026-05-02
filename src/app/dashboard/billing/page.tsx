"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "next-auth/react";
import Script from "next/script";
import {
  Check, Sparkles, Zap, Loader2, CheckCircle2, XCircle,
  Video, Box, Image, Crown, Building2, Users, ArrowRight,
  Shield, Ruler, ArrowUpRight, ArrowDownRight, X, CreditCard, Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { PaymentErrorModal } from "@/features/billing/components/PaymentErrorModal";
import { CityscapeHero } from "@/features/billing/components/CityscapeHero";
import { AecElevationFooter } from "@/features/billing/components/AecElevationFooter";
import { PlanBuildingOutline } from "@/features/billing/components/PlanBuildingOutline";
import { BackdropFloaters } from "@/features/billing/components/BackdropFloaters";
import type { PlanTier } from "@/features/billing/components/PlanBuildingOutline";
import s from "@/features/billing/components/billing.module.css";
// trackPurchase moved to /thank-you/subscription page

interface UsageStats {
  used: number;
  limit: number;
  resetDate: string;
}

const TIER_ORDER = ["Free", "Mini", "Starter", "Pro", "Team"];

/**
 * Carries a server-classified Razorpay error code through the catch block
 * so the PaymentErrorModal renders the right copy.
 * Codes match those returned by /api/razorpay/checkout.
 */
class RazorpayCheckoutError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RazorpayCheckoutError";
  }
}

/* Small dimension-line SVG used in plan price annotations */
const DimLine = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" />
    <line x1="1" y1="3" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
    <line x1="11" y1="3" x2="11" y2="9" stroke="currentColor" strokeWidth="1" />
  </svg>
);

export default function BillingPage() {
  const { t } = useLocale();
  const { data: session, update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradingTo, setUpgradingTo] = useState<string | null>(null);
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    plan: string;
    planName: string;
    type: 'upgrade' | 'downgrade';
    prorationAmount?: number;
    loading: boolean;
  } | null>(null);
  const [paymentMethodModal, setPaymentMethodModal] = useState<{
    plan: string;
    planKey: string;
    planName: string;
  } | null>(null);
  const [paymentError, setPaymentError] = useState<{
    code?: string;
    message?: string;
    planName?: string;
  } | null>(null);

  const userRole = (session?.user as { role?: string })?.role || "FREE";
  // Whether user has a real active subscription (fetched from API, not just role)
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const currentPlan = userRole === "FREE" ? "Free" : userRole === "MINI" ? "Mini" : userRole === "STARTER" ? "Starter" : userRole === "PRO" ? "Pro" : "Team";

  // Handle success/cancel redirects from Stripe
  // New Stripe checkouts go to /thank-you/subscription directly.
  // This handler is backward-compatible for any cached ?success=true URLs.
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");

    if (success === "true") {
      // Redirect to dedicated thank you page (handles sync + tracking there)
      window.location.href = `/thank-you/subscription?plan=${userRole}`;
      return;
    } else if (canceled === "true") {
      toast.error(t('billing.checkoutCanceled'), {
        icon: <XCircle size={18} />,
        duration: 4000,
      });
      window.history.replaceState({}, "", "/dashboard/billing");
    }
  }, [searchParams, userRole, t]);

  useEffect(() => {
    api.executions.list({ limit: 1000 })
      .then(({ executions }) => {
        // Only count completed executions (SUCCESS/PARTIAL) — matches server enforcement.
        // FAILED/PENDING/RUNNING don't count against the user's quota.
        const completed = executions.filter(e => e.status === "SUCCESS" || e.status === "PARTIAL");
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        if (userRole === "FREE") {
          // FREE tier: 3 lifetime executions (not monthly)
          setUsage({ used: completed.length, limit: 3, resetDate: "" });
        } else {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const monthCompleted = completed.filter(e => new Date(e.startedAt) >= monthStart);
          const limitMap: Record<string, number> = { MINI: 10, STARTER: 30, PRO: 100 };
          setUsage({ used: monthCompleted.length, limit: limitMap[userRole] || 1000, resetDate: nextMonth.toISOString() });
        }
      })
      .catch(() => {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        if (userRole === "FREE") {
          setUsage({ used: 0, limit: 3, resetDate: "" });
        } else {
          const limitMap: Record<string, number> = { MINI: 10, STARTER: 30, PRO: 100 };
          setUsage({ used: 0, limit: limitMap[userRole] || 1000, resetDate: nextMonth.toISOString() });
        }
      })
      .finally(() => setLoading(false));
  }, [userRole]);

  // Check if user has a REAL active subscription (not just a manually set role)
  useEffect(() => {
    if (userRole === 'FREE') {
      setHasActiveSubscription(false);
      return;
    }
    fetch('/api/stripe/subscription')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => {
        setHasActiveSubscription(data.hasActiveSubscription === true);
      })
      .catch(() => setHasActiveSubscription(false));
  }, [userRole]);

  const handleUpgrade = async (plan: 'MINI' | 'STARTER' | 'PRO' | 'TEAM_ADMIN') => {
    const planKey = plan === 'TEAM_ADMIN' ? 'TEAM' : plan;
    const planNames: Record<string, string> = { MINI: 'Mini', STARTER: 'Starter', PRO: 'Pro', TEAM_ADMIN: 'Team' };

    if (hasActiveSubscription) {
      // Existing subscriber → show confirmation modal with proration preview
      const newTierIndex = TIER_ORDER.indexOf(planNames[plan] || 'Free');
      const currentTierIndex = TIER_ORDER.indexOf(currentPlan);
      const type = newTierIndex > currentTierIndex ? 'upgrade' : 'downgrade';

      setConfirmModal({ plan: planKey, planName: planNames[plan] || plan, type, loading: true });

      // Fetch proration preview for upgrades
      if (type === 'upgrade') {
        try {
          const res = await fetch('/api/stripe/preview-proration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: planKey }),
          });
          const data = await res.json();
          if (res.ok) {
            setConfirmModal(prev => prev ? { ...prev, prorationAmount: data.immediateCharge, loading: false } : null);
          } else {
            setConfirmModal(prev => prev ? { ...prev, loading: false } : null);
          }
        } catch {
          setConfirmModal(prev => prev ? { ...prev, loading: false } : null);
        }
      } else {
        setConfirmModal(prev => prev ? { ...prev, loading: false } : null);
      }
      return;
    }

    // New subscriber → show payment method choice (Stripe vs Razorpay)
    setPaymentMethodModal({ plan, planKey, planName: planNames[plan] || plan });
  };

  /** Stripe checkout flow */
  const handleStripeCheckout = async (planKey: string) => {
    setPaymentMethodModal(null);
    setUpgradingTo(planKey);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch {
      toast.error(t('billing.checkoutFailed'));
    } finally {
      setUpgradingTo(null);
    }
  };

  /** Razorpay checkout flow — UPI, Google Pay, PhonePe, Net Banking */
  const handleRazorpayCheckout = async (planKey: string) => {
    setPaymentMethodModal(null);
    setUpgradingTo(planKey);

    // Step 1: Create Razorpay subscription on server, with a 30s safety net.
    // Without this guard a hung edge proxy keeps the spinner alive indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      let res: Response;
      try {
        res = await fetch('/api/razorpay/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: planKey }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        const aborted =
          (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') ||
          (typeof fetchErr === 'object' && fetchErr !== null && 'name' in fetchErr && (fetchErr as { name: string }).name === 'AbortError');
        throw new RazorpayCheckoutError(
          'PAYMENT_SERVICE_UNAVAILABLE',
          aborted
            ? 'Checkout request timed out after 30 seconds.'
            : 'We could not reach our payment service.',
        );
      }

      // Server may have failed — read the body either way so we can classify.
      let data: {
        subscriptionId?: string;
        razorpayKeyId?: string;
        email?: string;
        name?: string;
        error?: { code?: string; message?: string; razorpayCode?: string };
      } = {};
      try {
        data = await res.json();
      } catch {
        // Non-JSON response (e.g. 502 from edge proxy) — treat as service outage.
      }

      if (!res.ok || !data.subscriptionId || !data.razorpayKeyId) {
        const serverCode = data.error?.code;
        const serverMessage = data.error?.message;
        // Trust the server's classification when present; otherwise fall back
        // to status-based heuristics so we still pick the right modal copy.
        // 401/403 maps to AUTHENTICATION_ERROR so the modal asks the user to refresh.
        const code =
          serverCode ||
          (res.status === 401 || res.status === 403
            ? 'AUTHENTICATION_ERROR'
            : res.status === 0 || res.status >= 500
              ? 'PAYMENT_SERVICE_UNAVAILABLE'
              : /plan/i.test(serverMessage || '')
                ? 'PLAN_UNAVAILABLE'
                : 'UNKNOWN');
        throw new RazorpayCheckoutError(code, serverMessage || 'Failed to create Razorpay subscription');
      }

      // Step 2: Open Razorpay checkout widget
      const Razorpay = (window as unknown as { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (response?: unknown) => void) => void } }).Razorpay;
      if (!Razorpay) {
        throw new RazorpayCheckoutError(
          'PAYMENT_SERVICE_UNAVAILABLE',
          'Payment gateway script did not load.',
        );
      }

      // The Razorpay constructor itself can throw if the SDK was loaded but
      // misconfigured (rare, but seen in stale-CDN scenarios). Wrap so the
      // error bubbles into the modal instead of an unhandled exception.
      let rzp: { open: () => void; on: (event: string, cb: (response?: unknown) => void) => void };
      try {
        rzp = new Razorpay({
          key: data.razorpayKeyId,
          subscription_id: data.subscriptionId,
          name: 'BuildFlow',
          description: `${planKey} Plan Subscription`,
          prefill: {
            email: data.email || session?.user?.email || '',
            name: data.name || session?.user?.name || '',
          },
          theme: { color: '#1A4D5C' },
          handler: async (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
            // Step 3: Verify payment on server
            try {
              toast.loading(t('billing.paymentSuccess'), { id: 'razorpay-verify' });
              const verifyRes = await fetch('/api/razorpay/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
              });
              const verifyData = await verifyRes.json();
              toast.dismiss('razorpay-verify');

              if (verifyData.success) {
                toast.success(t('billing.planUpgraded'), { icon: <CheckCircle2 size={18} />, duration: 3000 });
                await updateSession();
                window.location.href = `/thank-you/subscription?plan=${planKey}`;
              } else {
                toast.error(verifyData.error?.message || 'Payment verification failed. Contact support.');
              }
            } catch {
              toast.dismiss('razorpay-verify');
              toast.error('Payment verification failed. Your payment is safe — please contact support.');
            }
            setUpgradingTo(null);
          },
          modal: {
            ondismiss: () => {
              setUpgradingTo(null);
            },
          },
        });
      } catch (constructorErr) {
        console.error('[billing/razorpay] Razorpay constructor threw:', constructorErr);
        throw new RazorpayCheckoutError(
          'PAYMENT_SERVICE_UNAVAILABLE',
          'Payment gateway failed to initialize.',
        );
      }

      // Razorpay fires `payment.failed` for declined/cancelled bank flows and
      // `payment.error` for SDK-internal issues — handle both with one path
      // so neither outcome ever falls through to a stale spinner.
      const handleRazorpayFailureEvent = (eventName: string) => (response?: unknown) => {
        const failure = response as { error?: { description?: string; code?: string; reason?: string } } | undefined;
        const reason = failure?.error?.description || failure?.error?.reason;
        console.error(`[billing/razorpay] ${eventName} event:`, failure?.error);
        setPaymentError({
          // Keep code distinct from server-side codes so support can tell the
          // failure happened *inside* the Razorpay modal, not before it opened.
          code: 'PAYMENT_FAILED',
          message: reason || 'Your payment did not complete.',
          planName: planKey,
        });
        setUpgradingTo(null);
      };
      rzp.on('payment.failed', handleRazorpayFailureEvent('payment.failed'));
      rzp.on('payment.error', handleRazorpayFailureEvent('payment.error'));

      rzp.open();
    } catch (err) {
      console.error('[billing/razorpay] checkout failed:', err);
      const isCheckoutErr = err instanceof RazorpayCheckoutError;
      setPaymentError({
        code: isCheckoutErr ? err.code : 'PAYMENT_SERVICE_UNAVAILABLE',
        message: isCheckoutErr ? err.message : 'We could not reach our payment service.',
        planName: planKey,
      });
      setUpgradingTo(null);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const handleConfirmPlanChange = async () => {
    if (!confirmModal) return;
    setUpgradingTo(confirmModal.plan as 'MINI' | 'STARTER' | 'PRO' | 'TEAM_ADMIN');
    setConfirmModal(null);
    try {
      const res = await fetch('/api/stripe/update-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: confirmModal.plan }),
      });
      const data = await res.json();
      if (data.success) {
        const msg = data.type === 'upgrade'
          ? t('billing.planUpgraded')
          : t('billing.planDowngraded');
        toast.success(msg, { icon: <CheckCircle2 size={18} />, duration: 5000 });
        await updateSession();
        window.location.reload();
      } else {
        throw new Error(data.error?.message || 'Plan change failed');
      }
    } catch {
      toast.error(t('billing.planChangeFailed'));
    } finally {
      setUpgradingTo(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; }
    } catch {
      toast.error(t('billing.portalFailed'));
    }
  };

  const currentIndex = TIER_ORDER.indexOf(currentPlan);

  const plans = useMemo(() => {
    const _isDowngrade = (planName: string) => currentIndex >= 0 && TIER_ORDER.indexOf(planName) < currentIndex;
    return [
    {
      name: t('billing.mini'),
      tier: "Mini",
      price: "99",
      period: t('billing.perMonth'),
      description: t('billing.miniDesc'),
      icon: <Ruler size={20} />,
      features: [
        t('billing.miniFeature1'),
        t('billing.miniFeature2'),
        t('billing.miniFeature3'),
        t('billing.miniFeature4'),
        t('billing.miniFeature5'),
      ],
      nodeCredits: [
        { icon: <Video size={13} />, label: t('billing.videoCredits'), value: "0" },
        { icon: <Box size={13} />, label: t('billing.modelCredits'), value: "0" },
        { icon: <Image size={13} />, label: t('billing.renderCredits'), value: "2" },
      ],
      cta: currentPlan === "Mini" ? t('billing.currentPlan') : t('billing.upgradeToMini'),
      ctaDisabled: currentPlan === "Mini",
      isDowngrade: _isDowngrade("Mini"),
      highlighted: false,
      planType: "MINI" as const,
      draftNum: "01",
      tierIndex: 1,
      annotation: t('billing.miniAnnotation'),
      creditsTotal: "02",
    },
    {
      name: t('billing.starter'),
      tier: "Starter",
      price: "799",
      period: t('billing.perMonth'),
      description: t('billing.starterDesc'),
      icon: <Building2 size={20} />,
      features: [
        t('billing.starterFeature1'),
        t('billing.starterFeature2'),
        t('billing.starterFeature3'),
        t('billing.starterFeature4'),
        t('billing.starterFeature5'),
        t('billing.starterFeature6'),
      ],
      nodeCredits: [
        { icon: <Video size={13} />, label: t('billing.videoCredits'), value: "2" },
        { icon: <Box size={13} />, label: t('billing.modelCredits'), value: "3" },
        { icon: <Image size={13} />, label: t('billing.renderCredits'), value: "10" },
      ],
      cta: currentPlan === "Starter" ? t('billing.currentPlan') : t('billing.upgradeToStarter'),
      ctaDisabled: currentPlan === "Starter",
      isDowngrade: _isDowngrade("Starter"),
      highlighted: false,
      planType: "STARTER" as const,
      draftNum: "02",
      tierIndex: 2,
      annotation: t('billing.starterAnnotation'),
      creditsTotal: "15",
    },
    {
      name: t('billing.pro'),
      tier: "Pro",
      price: "1,999",
      period: t('billing.perMonth'),
      description: t('billing.proDesc'),
      icon: <Crown size={20} />,
      savings: t('billing.proHighlight'),
      features: [
        t('billing.proFeature1'),
        t('billing.proFeature2'),
        t('billing.proFeature3'),
        t('billing.proFeature4'),
        t('billing.proFeature5'),
        t('billing.proFeature6'),
      ],
      nodeCredits: [
        { icon: <Video size={13} />, label: t('billing.videoCredits'), value: "5" },
        { icon: <Box size={13} />, label: t('billing.modelCredits'), value: "10" },
        { icon: <Image size={13} />, label: t('billing.renderCredits'), value: "30" },
      ],
      cta: currentPlan === "Pro" ? t('billing.currentPlan') : t('billing.upgradeToPro'),
      ctaDisabled: currentPlan === "Pro",
      isDowngrade: _isDowngrade("Pro"),
      highlighted: true,
      badge: t('billing.mostPopular'),
      planType: "PRO" as const,
      draftNum: "03",
      tierIndex: 3,
      annotation: t('billing.proAnnotation'),
      creditsTotal: "45",
    },
    {
      name: t('billing.team'),
      tier: "Team",
      price: "4,999",
      period: t('billing.perMonth'),
      description: t('billing.teamDesc'),
      icon: <Users size={20} />,
      features: [
        t('billing.teamFeature1'),
        t('billing.teamFeature2'),
        t('billing.teamFeature3'),
        t('billing.teamFeature4'),
        t('billing.teamFeature5'),
        t('billing.teamFeature6'),
      ],
      nodeCredits: [
        { icon: <Video size={13} />, label: t('billing.videoCredits'), value: "15" },
        { icon: <Box size={13} />, label: t('billing.modelCredits'), value: "30" },
        { icon: <Image size={13} />, label: t('billing.renderCredits'), value: "\u221E" },
      ],
      cta: currentPlan === "Team" ? t('billing.currentPlan') : t('billing.upgradeToTeam'),
      ctaDisabled: currentPlan === "Team",
      isDowngrade: _isDowngrade("Team"),
      highlighted: false,
      planType: "TEAM_ADMIN" as const,
      draftNum: "04",
      tierIndex: 4,
      annotation: t('billing.teamAnnotation'),
      creditsTotal: "\u221E",
    },
  ];}, [currentPlan, currentIndex, t]);

  return (
    <div className={s.billingPage}>
      <BackdropFloaters />

      <div className={s.container}>

        {/* ── Active Subscription Banner — Team / Platform Admin ── */}
        {(userRole === "TEAM_ADMIN" || userRole === "PLATFORM_ADMIN") && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={s.banner}
          >
            <div className={s.bannerIcon}>
              <Zap size={26} fill="white" />
            </div>
            <div className={s.bannerBody}>
              <div className={s.bannerTag}>{t('billing.activeSubscription')}</div>
              <div className={s.bannerTitle}>
                {t('billing.currentPlanLabel')} <em>{currentPlan}</em>
              </div>
              <div className={s.bannerSub}>{t('billing.teamPlanDescription')}</div>
            </div>
            <button onClick={handleManageSubscription} className={s.bannerCta}>
              <CreditCard size={15} /> {t('billing.manageBilling')}
            </button>
          </motion.div>
        )}

        {/* ── Launch Offer Banner — FREE users only ── */}
        {userRole === "FREE" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={s.launchOffer}
          >
            <div className={s.launchOfferIcon}>
              <Sparkles size={24} />
            </div>
            <div className={s.launchOfferBody}>
              <div className={s.launchOfferTitle}>
                {t('billing.launchOffer')}
                <span className={s.launchOfferBadge}>{t('billing.earlyBird')}</span>
              </div>
              <p className={s.launchOfferSub}>{t('billing.launchOfferDesc')}</p>
            </div>
            <button
              onClick={() => handleUpgrade('MINI')}
              disabled={upgradingTo === 'MINI'}
              className={s.launchOfferCta}
            >
              {upgradingTo === 'MINI' ? (
                <><Loader2 size={16} className="animate-spin" />{t('billing.processing')}</>
              ) : (
                <><Zap size={16} fill="currentColor" />{t('billing.startAt99')}</>
              )}
            </button>
          </motion.div>
        )}

        {/* ── Current Usage Card — non-Team users ── */}
        {(userRole === "FREE" || userRole === "MINI" || userRole === "STARTER" || userRole === "PRO") && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className={s.usageCard}
          >
            <div className={s.usageCardHead}>
              <div>
                <div className={s.usageCardTitle}>
                  {t('billing.currentPlanLabel')} {currentPlan}
                  {userRole !== "FREE" && (
                    <button onClick={handleManageSubscription} className={s.usageCardManage}>
                      {t('billing.manageBilling')}
                    </button>
                  )}
                </div>
                <p className={s.usageCardSub}>
                  {loading ? t('billing.loadingUsage') : `${usage?.used || 0} of ${usage?.limit || 3} ${userRole === "FREE" ? "free runs used" : t('billing.runsUsed')}`}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className={s.usageCardBig}>
                  {loading ? "\u2014" : `${usage?.used || 0}/${usage?.limit || 3}`}
                </div>
                <div className={s.usageCardLabel}>
                  {loading ? "" : usage?.resetDate ? `${t('billing.resets')} ${new Date(usage.resetDate).toLocaleDateString()}` : "Lifetime limit"}
                </div>
              </div>
            </div>

            {!loading && usage && (
              <div>
                <div className={s.usageCardBar}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={s.usageCardBarFill}
                  >
                    <div className={s.usageCardBarShimmer} />
                  </motion.div>
                </div>
                {usage.used >= usage.limit && (
                  <div className={s.usageCardWarn}>
                    <Zap size={16} />
                    <p style={{ flex: 1 }}>{t('billing.monthlyLimit')}</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Hero with Cityscape ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className={s.hero}
        >
          <CityscapeHero />
          <div className={s.heroContent}>
            <div className={s.heroEyebrow}>
              <span className={s.heroEyebrowDot} />
              {t('billing.eyebrowBillingPlans')}
            </div>
            <h1 className={s.heroTitle}>
              {t('billing.heroTitlePart1')} <em>{t('billing.heroTitleScope')}</em>.
            </h1>
            <p className={s.heroSub}>{t('billing.heroSub')}</p>
            <div className={s.heroTrustRow}>
              <div className={s.heroTrust}>
                <Shield size={13} />
                <span><strong>14-day</strong> {t('billing.moneyBack')}</span>
              </div>
              <div className={s.heroTrustDivider} />
              <div className={s.heroTrust}>
                <CheckCircle2 size={13} />
                <span><strong>{t('billing.freeTier')}</strong> · {t('billing.freeTierDesc')}</span>
              </div>
              <div className={s.heroTrustDivider} />
              <div className={s.heroTrust}>
                <Zap size={13} />
                <span><strong>{t('billing.subSecond')}</strong> {t('billing.aiExecution')}</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Scale Divider ── */}
        <div className={s.scaleDivider}>
          <div className={s.scaleDividerLine} />
          <div className={s.scaleDividerTag}>
            <Ruler size={12} /> {t('billing.scaleTag')}
          </div>
          <div className={s.scaleDividerLine} />
        </div>

        {/* ── Plan Grid ── */}
        <div className={s.plans}>
          {plans.map((plan, index) => {
            const isActive = plan.ctaDisabled;
            const tierKey = plan.tier.toLowerCase() as PlanTier;

            return (
              <motion.div
                key={plan.tier}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.1, type: "spring", stiffness: 200, damping: 20 }}
                onMouseEnter={() => setHoveredPlan(plan.tier)}
                onMouseLeave={() => setHoveredPlan(null)}
                className={s.plan}
                data-tier={tierKey}
                data-state={isActive ? "active" : plan.highlighted ? "highlighted" : "default"}
              >
                {/* Most Popular flag */}
                {plan.highlighted && !isActive && (
                  <div className={s.popularFlag}>
                    <Sparkles size={10} />
                    {plan.badge}
                  </div>
                )}

                {/* Active pin */}
                {isActive && (
                  <div className={s.activePin}>
                    <span className={s.activePinDot} />
                    {t('billing.activePlan')}
                  </div>
                )}

                {/* Drafting strip header */}
                <div className={s.draftStrip}>
                  <div className={s.draftStripLeft}>
                    <span className={s.draftStripNum}>FB-{plan.draftNum}</span>
                    <span>{plan.name} &middot; Tier {plan.tierIndex}</span>
                  </div>
                  <div className={s.draftStripRight}>
                    <span className={s.draftStripTick}>A</span>
                  </div>
                </div>

                {/* Faint building outline */}
                <PlanBuildingOutline tier={tierKey} />

                {/* Card body */}
                <div className={s.cardBody}>
                  {/* Plan icon + name */}
                  <div className={s.planHead}>
                    <div className={s.planIconWrap}>
                      <div className={s.planIcon}>{plan.icon}</div>
                    </div>
                    <div className={s.planHeadInfo}>
                      <div className={s.planName}>{plan.name}</div>
                      <div className={s.planTagline}>{plan.description}</div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className={s.planPrice}>
                    <div className={s.planPriceRow}>
                      <span className={s.planPriceCurrency}>₹</span>
                      <span className={s.planPriceAmount}>{plan.price}</span>
                      <span className={s.planPriceSuffix}>/ {t('billing.perMonthShort')}</span>
                    </div>
                    <div className={s.priceAnnotation}>
                      <DimLine />
                      <span>{plan.annotation}</span>
                    </div>
                    {plan.savings && (
                      <div className={s.planSavingsTag}>
                        <Zap size={12} /> {plan.savings}
                      </div>
                    )}
                  </div>

                  {/* AI Credits */}
                  <div className={s.credits}>
                    <div className={s.creditsHead}>
                      <span>{t('billing.aiCredits')}</span>
                      <em>{plan.creditsTotal}</em>
                    </div>
                    <div className={s.creditsBody}>
                      {plan.nodeCredits.map((credit, idx) => (
                        <div key={idx} className={s.creditRow}>
                          <div className={s.creditLabel}>
                            <span className={s.creditLabelIcon}>{credit.icon}</span>
                            <span>{credit.label}</span>
                          </div>
                          <span className={
                            credit.value === "0"
                              ? s.creditValueZero
                              : credit.value === "\u221E"
                              ? s.creditValueInfinity
                              : s.creditValue
                          }>
                            {credit.value === "0" ? "\u2014" : credit.value}
                            {credit.value !== "0" && credit.value !== "\u221E" && (
                              <span className={s.creditValueSuffix}>/{t('billing.perMonthShort')}</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Features */}
                  <ul className={s.features}>
                    {plan.features.map((feature, idx) => (
                      <motion.li
                        key={idx}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4 + index * 0.1 + idx * 0.04 }}
                        className={s.feature}
                      >
                        <div className={s.featureMark}>
                          <Check size={10} strokeWidth={3} />
                        </div>
                        <span>{feature}</span>
                      </motion.li>
                    ))}
                  </ul>

                  {/* CTA Button — logic UNCHANGED */}
                  <motion.button
                    whileHover={
                      !isActive && !plan.isDowngrade && upgradingTo === null
                        ? { scale: 1.02 }
                        : {}
                    }
                    whileTap={!isActive && !plan.isDowngrade && upgradingTo === null ? { scale: 0.98 } : {}}
                    disabled={isActive || plan.isDowngrade || upgradingTo !== null}
                    onClick={() => plan.planType && handleUpgrade(plan.planType as 'MINI' | 'STARTER' | 'PRO' | 'TEAM_ADMIN')}
                    className={s.planCta}
                    data-variant={
                      isActive ? "active" :
                      plan.isDowngrade ? "downgrade" :
                      upgradingTo === plan.planType ? "processing" :
                      "upgrade"
                    }
                  >
                    {upgradingTo === plan.planType ? (
                      <><Loader2 size={18} className="animate-spin" />{t('billing.processing')}</>
                    ) : isActive ? (
                      <><CheckCircle2 size={18} strokeWidth={2.5} />{plan.cta}</>
                    ) : plan.isDowngrade ? (
                      <>{t('billing.lowerThanCurrentPlan')}</>
                    ) : (
                      <>
                        {plan.cta}
                        <ArrowRight size={17} strokeWidth={2.5} style={{ opacity: 0.9 }} />
                      </>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── AEC Footer with Elevation ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className={s.aec}
        >
          <div className={s.aecEyebrow}>
            <Building2 size={12} />
            <span>{t('billing.aecSubtitle')}</span>
          </div>
          <div className={s.aecTitle}>
            {t('billing.builtForAec')}
          </div>
          <div className={s.aecSub}>{t('billing.builtForAecDesc')}</div>
          <AecElevationFooter />
        </motion.div>
      </div>

      {/* ── Plan Change Confirmation Modal ── */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={s.modalBackdrop}
            onClick={() => setConfirmModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className={s.modalCard}
            >
              <button onClick={() => setConfirmModal(null)} className={s.modalClose}>
                <X size={18} />
              </button>

              <div className={s.modalHead}>
                <div className={confirmModal.type === 'upgrade' ? s.modalHeadIconUpgrade : s.modalHeadIconDowngrade}>
                  {confirmModal.type === 'upgrade'
                    ? <ArrowUpRight size={24} />
                    : <ArrowDownRight size={24} />
                  }
                </div>
                <h3 className={s.modalHeadTitle}>
                  {confirmModal.type === 'upgrade' ? t('billing.confirmUpgrade') : t('billing.confirmDowngrade')}
                </h3>
                <p className={s.modalHeadSub}>
                  {currentPlan} → <strong>{confirmModal.planName}</strong>
                </p>
              </div>

              {confirmModal.type === 'upgrade' && (
                <div className={s.prorationCardUpgrade}>
                  {confirmModal.loading ? (
                    <div className={s.prorationSpin}>
                      <Loader2 size={14} className="animate-spin" />
                      {t('billing.calculatingProration')}
                    </div>
                  ) : (
                    <>
                      <div className={s.prorationLabel}>{t('billing.immediateCharge')}</div>
                      <div className={s.prorationValue}>
                        ₹{(confirmModal.prorationAmount || 0).toFixed(2)}
                      </div>
                      <div className={s.prorationNote}>{t('billing.proratedAmount')}</div>
                    </>
                  )}
                </div>
              )}

              {confirmModal.type === 'downgrade' && (
                <div className={s.prorationCardDowngrade}>
                  <p className={s.downgradeNote}>{t('billing.downgradeNote')}</p>
                </div>
              )}

              <div className={s.modalActions}>
                <button onClick={() => setConfirmModal(null)} className={s.modalBtnSecondary}>
                  {t('billing.cancel')}
                </button>
                <button
                  onClick={handleConfirmPlanChange}
                  disabled={confirmModal.loading}
                  className={confirmModal.type === 'upgrade' ? s.modalBtnUpgrade : s.modalBtnDowngrade}
                >
                  {confirmModal.type === 'upgrade' ? t('billing.confirmUpgradeBtn') : t('billing.confirmDowngradeBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Payment Method Selection Modal ── */}
      <AnimatePresence>
        {paymentMethodModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={s.modalBackdrop}
            onClick={() => setPaymentMethodModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className={s.modalCard}
            >
              <button onClick={() => setPaymentMethodModal(null)} className={s.modalClose}>
                <X size={18} />
              </button>

              <div className={s.modalHead}>
                <h3 className={s.modalHeadTitle}>
                  {t('billing.choosePaymentMethod')}
                </h3>
                <p className={s.modalHeadSub}>
                  {t('billing.subscribeTo')} <strong>{paymentMethodModal.planName}</strong>
                </p>
              </div>

              <div className={s.payOptions}>
                <button
                  onClick={() => handleRazorpayCheckout(paymentMethodModal.planKey)}
                  disabled={upgradingTo !== null}
                  className={s.payOptionRazorpay}
                >
                  <div className={s.payOptionIconRazorpay}>
                    <Smartphone size={22} />
                  </div>
                  <div className={s.payOptionBody}>
                    <div className={s.payOptionName}>
                      UPI / Google Pay / PhonePe
                      <span className={s.payOptionRec}>{t('billing.recommended')}</span>
                    </div>
                    <p className={s.payOptionDesc}>{t('billing.razorpayDesc')}</p>
                  </div>
                  <ArrowRight size={16} className={s.payOptionArrow} />
                </button>

                <button
                  onClick={() => handleStripeCheckout(paymentMethodModal.planKey)}
                  disabled={upgradingTo !== null}
                  className={s.payOptionStripe}
                >
                  <div className={s.payOptionIconStripe}>
                    <CreditCard size={22} />
                  </div>
                  <div className={s.payOptionBody}>
                    <div className={s.payOptionName}>{t('billing.internationalCards')}</div>
                    <p className={s.payOptionDesc}>{t('billing.stripeDesc')}</p>
                  </div>
                  <ArrowRight size={16} className={s.payOptionArrow} />
                </button>
              </div>

              <p className={s.modalFooterSecure}>{t('billing.securePayment')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Graceful payment error modal */}
      <PaymentErrorModal
        open={!!paymentError}
        onClose={() => setPaymentError(null)}
        errorCode={paymentError?.code}
        errorMessage={paymentError?.message}
        planName={paymentError?.planName}
      />

      {/* Razorpay checkout.js script */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
    </div>
  );
}
