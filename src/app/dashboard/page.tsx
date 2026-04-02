"use client";

import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight, Crown, Play, Plus, Zap, ChevronDown,
  Type, FileText, Image as ImageIcon, Box, Sliders, MapPin,
  Sparkles, Palette, Building2, FileSpreadsheet, X, ChevronRight,
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useLocale } from "@/hooks/useLocale";
import { toast } from "sonner";
import type { TranslationKey } from "@/lib/i18n";
import type { WorkflowTemplate } from "@/types/workflow";

// Lazy-load 3D scenes
const WorldCanvas = lazy(() => import("@/components/dashboard/WorldCanvas").then((m) => ({ default: m.WorldCanvas })));
const FloorPlanScene = lazy(() => import("@/components/dashboard/FloorPlanScene").then((m) => ({ default: m.FloorPlanScene })));
const IFCViewerScene = lazy(() => import("@/components/dashboard/IFCViewerScene").then((m) => ({ default: m.IFCViewerScene })));
import { scrollState } from "@/components/dashboard/WorldCanvas";

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

// ─── Constants ───────────────────────────────────────────────────────────────
const R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";
const DEMO_VIDEOS = [
  { id: "dv-4", url: `/videos/img-to-renovation.mp4`, previewStart: 0, color: "#F59E0B", rgb: "245,158,11" },
  { id: "dv-3", url: `${R2}/3d-model-preview.mp4`, previewStart: 0, color: "#10B981", rgb: "16,185,129" },
  { id: "dv-1", url: `${R2}/text-to-concept-building.mp4`, previewStart: 132, color: "#4F8AFF", rgb: "79,138,255" },
  { id: "dv-2", url: `${R2}/floor-plan-demo.mp4`, previewStart: 0, color: "#8B5CF6", rgb: "139,92,246" },
];

const PLAN_LIMITS: Record<string, number> = { FREE: 5, MINI: 10, STARTER: 30, PRO: 100 };

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

  // Floor plan + IFC scene scroll progress — track within the main scroll container
  const floorPlanRef = useRef<HTMLDivElement>(null);
  const ifcRef = useRef<HTMLDivElement>(null);
  const [fpVal, setFpVal] = useState(0);
  const [ifcVal, setIfcVal] = useState(0);

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

  // ── Scroll tracking for 3D world ──
  const mainRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroScroll } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
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
  return (
    <div style={{ height: "100%", overflow: "hidden", position: "relative" }}>
      {/* ═══ PERSISTENT 3D WORLD — Behind all content ═══ */}
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "#07070D" }} />}>
          <WorldCanvas />
        </Suspense>
      </div>

      {/* ═══ SCROLLABLE CONTENT — On top of 3D world ═══ */}
      <main ref={mainRef} className="db-scroll" style={{ position: "relative", zIndex: 1, height: "100%", overflowY: "auto", overflowX: "hidden" }}>

        {/* ═══════════════════════════════════════════════════════════════
            HERO — Full viewport, transparent overlay on 3D
            ═══════════════════════════════════════════════════════════════ */}
        <motion.section
          ref={heroRef}
          style={{ position: "relative", minHeight: "82vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", overflow: "hidden", opacity: heroOpacity, scale: heroScale }}
        >

          {/* Depth separation — dark vignette behind text */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 55% 45% at 50% 48%, rgba(7,7,13,0.55) 0%, transparent 75%)", pointerEvents: "none", zIndex: 1 }} />

          {/* ── Holographic text overlay ── */}
          <div style={{
            position: "relative", zIndex: 2, textAlign: "center", maxWidth: 720,
            padding: "48px 40px", borderRadius: 24,
            background: "rgba(10,12,20,0.15)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}>
            {/* Decorative line */}
            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.6, ease }}
              style={{ width: 50, height: 1, background: "linear-gradient(90deg, transparent, #06b6d4, transparent)", margin: "0 auto 24px", transformOrigin: "center" }}
            />

            {/* WELCOME BACK */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease }}
            >
              <span style={{
                fontSize: 11, fontWeight: 400, letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(255,255,255,0.45)",
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                {data.userName ? t("dash.welcomeBack") : ""}
              </span>
            </motion.div>

            {/* NAME — the hero moment */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.8, ease }}
            >
              <h1 style={{
                fontSize: "clamp(38px, 7vw, 72px)", fontWeight: 900,
                letterSpacing: "-0.04em", lineHeight: 1.05,
                marginTop: 8, marginBottom: 16,
                background: "linear-gradient(135deg, #06b6d4 0%, #818cf8 45%, #a855f7 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                textShadow: "none",
                filter: "drop-shadow(0 0 40px rgba(6,182,212,0.2)) drop-shadow(0 0 80px rgba(168,85,247,0.1))",
              }}>
                {data.userName || t("dash.welcomeNew")}
              </h1>
            </motion.div>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.6, ease }}
              style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 36, letterSpacing: "0.01em" }}
            >
              {t("dash.letsCreate")}
            </motion.p>

            {/* Actions */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.6, ease }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexWrap: "wrap" }}
            >
              {/* Plan badge — cyan themed */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "7px 7px 7px 14px", borderRadius: 24,
                background: "rgba(6,182,212,0.06)",
                border: "1px solid rgba(6,182,212,0.2)",
                backdropFilter: "blur(8px)",
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                  color: "#06b6d4",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  {role === "FREE" ? <Zap size={10} /> : <Crown size={10} />}
                  {role}
                </span>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-jetbrains), monospace", paddingRight: 4 }}>
                  {used}/{effectiveLimit}
                </span>
              </div>

              {/* CTA — gradient border, dark fill */}
              <Link
                href="/dashboard/workflows/new"
                className="db-hero-cta"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "12px 28px", borderRadius: 14,
                  background: "rgba(6,182,212,0.08)",
                  border: "1px solid rgba(6,182,212,0.3)",
                  color: "#e2e8f0", fontSize: 14, fontWeight: 700,
                  textDecoration: "none", letterSpacing: "0.01em",
                  transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <Plus size={15} strokeWidth={2.5} /> {t("dash.startBuilding")}
              </Link>
            </motion.div>
          </div>

          {/* Scroll indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            style={{ position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
          >
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "var(--font-jetbrains), monospace" }}>
              {t("dash.scrollExplore")}
            </span>
            <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}>
              <ChevronDown size={14} style={{ color: "rgba(255,255,255,0.2)" }} />
            </motion.div>
          </motion.div>
        </motion.section>

        {/* ═══════════════════════════════════════════════════════════════
            FEATURE SHOWCASE — Full-width cinematic sections
            ═══════════════════════════════════════════════════════════════ */}
        <section style={{ position: "relative", padding: "100px 0 60px", background: "linear-gradient(180deg, rgba(7,7,13,0.85) 0%, rgba(7,7,13,0.6) 50%, rgba(7,7,13,0.85) 100%)", backdropFilter: "blur(4px)" }}>
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
            EXPLORE TEMPLATES CTA
            ═══════════════════════════════════════════════════════════════ */}
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          variants={fadeIn} transition={{ duration: 0.6, ease }}
          style={{ textAlign: "center", padding: "48px 32px 56px" }}
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
        <section style={{ padding: "80px 0 100px" }}>
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeIn} transition={{ duration: 0.7, ease }}
            style={{ maxWidth: 800, margin: "0 auto", padding: "64px 40px", textAlign: "center", borderRadius: 28, position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(79,138,255,0.05), rgba(139,92,246,0.04))", border: "1px solid rgba(79,138,255,0.1)" }}
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
                href="/dashboard/workflows/new"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  padding: "16px 44px", borderRadius: 16,
                  background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
                  color: "#fff", fontSize: 16, fontWeight: 800,
                  textDecoration: "none", letterSpacing: "-0.01em",
                  boxShadow: "0 4px 32px rgba(79,138,255,0.35), 0 0 80px rgba(99,102,241,0.1)",
                  transition: "all 0.3s ease",
                }}
                className="db-cta-primary"
              >
                {t("dash.startBuilding")} <ArrowRight size={18} />
              </Link>
            </div>
          </motion.div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            RECENT ACTIVITY
            ═══════════════════════════════════════════════════════════════ */}
        {(data.recentWorkflows ?? []).length > 0 && (
          <section style={{ padding: "0 0 80px" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px" }}>
              <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
                <motion.div variants={fadeIn} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: "#E2E8F0", letterSpacing: "-0.02em" }}>
                    {t("dash.recentActivity")}
                  </h3>
                  <Link href="/dashboard/workflows" style={{ fontSize: 13, fontWeight: 600, color: "#4F8AFF", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                    {t("dash.allWorkflows")} <ChevronRight size={14} />
                  </Link>
                </motion.div>

                <div className="db-recent-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                  {(data.recentWorkflows ?? []).map((wf, i) => (
                    <motion.div key={wf.id} variants={fadeIn} transition={{ duration: 0.4, delay: i * 0.06, ease }}>
                      <Link href={`/dashboard/canvas?id=${wf.id}`} className="db-glass-card" style={{ display: "block", background: "rgba(12,14,24,0.6)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden", textDecoration: "none", transition: "all 350ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
                        <div style={{ padding: "14px 18px", background: "linear-gradient(135deg, rgba(79,138,255,0.05), rgba(99,102,241,0.02))", borderBottom: "1px solid rgba(79,138,255,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <FileText size={14} style={{ color: "#4F8AFF" }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wf.name}</div>
                          </div>
                        </div>
                        <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                          <span style={{ fontSize: 11, color: "#556070", display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-jetbrains), monospace" }}>
                            <Zap size={10} style={{ color: "#4F8AFF" }} /> {wf.nodeCount} {t("dash.nodes")}
                          </span>
                          <span style={{ fontSize: 11, color: "#556070", display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-jetbrains), monospace" }}>
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
