"use client";

import React, { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X, Zap, Mail, ShieldCheck, Crown } from "lucide-react";
import Link from "next/link";

interface RateLimitInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

interface ExecutionBlockModalProps {
  rateLimitHit: RateLimitInfo | null;
  onDismiss: () => void;
}

// ── Creative config per block type ──────────────────────────────────────────
function getBlockPersonality(title: string) {
  const t = title.toLowerCase();
  if (t.includes("verify"))
    return {
      emoji: "📬",
      headline: "One tiny thing first...",
      subtext: "Your inbox is feeling lonely. A quick email verification and you're back in business!",
      dismissText: "I'll do it later",
      gradient: ["#4F8AFF", "#6366F1"],
      accentRgb: "79,138,255",
      type: "email" as const,
    };
  if (t.includes("monthly") || t.includes("limit reached"))
    return {
      emoji: "🐝",
      headline: "Buzz buzz! You've been busy!",
      subtext: "You've used every last workflow run this month. That's some serious productivity energy.",
      dismissText: "I'll wait till next month 🐌",
      gradient: ["#F59E0B", "#EF4444"],
      accentRgb: "245,158,11",
      type: "plan" as const,
    };
  if (t.includes("video") || t.includes("3d") || t.includes("render"))
    return {
      emoji: "🦁",
      headline: "That's a premium power move!",
      subtext: "3D models, cinematic renders, video walkthroughs — the heavy artillery. Upgrade to unleash them.",
      dismissText: "Maybe next time",
      gradient: ["#8B5CF6", "#EC4899"],
      accentRgb: "139,92,246",
      type: "node" as const,
    };
  if (t.includes("not available"))
    return {
      emoji: "🔒",
      headline: "This one's behind the velvet rope",
      subtext: "This feature isn't available on your current plan, but it's just one upgrade away.",
      dismissText: "Not today",
      gradient: ["#F59E0B", "#F97316"],
      accentRgb: "245,158,11",
      type: "node" as const,
    };
  // fallback
  return {
    emoji: "🚀",
    headline: "Hold up, space cowboy!",
    subtext: "You've hit a limit. But don't worry — upgrading takes about 30 seconds.",
    dismissText: "I'll pass for now",
    gradient: ["#06B6D4", "#3B82F6"],
    accentRgb: "6,182,212",
    type: "plan" as const,
  };
}

const FEATURE_HIGHLIGHTS: Record<string, Array<{ icon: string; text: string }>> = {
  plan: [
    { icon: "⚡", text: "More workflow runs per month" },
    { icon: "🎬", text: "AI video walkthroughs" },
    { icon: "🧊", text: "Interactive 3D models" },
    { icon: "📊", text: "Priority execution queue" },
  ],
  node: [
    { icon: "🎬", text: "Cinematic video walkthroughs" },
    { icon: "🧊", text: "Interactive 3D model viewer" },
    { icon: "🎨", text: "Photorealistic concept renders" },
    { icon: "🏗️", text: "Full BIM-to-deliverable pipeline" },
  ],
  email: [
    { icon: "✅", text: "Unlock all your workflow runs" },
    { icon: "🔐", text: "Secure your account" },
    { icon: "📩", text: "Get important notifications" },
    { icon: "⚡", text: "Takes less than 10 seconds" },
  ],
};

export function ExecutionBlockModal({ rateLimitHit, onDismiss }: ExecutionBlockModalProps) {
  const [emailSent, setEmailSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const personality = rateLimitHit ? getBlockPersonality(rateLimitHit.title) : null;
  const isEmail = personality?.type === "email";
  const features = personality ? (FEATURE_HIGHLIGHTS[personality.type] || FEATURE_HIGHLIGHTS.plan) : [];

  const handleSendVerification = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/send-verification", { method: "POST" });
        if (res.ok) setEmailSent(true);
      } catch { /* silent */ }
    });
  };

  const handleDismiss = () => {
    setEmailSent(false);
    onDismiss();
  };

  return (
    <AnimatePresence>
      {rateLimitHit && personality && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(8px)",
              zIndex: 9990,
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: "fixed", inset: 0, zIndex: 9991,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none", padding: 16,
            }}
          >
            <div style={{
              width: "100%", maxWidth: 460, borderRadius: 24, overflow: "hidden",
              background: "linear-gradient(180deg, #111125 0%, #0A0A18 100%)",
              border: `1px solid rgba(${personality.accentRgb}, 0.15)`,
              boxShadow: `0 32px 100px rgba(0,0,0,0.7), 0 0 60px rgba(${personality.accentRgb}, 0.05)`,
              pointerEvents: "auto", position: "relative",
            }}>
              {/* Top gradient bar */}
              <div style={{
                height: 3,
                background: `linear-gradient(90deg, ${personality.gradient[0]}, ${personality.gradient[1]}, ${personality.gradient[0]})`,
              }} />

              {/* Close button */}
              <button
                onClick={handleDismiss}
                aria-label="Close"
                style={{
                  position: "absolute", top: 14, right: 14, zIndex: 2,
                  width: 32, height: 32, borderRadius: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "#5C5C78", cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#9898B0"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#5C5C78"; }}
              >
                <X size={14} />
              </button>

              {/* Illustration area */}
              <div style={{
                padding: "36px 32px 16px", textAlign: "center",
                background: `radial-gradient(ellipse at 50% 80%, rgba(${personality.accentRgb}, 0.06) 0%, transparent 70%)`,
              }}>
                <div style={{
                  fontSize: 56, lineHeight: 1, marginBottom: 8,
                  animation: "exec-float 3s ease-in-out infinite",
                }}>
                  {personality.emoji}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                  {["✨", "⭐", "💎", "⭐", "✨"].map((s, i) => (
                    <span key={i} style={{
                      fontSize: 12, opacity: 0.5,
                      animation: "exec-sparkle 2s ease-in-out infinite",
                      animationDelay: `${i * 0.25}s`,
                    }}>{s}</span>
                  ))}
                </div>

                <h2 style={{
                  fontSize: 22, fontWeight: 800, color: "#F0F2F8",
                  letterSpacing: "-0.03em", margin: "0 0 8px", lineHeight: 1.3,
                }}>
                  {personality.headline}
                </h2>
                <p style={{
                  fontSize: 13, color: "#9898B0", lineHeight: 1.6, margin: 0,
                  maxWidth: 360, marginLeft: "auto", marginRight: "auto",
                }}>
                  {personality.subtext}
                </p>
              </div>

              {/* Details box */}
              <div style={{ padding: "0 32px 24px" }}>
                {/* Original message in subtle box */}
                <div style={{
                  background: `rgba(${personality.accentRgb}, 0.04)`,
                  border: `1px solid rgba(${personality.accentRgb}, 0.1)`,
                  borderRadius: 14, padding: "14px 18px",
                  margin: "16px 0 20px",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: personality.gradient[0], textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10 }}>
                    {isEmail ? "Quick steps" : "What you'll unlock"}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {features.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 15 }}>{f.icon}</span>
                        <span style={{ fontSize: 12.5, color: "#C0C0D8" }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA — email verification or upgrade */}
                {isEmail ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {emailSent ? (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: "14px 20px", borderRadius: 14,
                        background: "rgba(16,185,129,0.08)",
                        border: "1px solid rgba(16,185,129,0.15)",
                      }}>
                        <ShieldCheck size={16} style={{ color: "#10B981" }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#10B981" }}>
                          Verification email sent! Check your inbox.
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={handleSendVerification}
                        disabled={isPending}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          width: "100%", padding: "14px 20px", borderRadius: 14,
                          background: `linear-gradient(135deg, ${personality.gradient[0]}, ${personality.gradient[1]})`,
                          color: "#fff", fontSize: 14, fontWeight: 700,
                          border: "none", cursor: isPending ? "wait" : "pointer",
                          boxShadow: `0 6px 24px rgba(${personality.accentRgb}, 0.25)`,
                          transition: "all 0.2s", opacity: isPending ? 0.7 : 1,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
                      >
                        <Mail size={16} />
                        {isPending ? "Sending..." : "Send Verification Email"}
                      </button>
                    )}
                    <Link
                      href="/dashboard/settings"
                      onClick={handleDismiss}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "12px 20px", borderRadius: 12,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: "#9898B0", fontSize: 12, fontWeight: 600,
                        textDecoration: "none", transition: "all 0.15s",
                      }}
                    >
                      Go to Settings <ArrowRight size={13} />
                    </Link>
                  </div>
                ) : (
                  <>
                    {rateLimitHit.action && rateLimitHit.actionUrl && (
                      <Link
                        href={rateLimitHit.actionUrl}
                        onClick={handleDismiss}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                          width: "100%", padding: "14px 24px", borderRadius: 14,
                          background: `linear-gradient(135deg, ${personality.gradient[0]}, ${personality.gradient[1]})`,
                          color: "#fff", fontSize: 15, fontWeight: 800,
                          textDecoration: "none", border: "none",
                          boxShadow: `0 8px 32px rgba(${personality.accentRgb}, 0.25)`,
                          transition: "all 0.2s", letterSpacing: "-0.01em",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 12px 40px rgba(${personality.accentRgb}, 0.35)`; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 8px 32px rgba(${personality.accentRgb}, 0.25)`; }}
                      >
                        {personality.type === "node" ? <Crown size={17} /> : <Zap size={17} />}
                        {rateLimitHit.action}
                        <ArrowRight size={15} />
                      </Link>
                    )}
                    <div style={{ textAlign: "center", marginTop: 10 }}>
                      <Link
                        href="/dashboard/billing"
                        onClick={handleDismiss}
                        style={{ fontSize: 11, color: "#44445A", textDecoration: "none", transition: "color 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#9898B0"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#44445A"; }}
                      >
                        View all plans
                      </Link>
                    </div>
                  </>
                )}

                {/* Dismiss */}
                <button
                  onClick={handleDismiss}
                  style={{
                    width: "100%", marginTop: 8, padding: "10px",
                    borderRadius: 12, background: "transparent", border: "none",
                    color: "#44445A", fontSize: 12, cursor: "pointer", transition: "color 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#9898B0"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#44445A"; }}
                >
                  {personality.dismissText}
                </button>
              </div>

              {/* Animations */}
              <style>{`
                @keyframes exec-float {
                  0%, 100% { transform: translateY(0); }
                  50% { transform: translateY(-8px); }
                }
                @keyframes exec-sparkle {
                  0%, 100% { opacity: 0.3; transform: scale(0.8); }
                  50% { opacity: 0.8; transform: scale(1.15); }
                }
              `}</style>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
