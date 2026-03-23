"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/dashboard/Header";
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
import { trackPurchase } from "@/lib/meta-pixel";

interface UsageStats {
  used: number;
  limit: number;
  resetDate: string;
}

/* ── Blueprint grid SVG pattern (AEC aesthetic) ── */
const BlueprintGrid = ({ color, opacity = 0.04 }: { color: string; opacity?: number }) => (
  <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id={`bp-${color.replace('#','')}`} width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke={color} strokeWidth="0.5" opacity={opacity} />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill={`url(#bp-${color.replace('#','')})`} />
  </svg>
);

const TIER_ORDER = ["Free", "Mini", "Starter", "Pro", "Team"];

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

  const userRole = (session?.user as { role?: string })?.role || "FREE";
  // Whether user has a real active subscription (fetched from API, not just role)
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const currentPlan = userRole === "FREE" ? "Free" : userRole === "MINI" ? "Mini" : userRole === "STARTER" ? "Starter" : userRole === "PRO" ? "Pro" : "Team";

  // Handle success/cancel redirects from Stripe
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");

    if (success === "true") {
      toast.success(t('billing.paymentSuccess'), {
        icon: <CheckCircle2 size={18} />,
        duration: 5000,
      });
      trackPurchase({ content_name: "BuildFlow Subscription", currency: "INR" });

      const syncSubscription = async (attempt = 1): Promise<void> => {
        try {
          const res = await fetch('/api/stripe/subscription', { method: 'POST' });
          const data = await res.json();
          console.info('[billing] Sync attempt', attempt, '→', data);

          if (data.synced) {
            // Subscription was updated in DB — refresh session and reload
            console.info('[billing] Subscription synced:', data.role);
            await updateSession();
            window.location.reload();
          } else if (data.reason === 'no_active_subscription' && attempt < 5) {
            // Webhook hasn't processed yet — retry with back-off
            setTimeout(() => syncSubscription(attempt + 1), attempt * 2000);
          } else {
            // already_synced or max retries — always refresh session + reload
            // This ensures the page reflects the DB state even if webhook
            // updated the role before our sync call ran.
            await updateSession();
            window.location.reload();
          }
        } catch {
          if (attempt < 5) {
            setTimeout(() => syncSubscription(attempt + 1), attempt * 2000);
          } else {
            // Final fallback — force refresh so JWT callback reads DB
            await updateSession();
            window.location.reload();
          }
        }
      };

      setTimeout(() => syncSubscription(1), 2000);
      window.history.replaceState({}, "", "/dashboard/billing");
    } else if (canceled === "true") {
      toast.error(t('billing.checkoutCanceled'), {
        icon: <XCircle size={18} />,
        duration: 4000,
      });
      window.history.replaceState({}, "", "/dashboard/billing");
    }
  }, [searchParams, updateSession]);

  useEffect(() => {
    api.executions.list({ limit: 1000 })
      .then(({ executions }) => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthExecutions = executions.filter(e => new Date(e.startedAt) >= monthStart);
        const limitMap: Record<string, number> = { FREE: 5, MINI: 10, STARTER: 30, PRO: 100 };
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        setUsage({ used: monthExecutions.length, limit: limitMap[userRole] || 1000, resetDate: nextMonth.toISOString() });
      })
      .catch(() => {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const limitMap: Record<string, number> = { FREE: 5, MINI: 10, STARTER: 30, PRO: 100 };
        setUsage({ used: 0, limit: limitMap[userRole] || 1000, resetDate: nextMonth.toISOString() });
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
      .then(res => res.json())
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
    try {
      // Step 1: Create Razorpay subscription on server
      const res = await fetch('/api/razorpay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (!data.subscriptionId || !data.razorpayKeyId) {
        throw new Error(data.error?.message || 'Failed to create Razorpay subscription');
      }

      // Step 2: Open Razorpay checkout widget
      const Razorpay = (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open: () => void; on: (event: string, cb: () => void) => void } }).Razorpay;
      if (!Razorpay) {
        toast.error('Payment gateway is loading. Please try again in a moment.');
        setUpgradingTo(null);
        return;
      }

      const rzp = new Razorpay({
        key: data.razorpayKeyId,
        subscription_id: data.subscriptionId,
        name: 'BuildFlow',
        description: `${planKey} Plan Subscription`,
        prefill: {
          email: data.email || session?.user?.email || '',
          name: data.name || session?.user?.name || '',
        },
        theme: { color: '#4F8AFF' },
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
              toast.success(t('billing.planUpgraded'), { icon: <CheckCircle2 size={18} />, duration: 5000 });
              trackPurchase({ content_name: "BuildFlow Subscription", currency: "INR" });
              await updateSession();
              window.location.reload();
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

      rzp.on('payment.failed', () => {
        toast.error('Payment failed. Please try again.');
        setUpgradingTo(null);
      });

      rzp.open();
    } catch {
      toast.error(t('billing.checkoutFailed'));
      setUpgradingTo(null);
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
    const _isUpgrade = (planName: string) => TIER_ORDER.indexOf(planName) > currentIndex;
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
      cta: currentPlan === "Mini" ? t('billing.currentPlan') : _isUpgrade("Mini") ? t('billing.upgradeToMini') : t('billing.downgrade'),
      ctaDisabled: currentPlan === "Mini",
      highlighted: false,
      color: "#F59E0B",
      colorRgb: "245,158,11",
      gradient: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)",
      planType: "MINI",
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
      cta: currentPlan === "Starter" ? t('billing.currentPlan') : _isUpgrade("Starter") ? t('billing.upgradeToStarter') : t('billing.downgrade'),
      ctaDisabled: currentPlan === "Starter",
      highlighted: false,
      color: "#10B981",
      colorRgb: "16,185,129",
      gradient: "linear-gradient(135deg, #10B981 0%, #34D399 100%)",
      planType: "STARTER",
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
      cta: currentPlan === "Pro" ? t('billing.currentPlan') : _isUpgrade("Pro") ? t('billing.upgradeToPro') : t('billing.downgrade'),
      ctaDisabled: currentPlan === "Pro",
      highlighted: true,
      color: "#4F8AFF",
      colorRgb: "79,138,255",
      gradient: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
      badge: t('billing.mostPopular'),
      planType: "PRO",
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
      cta: currentPlan === "Team" ? t('billing.currentPlan') : _isUpgrade("Team") ? t('billing.upgradeToTeam') : t('billing.downgrade'),
      ctaDisabled: currentPlan === "Team",
      highlighted: false,
      color: "#8B5CF6",
      colorRgb: "139,92,246",
      gradient: "linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)",
      planType: "TEAM_ADMIN",
    },
  ];}, [currentPlan, currentIndex, t]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('billing.title')}
        subtitle={t('billing.subtitle')}
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-8">

        {/* ── Launch Offer Banner — FREE users only ── */}
        {userRole === "FREE" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative rounded-[16px] border-2 border-[#F59E0B] bg-gradient-to-r from-[#F59E0B15] via-[#EF444415] to-[#F59E0B15] p-6 overflow-hidden"
          >
            <motion.div
              animate={{
                background: [
                  "radial-gradient(circle at 20% 50%, rgba(245,158,11,0.15), transparent 50%)",
                  "radial-gradient(circle at 80% 50%, rgba(239,68,68,0.15), transparent 50%)",
                  "radial-gradient(circle at 20% 50%, rgba(245,158,11,0.15), transparent 50%)",
                ],
              }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0"
            />
            <div className="relative z-10 flex items-center gap-5 billing-hackathon-inner">
              <motion.div
                animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-16 h-16 rounded-[14px] bg-gradient-to-br from-[#F59E0B] to-[#EF4444] flex items-center justify-center shadow-[0_8px_24px_rgba(245,158,11,0.4)]"
              >
                <Sparkles size={28} className="text-white" />
              </motion.div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl font-bold text-[#F0F0F5]">{t('billing.launchOffer')}</h3>
                  <motion.span
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="px-3 py-1 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white text-xs font-bold shadow-[0_4px_12px_rgba(245,158,11,0.4)]"
                  >
                    {t('billing.earlyBird')}
                  </motion.span>
                </div>
                <p className="text-sm text-[#C0C0D0]">{t('billing.launchOfferDesc')}</p>
              </div>
              <button
                onClick={() => handleUpgrade('MINI')}
                disabled={upgradingTo === 'MINI'}
                className="px-7 py-3 rounded-[10px] bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white font-bold text-sm hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {upgradingTo === 'MINI' ? (
                  <><Loader2 size={16} className="animate-spin" />{t('billing.processing')}</>
                ) : (
                  <><Zap size={16} fill="currentColor" />{t('billing.startAt99')}</>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Current Usage Card ── */}
        {(userRole === "FREE" || userRole === "MINI" || userRole === "STARTER" || userRole === "PRO") && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="relative rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[#111120] p-6 overflow-hidden"
          >
            <BlueprintGrid color="#4F8AFF" opacity={0.03} />
            <div className="relative z-10">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-[#F0F0F5]">{t('billing.currentPlanLabel')}: {currentPlan}</h3>
                    {userRole !== "FREE" && (
                      <button
                        onClick={handleManageSubscription}
                        className="px-3 py-1 rounded-lg text-xs font-medium text-[#9898B0] bg-[#16162A] hover:bg-[#2A2A3E] border border-[rgba(255,255,255,0.05)] transition-colors"
                      >
                        {t('billing.manageBilling')}
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-[#7C7C96]">
                    {loading ? t('billing.loadingUsage') : `${usage?.used || 0} of ${usage?.limit || 5} ${t('billing.runsUsed')}`}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-[#4F8AFF]">
                    {loading ? "\u2014" : `${usage?.used || 0}/${usage?.limit || 5}`}
                  </div>
                  <div className="text-xs text-[#7C7C96] mt-1">
                    {loading ? "" : `${t('billing.resets')} ${new Date(usage?.resetDate || "").toLocaleDateString()}`}
                  </div>
                </div>
              </div>

              {!loading && usage && (
                <div className="space-y-3">
                  <div className="h-3 bg-[#16162A] rounded-full overflow-hidden relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] relative"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    </motion.div>
                  </div>
                  {usage.used >= usage.limit && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]">
                      <Zap size={16} className="text-[#EF4444]" />
                      <p className="text-sm text-[#EF4444] flex-1">{t('billing.monthlyLimit')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Team Current Plan ── */}
        {(userRole === "TEAM_ADMIN" || userRole === "PLATFORM_ADMIN") && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-[16px] border border-[rgba(79,138,255,0.3)] bg-gradient-to-r from-[#4F8AFF15] to-[#8B5CF615] p-6"
          >
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-[12px] bg-gradient-to-br from-[#4F8AFF] to-[#8B5CF6] flex items-center justify-center shadow-[0_8px_24px_rgba(79,138,255,0.3)]">
                <Zap size={28} className="text-white" fill="white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-[#F0F0F5] mb-1">{t('billing.currentPlanTeam')}</h3>
                <p className="text-sm text-[#C0C0D0]">{t('billing.unlimitedRuns')}</p>
              </div>
              <button
                onClick={handleManageSubscription}
                className="px-6 py-3 rounded-[10px] bg-[#16162A] text-[#F0F0F5] font-semibold text-sm hover:bg-[#2A2A3E] transition-colors border border-[rgba(255,255,255,0.05)]"
              >
                {t('billing.manageBilling')}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Pricing Section ── */}
        <div>
          {/* Section header with free tier note */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center mb-8"
          >
            <h2 className="text-2xl font-bold text-[#F0F0F5] mb-2">{t('billing.choosePlan')}</h2>
            <p className="text-sm text-[#7C7C96] mb-3">{t('billing.moneyBack')}</p>
            {/* Free tier mention */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#16162A] border border-[rgba(255,255,255,0.05)]">
              <Shield size={14} className="text-[#7C7C96]" />
              <span className="text-xs text-[#9898B0]">
                {t('billing.freeTierNote')}
              </span>
            </div>
          </motion.div>

          {/* ── 4-column pricing grid ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map((plan, index) => {
              const isActive = plan.ctaDisabled;
              const isHovered = hoveredPlan === plan.tier;

              return (
                <motion.div
                  key={plan.tier}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + index * 0.1, type: "spring", stiffness: 200, damping: 20 }}
                  onMouseEnter={() => setHoveredPlan(plan.tier)}
                  onMouseLeave={() => setHoveredPlan(null)}
                  className="relative rounded-[20px] border overflow-hidden transition-all duration-300"
                  style={{
                    borderColor: isActive
                      ? plan.color
                      : plan.highlighted
                      ? `rgba(${plan.colorRgb},0.4)`
                      : "rgba(255,255,255,0.06)",
                    borderWidth: isActive || plan.highlighted ? 2 : 1,
                    background: "#0D0D1A",
                    transform: isHovered ? "translateY(-6px)" : "translateY(0)",
                    boxShadow: isActive
                      ? `0 8px 40px rgba(${plan.colorRgb},0.15), 0 0 0 1px rgba(${plan.colorRgb},0.1)`
                      : isHovered
                      ? `0 20px 60px rgba(0,0,0,0.4), 0 0 30px rgba(${plan.colorRgb},0.08)`
                      : "0 4px 20px rgba(0,0,0,0.2)",
                  }}
                >
                  {/* Blueprint grid overlay */}
                  <BlueprintGrid color={plan.color} opacity={isHovered ? 0.06 : 0.03} />

                  {/* Top accent line */}
                  <div
                    className="absolute top-0 left-0 right-0 h-[3px]"
                    style={{ background: plan.gradient }}
                  />

                  {/* Animated glow on hover */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: `radial-gradient(ellipse at 50% 0%, rgba(${plan.colorRgb},0.08) 0%, transparent 60%)`,
                        }}
                      />
                    )}
                  </AnimatePresence>

                  {/* Badge */}
                  {isActive ? (
                    <motion.div
                      initial={{ scale: 0, y: -10 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ delay: 0.4 + index * 0.1, type: "spring", stiffness: 300 }}
                      className="absolute -top-[1px] left-1/2 -translate-x-1/2 z-20"
                    >
                      <div
                        className="px-4 py-1.5 rounded-b-lg text-white text-[11px] font-bold tracking-[0.15em] uppercase flex items-center gap-1.5"
                        style={{ background: plan.gradient }}
                      >
                        <CheckCircle2 size={11} />
                        {t('billing.activePlan').toUpperCase()}
                      </div>
                    </motion.div>
                  ) : plan.badge ? (
                    <motion.div
                      initial={{ scale: 0, y: -10 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ delay: 0.4 + index * 0.1, type: "spring", stiffness: 300 }}
                      className="absolute -top-[1px] left-1/2 -translate-x-1/2 z-20"
                    >
                      <div
                        className="px-4 py-1.5 rounded-b-lg text-white text-[11px] font-bold tracking-[0.15em] uppercase flex items-center gap-1.5"
                        style={{ background: plan.gradient }}
                      >
                        <Sparkles size={11} />
                        {plan.badge}
                      </div>
                    </motion.div>
                  ) : null}

                  {/* Card content */}
                  <div className="relative z-10 p-6 pt-7">
                    {/* Plan icon + name */}
                    <div className="flex items-center gap-3 mb-4">
                      <motion.div
                        animate={isActive ? { rotate: [0, 5, -5, 0] } : {}}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, rgba(${plan.colorRgb},0.15) 0%, rgba(${plan.colorRgb},0.05) 100%)`,
                          border: `1px solid rgba(${plan.colorRgb},0.2)`,
                        }}
                      >
                        <span style={{ color: plan.color }}>{plan.icon}</span>
                      </motion.div>
                      <div>
                        <h3 className="text-lg font-bold text-[#F0F0F5]">{plan.name}</h3>
                        <p className="text-xs text-[#7C7C96]">{plan.description}</p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="mb-5">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[13px] font-medium text-[#7C7C96]">₹</span>
                        <motion.span
                          className="text-4xl font-extrabold text-[#F0F0F5] tracking-tight"
                          style={isActive ? { color: plan.color } : {}}
                        >
                          {plan.price}
                        </motion.span>
                        <span className="text-xs text-[#55556A] ml-1">/ {t('billing.perMonthShort')}</span>
                      </div>
                      {plan.savings && (
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.6 }}
                          className="mt-1.5 text-xs font-semibold"
                          style={{ color: plan.color }}
                        >
                          {plan.savings}
                        </motion.div>
                      )}
                    </div>

                    {/* AI Credits */}
                    <div
                      className="mb-5 p-3 rounded-xl"
                      style={{
                        background: `linear-gradient(135deg, rgba(${plan.colorRgb},0.04) 0%, rgba(${plan.colorRgb},0.01) 100%)`,
                        border: `1px solid rgba(${plan.colorRgb},0.08)`,
                      }}
                    >
                      <div className="text-[11px] font-bold text-[#5C5C78] mb-2.5 uppercase tracking-[0.12em]">
                        {t('billing.aiCredits')}
                      </div>
                      <div className="space-y-2">
                        {plan.nodeCredits.map((credit, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 text-[#9898B0]">
                              {credit.icon}
                              <span>{credit.label}</span>
                            </div>
                            <span
                              className="font-bold"
                              style={{
                                color: credit.value === "0"
                                  ? "#3A3A50"
                                  : credit.value === "\u221E"
                                  ? "#10B981"
                                  : plan.color,
                              }}
                            >
                              {credit.value === "0" ? "\u2014" : credit.value}
                              {credit.value !== "0" && credit.value !== "\u221E" ? `/${t('billing.perMonthShort')}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Features */}
                    <ul className="space-y-2.5 mb-6">
                      {plan.features.map((feature, idx) => (
                        <motion.li
                          key={idx}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.35 + index * 0.1 + idx * 0.04 }}
                          className="flex items-start gap-2.5 text-xs"
                        >
                          <div
                            className="w-4 h-4 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0"
                            style={{ background: `rgba(${plan.colorRgb},0.12)` }}
                          >
                            <Check size={10} style={{ color: plan.color }} strokeWidth={3} />
                          </div>
                          <span className="text-[#C0C0D0]">{feature}</span>
                        </motion.li>
                      ))}
                    </ul>

                    {/* CTA Button */}
                    <motion.button
                      whileHover={!isActive && upgradingTo === null ? { scale: 1.02 } : {}}
                      whileTap={!isActive && upgradingTo === null ? { scale: 0.98 } : {}}
                      disabled={isActive || upgradingTo !== null}
                      onClick={() => plan.planType && handleUpgrade(plan.planType as 'MINI' | 'STARTER' | 'PRO' | 'TEAM_ADMIN')}
                      className="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                      style={
                        isActive
                          ? {
                              background: `rgba(${plan.colorRgb},0.08)`,
                              border: `1px solid rgba(${plan.colorRgb},0.2)`,
                              color: plan.color,
                              cursor: "default",
                            }
                          : plan.highlighted && upgradingTo === null
                          ? {
                              background: plan.gradient,
                              color: "#fff",
                              boxShadow: `0 4px 20px rgba(${plan.colorRgb},0.3)`,
                            }
                          : {
                              background: "#16162A",
                              color: "#F0F0F5",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }
                      }
                    >
                      {upgradingTo === plan.planType ? (
                        <><Loader2 size={16} className="animate-spin" />{t('billing.processing')}</>
                      ) : isActive ? (
                        <><CheckCircle2 size={15} />{plan.cta}</>
                      ) : (
                        <>
                          {plan.cta}
                          <ArrowRight size={14} style={{ opacity: 0.6 }} />
                        </>
                      )}
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* ── Built for AEC section ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="relative rounded-[16px] border border-[rgba(255,255,255,0.04)] bg-[#0D0D1A] p-8 overflow-hidden"
        >
          <BlueprintGrid color="#4F8AFF" opacity={0.025} />
          <div className="relative z-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(79,138,255,0.08)] border border-[rgba(79,138,255,0.15)] mb-4">
              <Building2 size={12} className="text-[#4F8AFF]" />
              <span className="text-[11px] font-bold text-[#4F8AFF] uppercase tracking-wider">{t('billing.aecSubtitle')}</span>
            </div>
            <h3 className="text-lg font-bold text-[#F0F0F5] mb-2">{t('billing.builtForAec')}</h3>
            <p className="text-sm text-[#7C7C96] max-w-lg mx-auto">
              {t('billing.builtForAecDesc')}
            </p>
          </div>
        </motion.div>
      </main>

      {/* ── Plan Change Confirmation Modal ── */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={() => setConfirmModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#111120] p-8 shadow-2xl"
            >
              <button
                onClick={() => setConfirmModal(null)}
                className="absolute top-4 right-4 p-1 rounded-lg text-[#7C7C96] hover:text-[#F0F0F5] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              >
                <X size={18} />
              </button>

              <div className="text-center mb-6">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{
                    background: confirmModal.type === 'upgrade'
                      ? 'linear-gradient(135deg, rgba(79,138,255,0.15), rgba(99,102,241,0.15))'
                      : 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))',
                    border: confirmModal.type === 'upgrade'
                      ? '1px solid rgba(79,138,255,0.2)'
                      : '1px solid rgba(245,158,11,0.2)',
                  }}
                >
                  {confirmModal.type === 'upgrade'
                    ? <ArrowUpRight size={24} className="text-[#4F8AFF]" />
                    : <ArrowDownRight size={24} className="text-[#F59E0B]" />
                  }
                </div>
                <h3 className="text-xl font-bold text-[#F0F0F5] mb-2">
                  {confirmModal.type === 'upgrade' ? t('billing.confirmUpgrade') : t('billing.confirmDowngrade')}
                </h3>
                <p className="text-sm text-[#9898B0]">
                  {currentPlan} → <strong className="text-[#4F8AFF]">{confirmModal.planName}</strong>
                </p>
              </div>

              {/* Proration info */}
              {confirmModal.type === 'upgrade' && (
                <div className="rounded-xl bg-[rgba(79,138,255,0.04)] border border-[rgba(79,138,255,0.1)] p-4 mb-6">
                  {confirmModal.loading ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-[#9898B0]">
                      <Loader2 size={14} className="animate-spin" />
                      {t('billing.calculatingProration')}
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-xs text-[#7C7C96] mb-1">{t('billing.immediateCharge')}</div>
                      <div className="text-2xl font-bold text-[#F0F0F5]">
                        ₹{(confirmModal.prorationAmount || 0).toFixed(2)}
                      </div>
                      <div className="text-xs text-[#55556A] mt-1">{t('billing.proratedAmount')}</div>
                    </div>
                  )}
                </div>
              )}

              {confirmModal.type === 'downgrade' && (
                <div className="rounded-xl bg-[rgba(245,158,11,0.04)] border border-[rgba(245,158,11,0.1)] p-4 mb-6">
                  <p className="text-xs text-[#9898B0] text-center">
                    {t('billing.downgradeNote')}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-[#9898B0] bg-[#16162A] hover:bg-[#1E1E34] border border-[rgba(255,255,255,0.06)] transition-colors"
                >
                  {t('billing.cancel')}
                </button>
                <button
                  onClick={handleConfirmPlanChange}
                  disabled={confirmModal.loading}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                  style={{
                    background: confirmModal.type === 'upgrade'
                      ? 'linear-gradient(135deg, #4F8AFF, #6366F1)'
                      : 'linear-gradient(135deg, #F59E0B, #EF4444)',
                  }}
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={() => setPaymentMethodModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#111120] p-8 shadow-2xl"
            >
              <button
                onClick={() => setPaymentMethodModal(null)}
                className="absolute top-4 right-4 p-1 rounded-lg text-[#7C7C96] hover:text-[#F0F0F5] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              >
                <X size={18} />
              </button>

              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-[#F0F0F5] mb-2">
                  {t('billing.choosePaymentMethod')}
                </h3>
                <p className="text-sm text-[#9898B0]">
                  {t('billing.subscribeTo')} <strong className="text-[#4F8AFF]">{paymentMethodModal.planName}</strong>
                </p>
              </div>

              <div className="space-y-3">
                {/* UPI / Google Pay / PhonePe (Razorpay) — shown first as preferred for India */}
                <button
                  onClick={() => handleRazorpayCheckout(paymentMethodModal.planKey)}
                  disabled={upgradingTo !== null}
                  className="w-full p-4 rounded-xl border-2 border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.04)] hover:bg-[rgba(16,185,129,0.08)] transition-all text-left flex items-center gap-4 group disabled:opacity-50"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#10B981] to-[#059669] flex items-center justify-center flex-shrink-0">
                    <Smartphone size={22} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-[#F0F0F5]">UPI / Google Pay / PhonePe</span>
                      <span className="px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.15)] text-[11px] font-bold text-[#10B981]">
                        {t('billing.recommended')}
                      </span>
                    </div>
                    <p className="text-xs text-[#7C7C96]">{t('billing.razorpayDesc')}</p>
                  </div>
                  <ArrowRight size={16} className="text-[#7C7C96] group-hover:text-[#10B981] transition-colors" />
                </button>

                {/* International Cards (Stripe) */}
                <button
                  onClick={() => handleStripeCheckout(paymentMethodModal.planKey)}
                  disabled={upgradingTo !== null}
                  className="w-full p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#16162A] hover:bg-[#1E1E34] transition-all text-left flex items-center gap-4 group disabled:opacity-50"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#6366F1] to-[#4F8AFF] flex items-center justify-center flex-shrink-0">
                    <CreditCard size={22} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-[#F0F0F5] mb-0.5">{t('billing.internationalCards')}</div>
                    <p className="text-xs text-[#7C7C96]">{t('billing.stripeDesc')}</p>
                  </div>
                  <ArrowRight size={16} className="text-[#7C7C96] group-hover:text-[#4F8AFF] transition-colors" />
                </button>
              </div>

              <p className="text-center text-[11px] text-[#55556A] mt-4">
                {t('billing.securePayment')}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Razorpay checkout.js script */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
}
