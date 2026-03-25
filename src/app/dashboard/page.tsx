"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useInView } from "framer-motion";
import {
  ArrowRight, Crown, Play, Plus, Zap,
  Type, FileText, Image as ImageIcon, Box, Sliders, MapPin,
  Sparkles, Palette, Building2, FileSpreadsheet, X, ChevronRight,
} from "lucide-react";
import { PageBackground } from "@/components/dashboard/PageBackground";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import type { WorkflowTemplate } from "@/types/workflow";

// ─── Types ───────────────────────────────────────────────────────────────────
interface DashboardData {
  userName: string | null;
  userRole: string;
  xp: number;
  level: number;
  progress: number;
  xpInLevel: number;
  xpForNext: number;
  workflowCount: number;
  executionCount: number;
  referralBonus: number;
  missions: unknown[];
  blueprints: unknown[];
  achievements: unknown[];
  flashEvent: unknown;
  recentWorkflows: Array<{
    id: string;
    name: string;
    updatedAt: string;
    nodeCount: number;
    executionCount: number;
  }>;
}

// ─── Animation presets ────────────────────────────────────────────────────────
const fadeUp = { hidden: { opacity: 0, y: 28 }, visible: { opacity: 1, y: 0 } };
const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];
const stagger = { visible: { transition: { staggerChildren: 0.12 } } };

// ─── Demo videos (same as landing page) ──────────────────────────────────────
const R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";
const DEMO_VIDEOS = [
  { id: "dv-1", url: `${R2}/text-to-concept-building.mp4`, previewStart: 105, color: "#4F8AFF", rgb: "79,138,255" },
  { id: "dv-2", url: `${R2}/floor-plan-demo.mp4`, previewStart: 0, color: "#8B5CF6", rgb: "139,92,246" },
  { id: "dv-3", url: `${R2}/3d-model-preview.mp4`, previewStart: 0, color: "#10B981", rgb: "16,185,129" },
];

// ─── Plan limits ─────────────────────────────────────────────────────────────
const PLAN_LIMITS: Record<string, number> = { FREE: 5, MINI: 10, STARTER: 30, PRO: 100 };

// ─── Node showcase data ──────────────────────────────────────────────────────
const NODE_TYPES = [
  { icon: <Type size={20} />, name: "Text Prompt", color: "#4F8AFF", cat: "input" },
  { icon: <ImageIcon size={20} />, name: "Image Upload", color: "#4F8AFF", cat: "input" },
  { icon: <Box size={20} />, name: "IFC Upload", color: "#4F8AFF", cat: "input" },
  { icon: <MapPin size={20} />, name: "Location", color: "#4F8AFF", cat: "input" },
  { icon: <Sparkles size={20} />, name: "AI Analyzer", color: "#8B5CF6", cat: "transform" },
  { icon: <Sliders size={20} />, name: "Parameters", color: "#8B5CF6", cat: "transform" },
  { icon: <Building2 size={20} />, name: "3D Massing", color: "#10B981", cat: "generate" },
  { icon: <Palette size={20} />, name: "Render", color: "#10B981", cat: "generate" },
  { icon: <FileSpreadsheet size={20} />, name: "BOQ Export", color: "#F59E0B", cat: "export" },
  { icon: <FileText size={20} />, name: "PDF Report", color: "#F59E0B", cat: "export" },
];

// ─── Default data ────────────────────────────────────────────────────────────
const DEFAULT_DATA: DashboardData = {
  userName: null, userRole: "FREE",
  xp: 0, level: 1, progress: 0, xpInLevel: 0, xpForNext: 500,
  workflowCount: 0, executionCount: 0, referralBonus: 0,
  missions: [], blueprints: [], achievements: [],
  flashEvent: null, recentWorkflows: [],
};

// ─── Orbit animation — floating AEC elements ────────────────────────────────
function AECOrbit() {
  return (
    <div style={{ position: "absolute", top: "50%", right: "10%", width: 200, height: 200, transform: "translateY(-50%)", pointerEvents: "none" }} className="dashboard-orbit-container">
      {/* Central glow */}
      <div style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: 8, height: 8, borderRadius: "50%", background: "#4F8AFF",
        boxShadow: "0 0 40px rgba(79,138,255,0.3), 0 0 80px rgba(79,138,255,0.1)",
      }} />
      {/* Orbit ring */}
      <svg style={{ position: "absolute", inset: 0 }} viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="75" fill="none" stroke="rgba(79,138,255,0.06)" strokeWidth="1" strokeDasharray="4 6" />
        <circle cx="100" cy="100" r="45" fill="none" stroke="rgba(139,92,246,0.05)" strokeWidth="0.5" strokeDasharray="3 5" />
      </svg>
      {/* Orbiting elements */}
      {[
        { angle: 0, r: 75, color: "#4F8AFF", size: 8, dur: "12s", label: "3D" },
        { angle: 90, r: 75, color: "#8B5CF6", size: 7, dur: "12s", label: "AI" },
        { angle: 180, r: 75, color: "#10B981", size: 8, dur: "12s", label: "IFC" },
        { angle: 270, r: 75, color: "#F59E0B", size: 6, dur: "12s", label: "BOQ" },
        { angle: 45, r: 45, color: "#06B6D4", size: 5, dur: "8s", label: "" },
        { angle: 200, r: 45, color: "#EC4899", size: 4, dur: "8s", label: "" },
      ].map((orb, i) => {
        const rad = (orb.angle * Math.PI) / 180;
        const cx = 100 + orb.r * Math.cos(rad);
        const cy = 100 + orb.r * Math.sin(rad);
        return (
          <motion.div
            key={i}
            animate={{ rotate: 360 }}
            transition={{ duration: parseFloat(orb.dur), repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
              transformOrigin: "100px 100px",
            }}
          >
            <div style={{
              position: "absolute",
              left: cx - orb.size / 2, top: cy - orb.size / 2,
              width: orb.size, height: orb.size,
              borderRadius: "50%", background: orb.color,
              boxShadow: `0 0 ${orb.size * 2}px ${orb.color}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {orb.label && (
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ duration: parseFloat(orb.dur), repeat: Infinity, ease: "linear" }}
                  style={{ position: "absolute", top: orb.size + 4, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}
                >
                  <span style={{ fontSize: 7, fontWeight: 700, color: orb.color, fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "0.05em", opacity: 0.6 }}>
                    {orb.label}
                  </span>
                </motion.div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const loadFromTemplate = useWorkflowStore((s) => s.loadFromTemplate);
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const videoSectionRef = useRef<HTMLDivElement>(null);
  const videoInView = useInView(videoSectionRef, { once: false, margin: "-10%" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/user/dashboard-stats", { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error("API error"); return r.json(); })
      .then((d: DashboardData) => { if (d && typeof d.workflowCount === "number") setData(d); })
      .catch(() => {});
    const timeout = setTimeout(() => controller.abort(), 5000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  // Autoplay videos when in view
  useEffect(() => {
    const refs = videoRefs.current;
    if (videoInView) {
      DEMO_VIDEOS.forEach(d => {
        const v = refs[d.id];
        if (v) { v.currentTime = d.previewStart; v.play().catch(() => {}); }
      });
    } else {
      Object.values(refs).forEach(v => { if (v) v.pause(); });
    }
  }, [videoInView]);

  const firstName = data.userName?.split(" ")[0] ?? "";
  const role = data.userRole ?? "FREE";
  const basePlanLimit = PLAN_LIMITS[role] ?? 5;
  const bonus = data.referralBonus ?? 0;
  const effectiveLimit = basePlanLimit + bonus;
  const used = data.executionCount;
  const usagePercent = Math.min((used / effectiveLimit) * 100, 100);

  // Open a prebuilt template in the canvas
  const openTemplate = useCallback((templateId: string) => {
    const template = PREBUILT_WORKFLOWS.find(w => w.id === templateId);
    if (!template) { router.push("/dashboard/canvas"); return; }
    loadFromTemplate(template as WorkflowTemplate);
    router.push("/dashboard/canvas");
  }, [loadFromTemplate, router]);

  // Map video demos to their matching prebuilt workflow IDs
  const VIDEO_TO_TEMPLATE: Record<string, string> = {
    "dv-1": "wf-18", // Text to Concept Building + IFC
    "dv-2": "wf-17", // Floor Plan to 3D
    "dv-3": "wf-05", // Parameters to 3D Building + IFC
  };

  // Video card titles/subtitles/nodes from i18n
  const videoCards = [
    { ...DEMO_VIDEOS[0], titleKey: "landing.demoVideo1Title" as TranslationKey, subKey: "landing.demoVideo1Subtitle" as TranslationKey, nodes: ["landing.demoVideo1Node1" as TranslationKey, "landing.demoVideo1Node2" as TranslationKey, "landing.demoVideo1Node3" as TranslationKey], duration: "1:32" },
    { ...DEMO_VIDEOS[1], titleKey: "landing.demoVideo2Title" as TranslationKey, subKey: "landing.demoVideo2Subtitle" as TranslationKey, nodes: ["landing.demoVideo2Node1" as TranslationKey, "landing.demoVideo2Node2" as TranslationKey, "landing.demoVideo2Node3" as TranslationKey], duration: "2:45" },
    { ...DEMO_VIDEOS[2], titleKey: "landing.demoVideo3Title" as TranslationKey, subKey: "landing.demoVideo3Subtitle" as TranslationKey, nodes: ["landing.demoVideo3Node1" as TranslationKey, "landing.demoVideo3Node2" as TranslationKey, "landing.demoVideo3Node3" as TranslationKey], duration: "1:45" },
  ];

  return (
    <div className="dp-page-bg flex flex-col h-full overflow-hidden">
      <PageBackground />
      <div className="dashboard-noise" />

      <main className="flex-1 overflow-y-auto relative" style={{ zIndex: 1 }}>
        <div className="dashboard-home-container" style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 1 — WELCOME HERO (Cinematic)
              ══════════════════════════════════════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: smoothEase }}
            className="dash-hero-main"
            style={{
              position: "relative", overflow: "hidden",
              borderRadius: 28, marginBottom: 32,
              minHeight: 220,
            }}
          >
            {/* ── Multi-layer background ── */}
            {/* Base gradient */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(160deg, #080a14 0%, #0d1020 40%, #0a0e1c 70%, #0c0f1f 100%)",
            }} />
            {/* Animated gradient mesh — 3 slow-moving orbs */}
            <motion.div
              animate={{ x: [0, 30, -10, 0], y: [0, -20, 10, 0] }}
              transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
              style={{
                position: "absolute", top: "-30%", right: "-5%", width: 500, height: 500,
                borderRadius: "50%", pointerEvents: "none",
                background: "radial-gradient(circle, rgba(79,138,255,0.1) 0%, transparent 60%)",
                filter: "blur(60px)",
              }}
            />
            <motion.div
              animate={{ x: [0, -20, 15, 0], y: [0, 15, -10, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 3 }}
              style={{
                position: "absolute", bottom: "-20%", left: "5%", width: 400, height: 400,
                borderRadius: "50%", pointerEvents: "none",
                background: "radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 60%)",
                filter: "blur(50px)",
              }}
            />
            <motion.div
              animate={{ x: [0, 15, -15, 0], y: [0, -10, 20, 0] }}
              transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 6 }}
              style={{
                position: "absolute", top: "20%", left: "40%", width: 300, height: 300,
                borderRadius: "50%", pointerEvents: "none",
                background: "radial-gradient(circle, rgba(16,185,129,0.05) 0%, transparent 60%)",
                filter: "blur(45px)",
              }}
            />

            {/* Blueprint grid with fade mask */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              backgroundImage: "linear-gradient(rgba(79,138,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.03) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "radial-gradient(ellipse 70% 80% at 30% 50%, black 30%, transparent 80%)",
              WebkitMaskImage: "radial-gradient(ellipse 70% 80% at 30% 50%, black 30%, transparent 80%)",
            }} />

            {/* Floating particles */}
            <div className="dash-particles">
              {[
                { x: "8%", y: "18%", size: 3, color: "#4F8AFF", delay: "0s" },
                { x: "22%", y: "72%", size: 2, color: "#8B5CF6", delay: "1.5s" },
                { x: "48%", y: "12%", size: 3, color: "#10B981", delay: "3s" },
                { x: "62%", y: "82%", size: 2, color: "#F59E0B", delay: "4.5s" },
                { x: "88%", y: "25%", size: 2, color: "#06B6D4", delay: "2s" },
                { x: "32%", y: "50%", size: 2, color: "#EC4899", delay: "5.5s" },
                { x: "75%", y: "55%", size: 3, color: "#4F8AFF", delay: "7s" },
                { x: "55%", y: "35%", size: 2, color: "#8B5CF6", delay: "3.5s" },
              ].map((p, i) => (
                <div key={i} className="dash-particle" style={{
                  left: p.x, top: p.y, width: p.size, height: p.size,
                  background: p.color, boxShadow: `0 0 ${p.size * 4}px ${p.color}50`,
                  animationDelay: p.delay, animationDuration: `${7 + i * 0.6}s`,
                }} />
              ))}
            </div>

            {/* AEC Orbit */}
            <AECOrbit />

            {/* ── Top accent line ── */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 2,
              background: "linear-gradient(90deg, transparent 5%, rgba(79,138,255,0.4) 20%, rgba(139,92,246,0.3) 50%, rgba(16,185,129,0.2) 80%, transparent 95%)",
              pointerEvents: "none",
            }} />

            {/* ── Content ── */}
            <div style={{ position: "relative", zIndex: 1, padding: "32px 40px 28px", maxWidth: 620 }} className="dashboard-hero-content">
              {/* Plan + Usage row */}
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.5, ease: smoothEase }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 12,
                  padding: "6px 6px 6px 14px", borderRadius: 24,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  backdropFilter: "blur(12px)",
                  marginBottom: 16,
                }}
              >
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                  color: role === "FREE" ? "#4F8AFF" : "#F59E0B",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  {role === "FREE" ? <Zap size={10} /> : <Crown size={10} />}
                  {role}
                </span>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
                <span style={{ fontSize: 11, color: "#556070" }}>
                  {used}/{effectiveLimit} {t('dash.workflowsUsed')}
                  {bonus > 0 && (
                    <span style={{ color: "#10B981", marginLeft: 4, fontSize: 10 }}>
                      (+{bonus})
                    </span>
                  )}
                </span>
                {/* Mini progress ring */}
                <svg width="22" height="22" viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
                  <motion.circle
                    cx="11" cy="11" r="9" fill="none"
                    stroke={usagePercent > 80 ? "#EF4444" : "#4F8AFF"}
                    strokeWidth="2" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 9}`}
                    initial={{ strokeDashoffset: 2 * Math.PI * 9 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 9 * (1 - usagePercent / 100) }}
                    transition={{ delay: 0.8, duration: 1.2, ease: smoothEase }}
                    transform="rotate(-90 11 11)"
                  />
                </svg>
              </motion.div>

              {/* Greeting — big, bold, gradient */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.7, ease: smoothEase }}
                style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 10 }}
              >
                {firstName ? (
                  <>
                    <span style={{ color: "#4A5568", fontSize: "0.5em", fontWeight: 400, display: "block", marginBottom: 6, letterSpacing: "0px" }}>
                      {t('dash.welcomeBack')}
                    </span>
                    <span className="dash-shimmer-text">{firstName}</span>
                    <span style={{
                      background: "linear-gradient(135deg, #4F8AFF, #8B5CF6)",
                      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                    }}>.</span>
                  </>
                ) : (
                  <>
                    <span className="dash-shimmer-text">{t('dash.welcomeNew')}</span>
                  </>
                )}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.5, ease: smoothEase }}
                style={{ fontSize: 15, color: "#6B7A8D", lineHeight: 1.5, marginBottom: 20, maxWidth: 420 }}
              >
                {t('dash.letsCreate')}
              </motion.p>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.5, ease: smoothEase }}
                style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}
              >
                <Link href="/dashboard/workflows/new" className="dash-cta-primary" style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "11px 26px", borderRadius: 12,
                  background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 50%, #8B5CF6 100%)",
                  backgroundSize: "200% 200%",
                  color: "#fff", fontSize: 14, fontWeight: 700,
                  textDecoration: "none",
                  boxShadow: "0 4px 28px rgba(79,138,255,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
                  transition: "all 0.3s ease",
                  letterSpacing: "-0.01em",
                }}>
                  <Plus size={16} strokeWidth={2.5} /> {t('dash.startBuilding')}
                </Link>
                {role === "FREE" && (
                  <Link href="/dashboard/billing" className="dash-upgrade-btn" style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "11px 22px", borderRadius: 12,
                    background: "rgba(245,158,11,0.04)",
                    border: "1px solid rgba(245,158,11,0.12)",
                    color: "#F59E0B", fontSize: 14, fontWeight: 600,
                    textDecoration: "none",
                    transition: "all 0.3s ease",
                  }}>
                    <Crown size={15} /> {t('dash.upgradePlan')}
                  </Link>
                )}
              </motion.div>
            </div>

            {/* ── Bottom fade line ── */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0, height: 1,
              background: "linear-gradient(90deg, transparent, rgba(79,138,255,0.1), rgba(139,92,246,0.08), transparent)",
              pointerEvents: "none",
            }} />
          </motion.div>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 2 — VIDEO SHOWCASE
              "What used to take days — now takes minutes."
              ══════════════════════════════════════════════════════════════ */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            style={{ marginBottom: 56 }}
          >
            {/* Impact heading */}
            <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }} style={{ textAlign: "center", marginBottom: 40 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 14px", borderRadius: 20, marginBottom: 16,
                background: "rgba(0,245,255,0.06)", border: "1px solid rgba(0,245,255,0.12)",
                fontSize: 9, fontWeight: 700, color: "#00F5FF", letterSpacing: "0.15em",
              }}>
                <Play size={10} /> {t('dash.seeItInAction')}
              </span>
              <h2 className="dash-shimmer-text" style={{ fontSize: "clamp(24px, 3.5vw, 38px)", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.15, marginBottom: 12 }}>
                {t('dash.impactLine')}
              </h2>
              <p style={{ fontSize: 15, color: "#6B7A8D", maxWidth: 500, margin: "0 auto", lineHeight: 1.7 }}>
                {t('dash.impactSub')}
              </p>
            </motion.div>

            {/* Video cards grid */}
            <div ref={videoSectionRef} className="grid gap-5 dashboard-video-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {videoCards.map((vc, i) => (
                <motion.div
                  key={vc.id}
                  variants={fadeUp}
                  transition={{ duration: 0.5, delay: i * 0.1, ease: smoothEase }}
                  style={{
                    position: "relative", overflow: "hidden",
                    borderRadius: 18,
                    background: "rgba(10,12,22,0.9)",
                    border: `1px solid rgba(${vc.rgb}, 0.12)`,
                    transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                  }}
                  className="dash-card-hover dash-video-card"
                >
                  {/* Video preview */}
                  <div style={{ position: "relative", height: 200, overflow: "hidden" }}>
                    <video
                      ref={el => { videoRefs.current[vc.id] = el; }}
                      src={vc.url}
                      muted playsInline
                      onLoadedMetadata={e => { e.currentTarget.currentTime = vc.previewStart; }}
                      onEnded={e => { const v = e.currentTarget; v.currentTime = vc.previewStart; v.play().catch(() => {}); }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    {/* Gradient overlay */}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", background: "linear-gradient(transparent, rgba(10,12,22,0.95))", pointerEvents: "none" }} />
                    {/* Duration badge */}
                    <div style={{
                      position: "absolute", top: 10, right: 10,
                      padding: "3px 8px", borderRadius: 6,
                      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
                      fontSize: 10, color: "#8898AA", fontFamily: "var(--font-jetbrains), monospace",
                    }}>
                      {vc.duration}
                    </div>
                    {/* Corner accents */}
                    <svg style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} width={16} height={16}>
                      <path d="M0 16 L0 0 L16 0" stroke={vc.color} strokeWidth="1.5" fill="none" opacity={0.4} />
                    </svg>
                    <svg style={{ position: "absolute", top: 0, right: 0, pointerEvents: "none" }} width={16} height={16}>
                      <path d="M0 0 L16 0 L16 16" stroke={vc.color} strokeWidth="1.5" fill="none" opacity={0.4} />
                    </svg>
                    <svg style={{ position: "absolute", bottom: 0, left: 0, pointerEvents: "none" }} width={16} height={16}>
                      <path d="M0 0 L0 16 L16 16" stroke={vc.color} strokeWidth="1.5" fill="none" opacity={0.2} />
                    </svg>
                    <svg style={{ position: "absolute", bottom: 0, right: 0, pointerEvents: "none" }} width={16} height={16}>
                      <path d="M16 0 L16 16 L0 16" stroke={vc.color} strokeWidth="1.5" fill="none" opacity={0.2} />
                    </svg>
                  </div>

                  {/* Card content */}
                  <div style={{ padding: "16px 18px 20px" }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F5", marginBottom: 4, letterSpacing: "-0.02em" }}>
                      {t(vc.titleKey)}
                    </h3>
                    <p style={{ fontSize: 12, color: vc.color, fontWeight: 600, marginBottom: 12 }}>
                      {t(vc.subKey)}
                    </p>

                    {/* Pipeline node tags */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
                      {vc.nodes.map((nk, ni) => (
                        <React.Fragment key={nk}>
                          <span style={{
                            fontSize: 8, fontWeight: 600, color: "#9898B0",
                            padding: "2px 7px", borderRadius: 4,
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                            fontFamily: "var(--font-jetbrains), monospace", textTransform: "uppercase", letterSpacing: "0.04em",
                          }}>
                            {t(nk)}
                          </span>
                          {ni < vc.nodes.length - 1 && <span style={{ fontSize: 9, color: "#3A3A50" }}>→</span>}
                        </React.Fragment>
                      ))}
                    </div>

                    {/* Try this workflow button */}
                    <button
                      onClick={() => openTemplate(VIDEO_TO_TEMPLATE[vc.id] ?? "wf-18")}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        padding: "9px 16px", borderRadius: 10, width: "100%",
                        background: `rgba(${vc.rgb}, 0.08)`,
                        border: `1px solid rgba(${vc.rgb}, 0.15)`,
                        color: vc.color, fontSize: 11, fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "var(--font-jetbrains), monospace",
                        letterSpacing: "0.03em",
                        transition: "all 0.2s",
                      }}
                    >
                      {t('dash.tryThisWorkflow')} <ArrowRight size={12} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Section divider */}
          <div className="dash-section-divider" />

          {/* ══════════════════════════════════════════════════════════════
              SECTION 3 — TEMPLATE SHOWCASE
              ══════════════════════════════════════════════════════════════ */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            style={{ marginBottom: 56 }}
          >
            <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }} style={{ textAlign: "center", marginBottom: 40 }}>
              <h2 style={{ fontSize: "clamp(22px, 3vw, 34px)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.04em", marginBottom: 8 }}>
                {t('dash.templateShowcase')}
              </h2>
              <p style={{ fontSize: 14, color: "#6B7A8D", maxWidth: 460, margin: "0 auto", lineHeight: 1.7 }}>
                {t('dash.templateShowcaseSub')}
              </p>
            </motion.div>

            {/* ── FREE TEMPLATES ── */}
            <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 12px", borderRadius: 20,
                  background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)",
                  fontSize: 10, fontWeight: 700, color: "#10B981", letterSpacing: "0.1em",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  <Zap size={10} /> {t('dash.freeTemplates')}
                </div>
                <span style={{ fontSize: 12, color: "#556070" }}>{t('dash.freeTemplatesSub')}</span>
              </div>
            </motion.div>

            <div className="grid gap-4 mb-10 dashboard-template-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {PREBUILT_WORKFLOWS
                .filter(w => !["wf-03", "wf-12", "wf-14", "wf-16", "wf-17"].includes(w.id))
                .slice(0, 6)
                .map((wf, i) => {
                  const catColors: Record<string, string> = {
                    "Concept Design": "#3B82F6", "Visualization": "#10B981",
                    "BIM Export": "#F59E0B", "Cost Estimation": "#8B5CF6",
                    "3D Modeling": "#06B6D4", "Site Analysis": "#10B981",
                  };
                  const color = catColors[wf.category] ?? "#3B82F6";
                  const nodeCount = wf.tileGraph?.nodes?.length ?? 0;
                  return (
                    <motion.div
                      key={wf.id}
                      variants={fadeUp}
                      transition={{ duration: 0.4, delay: i * 0.08, ease: smoothEase }}
                    >
                      <div
                        onClick={() => openTemplate(wf.id)}
                        className="dash-card-hover block"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") openTemplate(wf.id); }}
                        style={{
                          position: "relative", overflow: "hidden",
                          background: "rgba(12,14,22,0.85)", backdropFilter: "blur(12px)",
                          border: `1px solid rgba(255,255,255,0.05)`,
                          borderRadius: 16, padding: "20px 20px 18px",
                          cursor: "pointer", height: "100%",
                          display: "flex", flexDirection: "column",
                          transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                        }}
                      >
                        {/* Top accent */}
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.3 }} />

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "3px 8px", borderRadius: 6,
                            background: `${color}10`, border: `1px solid ${color}20`,
                            fontSize: 9, fontWeight: 700, color,
                            fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "0.06em",
                          }}>
                            <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
                            {wf.category}
                          </span>
                          <span style={{
                            fontSize: 9, color: "#556070",
                            fontFamily: "var(--font-jetbrains), monospace",
                          }}>
                            {nodeCount} {t('dash.nodes')}
                          </span>
                        </div>

                        <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0", marginBottom: 6, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                          {wf.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#6B7A8D", lineHeight: 1.55, flex: 1, marginBottom: 14 }}>
                          {wf.description.length > 90 ? wf.description.slice(0, 90) + "..." : wf.description}
                        </div>

                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          padding: "8px", borderRadius: 8,
                          background: `${color}08`, border: `1px solid ${color}12`,
                          fontSize: 11, fontWeight: 700, color,
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}>
                          {t('dash.useIt')} <ArrowRight size={12} />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
            </div>

            {/* ── PRO TEMPLATES ── */}
            <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 12px", borderRadius: 20,
                  background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)",
                  fontSize: 10, fontWeight: 700, color: "#F59E0B", letterSpacing: "0.1em",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  <Crown size={10} /> {t('dash.proTemplates')}
                </div>
                <span style={{ fontSize: 12, color: "#556070" }}>{t('dash.proTemplatesSub')}</span>
              </div>
            </motion.div>

            <div className="grid gap-4 mb-8 dashboard-template-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {PREBUILT_WORKFLOWS
                .filter(w => ["wf-03", "wf-12", "wf-14", "wf-16", "wf-17"].includes(w.id))
                .map((wf, i) => {
                  const catColors: Record<string, string> = {
                    "Concept Design": "#3B82F6", "Visualization": "#10B981",
                    "BIM Export": "#F59E0B", "Cost Estimation": "#8B5CF6",
                    "3D Modeling": "#06B6D4",
                  };
                  const color = catColors[wf.category] ?? "#F59E0B";
                  const nodeCount = wf.tileGraph?.nodes?.length ?? 0;
                  const isFree = role !== "FREE";
                  return (
                    <motion.div
                      key={wf.id}
                      variants={fadeUp}
                      transition={{ duration: 0.4, delay: i * 0.08, ease: smoothEase }}
                    >
                      <div
                        className={isFree ? "dash-card-hover" : ""}
                        style={{
                          position: "relative", overflow: "hidden",
                          background: "rgba(12,14,22,0.85)", backdropFilter: "blur(12px)",
                          border: "1px solid rgba(245,158,11,0.08)",
                          borderRadius: 16, padding: "20px 20px 18px",
                          height: "100%",
                          display: "flex", flexDirection: "column",
                          opacity: role === "FREE" ? 0.6 : 1,
                          transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                        }}
                      >
                        {/* Top accent */}
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #F59E0B, transparent)", opacity: 0.2 }} />

                        {/* PRO lock overlay for free users */}
                        {role === "FREE" && (
                          <div style={{
                            position: "absolute", inset: 0, zIndex: 2,
                            background: "rgba(10,12,20,0.4)", backdropFilter: "blur(1px)",
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
                            borderRadius: 16,
                          }}>
                            <div style={{
                              padding: "8px 18px", borderRadius: 12,
                              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)",
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                              <Crown size={14} style={{ color: "#F59E0B" }} />
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", fontFamily: "var(--font-jetbrains), monospace" }}>
                                {t('dash.proBadge')}
                              </span>
                            </div>
                          </div>
                        )}

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "3px 8px", borderRadius: 6,
                            background: `${color}10`, border: `1px solid ${color}20`,
                            fontSize: 9, fontWeight: 700, color,
                            fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "0.06em",
                          }}>
                            <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
                            {wf.category}
                          </span>
                          <span style={{ fontSize: 9, color: "#556070", fontFamily: "var(--font-jetbrains), monospace" }}>
                            {nodeCount} {t('dash.nodes')}
                          </span>
                        </div>

                        <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0", marginBottom: 6, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                          {wf.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#6B7A8D", lineHeight: 1.55, flex: 1, marginBottom: 14 }}>
                          {wf.description.length > 90 ? wf.description.slice(0, 90) + "..." : wf.description}
                        </div>

                        {role === "FREE" ? (
                          <Link href="/dashboard/billing" style={{
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "8px", borderRadius: 8,
                            background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.1)",
                            fontSize: 11, fontWeight: 700, color: "#F59E0B",
                            fontFamily: "var(--font-jetbrains), monospace",
                            textDecoration: "none", position: "relative", zIndex: 3,
                          }}>
                            <Crown size={11} /> {t('dash.upgradePlan')}
                          </Link>
                        ) : (
                          <button onClick={() => openTemplate(wf.id)} style={{
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "8px", borderRadius: 8, width: "100%",
                            background: `${color}08`, border: `1px solid ${color}12`,
                            fontSize: 11, fontWeight: 700, color,
                            fontFamily: "var(--font-jetbrains), monospace",
                            cursor: "pointer",
                          }}>
                            {t('dash.useIt')} <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
            </div>

            {/* View All link */}
            <motion.div variants={fadeUp} style={{ textAlign: "center" }}>
              <Link href="/dashboard/templates" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 600, color: "#4F8AFF",
                textDecoration: "none", transition: "all 0.2s",
              }}>
                {t('dash.viewAll')} <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>

          {/* Section divider */}
          <div className="dash-section-divider" />

          {/* ══════════════════════════════════════════════════════════════
              SECTION 4 — PROBLEM → SOLUTION
              ══════════════════════════════════════════════════════════════ */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            style={{
              position: "relative", overflow: "hidden",
              borderRadius: 24, marginBottom: 48,
              background: "linear-gradient(135deg, rgba(10,12,22,0.9), rgba(15,18,28,0.85))",
              border: "1px solid rgba(255,255,255,0.04)",
              padding: "48px 44px",
            }}
          >
            {/* Blueprint grid bg */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              backgroundImage: "linear-gradient(rgba(184,115,51,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(184,115,51,0.02) 1px, transparent 1px)",
              backgroundSize: "36px 36px",
            }} />

            <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }} style={{ textAlign: "center", marginBottom: 40, position: "relative", zIndex: 1 }}>
              <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.04em", marginBottom: 8 }}>
                {t('dash.problemTitle')}
              </h2>
            </motion.div>

            <div className="grid gap-6 dashboard-problem-grid" style={{ gridTemplateColumns: "1fr 1fr", position: "relative", zIndex: 1 }}>
              {/* Old Way */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}>
                <div className="dash-problem-card dash-problem-old" style={{
                  padding: "24px 24px 24px 28px", borderRadius: 16,
                  background: "rgba(239,68,68,0.03)",
                  border: "1px solid rgba(239,68,68,0.08)",
                  backdropFilter: "blur(12px)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#EF4444", letterSpacing: "0.15em", marginBottom: 20, fontFamily: "var(--font-jetbrains), monospace" }}>
                    {t('dash.oldWay')}
                  </div>
                  {[t('dash.pain1'), t('dash.pain2'), t('dash.pain3'), t('dash.pain4')].map((pain, i) => (
                    <motion.div
                      key={i}
                      variants={fadeUp}
                      transition={{ duration: 0.4, delay: i * 0.08, ease: smoothEase }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 0",
                        borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : "none",
                      }}
                    >
                      <X size={14} style={{ color: "#EF4444", flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: "#6B7A8D", textDecoration: "line-through", textDecorationColor: "rgba(239,68,68,0.4)" }}>
                        {pain}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* New Way */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.15, ease: smoothEase }}>
                <div className="dash-problem-card dash-problem-new" style={{
                  padding: "24px 24px 24px 28px", borderRadius: 16,
                  background: "rgba(16,185,129,0.03)",
                  border: "1px solid rgba(16,185,129,0.08)",
                  backdropFilter: "blur(12px)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#10B981", letterSpacing: "0.15em", marginBottom: 20, fontFamily: "var(--font-jetbrains), monospace" }}>
                    {t('dash.newWay')}
                  </div>
                  {[t('dash.fix1'), t('dash.fix2'), t('dash.fix3'), t('dash.fix4')].map((fix, i) => (
                    <motion.div
                      key={i}
                      variants={fadeUp}
                      transition={{ duration: 0.4, delay: 0.15 + i * 0.08, ease: smoothEase }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 0",
                        borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : "none",
                      }}
                    >
                      <Zap size={14} style={{ color: "#10B981", flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: "#E2E8F0", fontWeight: 500 }}>
                        {fix}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* Section divider */}
          <div className="dash-section-divider" />

          {/* ══════════════════════════════════════════════════════════════
              SECTION 4 — NODE SHOWCASE
              "Your Nodes, Your Power"
              ══════════════════════════════════════════════════════════════ */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            style={{ marginBottom: 48 }}
          >
            <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }} style={{ textAlign: "center", marginBottom: 36 }}>
              <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.04em", marginBottom: 8 }}>
                {t('dash.nodesTitle')}
              </h2>
              <p style={{ fontSize: 14, color: "#6B7A8D", maxWidth: 460, margin: "0 auto", lineHeight: 1.7 }}>
                {t('dash.nodesSub')}
              </p>
            </motion.div>

            {/* Horizontal scrolling node cards */}
            <div className="dashboard-node-scroll" style={{
              display: "flex", gap: 12,
              overflowX: "auto", paddingBottom: 12,
              WebkitOverflowScrolling: "touch",
              scrollSnapType: "x mandatory",
              msOverflowStyle: "none",
              scrollbarWidth: "none",
            }}>
              {NODE_TYPES.map((node, i) => {
                const catColors: Record<string, { bg: string; border: string }> = {
                  input: { bg: "rgba(79,138,255,0.06)", border: "rgba(79,138,255,0.12)" },
                  transform: { bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.12)" },
                  generate: { bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.12)" },
                  export: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.12)" },
                };
                const cc = catColors[node.cat] ?? catColors.input;
                return (
                  <motion.div
                    key={node.name}
                    variants={fadeUp}
                    transition={{ duration: 0.4, delay: i * 0.05, ease: smoothEase }}
                    style={{
                      minWidth: 120, flexShrink: 0,
                      scrollSnapAlign: "start",
                      padding: "20px 16px", borderRadius: 14,
                      background: cc.bg, border: `1px solid ${cc.border}`,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                      cursor: "pointer",
                      transition: "all 300ms ease",
                    }}
                    className="dash-node-card"
                  >
                    <div className="dash-node-icon" style={{
                      width: 42, height: 42, borderRadius: 11,
                      background: `${node.color}12`, border: `1px solid ${node.color}20`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: node.color,
                      transition: "all 0.3s ease",
                    }}>
                      {node.icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#E2E8F0", textAlign: "center", lineHeight: 1.3 }}>
                      {node.name}
                    </span>
                    <span style={{
                      fontSize: 8, fontWeight: 700, color: node.color,
                      textTransform: "uppercase", letterSpacing: "0.1em",
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}>
                      {node.cat}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Section divider */}
          <div className="dash-section-divider" />

          {/* ══════════════════════════════════════════════════════════════
              SECTION 5 — READY CTA
              ══════════════════════════════════════════════════════════════ */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
            variants={fadeUp}
            transition={{ duration: 0.6, ease: smoothEase }}
            style={{
              textAlign: "center", padding: "48px 32px",
              borderRadius: 20, marginBottom: 32,
              background: "linear-gradient(135deg, rgba(79,138,255,0.04), rgba(139,92,246,0.03))",
              border: "1px solid rgba(79,138,255,0.08)",
              position: "relative", overflow: "hidden",
            }}
          >
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              backgroundImage: "linear-gradient(rgba(79,138,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.02) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.04em", marginBottom: 8 }}>
                {t('dash.readyToBuild')}
              </h2>
              <p style={{ fontSize: 14, color: "#6B7A8D", marginBottom: 24 }}>
                {t('dash.readyDesc')}
              </p>
              <Link href="/dashboard/workflows/new" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "14px 36px", borderRadius: 14,
                background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
                color: "#fff", fontSize: 15, fontWeight: 700,
                textDecoration: "none",
                boxShadow: "0 4px 24px rgba(79,138,255,0.3)",
              }}>
                {t('dash.startBuilding')} <ArrowRight size={16} />
              </Link>
            </div>
          </motion.div>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 6 — RECENT WORKFLOWS (only if exists)
              ══════════════════════════════════════════════════════════════ */}
          {(data.recentWorkflows ?? []).length > 0 && (
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={stagger}
              style={{ marginBottom: 32 }}
            >
              <motion.div variants={fadeUp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#E2E8F0", letterSpacing: "-0.02em" }}>
                  {t('dash.recentActivity')}
                </h3>
                <Link href="/dashboard/workflows" style={{ fontSize: 12, fontWeight: 600, color: "#4F8AFF", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                  {t('dash.allWorkflows')} <ChevronRight size={14} />
                </Link>
              </motion.div>

              <div className="grid grid-cols-3 gap-4 dashboard-recent-grid">
                {(data.recentWorkflows ?? []).map((wf, i) => (
                  <motion.div key={wf.id} variants={fadeUp} transition={{ duration: 0.4, delay: i * 0.07, ease: smoothEase }}>
                    <Link
                      href={`/dashboard/canvas?id=${wf.id}`}
                      className="dash-card-hover block"
                      style={{
                        background: "rgba(12,14,22,0.85)", backdropFilter: "blur(16px)",
                        border: "1px solid rgba(255,255,255,0.05)",
                        borderRadius: 14, overflow: "hidden", textDecoration: "none",
                        transition: "all 300ms ease",
                      }}
                    >
                      <div style={{
                        padding: "12px 16px",
                        background: "linear-gradient(135deg, rgba(79,138,255,0.05), rgba(99,102,241,0.02))",
                        borderBottom: "1px solid rgba(79,138,255,0.06)",
                        display: "flex", alignItems: "center", gap: 10,
                      }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <FileText size={13} style={{ color: "#4F8AFF" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {wf.name}
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 10, color: "#556070", display: "flex", alignItems: "center", gap: 3, fontFamily: "var(--font-jetbrains), monospace" }}>
                          <Zap size={9} style={{ color: "#4F8AFF" }} /> {wf.nodeCount} {t('dash.nodes')}
                        </span>
                        <span style={{ fontSize: 10, color: "#556070", display: "flex", alignItems: "center", gap: 3, fontFamily: "var(--font-jetbrains), monospace" }}>
                          <Play size={8} style={{ color: "#10B981" }} /> {wf.executionCount} {t('dash.runs')}
                        </span>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

        </div>
      </main>

      {/* ── Visual Effects System ─────────────────────────────── */}
      <style jsx global>{`
        /* Scrollbar hide */
        .dashboard-node-scroll::-webkit-scrollbar { display: none; }

        /* ── Hero main container ── */
        .dash-hero-main {
          border: 1px solid rgba(79,138,255,0.06);
          box-shadow: 0 0 80px rgba(79,138,255,0.03), 0 40px 80px rgba(0,0,0,0.4);
        }
        .dash-hero-main:hover {
          border-color: rgba(79,138,255,0.1);
          box-shadow: 0 0 100px rgba(79,138,255,0.05), 0 40px 80px rgba(0,0,0,0.5);
        }

        /* ── CTA hover effects ── */
        .dash-cta-primary:hover {
          transform: translateY(-2px) scale(1.02) !important;
          box-shadow: 0 8px 36px rgba(79,138,255,0.4), inset 0 1px 0 rgba(255,255,255,0.15) !important;
          background-position: 100% 0 !important;
        }
        .dash-upgrade-btn:hover {
          background: rgba(245,158,11,0.08) !important;
          border-color: rgba(245,158,11,0.25) !important;
          box-shadow: 0 0 20px rgba(245,158,11,0.1) !important;
          transform: translateY(-1px) !important;
        }

        /* ── Card hover effects ── */
        .dash-card-hover {
          position: relative;
        }
        .dash-card-hover::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          opacity: 0;
          transition: opacity 0.4s ease;
          background: linear-gradient(135deg, rgba(79,138,255,0.04), rgba(139,92,246,0.02));
          pointer-events: none;
          z-index: 0;
        }
        .dash-card-hover:hover::before {
          opacity: 1;
        }
        .dash-card-hover:hover {
          transform: translateY(-4px) !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 30px rgba(79,138,255,0.05) !important;
          border-color: rgba(79,138,255,0.2) !important;
        }

        /* ── Video card scan line ── */
        .dash-video-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 40%;
          pointer-events: none;
          background: linear-gradient(180deg, transparent, rgba(0,245,255,0.02), transparent);
          animation: dash-scanline 4s linear infinite;
          z-index: 2;
        }
        @keyframes dash-scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(300%); }
        }

        /* ── Glowing border animation ── */
        .dash-glow-border {
          position: relative;
        }
        .dash-glow-border::after {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, rgba(79,138,255,0.3), rgba(139,92,246,0.2), rgba(16,185,129,0.2), rgba(245,158,11,0.2));
          background-size: 300% 300%;
          animation: dash-border-flow 6s ease infinite;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          -webkit-mask-composite: xor;
          pointer-events: none;
          opacity: 0.6;
        }
        @keyframes dash-border-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* ── Floating particles ── */
        .dash-particles {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .dash-particle {
          position: absolute;
          border-radius: 50%;
          animation: dash-float 8s ease-in-out infinite;
        }
        @keyframes dash-float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          25% { transform: translateY(-20px) translateX(10px); opacity: 0.7; }
          50% { transform: translateY(-10px) translateX(-5px); opacity: 0.4; }
          75% { transform: translateY(-25px) translateX(8px); opacity: 0.6; }
        }

        /* ── Pulse glow on hero CTA ── */
        .dash-cta-primary {
          position: relative;
          overflow: hidden;
        }
        .dash-cta-primary::after {
          content: '';
          position: absolute;
          top: 50%; left: 50%;
          width: 120%; height: 120%;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(79,138,255,0.2), transparent 70%);
          animation: dash-cta-pulse 3s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes dash-cta-pulse {
          0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }

        /* ── Text shimmer effect ── */
        .dash-shimmer-text {
          background: linear-gradient(90deg, #F0F0F5 0%, #4F8AFF 40%, #8B5CF6 60%, #F0F0F5 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: dash-shimmer 4s linear infinite;
        }
        @keyframes dash-shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }

        /* ── Node card hover glow ── */
        .dash-node-card:hover {
          transform: translateY(-6px) scale(1.02) !important;
          box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important;
        }
        .dash-node-card:hover .dash-node-icon {
          box-shadow: 0 0 20px currentColor !important;
          transform: scale(1.1);
          transition: all 0.3s ease;
        }

        /* ── Section divider with animated gradient ── */
        .dash-section-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(79,138,255,0.15), rgba(139,92,246,0.1), transparent);
          margin: 0 auto 48px;
          max-width: 600px;
          position: relative;
        }
        .dash-section-divider::after {
          content: '';
          position: absolute;
          top: -2px; left: 50%; transform: translateX(-50%);
          width: 40px; height: 5px; border-radius: 3px;
          background: linear-gradient(90deg, #4F8AFF, #8B5CF6);
          box-shadow: 0 0 12px rgba(79,138,255,0.3);
        }

        /* ── Orbit container breathing ── */
        .dashboard-orbit-container {
          animation: dash-orbit-breathe 6s ease-in-out infinite;
        }
        @keyframes dash-orbit-breathe {
          0%, 100% { opacity: 0.7; transform: translateY(-50%) scale(1); }
          50% { opacity: 1; transform: translateY(-50%) scale(1.05); }
        }

        /* ── Problem card animated accent ── */
        .dash-problem-card {
          position: relative;
          overflow: hidden;
        }
        .dash-problem-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; bottom: 0; width: 3px;
          border-radius: 0 4px 4px 0;
        }
        .dash-problem-old::before {
          background: linear-gradient(180deg, #EF4444, rgba(239,68,68,0.2));
        }
        .dash-problem-new::before {
          background: linear-gradient(180deg, #10B981, rgba(16,185,129,0.2));
          box-shadow: 0 0 12px rgba(16,185,129,0.2);
        }

        /* ── Ready CTA section floating elements ── */
        .dash-ready-section {
          position: relative;
        }
        .dash-ready-section::before {
          content: '';
          position: absolute;
          top: -50%; left: -10%;
          width: 300px; height: 300px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(79,138,255,0.06), transparent 70%);
          animation: dash-ready-orb 8s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes dash-ready-orb {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, 20px); }
        }
      `}</style>
    </div>
  );
}
