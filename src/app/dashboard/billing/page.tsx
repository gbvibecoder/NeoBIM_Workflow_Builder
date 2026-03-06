"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/dashboard/Header";
import { useSession } from "next-auth/react";
import { Check, Sparkles, Shield, Zap, Loader2, Lock, CreditCard, Users } from "lucide-react";
import { api } from "@/lib/api";

interface UsageStats {
  used: number;
  limit: number;
  resetDate: string;
}

// Security Badge Component
function SecurityBadge({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1A1A2A] border border-[rgba(255,255,255,0.06)]">
      <Icon size={14} className="text-[#10B981]" />
      <span className="text-xs text-[#9898B0] font-medium">{label}</span>
    </div>
  );
}

// Testimonial Component
function Testimonial({ quote, author, role, company }: { quote: string; author: string; role: string; company: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-[14px] bg-[#12121E] border border-[rgba(255,255,255,0.06)]"
    >
      <p className="text-sm text-[#C0C0D0] leading-relaxed mb-3">"{quote}"</p>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4F8AFF] to-[#8B5CF6] flex items-center justify-center text-xs font-bold text-white">
          {author.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <div className="text-xs font-semibold text-[#F0F0F5]">{author}</div>
          <div className="text-[10px] text-[#5C5C78]">{role} at {company}</div>
        </div>
      </div>
    </motion.div>
  );
}

export default function BillingPage() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradingTo, setUpgradingTo] = useState<string | null>(null);

  const userRole = (session?.user as { role?: string })?.role || "FREE";
  const currentPlan = userRole === "FREE" ? "Free" : userRole === "PRO" ? "Pro" : "Team";

  useEffect(() => {
    api.executions.list({ limit: 1000 })
      .then(({ executions }) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayExecutions = executions.filter(e => {
          const startDate = new Date(e.startedAt);
          startDate.setHours(0, 0, 0, 0);
          return startDate.getTime() === today.getTime();
        });

        const limit = userRole === "FREE" ? 3 : 1000;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        setUsage({
          used: todayExecutions.length,
          limit,
          resetDate: tomorrow.toISOString(),
        });
      })
      .catch(() => {
        setUsage({
          used: 0,
          limit: userRole === "FREE" ? 3 : 1000,
          resetDate: new Date(Date.now() + 86400000).toISOString(),
        });
      })
      .finally(() => setLoading(false));
  }, [userRole]);

  const handleUpgrade = async (plan: 'PRO' | 'TEAM_ADMIN') => {
    setUpgradingTo(plan);
    try {
      const planKey = plan === 'PRO' ? 'PRO' : 'TEAM';
      const priceId = plan === 'PRO' ? process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID : process.env.NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID;
      
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, plan: planKey }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setUpgradingTo(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Portal error:', error);
      alert('Failed to open billing portal.');
    }
  };

  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Perfect for exploring Workflow Builder",
      features: [
        "3 workflow runs per day",
        "Access to all node types",
        "Community templates",
        "Basic support",
      ],
      cta: currentPlan === "Free" ? "Current Plan" : "Downgrade",
      ctaDisabled: currentPlan === "Free",
      highlighted: false,
      color: "#9898B0",
      planType: null,
    },
    {
      name: "Pro",
      price: "$79",
      period: "per month",
      description: "Pays for itself in 1 project",
      savings: "Save $2,000 per project · 25x ROI",
      features: [
        "Unlimited workflow runs",
        "Priority execution queue",
        "Advanced AI models",
        "Priority support",
        "API access",
        "Custom templates",
      ],
      cta: currentPlan === "Pro" ? "Current Plan" : "Upgrade to Pro",
      ctaDisabled: currentPlan === "Pro",
      highlighted: true,
      color: "#4F8AFF",
      gradient: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
      badge: "MOST POPULAR",
      planType: "PRO" as const,
    },
    {
      name: "Team",
      price: "$149",
      period: "per month",
      description: "Collaborate with your team",
      features: [
        "Everything in Pro",
        "5 team seats included",
        "Shared workflows & templates",
        "Team analytics",
        "SSO & SAML",
        "Dedicated support",
      ],
      cta: currentPlan === "Team" ? "Current Plan" : "Upgrade to Team",
      ctaDisabled: currentPlan === "Team",
      highlighted: false,
      color: "#8B5CF6",
      gradient: "linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)",
      planType: "TEAM_ADMIN" as const,
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Billing & Plans"
        subtitle="Manage your subscription and usage"
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Hackathon Banner - More Prominent */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-[16px] border-2 border-[#F59E0B] bg-gradient-to-r from-[#F59E0B15] via-[#EF444415] to-[#F59E0B15] p-6 overflow-hidden"
        >
          {/* Animated gradient background */}
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
          
          <div className="relative z-10 flex items-center gap-5">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-16 h-16 rounded-[14px] bg-gradient-to-br from-[#F59E0B] to-[#EF4444] flex items-center justify-center shadow-[0_8px_24px_rgba(245,158,11,0.4)]"
            >
              <Sparkles size={28} className="text-white" />
            </motion.div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xl font-bold text-[#F0F0F5]">🏆 Hackathon Special</h3>
                <motion.span
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="px-3 py-1 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white text-xs font-bold shadow-[0_4px_12px_rgba(245,158,11,0.4)]"
                >
                  50% OFF
                </motion.span>
              </div>
              <p className="text-sm text-[#C0C0D0] mb-1">
                First 100 users get <strong className="text-[#F0F0F5]">50% off Pro for 6 months</strong>. Limited time offer!
              </p>
              <div className="flex items-center gap-2 text-xs text-[#F59E0B]">
                <span className="font-semibold">⏰ 47 spots remaining</span>
                <span>•</span>
                <span>Expires in 6 days</span>
              </div>
            </div>
            <button 
              onClick={() => handleUpgrade('PRO')}
              disabled={upgradingTo === 'PRO'}
              className="px-7 py-3 rounded-[10px] bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white font-bold text-sm hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {upgradingTo === 'PRO' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Zap size={16} fill="currentColor" />
                  Claim Offer
                </>
              )}
            </button>
          </div>
        </motion.div>

        {/* Security Trust Badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-3"
        >
          <SecurityBadge icon={Shield} label="256-bit SSL Encryption" />
          <SecurityBadge icon={CreditCard} label="Powered by Stripe" />
          <SecurityBadge icon={Lock} label="SOC 2 Compliant" />
          <SecurityBadge icon={Check} label="GDPR Ready" />
        </motion.div>

        {/* Current Usage (if FREE) */}
        {userRole === "FREE" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-6"
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-[#F0F0F5] mb-1">Current Plan: Free</h3>
                <p className="text-sm text-[#9898B0]">
                  {loading ? "Loading usage..." : `${usage?.used || 0} of ${usage?.limit || 3} runs used today`}
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-[#4F8AFF]">
                  {loading ? "—" : `${usage?.used || 0}/${usage?.limit || 3}`}
                </div>
                <div className="text-xs text-[#9898B0] mt-1">
                  {loading ? "" : `Resets ${new Date(usage?.resetDate || "").toLocaleDateString()}`}
                </div>
              </div>
            </div>

            {!loading && usage && (
              <div className="space-y-3">
                <div className="h-3 bg-[#1A1A2A] rounded-full overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="h-full bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] relative"
                  >
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                  </motion.div>
                </div>
                {usage.used >= usage.limit && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]">
                    <Zap size={16} className="text-[#EF4444]" />
                    <p className="text-sm text-[#EF4444] flex-1">
                      You've reached your daily limit. <strong>Upgrade to Pro for unlimited runs!</strong>
                    </p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Pro/Team Current Plan */}
        {userRole !== "FREE" && (
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
                <h3 className="text-xl font-bold text-[#F0F0F5] mb-1">Current Plan: {currentPlan}</h3>
                <p className="text-sm text-[#C0C0D0]">Unlimited workflow runs. Build without limits!</p>
              </div>
              <button
                onClick={handleManageSubscription}
                className="px-6 py-3 rounded-[10px] bg-[#1A1A2A] text-[#F0F0F5] font-semibold text-sm hover:bg-[#2A2A3E] transition-colors border border-[rgba(255,255,255,0.06)]"
              >
                Manage Billing
              </button>
            </div>
          </motion.div>
        )}

        {/* Pricing Tiers */}
        <div>
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-[#F0F0F5] mb-2">Choose Your Plan</h2>
            <p className="text-sm text-[#9898B0]">All plans include 14-day money-back guarantee</p>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className={`rounded-[16px] border p-7 transition-all hover:-translate-y-1 relative ${
                  plan.highlighted
                    ? "border-[#4F8AFF] bg-gradient-to-b from-[#4F8AFF08] to-[#12121E] shadow-[0_0_30px_rgba(79,138,255,0.15)]"
                    : "border-[rgba(255,255,255,0.06)] bg-[#12121E]"
                }`}
                style={plan.highlighted ? { borderTopWidth: 3 } : {}}
              >
                {/* Badge */}
                {plan.badge && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5 + index * 0.1, type: "spring" }}
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-white text-[10px] font-bold tracking-wider"
                    style={{ background: plan.gradient }}
                  >
                    {plan.badge}
                  </motion.div>
                )}

                <div className="mb-5">
                  <h3 className="text-xl font-bold text-[#F0F0F5] mb-1">{plan.name}</h3>
                  <p className="text-xs text-[#9898B0]">{plan.description}</p>
                </div>

                <div className="mb-5">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-5xl font-bold text-[#F0F0F5]">{plan.price}</span>
                    <span className="text-sm text-[#9898B0]">/{plan.period.split(' ')[1] || plan.period}</span>
                  </div>
                  {plan.savings && (
                    <div className="text-xs text-[#10B981] font-semibold">{plan.savings}</div>
                  )}
                </div>

                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm">
                      <Check size={16} className="text-[#10B981] mt-0.5 flex-shrink-0" strokeWidth={3} />
                      <span className="text-[#C0C0D0]">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  disabled={plan.ctaDisabled || upgradingTo !== null}
                  onClick={() => plan.planType && handleUpgrade(plan.planType)}
                  className={`w-full py-3.5 rounded-[10px] font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                    plan.ctaDisabled || upgradingTo !== null
                      ? "bg-[#1A1A2A] text-[#55556A] cursor-not-allowed"
                      : plan.highlighted
                      ? "text-white hover:shadow-[0_0_30px_rgba(79,138,255,0.4)]"
                      : "bg-[#1A1A2A] text-[#F0F0F5] hover:bg-[#2A2A3E] border border-[rgba(255,255,255,0.06)]"
                  }`}
                  style={plan.highlighted && !plan.ctaDisabled && upgradingTo === null ? { background: plan.gradient } : {}}
                >
                  {upgradingTo === plan.planType ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    plan.cta
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Social Proof / Testimonials */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <div className="text-center mb-6">
            <h3 className="text-lg font-bold text-[#F0F0F5] mb-2">Trusted by AEC professionals worldwide</h3>
            <div className="flex items-center justify-center gap-2 text-sm text-[#9898B0]">
              <Users size={16} />
              <span>2,400+ architects and engineers use Workflow Builder</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Testimonial
              quote="Workflow Builder reduced our concept design time from 2 weeks to 3 hours. The ROI is insane."
              author="Sarah Chen"
              role="Design Director"
              company="Studio Arch"
            />
            <Testimonial
              quote="The AI workflow generation is a game-changer. We're closing deals faster than ever."
              author="Michael Ross"
              role="Principal Architect"
              company="RossBuilt"
            />
            <Testimonial
              quote="Finally, a tool that speaks AEC. The IFC export alone is worth the subscription."
              author="Priya Patel"
              role="BIM Manager"
              company="UrbanFlow"
            />
          </div>
        </motion.div>

        {/* FAQ / Help */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-6"
        >
          <h3 className="text-lg font-bold text-[#F0F0F5] mb-5">Frequently Asked Questions</h3>
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-semibold text-[#F0F0F5] mb-2">Can I switch plans anytime?</h4>
              <p className="text-[#C0C0D0] leading-relaxed">
                Yes! Upgrade or downgrade anytime. Changes take effect immediately, and we'll prorate your billing.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[#F0F0F5] mb-2">Do you offer refunds?</h4>
              <p className="text-[#C0C0D0] leading-relaxed">
                Absolutely. We offer a 14-day money-back guarantee on all paid plans. No questions asked.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[#F0F0F5] mb-2">What payment methods do you accept?</h4>
              <p className="text-[#C0C0D0] leading-relaxed">
                We accept all major credit cards via Stripe. Enterprise customers can also pay via invoice.
              </p>
            </div>
          </div>
        </motion.div>
      </main>

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
