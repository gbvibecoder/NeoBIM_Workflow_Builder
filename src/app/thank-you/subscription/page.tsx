"use client";

import { Suspense, useEffect, useState, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CheckCircle2, Sparkles, Zap,
  Share2, Copy, Check, ArrowRight, Crown, Rocket,
} from "lucide-react";
import { pushToDataLayer } from "@/lib/gtm";
import { trackPurchase } from "@/lib/meta-pixel";

const PLAN_DETAILS: Record<string, {
  name: string; color: string; executions: string;
  features: string[]; icon: React.ReactNode;
}> = {
  MINI: {
    name: "Mini", color: "#4F8AFF", executions: "10/month",
    icon: <Zap size={24} />,
    features: ["10 workflow executions", "3 concept renders", "JSON/CSV export", "Community templates"],
  },
  STARTER: {
    name: "Starter", color: "#8B5CF6", executions: "30/month",
    icon: <Rocket size={24} />,
    features: ["30 workflow executions", "10 concept renders", "3 video walkthroughs", "3 AI 3D models", "IFC/PDF/OBJ export"],
  },
  PRO: {
    name: "Pro", color: "#F59E0B", executions: "100/month",
    icon: <Crown size={24} />,
    features: ["100 workflow executions", "30 concept renders", "7 video walkthroughs", "10 AI 3D models", "Priority execution & support"],
  },
  TEAM_ADMIN: {
    name: "Team", color: "#10B981", executions: "Unlimited",
    icon: <Sparkles size={24} />,
    features: ["Unlimited executions", "Unlimited renders", "15 video walkthroughs", "30 AI 3D models", "5 team members", "Dedicated support"],
  },
};

export default function SubscriptionThankYouPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionThankYouContent />
    </Suspense>
  );
}

function SubscriptionThankYouContent() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const firedRef = useRef(false);

  const planFromUrl = searchParams.get("plan")?.toUpperCase() || "";
  const userRole = (session?.user as { role?: string })?.role || "FREE";
  const plan = PLAN_DETAILS[planFromUrl] || PLAN_DETAILS[userRole] || null;

  // Redirect unauthenticated users
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  // Fire conversion events once on mount
  useEffect(() => {
    if (!session?.user || firedRef.current) return;
    firedRef.current = true;

    trackPurchase({
      content_name: `BuildFlow ${plan?.name || "Subscription"}`,
      currency: "INR",
    });
    pushToDataLayer("purchase_complete", {
      plan: plan?.name || userRole,
      currency: "INR",
    });
  }, [session, plan, userRole]);

  // Sync subscription (webhook may not have processed yet)
  useEffect(() => {
    if (!session?.user) return;
    const sync = async (attempt = 1) => {
      try {
        const res = await fetch("/api/stripe/subscription", { method: "POST" });
        const data = await res.json();
        if (data.synced || attempt >= 3) {
          await updateSession();
        } else {
          setTimeout(() => sync(attempt + 1), attempt * 2000);
        }
      } catch {
        if (attempt < 3) setTimeout(() => sync(attempt + 1), attempt * 2000);
      }
    };
    sync();
  }, [session, updateSession]);

  // Fetch referral code
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/referral", { method: "POST" })
      .then(r => r.json())
      .then(d => { if (d.code) setReferralCode(d.code); })
      .catch(() => {});
  }, [session]);

  const handleCopyReferral = () => {
    if (!referralCode) return;
    const url = `${window.location.origin}/register?ref=${referralCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const shareText = useMemo(() => {
    const planName = plan?.name || "Pro";
    return encodeURIComponent(`Just upgraded to BuildFlow ${planName}! AI-powered BIM workflows for architects. Check it out:`);
  }, [plan]);

  if (status === "loading" || !session?.user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#06080C" }}>
        <div style={{ width: 24, height: 24, border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366F1", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const accentColor = plan?.color || "#4F8AFF";

  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse at 50% 0%, ${accentColor}12 0%, #06080C 60%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 20px",
    }}>
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{
          maxWidth: 560, width: "100%",
          background: "rgba(15,16,25,0.95)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 20,
          boxShadow: `0 32px 80px rgba(0,0,0,0.5), 0 0 60px ${accentColor}08`,
          overflow: "hidden",
        }}
      >
        {/* Header with celebration */}
        <div style={{
          padding: "36px 36px 28px", textAlign: "center",
          background: `linear-gradient(135deg, ${accentColor}10, ${accentColor}04)`,
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            style={{
              width: 64, height: 64, borderRadius: 18,
              background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)`,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 20,
              boxShadow: `0 12px 32px ${accentColor}40`,
            }}
          >
            <CheckCircle2 size={32} color="#fff" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{
              fontSize: 28, fontWeight: 800, marginBottom: 8,
              background: `linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 60%, ${accentColor} 100%)`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text", letterSpacing: "-0.03em",
            }}
          >
            You&apos;re on {plan?.name || "a paid plan"}!
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            style={{ fontSize: 15, color: "#A8A8C4", lineHeight: 1.6 }}
          >
            Your subscription is active. Here&apos;s what&apos;s unlocked.
          </motion.p>
        </div>

        <div style={{ padding: "24px 36px 32px" }}>
          {/* Plan features */}
          {plan && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              style={{
                padding: "16px 18px", borderRadius: 12, marginBottom: 20,
                background: `${accentColor}06`,
                border: `1px solid ${accentColor}15`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ color: accentColor }}>{plan.icon}</div>
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#E8E8F0" }}>
                    {plan.name} Plan
                  </span>
                  <span style={{
                    fontSize: 12, color: accentColor, fontWeight: 600,
                    marginLeft: 8, padding: "2px 8px", borderRadius: 6,
                    background: `${accentColor}15`,
                  }}>
                    {plan.executions}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.features.map((feature) => (
                  <div key={feature} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Check size={14} style={{ color: accentColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "#C0C0D0" }}>{feature}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Quick actions */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <Link
              href="/dashboard"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 16px", borderRadius: 12, textDecoration: "none",
                background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)`,
                color: "#fff", fontSize: 14, fontWeight: 600,
                boxShadow: `0 4px 16px ${accentColor}40`,
                transition: "transform 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.01)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
            >
              Go to Dashboard <ArrowRight size={16} />
            </Link>
            <Link
              href="/dashboard/templates"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 16px", borderRadius: 12, textDecoration: "none",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#C0C0D0", fontSize: 14, fontWeight: 600,
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              }}
            >
              Explore Templates
            </Link>
          </div>

          {/* Referral section */}
          {referralCode && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              style={{
                padding: "16px 18px", borderRadius: 12, marginBottom: 16,
                background: "rgba(16,185,129,0.04)",
                border: "1px solid rgba(16,185,129,0.1)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Share2 size={15} style={{ color: "#10B981" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#6EE7B7" }}>
                  Share with your team
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#A8A8C4", marginBottom: 12, lineHeight: 1.5 }}>
                Invite colleagues — you both get a bonus execution.
              </p>
              <button
                onClick={handleCopyReferral}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 14px", borderRadius: 8, width: "100%", justifyContent: "center",
                  background: copied ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: copied ? "#6EE7B7" : "#C0C0D0",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Link copied!" : "Copy referral link"}
              </button>
            </motion.div>
          )}

          {/* Social sharing */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            style={{ display: "flex", gap: 10, justifyContent: "center" }}
          >
            <a
              href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent("https://trybuildflow.in")}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                color: "#9898B0", textDecoration: "none", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(29,155,240,0.3)"; e.currentTarget.style.color = "#1D9BF0"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#9898B0"; }}
            >
              Share on X
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://trybuildflow.in")}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                color: "#9898B0", textDecoration: "none", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,119,181,0.3)"; e.currentTarget.style.color = "#0077B5"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#9898B0"; }}
            >
              Share on LinkedIn
            </a>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
