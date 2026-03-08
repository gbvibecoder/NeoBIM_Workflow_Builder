"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight, Zap, Sparkles, Users, LayoutGrid,
  Box, Play, Image as ImageIcon, FileCode,
  MousePointerClick, Workflow, Layers, Settings, Target, Calendar,
} from "lucide-react";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useLocale } from '@/hooks/useLocale';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  input: "#3B82F6", transform: "#8B5CF6", generate: "#10B981", export: "#F59E0B",
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};
const stagger = { visible: { transition: { staggerChildren: 0.1 } } };
const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

// ─── Prompt placeholders ─────────────────────────────────────────────────────

const PROMPT_EXAMPLES = [
  "Generate a site analysis workflow for a coastal project...",
  "Create a concept-to-render pipeline with IFC export...",
  "Build a massing study from project brief to 3D model...",
  "Design a facade optimization workflow with AI...",
];

function RotatingPlaceholder({ items = PROMPT_EXAMPLES }: { items?: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setIndex(i => (i + 1) % items.length), 3500);
    return () => clearInterval(interval);
  }, [items.length]);
  return (
    <motion.span
      key={index}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 0.4, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4 }}
      style={{ position: "absolute", left: 48, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 15, color: "#5C5C78", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", right: 16 }}
    >
      {items[index]}
    </motion.span>
  );
}

// ─── Floating Node Card ──────────────────────────────────────────────────────

function FloatingCard({ label, category, delay, style }: { label: string; category: string; delay: number; style: React.CSSProperties }) {
  const color = CATEGORY_COLORS[category] ?? "#4F8AFF";
  const rgb = hexToRgb(color);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.6, ease: "easeOut" }}
      className="landing-floating-card"
      style={{
        position: "absolute",
        background: "rgba(18,18,30,0.85)",
        backdropFilter: "blur(20px)",
        border: `1px solid rgba(${rgb}, 0.25)`,
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(${rgb}, 0.08)`,
        zIndex: 10,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#F0F0F5" }}>{label}</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: `rgba(${rgb}, 0.15)`, overflow: "hidden", width: 100 }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          transition={{ delay: delay + 0.4, duration: 1.2, ease: "easeOut" }}
          style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${color}, transparent)` }}
        />
      </div>
    </motion.div>
  );
}

// ─── Sidebar Icons ───────────────────────────────────────────────────────────

function SideToolbar() {
  const icons = [
    { icon: <MousePointerClick size={18} />, tip: "Select" },
    { icon: <Workflow size={18} />, tip: "Add Node" },
    { icon: <Settings size={18} />, tip: "Configure" },
    { icon: <Layers size={18} />, tip: "Layers" },
    { icon: <Target size={18} />, tip: "AI Assist" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.8, duration: 0.5 }}
      className="landing-side-toolbar"
      style={{
        position: "absolute", left: 32, top: "50%", transform: "translateY(-50%)",
        background: "rgba(18,18,30,0.85)", backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16,
        padding: "12px 8px", display: "flex", flexDirection: "column", gap: 4,
        zIndex: 20,
      }}
    >
      {icons.map((item, i) => (
        <div key={i} style={{
          width: 38, height: 38, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: i === 0 ? "#4F8AFF" : "#5C5C78",
          background: i === 0 ? "rgba(79,138,255,0.1)" : "transparent",
          cursor: "pointer",
          transition: "all 0.15s",
        }}>
          {item.icon}
        </div>
      ))}
    </motion.div>
  );
}

// ─── Input Prompt Card ───────────────────────────────────────────────────────

function PromptCard({ labelText, quoteText }: { labelText?: string; quoteText?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: -2 }}
      transition={{ delay: 1.0, duration: 0.6 }}
      className="landing-prompt-card"
      style={{
        position: "absolute", left: 80, top: 100,
        background: "rgba(18,18,30,0.9)", backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
        padding: "16px 20px", maxWidth: 260, zIndex: 15,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px", color: "#4F8AFF", marginBottom: 10 }}>
        {labelText ?? "AI Prompt"}
      </div>
      <p style={{ fontSize: 13, color: "#9898B0", lineHeight: 1.5, fontStyle: "italic" }}>
        {quoteText ?? "\u201CCreate a workflow that takes a project brief, generates 3D massing, and renders a concept image.\u201D"}
      </p>
      <div style={{ marginTop: 12, height: 3, borderRadius: 2, background: "rgba(79,138,255,0.15)", overflow: "hidden" }}>
        <motion.div
          animate={{ width: ["0%", "70%", "100%"] }}
          transition={{ duration: 2.5, delay: 1.5, ease: "easeInOut" }}
          style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg, #4F8AFF, #8B5CF6)" }}
        />
      </div>
    </motion.div>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <LayoutGrid size={22} />, color: "#3B82F6",
    title: "Design Automation Canvas",
    description: "Drag and drop 30+ design automation building blocks onto an infinite canvas. 7 live AI-powered steps, more added weekly — no coding required.",
    bullets: ["Drag-and-drop canvas", "7 live AI nodes + 24 coming soon", "Real-time execution"],
  },
  {
    icon: <Sparkles size={22} />, color: "#8B5CF6",
    title: "AI-Powered Design Workflows",
    description: "Describe your project in plain English. Our AI understands architectural programs, building types, and spatial requirements — then builds the design pipeline for you.",
    bullets: ["Natural language input", "Instant workflow generation", "Perfect for schematic design phase"],
  },
  {
    icon: <Users size={22} />, color: "#10B981",
    title: "Shared Workflows",
    description: "Browse and clone proven design workflows. A complement to Revit and Rhino, not a replacement.",
    bullets: ["Browse verified workflows", "One-click cloning", "No coding or CAD experience required"],
  },
];

const USE_CASES = ["Architecture Studios", "Engineering Teams", "BIM Consultants", "Design Agencies", "Construction Tech"];

const SHOWCASE = [
  { id: "wf-01", badge: null },
  { id: "wf-10", badge: "MOST POPULAR" },
  { id: "wf-09", badge: null },
];

// ─── Logo Marquee ────────────────────────────────────────────────────────────

const PARTNER_LOGOS = ["BUILT FOR AEC", "COMPLEMENT TO REVIT & RHINO", "NO CAD NEEDED", "SCHEMATIC DESIGN PHASE"];

// ─── News Ticker ─────────────────────────────────────────────────────────────

const NEWS_ITEMS = [
  "New: AI design workflow generation v2.0 is live",
  "7 live AI nodes + 24 preview nodes available",
  "Perfect for schematic design phase",
  "A complement to Revit and Rhino, not a replacement",
  "No coding or CAD experience required",
];

function NewsTicker({ items = NEWS_ITEMS, whatsNewLabel }: { items?: string[]; whatsNewLabel?: string }) {
  return (
    <div className="landing-news-ticker" style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9000,
      height: 36, display: "flex", alignItems: "center",
      background: "rgba(7,7,13,0.95)", backdropFilter: "blur(12px)",
      borderTop: "1px solid rgba(255,255,255,0.04)",
      overflow: "hidden",
    }}>
      <div style={{
        flexShrink: 0, padding: "0 12px", height: "100%",
        display: "flex", alignItems: "center", gap: 6,
        background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
        fontSize: 10, fontWeight: 700, color: "white", letterSpacing: "0.5px",
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", animation: "glow-pulse 2s infinite" }} />
        {whatsNewLabel ?? "WHAT\u0027S NEW"}
      </div>
      <div style={{ overflow: "hidden", flex: 1, position: "relative" }}>
        <motion.div
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          style={{ display: "flex", gap: 0, whiteSpace: "nowrap" }}
        >
          {[...items, ...items].map((item, i) => (
            <span key={i} style={{ fontSize: 12, color: "#9898B0", padding: "0 32px" }}>
              {item}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { t, tArray } = useLocale();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);

  const promptExamples = [t('landing.prompt1'), t('landing.prompt2'), t('landing.prompt3'), t('landing.prompt4')];

  const newsItems = [t('landing.news1'), t('landing.news2'), t('landing.news3'), t('landing.news4'), t('landing.news5')];

  const features = [
    { icon: <LayoutGrid size={22} />, color: "#3B82F6", title: t('landing.visualBuilder'), description: t('landing.visualBuilderDesc'), bullets: [t('landing.visualBullet1'), t('landing.visualBullet2'), t('landing.visualBullet3')] },
    { icon: <Sparkles size={22} />, color: "#8B5CF6", title: t('landing.aiPowered'), description: t('landing.aiPoweredDesc'), bullets: [t('landing.aiBullet1'), t('landing.aiBullet2'), t('landing.aiBullet3')] },
    { icon: <Users size={22} />, color: "#10B981", title: t('landing.communityMarketplace'), description: t('landing.communityDesc'), bullets: [t('landing.communityBullet1'), t('landing.communityBullet2'), t('landing.communityBullet3')] },
  ];

  const useCases = [t('landing.archStudios'), t('landing.engTeams'), t('landing.bimConsultants'), t('landing.designAgencies'), t('landing.constructionTech')];

  return (
    <div style={{ minHeight: "100vh", background: "#07070D", color: "#F0F0F5", overflowX: "hidden", paddingBottom: 36 }}>

      {/* ── Global noise texture overlay ─────────────────────────── */}
      <div className="noise-texture" />

      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <header>
        <nav style={{
          display: "flex", alignItems: "center",
          padding: "0 max(16px, min(48px, 4vw))", height: 64,
          background: "transparent",
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 100,
        }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", marginRight: "auto" }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, overflow: "hidden",
              boxShadow: "0 2px 12px rgba(79,138,255,0.2)",
              flexShrink: 0,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.3px" }}>
              Build<span style={{ color: "#4F8AFF" }}>Flow</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: "#F59E0B", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", padding: "1px 5px", borderRadius: 6, marginLeft: 6 }}>BETA</span>
            </span>
          </Link>

          <div className="landing-nav-links" style={{ display: "flex", alignItems: "center", gap: 32, marginRight: 32 }}>
            {[
              { label: t('landing.workflows'), href: '#workflows' },
              { label: t('landing.community'), href: '#community' },
              { label: t('landing.docs'), href: '#docs' },
              { label: t('landing.pricing'), href: '#pricing' },
            ].map(l => (
              <a key={l.href} href={l.href} style={{
                fontSize: 14, color: "#9898B0", textDecoration: "none",
                fontWeight: 500, transition: "color 0.2s",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#F0F0F5"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="landing-nav-cta" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LanguageSwitcher />
            <Link href="/login" className="landing-login-link" style={{
              fontSize: 14, fontWeight: 600, color: "#F0F0F5",
              textDecoration: "none", padding: "8px 0",
            }}>
              {t('landing.login')}
            </Link>
            <Link href="/dashboard" style={{
              padding: "9px 22px", borderRadius: 10, fontSize: 14, fontWeight: 600,
              color: "white", background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              textDecoration: "none",
              boxShadow: "0 2px 12px rgba(79,138,255,0.3)",
            }}>
              {t('landing.signUp')}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── HERO ─────────────────────────────────────────────────── */}
        <motion.section
          ref={heroRef}
          style={{
            minHeight: "100vh", position: "relative",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            overflow: "hidden",
            opacity: heroOpacity,
            scale: heroScale,
          }}
        >
          {/* Background atmospheric layers */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {/* Blueprint architectural grid */}
            <div className="blueprint-grid" />

            {/* Scanning laser beam */}
            <div className="scan-beam" />

            {/* Central radial glow — stronger */}
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(79,138,255,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 30% 70%, rgba(139,92,246,0.08) 0%, transparent 50%), radial-gradient(ellipse 50% 50% at 80% 50%, rgba(59,130,246,0.06) 0%, transparent 50%)",
            }} />

            {/* Large floating gradient orbs */}
            <div className="orb-drift-1" style={{
              position: "absolute", top: "5%", left: "10%",
              width: 500, height: 500, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(79,138,255,0.12) 0%, transparent 70%)",
              filter: "blur(80px)",
            }} />
            <div className="orb-drift-2" style={{
              position: "absolute", top: "25%", right: "5%",
              width: 450, height: 450, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)",
              filter: "blur(70px)",
            }} />
            <div className="orb-drift-3" style={{
              position: "absolute", bottom: "10%", left: "35%",
              width: 400, height: 400, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)",
              filter: "blur(60px)",
            }} />

            {/* Animated SVG construction wireframe */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.15 }} viewBox="0 0 1440 900" fill="none" preserveAspectRatio="xMidYMid slice">
              {/* Building wireframe - left */}
              <g opacity="0.6">
                <path d="M120 700 L120 350 L220 300 L320 350 L320 700" stroke="rgba(79,138,255,0.5)" strokeWidth="0.8" strokeDasharray="4 4" pathLength="1" style={{ animation: "draw-line 4s ease-out forwards" }} />
                <path d="M120 450 L320 450" stroke="rgba(79,138,255,0.3)" strokeWidth="0.5" strokeDasharray="4 4" />
                <path d="M120 550 L320 550" stroke="rgba(79,138,255,0.3)" strokeWidth="0.5" strokeDasharray="4 4" />
                <path d="M170 350 L170 700" stroke="rgba(79,138,255,0.2)" strokeWidth="0.5" strokeDasharray="3 6" />
                <path d="M270 350 L270 700" stroke="rgba(79,138,255,0.2)" strokeWidth="0.5" strokeDasharray="3 6" />
              </g>

              {/* Building wireframe - right */}
              <g opacity="0.5">
                <path d="M1120 700 L1120 280 L1200 240 L1320 280 L1320 700" stroke="rgba(139,92,246,0.5)" strokeWidth="0.8" strokeDasharray="4 4" pathLength="1" style={{ animation: "draw-line 5s ease-out 1s forwards" }} />
                <path d="M1120 400 L1320 400" stroke="rgba(139,92,246,0.3)" strokeWidth="0.5" strokeDasharray="4 4" />
                <path d="M1120 500 L1320 500" stroke="rgba(139,92,246,0.3)" strokeWidth="0.5" strokeDasharray="4 4" />
                <path d="M1120 600 L1320 600" stroke="rgba(139,92,246,0.3)" strokeWidth="0.5" strokeDasharray="4 4" />
                <path d="M1220 280 L1220 700" stroke="rgba(139,92,246,0.2)" strokeWidth="0.5" strokeDasharray="3 6" />
              </g>

              {/* Crane wireframe — top right */}
              <g opacity="0.4">
                <path d="M1050 700 L1050 200 L1050 180 L900 180" stroke="rgba(245,158,11,0.5)" strokeWidth="0.8" strokeDasharray="5 5" pathLength="1" style={{ animation: "draw-line 6s ease-out 0.5s forwards" }} />
                <path d="M1050 200 L1100 200" stroke="rgba(245,158,11,0.4)" strokeWidth="0.6" strokeDasharray="3 3" />
                <path d="M900 180 L900 220" stroke="rgba(245,158,11,0.3)" strokeWidth="0.5" strokeDasharray="2 4" />
                {/* Crane cables */}
                <path d="M950 180 L950 280" stroke="rgba(245,158,11,0.2)" strokeWidth="0.4" strokeDasharray="2 6" />
                <path d="M1000 180 L1000 250" stroke="rgba(245,158,11,0.2)" strokeWidth="0.4" strokeDasharray="2 6" />
              </g>

              {/* Dimension lines — bottom */}
              <g opacity="0.35">
                <path d="M200 750 L500 750" stroke="rgba(79,138,255,0.4)" strokeWidth="0.5" />
                <path d="M200 740 L200 760" stroke="rgba(79,138,255,0.4)" strokeWidth="0.5" />
                <path d="M500 740 L500 760" stroke="rgba(79,138,255,0.4)" strokeWidth="0.5" />
                <text x="350" y="745" fill="rgba(79,138,255,0.3)" fontSize="8" textAnchor="middle" fontFamily="monospace">24.0m</text>
              </g>
              <g opacity="0.3">
                <path d="M940 750 L1320 750" stroke="rgba(139,92,246,0.4)" strokeWidth="0.5" />
                <path d="M940 740 L940 760" stroke="rgba(139,92,246,0.4)" strokeWidth="0.5" />
                <path d="M1320 740 L1320 760" stroke="rgba(139,92,246,0.4)" strokeWidth="0.5" />
                <text x="1130" y="745" fill="rgba(139,92,246,0.3)" fontSize="8" textAnchor="middle" fontFamily="monospace">32.0m</text>
              </g>

              {/* Isometric helper lines */}
              <g opacity="0.15">
                <line x1="0" y1="800" x2="600" y2="500" stroke="rgba(79,138,255,0.3)" strokeWidth="0.5" strokeDasharray="8 12" />
                <line x1="1440" y1="800" x2="840" y2="500" stroke="rgba(139,92,246,0.3)" strokeWidth="0.5" strokeDasharray="8 12" />
              </g>

              {/* Grid intersection glow dots */}
              {[
                { cx: 120, cy: 350, delay: "0s" }, { cx: 320, cy: 350, delay: "0.3s" },
                { cx: 1120, cy: 280, delay: "1s" }, { cx: 1320, cy: 280, delay: "1.3s" },
                { cx: 1050, cy: 200, delay: "0.5s" }, { cx: 900, cy: 180, delay: "0.8s" },
                { cx: 220, cy: 300, delay: "0.2s" }, { cx: 1200, cy: 240, delay: "1.2s" },
              ].map((dot, i) => (
                <circle key={i} cx={dot.cx} cy={dot.cy} r="2.5" fill="#4F8AFF" opacity="0" style={{ animation: `intersection-pulse 3s ease-in-out ${dot.delay} infinite` }} />
              ))}
            </svg>

            {/* Dot grid pattern (subtle) */}
            <div style={{
              position: "absolute", inset: 0, opacity: 0.35,
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }} />
          </div>

          {/* Side toolbar */}
          <SideToolbar />

          {/* Floating prompt card */}
          <PromptCard labelText={t('landing.aiPrompt')} quoteText={t('landing.promptQuote')} />

          {/* Floating node cards */}
          <FloatingCard label="PDF Upload" category="input" delay={0.6} style={{ right: 80, top: 140, transform: "rotate(3deg)" }} />
          <FloatingCard label="Massing Gen" category="generate" delay={0.9} style={{ right: 120, bottom: 200, transform: "rotate(-2deg)" }} />
          <FloatingCard label="Image Render" category="generate" delay={1.2} style={{ left: 140, bottom: 160, transform: "rotate(1deg)" }} />

          {/* Main hero content */}
          <div style={{ position: "relative", zIndex: 30, textAlign: "center", maxWidth: 1000, padding: "0 48px" }}>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: smoothEase }}
            >
              <h1 style={{
                fontSize: "clamp(3.5rem, 8vw, 7rem)",
                fontWeight: 900, lineHeight: 0.95,
                letterSpacing: "-0.04em",
                marginBottom: 0,
                textTransform: "uppercase",
              }}>
                <span style={{ color: "#F0F0F5", display: "block" }}>
                  {t('landing.heroLine1')}
                </span>
                <span style={{
                  display: "block",
                  background: "linear-gradient(135deg, #7C6FF7 0%, #A78BFA 40%, #C084FC 100%)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                  {t('landing.heroLine2')}
                </span>
                <span style={{ color: "#F0F0F5", display: "block" }}>
                  {t('landing.heroLine3')}
                </span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6, ease: smoothEase }}
              style={{
                fontSize: 18, color: "#9898B0", lineHeight: 1.7,
                maxWidth: 600, margin: "32px auto 0", letterSpacing: "-0.005em",
              }}
            >
              {t('landing.heroSubtitle')}
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              style={{
                fontSize: 13, color: "#5C5C78", lineHeight: 1.6,
                maxWidth: 500, margin: "12px auto 0", fontStyle: "italic",
              }}
            >
              {t('landing.positioningNote')}
            </motion.p>

            {/* Prompt bar */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6, ease: smoothEase }}
              className="landing-prompt-bar"
              style={{
                marginTop: 40, maxWidth: 640, margin: "40px auto 0",
                display: "flex", alignItems: "center", gap: 0,
                position: "relative",
              }}
            >
              <div style={{
                flex: 1, position: "relative", height: 56,
                background: "rgba(18,18,30,0.8)", backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "14px 0 0 14px",
                display: "flex", alignItems: "center",
                paddingLeft: 16,
              }}>
                <Sparkles size={18} style={{ color: "#5C5C78", flexShrink: 0 }} />
                <RotatingPlaceholder items={promptExamples} />
              </div>
              <Link href="/dashboard" style={{
                height: 56, padding: "0 28px",
                background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                borderRadius: "0 14px 14px 0",
                display: "flex", alignItems: "center", gap: 8,
                color: "white", fontSize: 15, fontWeight: 700,
                textDecoration: "none", flexShrink: 0,
                boxShadow: "0 0 30px rgba(79,138,255,0.3)",
                transition: "all 0.2s",
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 40px rgba(79,138,255,0.5)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 30px rgba(79,138,255,0.3)";
                }}
              >
                <Zap size={16} />
                {t('landing.getStarted')}
              </Link>
            </motion.div>

            {/* Secondary CTA */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 24 }}
            >
              <Link href="/demo" style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 20px", borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)",
                color: "#F0F0F5", fontSize: 14, fontWeight: 600,
                textDecoration: "none", transition: "all 0.15s",
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
                }}
              >
                <Calendar size={15} />
                {t('landing.bookDemo')}
              </Link>
            </motion.div>
          </div>

          {/* Partner logos at bottom of hero */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            className="landing-partners"
            style={{
              position: "absolute", bottom: 48, left: 0, right: 0,
              display: "flex", justifyContent: "center", gap: 56,
              zIndex: 30,
            }}
          >
            {PARTNER_LOGOS.map(name => (
              <span key={name} style={{
                fontSize: 14, fontWeight: 700, color: "#3A3A50",
                letterSpacing: "2px", textTransform: "uppercase",
                transition: "color 0.2s", cursor: "default",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#3A3A50"; }}
              >
                {name}
              </span>
            ))}
          </motion.div>
        </motion.section>

        {/* ── Core Capabilities — Workflow Pipeline Visual ────────── */}
        <section className="landing-section" style={{
          padding: "120px 48px 80px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A14 100%)",
        }}>
          {/* Background: Isometric grid + animated pipeline SVG */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="isometric-grid" />
            {/* Animated pipeline SVG running across section */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1440 700" fill="none" preserveAspectRatio="xMidYMid slice">
              {/* Horizontal pipeline */}
              <path d="M-50 350 Q200 350 360 280 Q520 210 720 350 Q920 490 1100 350 Q1280 210 1500 350" stroke="rgba(79,138,255,0.08)" strokeWidth="2" fill="none" />
              <path d="M-50 350 Q200 350 360 280 Q520 210 720 350 Q920 490 1100 350 Q1280 210 1500 350" stroke="rgba(79,138,255,0.15)" strokeWidth="1.5" fill="none" className="wire-animate" />
              {/* Branch lines */}
              <path d="M360 280 L360 150" stroke="rgba(59,130,246,0.1)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "0.5s" }} />
              <path d="M720 350 L720 180" stroke="rgba(139,92,246,0.1)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "1s" }} />
              <path d="M1100 350 L1100 180" stroke="rgba(16,185,129,0.1)" strokeWidth="1" className="wire-animate" style={{ animationDelay: "1.5s" }} />
              {/* Junction nodes */}
              <circle cx="360" cy="280" r="4" fill="#3B82F6" opacity="0.6">
                <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx="720" cy="350" r="4" fill="#8B5CF6" opacity="0.6">
                <animate attributeName="r" values="3;6;3" dur="2s" begin="0.7s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" begin="0.7s" repeatCount="indefinite" />
              </circle>
              <circle cx="1100" cy="350" r="4" fill="#10B981" opacity="0.6">
                <animate attributeName="r" values="3;6;3" dur="2s" begin="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" begin="1.4s" repeatCount="indefinite" />
              </circle>
              {/* Dimension annotations */}
              <line x1="200" y1="600" x2="540" y2="600" stroke="rgba(79,138,255,0.15)" strokeWidth="0.5" />
              <line x1="200" y1="595" x2="200" y2="605" stroke="rgba(79,138,255,0.15)" strokeWidth="0.5" />
              <line x1="540" y1="595" x2="540" y2="605" stroke="rgba(79,138,255,0.15)" strokeWidth="0.5" />
              <text x="370" y="618" className="dimension-label" textAnchor="middle">INPUT STAGE</text>
              <line x1="600" y1="600" x2="840" y2="600" stroke="rgba(139,92,246,0.15)" strokeWidth="0.5" />
              <line x1="600" y1="595" x2="600" y2="605" stroke="rgba(139,92,246,0.15)" strokeWidth="0.5" />
              <line x1="840" y1="595" x2="840" y2="605" stroke="rgba(139,92,246,0.15)" strokeWidth="0.5" />
              <text x="720" y="618" className="dimension-label" textAnchor="middle">PROCESS STAGE</text>
              <line x1="900" y1="600" x2="1240" y2="600" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" />
              <line x1="900" y1="595" x2="900" y2="605" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" />
              <line x1="1240" y1="595" x2="1240" y2="605" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" />
              <text x="1070" y="618" className="dimension-label" textAnchor="middle">OUTPUT STAGE</text>
            </svg>
            <div className="orb-drift-1" style={{ position: "absolute", top: "5%", left: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)", filter: "blur(80px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 20 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block" }}>
                {t('landing.coreCapabilities')}
              </span>
              <div className="accent-line" />
              <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05 }}>
                <span style={{ color: "#F0F0F5" }}>{t('landing.fromIdeaTo')} </span>
                <span style={{ background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 50%, #C084FC 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.reality')}</span>
              </h2>
            </motion.div>

            {/* Pipeline visualization: 3 node cards connected by animated wires */}
            <div style={{ position: "relative", marginTop: 80 }}>
              {/* SVG connection wires between cards */}
              <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} viewBox="0 0 1200 320" preserveAspectRatio="xMidYMid meet">
                <path d="M380 160 Q480 160 500 160 Q520 160 520 160 L430 160" stroke="rgba(79,138,255,0.2)" strokeWidth="2" fill="none" className="wire-animate" />
                <path d="M790 160 Q890 160 910 160" stroke="rgba(139,92,246,0.2)" strokeWidth="2" fill="none" className="wire-animate" style={{ animationDelay: "1s" }} />
                {/* Data flow dots */}
                <circle r="4" fill="#4F8AFF">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M380 160 L520 160" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2s" repeatCount="indefinite" />
                </circle>
                <circle r="4" fill="#8B5CF6">
                  <animateMotion dur="2s" repeatCount="indefinite" begin="0.7s" path="M790 160 L910 160" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2s" begin="0.7s" repeatCount="indefinite" />
                </circle>
              </svg>

              <motion.div
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
                variants={stagger}
                className="landing-pipeline-grid"
                style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 80px 1fr", gap: 0, alignItems: "stretch", position: "relative", zIndex: 1 }}
              >
                {[
                  { icon: <Box size={24} />, color: "#3B82F6", title: t('landing.textTo3d'), description: t('landing.textTo3dDesc'), badge: t('landing.aiPoweredBadge'), nodeType: "INPUT" },
                  { icon: <ImageIcon size={24} />, color: "#8B5CF6", title: t('landing.instantRenders'), description: t('landing.instantRendersDesc'), badge: t('landing.fastBadge'), nodeType: "GENERATE" },
                  { icon: <FileCode size={24} />, color: "#10B981", title: t('landing.ifcExport'), description: t('landing.ifcExportDesc'), badge: t('landing.bimReady'), nodeType: "EXPORT" },
                ].map((f, i) => {
                  const rgb = hexToRgb(f.color);
                  return (
                    <React.Fragment key={f.title}>
                      <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.15, ease: smoothEase }}
                        className="node-card"
                        style={{ '--node-port-color': f.color } as React.CSSProperties}
                      >
                        {/* Node type header */}
                        <div className="node-header" style={{
                          background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.05))`,
                          borderBottom: `1px solid rgba(${rgb}, 0.15)`,
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: f.color, boxShadow: `0 0 8px ${f.color}` }} />
                          <span style={{ color: f.color }}>{f.nodeType}</span>
                          {f.badge && (
                            <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 8px", borderRadius: 10, background: `rgba(${rgb}, 0.2)`, color: f.color }}>
                              {f.badge}
                            </span>
                          )}
                        </div>
                        {/* Node body */}
                        <div style={{ padding: "24px 24px 28px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                            <div style={{ width: 48, height: 48, borderRadius: 12, background: `linear-gradient(135deg, rgba(${rgb}, 0.2), rgba(${rgb}, 0.06))`, border: `1px solid rgba(${rgb}, 0.2)`, display: "flex", alignItems: "center", justifyContent: "center", color: f.color, flexShrink: 0 }}>
                              {f.icon}
                            </div>
                            <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.02em" }}>{f.title}</h3>
                          </div>
                          <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.7 }}>{f.description}</p>
                          {/* Mini progress bar */}
                          <div style={{ marginTop: 20, height: 3, borderRadius: 2, background: `rgba(${rgb}, 0.1)`, overflow: "hidden" }}>
                            <motion.div
                              initial={{ width: 0 }}
                              whileInView={{ width: "100%" }}
                              viewport={{ once: true }}
                              transition={{ duration: 2, delay: 0.5 + i * 0.3, ease: "easeOut" }}
                              style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${f.color}, rgba(${rgb}, 0.3))` }}
                            />
                          </div>
                        </div>
                      </motion.div>
                      {/* Wire connector between nodes */}
                      {i < 2 && (
                        <div className="landing-wire-connector" style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                          <svg width="80" height="40" viewBox="0 0 80 40" fill="none">
                            <path d="M0 20 L80 20" stroke={`rgba(${hexToRgb(i === 0 ? "#8B5CF6" : "#10B981")}, 0.3)`} strokeWidth="2" className="wire-animate" style={{ animationDelay: `${i * 0.5}s` }} />
                            <circle cx="40" cy="20" r="4" fill={i === 0 ? "#8B5CF6" : "#10B981"}>
                              <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />
                            </circle>
                          </svg>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── Built For Strip — Node Connection Bar ─────────────── */}
        <div className="landing-section" style={{
          borderTop: "1px solid rgba(79,138,255,0.08)", borderBottom: "1px solid rgba(79,138,255,0.08)",
          padding: "24px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(90deg, rgba(11,11,19,0.9), rgba(18,18,34,0.5), rgba(11,11,19,0.9))",
        }}>
          {/* Animated beam running across */}
          <div className="beam-accent" style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
          <div className="landing-built-for" style={{ display: "flex", alignItems: "center", gap: 40, justifyContent: "center" }}>
            <span className="blueprint-annotation" style={{ whiteSpace: "nowrap", animation: "none", opacity: 0.6 }}>{t('landing.builtFor')}</span>
            <div className="landing-built-for-divider" style={{ width: 1, height: 20, background: "rgba(79,138,255,0.15)" }} />
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
              {useCases.map((c, i) => (
                <React.Fragment key={c}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#5C5C78", letterSpacing: "1.5px", textTransform: "uppercase", transition: "all 0.3s", cursor: "default", position: "relative" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#4F8AFF"; el.style.textShadow = "0 0 20px rgba(79,138,255,0.4)"; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#5C5C78"; el.style.textShadow = "none"; }}
                  >{c}</span>
                  {i < useCases.length - 1 && (
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(79,138,255,0.2)", border: "1px solid rgba(79,138,255,0.3)" }} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="beam-accent" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} />
        </div>

        {/* ── Features — Interactive Node Graph ────────────────────── */}
        <section id="features" className="landing-section" style={{ padding: "120px 48px", position: "relative", overflow: "hidden" }}>
          {/* Background: blueprint + construction SVG */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.25 }} />
            {/* Construction wireframe background */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.3 }} viewBox="0 0 1440 800" fill="none" preserveAspectRatio="xMidYMid slice">
              {/* Building wireframe */}
              <rect x="100" y="300" width="200" height="400" stroke="rgba(79,138,255,0.06)" strokeWidth="0.5" fill="none" strokeDasharray="4 4" />
              <rect x="120" y="320" width="60" height="80" stroke="rgba(79,138,255,0.04)" strokeWidth="0.5" fill="none" />
              <rect x="200" y="320" width="60" height="80" stroke="rgba(79,138,255,0.04)" strokeWidth="0.5" fill="none" />
              <rect x="120" y="420" width="60" height="80" stroke="rgba(79,138,255,0.04)" strokeWidth="0.5" fill="none" />
              <rect x="200" y="420" width="60" height="80" stroke="rgba(79,138,255,0.04)" strokeWidth="0.5" fill="none" />
              {/* Second building */}
              <rect x="1140" y="250" width="180" height="450" stroke="rgba(139,92,246,0.06)" strokeWidth="0.5" fill="none" strokeDasharray="4 4" />
              <rect x="1160" y="270" width="50" height="70" stroke="rgba(139,92,246,0.04)" strokeWidth="0.5" fill="none" />
              <rect x="1230" y="270" width="50" height="70" stroke="rgba(139,92,246,0.04)" strokeWidth="0.5" fill="none" />
              {/* Crane */}
              <line x1="400" y1="100" x2="400" y2="700" stroke="rgba(79,138,255,0.04)" strokeWidth="1" />
              <line x1="350" y1="100" x2="600" y2="100" stroke="rgba(79,138,255,0.05)" strokeWidth="1" />
              <line x1="400" y1="100" x2="350" y2="150" stroke="rgba(79,138,255,0.04)" strokeWidth="0.5" />
              <line x1="580" y1="100" x2="560" y2="280" stroke="rgba(79,138,255,0.03)" strokeWidth="0.5" strokeDasharray="3 3" />
            </svg>
            <div className="orb-drift-2" style={{ position: "absolute", bottom: "10%", left: "5%", width: 450, height: 450, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)", filter: "blur(80px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", top: "10%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)", filter: "blur(70px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 80 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block" }}>
                {t('landing.platform')}
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #8B5CF6, #4F8AFF)" }} />
              <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 20 }}>
                {t('landing.everythingYouNeed')}<br />
                <span style={{ background: "linear-gradient(135deg, #4F8AFF, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.automateAec')}</span>
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96", maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
                {t('landing.purposeBuilt')}
              </p>
            </motion.div>

            {/* Feature cards as connected nodes */}
            <div style={{ position: "relative" }}>
              {/* SVG connecting all 3 feature nodes */}
              <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} viewBox="0 0 1200 450" preserveAspectRatio="xMidYMid meet">
                {/* Vertical pipeline trunk */}
                <path d="M600 0 L600 450" stroke="rgba(79,138,255,0.06)" strokeWidth="1" />
                {/* Branch to left card */}
                <path d="M600 150 Q500 150 400 150" stroke="rgba(59,130,246,0.12)" strokeWidth="1.5" className="wire-animate" />
                {/* Branch to center */}
                <path d="M600 225 Q600 225 600 225" stroke="rgba(139,92,246,0.12)" strokeWidth="1.5" />
                {/* Branch to right card */}
                <path d="M600 300 Q700 300 800 300" stroke="rgba(16,185,129,0.12)" strokeWidth="1.5" className="wire-animate" style={{ animationDelay: "1s" }} />
              </svg>

              <motion.div
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
                variants={stagger}
                className="landing-grid-3"
                style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32, position: "relative", zIndex: 1 }}
              >
                {features.map((f, idx) => {
                  const rgb = hexToRgb(f.color);
                  return (
                    <motion.div key={f.title} variants={fadeUp} transition={{ duration: 0.5, delay: idx * 0.12, ease: smoothEase }}
                      className="node-card"
                      style={{ '--node-port-color': f.color } as React.CSSProperties}
                    >
                      {/* Node header */}
                      <div className="node-header" style={{
                        background: `linear-gradient(135deg, rgba(${rgb}, 0.12), rgba(${rgb}, 0.04))`,
                        borderBottom: `1px solid rgba(${rgb}, 0.12)`,
                        borderRadius: "16px 16px 0 0",
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: f.color, boxShadow: `0 0 8px ${f.color}` }} />
                        <span style={{ color: f.color }}>{["INPUT", "TRANSFORM", "GENERATE"][idx]}</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>v{idx + 1}.0</span>
                      </div>

                      <div style={{ padding: "28px 24px 32px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                          <div style={{ width: 52, height: 52, borderRadius: 14, background: `linear-gradient(135deg, rgba(${rgb}, 0.2), rgba(${rgb}, 0.06))`, border: `1px solid rgba(${rgb}, 0.2)`, display: "flex", alignItems: "center", justifyContent: "center", color: f.color }}>
                            {f.icon}
                          </div>
                          <div>
                            <h3 style={{ fontSize: 19, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.02em" }}>{f.title}</h3>
                          </div>
                        </div>
                        <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.7, marginBottom: 24 }}>{f.description}</p>

                        {/* Bullets styled as node outputs */}
                        <div style={{ borderTop: `1px solid rgba(${rgb}, 0.1)`, paddingTop: 16 }}>
                          {f.bullets.map((b, bi) => (
                            <div key={b} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#9898B0", marginBottom: 10 }}>
                              <div style={{ width: 18, height: 18, borderRadius: 4, background: `rgba(${rgb}, 0.08)`, border: `1px solid rgba(${rgb}, 0.15)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <div style={{ width: 4, height: 4, borderRadius: "50%", background: f.color }} />
                              </div>
                              {b}
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── Workflow Showcase — Live Pipeline Demos ───────────────── */}
        <section id="workflows" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A16 50%, #07070D 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="isometric-grid" style={{ opacity: 0.3 }} />
            {/* Animated pipeline running through section */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1440 600" fill="none" preserveAspectRatio="xMidYMid slice">
              <path d="M0 300 Q360 200 720 300 Q1080 400 1440 300" stroke="rgba(16,185,129,0.08)" strokeWidth="2" fill="none" />
              <path d="M0 300 Q360 200 720 300 Q1080 400 1440 300" stroke="rgba(16,185,129,0.15)" strokeWidth="1" fill="none" className="wire-animate" />
            </svg>
            <div className="orb-drift-3" style={{ position: "absolute", top: "5%", left: "8%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)", filter: "blur(70px)" }} />
            <div className="orb-drift-1" style={{ position: "absolute", bottom: "10%", right: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", filter: "blur(60px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 80 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(16,185,129,0.5)" }}>
                {t('landing.templatesSection')}
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #10B981, #34D399)" }} />
              <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.05 }}>
                {t('landing.fromBrief')}<br />
                <span style={{ background: "linear-gradient(135deg, #10B981, #34D399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.inMinutes')}</span>
              </h2>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
              className="landing-grid-3"
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}
            >
              {SHOWCASE.map(({ id, badge }) => {
                const wf = PREBUILT_WORKFLOWS.find(w => w.id === id);
                if (!wf) return null;
                const nodes = wf.tileGraph.nodes.map(n => ({ label: n.data.label, category: n.data.category as string }));
                return (
                  <motion.div key={id} variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
                    className="node-card"
                    style={{
                      '--node-port-color': badge ? '#F59E0B' : '#10B981',
                      border: badge ? "1.5px solid rgba(245,158,11,0.25)" : undefined,
                    } as React.CSSProperties}
                  >
                    {/* Node header */}
                    <div className="node-header" style={{
                      background: badge ? "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.03))" : "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))",
                      borderBottom: badge ? "1px solid rgba(245,158,11,0.12)" : "1px solid rgba(16,185,129,0.08)",
                      borderRadius: "16px 16px 0 0",
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: badge ? "#F59E0B" : "#10B981", boxShadow: `0 0 8px ${badge ? "#F59E0B" : "#10B981"}` }} />
                      <span style={{ color: badge ? "#F59E0B" : "#10B981" }}>WORKFLOW</span>
                      {badge && (
                        <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 8px", borderRadius: 10, background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "white", fontWeight: 700 }}>
                          {badge}
                        </span>
                      )}
                    </div>
                    <div style={{
                      height: 120, background: "rgba(7,7,13,0.6)",
                      borderBottom: "1px solid rgba(255,255,255,0.04)", position: "relative",
                      backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.015) 1px, transparent 1px)",
                      backgroundSize: "16px 16px",
                    }}>
                      <MiniWorkflowDiagram nodes={nodes} size="md" animated />
                    </div>
                    <div style={{ padding: "20px 24px" }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F5", marginBottom: 8 }}>{wf.name}</h3>
                      <p style={{ fontSize: 12, color: "#5C5C78", lineHeight: 1.5, marginBottom: 14, fontFamily: "monospace" }}>
                        {wf.tileGraph.nodes.length} nodes · {wf.estimatedRunTime}
                      </p>
                      <Link href="/dashboard/templates" style={{
                        fontSize: 13, fontWeight: 600, color: "#10B981", textDecoration: "none",
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "6px 14px", borderRadius: 8,
                        background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)",
                        transition: "all 0.2s",
                      }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(16,185,129,0.15)"; el.style.boxShadow = "0 0 20px rgba(16,185,129,0.1)"; }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(16,185,129,0.08)"; el.style.boxShadow = "none"; }}
                      >
                        {t('landing.tryWorkflow')} <ArrowRight size={13} />
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* ── How It Works — Horizontal Pipeline ───────────────────── */}
        <section id="community" className="landing-section" style={{ padding: "120px 48px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.2 }} />
            {/* Large animated pipeline SVG */}
            <svg style={{ position: "absolute", top: "50%", left: 0, width: "100%", height: "200px", transform: "translateY(-50%)" }} viewBox="0 0 1440 200" fill="none" preserveAspectRatio="none">
              <path d="M0 100 L1440 100" stroke="rgba(79,138,255,0.05)" strokeWidth="60" strokeLinecap="round" />
              <path d="M0 100 L1440 100" stroke="rgba(79,138,255,0.08)" strokeWidth="2" fill="none" className="wire-animate" />
              <path d="M0 100 L1440 100" stroke="rgba(139,92,246,0.06)" strokeWidth="1" fill="none" className="wire-animate" style={{ animationDelay: "1s" }} />
              {/* Flow particles */}
              <circle r="5" fill="#4F8AFF" opacity="0.8">
                <animateMotion dur="4s" repeatCount="indefinite" path="M0 100 L1440 100" />
                <animate attributeName="opacity" values="0;0.8;0.8;0" dur="4s" repeatCount="indefinite" />
              </circle>
              <circle r="3" fill="#8B5CF6" opacity="0.6">
                <animateMotion dur="4s" repeatCount="indefinite" begin="1.3s" path="M0 100 L1440 100" />
                <animate attributeName="opacity" values="0;0.6;0.6;0" dur="4s" begin="1.3s" repeatCount="indefinite" />
              </circle>
              <circle r="4" fill="#10B981" opacity="0.7">
                <animateMotion dur="4s" repeatCount="indefinite" begin="2.6s" path="M0 100 L1440 100" />
                <animate attributeName="opacity" values="0;0.7;0.7;0" dur="4s" begin="2.6s" repeatCount="indefinite" />
              </circle>
            </svg>
            <div className="orb-drift-1" style={{ position: "absolute", bottom: "5%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)", filter: "blur(60px)" }} />
          </div>

          <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 80 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(245,158,11,0.5)" }}>
                {t('landing.howItWorks')}
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #F59E0B, #EF4444)" }} />
              <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.05 }}>
                {t('landing.threeSteps')}<br />
                <span style={{ background: "linear-gradient(135deg, #F59E0B, #EF4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.launch')}</span>
              </h2>
            </motion.div>

            {/* Three steps as pipeline nodes */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={stagger}
              className="landing-steps"
              style={{ display: "flex", alignItems: "center", gap: 0 }}
            >
              {[
                { num: "01", title: t('landing.dragDrop'), desc: t('landing.dragDropDesc'), icon: <LayoutGrid size={28} />, color: "#3B82F6" },
                { num: "02", title: t('landing.connect'), desc: t('landing.connectDesc'), icon: <Zap size={28} />, color: "#8B5CF6" },
                { num: "03", title: t('landing.run'), desc: t('landing.runDesc'), icon: <Play size={28} />, color: "#10B981" },
              ].map((step, i) => {
                const rgb = hexToRgb(step.color);
                return (
                  <React.Fragment key={step.num}>
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.15, ease: smoothEase }}
                      className="node-card"
                      style={{ flex: 1, '--node-port-color': step.color } as React.CSSProperties}
                    >
                      {/* Step node header */}
                      <div className="node-header" style={{
                        background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.04))`,
                        borderBottom: `1px solid rgba(${rgb}, 0.12)`,
                        borderRadius: "16px 16px 0 0",
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: step.color, boxShadow: `0 0 8px ${step.color}` }} />
                        <span style={{ color: step.color }}>STEP {step.num}</span>
                      </div>
                      <div style={{ padding: "32px 24px", textAlign: "center" }}>
                        <div style={{
                          width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
                          background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.05))`,
                          border: `1px solid rgba(${rgb}, 0.2)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: step.color,
                          boxShadow: `0 0 30px rgba(${rgb}, 0.1)`,
                        }}>
                          {step.icon}
                        </div>
                        <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 10, letterSpacing: "-0.02em" }}>{step.title}</h3>
                        <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.7 }}>{step.desc}</p>
                      </div>
                    </motion.div>
                    {/* Animated wire connector */}
                    {i < 2 && (
                      <div className="landing-step-connector" style={{ width: 60, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="60" height="40" viewBox="0 0 60 40" fill="none">
                          <path d="M0 20 L60 20" stroke={`rgba(${hexToRgb(i === 0 ? "#8B5CF6" : "#10B981")}, 0.3)`} strokeWidth="2" className="wire-animate" />
                          <circle r="5" fill={i === 0 ? "#8B5CF6" : "#10B981"}>
                            <animateMotion dur="1.5s" repeatCount="indefinite" path="M0 20 L60 20" />
                            <animate attributeName="opacity" values="0;1;1;0" dur="1.5s" repeatCount="indefinite" />
                          </circle>
                        </svg>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* ── Pricing — Node-Style Plan Cards ──────────────────────── */}
        <section id="pricing" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A14 50%, #07070D 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="isometric-grid" style={{ opacity: 0.25 }} />
            {/* Background pipeline */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1440 800" fill="none" preserveAspectRatio="xMidYMid slice">
              <path d="M200 400 Q720 300 1240 400" stroke="rgba(79,138,255,0.06)" strokeWidth="80" strokeLinecap="round" fill="none" />
              <path d="M200 400 Q720 300 1240 400" stroke="rgba(79,138,255,0.1)" strokeWidth="1.5" fill="none" className="wire-animate" />
              {/* Dimension lines */}
              <line x1="300" y1="700" x2="500" y2="700" stroke="rgba(79,138,255,0.1)" strokeWidth="0.5" />
              <text x="400" y="720" className="dimension-label" textAnchor="middle">STARTER</text>
              <line x1="600" y1="700" x2="840" y2="700" stroke="rgba(79,138,255,0.15)" strokeWidth="0.5" />
              <text x="720" y="720" className="dimension-label" textAnchor="middle">PROFESSIONAL</text>
              <line x1="940" y1="700" x2="1140" y2="700" stroke="rgba(139,92,246,0.1)" strokeWidth="0.5" />
              <text x="1040" y="720" className="dimension-label" textAnchor="middle">ENTERPRISE</text>
            </svg>
            <div className="orb-drift-2" style={{ position: "absolute", top: "5%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", filter: "blur(70px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", bottom: "10%", right: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)", filter: "blur(60px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 80 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block" }}>
                {t('landing.pricingSection')}
              </span>
              <div className="accent-line" />
              <h2 style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 16 }}>
                {t('landing.simpleTransparent')}<span style={{ background: "linear-gradient(135deg, #4F8AFF, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.transparent')}</span>{t('landing.pricingTitle')}
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96" }}>{t('landing.choosePlan')}</p>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
              className="landing-grid-3"
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, alignItems: "start" }}
            >
              {/* FREE */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
                className="node-card"
                style={{ '--node-port-color': '#4F8AFF' } as React.CSSProperties}
              >
                <div className="node-header" style={{
                  background: "linear-gradient(135deg, rgba(79,138,255,0.08), rgba(79,138,255,0.02))",
                  borderBottom: "1px solid rgba(79,138,255,0.1)",
                  borderRadius: "16px 16px 0 0",
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 8px #4F8AFF" }} />
                  <span style={{ color: "#4F8AFF" }}>FREE TIER</span>
                </div>
                <div style={{ padding: "28px 24px" }}>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.free')}</h3>
                  <p style={{ fontSize: 13, color: "#7878A0", marginBottom: 24 }}>{t('landing.freeDesc')}</p>
                  <div style={{ marginBottom: 28 }}>
                    <span style={{ fontSize: 48, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>{t('landing.freePrice')}</span>
                    <span style={{ fontSize: 15, color: "#5C5C78", marginLeft: 8 }}>{t('landing.perMonth')}</span>
                  </div>
                  <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "13px 24px", borderRadius: 12, border: "1px solid rgba(79,138,255,0.15)", background: "rgba(79,138,255,0.05)", color: "#F0F0F5", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 28, transition: "all 0.2s" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(79,138,255,0.1)"; el.style.boxShadow = "0 0 20px rgba(79,138,255,0.1)"; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(79,138,255,0.05)"; el.style.boxShadow = "none"; }}
                  >{t('landing.getStarted')}</Link>
                  <div style={{ borderTop: "1px solid rgba(79,138,255,0.08)", paddingTop: 20 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#5C5C78", marginBottom: 14, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.includes')}</div>
                    {tArray('landing.freeFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><div style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(79,138,255,0.08)", border: "1px solid rgba(79,138,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 4, height: 4, borderRadius: "50%", background: "#4F8AFF" }} /></div><span style={{ fontSize: 13, color: "#9898B0" }}>{f}</span></div>))}
                  </div>
                </div>
              </motion.div>

              {/* PRO */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
                className="node-card"
                style={{
                  '--node-port-color': '#4F8AFF',
                  border: "1.5px solid rgba(79,138,255,0.2)",
                  boxShadow: "0 0 60px rgba(79,138,255,0.06)",
                  transform: "scale(1.02)",
                } as React.CSSProperties}
              >
                <div className="node-header" style={{
                  background: "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(99,102,241,0.08))",
                  borderBottom: "1px solid rgba(79,138,255,0.15)",
                  borderRadius: "15px 15px 0 0",
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 8px #4F8AFF" }} />
                  <span style={{ color: "#4F8AFF" }}>PRO TIER</span>
                  <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 8px", borderRadius: 10, background: "linear-gradient(135deg, #4F8AFF, #6366F1)", color: "white", fontWeight: 700 }}>
                    {t('landing.mostPopular')}
                  </span>
                </div>
                <div style={{ padding: "28px 24px" }}>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.proTitle')}</h3>
                  <p style={{ fontSize: 13, color: "#7878A0", marginBottom: 24 }}>{t('landing.proDesc')}</p>
                  <div style={{ marginBottom: 20 }}>
                    <span style={{ fontSize: 48, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>$29</span>
                    <span style={{ fontSize: 15, color: "#5C5C78", marginLeft: 8 }}>{t('landing.perMonth')}</span>
                  </div>
                  <div style={{ marginBottom: 24, padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
                    <span style={{ fontSize: 12, color: "#10B981", fontWeight: 700 }}>{t('landing.proHighlight')}</span>
                  </div>
                  <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 24px", borderRadius: 12, background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)", color: "white", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 28, boxShadow: "0 4px 20px rgba(79,138,255,0.3)", transition: "all 0.2s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(79,138,255,0.4)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(79,138,255,0.3)"; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
                  >{t('landing.startFreeTrial')}</Link>
                  <div style={{ borderTop: "1px solid rgba(79,138,255,0.1)", paddingTop: 20 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#5C5C78", marginBottom: 14, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.proIncludes')}</div>
                    {tArray('landing.proFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><div style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(79,138,255,0.1)", border: "1px solid rgba(79,138,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 4, height: 4, borderRadius: "50%", background: "#4F8AFF" }} /></div><span style={{ fontSize: 13, color: "#D0D0E0" }}>{f}</span></div>))}
                  </div>
                </div>
              </motion.div>

              {/* ENTERPRISE */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
                className="node-card"
                style={{ '--node-port-color': '#8B5CF6' } as React.CSSProperties}
              >
                <div className="node-header" style={{
                  background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(139,92,246,0.03))",
                  borderBottom: "1px solid rgba(139,92,246,0.1)",
                  borderRadius: "16px 16px 0 0",
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8B5CF6", boxShadow: "0 0 8px #8B5CF6" }} />
                  <span style={{ color: "#8B5CF6" }}>ENTERPRISE</span>
                </div>
                <div style={{ padding: "28px 24px" }}>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.enterprise')}</h3>
                  <p style={{ fontSize: 13, color: "#7878A0", marginBottom: 24 }}>{t('landing.enterpriseDesc')}</p>
                  <div style={{ marginBottom: 28 }}>
                    <span style={{ fontSize: 36, fontWeight: 900, color: "#F0F0F5" }}>{t('landing.custom')}</span>
                  </div>
                  <a href="mailto:sales@buildflow.com" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "13px 24px", borderRadius: 12, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.05)", color: "#F0F0F5", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 28, transition: "all 0.2s" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(139,92,246,0.1)"; el.style.boxShadow = "0 0 20px rgba(139,92,246,0.1)"; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(139,92,246,0.05)"; el.style.boxShadow = "none"; }}
                  >{t('landing.contactSales')}</a>
                  <div style={{ borderTop: "1px solid rgba(139,92,246,0.08)", paddingTop: 20 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#5C5C78", marginBottom: 14, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>{t('landing.enterpriseIncludes')}</div>
                    {tArray('landing.enterpriseFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><div style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 4, height: 4, borderRadius: "50%", background: "#8B5CF6" }} /></div><span style={{ fontSize: 13, color: "#9898B0" }}>{f}</span></div>))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ── Final CTA — Converging Pipeline ──────────────────────── */}
        <section className="landing-section" style={{
          padding: "140px 48px", position: "relative", overflow: "hidden",
          textAlign: "center",
        }}>
          {/* Background: Converging workflow lines */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.2 }} />
            {/* Converging pipeline SVG */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1440 600" fill="none" preserveAspectRatio="xMidYMid slice">
              {/* Three lines converging to center */}
              <path d="M0 100 Q400 100 720 300" stroke="rgba(59,130,246,0.12)" strokeWidth="1.5" fill="none" className="wire-animate" />
              <path d="M0 300 Q400 300 720 300" stroke="rgba(139,92,246,0.12)" strokeWidth="1.5" fill="none" className="wire-animate" style={{ animationDelay: "0.7s" }} />
              <path d="M0 500 Q400 500 720 300" stroke="rgba(16,185,129,0.12)" strokeWidth="1.5" fill="none" className="wire-animate" style={{ animationDelay: "1.4s" }} />
              {/* Output line from center to right */}
              <path d="M720 300 Q1040 300 1440 300" stroke="rgba(79,138,255,0.15)" strokeWidth="2" fill="none" className="wire-animate" style={{ animationDelay: "2s" }} />
              {/* Center merge node */}
              <circle cx="720" cy="300" r="8" fill="none" stroke="rgba(79,138,255,0.4)" strokeWidth="2">
                <animate attributeName="r" values="6;12;6" dur="3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite" />
              </circle>
              <circle cx="720" cy="300" r="4" fill="#4F8AFF" opacity="0.8" />
              {/* Data flow particles */}
              <circle r="4" fill="#3B82F6">
                <animateMotion dur="3s" repeatCount="indefinite" path="M0 100 Q400 100 720 300" />
                <animate attributeName="opacity" values="0;1;1;0" dur="3s" repeatCount="indefinite" />
              </circle>
              <circle r="4" fill="#8B5CF6">
                <animateMotion dur="3s" repeatCount="indefinite" begin="1s" path="M0 300 Q400 300 720 300" />
                <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="1s" repeatCount="indefinite" />
              </circle>
              <circle r="4" fill="#10B981">
                <animateMotion dur="3s" repeatCount="indefinite" begin="2s" path="M0 500 Q400 500 720 300" />
                <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="2s" repeatCount="indefinite" />
              </circle>
              <circle r="5" fill="#4F8AFF">
                <animateMotion dur="2.5s" repeatCount="indefinite" begin="2.5s" path="M720 300 Q1040 300 1440 300" />
                <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" begin="2.5s" repeatCount="indefinite" />
              </circle>
              {/* Labels */}
              <text x="100" y="85" className="dimension-label">INPUT</text>
              <text x="100" y="285" className="dimension-label">PROCESS</text>
              <text x="100" y="485" className="dimension-label">GENERATE</text>
              <text x="1300" y="285" className="dimension-label">OUTPUT</text>
            </svg>
            <div className="orb-drift-1" style={{ position: "absolute", top: "20%", left: "30%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.12) 0%, transparent 70%)", filter: "blur(80px)" }} />
            <div className="orb-drift-2" style={{ position: "absolute", bottom: "10%", right: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)", filter: "blur(70px)" }} />
          </div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
            style={{ maxWidth: 700, margin: "0 auto", position: "relative", zIndex: 1 }}
          >
            <span className="blueprint-annotation" style={{ marginBottom: 20, display: "block" }}>
              {t('landing.getStarted')}
            </span>
            <div className="accent-line" style={{ background: "linear-gradient(90deg, #4F8AFF, #8B5CF6, #C084FC)" }} />
            <h2 style={{
              fontSize: "clamp(2.2rem, 5vw, 3.5rem)", fontWeight: 900,
              letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 24,
            }}>
              <span style={{ color: "#F0F0F5" }}>{t('landing.readyToTransform')}</span><br />
              <span style={{ background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 50%, #C084FC 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                {t('landing.yourAecWorkflow')}
              </span>
            </h2>
            <p style={{ fontSize: 17, color: "#7C7C96", marginBottom: 48, lineHeight: 1.7 }}>
              {t('landing.ctaSubtitle')}
            </p>

            {/* CTA styled as a workflow "Run" button */}
            <div className="node-card" style={{
              '--node-port-color': '#4F8AFF',
              display: "inline-block",
              maxWidth: 400,
            } as React.CSSProperties}>
              <div className="node-header" style={{
                background: "linear-gradient(135deg, rgba(79,138,255,0.12), rgba(99,102,241,0.06))",
                borderBottom: "1px solid rgba(79,138,255,0.1)",
                borderRadius: "16px 16px 0 0",
                justifyContent: "center",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
                <span style={{ color: "#10B981" }}>READY TO EXECUTE</span>
              </div>
              <div style={{ padding: "24px 32px" }}>
                <Link href="/dashboard" style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  padding: "16px 40px", borderRadius: 12,
                  background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                  color: "white", fontSize: 17, fontWeight: 700,
                  textDecoration: "none",
                  boxShadow: "0 4px 24px rgba(79,138,255,0.3)",
                  transition: "all 200ms ease",
                }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.transform = "translateY(-2px)";
                    el.style.boxShadow = "0 8px 32px rgba(79,138,255,0.4)";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.transform = "translateY(0)";
                    el.style.boxShadow = "0 4px 24px rgba(79,138,255,0.3)";
                  }}
                >
                  <Play size={18} fill="white" />
                  {t('landing.createFirstWorkflow')}
                </Link>
                <div style={{ marginTop: 16 }}>
                  <Link href="/dashboard/community" style={{
                    fontSize: 13, color: "#4F8AFF", textDecoration: "none",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    transition: "color 0.15s",
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6B9FFF"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#4F8AFF"; }}
                  >
                    {t('landing.exploreWorkflows')} <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.04)",
        padding: "32px 48px",
        background: "rgba(7,7,13,0.9)",
      }}>
        <div className="landing-footer" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 13, color: "#5C5C78", fontWeight: 600 }}>
              {t('landing.copyright')}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {[t('landing.privacy'), t('landing.terms'), t('landing.contact')].map(l => (
              <a key={l} href="#" style={{ fontSize: 12, color: "#5C5C78", textDecoration: "none", transition: "color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
              >{l}</a>
            ))}
          </div>
          <span style={{ fontSize: 11, color: "#3A3A50" }}>
            {t('landing.betaProduct')}
          </span>
        </div>
      </footer>

        {/* ── Trust Signals Footer ─────────────────────────────────── */}
        <div style={{
          padding: "32px 48px 48px",
          textAlign: "center",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
            {["Data encrypted in transit and at rest", "Built for AEC professionals", "Beta — actively developed"].map(signal => (
              <span key={signal} style={{ fontSize: 11, color: "#3A3A50", fontWeight: 500 }}>
                {signal}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#2A2A3E" }}>
            © {new Date().getFullYear()} BuildFlow. Concept design tool for architects and AEC teams.
          </p>
        </div>

      {/* News Ticker */}
      <NewsTicker items={newsItems} whatsNewLabel={t('landing.whatsNew')} />

      {/* Mobile Responsive Styles */}
      <style jsx global>{`
        @media (max-width: 768px) {
          section[style*="minHeight: 100vh"] {
            padding: 80px 24px 120px !important;
          }

          h1 {
            font-size: 2.5rem !important;
          }

          div[style*="gridTemplateColumns: repeat(3, 1fr)"],
          div[style*="gridTemplateColumns: repeat(4, 1fr)"] {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }

          div[style*="gridTemplateColumns: 1fr 40px 1fr 40px 1fr"] {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }

          div[style*="gridTemplateColumns: 1fr 40px 1fr 40px 1fr"] > div[style*="display: flex"][style*="justifyContent: center"]:has(svg) {
            display: none !important;
          }

          nav[style*="padding: 0 48px"] {
            padding: 0 20px !important;
          }

          section[style*="padding: 88px 48px"] {
            padding: 48px 24px !important;
          }

          section[style*="padding: 48px 48px 88px"] {
            padding: 32px 24px 48px !important;
          }

          div[style*="display: flex"][style*="gap: 12"] > a {
            width: 100%;
            justify-content: center;
          }

          a[style*="padding"][style*="borderRadius"] {
            min-height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }

        @media (max-width: 480px) {
          h1 {
            font-size: 2rem !important;
          }
        }
      `}</style>
    </div>
  );
}
