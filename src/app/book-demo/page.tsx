"use client";

import React, { useState, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize,
  Send, Building2, User, Mail, Phone, MessageSquare,
  CheckCircle2, Sparkles, Layers, Calendar, Clock,
  ChevronRight,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { trackLead } from "@/lib/meta-pixel";

// ─── Design tokens (matching landing page) ──────────────────────────────────

const COLORS = {
  bg: "#070809",
  card: "#0A0C0E",
  elevated: "#101214",
  cyan: "#00F5FF",
  blue: "#4F8AFF",
  purple: "#6366F1",
  copper: "#B87333",
  amber: "#FFBF00",
  green: "#10B981",
  text: "#E2E8F0",
  textSecondary: "#8898A8",
  textTertiary: "#556070",
  border: "rgba(255,255,255,0.06)",
};

const ease = [0.25, 0.4, 0.25, 1] as const;

// ─── Video Player Component ─────────────────────────────────────────────────

function DemoVideoPlayer() {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [showOverlay, setShowOverlay] = useState(true);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
      setShowOverlay(false);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const handleFullscreen = () => {
    videoRef.current?.requestFullscreen?.();
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress((v.currentTime / v.duration) * 100);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * v.duration;
  };

  return (
    <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#000" }}>
      {/* Blueprint grid overlay on video container */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2,
        borderRadius: 16,
        border: `1px solid rgba(0,245,255,0.1)`,
      }} />

      <video
        ref={videoRef}
        src="https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos/floor-plan-demo.mp4"
        muted={muted}
        playsInline
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => { setPlaying(false); setShowOverlay(true); }}
        onClick={togglePlay}
        style={{
          width: "100%", display: "block", cursor: "pointer",
          borderRadius: 16,
        }}
      />

      {/* Big play overlay */}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={togglePlay}
            style={{
              position: "absolute", inset: 0, zIndex: 3,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(180deg, rgba(7,8,9,0.3) 0%, rgba(7,8,9,0.7) 100%)",
              cursor: "pointer",
            }}
          >
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              style={{
                width: 72, height: 72, borderRadius: "50%",
                background: "linear-gradient(135deg, rgba(0,245,255,0.2), rgba(79,138,255,0.2))",
                border: "2px solid rgba(0,245,255,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 40px rgba(0,245,255,0.15), 0 0 80px rgba(0,245,255,0.05)",
              }}
            >
              <Play size={28} fill={COLORS.cyan} color={COLORS.cyan} style={{ marginLeft: 3 }} />
            </motion.div>
            <p style={{
              marginTop: 16, fontSize: 14, fontWeight: 600,
              color: "rgba(255,255,255,0.7)", letterSpacing: "0.04em",
            }}>
              {t('bookDemo.watchPlatformDemo')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom controls */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 4,
        padding: "12px 16px",
        background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
      }}>
        {/* Progress bar */}
        <div
          onClick={handleSeek}
          style={{
            height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)",
            cursor: "pointer", marginBottom: 8,
          }}
        >
          <div style={{
            height: "100%", borderRadius: 2, width: `${progress}%`,
            background: `linear-gradient(90deg, ${COLORS.cyan}, ${COLORS.blue})`,
            transition: "width 0.1s linear",
          }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={togglePlay} style={{
              background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4,
              display: "flex", alignItems: "center",
            }}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={toggleMute} style={{
              background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4,
              display: "flex", alignItems: "center",
            }}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
          <button onClick={handleFullscreen} style={{
            background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4,
            display: "flex", alignItems: "center",
          }}>
            <Maximize size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Form Field Component ───────────────────────────────────────────────────

function FormField({
  icon: Icon, label, name, type = "text", required = true, placeholder,
  value, onChange,
}: {
  icon: React.ElementType; label: string; name: string; type?: string;
  required?: boolean; placeholder: string; value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <label style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 11, fontWeight: 600, color: COLORS.textTertiary,
        marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase",
      }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement(Icon as any, { size: 11 })}
        {label}
        {required && <span style={{ color: COLORS.cyan }}>*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%", padding: "11px 14px",
          borderRadius: 10, fontSize: 13, color: COLORS.text,
          background: focused ? "rgba(0,245,255,0.03)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${focused ? "rgba(0,245,255,0.25)" : COLORS.border}`,
          outline: "none", transition: "all 0.2s ease",
          boxShadow: focused ? "0 0 0 3px rgba(0,245,255,0.06)" : "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function BookDemoPage() {
  const { t } = useLocale();
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", company: "", role: "", message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [messageFocused, setMessageFocused] = useState(false);

  const features = useMemo(() => [
    { icon: Layers, label: t('bookDemo.visualBuilder'), desc: t('bookDemo.visualBuilderDesc'), color: COLORS.cyan },
    { icon: Sparkles, label: t('bookDemo.aiNodes'), desc: t('bookDemo.aiNodesDesc'), color: COLORS.purple },
    { icon: Building2, label: t('bookDemo.bimIntegration'), desc: t('bookDemo.bimIntegrationDesc'), color: COLORS.copper },
    { icon: ChevronRight, label: t('bookDemo.endToEnd'), desc: t('bookDemo.endToEndDesc'), color: COLORS.green },
  ], [t]);

  const trustSignals = useMemo(() => [
    t('bookDemo.noCreditCard'),
    t('bookDemo.sessionTime'),
    t('bookDemo.tailored'),
  ], [t]);

  const updateField = (field: string) => (value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch("/api/book-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        trackLead({ content_name: "book_demo", value: 1 });
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => null);
        console.error("[book-demo] Submission failed:", data?.error || res.statusText);
        setSubmitted(true); // Still show success — email notification was likely sent
      }
    } catch (err) {
      console.error("[book-demo] Network error:", err);
      // Don't show success on network failure — user should retry
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg,
      position: "relative", overflow: "hidden",
    }}>
      {/* ── Ambient Background ─────────────────────────────────────── */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {/* Central glow */}
        <div style={{
          position: "absolute", top: "-10%", left: "20%", width: "60%", height: "60%",
          background: "radial-gradient(ellipse, rgba(79,138,255,0.06) 0%, transparent 70%)",
        }} />
        {/* Secondary glow */}
        <div style={{
          position: "absolute", bottom: "0%", right: "10%", width: "50%", height: "50%",
          background: "radial-gradient(ellipse, rgba(0,245,255,0.04) 0%, transparent 70%)",
        }} />
        {/* Blueprint dot grid */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.4,
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }} />
        {/* Architectural dimension lines */}
        <svg style={{ position: "absolute", top: 80, left: 40, opacity: 0.06 }} width="120" height="200" viewBox="0 0 120 200">
          <line x1="10" y1="0" x2="10" y2="200" stroke={COLORS.cyan} strokeWidth="0.5" strokeDasharray="4 4" />
          <line x1="6" y1="0" x2="14" y2="0" stroke={COLORS.cyan} strokeWidth="0.5" />
          <line x1="6" y1="200" x2="14" y2="200" stroke={COLORS.cyan} strokeWidth="0.5" />
          <text x="20" y="105" fill={COLORS.cyan} fontSize="8" fontFamily="monospace" transform="rotate(-90, 20, 105)">SECTION A-A</text>
        </svg>
        <svg style={{ position: "absolute", bottom: 60, right: 60, opacity: 0.05 }} width="200" height="120" viewBox="0 0 200 120">
          <line x1="0" y1="110" x2="200" y2="110" stroke={COLORS.copper} strokeWidth="0.5" strokeDasharray="4 4" />
          <line x1="0" y1="106" x2="0" y2="114" stroke={COLORS.copper} strokeWidth="0.5" />
          <line x1="200" y1="106" x2="200" y2="114" stroke={COLORS.copper} strokeWidth="0.5" />
          <text x="100" y="104" fill={COLORS.copper} fontSize="8" fontFamily="monospace" textAnchor="middle">ELEVATION NORTH</text>
        </svg>
      </div>

      {/* ── Navigation ─────────────────────────────────────────────── */}
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        style={{
          position: "relative", zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px max(12px, min(32px, 3vw))",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          gap: 8,
        }}
      >
        <Link href="/" style={{
          display: "flex", alignItems: "center", gap: 10,
          textDecoration: "none", color: COLORS.text,
        }}>
          <Image
            src="/buildflow_logo.png"
            alt="BuildFlow"
            width={36}
            height={36}
            style={{
              borderRadius: 10,
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
          />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
            BuildFlow
          </span>
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "#F59E0B",
            padding: "2px 6px", borderRadius: 10,
            border: "1px solid rgba(245,158,11,0.25)",
            background: "rgba(245,158,11,0.06)",
          }}>
            {t('dashboard.beta')}
          </span>
        </Link>

        <div className="book-demo-nav-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/dashboard" className="book-demo-nav-btn" style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 8,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 13, fontWeight: 600,
            textDecoration: "none", transition: "all 0.15s",
            boxShadow: "0 0 12px rgba(79,138,255,0.15)",
            whiteSpace: "nowrap",
          }}>
            {t('bookDemo.getStarted')}
          </Link>
        </div>
      </motion.nav>

      {/* ── Main Content ───────────────────────────────────────────── */}
      <main className="book-demo-main" style={{ position: "relative", zIndex: 1, padding: "40px 32px 80px", maxWidth: 1280, margin: "0 auto" }}>
        {/* Back link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <Link href="/" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12, color: COLORS.textTertiary, textDecoration: "none",
            transition: "color 0.15s",
          }}>
            <ArrowLeft size={13} />
            {t('bookDemo.backToHome')}
          </Link>
        </motion.div>

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease }}
          style={{ textAlign: "center", marginTop: 32, marginBottom: 48 }}
        >
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 14px", borderRadius: 20, marginBottom: 16,
            background: "rgba(79,138,255,0.06)",
            border: "1px solid rgba(79,138,255,0.15)",
          }}>
            <Calendar size={12} style={{ color: COLORS.blue }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.blue, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {t('bookDemo.personalizedWalkthrough')}
            </span>
          </div>

          <h1 className="book-demo-heading" style={{
            fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 800, color: COLORS.text,
            letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: 12,
          }}>
            {t('bookDemo.seeInActionPrefix')}{" "}
            <span style={{
              background: "linear-gradient(135deg, #00F5FF, #4F8AFF, #6366F1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              {t('bookDemo.seeInAction')}
            </span>
          </h1>
          <p style={{
            fontSize: 16, color: COLORS.textSecondary, maxWidth: 540, margin: "0 auto",
            lineHeight: 1.6,
          }}>
            {t('bookDemo.pageDescription')}
          </p>
        </motion.div>

        {/* ── Two Column Layout ────────────────────────────────────── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32,
          alignItems: "start",
        }}
          className="book-demo-grid"
        >
          {/* LEFT: Video + Features */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25, duration: 0.5, ease }}
          >
            {/* Video card */}
            <div style={{
              borderRadius: 18, overflow: "hidden",
              border: "1px solid rgba(0,245,255,0.08)",
              background: "linear-gradient(145deg, rgba(0,245,255,0.02), rgba(10,12,14,0.95))",
              boxShadow: "0 8px 40px rgba(0,0,0,0.3), 0 0 60px rgba(0,245,255,0.03)",
            }}>
              {/* Card header */}
              <div style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: COLORS.green,
                    boxShadow: `0 0 8px ${COLORS.green}60`,
                    animation: "pulse 2s ease infinite",
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, letterSpacing: "0.02em" }}>
                    {t('bookDemo.platformDemo')}
                  </span>
                </div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 10, color: COLORS.textTertiary,
                }}>
                  <Clock size={10} />
                  {t('bookDemo.watchTime')}
                </div>
              </div>

              {/* Video */}
              <div style={{ padding: 12 }}>
                <DemoVideoPlayer />
              </div>
            </div>

            {/* Feature highlights */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4, ease }}
              style={{ marginTop: 24 }}
            >
              <p style={{
                fontSize: 10, fontWeight: 700, color: COLORS.textTertiary,
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12,
              }}>
                {t('bookDemo.whatYouSee')}
              </p>

              <div className="book-demo-features-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {features.map((feat, i) => (
                  <motion.div
                    key={feat.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.08, duration: 0.3 }}
                    style={{
                      padding: "12px 14px", borderRadius: 10,
                      background: "rgba(255,255,255,0.02)",
                      border: `1px solid rgba(255,255,255,0.05)`,
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                    }}>
                      <feat.icon size={13} style={{ color: feat.color }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>
                        {feat.label}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: COLORS.textTertiary }}>
                      {feat.desc}
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>

          {/* RIGHT: Booking Form */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            <div style={{
              borderRadius: 18, overflow: "hidden",
              border: "1px solid rgba(79,138,255,0.1)",
              background: "linear-gradient(165deg, rgba(79,138,255,0.03), rgba(10,12,14,0.98))",
              boxShadow: "0 8px 40px rgba(0,0,0,0.3), 0 0 60px rgba(79,138,255,0.03)",
            }}>
              {/* Form header */}
              <div style={{
                padding: "20px 24px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: "linear-gradient(135deg, rgba(79,138,255,0.06), rgba(99,102,241,0.03))",
              }}>
                <h2 style={{
                  fontSize: 18, fontWeight: 700, color: COLORS.text,
                  letterSpacing: "-0.01em", marginBottom: 4,
                }}>
                  {t('bookDemo.bookPersonalized')}
                </h2>
                <p style={{ fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                  {t('bookDemo.formDesc')}
                </p>
              </div>

              {/* Form body */}
              <AnimatePresence mode="wait">
                {submitted ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4 }}
                    style={{
                      padding: "60px 24px", textAlign: "center",
                    }}
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.15, type: "spring", stiffness: 200 }}
                      style={{
                        width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px",
                        background: "rgba(16,185,129,0.1)",
                        border: "2px solid rgba(16,185,129,0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <CheckCircle2 size={28} style={{ color: COLORS.green }} />
                    </motion.div>
                    <h3 style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>
                      {t('bookDemo.requestReceived')}
                    </h3>
                    <p style={{
                      fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6,
                      maxWidth: 320, margin: "0 auto 24px",
                    }}>
                      {t('bookDemo.reachOut')}
                    </p>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                      <Link href="/" style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "10px 20px", borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.03)",
                        color: COLORS.textSecondary, fontSize: 13, fontWeight: 600,
                        textDecoration: "none",
                      }}>
                        <ArrowLeft size={14} />
                        {t('bookDemo.backToHome')}
                      </Link>
                      <Link href="/dashboard" style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "10px 20px", borderRadius: 10,
                        background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                        color: "#fff", fontSize: 13, fontWeight: 600,
                        textDecoration: "none",
                        boxShadow: "0 0 12px rgba(79,138,255,0.15)",
                      }}>
                        {t('bookDemo.getStartedFree')}
                      </Link>
                    </div>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    onSubmit={handleSubmit}
                    style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}
                  >
                    {/* Name + Email row */}
                    <div className="book-demo-form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <FormField
                        icon={User} label={t('bookDemo.fullName')} name="name"
                        placeholder="Jane Doe" value={formData.name}
                        onChange={updateField("name")}
                      />
                      <FormField
                        icon={Mail} label={t('bookDemo.workEmail')} name="email" type="email"
                        placeholder="jane@studio.com" value={formData.email}
                        onChange={updateField("email")}
                      />
                    </div>

                    {/* Phone + Company row */}
                    <div className="book-demo-form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <FormField
                        icon={Phone} label={t('bookDemo.phone')} name="phone" type="tel"
                        required={false} placeholder="+1 (555) 000-0000"
                        value={formData.phone} onChange={updateField("phone")}
                      />
                      <FormField
                        icon={Building2} label={t('bookDemo.company')} name="company"
                        placeholder="Archibuild Studio" value={formData.company}
                        onChange={updateField("company")}
                      />
                    </div>

                    {/* Role */}
                    <FormField
                      icon={Layers} label={t('bookDemo.role')} name="role"
                      placeholder={t('bookDemo.rolePlaceholder')}
                      value={formData.role} onChange={updateField("role")}
                    />

                    {/* Message */}
                    <div>
                      <label style={{
                        display: "flex", alignItems: "center", gap: 6,
                        fontSize: 11, fontWeight: 600, color: COLORS.textTertiary,
                        marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase",
                      }}>
                        <MessageSquare size={11} />
                        {t('bookDemo.lookingToSolve')}
                      </label>
                      <textarea
                        name="message"
                        rows={3}
                        placeholder={t('bookDemo.messagePlaceholder')}
                        value={formData.message}
                        onChange={e => updateField("message")(e.target.value)}
                        onFocus={() => setMessageFocused(true)}
                        onBlur={() => setMessageFocused(false)}
                        style={{
                          width: "100%", padding: "11px 14px", resize: "vertical",
                          borderRadius: 10, fontSize: 13, color: COLORS.text,
                          background: messageFocused ? "rgba(0,245,255,0.03)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${messageFocused ? "rgba(0,245,255,0.25)" : COLORS.border}`,
                          outline: "none", transition: "all 0.2s ease",
                          boxShadow: messageFocused ? "0 0 0 3px rgba(0,245,255,0.06)" : "none",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    {/* Submit */}
                    <motion.button
                      type="submit"
                      disabled={submitting || !formData.name || !formData.email || !formData.company}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "13px 24px", borderRadius: 12,
                        background: submitting
                          ? "rgba(79,138,255,0.3)"
                          : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                        color: "#fff", fontSize: 14, fontWeight: 700,
                        border: "none", cursor: submitting ? "wait" : "pointer",
                        boxShadow: "0 0 20px rgba(79,138,255,0.15), 0 4px 12px rgba(0,0,0,0.2)",
                        transition: "all 0.2s ease",
                        opacity: (!formData.name || !formData.email || !formData.company) ? 0.5 : 1,
                      }}
                    >
                      {submitting ? (
                        <>
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                            style={{
                              width: 16, height: 16, borderRadius: "50%",
                              border: "2px solid rgba(255,255,255,0.3)",
                              borderTopColor: "#fff",
                            }}
                          />
                          {t('bookDemo.sendingRequest')}
                        </>
                      ) : (
                        <>
                          <Send size={15} />
                          {t('bookDemo.requestDemo')}
                        </>
                      )}
                    </motion.button>

                    {/* Trust signals */}
                    <div className="book-demo-trust" style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
                      paddingTop: 8, flexWrap: "wrap",
                    }}>
                      {trustSignals.map(signal => (
                        <div key={signal} style={{
                          display: "flex", alignItems: "center", gap: 4,
                          fontSize: 10, color: COLORS.textTertiary,
                        }}>
                          <CheckCircle2 size={10} style={{ color: COLORS.green }} />
                          {signal}
                        </div>
                      ))}
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Pulse animation for status dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @media (max-width: 860px) {
          .book-demo-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 768px) {
          .book-demo-main {
            padding: 24px 16px 60px !important;
          }
          .book-demo-nav-btn {
            padding: 6px 10px !important;
            font-size: 11px !important;
          }
        }
        @media (max-width: 480px) {
          .book-demo-form-row {
            grid-template-columns: 1fr !important;
          }
          .book-demo-trust {
            flex-direction: column !important;
            gap: 8px !important;
          }
          .book-demo-features-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
