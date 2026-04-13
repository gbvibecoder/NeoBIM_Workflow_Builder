"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Sparkles, LayoutGrid, Globe, Share2, Copy, Check,
  ArrowRight, Mail, CheckCircle2, Zap,
} from "lucide-react";
import { pushToDataLayer } from "@/lib/gtm";

/* ── Ambient particle canvas ─────────────────────────────────── */
function AmbientParticles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    const dpr = window.devicePixelRatio || 1;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; color: string; alpha: number }[] = [];
    const colors = ["79,138,255", "99,102,241", "139,92,246", "16,185,129", "0,245,255"];

    function resize() {
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = window.innerWidth + "px";
      canvas!.style.height = window.innerHeight + "px";
      ctx!.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.4 + 0.1,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = window.innerWidth;
        if (p.x > window.innerWidth) p.x = 0;
        if (p.y < 0) p.y = window.innerHeight;
        if (p.y > window.innerHeight) p.y = 0;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${p.color},${p.alpha})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}
    />
  );
}

/* ── Corner accent marks (architectural drafting) ────────────── */
function CornerAccents({ color }: { color: string }) {
  const corner = (topOrBottom: string, leftOrRight: string) => ({
    position: "absolute" as const, [topOrBottom]: -1, [leftOrRight]: -1,
    width: 0, height: 0, pointerEvents: "none" as const,
  });
  const line = (w: number, h: number, t: number, l: number) => ({
    position: "absolute" as const, width: w, height: h, top: t, left: l,
    background: color, borderRadius: 1, opacity: 0.5,
  });

  return (
    <>
      {/* Top-left */}
      <div style={corner("top", "left")}>
        <div style={line(16, 2, 0, 0)} />
        <div style={line(2, 16, 0, 0)} />
        <div style={{ ...line(3, 3, -1, -1), borderRadius: "50%" }} />
      </div>
      {/* Top-right */}
      <div style={{ position: "absolute", top: -1, right: -1, pointerEvents: "none" }}>
        <div style={{ ...line(16, 2, 0, -15), }} />
        <div style={{ ...line(2, 16, 0, 0), left: 0 }} />
        <div style={{ ...line(3, 3, -1, -1), borderRadius: "50%" }} />
      </div>
      {/* Bottom-left */}
      <div style={{ position: "absolute", bottom: -1, left: -1, pointerEvents: "none" }}>
        <div style={line(16, 2, 0, 0)} />
        <div style={{ ...line(2, 16, -15, 0) }} />
        <div style={{ ...line(3, 3, -1, -1), borderRadius: "50%" }} />
      </div>
      {/* Bottom-right */}
      <div style={{ position: "absolute", bottom: -1, right: -1, pointerEvents: "none" }}>
        <div style={{ ...line(16, 2, 0, -15) }} />
        <div style={{ ...line(2, 16, -15, 0) }} />
        <div style={{ ...line(3, 3, -1, -1), borderRadius: "50%" }} />
      </div>
    </>
  );
}

/* ── Animated wire connector between action cards ────────────── */
function WireConnector() {
  return (
    <svg width="2" height="10" viewBox="0 0 2 10" style={{ margin: "0 auto", display: "block", overflow: "visible" }}>
      <line x1="1" y1="0" x2="1" y2="10" stroke="rgba(79,138,255,0.15)" strokeWidth="1.5" strokeDasharray="3 3" className="wire-animate" />
    </svg>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export default function WelcomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/register");
  }, [status, router]);

  useEffect(() => {
    if (session?.user) {
      pushToDataLayer("sign_up_complete", {
        method: session.user.image ? "google" : "credentials",
      });
    }
  }, [session]);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/referral", { method: "POST" })
      .then(r => r.json())
      .then(d => { if (d.code) setReferralCode(d.code); })
      .catch(() => {});
  }, [session]);

  const handleCopyReferral = useCallback(() => {
    if (!referralCode) return;
    const url = `${window.location.origin}/register?ref=${referralCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [referralCode]);

  if (status === "loading" || !session?.user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#070809" }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          style={{ width: 28, height: 28, border: "2.5px solid rgba(79,138,255,0.15)", borderTopColor: "#4F8AFF", borderRadius: "50%" }} />
      </div>
    );
  }

  const user = session.user;
  const emailVerified = (user as { emailVerified?: boolean }).emailVerified;
  const firstName = user.name?.split(" ")[0] || "there";

  const actions = [
    { icon: <LayoutGrid size={17} />, title: "Create your first workflow", desc: "Drag and drop AI nodes onto the canvas", href: "/dashboard", color: "#00F5FF", rgb: "0,245,255", cat: "INPUT" },
    { icon: <Globe size={17} />, title: "Explore templates", desc: "Clone a proven workflow in one click", href: "/dashboard/templates", color: "#10B981", rgb: "16,185,129", cat: "GENERATE" },
    { icon: <Sparkles size={17} />, title: "Try the live demo", desc: "See BuildFlow in action — no setup needed", href: "/demo", color: "#8B5CF6", rgb: "139,92,246", cat: "TRANSFORM" },
  ];

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
        backgroundImage: "linear-gradient(rgba(79,138,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.04) 1px, transparent 1px)",
        backgroundSize: "120px 120px",
        maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 10%, transparent 70%)",
        WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 10%, transparent 70%)",
      }} />
      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: "-20%", left: "50%", transform: "translateX(-50%)",
        width: 800, height: 500, borderRadius: "50%", zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse, rgba(79,138,255,0.06) 0%, transparent 70%)",
      }} />
      {/* Floating particles */}
      <AmbientParticles />
      {/* Scan beam */}
      <div className="scan-beam" style={{ position: "fixed", left: 0, right: 0, zIndex: 1, pointerEvents: "none" }} />

      {/* Main content */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "48px 20px" }}>
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="node-card"
          style={{
            "--node-port-color": "#4F8AFF",
            maxWidth: 540, width: "100%",
            background: "rgba(12,12,22,0.92)",
            backdropFilter: "blur(16px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 80px rgba(79,138,255,0.04), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "visible", position: "relative",
          } as React.CSSProperties}
        >
          <CornerAccents color="rgba(79,138,255,0.3)" />

          {/* Node header bar */}
          <div className="node-header" style={{
            background: "linear-gradient(135deg, rgba(79,138,255,0.12), rgba(79,138,255,0.04))",
            borderBottom: "1px solid rgba(79,138,255,0.1)",
            borderRadius: "16px 16px 0 0",
            padding: "10px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 10px #4F8AFF" }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "#4F8AFF" }}>
                ACCOUNT INITIALIZED
              </span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#5C5C78", letterSpacing: 1 }}>
              v1.0
            </span>
          </div>

          {/* Content */}
          <div style={{ padding: "28px 28px 32px" }}>
            {/* Welcome heading */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 15 }}
                  style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 8px 24px rgba(79,138,255,0.3)",
                  }}
                >
                  <Zap size={22} color="#fff" />
                </motion.div>
                <div>
                  <h1 style={{
                    fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em",
                    background: "linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 50%, #A5B4FC 100%)",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                  }}>
                    Welcome, {firstName}
                  </h1>
                  <p style={{ fontSize: 13, color: "#6B6B80", marginTop: 2 }}>Your workspace is ready</p>
                </div>
              </div>
            </motion.div>

            {/* Email verification */}
            <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 10, margin: "16px 0 20px",
                background: emailVerified ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)",
                border: `1px solid ${emailVerified ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)"}`,
              }}
            >
              {emailVerified
                ? <><CheckCircle2 size={15} style={{ color: "#10B981", flexShrink: 0 }} /><span style={{ fontSize: 12.5, color: "#6EE7B7", fontWeight: 600 }}>Email verified</span></>
                : <><Mail size={15} style={{ color: "#F59E0B", flexShrink: 0 }} /><div><p style={{ fontSize: 12.5, color: "#FCD34D", fontWeight: 600 }}>Verify your email</p><p style={{ fontSize: 11.5, color: "#9898B0", marginTop: 1 }}>Check your inbox to unlock all features</p></div></>
              }
            </motion.div>

            {/* Action cards — styled as mini workflow nodes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {actions.map((a, i) => (
                <div key={a.title}>
                  {i > 0 && <WireConnector />}
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.35 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Link href={a.href} style={{ textDecoration: "none", display: "block" }}>
                      <div
                        style={{
                          position: "relative", padding: "14px 16px", borderRadius: 12,
                          background: "rgba(18,18,30,0.7)",
                          border: `1px solid rgba(${a.rgb},0.1)`,
                          transition: "all 0.25s cubic-bezier(0.25,0.4,0.25,1)",
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = `rgba(${a.rgb},0.06)`;
                          e.currentTarget.style.borderColor = `rgba(${a.rgb},0.25)`;
                          e.currentTarget.style.transform = "translateX(4px)";
                          e.currentTarget.style.boxShadow = `0 4px 20px rgba(${a.rgb},0.08)`;
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = "rgba(18,18,30,0.7)";
                          e.currentTarget.style.borderColor = `rgba(${a.rgb},0.1)`;
                          e.currentTarget.style.transform = "translateX(0)";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        {/* Left port dot */}
                        <div style={{
                          position: "absolute", left: -5, top: "50%", transform: "translateY(-50%)",
                          width: 10, height: 10, borderRadius: "50%",
                          background: a.color, border: "2px solid rgba(12,12,22,0.9)",
                          boxShadow: `0 0 8px ${a.color}`,
                        }} />
                        {/* Category badge */}
                        <div style={{
                          position: "absolute", top: 6, right: 12,
                          fontSize: 8, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
                          color: a.color, opacity: 0.5,
                        }}>
                          {a.cat}
                        </div>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10,
                          background: `rgba(${a.rgb},0.1)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: a.color, flexShrink: 0,
                        }}>
                          {a.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 600, color: "#E8E8F0", marginBottom: 2 }}>{a.title}</p>
                          <p style={{ fontSize: 11.5, color: "#6B6B80" }}>{a.desc}</p>
                        </div>
                        <ArrowRight size={15} style={{ color: a.color, opacity: 0.4, flexShrink: 0 }} />
                      </div>
                    </Link>
                  </motion.div>
                </div>
              ))}
            </div>

            {/* Referral */}
            {referralCode && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
                style={{
                  marginTop: 20, padding: "14px 16px", borderRadius: 12,
                  background: "rgba(16,185,129,0.04)",
                  border: "1px solid rgba(16,185,129,0.1)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Share2 size={14} style={{ color: "#10B981" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#6EE7B7", textTransform: "uppercase", letterSpacing: 1 }}>Referral</span>
                </div>
                <p style={{ fontSize: 12, color: "#9898B0", marginBottom: 10, lineHeight: 1.5 }}>
                  Share your link — you both get a bonus execution.
                </p>
                <button onClick={handleCopyReferral} className="glow-pulse" style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center",
                  padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: copied ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.08)",
                  border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(16,185,129,0.15)"}`,
                  color: copied ? "#6EE7B7" : "#A8C4B8",
                  transition: "all 0.2s ease",
                }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied!" : "Copy referral link"}
                </button>
              </motion.div>
            )}

            {/* Skip */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
              style={{ textAlign: "center", marginTop: 18 }}>
              <Link href="/dashboard" style={{
                fontSize: 12, color: "#5C5C78", textDecoration: "none",
                transition: "color 0.15s", letterSpacing: 0.5,
              }}
                onMouseEnter={e => { e.currentTarget.style.color = "#A8A8C4"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#5C5C78"; }}
              >
                Skip to dashboard →
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
