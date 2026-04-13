"use client";

import React, { useState, useTransition, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X, Zap, Mail, ShieldCheck, Crown, Sparkles, CheckCircle2 } from "lucide-react";
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

// ── Rotating sarcastic headlines for email verification ──────────────────────
const EMAIL_HEADLINES = [
  "Whoa, slow down speedster!",
  "Plot twist: we need your email",
  "You're too good at this...",
  "One tiny thing before greatness",
  "Almost famous!",
  "Houston, we need verification",
];

const EMAIL_SUBTEXTS = [
  "That first workflow was fire. But we gotta make sure you're a real human and not a very ambitious bot. Quick email verify and you're back to building magic.",
  "Look, we get it — verifying emails is about as fun as watching concrete cure. But it takes 10 seconds and unlocks everything. Deal?",
  "You just ran your first workflow like a pro. Now your inbox has a little surprise waiting — click it, and the full power of BuildFlow is yours.",
  "We're not being needy, we promise. One quick email click and you get the keys to the whole kingdom. Your workflows are literally waiting.",
  "Your first workflow was chef's kiss. To keep the momentum going, just pop over to your inbox real quick. We'll be here when you get back.",
  "Think of it as a secret handshake. Verify your email, and you're officially part of the club. All the cool architects are doing it.",
];

// ── Creative config per block type ──────────────────────────────────────────
function getBlockPersonality(title: string) {
  const t = title.toLowerCase();
  if (t.includes("verify"))
    return {
      headline: "",  // overridden by random selection
      subtext: "",   // overridden by random selection
      dismissText: "Eh, I'll procrastinate",
      gradient: ["#4F8AFF", "#A855F7"],
      accentRgb: "79,138,255",
      type: "email" as const,
    };
  if (t.includes("monthly") || t.includes("limit reached"))
    return {
      headline: "Buzz buzz! You've been busy!",
      subtext: "You've used every last workflow run this month. That's some serious productivity energy.",
      dismissText: "I'll wait till next month",
      gradient: ["#F59E0B", "#EF4444"],
      accentRgb: "245,158,11",
      type: "plan" as const,
    };
  if (t.includes("video") || t.includes("3d") || t.includes("render"))
    return {
      headline: "That's a premium power move!",
      subtext: "3D models, cinematic renders, video walkthroughs — the heavy artillery. Upgrade to unleash them.",
      dismissText: "Maybe next time",
      gradient: ["#8B5CF6", "#EC4899"],
      accentRgb: "139,92,246",
      type: "node" as const,
    };
  if (t.includes("not available"))
    return {
      headline: "This one's behind the velvet rope",
      subtext: "This feature isn't available on your current plan, but it's just one upgrade away.",
      dismissText: "Not today",
      gradient: ["#F59E0B", "#F97316"],
      accentRgb: "245,158,11",
      type: "node" as const,
    };
  // fallback
  return {
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
    { icon: "\u26A1", text: "More workflow runs per month" },
    { icon: "\uD83C\uDFAC", text: "AI video walkthroughs" },
    { icon: "\uD83E\uDDCA", text: "Interactive 3D models" },
    { icon: "\uD83D\uDCCA", text: "Priority execution queue" },
  ],
  node: [
    { icon: "\uD83C\uDFAC", text: "Cinematic video walkthroughs" },
    { icon: "\uD83E\uDDCA", text: "Interactive 3D model viewer" },
    { icon: "\uD83C\uDFA8", text: "Photorealistic concept renders" },
    { icon: "\uD83C\uDFD7\uFE0F", text: "Full BIM-to-deliverable pipeline" },
  ],
  email: [
    { icon: "\uD83D\uDE80", text: "Unlock all your free workflow runs" },
    { icon: "\uD83C\uDFAC", text: "Access video walkthroughs & 3D models" },
    { icon: "\uD83D\uDCE9", text: "Get notified when workflows complete" },
    { icon: "\u26A1", text: "Literally takes 10 seconds" },
  ],
};

// ── Confetti particle component ─────────────────────────────────────────────
function ConfettiParticle({ delay, x }: { delay: number; x: number }) {
  const colors = ["#4F8AFF", "#A855F7", "#F59E0B", "#10B981", "#EC4899", "#06B6D4"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const size = 4 + Math.random() * 4;
  const rotation = Math.random() * 360;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, x, rotate: rotation, scale: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        y: [0, 60, 120, 180],
        x: [x, x + (Math.random() - 0.5) * 80],
        rotate: rotation + 360 + Math.random() * 180,
        scale: [0, 1, 0.8, 0],
      }}
      transition={{ duration: 2.5, delay, ease: "easeOut" }}
      style={{
        position: "absolute",
        top: 0,
        left: "50%",
        width: size,
        height: size,
        borderRadius: size > 6 ? 2 : "50%",
        background: color,
        pointerEvents: "none",
      }}
    />
  );
}

// ── Typing animation hook ───────────────────────────────────────────────────
function useTypingEffect(text: string, speed: number = 25) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

// ── Email verification modal (special treatment) ────────────────────────────
function EmailVerificationContent({
  onDismiss,
  personality,
}: {
  onDismiss: () => void;
  personality: ReturnType<typeof getBlockPersonality>;
}) {
  const [emailSent, setEmailSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [headlineIdx] = useState(() => Math.floor(Math.random() * EMAIL_HEADLINES.length));
  const [subtextIdx] = useState(() => Math.floor(Math.random() * EMAIL_SUBTEXTS.length));

  const headline = EMAIL_HEADLINES[headlineIdx];
  const subtext = EMAIL_SUBTEXTS[subtextIdx];
  const { displayed: typedHeadline, done: headlineDone } = useTypingEffect(headline, 35);
  const features = FEATURE_HIGHLIGHTS.email;

  const handleSendVerification = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/send-verification", { method: "POST" });
        if (res.ok) setEmailSent(true);
      } catch { /* silent */ }
    });
  }, [startTransition]);

  return (
    <div style={{
      width: "100%", maxWidth: 480, borderRadius: 28, overflow: "hidden",
      background: "linear-gradient(180deg, #0F0F2A 0%, #080816 100%)",
      border: "1px solid rgba(79,138,255,0.12)",
      boxShadow: "0 40px 120px rgba(0,0,0,0.8), 0 0 80px rgba(79,138,255,0.06), 0 0 200px rgba(168,85,247,0.04)",
      pointerEvents: "auto", position: "relative",
    }}>
      {/* Animated top gradient bar */}
      <motion.div
        animate={{
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        style={{
          height: 3,
          backgroundSize: "200% 100%",
          backgroundImage: `linear-gradient(90deg, ${personality.gradient[0]}, ${personality.gradient[1]}, #10B981, ${personality.gradient[0]})`,
        }}
      />

      {/* Close button */}
      <button
        onClick={onDismiss}
        aria-label="Close"
        style={{
          position: "absolute", top: 16, right: 16, zIndex: 2,
          width: 32, height: 32, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          color: "#5C5C78", cursor: "pointer", transition: "all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#9898B0"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "#5C5C78"; }}
      >
        <X size={14} />
      </button>

      {/* Confetti celebration area */}
      <div style={{
        padding: "40px 32px 12px", textAlign: "center", position: "relative", overflow: "hidden",
        background: "radial-gradient(ellipse at 50% 0%, rgba(79,138,255,0.08) 0%, transparent 70%)",
      }}>
        {/* Confetti particles */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "100%", overflow: "hidden", pointerEvents: "none" }}>
          {Array.from({ length: 16 }).map((_, i) => (
            <ConfettiParticle key={i} delay={0.1 + i * 0.08} x={(i - 8) * 18} />
          ))}
        </div>

        {/* Animated icon cluster */}
        <div style={{ position: "relative", display: "inline-block", marginBottom: 16 }}>
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: 80, height: 80, borderRadius: 24,
              background: "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(168,85,247,0.15))",
              border: "1px solid rgba(79,138,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto",
              boxShadow: "0 8px 32px rgba(79,138,255,0.15)",
            }}
          >
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Mail size={36} style={{ color: "#4F8AFF" }} />
            </motion.div>
          </motion.div>

          {/* Floating sparkle */}
          <motion.div
            animate={{ y: [-4, 4, -4], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{ position: "absolute", top: -8, right: -12 }}
          >
            <Sparkles size={20} style={{ color: "#F59E0B" }} />
          </motion.div>
        </div>

        {/* Typing headline */}
        <h2 style={{
          fontSize: 24, fontWeight: 800, color: "#F0F2F8",
          letterSpacing: "-0.03em", margin: "0 0 6px", lineHeight: 1.3,
          minHeight: 32,
        }}>
          {typedHeadline}
          {!headlineDone && (
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
              style={{ color: personality.gradient[0] }}
            >|</motion.span>
          )}
        </h2>

        {/* Success badge */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 14px", borderRadius: 100,
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.15)",
            marginBottom: 14,
          }}
        >
          <CheckCircle2 size={13} style={{ color: "#10B981" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#10B981", letterSpacing: "0.02em" }}>
            1st workflow completed successfully!
          </span>
        </motion.div>

        {/* Subtext */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{
            fontSize: 13, color: "#8888A8", lineHeight: 1.65, margin: 0,
            maxWidth: 380, marginLeft: "auto", marginRight: "auto",
          }}
        >
          {subtext}
        </motion.p>
      </div>

      {/* Unlock features box */}
      <div style={{ padding: "0 32px 28px" }}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          style={{
            background: "rgba(79,138,255,0.04)",
            border: "1px solid rgba(79,138,255,0.08)",
            borderRadius: 16, padding: "16px 20px",
            margin: "16px 0 20px",
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px",
            marginBottom: 12,
            background: `linear-gradient(90deg, ${personality.gradient[0]}, ${personality.gradient[1]})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Verify to unlock
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + i * 0.1 }}
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <span style={{ fontSize: 16 }}>{f.icon}</span>
                <span style={{ fontSize: 12.5, color: "#C0C0D8", fontWeight: 500 }}>{f.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {emailSent ? (
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                padding: "16px 20px", borderRadius: 16,
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.15)",
              }}
            >
              <ShieldCheck size={18} style={{ color: "#10B981" }} />
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#10B981", display: "block" }}>
                  Check your inbox!
                </span>
                <span style={{ fontSize: 11, color: "#10B98199", display: "block", marginTop: 2 }}>
                  Click the link and you&apos;re golden. We&apos;ll wait.
                </span>
              </div>
            </motion.div>
          ) : (
            <button
              onClick={handleSendVerification}
              disabled={isPending}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                width: "100%", padding: "16px 24px", borderRadius: 16,
                background: `linear-gradient(135deg, ${personality.gradient[0]}, ${personality.gradient[1]})`,
                color: "#fff", fontSize: 15, fontWeight: 800,
                border: "none", cursor: isPending ? "wait" : "pointer",
                boxShadow: `0 8px 32px rgba(${personality.accentRgb}, 0.3)`,
                transition: "all 0.2s", opacity: isPending ? 0.7 : 1,
                letterSpacing: "-0.01em",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = `0 12px 40px rgba(${personality.accentRgb}, 0.4)`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = `0 8px 32px rgba(${personality.accentRgb}, 0.3)`;
              }}
            >
              <Mail size={18} />
              {isPending ? "Sending..." : "Send Me The Magic Link"}
            </button>
          )}

          <Link
            href="/dashboard/settings"
            onClick={onDismiss}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "12px 20px", borderRadius: 12,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
              color: "#7878A0", fontSize: 12, fontWeight: 600,
              textDecoration: "none", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#B0B0D0"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "#7878A0"; }}
          >
            Or verify from Settings <ArrowRight size={13} />
          </Link>
        </motion.div>

        {/* Sarcastic dismiss */}
        <button
          onClick={onDismiss}
          style={{
            width: "100%", marginTop: 6, padding: "10px",
            borderRadius: 12, background: "transparent", border: "none",
            color: "#3A3A52", fontSize: 11, cursor: "pointer", transition: "color 0.15s",
            fontStyle: "italic",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#7878A0"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#3A3A52"; }}
        >
          {personality.dismissText}
        </button>
      </div>
    </div>
  );
}

// ── Generic block modal (plan/node limits) ──────────────────────────────────
function GenericBlockContent({
  rateLimitHit,
  onDismiss,
  personality,
}: {
  rateLimitHit: RateLimitInfo;
  onDismiss: () => void;
  personality: ReturnType<typeof getBlockPersonality>;
}) {
  const features = FEATURE_HIGHLIGHTS[personality.type] || FEATURE_HIGHLIGHTS.plan;

  return (
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
        onClick={onDismiss}
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
          {personality.type === "plan" ? "\uD83D\uDC1D" : personality.type === "node" ? "\uD83E\uDD81" : "\uD83D\uDE80"}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
          {["\u2728", "\u2B50", "\uD83D\uDC8E", "\u2B50", "\u2728"].map((s, i) => (
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
        <div style={{
          background: `rgba(${personality.accentRgb}, 0.04)`,
          border: `1px solid rgba(${personality.accentRgb}, 0.1)`,
          borderRadius: 14, padding: "14px 18px",
          margin: "16px 0 20px",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: personality.gradient[0], textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10 }}>
            What you&apos;ll unlock
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

        {/* CTA */}
        {rateLimitHit.action && rateLimitHit.actionUrl && (
          <Link
            href={rateLimitHit.actionUrl}
            onClick={onDismiss}
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
            onClick={onDismiss}
            style={{ fontSize: 11, color: "#44445A", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#9898B0"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#44445A"; }}
          >
            View all plans
          </Link>
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
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
  );
}

// ── Main export ─────────────────────────────────────────────────────────────
export function ExecutionBlockModal({ rateLimitHit, onDismiss }: ExecutionBlockModalProps) {
  const personality = rateLimitHit ? getBlockPersonality(rateLimitHit.title) : null;
  const isEmail = personality?.type === "email";

  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

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
              background: "rgba(0,0,0,0.75)",
              backdropFilter: "blur(12px)",
              zIndex: 9990,
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.88, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 30 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: "fixed", inset: 0, zIndex: 9991,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none", padding: 16,
            }}
          >
            {isEmail ? (
              <EmailVerificationContent onDismiss={handleDismiss} personality={personality} />
            ) : (
              <GenericBlockContent rateLimitHit={rateLimitHit} onDismiss={handleDismiss} personality={personality} />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
