// @ts-nocheck
/**
 * V1 ARCHIVE — Dashboard home (Render Studio light theme V1 from Z.2.1).
 *
 * Preserved for potential revival. To restore:
 * 1. Rename page.tsx → page.v2-archive.tsx
 * 2. Rename page.v1-archive.tsx → page.tsx
 * 3. Restore page.module.css from git (V2 replaced it with module CSS)
 *
 * Last active: 2026-05-03
 * Z.X.1 redesign: feat/dashboard-v2-render-studio
 */
"use client";

import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight, Play, Plus, Zap, ChevronDown,
  Type, FileText, Image as ImageIcon, Box, Sliders, MapPin,
  Sparkles, Palette, Building2, FileSpreadsheet, X, ChevronRight,
  Layers, Trophy, Crown, Calendar, Grid3x3, Video,
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/features/workflows/constants/prebuilt-workflows";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import { toast } from "sonner";
import type { TranslationKey } from "@/lib/i18n";
import type { WorkflowTemplate } from "@/types/workflow";
import { DASHBOARD_CHANGELOG } from "@/constants/dashboard-changelog";
import type { ChangelogEntry } from "@/constants/dashboard-changelog";
import s from "./page.module.css";

// Lazy-load 3D scenes
const WorldCanvas = lazy(() => import("@/features/dashboard/components/WorldCanvas").then((m) => ({ default: m.WorldCanvas })));
const FloorPlanScene = lazy(() => import("@/features/dashboard/components/FloorPlanScene").then((m) => ({ default: m.FloorPlanScene })));
const IFCViewerScene = lazy(() => import("@/features/dashboard/components/IFCViewerScene").then((m) => ({ default: m.IFCViewerScene })));
const VideoRenderScene = lazy(() => import("@/features/dashboard/components/VideoRenderScene").then((m) => ({ default: m.VideoRenderScene })));
import { HeroBlueprintScene } from "@/features/dashboard/components/HeroBlueprintScene";
import { scrollState } from "@/features/dashboard/components/WorldCanvas";

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
    category: string | null;
    updatedAt: string;
    nodeCount: number;
    executionCount: number;
  }>;
  recentOutputs?: Array<{
    id: string;
    type: string;
    dataUri: string | null;
    createdAt: string;
    workflowId: string;
    workflowName: string;
    workflowCategory: string | null;
  }>;
  recentActivity?: Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    workflowId: string;
    workflowName: string;
    workflowCategory: string | null;
  }>;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";
const DEMO_VIDEOS = [
  { id: "dv-4", url: `${R2}/img-to-renovation.mp4`, previewStart: 0, color: "#F59E0B", rgb: "245,158,11" },
  { id: "dv-3", url: `${R2}/3d-model-preview.mp4`, previewStart: 0, color: "#10B981", rgb: "16,185,129" },
  { id: "dv-1", url: `${R2}/text-to-concept-building.mp4`, previewStart: 132, color: "#4F8AFF", rgb: "79,138,255" },
  { id: "dv-2", url: `${R2}/floor-plan-demo.mp4`, previewStart: 0, color: "#8B5CF6", rgb: "139,92,246" },
];

const PLAN_LIMITS: Record<string, number> = { FREE: 3, MINI: 10, STARTER: 30, PRO: 100 };

const NODE_TYPES = [
  { icon: <Type size={22} />, name: "Text Prompt", color: "#4F8AFF", cat: "input" },
  { icon: <ImageIcon size={22} />, name: "Image Upload", color: "#4F8AFF", cat: "input" },
  { icon: <Box size={22} />, name: "IFC Upload", color: "#4F8AFF", cat: "input" },
  { icon: <MapPin size={22} />, name: "Location", color: "#4F8AFF", cat: "input" },
  { icon: <Sparkles size={22} />, name: "AI Analyzer", color: "#8B5CF6", cat: "transform" },
  { icon: <Sliders size={22} />, name: "Parameters", color: "#8B5CF6", cat: "transform" },
  { icon: <Building2 size={22} />, name: "3D Massing", color: "#10B981", cat: "generate" },
  { icon: <Palette size={22} />, name: "Render", color: "#10B981", cat: "generate" },
  { icon: <FileSpreadsheet size={22} />, name: "BOQ Export", color: "#F59E0B", cat: "export" },
  { icon: <FileText size={22} />, name: "PDF Report", color: "#F59E0B", cat: "export" },
];

const DEFAULT_DATA: DashboardData = {
  userName: null, userRole: "FREE",
  xp: 0, level: 1, progress: 0, xpInLevel: 0, xpForNext: 500,
  workflowCount: 0, executionCount: 0, referralBonus: 0,
  missions: [], blueprints: [], achievements: [],
  flashEvent: null, recentWorkflows: [],
};

const VIDEO_TO_TEMPLATE: Record<string, string> = {
  "dv-1": "wf-03",
  "dv-2": "wf-05",
  "dv-3": "wf-04",
  "dv-4": "wf-11",
};

// ─── Animation presets ───────────────────────────────────────────────────────
const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];
const fadeIn = { hidden: { opacity: 0, y: 40, filter: "blur(8px)" }, visible: { opacity: 1, y: 0, filter: "blur(0px)" } };
const stagger = { visible: { transition: { staggerChildren: 0.12 } } };

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const loadFromTemplate = useWorkflowStore((s) => s.loadFromTemplate);
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const videoSectionRef = useRef<HTMLDivElement>(null);
  const videoInView = useInView(videoSectionRef, { once: false, margin: "-10%" });

  // Floor plan + IFC + Video Render scene scroll progress — track within the main scroll container
  const floorPlanRef = useRef<HTMLDivElement>(null);
  const ifcRef = useRef<HTMLDivElement>(null);
  const videoRenderRef = useRef<HTMLDivElement>(null);
  const [fpVal, setFpVal] = useState(0);
  const [ifcVal, setIfcVal] = useState(0);
  const [vrVal, setVrVal] = useState(0);

  // ── Mobile layout detection (matches HeroBuildingShowcase's < 820px breakpoint) ──
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  useEffect(() => {
    const check = () => setIsMobileLayout(window.innerWidth < 820);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Manual scroll tracking since useScroll needs the custom container
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () => {
      const rect = (sel: HTMLDivElement | null) => {
        if (!sel || !el) return 0;
        const elRect = el.getBoundingClientRect();
        const secRect = sel.getBoundingClientRect();
        const viewH = elRect.height;
        // How far through the section we've scrolled (0 = section just entering bottom, 1 = section leaving top)
        const raw = 1 - (secRect.top - elRect.top) / (viewH + secRect.height);
        return Math.max(0, Math.min(1, raw));
      };
      setFpVal(rect(floorPlanRef.current));
      setIfcVal(rect(ifcRef.current));
      setVrVal(rect(videoRenderRef.current));
    };
    el.addEventListener("scroll", update, { passive: true });
    update(); // initial
    return () => el.removeEventListener("scroll", update);
  }, []);

  // ── Data fetch ──
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/user/dashboard-stats", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error("API error"); return r.json(); })
      .then((d: DashboardData) => { if (d && typeof d.workflowCount === "number") setData(d); })
      .catch((err: Error) => { if (err.name !== "AbortError") toast.error("Could not load dashboard data", { duration: 4000 }); });
    const timeout = setTimeout(() => controller.abort(), 5000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  // ── Autoplay videos when section is in view ──
  useEffect(() => {
    const refs = videoRefs.current;
    if (videoInView) {
      DEMO_VIDEOS.forEach((d) => { const v = refs[d.id]; if (v) { v.currentTime = d.previewStart; v.play().catch(() => {}); } });
    } else {
      Object.values(refs).forEach((v) => { if (v) v.pause(); });
    }
  }, [videoInView]);

  // ── Theme: "light" is the Render Studio default. "dark" preserves the original. ──
  const [theme] = useState<"light" | "dark">("light");

  // ── Derived values ──
  const role = data.userRole ?? "FREE";
  const effectiveLimit = (PLAN_LIMITS[role] ?? 5) + (data.referralBonus ?? 0);
  const used = data.executionCount;

  // ── Open template in canvas ──
  const openTemplate = useCallback((templateId: string) => {
    const template = PREBUILT_WORKFLOWS.find((w) => w.id === templateId);
    if (!template) { router.push("/dashboard/canvas"); return; }
    loadFromTemplate(template as WorkflowTemplate);
    router.push("/dashboard/canvas");
  }, [loadFromTemplate, router]);

  // ── Video card data ──
  const videoCards = [
    { ...DEMO_VIDEOS[0], titleKey: "landing.demoVideo4Title" as TranslationKey, subKey: "landing.demoVideo4Subtitle" as TranslationKey, nodes: ["landing.demoVideo4Node1" as TranslationKey, "landing.demoVideo4Node2" as TranslationKey, "landing.demoVideo4Node3" as TranslationKey], duration: "0:45" },
    { ...DEMO_VIDEOS[2], titleKey: "landing.demoVideo1Title" as TranslationKey, subKey: "landing.demoVideo1Subtitle" as TranslationKey, nodes: ["landing.demoVideo1Node1" as TranslationKey, "landing.demoVideo1Node2" as TranslationKey, "landing.demoVideo1Node3" as TranslationKey], duration: "1:32" },
  ];

  // ── Scroll tracking for 3D world (dark theme only) ──
  const mainRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroScroll } = useScroll(
    theme === "dark" ? { target: heroRef, offset: ["start start", "end start"] } : undefined,
  );
  const heroOpacity = useTransform(heroScroll, [0, 0.7], [1, 0]);
  const heroScale = useTransform(heroScroll, [0, 0.7], [1, 0.96]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      scrollState.progress = max > 0 ? el.scrollTop / max : 0;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);


  // ═════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════════

  if (theme === "dark") {
    /* ────── DARK THEME — original markup preserved exactly ────── */
    return (
    <div style={{ height: "100%", overflow: "hidden", position: "relative" }}>
      {/* ═══ PERSISTENT 3D WORLD — Behind all content ═══ */}
      <div aria-hidden style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 0 }}>
        <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "#07070D" }} />}>
          <WorldCanvas />
        </Suspense>
      </div>

      {/* ═══ SCROLLABLE CONTENT — On top of 3D world ═══ */}
      <main ref={mainRef} className="db-scroll" style={{ position: "relative", zIndex: 1, height: "100%", overflowY: "auto", overflowX: "hidden" }}>

        {/* ═══════════════════════════════════════════════════════════════
            HERO — Split layout: text left · video right
            ═══════════════════════════════════════════════════════════════ */}
        <motion.section
          ref={heroRef}
          style={{ position: "relative", height: "100%", overflow: "hidden", opacity: heroOpacity, scale: heroScale }}
        >
          {/* Opaque backdrop */}
          <div style={{
            position: "absolute", inset: 0, zIndex: 0,
            background: `
              radial-gradient(ellipse 60% 55% at 72% 50%, rgba(6,182,212,0.08) 0%, transparent 60%),
              radial-gradient(ellipse 50% 45% at 25% 55%, rgba(168,85,247,0.05) 0%, transparent 55%),
              radial-gradient(ellipse 100% 80% at 50% 50%, #0a0d16 0%, #05070e 55%, #02030a 100%)
            `,
          }} />

          {/* Blueprint background */}
          <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
            <HeroBlueprintScene />
          </div>

          {/* Bottom fade */}
          <div style={{
            position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
            background: "linear-gradient(180deg, transparent 0%, transparent 82%, rgba(3,4,10,0.95) 100%)",
          }} />

          {/* ─── Split layout: text left (compact), video right (large) ─── */}
          <div
            style={{
              position: "relative", zIndex: 3,
              display: "grid",
              gridTemplateColumns: isMobileLayout ? "1fr" : "minmax(0, 0.8fr) minmax(0, 1.55fr)",
              alignItems: "center",
              gap: isMobileLayout ? 28 : "clamp(24px, 3vw, 48px)",
              padding: isMobileLayout
                ? "60px 22px 80px 22px"
                : "0 clamp(32px, 4vw, 72px)",
              height: "100%",
              overflowY: isMobileLayout ? "auto" : "visible",
            }}
          >
            {/* ── LEFT: Text content (compact) ── */}
            <div style={{ maxWidth: isMobileLayout ? "100%" : 440 }}>
              {/* Eyebrow badge */}
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15, duration: 0.7, ease }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  padding: "6px 14px 6px 10px", borderRadius: 999,
                  marginBottom: isMobileLayout ? 18 : 22,
                  background: "rgba(125,249,255,0.04)",
                  border: "1px solid rgba(125,249,255,0.12)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <span className="db-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#06b6d4", boxShadow: "0 0 12px #06b6d4", flexShrink: 0 }} />
                <span style={{
                  fontSize: isMobileLayout ? 9 : 10,
                  fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase",
                  color: "rgba(125,249,255,0.85)", fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  PROMPT → BIM MODEL · LIVE
                </span>
              </motion.div>

              {/* Welcome line */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28, duration: 0.7, ease }}
              >
                <span style={{
                  display: "block",
                  fontSize: 11, fontWeight: 400, letterSpacing: "0.18em", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.42)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  marginBottom: 6,
                }}>
                  {data.userName ? t("dash.welcomeBack") : ""}
                </span>
              </motion.div>

              {/* Display name */}
              <motion.h1
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.36, duration: 0.8, ease }}
                className="db-hero-name"
                style={{
                  fontSize: isMobileLayout
                    ? "clamp(30px, 8vw, 44px)"
                    : "clamp(30px, 3vw, 46px)",
                  fontWeight: 600,
                  letterSpacing: "-0.035em",
                  lineHeight: 1.04,
                  margin: "0 0 12px",
                  color: "#f5f7fb",
                  backgroundImage: "linear-gradient(110deg, #ffffff 10%, #7dd3fc 35%, #c4b5fd 60%, #ffffff 90%)",
                  backgroundSize: "200% 100%",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {data.userName || t("dash.welcomeNew")}
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6, ease }}
                style={{
                  fontSize: isMobileLayout ? 13 : 13.5,
                  color: "rgba(203,213,225,0.62)",
                  lineHeight: 1.55,
                  margin: isMobileLayout ? "0 0 20px" : "0 0 24px",
                  maxWidth: 420,
                  fontWeight: 400,
                  letterSpacing: "-0.003em",
                }}
              >
                The visual workflow studio for BIM. Compose pipelines that turn prompts, images, and IFC files into real building models.
              </motion.p>

              {/* Actions row */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.6, ease }}
                style={{
                  display: "flex", alignItems: "center",
                  gap: isMobileLayout ? 10 : 12, flexWrap: "wrap",
                }}
              >
                {/* PRIMARY — Templates (recommended path for new users) */}
                <Link
                  href="/dashboard/templates"
                  className="db-hero-cta db-hero-cta-primary"
                  style={{
                    position: "relative",
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: isMobileLayout ? "12px 22px" : "12px 22px",
                    borderRadius: 999,
                    background: "linear-gradient(110deg, #06b6d4 0%, #7dd3fc 50%, #a78bfa 100%)",
                    backgroundSize: "200% 100%",
                    color: "#04111a",
                    fontSize: isMobileLayout ? 12.5 : 13,
                    fontWeight: 700,
                    textDecoration: "none", letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    boxShadow: "0 0 0 1px rgba(125,249,255,0.35), 0 12px 32px -8px rgba(6,182,212,0.55), 0 24px 60px -18px rgba(167,139,250,0.45), inset 0 1px 0 rgba(255,255,255,0.5)",
                    border: "none",
                    transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s cubic-bezier(0.22, 1, 0.36, 1), background-position 0.6s ease",
                  }}
                >
                  <Sparkles size={14} strokeWidth={2.4} />
                  {t("dash.exploreTemplates")}
                  <ArrowRight size={14} strokeWidth={2.6} />
                </Link>

                {/* SECONDARY — Start from scratch (advanced users) */}
                <Link
                  href="/dashboard/canvas?new=1"
                  className="db-hero-cta"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: isMobileLayout ? "11px 16px" : "11px 18px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    color: "rgba(226,232,240,0.85)",
                    fontSize: isMobileLayout ? 11.5 : 12,
                    fontWeight: 600,
                    textDecoration: "none", letterSpacing: "0.01em",
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(10px)",
                    transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  {t("dash.startFromScratch")}
                </Link>
              </motion.div>

              {/* Metric strip */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85, duration: 0.6, ease }}
                style={{
                  marginTop: isMobileLayout ? 22 : 26,
                  display: isMobileLayout ? "grid" : "flex",
                  ...(isMobileLayout
                    ? { gridTemplateColumns: "repeat(2, 1fr)", rowGap: 14, columnGap: 12 }
                    : { alignItems: "center", gap: 18, flexWrap: "wrap" }),
                  paddingTop: 16,
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {(() => {
                  const levelPct = Math.max(0, Math.min(1, data.xpForNext > 0 ? (data.xpInLevel / data.xpForNext) : (data.progress ?? 0)));
                  const execPct = Math.max(0, Math.min(1, effectiveLimit > 0 ? used / effectiveLimit : 0));
                  const stats: Array<{
                    label: string; value: React.ReactNode; color: string; icon: React.ReactNode;
                    extra?: React.ReactNode;
                  }> = [
                    { label: "PLAN",       value: role,               color: role === "FREE" ? "#7dd3fc" : "#a78bfa", icon: <Crown size={12} /> },
                    { label: "WORKFLOWS",  value: data.workflowCount, color: "#4F8AFF", icon: <Layers size={12} /> },
                    {
                      label: "EXECUTIONS",
                      value: `${used}/${effectiveLimit}`,
                      color: "#8B5CF6",
                      icon: <Zap size={12} />,
                      extra: (
                        <div style={{ marginTop: 4, width: 60, height: 2.5, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <div style={{ width: `${execPct * 100}%`, height: "100%", background: "linear-gradient(90deg, #8B5CF6, #c4b5fd)", boxShadow: "0 0 8px rgba(139,92,246,0.6)", transition: "width 0.6s ease" }} />
                        </div>
                      ),
                    },
                    { label: "LEVEL",      value: data.level,         color: "#10B981", icon: <Trophy size={12} /> },
                  ];
                  return stats.map((m) => {
                    const isLevel = m.label === "LEVEL";
                    return (
                      <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isLevel ? (
                          <div style={{ position: "relative", width: 32, height: 32, flexShrink: 0 }}>
                            <svg width="32" height="32" viewBox="0 0 32 32" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
                              <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
                              <circle
                                cx="16" cy="16" r="13" fill="none"
                                stroke="url(#db-level-grad)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeDasharray={2 * Math.PI * 13}
                                strokeDashoffset={2 * Math.PI * 13 * (1 - levelPct)}
                                style={{ transition: "stroke-dashoffset 0.8s ease", filter: "drop-shadow(0 0 6px rgba(16,185,129,0.55))" }}
                              />
                              <defs>
                                <linearGradient id="db-level-grad" x1="0" x2="1" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#10B981" />
                                  <stop offset="100%" stopColor="#7dd3fc" />
                                </linearGradient>
                              </defs>
                            </svg>
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 800, color: "#F0F2F8", fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "-0.02em" }}>
                              {data.level}
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: `linear-gradient(135deg, ${m.color}22, ${m.color}08)`,
                            border: `1px solid ${m.color}33`,
                            color: m.color,
                            boxShadow: `0 0 18px ${m.color}26, inset 0 1px 0 rgba(255,255,255,0.06)`,
                          }}>
                            {m.icon}
                          </div>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{
                            fontSize: 8.5, letterSpacing: "0.18em",
                            color: "rgba(255,255,255,0.42)",
                            fontFamily: "var(--font-jetbrains), monospace",
                          }}>
                            {m.label}
                          </span>
                          <span style={{
                            fontSize: 13, fontWeight: 700,
                            color: m.color,
                            fontFamily: "var(--font-jetbrains), monospace",
                            letterSpacing: "-0.01em",
                            textShadow: `0 0 18px ${m.color}55`,
                          }}>
                            {m.value}
                          </span>
                          {m.extra}
                        </div>
                      </div>
                    );
                  });
                })()}
              </motion.div>
            </div>

            {/* ── RIGHT: Video player — dominant, auto-playing ── */}
            <motion.div
              initial={{ opacity: 0, x: 32, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 0.5, duration: 1, ease }}
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                maxHeight: isMobileLayout ? "auto" : "min(84vh, 840px)",
                borderRadius: isMobileLayout ? 14 : 22,
                overflow: "hidden",
                position: "relative",
                background: "#05070e",
                border: "1px solid rgba(125, 249, 255, 0.22)",
                boxShadow: [
                  "0 56px 120px rgba(0, 0, 0, 0.7)",
                  "0 20px 48px rgba(0, 0, 0, 0.45)",
                  "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                  "0 0 140px rgba(6, 182, 212, 0.24)",
                  "0 0 260px rgba(168, 85, 247, 0.1)",
                ].join(", "),
                justifySelf: isMobileLayout ? "stretch" : "end",
              }}
            >
              {/* Top accent line */}
              <div style={{
                position: "absolute", top: 0, left: "10%", right: "10%", height: 1, zIndex: 2, pointerEvents: "none",
                background: "linear-gradient(90deg, transparent 0%, rgba(125,249,255,0.7) 50%, transparent 100%)",
              }} />

              {/* Video — autoPlay + muted for guaranteed browser autoplay */}
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                src={`${R2}/dashboard-video.mp4`}
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover",
                }}
              />

              {/* Inner edge glow */}
              <div style={{
                position: "absolute", inset: 0, borderRadius: isMobileLayout ? 14 : 22, pointerEvents: "none",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
              }} />

              {/* Corner tick marks — all four corners */}
              <svg style={{ position: "absolute", top: 12, left: 12, width: 22, height: 22, opacity: 0.7, pointerEvents: "none" }} viewBox="0 0 22 22" fill="none">
                <path d="M0,0 L0,8 M0,0 L8,0" stroke="rgba(125,249,255,0.9)" strokeWidth="1.2" />
              </svg>
              <svg style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, opacity: 0.7, pointerEvents: "none" }} viewBox="0 0 22 22" fill="none">
                <path d="M22,0 L22,8 M22,0 L14,0" stroke="rgba(125,249,255,0.9)" strokeWidth="1.2" />
              </svg>
              <svg style={{ position: "absolute", bottom: 12, left: 12, width: 22, height: 22, opacity: 0.7, pointerEvents: "none" }} viewBox="0 0 22 22" fill="none">
                <path d="M0,22 L0,14 M0,22 L8,22" stroke="rgba(125,249,255,0.9)" strokeWidth="1.2" />
              </svg>
              <svg style={{ position: "absolute", bottom: 12, right: 12, width: 22, height: 22, opacity: 0.7, pointerEvents: "none" }} viewBox="0 0 22 22" fill="none">
                <path d="M22,22 L22,14 M22,22 L14,22" stroke="rgba(125,249,255,0.9)" strokeWidth="1.2" />
              </svg>
            </motion.div>
          </div>

          {/* ── Scroll indicator ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none" }}
          >
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: "var(--font-jetbrains), monospace" }}>
              {t("dash.scrollExplore")}
            </span>
            <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}>
              <ChevronDown size={14} style={{ color: "rgba(125,249,255,0.5)" }} />
            </motion.div>
          </motion.div>
        </motion.section>

        {/* ═══════════════════════════════════════════════════════════════
            FEATURE SHOWCASE — Full-width cinematic sections
            ═══════════════════════════════════════════════════════════════ */}
        <section style={{ position: "relative", padding: "48px 0 60px", background: "linear-gradient(180deg, rgba(7,7,13,0.85) 0%, rgba(7,7,13,0.6) 50%, rgba(7,7,13,0.85) 100%)", backdropFilter: "blur(4px)" }}>
          {/* Section header */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
            transition={{ duration: 0.7, ease }}
            style={{ textAlign: "center", marginBottom: 80, padding: "0 32px" }}
          >
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 16px", borderRadius: 24, marginBottom: 20,
              background: "rgba(0,245,255,0.06)", border: "1px solid rgba(0,245,255,0.12)",
              fontSize: 10, fontWeight: 700, color: "#00F5FF", letterSpacing: "0.15em",
            }}>
              <Play size={10} /> {t("dash.seeItInAction")}
            </span>
            <h2 style={{ fontSize: "clamp(28px, 4.5vw, 48px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.1, marginBottom: 16 }}>
              <span className="db-shimmer-text">{t("dash.impactLine")}</span>
            </h2>
            <p style={{ fontSize: 16, color: "#6B7A8D", maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
              {t("dash.impactSub")}
            </p>
          </motion.div>

          {/* Feature cards — full-width alternating layout */}
          <div ref={videoSectionRef} style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px", display: "flex", flexDirection: "column", gap: 48 }}>
            {videoCards.map((vc, i) => {
              const isReversed = i % 2 === 1;
              return (
                <motion.div
                  key={vc.id}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-80px" }}
                  variants={fadeIn}
                  transition={{ duration: 0.6, delay: 0.1, ease }}
                  onClick={() => openTemplate(VIDEO_TO_TEMPLATE[vc.id] ?? "wf-03")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") openTemplate(VIDEO_TO_TEMPLATE[vc.id] ?? "wf-03"); }}
                  className="db-feature-card"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    direction: isReversed ? "rtl" : "ltr",
                    gap: 0,
                    borderRadius: 24, overflow: "hidden",
                    background: "linear-gradient(135deg, rgba(14,16,28,0.95), rgba(10,12,20,0.98))",
                    border: `1px solid rgba(${vc.rgb}, 0.15)`,
                    cursor: "pointer",
                    transition: "all 400ms cubic-bezier(0.22, 1, 0.36, 1)",
                    boxShadow: `0 8px 40px rgba(0,0,0,0.35), 0 0 80px rgba(${vc.rgb}, 0.03)`,
                    position: "relative",
                  }}
                >
                  {/* Top accent line */}
                  <div style={{ position: "absolute", top: 0, left: "10%", right: "10%", height: 1, background: `linear-gradient(90deg, transparent, rgba(${vc.rgb}, 0.3), transparent)`, zIndex: 2, pointerEvents: "none" }} />

                  {/* Video side */}
                  <div style={{
                    direction: "ltr", position: "relative", minHeight: 320, overflow: "hidden",
                    background: `radial-gradient(ellipse at center, rgba(${vc.rgb}, 0.08) 0%, transparent 70%)`,
                  }}>
                    <video
                      ref={(el) => { videoRefs.current[vc.id] = el; }}
                      src={vc.url}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(e) => { e.currentTarget.currentTime = vc.previewStart; }}
                      onEnded={(e) => { const v = e.currentTarget; v.currentTime = vc.previewStart; v.play().catch(() => {}); }}
                      className="db-feature-video"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", position: "absolute", inset: 0, transition: "transform 0.6s cubic-bezier(0.22,1,0.36,1)" }}
                    />
                    {/* Duration badge */}
                    <div style={{
                      position: "absolute", top: 14, right: 14, padding: "5px 12px", borderRadius: 10, zIndex: 2,
                      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)",
                      border: `1px solid rgba(${vc.rgb}, 0.2)`,
                      fontSize: 11, color: vc.color, fontFamily: "var(--font-jetbrains), monospace",
                    }}>
                      {vc.duration}
                    </div>
                  </div>

                  {/* Content side */}
                  <div style={{ direction: "ltr", padding: "40px 40px", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", background: "rgba(10,12,20,0.98)" }}>
                    {/* Category badge */}
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start",
                      padding: "4px 12px", borderRadius: 8, marginBottom: 16,
                      background: `rgba(${vc.rgb}, 0.1)`, border: `1px solid rgba(${vc.rgb}, 0.25)`,
                      boxShadow: `0 0 12px rgba(${vc.rgb}, 0.08)`,
                    }}>
                      <Play size={9} style={{ color: vc.color }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: vc.color, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        {i === 0 ? "VISUALIZATION" : "CONCEPT DESIGN"}
                      </span>
                    </div>

                    <h3 style={{ fontSize: "clamp(22px, 2.5vw, 30px)", fontWeight: 800, color: "#F0F2F8", letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 10 }}>
                      {t(vc.titleKey)}
                    </h3>
                    <p style={{ fontSize: 14, color: vc.color, fontWeight: 600, marginBottom: 22 }}>
                      {t(vc.subKey)}
                    </p>

                    {/* Pipeline tags */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
                      {vc.nodes.map((nk, ni) => (
                        <React.Fragment key={nk}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, color: "#A0A8C0",
                            padding: "5px 14px", borderRadius: 8,
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                            fontFamily: "var(--font-jetbrains), monospace", textTransform: "uppercase", letterSpacing: "0.04em",
                          }}>
                            {t(nk)}
                          </span>
                          {ni < vc.nodes.length - 1 && <span style={{ fontSize: 11, color: `rgba(${vc.rgb}, 0.5)` }}>→</span>}
                        </React.Fragment>
                      ))}
                    </div>

                    <div className="db-feature-cta" style={{
                      display: "inline-flex", alignItems: "center", gap: 10, alignSelf: "flex-start",
                      padding: "12px 26px", borderRadius: 14,
                      background: `linear-gradient(135deg, rgba(${vc.rgb}, 0.15), rgba(${vc.rgb}, 0.06))`,
                      border: `1px solid rgba(${vc.rgb}, 0.3)`,
                      color: "#fff", fontSize: 13, fontWeight: 700,
                      fontFamily: "var(--font-jetbrains), monospace", letterSpacing: "0.02em",
                      transition: "all 0.3s ease",
                      boxShadow: `0 0 20px rgba(${vc.rgb}, 0.06)`,
                    }}>
                      {t("dash.tryThisWorkflow")} <ArrowRight size={15} style={{ color: vc.color }} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            EXPLORE TEMPLATES CTA + BOOK DEMO
            ═══════════════════════════════════════════════════════════════ */}
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          variants={fadeIn} transition={{ duration: 0.6, ease }}
          style={{ textAlign: "center", padding: "48px 32px 56px", display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}
        >
          <Link
            href="/dashboard/templates"
            className="db-hero-cta"
            style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              padding: "14px 36px", borderRadius: 16,
              background: "rgba(6,182,212,0.06)",
              border: "1px solid rgba(6,182,212,0.2)",
              color: "#e2e8f0", fontSize: 15, fontWeight: 700,
              textDecoration: "none", letterSpacing: "0.01em",
              backdropFilter: "blur(12px)",
              transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {t("dash.viewAll")} <ArrowRight size={16} />
          </Link>
          {/* Book a Demo — companion CTA for users who want a guided walkthrough
              instead of exploring templates on their own. Styled distinctly so
              it reads as a second option, not a duplicate of View All. */}
          <Link
            href="/book-demo"
            style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              padding: "14px 32px", borderRadius: 16,
              background: "linear-gradient(135deg, rgba(79,138,255,0.14), rgba(99,102,241,0.1))",
              border: "1px solid rgba(79,138,255,0.35)",
              color: "#C7D2FE", fontSize: 15, fontWeight: 700,
              textDecoration: "none", letterSpacing: "0.01em",
              backdropFilter: "blur(12px)",
              boxShadow: "0 0 20px rgba(79,138,255,0.1)",
              transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <Calendar size={15} /> {t("dash.bookDemo")}
          </Link>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            FLAGSHIP: AI FLOOR PLAN EDITOR
            ═══════════════════════════════════════════════════════════════ */}
        <section
          ref={floorPlanRef}
          style={{
            position: "relative", minHeight: "80vh",
            display: "grid", gridTemplateColumns: "45% 55%",
            alignItems: "center",
            background: "linear-gradient(180deg, rgba(7,7,13,0.8) 0%, rgba(7,7,13,0.5) 50%, rgba(7,7,13,0.8) 100%)",
            overflow: "hidden",
          }}
          className="db-showcase-section"
        >
          {/* Text content — LEFT */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            style={{ padding: "60px 48px 60px 64px" }}
          >
            <motion.div variants={fadeIn} transition={{ duration: 0.6, ease }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 14px", borderRadius: 20, marginBottom: 20,
                background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)",
                fontSize: 9, fontWeight: 700, color: "#06b6d4", letterSpacing: "0.15em",
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                {t("dash.flagshipFeature")}
              </span>
            </motion.div>

            <motion.h2 variants={fadeIn} transition={{ duration: 0.6, delay: 0.1, ease }} style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1, marginBottom: 14 }}>
              {t("dash.fpTitle")}
            </motion.h2>

            <motion.p variants={fadeIn} transition={{ duration: 0.6, delay: 0.2, ease }} style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 32, maxWidth: 380 }}>
              {t("dash.fpSubtitle")}
            </motion.p>

            <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.3, ease }} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 36 }}>
              {(["dash.fpBullet1", "dash.fpBullet2", "dash.fpBullet3", "dash.fpBullet4"] as const).map((key, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#06b6d4", boxShadow: "0 0 10px rgba(6,182,212,0.5)", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{t(key)}</span>
                </div>
              ))}
            </motion.div>

            <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.4, ease }}>
              <Link
                href="/dashboard/floor-plan"
                className="db-hero-cta"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "12px 26px", borderRadius: 14,
                  background: "rgba(6,182,212,0.08)",
                  border: "1px solid rgba(6,182,212,0.25)",
                  color: "#e2e8f0", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                  transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                {t("dash.fpCta")} <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>

          {/* 3D Scene — RIGHT */}
          <div style={{ height: "100%", minHeight: 500, position: "relative" }}>
            <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "#07070D" }} />}>
              <FloorPlanScene progress={fpVal} />
            </Suspense>
            {/* Fade edges into background */}
            <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "15%", background: "linear-gradient(90deg, rgba(7,7,13,0.8), transparent)", pointerEvents: "none" }} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            FLAGSHIP: IFC VIEWER
            ═══════════════════════════════════════════════════════════════ */}
        <section
          ref={ifcRef}
          style={{
            position: "relative", minHeight: "80vh",
            display: "grid", gridTemplateColumns: "55% 45%",
            alignItems: "center",
            background: "linear-gradient(180deg, rgba(7,7,13,0.5) 0%, rgba(7,7,13,0.3) 50%, rgba(7,7,13,0.5) 100%)",
            overflow: "hidden",
          }}
          className="db-showcase-section"
        >
          {/* 3D Scene — LEFT */}
          <div style={{ height: "100%", minHeight: 500, position: "relative" }}>
            <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "#07070D" }} />}>
              <IFCViewerScene progress={ifcVal} />
            </Suspense>
            {/* Fade right edge */}
            <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "15%", background: "linear-gradient(270deg, rgba(7,7,13,0.8), transparent)", pointerEvents: "none" }} />
          </div>

          {/* Text content — RIGHT */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            style={{ padding: "60px 64px 60px 48px" }}
          >
            <motion.div variants={fadeIn} transition={{ duration: 0.6, ease }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 14px", borderRadius: 20, marginBottom: 20,
                background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)",
                fontSize: 9, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.15em",
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                {t("dash.flagshipFeature")}
              </span>
            </motion.div>

            <motion.h2 variants={fadeIn} transition={{ duration: 0.6, delay: 0.1, ease }} style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1, marginBottom: 14 }}>
              {t("dash.ifcTitle")}
            </motion.h2>

            <motion.p variants={fadeIn} transition={{ duration: 0.6, delay: 0.2, ease }} style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 32, maxWidth: 380 }}>
              {t("dash.ifcSubtitle")}
            </motion.p>

            <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.3, ease }} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 36 }}>
              {(["dash.ifcBullet1", "dash.ifcBullet2", "dash.ifcBullet3", "dash.ifcBullet4"] as const).map((key, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 10px rgba(168,85,247,0.5)", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{t(key)}</span>
                </div>
              ))}
            </motion.div>

            <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.4, ease }}>
              <Link
                href="/dashboard/ifc-viewer"
                className="db-hero-cta"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "12px 26px", borderRadius: 14,
                  background: "rgba(139,92,246,0.08)",
                  border: "1px solid rgba(139,92,246,0.25)",
                  color: "#e2e8f0", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                  transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                {t("dash.ifcCta")} <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            FLAGSHIP: 3D VIDEO RENDER
            ═══════════════════════════════════════════════════════════════ */}
        <section
          ref={videoRenderRef}
          style={{
            position: "relative", minHeight: "80vh",
            display: "grid", gridTemplateColumns: "45% 55%",
            alignItems: "center",
            background: "linear-gradient(180deg, rgba(7,7,13,0.8) 0%, rgba(7,7,13,0.5) 50%, rgba(7,7,13,0.8) 100%)",
            overflow: "hidden",
          }}
          className="db-showcase-section"
        >
          {/* Text content — LEFT */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            style={{ padding: "60px 48px 60px 64px" }}
          >
            <motion.div variants={fadeIn} transition={{ duration: 0.6, ease }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 14px", borderRadius: 20, marginBottom: 20,
                background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)",
                fontSize: 9, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.15em",
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                {t("dash.flagshipFeature")}
              </span>
            </motion.div>

            <motion.h2 variants={fadeIn} transition={{ duration: 0.6, delay: 0.1, ease }} style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1, marginBottom: 14 }}>
              {t("dash.vrTitle")}
            </motion.h2>

            <motion.p variants={fadeIn} transition={{ duration: 0.6, delay: 0.2, ease }} style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 32, maxWidth: 380 }}>
              {t("dash.vrSubtitle")}
            </motion.p>

            <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.3, ease }} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 36 }}>
              {(["dash.vrBullet1", "dash.vrBullet2", "dash.vrBullet3", "dash.vrBullet4"] as const).map((key, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 10px rgba(245,158,11,0.55)", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{t(key)}</span>
                </div>
              ))}
            </motion.div>

            <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.4, ease }}>
              <Link
                href="/dashboard/3d-render"
                className="db-hero-cta"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "12px 26px", borderRadius: 14,
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.28)",
                  color: "#e2e8f0", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                  transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                {t("dash.vrCta")} <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>

          {/* 3D Scene — RIGHT */}
          <div style={{ height: "100%", minHeight: 500, position: "relative" }}>
            <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "#07070D" }} />}>
              <VideoRenderScene progress={vrVal} />
            </Suspense>
            {/* Fade left edge into background */}
            <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "15%", background: "linear-gradient(90deg, rgba(7,7,13,0.8), transparent)", pointerEvents: "none" }} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            NODE SHOWCASE — Dramatic grid
            ═══════════════════════════════════════════════════════════════ */}
        <section style={{ padding: "80px 0", position: "relative", background: "linear-gradient(180deg, rgba(7,7,13,0.6) 0%, rgba(7,7,13,0.45) 50%, rgba(7,7,13,0.6) 100%)" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px" }}>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={fadeIn} transition={{ duration: 0.7, ease }} style={{ textAlign: "center", marginBottom: 48 }}>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", marginBottom: 10 }}>
                {t("dash.nodesTitle")}
              </h2>
              <p style={{ fontSize: 15, color: "#6B7A8D", maxWidth: 500, margin: "0 auto", lineHeight: 1.7 }}>
                {t("dash.nodesSub")}
              </p>
            </motion.div>

            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }} className="db-node-grid">
                {NODE_TYPES.map((node, i) => (
                  <motion.div key={node.name} variants={fadeIn} transition={{ duration: 0.4, delay: i * 0.04, ease }}>
                    <div className="db-node-card" style={{
                      padding: "24px 16px", borderRadius: 16,
                      background: `${node.color}06`, border: `1px solid ${node.color}15`,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                      textAlign: "center", cursor: "default",
                      transition: "all 350ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: `${node.color}10`, border: `1px solid ${node.color}25`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: node.color, transition: "all 0.3s ease",
                      }}>
                        {node.icon}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0", lineHeight: 1.3 }}>{node.name}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: node.color, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: "var(--font-jetbrains), monospace" }}>{node.cat}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            TRANSFORMATION — Old Way vs New Way
            ═══════════════════════════════════════════════════════════════ */}
        <section style={{ padding: "80px 0", background: "rgba(7,7,13,0.75)", backdropFilter: "blur(4px)" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 32px" }}>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={stagger}>
              <motion.div variants={fadeIn} transition={{ duration: 0.7, ease }} style={{ textAlign: "center", marginBottom: 48 }}>
                <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em" }}>
                  {t("dash.problemTitle")}
                </h2>
              </motion.div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }} className="db-comparison-grid">
                {/* Old Way */}
                <motion.div variants={fadeIn} transition={{ duration: 0.6, ease }}>
                  <div style={{ padding: "28px 28px 28px 32px", borderRadius: 20, background: "rgba(239,68,68,0.03)", border: "1px solid rgba(239,68,68,0.08)", backdropFilter: "blur(16px)", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, borderRadius: "0 4px 4px 0", background: "linear-gradient(180deg, #EF4444, rgba(239,68,68,0.2))" }} />
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#EF4444", letterSpacing: "0.15em", marginBottom: 24, fontFamily: "var(--font-jetbrains), monospace" }}>{t("dash.oldWay")}</div>
                    {[t("dash.pain1"), t("dash.pain2"), t("dash.pain3"), t("dash.pain4")].map((pain, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                        <X size={15} style={{ color: "#EF4444", flexShrink: 0 }} />
                        <span style={{ fontSize: 14, color: "#6B7A8D", textDecoration: "line-through", textDecorationColor: "rgba(239,68,68,0.4)" }}>{pain}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* New Way */}
                <motion.div variants={fadeIn} transition={{ duration: 0.6, delay: 0.15, ease }}>
                  <div style={{ padding: "28px 28px 28px 32px", borderRadius: 20, background: "rgba(16,185,129,0.03)", border: "1px solid rgba(16,185,129,0.08)", backdropFilter: "blur(16px)", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, borderRadius: "0 4px 4px 0", background: "linear-gradient(180deg, #10B981, rgba(16,185,129,0.2))", boxShadow: "0 0 16px rgba(16,185,129,0.2)" }} />
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#10B981", letterSpacing: "0.15em", marginBottom: 24, fontFamily: "var(--font-jetbrains), monospace" }}>{t("dash.newWay")}</div>
                    {[t("dash.fix1"), t("dash.fix2"), t("dash.fix3"), t("dash.fix4")].map((fix, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                        <Zap size={15} style={{ color: "#10B981", flexShrink: 0 }} />
                        <span style={{ fontSize: 14, color: "#E2E8F0", fontWeight: 500 }}>{fix}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            CTA — Bold final push
            ═══════════════════════════════════════════════════════════════ */}
        <section className="px-4 sm:px-8 py-16 sm:py-20">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeIn} transition={{ duration: 0.7, ease }}
            className="px-5 py-10 sm:px-10 sm:py-16"
            style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", borderRadius: 28, position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(79,138,255,0.05), rgba(139,92,246,0.04))", border: "1px solid rgba(79,138,255,0.1)" }}
          >
            <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(79,138,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(79,138,255,0.02) 1px, transparent 1px)", backgroundSize: "32px 32px", pointerEvents: "none" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <h2 style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", marginBottom: 12 }}>
                {t("dash.readyToBuild")}
              </h2>
              <p style={{ fontSize: 16, color: "#6B7A8D", marginBottom: 32, lineHeight: 1.7 }}>
                {t("dash.readyDesc")}
              </p>
              <Link
                href="/dashboard/templates"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  padding: "14px 32px", borderRadius: 16,
                  background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
                  color: "#fff", fontSize: 15, fontWeight: 800,
                  textDecoration: "none", letterSpacing: "-0.01em",
                  boxShadow: "0 4px 32px rgba(79,138,255,0.35), 0 0 80px rgba(99,102,241,0.1)",
                  transition: "all 0.3s ease",
                }}
                className="db-cta-primary"
              >
                <Sparkles size={16} /> {t("dash.exploreTemplates")} <ArrowRight size={18} />
              </Link>
            </div>
          </motion.div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            RECENT ACTIVITY
            ═══════════════════════════════════════════════════════════════ */}
        {(data.recentWorkflows ?? []).length > 0 && (
          <section className="pb-20 sm:pb-20">
            <div style={{ maxWidth: 1100, margin: "0 auto" }} className="px-4 sm:px-8">
              <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
                <motion.div variants={fadeIn} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <h3 className="text-base sm:text-xl" style={{ fontWeight: 800, color: "#EDF2F7", letterSpacing: "-0.02em" }}>
                    {t("dash.recentActivity")}
                  </h3>
                  <Link href="/dashboard/workflows" style={{ fontSize: 13, fontWeight: 600, color: "#4F8AFF", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0 }}>
                    {t("dash.allWorkflows")} <ChevronRight size={14} />
                  </Link>
                </motion.div>

                <div className="db-recent-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                  {(data.recentWorkflows ?? []).map((wf, i) => (
                    <motion.div key={wf.id} variants={fadeIn} transition={{ duration: 0.4, delay: i * 0.06, ease }}>
                      <Link href={`/dashboard/canvas?id=${wf.id}`} className="db-glass-card" style={{ display: "block", background: "rgba(12,14,24,0.6)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, overflow: "hidden", textDecoration: "none", transition: "all 350ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
                        <div className="p-3 sm:px-[18px] sm:py-[14px]" style={{ background: "linear-gradient(135deg, rgba(79,138,255,0.05), rgba(99,102,241,0.02))", borderBottom: "1px solid rgba(79,138,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <FileText size={14} style={{ color: "#4F8AFF" }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#EDF2F7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wf.name}</div>
                          </div>
                        </div>
                        <div className="px-3 py-2.5 sm:px-[18px] sm:py-3" style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <span style={{ fontSize: 11, color: "#718096", display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-jetbrains), monospace" }}>
                            <Zap size={10} style={{ color: "#4F8AFF" }} /> {wf.nodeCount} {t("dash.nodes")}
                          </span>
                          <span style={{ fontSize: 11, color: "#718096", display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-jetbrains), monospace" }}>
                            <Play size={9} style={{ color: "#10B981" }} /> {wf.executionCount} {t("dash.runs")}
                          </span>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>
        )}

        {/* Bottom spacer */}
        <div style={{ height: 40 }} />
      </main>

      {/* ═══════════════════════════════════════════════════════════════
          VISUAL EFFECTS SYSTEM
          ═══════════════════════════════════════════════════════════════ */}
      <style jsx global>{`
        /* ── Smooth scrollbar ── */
        .db-scroll { scroll-behavior: smooth; }
        .db-scroll::-webkit-scrollbar { width: 6px; }
        .db-scroll::-webkit-scrollbar-track { background: transparent; }
        .db-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
        .db-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }

        /* ── Hero CTA — gradient border glow ── */
        .db-hero-cta:hover {
          background: rgba(6,182,212,0.14) !important;
          border-color: rgba(6,182,212,0.5) !important;
          box-shadow: 0 0 30px rgba(6,182,212,0.25), 0 0 60px rgba(168,85,247,0.1) !important;
          transform: translateY(-2px) scale(1.03) !important;
          color: #fff !important;
        }
        .db-hero-cta { animation: db-cta-breathe 3s ease-in-out infinite; }
        @keyframes db-cta-breathe {
          0%, 100% { box-shadow: 0 0 8px rgba(6,182,212,0.1); }
          50% { box-shadow: 0 0 20px rgba(6,182,212,0.18), 0 0 40px rgba(168,85,247,0.06); }
        }

        /* ── Primary hero CTA (gradient + animated glow) ── */
        .db-hero-cta-primary {
          background-position: 0% 50% !important;
          animation: db-cta-shine 6s ease-in-out infinite !important;
        }
        .db-hero-cta-primary:hover {
          background: linear-gradient(110deg, #06b6d4 0%, #7dd3fc 50%, #a78bfa 100%) !important;
          background-size: 200% 100% !important;
          background-position: 100% 50% !important;
          border-color: transparent !important;
          color: #04111a !important;
          transform: translateY(-2px) scale(1.03) !important;
          box-shadow:
            0 0 0 1px rgba(125,249,255,0.55),
            0 16px 40px -8px rgba(6,182,212,0.7),
            0 28px 70px -16px rgba(167,139,250,0.55),
            inset 0 1px 0 rgba(255,255,255,0.6) !important;
        }
        @keyframes db-cta-shine {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        /* ── LIVE pulse dot ── */
        .db-live-dot {
          position: relative;
          animation: db-live-pulse 2s ease-in-out infinite;
        }
        .db-live-dot::after {
          content: "";
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 1px solid rgba(6,182,212,0.6);
          animation: db-live-ring 2s ease-out infinite;
        }
        @keyframes db-live-pulse {
          0%, 100% { box-shadow: 0 0 8px #06b6d4, 0 0 0 0 rgba(6,182,212,0.5); opacity: 1; }
          50% { box-shadow: 0 0 16px #06b6d4, 0 0 0 4px rgba(6,182,212,0); opacity: 0.85; }
        }
        @keyframes db-live-ring {
          0% { transform: scale(0.8); opacity: 0.9; }
          100% { transform: scale(2.2); opacity: 0; }
        }

        /* ── Hero name shimmer ── */
        .db-hero-name {
          animation: db-name-shimmer 9s ease-in-out infinite;
        }
        @keyframes db-name-shimmer {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        /* ── Section CTA (bottom of page) ── */
        .db-cta-primary { position: relative; overflow: hidden; }
        .db-cta-primary:hover {
          transform: translateY(-2px) scale(1.02) !important;
          box-shadow: 0 8px 40px rgba(79,138,255,0.4), 0 0 80px rgba(99,102,241,0.15) !important;
        }

        /* ── Feature cards ── */
        .db-feature-card:hover {
          transform: translateY(-6px) !important;
          box-shadow: 0 24px 80px rgba(0,0,0,0.45), 0 0 60px rgba(79,138,255,0.06) !important;
          border-color: rgba(79,138,255,0.22) !important;
        }
        .db-feature-card:hover .db-feature-video {
          transform: scale(1.04);
        }
        .db-feature-card:hover .db-feature-cta {
          box-shadow: 0 0 32px rgba(79,138,255,0.15) !important;
          transform: translateY(-1px);
        }

        /* ── Glass card hover ── */
        .db-glass-card {
          position: relative;
        }
        .db-glass-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          opacity: 0;
          transition: opacity 0.4s ease;
          background: linear-gradient(135deg, rgba(79,138,255,0.05), rgba(139,92,246,0.03));
          pointer-events: none;
          z-index: 0;
        }
        .db-glass-card:hover::before { opacity: 1; }
        .db-glass-card:hover {
          transform: translateY(-5px) !important;
          box-shadow: 0 20px 50px rgba(0,0,0,0.35), 0 0 30px rgba(79,138,255,0.05) !important;
          border-color: rgba(79,138,255,0.15) !important;
        }

        /* ── Node card hover ── */
        .db-node-card:hover {
          transform: translateY(-6px) scale(1.03) !important;
          box-shadow: 0 16px 40px rgba(0,0,0,0.3) !important;
        }

        /* ── Shimmer text ── */
        .db-shimmer-text {
          background: linear-gradient(90deg, #F0F0F5 0%, #06B6D4 35%, #8B5CF6 65%, #F0F0F5 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: db-shimmer 5s linear infinite;
        }
        @keyframes db-shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }

        /* ── Hero overlay — deterministic mobile layout (avoids SSR→hydration flash
             where content briefly appears vertically centered before JS kicks in
             and flips to top-aligned). CSS matches the JS breakpoint (<820px). ── */
        @media (max-width: 819px) {
          .db-hero-overlay {
            align-items: flex-start !important;
            padding: 78px 22px 80px 22px !important;
            overflow-y: auto !important;
          }
          .db-hero-left {
            width: 100% !important;
          }
        }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .db-feature-card {
            grid-template-columns: 1fr !important;
            direction: ltr !important;
          }
          .db-feature-card > div:first-child {
            min-height: 200px !important;
          }
          .db-showcase-section {
            grid-template-columns: 1fr !important;
            min-height: auto !important;
          }
          .db-showcase-section > div:first-child {
            min-height: 400px !important;
          }
          .db-node-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .db-comparison-grid {
            grid-template-columns: 1fr !important;
          }
          .db-recent-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .db-showcase-section {
            grid-template-columns: 1fr 1fr !important;
          }
          .db-node-grid {
            grid-template-columns: repeat(3, 1fr) !important;
          }
        }
      `}</style>
    </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     LIGHT THEME — Render Studio design system (Phase Z.2.1)
     ══════════════════════════════════════════════════════════════════════ */

  const firstName = data.userName?.split(" ")[0] || "there";
  const planLabel = role === "PLATFORM_ADMIN" ? "Admin" : role === "TEAM_ADMIN" ? "Team" : role.charAt(0) + role.slice(1).toLowerCase();
  const outputsCount = (data.recentOutputs ?? []).length;

  function formatDateTime(d: Date): string {
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${weekday} \u00b7 ${time}`;
  }

  function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "Just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const days = Math.floor(hr / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  }

  function getStatusLabel(status: string): string {
    if (status === "SUCCESS" || status === "PARTIAL") return "Done";
    if (status === "RUNNING" || status === "PENDING") return "Running";
    return "Failed";
  }

  function getActivityVerb(category: string | null): string {
    if (!category) return "Ran workflow";
    const c = category.toLowerCase();
    if (c.includes("floor") || c.includes("plan")) return "Generated floor plan";
    if (c.includes("render") || c.includes("video") || c.includes("3d") || c.includes("walkthrough") || c.includes("cinematic")) return "Rendered output";
    if (c.includes("ifc") || c.includes("bim")) return "Processed BIM model";
    if (c.includes("boq") || c.includes("cost") || c.includes("estimate")) return "Exported BOQ";
    if (c.includes("concept") || c.includes("design") || c.includes("brief")) return "Ran pipeline";
    return "Ran workflow";
  }

  function inferCategory(wf: { category?: string | null; name?: string | null }): string {
    if (wf.category) return wf.category;
    const h = (wf.name ?? "").toLowerCase();
    if (h.includes("floor plan") || h.includes("floor-plan") || h.includes("layout")) return "Floor Plan";
    if (h.includes("ifc") || h.includes("bim") || h.includes("revit")) return "BIM Model";
    if (h.includes("render") || h.includes("walkthrough") || h.includes("walk through") || h.includes("video") || h.includes("cinematic") || h.includes("photoreal")) return "Video Render";
    if (h.includes("boq") || h.includes("cost") || h.includes("estimate") || h.includes("quantity") || h.includes("budget")) return "Cost Estimate";
    if (h.includes("concept") || h.includes("design") || h.includes("brief")) return "Concept Design";
    return "Workflow";
  }

  function getContinueIllustration(wf: { category?: string | null; name?: string | null }): React.ReactNode {
    const haystack = `${wf.category ?? ""} ${wf.name ?? ""}`.toLowerCase();

    if (haystack.includes("floor plan") || haystack.includes("floor-plan") || haystack.includes("floorplan") || haystack.includes("layout")) {
      return (
        <svg className={s.illuFloor} viewBox="0 0 280 140" fill="none">
          <g stroke="var(--rs-ink)" strokeWidth="1.6" fill="none" opacity="0.7">
            <rect x="40" y="20" width="200" height="100" /><line x1="140" y1="20" x2="140" y2="70" />
            <line x1="80" y1="70" x2="240" y2="70" /><line x1="140" y1="70" x2="140" y2="120" />
          </g>
          <g stroke="var(--rs-blueprint)" strokeWidth="1.4" fill="rgba(26,77,92,0.15)"><path d="M 100 20 A 14 14 0 0 1 114 34 L 100 34 Z" /></g>
          <g stroke="var(--rs-burnt)" strokeWidth="1.6"><line x1="160" y1="20" x2="200" y2="20" /><line x1="40" y1="40" x2="40" y2="70" /></g>
          <g fontFamily="JetBrains Mono, monospace" fontSize="6" fill="var(--rs-text)" letterSpacing="1">
            <text x="84" y="48">LIVING</text><text x="180" y="48">KITCHEN</text><text x="84" y="100">BEDROOM</text><text x="178" y="100">BATH</text>
          </g>
        </svg>
      );
    }

    if (haystack.includes("ifc") || haystack.includes("bim") || haystack.includes("model") || haystack.includes("revit")) {
      return (
        <svg className={s.illuBim} viewBox="0 0 280 140" fill="none">
          <g stroke="rgba(229,168,120,0.85)" strokeWidth="1.4" fill="none">
            <polygon points="80,110 140,80 200,110 140,130" /><polygon points="80,50 140,20 200,50 140,80" />
            <line x1="80" y1="110" x2="80" y2="50" /><line x1="200" y1="110" x2="200" y2="50" />
            <line x1="140" y1="130" x2="140" y2="80" /><line x1="140" y1="80" x2="140" y2="20" />
            <line x1="80" y1="90" x2="200" y2="90" strokeOpacity="0.5" strokeDasharray="2,3" />
            <line x1="80" y1="70" x2="200" y2="70" strokeOpacity="0.5" strokeDasharray="2,3" />
          </g>
          <g fill="rgba(229,168,120,0.5)">
            <circle cx="80" cy="110" r="2" /><circle cx="200" cy="110" r="2" /><circle cx="80" cy="50" r="2" />
            <circle cx="200" cy="50" r="2" /><circle cx="140" cy="20" r="2" /><circle cx="140" cy="130" r="2" />
          </g>
        </svg>
      );
    }

    if (haystack.includes("render") || haystack.includes("video") || haystack.includes("walkthrough") || haystack.includes("walk through") || haystack.includes("visualization") || haystack.includes("photoreal") || haystack.includes("cinematic")) {
      return (
        <svg className={s.illuRender} viewBox="0 0 280 140" fill="none">
          <defs><linearGradient id="cRenderSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(229,168,120,0.65)" /><stop offset="100%" stopColor="rgba(194,106,59,0.35)" /></linearGradient></defs>
          <rect width="280" height="140" fill="url(#cRenderSky)" />
          <path d="M0 95 L30 95 L30 75 L60 75 L60 90 L100 90 L100 60 L140 60 L140 85 L180 85 L180 70 L220 70 L220 92 L280 92 L280 140 L0 140 Z" fill="rgba(15,24,34,0.72)" />
        </svg>
      );
    }

    if (haystack.includes("boq") || haystack.includes("cost") || haystack.includes("estimate") || haystack.includes("quantity") || haystack.includes("budget")) {
      return (
        <svg className={s.illuBoq} viewBox="0 0 280 140" fill="none">
          <rect x="60" y="20" width="160" height="100" rx="8" fill="var(--rs-paper)" stroke="var(--rs-rule)" strokeWidth="1" />
          <text x="80" y="42" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--rs-text-mute)" letterSpacing="1.5">TOTAL COST</text>
          <text x="80" y="65" fontFamily="Georgia, serif" fontSize="22" fill="var(--rs-ink)" letterSpacing="-0.5"><tspan fill="var(--rs-blueprint)" fontStyle="italic">{"\u20B9"}9.03</tspan> Cr</text>
          <line x1="80" y1="76" x2="200" y2="76" stroke="var(--rs-rule)" strokeWidth="0.8" />
          <text x="80" y="90" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--rs-ink-soft)">Concrete</text>
          <text x="180" y="90" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--rs-ink-soft)" textAnchor="end">3.42</text>
          <text x="80" y="104" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--rs-ink-soft)">Brick</text>
          <text x="180" y="104" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--rs-ink-soft)" textAnchor="end">1.18</text>
        </svg>
      );
    }

    // Default: visible geometric pattern
    return (
      <svg className={s.illuDefault} viewBox="0 0 280 140" fill="none">
        <g stroke="var(--rs-ink-soft)" strokeWidth="1.6" fill="none" opacity="0.6">
          <rect x="30" y="30" width="60" height="40" rx="4" /><rect x="110" y="20" width="60" height="60" rx="4" /><rect x="190" y="40" width="50" height="30" rx="4" />
          <line x1="90" y1="50" x2="110" y2="50" strokeWidth="1.2" /><line x1="170" y1="50" x2="190" y2="55" strokeWidth="1.2" />
          <circle cx="70" cy="105" r="14" strokeWidth="1.2" opacity="0.5" /><circle cx="160" cy="110" r="10" strokeWidth="1.2" opacity="0.5" /><circle cx="225" cy="100" r="6" strokeWidth="1.2" opacity="0.5" />
        </g>
      </svg>
    );
  }

  function getGalleryBgClass(type: string): string {
    if (type === "IMAGE") return s.giRender;
    if (type === "THREE_D") return s.gi3d;
    if (type === "VIDEO") return s.giVideo;
    if (type === "FILE") return s.giBoq;
    return s.giImage;
  }

  return (
    <div className={s.page} data-theme="light">

      {/* ════════════════════════ SECTION 1: HERO ════════════════════════ */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.heroLeft}>
            <div className={s.heroEyebrowRow}>
              <div className={s.heroTimePill}>
                <div className={s.heroTimeDot} />
                <span>{formatDateTime(new Date())}</span>
              </div>
              <span className={s.heroGreeting}>Welcome back</span>
            </div>
            <h1 className={s.heroTitle}>
              Hello, <em className={s.heroTitleEm}>{firstName}.</em>
            </h1>
            <p className={s.heroLead}>
              You have <strong>{data.workflowCount} workflow{data.workflowCount !== 1 ? "s" : ""}</strong> in your workspace
              {outputsCount > 0 && <> and <strong>{outputsCount} output{outputsCount !== 1 ? "s" : ""}</strong> ready to review</>}.
            </p>
            <div className={s.heroCtaRow}>
              {data.recentWorkflows.length > 0 ? (
                <Link href={`/dashboard/canvas?id=${data.recentWorkflows[0].id}`} className={s.ctaPrimary}>
                  <ArrowRight size={14} />
                  Continue last workflow
                </Link>
              ) : (
                <Link href="/dashboard/canvas?new=1" className={s.ctaPrimary}>
                  <Plus size={14} />
                  New blank workflow
                </Link>
              )}
              <Link href="/dashboard/canvas?new=1" className={s.ctaSecondary}>
                New blank workflow
              </Link>
              <Link href="/dashboard/templates" className={s.ctaSecondary}>
                Browse templates
              </Link>
            </div>
          </div>

          {/* ── Personal stats panel ── */}
          <div className={s.heroStatsPanel}>
            <div className={s.heroStatsHead}>
              <div className={s.heroStatsTitle}>Your workspace</div>
              <Link href="/dashboard/workflows" className={s.heroStatsLink}>
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <div className={s.heroStatsGrid}>
              <div>
                <div className={s.hpStatNum}><span className={s.hpStatNumEm}>{data.workflowCount}</span></div>
                <div className={s.hpStatLabel}>Workflows</div>
              </div>
              <div>
                <div className={s.hpStatNum}><span className={s.hpStatNumEm}>{data.executionCount}</span></div>
                <div className={s.hpStatLabel}>Executions</div>
              </div>
              <div>
                <div className={s.hpStatNum}><span className={s.hpStatNumEm}>{outputsCount}</span></div>
                <div className={s.hpStatLabel}>Outputs</div>
              </div>
              <div>
                <div className={s.hpStatNum}>L<span className={s.hpStatNumEm}>{data.level}</span></div>
                <div className={s.hpStatLabel}>XP Level</div>
              </div>
            </div>
            <div className={s.heroPlanStrip}>
              <div className={s.heroPlan}>
                <span className={s.heroPlanBadge}>
                  <Crown size={11} /> {planLabel}
                </span>
                <span className={s.heroPlanLabel}>{planLabel} plan</span>
              </div>
              <div className={s.heroPlanMeta}>{used}/{effectiveLimit} runs</div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ SECTION 2: CONTINUE WHERE YOU LEFT OFF ════════════════════════ */}
      {data.recentWorkflows.length > 0 && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <div className={s.sectionEyebrow}><span className={s.sectionEyebrowNum}>01 &ndash;</span> Pick up where you left off</div>
              <h2 className={s.sectionTitle}>Your <em>recent workflows.</em></h2>
              <p className={s.sectionSub}>Projects with unfinished business.</p>
            </div>
            <Link href="/dashboard/workflows" className={s.sectionLink}>
              View all {data.workflowCount} <ArrowRight size={13} />
            </Link>
          </div>
          <div className={s.continueGrid}>
            {data.recentWorkflows.slice(0, 3).map((wf) => {
              // isDark matches the illustration priority: floor/boq = light, bim/render = dark
              const h = `${wf.category ?? ""} ${wf.name ?? ""}`.toLowerCase();
              const isFloorOrBoq = h.includes("floor plan") || h.includes("floor-plan") || h.includes("floorplan") || h.includes("layout") || h.includes("boq") || h.includes("cost") || h.includes("estimate") || h.includes("quantity") || h.includes("budget");
              const isBimOrRender = h.includes("ifc") || h.includes("bim") || h.includes("model") || h.includes("revit") || h.includes("render") || h.includes("video") || h.includes("walkthrough") || h.includes("visualization") || h.includes("photoreal") || h.includes("cinematic");
              const isDark = !isFloorOrBoq && isBimOrRender;
              return (
                <Link key={wf.id} href={`/dashboard/canvas?id=${wf.id}`} className={s.continueCard}>
                  <div className={s.continueThumb}>
                    <div className={`${s.continueThumbBg} ${isDark ? s.continueThumbDark : ""}`}>
                      {getContinueIllustration(wf)}
                    </div>
                    <div className={`${s.continueThumbTag} ${isDark ? s.continueThumbTagDark : ""}`}>
                      <span className={s.continueThumbTagDot} />
                      {wf.nodeCount} nodes
                    </div>
                  </div>
                  <div className={s.continueMeta}>
                    <div className={s.continueName}>{wf.name}</div>
                    <div className={s.continueInfo}>{wf.executionCount} run{wf.executionCount !== 1 ? "s" : ""}</div>
                    <div className={s.continueStats}>
                      <span className={s.continueTime}>{formatRelativeTime(wf.updatedAt)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ════════════════════════ SECTION 3: QUICK ACTIONS ════════════════════════ */}
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <div className={s.sectionEyebrow}><span className={s.sectionEyebrowNum}>02 &ndash;</span> Jump in</div>
            <h2 className={s.sectionTitle}>Start <em>something new.</em></h2>
            <p className={s.sectionSub}>Four product surfaces, one tap away.</p>
          </div>
        </div>
        <div className={s.quickGrid}>
          <Link href="/dashboard/canvas?mode=prompt" className={s.quickCard}>
            <div className={s.quickIcon}><Sparkles size={20} /></div>
            <div className={s.quickEyebrow}>Workflow Builder</div>
            <div className={s.quickTitle}>New from <em className={s.quickTitleEm}>prompt</em></div>
            <div className={s.quickDesc}>Describe a workflow in plain English. AI builds the node graph for you.</div>
            <div className={s.quickArrow}>Start <ArrowRight size={13} /></div>
          </Link>
          <Link href="/dashboard/floor-plan" className={s.quickCard} data-accent="floor">
            <div className={s.quickIcon}><Layers size={20} /></div>
            <div className={s.quickEyebrow}>Floor Plan</div>
            <div className={s.quickTitle}>Sketch a <em className={s.quickTitleEm}>home</em></div>
            <div className={s.quickDesc}>Type a brief, get an editable CAD floor plan with BOQ in 30 seconds.</div>
            <div className={s.quickArrow}>Open editor <ArrowRight size={13} /></div>
          </Link>
          <Link href="/dashboard/ifc-viewer" className={s.quickCard} data-accent="ifc">
            <div className={s.quickIcon}><Building2 size={20} /></div>
            <div className={s.quickEyebrow}>IFC Viewer</div>
            <div className={s.quickTitle}>Open a <em className={s.quickTitleEm}>BIM model</em></div>
            <div className={s.quickDesc}>Browser-native IFC viewer up to 500 MB. No installs.</div>
            <div className={s.quickArrow}>Upload IFC <ArrowRight size={13} /></div>
          </Link>
          <Link href="/dashboard/3d-render" className={s.quickCard} data-accent="render">
            <div className={s.quickIcon}><Palette size={20} /></div>
            <div className={s.quickEyebrow}>3D Video Render</div>
            <div className={s.quickTitle}>Cinematic <em className={s.quickTitleEm}>walkthrough</em></div>
            <div className={s.quickDesc}>Turn any plan into a 15s photoreal video walkthrough. Cloud-rendered.</div>
            <div className={s.quickArrow}>Render <ArrowRight size={13} /></div>
          </Link>
        </div>
      </section>

      {/* ════════════════════════ SECTION 4: RECENT OUTPUTS GALLERY ════════════════════════ */}
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <div className={s.sectionEyebrow}><span className={s.sectionEyebrowNum}>03 &ndash;</span> Latest outputs</div>
            <h2 className={s.sectionTitle}>What you&apos;ve <em>made.</em></h2>
            <p className={s.sectionSub}>Last six deliverables across all your workflows.</p>
          </div>
        </div>
        <div className={s.galleryStrip}>
          {(data.recentOutputs ?? []).slice(0, 6).map((o) => (
            <div key={o.id} className={s.galleryItem}>
              <div className={`${s.galleryItemBg} ${getGalleryBgClass(o.type)}`}>
                {o.type === "IMAGE" && (
                  <svg className={s.illuRender} viewBox="0 0 60 60" fill="none"><circle cx="30" cy="25" r="8" stroke="#fff" strokeWidth="1" opacity="0.4" /><path d="M10 45 L25 32 L35 40 L50 28" stroke="#fff" strokeWidth="1" opacity="0.3" /></svg>
                )}
                {o.type === "THREE_D" && (
                  <svg className={s.illuBim} viewBox="0 0 60 60" fill="none"><path d="M30 10 L50 22 L50 42 L30 54 L10 42 L10 22 Z" stroke="#fff" strokeWidth="1" opacity="0.3" /><line x1="30" y1="10" x2="30" y2="54" stroke="#fff" strokeWidth="0.5" opacity="0.2" /></svg>
                )}
                {o.type === "VIDEO" && (
                  <svg className={s.illuRender} viewBox="0 0 60 60" fill="none"><polygon points="24,18 44,30 24,42" stroke="#fff" strokeWidth="1.2" opacity="0.4" fill="none" /></svg>
                )}
                {o.type === "FILE" && (
                  <svg className={s.illuBoq} viewBox="0 0 60 60" fill="none"><rect x="15" y="12" width="30" height="38" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.3" /><line x1="20" y1="22" x2="40" y2="22" stroke="currentColor" strokeWidth="0.8" opacity="0.2" /><line x1="20" y1="28" x2="35" y2="28" stroke="currentColor" strokeWidth="0.8" opacity="0.2" /><line x1="20" y1="34" x2="38" y2="34" stroke="currentColor" strokeWidth="0.8" opacity="0.2" /></svg>
                )}
              </div>
              <div className={o.type === "IMAGE" || o.type === "VIDEO" || o.type === "THREE_D" ? s.galleryMeta : s.galleryMetaLight}>
                <div className={s.galleryName}>{o.workflowName}</div>
                <div className={s.galleryTime}>{formatRelativeTime(o.createdAt)}</div>
              </div>
            </div>
          ))}
          {(data.recentOutputs ?? []).length === 0 && (
            <div className={s.galleryEmpty}>
              No outputs yet. Run a workflow to see results here.
            </div>
          )}
        </div>
      </section>

      {/* ════════════════════════ SECTION 5: WHAT'S NEW ════════════════════════ */}
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <div className={s.sectionEyebrow}><span className={s.sectionEyebrowNum}>04 &ndash;</span> What&apos;s new</div>
            <h2 className={s.sectionTitle}>Updates since you <em>last logged in.</em></h2>
            <p className={s.sectionSub}>Three things shipped while you were away.</p>
          </div>
        </div>
        <div className={s.whatsnewGrid}>
          {DASHBOARD_CHANGELOG.slice(0, 3).map((entry: ChangelogEntry) => (
            <div key={entry.id} className={s.newsCard}>
              <div className={s.newsTagRow}>
                <span className={s.newsTag} data-type={entry.type}>
                  <span className={s.newsTagDot} />
                  {entry.type}
                </span>
                <span className={s.newsDate}>{new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
              <div className={s.newsTitle}>{entry.title}</div>
              <div className={s.newsDesc}>{entry.description}</div>
              <Link href={entry.cta.href} className={s.newsLink}>
                {entry.cta.label} <ArrowRight size={12} />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════════════ SECTION 6: ACTIVITY LEDGER ════════════════════════ */}
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <div className={s.sectionEyebrow}><span className={s.sectionEyebrowNum}>05 &ndash;</span> Activity</div>
            <h2 className={s.sectionTitle}>Your <em>working log.</em></h2>
            <p className={s.sectionSub}>Every run, export, and upload from the past week.</p>
          </div>
        </div>
        <div className={s.activityBlock}>
          {(data.recentActivity ?? []).slice(0, 6).map((act) => {
            const actCat = inferCategory({ category: act.workflowCategory, name: act.workflowName });
            const catL = actCat.toLowerCase();
            const iconType = act.status === "FAILED" ? "failed"
              : (catL.includes("video") || catL.includes("render")) ? "video"
              : (catL.includes("floor")) ? "floor"
              : (catL.includes("bim") || catL.includes("ifc")) ? "ifc"
              : (catL.includes("cost") || catL.includes("boq")) ? "export"
              : undefined;
            return (
              <div key={act.id} className={s.activityRow}>
                <div className={s.activityIcon} data-type={iconType}>
                  {iconType === "failed" && <X size={16} />}
                  {iconType === "video" && <Video size={16} />}
                  {iconType === "floor" && <Grid3x3 size={16} />}
                  {iconType === "ifc" && <Box size={16} />}
                  {iconType === "export" && <FileSpreadsheet size={16} />}
                  {!iconType && <Zap size={16} />}
                </div>
                <div className={s.activityBody}>
                  <div className={s.activityTitle}>
                    {getActivityVerb(actCat)} <span className={s.activityTitleEm}>&mdash; {act.workflowName}</span>
                  </div>
                  <div className={s.activityMeta}>{actCat}</div>
                </div>
                <span className={s.activityStatus} data-status={act.status}>
                  {getStatusLabel(act.status)}
                </span>
                <span className={s.activityTime}>{formatRelativeTime(act.createdAt)}</span>
              </div>
            );
          })}
          {(data.recentActivity ?? []).length === 0 && (
            <div className={s.activityEmpty}>
              No activity yet. Start a workflow to see it here.
            </div>
          )}
        </div>
      </section>

      {/* ════════════════════════ SECTION 7: CLOSER ════════════════════════ */}
      <section style={{ padding: "0 56px", maxWidth: 1280, margin: "0 auto" }}>
        <div className={s.closer}>
          <div className={s.closerBody}>
            <div className={s.closerEyebrow}>Resources for builders</div>
            <h3 className={s.closerTitle}>
              Got a workflow we should <em>build next?</em>
            </h3>
          </div>
          <Link href="/dashboard/feedback" className={s.closerBtn}>
            Suggest a workflow <ArrowRight size={14} />
          </Link>
        </div>
      </section>

    </div>
  );
}
