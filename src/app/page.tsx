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
      style={{ position: "absolute", left: 48, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 15, color: "#5C5C78", whiteSpace: "nowrap" }}
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
    title: "Visual Workflow Builder",
    description: "Drag and drop 31 purpose-built AEC nodes onto an infinite canvas. Connect them to create powerful pipelines — no code required.",
    bullets: ["Drag-and-drop canvas", "31 AEC-specific nodes", "Real-time execution"],
  },
  {
    icon: <Sparkles size={22} />, color: "#8B5CF6",
    title: "AI-Powered Generation",
    description: "Describe your workflow in plain English. Our AI understands AEC processes and builds the complete pipeline for you.",
    bullets: ["Natural language input", "Instant workflow generation", "Iterative refinement"],
  },
  {
    icon: <Users size={22} />, color: "#10B981",
    title: "Community Marketplace",
    description: "Share your workflows with the global AEC community. Clone, customize, and build on proven pipelines from peers.",
    bullets: ["Share and discover", "One-click cloning", "Ratings and reviews"],
  },
];

const USE_CASES = ["Architecture Studios", "Engineering Teams", "BIM Consultants", "Design Agencies", "Construction Tech"];

const SHOWCASE = [
  { id: "wf-01", badge: null },
  { id: "wf-10", badge: "MOST POPULAR" },
  { id: "wf-09", badge: null },
];

// ─── Logo Marquee ────────────────────────────────────────────────────────────

const PARTNER_LOGOS = ["METAFORM", "STRUCT-AI", "ENVIRON", "AXIS DESIGNS", "BUILDTECH"];

// ─── News Ticker ─────────────────────────────────────────────────────────────

const NEWS_ITEMS = [
  "New: AI workflow generation v2.0 is live",
  "31 AEC-specific nodes now available",
  "Community marketplace launched",
  "IFC export beta now available",
  "Real-time 3D massing preview",
];

function NewsTicker({ items = NEWS_ITEMS, whatsNewLabel }: { items?: string[]; whatsNewLabel?: string }) {
  return (
    <div style={{
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

      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <header>
        <nav style={{
          display: "flex", alignItems: "center",
          padding: "0 48px", height: 64,
          background: "transparent",
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 100,
        }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", marginRight: "auto" }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 12px rgba(79,138,255,0.3)",
            }}>
              <Zap size={16} color="white" fill="white" />
            </div>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.3px" }}>
              Build<span style={{ color: "#4F8AFF" }}>Flow</span>
            </span>
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 32, marginRight: 32 }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LanguageSwitcher />
            <Link href="/login" style={{
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
            {/* Central radial glow */}
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(79,138,255,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 30% 70%, rgba(139,92,246,0.05) 0%, transparent 50%), radial-gradient(ellipse 50% 50% at 80% 50%, rgba(59,130,246,0.04) 0%, transparent 50%)",
            }} />
            {/* Grid pattern */}
            <div style={{
              position: "absolute", inset: 0, opacity: 0.3,
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
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

            {/* Prompt bar */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6, ease: smoothEase }}
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

        {/* ── Core Capabilities ─────────────────────────────────────── */}
        <section style={{
          padding: "80px 48px 100px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0B0B13 100%)",
        }}>
          {/* Atmospheric glow */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)", width: "80%", height: "60%", background: "radial-gradient(ellipse, rgba(79,138,255,0.06) 0%, transparent 70%)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 64 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "3px", color: "#4F8AFF", marginBottom: 16, display: "block" }}>
                {t('landing.coreCapabilities')}
              </span>
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                <span style={{ color: "#F0F0F5" }}>{t('landing.fromIdeaTo')} </span>
                <span style={{ background: "linear-gradient(135deg, #7C6FF7, #C084FC)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.reality')}</span>
              </h2>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={stagger}
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}
            >
              {[
                { icon: <Box size={28} />, color: "#3B82F6", title: t('landing.textTo3d'), description: t('landing.textTo3dDesc'), badge: t('landing.aiPoweredBadge') },
                { icon: <ImageIcon size={28} />, color: "#8B5CF6", title: t('landing.instantRenders'), description: t('landing.instantRendersDesc'), badge: t('landing.fastBadge') },
                { icon: <FileCode size={28} />, color: "#10B981", title: t('landing.ifcExport'), description: t('landing.ifcExportDesc'), badge: t('landing.bimReady') },
              ].map(f => {
                const rgb = hexToRgb(f.color);
                return (
                  <motion.div key={f.title} variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                    background: "rgba(18,18,30,0.6)", backdropFilter: "blur(20px)",
                    borderRadius: 20, border: "1px solid rgba(255,255,255,0.06)",
                    padding: "36px 32px", cursor: "default", position: "relative", overflow: "hidden",
                    transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
                  }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = `rgba(${rgb}, 0.4)`;
                      el.style.transform = "translateY(-6px) scale(1.01)";
                      el.style.boxShadow = `0 24px 48px rgba(0,0,0,0.4), 0 0 40px rgba(${rgb}, 0.12), inset 0 1px 0 rgba(255,255,255,0.05)`;
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = "rgba(255,255,255,0.06)";
                      el.style.transform = "translateY(0) scale(1)";
                      el.style.boxShadow = "none";
                    }}
                  >
                    {/* Gradient orb background */}
                    <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: `radial-gradient(circle, rgba(${rgb}, 0.08) 0%, transparent 70%)`, pointerEvents: "none" }} />

                    {f.badge && (
                      <div style={{ position: "absolute", top: 20, right: 20, fontSize: 9, padding: "4px 12px", borderRadius: 20, background: `rgba(${rgb}, 0.12)`, border: `1px solid rgba(${rgb}, 0.25)`, color: f.color, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>
                        {f.badge}
                      </div>
                    )}
                    <div style={{ width: 64, height: 64, borderRadius: 18, marginBottom: 24, background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.05))`, border: `1px solid rgba(${rgb}, 0.2)`, display: "flex", alignItems: "center", justifyContent: "center", color: f.color, boxShadow: `0 0 24px rgba(${rgb}, 0.1)` }}>
                      {f.icon}
                    </div>
                    <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 12, letterSpacing: "-0.02em" }}>{f.title}</h3>
                    <p style={{ fontSize: 15, color: "#9898B0", lineHeight: 1.7 }}>{f.description}</p>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* ── Built For Strip ─────────────────────────────────────── */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)",
          padding: "28px 48px", background: "rgba(11,11,19,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <span style={{ fontSize: 11, color: "#3A3A50", whiteSpace: "nowrap", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px" }}>{t('landing.builtFor')}</span>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ display: "flex", gap: 40, flexWrap: "wrap", justifyContent: "center" }}>
              {useCases.map(c => (
                <span key={c} style={{ fontSize: 14, fontWeight: 700, color: "#3A3A50", letterSpacing: "1.5px", textTransform: "uppercase", transition: "color 0.2s", cursor: "default" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#3A3A50"; }}
                >{c}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Features (glass cards with glow) ────────────────────── */}
        <section id="features" style={{ padding: "100px 48px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", bottom: "0%", left: "20%", width: "60%", height: "50%", background: "radial-gradient(ellipse, rgba(139,92,246,0.05) 0%, transparent 70%)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 64 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "3px", color: "#8B5CF6", marginBottom: 16, display: "block" }}>
                {t('landing.platform')}
              </span>
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 16 }}>
                {t('landing.everythingYouNeed')}<br />
                <span style={{ background: "linear-gradient(135deg, #4F8AFF, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.automateAec')}</span>
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96", maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
                {t('landing.purposeBuilt')}
              </p>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={stagger}
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}
            >
              {features.map((f, idx) => {
                const rgb = hexToRgb(f.color);
                return (
                  <motion.div key={f.title} variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                    background: "rgba(18,18,30,0.6)", backdropFilter: "blur(20px)",
                    borderRadius: 20, border: "1px solid rgba(255,255,255,0.06)",
                    padding: "36px 28px", cursor: "default", position: "relative", overflow: "hidden",
                    transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
                  }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = `rgba(${rgb}, 0.3)`;
                      el.style.transform = "translateY(-6px)";
                      el.style.boxShadow = `0 24px 48px rgba(0,0,0,0.4), 0 0 40px rgba(${rgb}, 0.1)`;
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = "rgba(255,255,255,0.06)";
                      el.style.transform = "translateY(0)";
                      el.style.boxShadow = "none";
                    }}
                  >
                    {/* Decorative number */}
                    <div style={{ position: "absolute", top: -8, right: 16, fontSize: 100, fontWeight: 900, color: f.color, opacity: 0.03, lineHeight: 1, userSelect: "none" }}>{idx + 1}</div>

                    <div style={{ width: 60, height: 60, borderRadius: 16, marginBottom: 24, background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.05))`, border: `1px solid rgba(${rgb}, 0.2)`, display: "flex", alignItems: "center", justifyContent: "center", color: f.color, boxShadow: `0 0 20px rgba(${rgb}, 0.1)` }}>
                      {f.icon}
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", marginBottom: 12, letterSpacing: "-0.02em" }}>{f.title}</h3>
                    <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.7, marginBottom: 20 }}>{f.description}</p>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {f.bullets.map(b => (
                        <li key={b} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#9898B0", marginBottom: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: f.color, flexShrink: 0, boxShadow: `0 0 8px ${f.color}` }} />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* ── Workflow Showcase ────────────────────────────────────── */}
        <section id="workflows" style={{
          padding: "100px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A16 50%, #07070D 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: "70%", height: "40%", background: "radial-gradient(ellipse, rgba(79,138,255,0.07) 0%, transparent 70%)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 64 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "3px", color: "#10B981", marginBottom: 16, display: "block" }}>
                {t('landing.templatesSection')}
              </span>
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                {t('landing.fromBrief')}<br />
                <span style={{ background: "linear-gradient(135deg, #10B981, #34D399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.inMinutes')}</span>
              </h2>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}
            >
              {SHOWCASE.map(({ id, badge }) => {
                const wf = PREBUILT_WORKFLOWS.find(w => w.id === id);
                if (!wf) return null;
                const nodes = wf.tileGraph.nodes.map(n => ({ label: n.data.label, category: n.data.category as string }));
                return (
                  <motion.div key={id} variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                    background: "rgba(18,18,30,0.6)", backdropFilter: "blur(20px)",
                    borderRadius: 20,
                    border: badge ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.06)",
                    overflow: "hidden",
                    transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
                  }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.transform = "translateY(-6px) scale(1.01)";
                      el.style.boxShadow = badge ? "0 24px 48px rgba(245,158,11,0.1), 0 0 40px rgba(245,158,11,0.05)" : "0 24px 48px rgba(0,0,0,0.4), 0 0 30px rgba(79,138,255,0.08)";
                      if (!badge) el.style.borderColor = "rgba(79,138,255,0.2)";
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.transform = "translateY(0) scale(1)";
                      el.style.boxShadow = "none";
                      if (!badge) el.style.borderColor = "rgba(255,255,255,0.06)";
                    }}
                  >
                    <div style={{
                      height: 130, background: "rgba(11,11,19,0.8)",
                      borderBottom: "1px solid rgba(255,255,255,0.04)", position: "relative",
                      backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px)",
                      backgroundSize: "20px 20px",
                    }}>
                      {badge && (
                        <div style={{ position: "absolute", top: 10, right: 10, fontSize: 9, padding: "3px 10px", borderRadius: 20, background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "white", fontWeight: 700, letterSpacing: "0.8px", zIndex: 2, boxShadow: "0 4px 12px rgba(245,158,11,0.3)" }}>
                          {badge}
                        </div>
                      )}
                      <MiniWorkflowDiagram nodes={nodes} size="md" animated />
                    </div>
                    <div style={{ padding: "20px 24px" }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F5", marginBottom: 8 }}>{wf.name}</h3>
                      <p style={{ fontSize: 12, color: "#5C5C78", lineHeight: 1.5, marginBottom: 14 }}>
                        {wf.tileGraph.nodes.length} nodes · {wf.estimatedRunTime}
                      </p>
                      <Link href="/dashboard/templates" style={{
                        fontSize: 13, fontWeight: 600, color: "#4F8AFF", textDecoration: "none",
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "6px 14px", borderRadius: 8,
                        background: "rgba(79,138,255,0.08)", border: "1px solid rgba(79,138,255,0.15)",
                        transition: "all 0.2s",
                      }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.15)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.08)"; }}
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

        {/* ── How It Works (futuristic timeline) ───────────────────── */}
        <section id="community" style={{ padding: "100px 48px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)", width: "50%", height: "40%", background: "radial-gradient(ellipse, rgba(139,92,246,0.06) 0%, transparent 70%)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 64 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "3px", color: "#F59E0B", marginBottom: 16, display: "block" }}>
                {t('landing.howItWorks')}
              </span>
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                {t('landing.threeSteps')}<br />
                <span style={{ background: "linear-gradient(135deg, #F59E0B, #EF4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.launch')}</span>
              </h2>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={stagger}
              style={{ display: "grid", gridTemplateColumns: "1fr 40px 1fr 40px 1fr", gap: 0, alignItems: "center" }}
            >
              {[
                { num: "01", title: t('landing.dragDrop'), desc: t('landing.dragDropDesc'), icon: <LayoutGrid size={24} />, color: "#3B82F6" },
                { num: "02", title: t('landing.connect'), desc: t('landing.connectDesc'), icon: <Zap size={24} />, color: "#8B5CF6" },
                { num: "03", title: t('landing.run'), desc: t('landing.runDesc'), icon: <Play size={24} />, color: "#10B981" },
              ].map((step, i) => {
                const rgb = hexToRgb(step.color);
                return (
                  <React.Fragment key={step.num}>
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                      background: "rgba(18,18,30,0.6)", backdropFilter: "blur(20px)",
                      borderRadius: 20, border: "1px solid rgba(255,255,255,0.06)",
                      padding: "36px 28px", textAlign: "center", position: "relative", overflow: "hidden",
                      transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
                    }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.borderColor = `rgba(${rgb}, 0.3)`;
                        el.style.transform = "translateY(-6px)";
                        el.style.boxShadow = `0 24px 48px rgba(0,0,0,0.4), 0 0 30px rgba(${rgb}, 0.1)`;
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.borderColor = "rgba(255,255,255,0.06)";
                        el.style.transform = "translateY(0)";
                        el.style.boxShadow = "none";
                      }}
                    >
                      {/* Big step number */}
                      <div style={{ position: "absolute", top: 8, right: 16, fontSize: 72, fontWeight: 900, background: `linear-gradient(135deg, ${step.color}, transparent)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", opacity: 0.08, lineHeight: 1, userSelect: "none" }}>
                        {step.num}
                      </div>
                      <div style={{ width: 60, height: 60, borderRadius: 16, margin: "0 auto 20px", background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.05))`, border: `1px solid rgba(${rgb}, 0.2)`, display: "flex", alignItems: "center", justifyContent: "center", color: step.color, boxShadow: `0 0 24px rgba(${rgb}, 0.12)` }}>
                        {step.icon}
                      </div>
                      <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", marginBottom: 10, letterSpacing: "-0.02em" }}>{step.title}</h3>
                      <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.7 }}>{step.desc}</p>
                    </motion.div>
                    {i < 2 && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="24" height="14" viewBox="0 0 24 14" fill="none">
                          <defs>
                            <linearGradient id={`arrow-grad-${i}`} x1="0" y1="7" x2="24" y2="7">
                              <stop offset="0%" stopColor={[{ num: "01", color: "#3B82F6" }, { num: "02", color: "#8B5CF6" }][i]?.color ?? "#3B82F6"} stopOpacity="0.5" />
                              <stop offset="100%" stopColor={[{ num: "02", color: "#8B5CF6" }, { num: "03", color: "#10B981" }][i]?.color ?? "#8B5CF6"} stopOpacity="0.5" />
                            </linearGradient>
                          </defs>
                          <line x1="0" y1="7" x2="16" y2="7" stroke={`url(#arrow-grad-${i})`} strokeWidth="1.5" strokeDasharray="3 3" />
                          <path d="M16 3 L22 7 L16 11" stroke={`url(#arrow-grad-${i})`} strokeWidth="1.5" fill="none" />
                        </svg>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* ── Pricing (glass morphism) ─────────────────────────────── */}
        <section id="pricing" style={{
          padding: "100px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0B0B13 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: "80%", height: "60%", background: "radial-gradient(ellipse, rgba(79,138,255,0.05) 0%, transparent 70%)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 64 }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "3px", color: "#4F8AFF", marginBottom: 16, display: "block" }}>
                {t('landing.pricingSection')}
              </span>
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 16 }}>
                {t('landing.simpleTransparent')}<span style={{ background: "linear-gradient(135deg, #4F8AFF, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t('landing.transparent')}</span>{t('landing.pricingTitle')}
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96" }}>{t('landing.choosePlan')}</p>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}
            >
              {/* FREE */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                background: "rgba(18,18,30,0.6)", backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 20, padding: "36px 28px",
                transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.12)"; el.style.transform = "translateY(-4px)"; el.style.boxShadow = "0 20px 40px rgba(0,0,0,0.3)"; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.06)"; el.style.transform = "translateY(0)"; el.style.boxShadow = "none"; }}
              >
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.free')}</h3>
                  <p style={{ fontSize: 13, color: "#7878A0" }}>{t('landing.freeDesc')}</p>
                </div>
                <div style={{ marginBottom: 28 }}>
                  <span style={{ fontSize: 48, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>{t('landing.freePrice')}</span>
                  <span style={{ fontSize: 15, color: "#5C5C78", marginLeft: 8 }}>{t('landing.perMonth')}</span>
                </div>
                <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "13px 24px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#F0F0F5", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 28, transition: "all 0.2s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                >{t('landing.getStarted')}</Link>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#5C5C78", marginBottom: 16, textTransform: "uppercase", letterSpacing: "1px" }}>{t('landing.includes')}</div>
                  {tArray('landing.freeFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 6px #4F8AFF" }} /><span style={{ fontSize: 14, color: "#9898B0" }}>{f}</span></div>))}
                </div>
              </motion.div>

              {/* PRO */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                background: "rgba(18,18,34,0.7)", backdropFilter: "blur(20px)",
                border: "1.5px solid rgba(79,138,255,0.3)", borderRadius: 20, padding: "36px 28px",
                position: "relative", overflow: "hidden",
                boxShadow: "0 0 60px rgba(79,138,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
                transition: "transform 0.3s, box-shadow 0.3s",
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = "translateY(-6px) scale(1.02)"; el.style.boxShadow = "0 24px 60px rgba(79,138,255,0.12), 0 0 80px rgba(79,138,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)"; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = "translateY(0) scale(1)"; el.style.boxShadow = "0 0 60px rgba(79,138,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)"; }}
              >
                {/* Glow orb */}
                <div style={{ position: "absolute", top: -80, right: -80, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", padding: "5px 16px", borderRadius: 20, background: "linear-gradient(135deg, #4F8AFF, #6366F1)", fontSize: 10, fontWeight: 800, color: "white", letterSpacing: "1px", textTransform: "uppercase", boxShadow: "0 4px 16px rgba(79,138,255,0.4)" }}>{t('landing.mostPopular')}</div>
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.proTitle')}</h3>
                  <p style={{ fontSize: 13, color: "#7878A0" }}>{t('landing.proDesc')}</p>
                </div>
                <div style={{ marginBottom: 28 }}>
                  <span style={{ fontSize: 48, fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.03em" }}>$29</span>
                  <span style={{ fontSize: 15, color: "#5C5C78", marginLeft: 8 }}>{t('landing.perMonth')}</span>
                </div>
                <div style={{ marginBottom: 24, padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <span style={{ fontSize: 12, color: "#10B981", fontWeight: 700 }}>{t('landing.proHighlight')}</span>
                </div>
                <Link href="/dashboard" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "13px 24px", borderRadius: 12, background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)", color: "white", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 28, boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 4px 20px rgba(79,138,255,0.3)", transition: "all 0.2s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(79,138,255,0.5), 0 8px 30px rgba(79,138,255,0.4)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 1px rgba(79,138,255,0.3), 0 4px 20px rgba(79,138,255,0.3)"; }}
                >{t('landing.startFreeTrial')}</Link>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#5C5C78", marginBottom: 16, textTransform: "uppercase", letterSpacing: "1px" }}>{t('landing.proIncludes')}</div>
                  {tArray('landing.proFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4F8AFF", boxShadow: "0 0 6px #4F8AFF" }} /><span style={{ fontSize: 14, color: "#D0D0E0" }}>{f}</span></div>))}
                </div>
              </motion.div>

              {/* ENTERPRISE */}
              <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }} style={{
                background: "rgba(18,18,30,0.6)", backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 20, padding: "36px 28px",
                transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(139,92,246,0.2)"; el.style.transform = "translateY(-4px)"; el.style.boxShadow = "0 20px 40px rgba(0,0,0,0.3), 0 0 30px rgba(139,92,246,0.06)"; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.06)"; el.style.transform = "translateY(0)"; el.style.boxShadow = "none"; }}
              >
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", marginBottom: 6 }}>{t('landing.enterprise')}</h3>
                  <p style={{ fontSize: 13, color: "#7878A0" }}>{t('landing.enterpriseDesc')}</p>
                </div>
                <div style={{ marginBottom: 28 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, color: "#F0F0F5" }}>{t('landing.custom')}</span>
                </div>
                <a href="mailto:sales@buildflow.com" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "13px 24px", borderRadius: 12, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.05)", color: "#F0F0F5", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 28, transition: "all 0.2s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.1)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.05)"; }}
                >{t('landing.contactSales')}</a>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#5C5C78", marginBottom: 16, textTransform: "uppercase", letterSpacing: "1px" }}>{t('landing.enterpriseIncludes')}</div>
                  {tArray('landing.enterpriseFeatures').map(f => (<div key={f} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "#8B5CF6", boxShadow: "0 0 6px #8B5CF6" }} /><span style={{ fontSize: 14, color: "#9898B0" }}>{f}</span></div>))}
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ── Final CTA (cinematic) ────────────────────────────────── */}
        <section style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          textAlign: "center",
        }}>
          {/* Background glow */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", bottom: "-20%", left: "50%", transform: "translateX(-50%)", width: "100%", height: "80%", background: "radial-gradient(ellipse 70% 60%, rgba(79,138,255,0.1) 0%, transparent 60%)" }} />
            <div style={{ position: "absolute", bottom: "-10%", left: "30%", width: "40%", height: "60%", background: "radial-gradient(ellipse, rgba(139,92,246,0.06) 0%, transparent 70%)" }} />
          </div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
            style={{ maxWidth: 700, margin: "0 auto", position: "relative", zIndex: 1 }}
          >
            <h2 style={{
              fontSize: "clamp(2.2rem, 5vw, 3.5rem)", fontWeight: 900,
              letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 20,
            }}>
              <span style={{ color: "#F0F0F5" }}>{t('landing.readyToTransform')}</span><br />
              <span style={{ background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 50%, #C084FC 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                {t('landing.yourAecWorkflow')}
              </span>
            </h2>
            <p style={{ fontSize: 17, color: "#7C7C96", marginBottom: 40, lineHeight: 1.7 }}>
              {t('landing.ctaSubtitle')}
            </p>
            <Link href="/dashboard" style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              padding: "16px 40px", borderRadius: 14,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              color: "white", fontSize: 17, fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 8px 32px rgba(79,138,255,0.3), 0 0 80px rgba(79,138,255,0.1)",
              marginBottom: 20, transition: "all 200ms ease",
            }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.transform = "translateY(-2px) scale(1.02)";
                el.style.boxShadow = "0 0 0 1px rgba(79,138,255,0.5), 0 12px 40px rgba(79,138,255,0.4), 0 0 100px rgba(79,138,255,0.15)";
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.transform = "translateY(0) scale(1)";
                el.style.boxShadow = "0 0 0 1px rgba(79,138,255,0.3), 0 8px 32px rgba(79,138,255,0.3), 0 0 80px rgba(79,138,255,0.1)";
              }}
            >
              {t('landing.createFirstWorkflow')}
              <ArrowRight size={18} />
            </Link>
            <div>
              <Link href="/dashboard/community" style={{
                fontSize: 14, color: "#4F8AFF", textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 6,
                transition: "color 0.15s",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6B9FFF"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#4F8AFF"; }}
              >
                {t('landing.exploreWorkflows')} <ArrowRight size={14} />
              </Link>
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
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={11} color="white" fill="white" />
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
