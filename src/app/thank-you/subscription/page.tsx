"use client";

import { Suspense, useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Sparkles, Zap,
  Share2, Copy, Check, ArrowRight, Crown, Rocket,
} from "lucide-react";
import { pushToDataLayer, pushEnhancedConversionData } from "@/lib/gtm";
import { trackAdsConversion, trackPurchase } from "@/lib/meta-pixel";
import { getPurchaseEventId, getPlanValueINR } from "@/lib/plan-pricing";

/* ── Plan data ───────────────────────────────────────────────── */
const PLANS: Record<string, {
  name: string; color: string; rgb: string; executions: string;
  features: string[]; icon: React.ReactNode;
}> = {
  MINI: {
    name: "Mini", color: "#4F8AFF", rgb: "79,138,255", executions: "10/month",
    icon: <Zap size={22} />,
    features: ["10 workflow executions", "3 concept renders", "JSON/CSV export", "Community templates"],
  },
  STARTER: {
    name: "Starter", color: "#8B5CF6", rgb: "139,92,246", executions: "30/month",
    icon: <Rocket size={22} />,
    features: ["30 workflow executions", "10 concept renders", "3 video walkthroughs", "3 AI 3D models", "IFC/PDF/OBJ export"],
  },
  PRO: {
    name: "Pro", color: "#F59E0B", rgb: "245,158,11", executions: "100/month",
    icon: <Crown size={22} />,
    features: ["100 workflow executions", "30 concept renders", "7 video walkthroughs", "10 AI 3D models", "Priority execution & support"],
  },
  TEAM_ADMIN: {
    name: "Team", color: "#10B981", rgb: "16,185,129", executions: "Unlimited",
    icon: <Sparkles size={22} />,
    features: ["Unlimited executions", "Unlimited renders", "15 video walkthroughs", "30 AI 3D models", "5 team members", "Dedicated support"],
  },
};

/* ── Main ────────────────────────────────────────────────────── */
export default function SubscriptionThankYouPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}

function Content() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const firedRef = useRef(false);
  const syncedRef = useRef(false);

  const planFromUrl = searchParams.get("plan")?.toUpperCase() || "";
  const userRole = (session?.user as { role?: string })?.role || "FREE";
  const plan = PLANS[planFromUrl] || PLANS[userRole] || null;
  const accent = plan?.color || "#4F8AFF";
  const accentRgb = plan?.rgb || "79,138,255";

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (!session?.user || firedRef.current) return;
    firedRef.current = true;
    // Enhanced Conversions: send hashed email for Google Ads matching
    pushEnhancedConversionData({
      email: session.user.email || undefined,
      firstName: session.user.name?.split(" ")[0],
    });

    const userId = (session.user as { id?: string }).id;
    const planKey = planFromUrl || userRole;
    const value = getPlanValueINR(planKey);
    const eventID = userId ? getPurchaseEventId(userId, planKey) : undefined;

    trackPurchase(
      {
        content_name: `BuildFlow ${plan?.name || "Subscription"}`,
        currency: "INR",
        value,
      },
      eventID ? { eventID } : undefined,
    );
    pushToDataLayer("purchase_complete", {
      plan: plan?.name || userRole,
      currency: "INR",
      value,
      ...(eventID && { event_id: eventID }),
    });

    const purchaseAdsLabel = process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL;
    if (purchaseAdsLabel) {
      trackAdsConversion(purchaseAdsLabel, {
        value,
        currency: "INR",
        ...(eventID && { transaction_id: eventID }),
      });
    }
  }, [session, plan, userRole, planFromUrl]);

  useEffect(() => {
    if (!session?.user || syncedRef.current) return;
    syncedRef.current = true;
    // Safety-net sync: re-query both payment providers in parallel. Whichever
    // reports synced=true wins — e.g. a Razorpay user whose /verify call
    // failed mid-redirect is recovered here without waiting for the webhook.
    const sync = async (attempt = 1) => {
      try {
        const [stripeJson, razorpayJson] = await Promise.all([
          fetch("/api/stripe/subscription", { method: "POST" })
            .then((r) => r.json())
            .catch(() => null),
          fetch("/api/razorpay/subscription", { method: "POST" })
            .then((r) => r.json())
            .catch(() => null),
        ]);
        const synced = Boolean(stripeJson?.synced) || Boolean(razorpayJson?.synced);
        if (synced || attempt >= 3) await updateSession();
        else setTimeout(() => sync(attempt + 1), attempt * 2000);
      } catch {
        if (attempt < 3) setTimeout(() => sync(attempt + 1), attempt * 2000);
      }
    };
    sync();
  }, [session, updateSession]);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/referral", { method: "POST" }).then(r => r.json()).then(d => { if (d.code) setReferralCode(d.code); }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session?.user]);

  const handleCopy = useCallback(() => {
    if (!referralCode) return;
    navigator.clipboard.writeText(`${window.location.origin}/register?ref=${referralCode}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }, [referralCode]);

  const shareText = useMemo(() => encodeURIComponent(`Just upgraded to BuildFlow ${plan?.name || "Pro"}! AI-powered BIM workflows for architects.`), [plan]);

  if (status === "loading" || !session?.user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#070809" }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          style={{ width: 28, height: 28, border: "2.5px solid rgba(79,138,255,0.15)", borderTopColor: "#4F8AFF", borderRadius: "50%" }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#070809", position: "relative", overflow: "hidden" }}>
      {/* Subtle ambient glow — static, no animation */}
      <div style={{
        position: "fixed", top: "-20%", left: "50%", transform: "translateX(-50%)",
        width: 800, height: 500, borderRadius: "50%", zIndex: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse, rgba(${accentRgb},0.06) 0%, transparent 65%)`,
      }} />

      {/* Main content */}
      <div style={{
        position: "relative", zIndex: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", padding: "48px 20px",
      }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{
            maxWidth: 480, width: "100%",
            background: "rgba(14,14,24,0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            boxShadow: `0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02)`,
            overflow: "hidden",
          }}
        >
          {/* Status pill bar */}
          <div style={{
            padding: "12px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#10B981",
                boxShadow: "0 0 8px rgba(16,185,129,0.4)",
              }} />
              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: 1.5, color: "rgba(255,255,255,0.4)",
              }}>
                Subscription active
              </span>
            </div>
            {plan && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                background: `rgba(${accentRgb},0.08)`, color: accent, letterSpacing: 0.5,
              }}>
                {plan.executions}
              </span>
            )}
          </div>

          {/* Card body */}
          <div style={{ padding: "40px 32px 36px" }}>
            {/* Success icon — single scale-in, no repeat */}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                style={{ display: "inline-block", position: "relative" }}
              >
                {/* Glow ring — fades in once */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
                  style={{
                    position: "absolute", inset: -8,
                    borderRadius: "50%",
                    background: `radial-gradient(circle, rgba(${accentRgb},0.15) 0%, transparent 70%)`,
                  }}
                />
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ position: "relative", zIndex: 1 }}>
                  <circle cx="28" cy="28" r="26" stroke={`url(#grad-${accent.replace("#", "")})`} strokeWidth="2.5" fill="none" opacity="0.8" />
                  <path d="M20 28.5L25.5 34L36 22" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <defs>
                    <linearGradient id={`grad-${accent.replace("#", "")}`} x1="0" y1="0" x2="56" y2="56">
                      <stop offset="0%" stopColor={accent} stopOpacity="0.6" />
                      <stop offset="100%" stopColor={accent} stopOpacity="0.15" />
                    </linearGradient>
                  </defs>
                </svg>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                style={{
                  fontSize: 26, fontWeight: 700, marginTop: 20, letterSpacing: "-0.03em",
                  color: "#F0F0F8", lineHeight: 1.3,
                }}
              >
                Welcome to BuildFlow{plan ? ` ${plan.name}` : ""}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                style={{ fontSize: 14, color: "#6B6B80", marginTop: 8, lineHeight: 1.5 }}
              >
                Your subscription is active. Start building.
              </motion.p>
            </div>

            {/* Plan features */}
            {plan && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.5 }}
                style={{
                  padding: "16px 18px", borderRadius: 14, marginBottom: 24,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ color: accent, display: "flex", opacity: 0.8 }}>{plan.icon}</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#C8C8D8" }}>{plan.name} Plan</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {plan.features.map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Check size={13} style={{ color: accent, flexShrink: 0, opacity: 0.7 }} />
                      <span style={{ fontSize: 13, color: "#8888A0" }}>{f}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* CTA buttons */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.5 }}
              style={{ display: "flex", gap: 10, marginBottom: 20 }}
            >
              <Link href="/dashboard" style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "13px 18px", borderRadius: 12, textDecoration: "none",
                background: `linear-gradient(135deg, ${accent}, ${accent}CC)`,
                color: "#fff", fontSize: 14, fontWeight: 600,
                boxShadow: `0 4px 16px rgba(${accentRgb},0.25)`,
                transition: "all 0.2s ease",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 6px 24px rgba(${accentRgb},0.35)`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 4px 16px rgba(${accentRgb},0.25)`; }}
              >
                Go to Dashboard <ArrowRight size={15} />
              </Link>
              <Link href="/dashboard/templates" style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "13px 18px", borderRadius: 12, textDecoration: "none",
                background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
                color: "#8888A0", fontSize: 14, fontWeight: 500,
                transition: "all 0.2s ease",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "#B8B8CC"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#8888A0"; }}
              >
                Explore Templates
              </Link>
            </motion.div>

            {/* Referral */}
            {referralCode && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65, duration: 0.5 }}
                style={{
                  padding: "16px 18px", borderRadius: 14, marginBottom: 16,
                  background: "rgba(16,185,129,0.03)",
                  border: "1px solid rgba(16,185,129,0.08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Share2 size={14} style={{ color: "#10B981", opacity: 0.7 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#6EE7B7", textTransform: "uppercase", letterSpacing: 1 }}>
                    Referral
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "#7A7A90", marginBottom: 12, lineHeight: 1.5 }}>
                  Invite colleagues — you both get a bonus execution.
                </p>
                <button onClick={handleCopy} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center",
                  padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: copied ? "rgba(16,185,129,0.12)" : "rgba(16,185,129,0.06)",
                  border: `1px solid ${copied ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.12)"}`,
                  color: copied ? "#6EE7B7" : "#9ABCB0", transition: "all 0.2s ease",
                }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy referral link"}
                </button>
              </motion.div>
            )}

            {/* Social sharing */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75, duration: 0.5 }}
              style={{ display: "flex", gap: 10, justifyContent: "center" }}
            >
              {[
                { label: "Share on X", href: `https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent("https://trybuildflow.in")}`, hoverColor: "#1D9BF0" },
                { label: "Share on LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://trybuildflow.in")}`, hoverColor: "#0077B5" },
              ].map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                  style={{
                    padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                    background: "transparent", border: "1px solid rgba(255,255,255,0.05)",
                    color: "#5A5A70", textDecoration: "none", transition: "all 0.2s ease",
                    letterSpacing: 0.2,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${s.hoverColor}40`; e.currentTarget.style.color = s.hoverColor; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#5A5A70"; }}
                >
                  {s.label}
                </a>
              ))}
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
