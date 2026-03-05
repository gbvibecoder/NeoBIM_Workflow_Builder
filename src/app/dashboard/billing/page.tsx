"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/dashboard/Header";
import { useSession } from "next-auth/react";
import { Check, Sparkles, Users, Zap } from "lucide-react";
import { api } from "@/lib/api";

interface UsageStats {
  used: number;
  limit: number;
  resetDate: string;
}

export default function BillingPage() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const userRole = (session?.user as { role?: string })?.role || "FREE";
  const currentPlan = userRole === "FREE" ? "Free" : userRole === "PRO" ? "Pro" : "Team";

  useEffect(() => {
    // Fetch usage stats
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
      .catch(err => {
        console.error("Failed to fetch usage:", err);
        setUsage({
          used: 0,
          limit: userRole === "FREE" ? 3 : 1000,
          resetDate: new Date(Date.now() + 86400000).toISOString(),
        });
      })
      .finally(() => setLoading(false));
  }, [userRole]);

  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Perfect for exploring NeoBIM",
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
    },
    {
      name: "Pro",
      price: "$79",
      period: "per month",
      description: "Pays for itself in 1 project",
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
      badge: "MOST POPULAR",
    },
    {
      name: "Team",
      price: "$99",
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
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Billing & Plans"
        subtitle="Manage your subscription and usage"
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Hackathon Banner */}
        <div className="rounded-[14px] border border-[#F59E0B33] bg-gradient-to-r from-[#F59E0B15] to-[#EF444415] p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#F59E0B] opacity-5 rounded-full blur-3xl" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#F59E0B] to-[#EF4444] flex items-center justify-center">
              <Sparkles size={24} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-bold text-[#F0F0F5]">🏆 Hackathon Special</h3>
                <span className="px-2 py-0.5 rounded-full bg-[#F59E0B] text-white text-xs font-bold">
                  50% OFF
                </span>
              </div>
              <p className="text-sm text-[#C0C0D0]">
                First 100 users get 50% off Pro for 6 months. Limited time offer!
              </p>
            </div>
            <button className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white font-semibold text-sm hover:opacity-90 transition-opacity">
              Claim Offer
            </button>
          </div>
        </div>

        {/* Current Usage Card */}
        {userRole === "FREE" && (
          <div className="rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#F0F0F5] mb-1">Current Plan: Free</h3>
                <p className="text-sm text-[#9898B0]">
                  {loading ? "Loading usage..." : `${usage?.used || 0} of ${usage?.limit || 3} runs used today`}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-[#4F8AFF]">
                  {loading ? "—" : `${usage?.used || 0}/${usage?.limit || 3}`}
                </div>
                <div className="text-xs text-[#9898B0] mt-1">
                  {loading ? "" : `Resets ${new Date(usage?.resetDate || "").toLocaleDateString()}`}
                </div>
              </div>
            </div>

            {/* Usage Bar */}
            {!loading && usage && (
              <div className="space-y-2">
                <div className="h-2 bg-[#1A1A2A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] transition-all duration-300"
                    style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                  />
                </div>
                {usage.used >= usage.limit && (
                  <p className="text-sm text-[#EF4444] flex items-center gap-2">
                    <Zap size={14} />
                    You've reached your daily limit. Upgrade to Pro for unlimited runs!
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {userRole === "PRO" && (
          <div className="rounded-[14px] border border-[rgba(79,138,255,0.3)] bg-gradient-to-r from-[#4F8AFF15] to-[#8B5CF615] p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#4F8AFF] to-[#8B5CF6] flex items-center justify-center">
                <Zap size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-[#F0F0F5] mb-1">Current Plan: Pro</h3>
                <p className="text-sm text-[#C0C0D0]">Unlimited workflow runs. Build without limits!</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-[#4F8AFF]">∞</div>
                <div className="text-xs text-[#9898B0] mt-1">Unlimited</div>
              </div>
            </div>
          </div>
        )}

        {/* Plans Grid */}
        <div>
          <h2 className="text-xl font-bold text-[#F0F0F5] mb-4">Available Plans</h2>
          <div className="grid grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-[14px] border p-6 transition-all hover:-translate-y-0.5 ${
                  plan.highlighted
                    ? "border-[#4F8AFF] bg-gradient-to-b from-[#4F8AFF08] to-[#12121E] shadow-[0_0_20px_rgba(79,138,255,0.15)]"
                    : "border-[rgba(255,255,255,0.06)] bg-[#12121E]"
                }`}
                style={plan.highlighted ? { borderTop: `3px solid ${plan.color}` } : {}}
              >
                {plan.badge && (
                  <div className="inline-block px-2 py-1 rounded-full bg-[#4F8AFF] text-white text-[10px] font-bold mb-3">
                    {plan.badge}
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="text-xl font-bold text-[#F0F0F5] mb-1">{plan.name}</h3>
                  <p className="text-xs text-[#9898B0] mb-3">{plan.description}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-[#F0F0F5]">{plan.price}</span>
                    <span className="text-sm text-[#9898B0]">/{plan.period}</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Check size={16} className="text-[#10B981] mt-0.5 flex-shrink-0" />
                      <span className="text-[#C0C0D0]">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  disabled={plan.ctaDisabled}
                  className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
                    plan.ctaDisabled
                      ? "bg-[#1A1A2A] text-[#55556A] cursor-not-allowed"
                      : plan.highlighted
                      ? "bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] text-white hover:opacity-90"
                      : "bg-[#1A1A2A] text-[#F0F0F5] hover:bg-[#2A2A3E]"
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ / Help */}
        <div className="rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-6">
          <h3 className="text-lg font-bold text-[#F0F0F5] mb-4">Need help choosing?</h3>
          <div className="space-y-3 text-sm text-[#C0C0D0]">
            <p>
              <strong className="text-[#F0F0F5]">Free Plan:</strong> Great for exploring NeoBIM and building simple workflows. Limited to 3 runs per day.
            </p>
            <p>
              <strong className="text-[#F0F0F5]">Pro Plan:</strong> Perfect for freelancers and small firms who need unlimited workflow runs and priority support.
            </p>
            <p>
              <strong className="text-[#F0F0F5]">Team Plan:</strong> Designed for collaborative teams with shared workflows, analytics, and enterprise features.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
