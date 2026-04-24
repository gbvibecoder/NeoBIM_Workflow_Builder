"use client";

import { Suspense, useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CheckCircle2, Sparkles, Zap,
  Share2, Copy, Check, ArrowRight, Crown, Rocket,
} from "lucide-react";
import { pushToDataLayer, pushEnhancedConversionData } from "@/lib/gtm";
import { trackAdsConversion, trackPurchase } from "@/lib/meta-pixel";
import { getPurchaseEventId, getPlanValueINR } from "@/lib/plan-pricing";

/* ── Confetti burst canvas ───────────────────────────────────── */
function ConfettiBurst() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.scale(dpr, dpr);

    const colors = ["#4F8AFF", "#6366F1", "#8B5CF6", "#10B981", "#00F5FF", "#F59E0B", "#EC4899", "#FFBF00"];
    const pieces: {
      x: number; y: number; vx: number; vy: number;
      w: number; h: number; color: string; rot: number; vr: number;
      gravity: number; alpha: number; decay: number;
    }[] = [];

    // Spawn from center-top
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.3;
    for (let i = 0; i < 120; i++) {
      const angle = (Math.random() * Math.PI * 2);
      const speed = Math.random() * 8 + 3;
      pieces.push({
        x: cx + (Math.random() - 0.5) * 80,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        w: Math.random() * 8 + 4,
        h: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        gravity: 0.12 + Math.random() * 0.05,
        alpha: 1,
        decay: 0.003 + Math.random() * 0.004,
      });
    }

    let raf: number;
    function draw() {
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = false;
      for (const p of pieces) {
        if (p.alpha <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        p.alpha -= p.decay;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        ctx!.globalAlpha = Math.max(0, p.alpha);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx!.restore();
      }
      if (alive) raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas ref={ref} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10 }} />
  );
}

/* ── Ambient particle canvas ─────────────────────────────────── */
function AmbientParticles({ accentRgb }: { accentRgb: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    const dpr = window.devicePixelRatio || 1;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; alpha: number }[] = [];

    function resize() {
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = window.innerWidth + "px";
      canvas!.style.height = window.innerHeight + "px";
      ctx!.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 35; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.3 + 0.08,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = window.innerWidth;
        if (p.x > window.innerWidth) p.x = 0;
        if (p.y < 0) p.y = window.innerHeight;
        if (p.y > window.innerHeight) p.y = 0;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${accentRgb},${p.alpha})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [accentRgb]);

  return <canvas ref={ref} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }} />;
}

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
    if (!session?.user) return;
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
  }, [session]);

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
      {/* Dotted canvas grid */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }} />
      {/* Blueprint grid overlay */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `linear-gradient(rgba(${accentRgb},0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(${accentRgb},0.04) 1px, transparent 1px)`,
        backgroundSize: "120px 120px",
        maskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, black 10%, transparent 70%)",
        WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, black 10%, transparent 70%)",
      }} />
      {/* Accent glow */}
      <div style={{
        position: "fixed", top: "-15%", left: "50%", transform: "translateX(-50%)",
        width: 700, height: 450, borderRadius: "50%", zIndex: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse, rgba(${accentRgb},0.08) 0%, transparent 70%)`,
      }} />
      <AmbientParticles accentRgb={accentRgb} />
      <ConfettiBurst />
      <div className="scan-beam" style={{ position: "fixed", left: 0, right: 0, zIndex: 1, pointerEvents: "none" }} />

      {/* Card */}
      <div style={{ position: "relative", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "48px 20px" }}>
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="node-card"
          style={{
            "--node-port-color": accent,
            maxWidth: 540, width: "100%",
            background: "rgba(12,12,22,0.92)",
            backdropFilter: "blur(16px) saturate(1.3)",
            border: `1px solid rgba(${accentRgb},0.12)`,
            borderRadius: 16,
            boxShadow: `0 32px 80px rgba(0,0,0,0.6), 0 0 80px rgba(${accentRgb},0.05), inset 0 1px 0 rgba(255,255,255,0.04)`,
            overflow: "visible", position: "relative",
          } as React.CSSProperties}
        >
          {/* Node header */}
          <div className="node-header" style={{
            background: `linear-gradient(135deg, rgba(${accentRgb},0.12), rgba(${accentRgb},0.04))`,
            borderBottom: `1px solid rgba(${accentRgb},0.1)`,
            borderRadius: "16px 16px 0 0", padding: "10px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <motion.div
                animate={{ scale: [1, 1.4, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: `0 0 10px ${accent}` }}
              />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: accent }}>
                SUBSCRIPTION ACTIVE
              </span>
            </div>
            {plan && <span style={{
              fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
              background: `rgba(${accentRgb},0.12)`, color: accent, letterSpacing: 1,
            }}>{plan.executions}</span>}
          </div>

          <div style={{ padding: "28px 28px 32px" }}>
            {/* Celebration icon */}
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 180, damping: 12 }}
                style={{
                  width: 56, height: 56, borderRadius: 16, display: "inline-flex",
                  alignItems: "center", justifyContent: "center",
                  background: `linear-gradient(135deg, ${accent}, ${accent}CC)`,
                  boxShadow: `0 12px 32px rgba(${accentRgb},0.35)`,
                }}
              >
                <CheckCircle2 size={28} color="#fff" />
              </motion.div>
              <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                style={{
                  fontSize: 24, fontWeight: 800, marginTop: 16, letterSpacing: "-0.03em",
                  background: `linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 50%, ${accent} 100%)`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                You&apos;re on {plan?.name || "a paid plan"}!
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                style={{ fontSize: 13, color: "#6B6B80", marginTop: 6 }}>
                Your subscription is active. Here&apos;s what&apos;s unlocked.
              </motion.p>
            </div>

            {/* Plan features */}
            {plan && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                style={{
                  padding: "14px 16px", borderRadius: 12, marginBottom: 20,
                  background: `rgba(${accentRgb},0.04)`,
                  border: `1px solid rgba(${accentRgb},0.1)`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ color: accent, display: "flex" }}>{plan.icon}</div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#E8E8F0" }}>{plan.name} Plan</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {plan.features.map((f, i) => (
                    <motion.div key={f}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.55 + i * 0.06 }}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Check size={13} style={{ color: accent, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: "#A8A8C4" }}>{f}</span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* CTA buttons */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
              style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <Link href="/dashboard" className="glow-pulse" style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 16px", borderRadius: 10, textDecoration: "none",
                background: `linear-gradient(135deg, ${accent}, ${accent}CC)`,
                color: "#fff", fontSize: 13, fontWeight: 700,
                boxShadow: `0 4px 20px rgba(${accentRgb},0.35)`,
                transition: "transform 0.15s",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                Go to Dashboard <ArrowRight size={15} />
              </Link>
              <Link href="/dashboard/templates" style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 16px", borderRadius: 10, textDecoration: "none",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                color: "#A8A8C4", fontSize: 13, fontWeight: 600,
                transition: "all 0.15s",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              >
                Explore Templates
              </Link>
            </motion.div>

            {/* Referral */}
            {referralCode && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
                style={{
                  padding: "14px 16px", borderRadius: 12, marginBottom: 14,
                  background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.1)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Share2 size={14} style={{ color: "#10B981" }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6EE7B7", textTransform: "uppercase", letterSpacing: 1 }}>Referral</span>
                </div>
                <p style={{ fontSize: 12, color: "#9898B0", marginBottom: 10 }}>Invite colleagues — you both get a bonus execution.</p>
                <button onClick={handleCopy} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center",
                  padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: copied ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.08)",
                  border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(16,185,129,0.15)"}`,
                  color: copied ? "#6EE7B7" : "#A8C4B8", transition: "all 0.2s ease",
                }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied!" : "Copy referral link"}
                </button>
              </motion.div>
            )}

            {/* Social */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
              style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              {[
                { label: "Share on X", href: `https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent("https://trybuildflow.in")}`, hoverColor: "#1D9BF0" },
                { label: "Share on LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://trybuildflow.in")}`, hoverColor: "#0077B5" },
              ].map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                  style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    color: "#6B6B80", textDecoration: "none", transition: "all 0.15s", letterSpacing: 0.3,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${s.hoverColor}50`; e.currentTarget.style.color = s.hoverColor; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#6B6B80"; }}
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
