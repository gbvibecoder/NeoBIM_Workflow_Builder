"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight, Zap, Sparkles, Users, LayoutGrid,
  Box, Play, Image as ImageIcon, FileCode,
  MousePointerClick, Workflow, Layers, Settings, Target, Calendar,
  ChevronUp, ChevronDown, ClipboardList, Send, Copy, Building2, Star,
} from "lucide-react";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useLocale } from '@/hooks/useLocale';
import type { TranslationKey } from '@/lib/i18n';
import { trackLead } from '@/lib/meta-pixel';
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

// ─── Animated Number (count-up on scroll) ───────────────────────────────────

function AnimatedNumber({ value, decimals = 0, suffix = '', prefix = '', color }: { value: number; decimals?: number; suffix?: string; prefix?: string; color: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const duration = 1500;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(eased * value);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [inView, value]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.floor(display).toLocaleString();

  return (
    <div ref={ref} style={{ fontSize: 32, fontWeight: 800, color, fontFamily: '"SF Mono", "Fira Code", monospace', letterSpacing: '-0.02em' }}>
      {prefix}{formatted}{suffix}
    </div>
  );
}

const USE_CASES = ["Architecture Studios", "Engineering Teams", "BIM Consultants", "Design Agencies", "Construction Tech"];

const SHOWCASE = [
  { id: "wf-01", badge: null },
  { id: "wf-14", badge: "MOST POPULAR" },
  { id: "wf-09", badge: null },
];

// ─── Logo Marquee ────────────────────────────────────────────────────────────

const PARTNER_LOGOS = ["BUILT FOR AEC", "COMPLEMENT TO REVIT & RHINO", "NO CAD NEEDED", "SCHEMATIC DESIGN PHASE"];

// ─── Community Social Proof Data ────────────────────────────────────────────

const COMMUNITY_WORKFLOWS = [
  { name: "MEP Coordination Clash Review", builder: "Sarah M.", role: "MEP Lead", firm: "Arup", discipline: "MEP", phase: "RIBA Stage 4", uses: 342, duplicated: 89, color: "#3B82F6" },
  { name: "Pre-Commencement Condition Discharge", builder: "James T.", role: "Project Manager", firm: "Mace Group", discipline: "Planning", phase: "Stage 5", uses: 218, duplicated: 56, color: "#8B5CF6" },
  { name: "RIBA Stage 4 Drawing Issue Workflow", builder: "Priya K.", role: "BIM Manager", firm: "Foster + Partners", discipline: "Architecture", phase: "RIBA Stage 4", uses: 567, duplicated: 134, color: "#10B981" },
  { name: "Structural Steel Takeoff & BOQ", builder: "Marcus W.", role: "QS Engineer", firm: "Turner & Townsend", discipline: "Structures", phase: "Stage 3–4", uses: 421, duplicated: 97, color: "#F59E0B" },
  { name: "Façade Panel Schedule Generator", builder: "Lena H.", role: "Façade Engineer", firm: "Schüco", discipline: "Envelope", phase: "Detail Design", uses: 189, duplicated: 43, color: "#EF4444" },
  { name: "Site Logistics & Crane Reach Analysis", builder: "David C.", role: "Site Manager", firm: "Laing O'Rourke", discipline: "Construction", phase: "Pre-Construction", uses: 305, duplicated: 71, color: "#06B6D4" },
];

// ─── Workflow Request Seed Data ─────────────────────────────────────────────

interface WorkflowRequest {
  id: string;
  name: string;
  discipline: string;
  problem: string;
  email: string;
  votes: number;
  createdAt: string;
}

const SEED_REQUESTS: WorkflowRequest[] = [
  { id: "req-001", name: "Acoustic Performance Assessment", discipline: "Building Physics", problem: "Need automated reverberation time calculations from room geometry and material specifications for compliance with BB93 and ADE.", email: "hidden", votes: 47, createdAt: "2026-03-08" },
  { id: "req-002", name: "Fire Escape Route Compliance Check", discipline: "Fire Safety", problem: "Automated travel distance and exit width verification against Approved Document B from IFC model geometry.", email: "hidden", votes: 83, createdAt: "2026-03-07" },
  { id: "req-003", name: "Daylight Factor Analysis Pipeline", discipline: "Environmental Design", problem: "Generate daylight factor reports from IFC model with automated window-to-floor ratios and Part L compliance checks.", email: "hidden", votes: 61, createdAt: "2026-03-09" },
  { id: "req-004", name: "Embodied Carbon Calculator", discipline: "Sustainability", problem: "Calculate whole-life carbon from material schedules against RICS methodology and LETI 2030 targets.", email: "hidden", votes: 129, createdAt: "2026-03-06" },
  { id: "req-005", name: "Accessibility Audit Workflow", discipline: "Inclusive Design", problem: "Check corridor widths, door clearances, and ramp gradients against Part M and BS 8300 requirements from BIM model.", email: "hidden", votes: 35, createdAt: "2026-03-10" },
];

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

// ─── Roadmap Data ─────────────────────────────────────────────────────────────

interface RoadmapItem {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  category: "input" | "transform" | "generate" | "export";
  status: "proposed" | "in-review" | "approved" | "in-progress";
  defaultVotes: number;
  priority: "P1" | "P2" | "P3";
}

const ROADMAP_ITEMS: RoadmapItem[] = [
  { id: "RFI-001", titleKey: "landing.roadmap.item1Title", descKey: "landing.roadmap.item1Desc", category: "transform", status: "in-review", defaultVotes: 142, priority: "P1" },
  { id: "RFI-002", titleKey: "landing.roadmap.item2Title", descKey: "landing.roadmap.item2Desc", category: "generate", status: "proposed", defaultVotes: 98, priority: "P2" },
  { id: "RFI-003", titleKey: "landing.roadmap.item3Title", descKey: "landing.roadmap.item3Desc", category: "transform", status: "approved", defaultVotes: 231, priority: "P1" },
  { id: "RFI-004", titleKey: "landing.roadmap.item4Title", descKey: "landing.roadmap.item4Desc", category: "input", status: "in-progress", defaultVotes: 187, priority: "P1" },
  { id: "RFI-005", titleKey: "landing.roadmap.item5Title", descKey: "landing.roadmap.item5Desc", category: "generate", status: "proposed", defaultVotes: 76, priority: "P3" },
  { id: "RFI-006", titleKey: "landing.roadmap.item6Title", descKey: "landing.roadmap.item6Desc", category: "export", status: "in-review", defaultVotes: 164, priority: "P2" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  proposed: { bg: "rgba(92,92,120,0.15)", text: "#9898B0", border: "rgba(92,92,120,0.3)" },
  "in-review": { bg: "rgba(245,158,11,0.12)", text: "#F59E0B", border: "rgba(245,158,11,0.3)" },
  approved: { bg: "rgba(16,185,129,0.12)", text: "#10B981", border: "rgba(16,185,129,0.3)" },
  "in-progress": { bg: "rgba(79,138,255,0.12)", text: "#4F8AFF", border: "rgba(79,138,255,0.3)" },
};

const CATEGORY_LABELS: Record<string, TranslationKey> = {
  input: "landing.roadmap.categoryInput",
  transform: "landing.roadmap.categoryTransform",
  generate: "landing.roadmap.categoryGenerate",
  export: "landing.roadmap.categoryExport",
};

const STATUS_LABELS: Record<string, TranslationKey> = {
  proposed: "landing.roadmap.statusProposed",
  "in-review": "landing.roadmap.statusInReview",
  approved: "landing.roadmap.statusApproved",
  "in-progress": "landing.roadmap.statusInProgress",
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: "#EF4444",
  P2: "#F59E0B",
  P3: "#6B7280",
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, label }: { status: string; label: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.proposed;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
      padding: "3px 8px", borderRadius: 6,
      background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
    }}>
      {status === "in-progress" && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: colors.text,
          animation: "pulse 2s ease-in-out infinite",
        }} />
      )}
      {label}
    </span>
  );
}

// ─── Vote Card ────────────────────────────────────────────────────────────────

function VoteCard({
  item, votes, hasVoted, onVote, t, maxVotes,
}: {
  item: RoadmapItem;
  votes: number;
  hasVoted: boolean;
  onVote: () => void;
  t: (key: TranslationKey) => string;
  maxVotes: number;
}) {
  const color = CATEGORY_COLORS[item.category] ?? "#4F8AFF";
  const rgb = hexToRgb(color);
  const progress = maxVotes > 0 ? (votes / maxVotes) * 100 : 0;

  return (
    <motion.div
      variants={fadeUp}
      transition={{ duration: 0.5, ease: smoothEase }}
      className="node-card"
      style={{
        background: "rgba(18,18,30,0.85)",
        backdropFilter: "blur(20px)",
        border: `1px solid rgba(${rgb}, 0.2)`,
        borderRadius: 16,
        overflow: "hidden",
        position: "relative",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
      whileHover={{
        borderColor: `rgba(${rgb}, 0.4)`,
        boxShadow: `0 8px 40px rgba(0,0,0,0.4), 0 0 30px rgba(${rgb}, 0.08)`,
      }}
    >
      {/* Category header */}
      <div className="node-header" style={{
        padding: "10px 16px",
        background: `linear-gradient(135deg, rgba(${rgb}, 0.12) 0%, rgba(${rgb}, 0.04) 100%)`,
        borderBottom: `1px solid rgba(${rgb}, 0.15)`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color }}>{t(CATEGORY_LABELS[item.category])}</span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#5C5C78", fontWeight: 600 }}>{item.id}</span>
      </div>

      {/* Blueprint overlay */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.03 }}>
        <div className="blueprint-grid" />
      </div>

      {/* Content */}
      <div style={{ padding: "16px 16px 12px", position: "relative" }}>
        {/* Title + Priority */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F5", margin: 0, lineHeight: 1.3 }}>{t(item.titleKey)}</h4>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, flexShrink: 0,
            background: `${PRIORITY_COLORS[item.priority]}15`,
            color: PRIORITY_COLORS[item.priority],
            border: `1px solid ${PRIORITY_COLORS[item.priority]}30`,
          }}>{item.priority}</span>
        </div>

        {/* Description */}
        <p style={{
          fontSize: 13, color: "#9898B0", lineHeight: 1.5, margin: "0 0 12px",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{t(item.descKey)}</p>

        {/* Status + Revision */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <StatusBadge status={item.status} label={t(STATUS_LABELS[item.status])} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#5C5C78" }}>
            {t('landing.roadmap.revision')} A
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 12 }} />

        {/* Vote row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: "#F0F0F5" }}>
            {votes.toLocaleString()}
            <span style={{ fontSize: 10, fontWeight: 500, color: "#5C5C78", marginLeft: 4 }}>{t('landing.roadmap.votes')}</span>
          </span>
          <button
            onClick={onVote}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s",
              border: hasVoted ? "1px solid rgba(16,185,129,0.3)" : `1px solid rgba(${rgb}, 0.3)`,
              background: hasVoted ? "rgba(16,185,129,0.12)" : `rgba(${rgb}, 0.08)`,
              color: hasVoted ? "#10B981" : color,
            }}
            onMouseEnter={e => {
              if (!hasVoted) {
                (e.currentTarget as HTMLElement).style.background = `rgba(${rgb}, 0.2)`;
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 12px rgba(${rgb}, 0.15)`;
              }
            }}
            onMouseLeave={e => {
              if (!hasVoted) {
                (e.currentTarget as HTMLElement).style.background = `rgba(${rgb}, 0.08)`;
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }
            }}
          >
            <ChevronUp size={14} />
            {hasVoted ? t('landing.roadmap.voted') : t('landing.roadmap.voteButton')}
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: `${progress}%` }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: smoothEase, delay: 0.3 }}
            style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${color}, rgba(${rgb}, 0.3))` }}
          />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { t, tArray } = useLocale();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);


  const newsItems = [t('landing.news1'), t('landing.news2'), t('landing.news3'), t('landing.news4'), t('landing.news5')];

  // ─── Roadmap vote state (localStorage-persisted) ────────────────────────────
  const defaultVotes = Object.fromEntries(ROADMAP_ITEMS.map(i => [i.id, i.defaultVotes]));
  const [roadmapVotes, setRoadmapVotes] = useState<Record<string, number>>(defaultVotes);
  const [votedItems, setVotedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem("buildflow-roadmap-votes");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.votes) setRoadmapVotes(parsed.votes);
        if (parsed.voted) setVotedItems(new Set(parsed.voted));
      }
    } catch { /* ignore */ }
  }, []);

  const handleVote = (itemId: string) => {
    setRoadmapVotes(prev => {
      const alreadyVoted = votedItems.has(itemId);
      const next = { ...prev, [itemId]: prev[itemId] + (alreadyVoted ? -1 : 1) };
      const nextVoted = new Set(votedItems);
      if (alreadyVoted) nextVoted.delete(itemId); else nextVoted.add(itemId);
      setVotedItems(nextVoted);
      try {
        localStorage.setItem("buildflow-roadmap-votes", JSON.stringify({ votes: next, voted: [...nextVoted] }));
      } catch { /* ignore */ }
      return next;
    });
  };

  const totalVotes = Object.values(roadmapVotes).reduce((s, v) => s + v, 0);
  const maxVotes = Math.max(...Object.values(roadmapVotes), 1);

  // ─── Workflow Request state ────────────────────────────────────────────────
  const [workflowRequests, setWorkflowRequests] = useState<WorkflowRequest[]>(SEED_REQUESTS);
  const [requestVoted, setRequestVoted] = useState<Set<string>>(new Set());
  const [requestForm, setRequestForm] = useState({ name: '', discipline: '', problem: '', email: '' });
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("buildflow-workflow-requests");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.requests) setWorkflowRequests(parsed.requests);
        if (parsed.voted) setRequestVoted(new Set(parsed.voted));
      }
    } catch { /* ignore */ }
  }, []);

  const handleRequestVote = (reqId: string) => {
    setWorkflowRequests(prev => {
      const alreadyVoted = requestVoted.has(reqId);
      const next = prev.map(r => r.id === reqId ? { ...r, votes: r.votes + (alreadyVoted ? -1 : 1) } : r);
      const nextVoted = new Set(requestVoted);
      if (alreadyVoted) nextVoted.delete(reqId); else nextVoted.add(reqId);
      setRequestVoted(nextVoted);
      try { localStorage.setItem("buildflow-workflow-requests", JSON.stringify({ requests: next, voted: [...nextVoted] })); } catch { /* ignore */ }
      return next;
    });
  };

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm.name || !requestForm.discipline || !requestForm.problem || !requestForm.email) return;
    trackLead({ content_name: "workflow_request", content_category: requestForm.discipline });
    const newReq: WorkflowRequest = {
      id: `req-${Date.now()}`,
      name: requestForm.name,
      discipline: requestForm.discipline,
      problem: requestForm.problem,
      email: "hidden",
      votes: 1,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setWorkflowRequests(prev => {
      const next = [newReq, ...prev];
      try { localStorage.setItem("buildflow-workflow-requests", JSON.stringify({ requests: next, voted: [...requestVoted] })); } catch { /* ignore */ }
      return next;
    });
    setRequestForm({ name: '', discipline: '', problem: '', email: '' });
    setRequestSubmitted(true);
    setTimeout(() => setRequestSubmitted(false), 4000);
  };

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
              { label: 'Request', href: '#request-workflow' },
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
              filter: "blur(30px)",
            }} />
            <div className="orb-drift-2" style={{
              position: "absolute", top: "25%", right: "5%",
              width: 450, height: 450, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)",
              filter: "blur(25px)",
            }} />
            <div className="orb-drift-3" style={{
              position: "absolute", bottom: "10%", left: "35%",
              width: 400, height: 400, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)",
              filter: "blur(20px)",
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

          {/* ── Product Output Fragment Panels ────────────────────── */}

          {/* Panel A: Mini Floor Plan (top-right) */}
          <motion.div
            className="hidden md:block"
            initial={{ opacity: 0, y: 30, rotate: 2 }}
            animate={{ opacity: 1, y: 0, rotate: 2 }}
            transition={{ delay: 1.4, duration: 0.8, ease: smoothEase }}
            style={{
              position: 'absolute', top: '8%', right: '6%',
              width: 260, borderRadius: 14, overflow: 'hidden',
              background: 'rgba(18,18,30,0.88)', backdropFilter: 'blur(20px)',
              border: '1px solid rgba(59,130,246,0.2)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 20px rgba(59,130,246,0.06)',
              zIndex: 5,
            }}
          >
            <div style={{ padding: '10px 14px 6px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(59,130,246,0.1)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', boxShadow: '0 0 6px #3B82F6' }} />
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#3B82F6' }}>Floor Plan</span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <svg width="100%" height="140" viewBox="0 0 230 140" fill="none" style={{ display: 'block' }}>
                {/* Outer boundary */}
                <rect x="10" y="10" width="170" height="110" stroke="rgba(59,130,246,0.5)" strokeWidth="1.2" fill="none" />
                {/* Horizontal partition */}
                <line x1="10" y1="65" x2="120" y2="65" stroke="rgba(59,130,246,0.4)" strokeWidth="1" />
                {/* Vertical partition */}
                <line x1="120" y1="10" x2="120" y2="120" stroke="rgba(59,130,246,0.4)" strokeWidth="1" />
                {/* Kitchen partition */}
                <line x1="120" y1="75" x2="180" y2="75" stroke="rgba(59,130,246,0.3)" strokeWidth="0.8" />
                {/* Door arcs */}
                <path d="M75 65 A12 12 0 0 1 75 53" stroke="rgba(0,245,255,0.4)" strokeWidth="0.6" fill="none" />
                <path d="M120 40 A10 10 0 0 0 130 40" stroke="rgba(0,245,255,0.4)" strokeWidth="0.6" fill="none" />
                {/* Room labels */}
                <text x="55" y="42" fill="rgba(59,130,246,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">Living</text>
                <text x="55" y="52" fill="rgba(59,130,246,0.4)" fontSize="7" fontFamily="monospace" textAnchor="middle">35 m²</text>
                <text x="55" y="98" fill="rgba(59,130,246,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">Bed</text>
                <text x="55" y="108" fill="rgba(59,130,246,0.4)" fontSize="7" fontFamily="monospace" textAnchor="middle">20 m²</text>
                <text x="148" y="42" fill="rgba(59,130,246,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">Kitchen</text>
                <text x="148" y="52" fill="rgba(59,130,246,0.4)" fontSize="7" fontFamily="monospace" textAnchor="middle">18 m²</text>
                <text x="148" y="102" fill="rgba(59,130,246,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">Bath</text>
                <text x="148" y="112" fill="rgba(59,130,246,0.4)" fontSize="7" fontFamily="monospace" textAnchor="middle">6 m²</text>
                {/* Dimension: width */}
                <line x1="10" y1="130" x2="180" y2="130" stroke="rgba(0,245,255,0.3)" strokeWidth="0.5" />
                <line x1="10" y1="127" x2="10" y2="133" stroke="rgba(0,245,255,0.3)" strokeWidth="0.5" />
                <line x1="180" y1="127" x2="180" y2="133" stroke="rgba(0,245,255,0.3)" strokeWidth="0.5" />
                <text x="95" y="138" fill="rgba(0,245,255,0.5)" fontSize="7" fontFamily="monospace" textAnchor="middle">8.5m</text>
                {/* Dimension: height */}
                <line x1="195" y1="10" x2="195" y2="120" stroke="rgba(0,245,255,0.3)" strokeWidth="0.5" />
                <line x1="192" y1="10" x2="198" y2="10" stroke="rgba(0,245,255,0.3)" strokeWidth="0.5" />
                <line x1="192" y1="120" x2="198" y2="120" stroke="rgba(0,245,255,0.3)" strokeWidth="0.5" />
                <text x="210" y="70" fill="rgba(0,245,255,0.5)" fontSize="7" fontFamily="monospace" textAnchor="middle">6.2m</text>
              </svg>
            </div>
          </motion.div>

          {/* Panel B: Mini BOQ / Cost Table (bottom-left) */}
          <motion.div
            className="hidden md:block"
            initial={{ opacity: 0, y: 30, rotate: -3 }}
            animate={{ opacity: 1, y: 0, rotate: -3 }}
            transition={{ delay: 1.6, duration: 0.8, ease: smoothEase }}
            style={{
              position: 'absolute', bottom: '18%', left: '4%',
              width: 270, borderRadius: 14, overflow: 'hidden',
              background: 'rgba(18,18,30,0.88)', backdropFilter: 'blur(20px)',
              border: '1px solid rgba(245,158,11,0.2)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 20px rgba(245,158,11,0.06)',
              zIndex: 5,
            }}
          >
            <div style={{ padding: '10px 14px 6px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(245,158,11,0.1)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', boxShadow: '0 0 6px #F59E0B' }} />
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#F59E0B' }}>Cost Estimate</span>
              <span style={{ marginLeft: 'auto', fontSize: 7, color: 'rgba(245,158,11,0.4)', fontFamily: 'monospace' }}>CSI</span>
            </div>
            <div style={{ padding: '8px 10px', fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: 9 }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 55px', gap: 4, padding: '4px 4px 6px', borderBottom: '1px solid rgba(245,158,11,0.08)', color: '#5C5C78', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                <span>Description</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Total</span>
              </div>
              {/* Rows */}
              {[
                { desc: 'Concrete Slab 4"', qty: '2,400 SF', total: '$16,800' },
                { desc: 'Struct. Steel W12', qty: '84k LB', total: '$210,000' },
                { desc: 'Vinyl Window 3×4', qty: '48 EA', total: '$22,800' },
                { desc: 'Drywall 5/8" Type X', qty: '6,200 SF', total: '$27,900' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 40px 55px', gap: 4, padding: '5px 4px', borderBottom: '1px solid rgba(245,158,11,0.04)', color: '#9898B0' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.desc}</span>
                  <span style={{ textAlign: 'right', color: '#5C5C78', fontSize: 8 }}>{row.qty}</span>
                  <span style={{ textAlign: 'right', color: '#F59E0B' }}>{row.total}</span>
                </div>
              ))}
              {/* Subtotal */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 55px', gap: 4, padding: '6px 4px 2px', borderTop: '1px solid rgba(245,158,11,0.15)', marginTop: 2 }}>
                <span style={{ color: '#9898B0', fontWeight: 700, fontSize: 8 }}>SUBTOTAL</span>
                <span style={{ textAlign: 'right', color: '#FFBF00', fontWeight: 700 }}>$277,500</span>
              </div>
            </div>
          </motion.div>

          {/* Panel C: Isometric 3D Wireframe Massing (bottom-right) */}
          <motion.div
            className="hidden md:block"
            initial={{ opacity: 0, y: 30, rotate: 1 }}
            animate={{ opacity: 1, y: 0, rotate: 1 }}
            transition={{ delay: 1.8, duration: 0.8, ease: smoothEase }}
            style={{
              position: 'absolute', bottom: '15%', right: '10%',
              width: 240, borderRadius: 14, overflow: 'hidden',
              background: 'rgba(18,18,30,0.88)', backdropFilter: 'blur(20px)',
              border: '1px solid rgba(16,185,129,0.2)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 20px rgba(16,185,129,0.06)',
              zIndex: 5,
            }}
          >
            <div style={{ padding: '10px 14px 6px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(16,185,129,0.1)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B981' }} />
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#10B981' }}>3D Massing</span>
            </div>
            <div style={{ padding: '12px 14px 8px' }}>
              <svg width="100%" height="120" viewBox="0 0 200 120" fill="none" style={{ display: 'block' }}>
                {/* Isometric building — top face */}
                <polygon points="100,10 155,32 100,54 45,32" stroke="rgba(16,185,129,0.6)" strokeWidth="0.8" fill="rgba(16,185,129,0.04)" />
                {/* Left face */}
                <polygon points="45,32 100,54 100,98 45,76" stroke="rgba(16,185,129,0.4)" strokeWidth="0.8" fill="rgba(16,185,129,0.02)" />
                {/* Right face */}
                <polygon points="155,32 100,54 100,98 155,76" stroke="rgba(16,185,129,0.5)" strokeWidth="0.8" fill="rgba(16,185,129,0.03)" />
                {/* Floor lines — left face */}
                <line x1="45" y1="43" x2="100" y2="65" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" strokeDasharray="2 3" />
                <line x1="45" y1="54" x2="100" y2="76" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" strokeDasharray="2 3" />
                <line x1="45" y1="65" x2="100" y2="87" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" strokeDasharray="2 3" />
                {/* Floor lines — right face */}
                <line x1="155" y1="43" x2="100" y2="65" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" strokeDasharray="2 3" />
                <line x1="155" y1="54" x2="100" y2="76" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" strokeDasharray="2 3" />
                <line x1="155" y1="65" x2="100" y2="87" stroke="rgba(16,185,129,0.15)" strokeWidth="0.5" strokeDasharray="2 3" />
                {/* Height dimension */}
                <line x1="168" y1="32" x2="168" y2="76" stroke="rgba(16,185,129,0.3)" strokeWidth="0.5" />
                <line x1="165" y1="32" x2="171" y2="32" stroke="rgba(16,185,129,0.3)" strokeWidth="0.5" />
                <line x1="165" y1="76" x2="171" y2="76" stroke="rgba(16,185,129,0.3)" strokeWidth="0.5" />
                <text x="178" y="57" fill="rgba(16,185,129,0.5)" fontSize="7" fontFamily="monospace">21m</text>
                {/* Width dimension */}
                <line x1="45" y1="86" x2="100" y2="108" stroke="rgba(16,185,129,0.25)" strokeWidth="0.5" />
                <line x1="43" y1="83" x2="47" y2="89" stroke="rgba(16,185,129,0.25)" strokeWidth="0.5" />
                <line x1="98" y1="105" x2="102" y2="111" stroke="rgba(16,185,129,0.25)" strokeWidth="0.5" />
                <text x="60" y="105" fill="rgba(16,185,129,0.5)" fontSize="7" fontFamily="monospace">24m</text>
              </svg>
              {/* KPI strip */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 9, color: '#10B981', fontFamily: 'monospace', fontWeight: 600 }}>12F</span>
                <span style={{ fontSize: 9, color: 'rgba(16,185,129,0.3)' }}>·</span>
                <span style={{ fontSize: 9, color: '#10B981', fontFamily: 'monospace', fontWeight: 600 }}>8,400 m²</span>
                <span style={{ fontSize: 9, color: 'rgba(16,185,129,0.3)' }}>·</span>
                <span style={{ fontSize: 9, color: '#10B981', fontFamily: 'monospace', fontWeight: 600 }}>FAR 3.2</span>
              </div>
            </div>
          </motion.div>

          {/* Main hero content */}
          <div style={{ position: "relative", zIndex: 30, textAlign: "center", maxWidth: 1000, padding: "0 48px" }}>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: smoothEase }}
            >
              <h1 style={{
                fontSize: "clamp(2.5rem, 5.5vw, 5rem)",
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

            {/* CTA Button */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6, ease: smoothEase }}
              style={{
                marginTop: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
              }}
            >
              <Link href="/dashboard" style={{
                position: "relative", overflow: "hidden",
                height: 58, padding: "0 44px",
                background: "linear-gradient(135deg, #00F5FF 0%, #4F8AFF 50%, #6366F1 100%)",
                borderRadius: 14,
                display: "inline-flex", alignItems: "center", gap: 10,
                color: "#050510", fontSize: 16, fontWeight: 700,
                textDecoration: "none", letterSpacing: "-0.01em",
                boxShadow: "0 0 40px rgba(0,245,255,0.2), 0 0 80px rgba(79,138,255,0.15)",
                transition: "all 0.3s ease",
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 50px rgba(0,245,255,0.35), 0 0 100px rgba(79,138,255,0.2)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 40px rgba(0,245,255,0.2), 0 0 80px rgba(79,138,255,0.15)";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                }}
              >
                <span style={{
                  position: "absolute", inset: 0, pointerEvents: "none",
                  background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.2) 50%, transparent 60%)",
                  animation: "hero-btn-shimmer 3s ease-in-out infinite",
                }} />
                <Zap size={18} style={{ position: "relative" }} />
                <span style={{ position: "relative" }}>{t('landing.getStarted')}</span>
              </Link>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={12} style={{ color: "rgba(0,245,255,0.4)" }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", letterSpacing: "0.02em" }}>
                  AI-powered BIM workflow builder
                </span>
              </div>
            </motion.div>

            {/* Secondary CTA */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}
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

              {/* Explore Community CTA */}
              <a
                href="#what-others-built"
                onClick={e => { e.preventDefault(); document.getElementById("what-others-built")?.scrollIntoView({ behavior: "smooth" }); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", borderRadius: 10,
                  border: "1px solid rgba(16,185,129,0.2)",
                  background: "rgba(16,185,129,0.05)",
                  color: "#10B981", fontSize: 14, fontWeight: 600,
                  textDecoration: "none", transition: "all 0.25s",
                  cursor: "pointer",
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "rgba(16,185,129,0.12)";
                  el.style.borderColor = "rgba(16,185,129,0.35)";
                  el.style.boxShadow = "0 0 24px rgba(16,185,129,0.12)";
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "rgba(16,185,129,0.05)";
                  el.style.borderColor = "rgba(16,185,129,0.2)";
                  el.style.boxShadow = "none";
                }}
              >
                <Users size={15} />
                Explore Community
                <ChevronDown size={14} style={{ opacity: 0.6 }} />
              </a>
            </motion.div>
          </div>

          {/* Scroll-down indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.8, duration: 0.8 }}
            className="landing-scroll-indicator"
            style={{
              position: "absolute", bottom: 100, left: "50%", transform: "translateX(-50%)",
              zIndex: 30, display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              cursor: "pointer",
            }}
            onClick={() => document.getElementById("what-others-built")?.scrollIntoView({ behavior: "smooth" })}
          >
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase",
              color: "rgba(16,185,129,0.4)",
              fontFamily: '"SF Mono", "Fira Code", monospace',
            }}>
              scroll
            </span>
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              style={{
                width: 28, height: 44, borderRadius: 14,
                border: "1.5px solid rgba(16,185,129,0.2)",
                display: "flex", alignItems: "flex-start", justifyContent: "center",
                paddingTop: 8,
              }}
            >
              <motion.div
                animate={{ y: [0, 12, 0], opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  width: 4, height: 8, borderRadius: 2,
                  background: "rgba(16,185,129,0.5)",
                }}
              />
            </motion.div>
          </motion.div>

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
            <div className="orb-drift-1" style={{ position: "absolute", top: "5%", left: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)", filter: "blur(30px)" }} />
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

        {/* ── AEC Proof Points ─────────────────────────────────────── */}
        <motion.div
          className="landing-section landing-stats-row"
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
          variants={stagger}
          style={{
            display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap',
            padding: '48px 48px',
            background: 'linear-gradient(180deg, #0A0A14, #07070D)',
          }}
        >
          {[
            { value: 12400, decimals: 0, suffix: '', prefix: '', label: 'm² designed this month', color: '#B87333' },
            { value: 847, decimals: 0, suffix: '', prefix: '', label: 'workflows executed', color: '#00F5FF' },
            { value: 31, decimals: 0, suffix: '', prefix: '', label: 'AEC-specific nodes', color: '#FFBF00' },
            { value: 2.4, decimals: 1, suffix: 'M', prefix: '€', label: 'estimated this week', color: '#B87333' },
          ].map((stat, i) => (
            <React.Fragment key={stat.label}>
              <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.1, ease: smoothEase }} style={{ textAlign: 'center', minWidth: 120 }}>
                <AnimatedNumber value={stat.value} decimals={stat.decimals} suffix={stat.suffix} prefix={stat.prefix} color={stat.color} />
                <div style={{ fontSize: 10, color: '#5C5C78', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 4 }}>{stat.label}</div>
              </motion.div>
              {i < 3 && (
                <div style={{ width: 1, alignSelf: 'stretch', background: 'linear-gradient(180deg, transparent, rgba(184,115,51,0.3), transparent)' }} />
              )}
            </React.Fragment>
          ))}
        </motion.div>

        {/* ── Workflow Pipeline Showcase — WF-01 Visual ─────────────── */}
        <section className="landing-section" style={{
          padding: '80px 48px', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(180deg, #07070D 0%, #0A0A14 100%)',
        }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div className="blueprint-grid" style={{ opacity: 0.15 }} />
          </div>

          <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-60px' }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: 'center', marginBottom: 56 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: 'block', color: 'rgba(184,115,51,0.6)' }}>
                REAL WORKFLOW
              </span>
              <div className="accent-line" style={{ background: 'linear-gradient(90deg, #B87333, #F59E0B)' }} />
              <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', fontWeight: 900, color: '#F0F0F5', letterSpacing: '-0.04em', lineHeight: 1.1 }}>
                See What a Pipeline<br />
                <span style={{ background: 'linear-gradient(135deg, #B87333, #F59E0B)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Actually Produces</span>
              </h2>
            </motion.div>

            {/* 4-step pipeline: Text Brief → AI Analysis → 3D Massing → Concept Render */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}
              variants={stagger}
              className="landing-pipeline-showcase"
              style={{ display: 'flex', alignItems: 'stretch', gap: 0, justifyContent: 'center' }}
            >
              {[
                {
                  step: '01', label: 'Text Brief', category: 'input', color: '#3B82F6',
                  icon: <FileCode size={22} />,
                  preview: '"Mixed-use tower, 12 floors, retail podium, residential above, coastal site..."',
                  previewType: 'text' as const,
                },
                {
                  step: '02', label: 'AI Analysis', category: 'transform', color: '#8B5CF6',
                  icon: <Sparkles size={22} />,
                  preview: 'GFA: 8,400 m² · FAR: 3.2 · Units: 96 · Parking: 120',
                  previewType: 'kpi' as const,
                },
                {
                  step: '03', label: '3D Massing', category: 'generate', color: '#10B981',
                  icon: <Box size={22} />,
                  preview: '◻ ◻ ◻ ◻ ◻\n◻ ◻ ◻ ◻ ◻\n◻ ◻ ◻ ◻ ◻\n▣ ▣ ▣ ▣ ▣',
                  previewType: 'wireframe' as const,
                },
                {
                  step: '04', label: 'Concept Render', category: 'export', color: '#F59E0B',
                  icon: <ImageIcon size={22} />,
                  preview: '🏗 Final render exported',
                  previewType: 'render' as const,
                },
              ].map((item, i) => {
                const rgb = hexToRgb(item.color);
                return (
                  <React.Fragment key={item.step}>
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.12, ease: smoothEase }}
                      className="node-card"
                      style={{
                        flex: 1, minWidth: 0, '--node-port-color': item.color,
                      } as React.CSSProperties}
                    >
                      <div className="node-header" style={{
                        background: `linear-gradient(135deg, rgba(${rgb}, 0.15), rgba(${rgb}, 0.04))`,
                        borderBottom: `1px solid rgba(${rgb}, 0.12)`,
                        borderRadius: '16px 16px 0 0',
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, boxShadow: `0 0 8px ${item.color}` }} />
                        <span style={{ color: item.color }}>{item.category.toUpperCase()}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>#{item.step}</span>
                      </div>
                      <div style={{ padding: '20px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            background: `linear-gradient(135deg, rgba(${rgb}, 0.2), rgba(${rgb}, 0.06))`,
                            border: `1px solid rgba(${rgb}, 0.2)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: item.color, flexShrink: 0,
                          }}>
                            {item.icon}
                          </div>
                          <h3 style={{ fontSize: 15, fontWeight: 800, color: '#F0F0F5', letterSpacing: '-0.02em' }}>{item.label}</h3>
                        </div>
                        {/* Preview content */}
                        <div style={{
                          padding: '12px',
                          borderRadius: 8,
                          background: 'rgba(7,7,13,0.6)',
                          border: `1px solid rgba(${rgb}, 0.08)`,
                          minHeight: 64,
                        }}>
                          {item.previewType === 'text' && (
                            <div style={{ fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: 10, color: '#9898B0', lineHeight: 1.6 }}>
                              <div style={{ color: '#3B82F6', fontSize: 8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>PROJECT BRIEF</div>
                              <div>&quot;Mixed-use tower, 12 floors,</div>
                              <div>retail podium + residential,</div>
                              <div>coastal site, 2,800 m² lot&quot;</div>
                              <motion.span
                                animate={{ opacity: [1, 0] }}
                                transition={{ duration: 0.8, repeat: Infinity }}
                                style={{ display: 'inline-block', width: 6, height: 12, background: '#3B82F6', marginLeft: 2, verticalAlign: 'middle' }}
                              />
                            </div>
                          )}
                          {item.previewType === 'kpi' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: `rgba(${rgb}, 0.06)`, borderRadius: 4, overflow: 'hidden' }}>
                              {[
                                { label: 'GFA', value: '8,400', unit: 'm²' },
                                { label: 'FAR', value: '3.2', unit: '' },
                                { label: 'Units', value: '96', unit: 'apt' },
                                { label: 'Parking', value: '120', unit: 'spots' },
                              ].map(kpi => (
                                <div key={kpi.label} style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(7,7,13,0.8)' }}>
                                  <div style={{ fontSize: 15, fontWeight: 800, color: item.color, fontFamily: '"SF Mono", "Fira Code", monospace' }}>{kpi.value}</div>
                                  <div style={{ fontSize: 7, color: '#5C5C78', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                                    {kpi.label}{kpi.unit && <span style={{ color: 'rgba(255,255,255,0.2)', marginLeft: 3 }}>{kpi.unit}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {item.previewType === 'wireframe' && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <svg width="100%" height="80" viewBox="0 0 160 90" fill="none" style={{ maxWidth: 160 }}>
                                {/* Isometric building */}
                                <polygon points="80,8 130,28 80,48 30,28" stroke="rgba(16,185,129,0.6)" strokeWidth="0.8" fill="rgba(16,185,129,0.04)" />
                                <polygon points="30,28 80,48 80,82 30,62" stroke="rgba(16,185,129,0.4)" strokeWidth="0.8" fill="rgba(16,185,129,0.02)" />
                                <polygon points="130,28 80,48 80,82 130,62" stroke="rgba(16,185,129,0.5)" strokeWidth="0.8" fill="rgba(16,185,129,0.03)" />
                                {/* Floor lines */}
                                <line x1="30" y1="39" x2="80" y2="59" stroke="rgba(16,185,129,0.2)" strokeWidth="0.5" strokeDasharray="2 3" />
                                <line x1="30" y1="50" x2="80" y2="70" stroke="rgba(16,185,129,0.2)" strokeWidth="0.5" strokeDasharray="2 3" />
                                <line x1="130" y1="39" x2="80" y2="59" stroke="rgba(16,185,129,0.2)" strokeWidth="0.5" strokeDasharray="2 3" />
                                <line x1="130" y1="50" x2="80" y2="70" stroke="rgba(16,185,129,0.2)" strokeWidth="0.5" strokeDasharray="2 3" />
                                {/* Height dimension */}
                                <line x1="142" y1="28" x2="142" y2="62" stroke="rgba(16,185,129,0.3)" strokeWidth="0.5" />
                                <line x1="139" y1="28" x2="145" y2="28" stroke="rgba(16,185,129,0.3)" strokeWidth="0.5" />
                                <line x1="139" y1="62" x2="145" y2="62" stroke="rgba(16,185,129,0.3)" strokeWidth="0.5" />
                                <text x="150" y="48" fill="rgba(16,185,129,0.5)" fontSize="6" fontFamily="monospace">21m</text>
                              </svg>
                              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                                <span style={{ fontSize: 8, color: '#10B981', fontFamily: 'monospace' }}>12F</span>
                                <span style={{ fontSize: 8, color: 'rgba(16,185,129,0.4)' }}>·</span>
                                <span style={{ fontSize: 8, color: '#10B981', fontFamily: 'monospace' }}>8,400 m²</span>
                              </div>
                            </div>
                          )}
                          {item.previewType === 'render' && (
                            <div style={{ textAlign: 'center', position: 'relative' }}>
                              <div style={{
                                width: '100%', height: 56, borderRadius: 6,
                                background: 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(239,68,68,0.08) 40%, rgba(139,92,246,0.1) 100%)',
                                border: '1px solid rgba(245,158,11,0.15)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                position: 'relative', overflow: 'hidden',
                              }}>
                                <motion.div
                                  animate={{ x: ['-100%', '200%'] }}
                                  transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                                  style={{
                                    position: 'absolute', top: 0, bottom: 0, width: '30%',
                                    background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.1), transparent)',
                                  }}
                                />
                                <span style={{
                                  fontSize: 8, fontWeight: 700, letterSpacing: '0.15em',
                                  color: '#F59E0B', textTransform: 'uppercase',
                                  padding: '3px 8px', borderRadius: 4,
                                  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                                  position: 'relative', zIndex: 1,
                                }}>AI RENDER</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 6 }}>
                                <span style={{ fontSize: 8, color: '#5C5C78', fontFamily: 'monospace' }}>2048×1024</span>
                                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)' }}>·</span>
                                <span style={{ fontSize: 8, color: '#5C5C78', fontFamily: 'monospace' }}>HDR</span>
                                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)' }}>·</span>
                                <span style={{ fontSize: 8, color: '#F59E0B', fontFamily: 'monospace' }}>DALL-E 3</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                    {/* Animated dashed connector */}
                    {i < 3 && (
                      <div className="landing-pipeline-connector" style={{ width: 48, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="48" height="40" viewBox="0 0 48 40" fill="none">
                          <line x1="0" y1="20" x2="48" y2="20"
                            stroke={`rgba(${hexToRgb(item.color)}, 0.3)`}
                            strokeWidth="2" strokeDasharray="4 4"
                            className="wire-animate"
                          />
                          <polygon
                            points="40,14 48,20 40,26"
                            fill={`rgba(${hexToRgb(item.color)}, 0.4)`}
                          />
                        </svg>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </motion.div>
          </div>
        </section>

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
            <div className="orb-drift-2" style={{ position: "absolute", bottom: "10%", left: "5%", width: 450, height: 450, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)", filter: "blur(30px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", top: "10%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
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

        {/* ── CTA Banner — Community Roadmap ─────────────────────────── */}
        <div className="landing-roadmap-cta-strip" style={{
          position: "relative", padding: "28px 48px",
          borderTop: "1px solid rgba(245,158,11,0.15)",
          borderBottom: "1px solid rgba(245,158,11,0.15)",
          background: "linear-gradient(90deg, rgba(245,158,11,0.04) 0%, rgba(184,115,51,0.04) 50%, rgba(245,158,11,0.04) 100%)",
        }}>
          {/* Glow lines */}
          <div style={{ position: "absolute", top: -1, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.3), transparent)" }} />
          <div style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(184,115,51,0.3), transparent)" }} />
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <ClipboardList size={18} style={{ color: "#F59E0B", flexShrink: 0 }} />
              <span className="blueprint-annotation" style={{ fontSize: 9, fontWeight: 700, letterSpacing: "2px", color: "#F59E0B", textTransform: "uppercase" as const }}>{t('landing.roadmap.ctaLabel')}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F5" }}>{t('landing.roadmap.ctaText')}</span>
            </div>
            <a
              href="#community"
              onClick={e => { e.preventDefault(); document.getElementById("community")?.scrollIntoView({ behavior: "smooth" }); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: "rgba(245,158,11,0.12)", color: "#F59E0B",
                border: "1px solid rgba(245,158,11,0.25)",
                textDecoration: "none", cursor: "pointer", transition: "all 0.2s",
                flexShrink: 0,
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(245,158,11,0.2)"; el.style.boxShadow = "0 0 16px rgba(245,158,11,0.15)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(245,158,11,0.12)"; el.style.boxShadow = "none"; }}
            >
              {t('landing.roadmap.ctaButton')} <ArrowRight size={14} />
            </a>
          </div>
        </div>

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
            <div className="orb-drift-3" style={{ position: "absolute", top: "5%", left: "8%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <div className="orb-drift-1" style={{ position: "absolute", bottom: "10%", right: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", filter: "blur(20px)" }} />
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

        {/* ── Community Social Proof — What Others Built ───────────── */}
        <section id="what-others-built" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A16 50%, #07070D 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.2 }} />
            <div className="orb-drift-2" style={{ position: "absolute", top: "10%", left: "10%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", bottom: "10%", right: "8%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.06) 0%, transparent 70%)", filter: "blur(20px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 64 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(16,185,129,0.5)" }}>
                COMMUNITY
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #10B981, #06B6D4)" }} />
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1 }}>
                What Others{" "}
                <span style={{ background: "linear-gradient(135deg, #10B981, #06B6D4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Have Built</span>
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96", maxWidth: 520, margin: "16px auto 0", lineHeight: 1.7 }}>
                Real workflows created by AEC professionals on BuildFlow. Browse, duplicate, and build on what the community has already proven.
              </p>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
              className="landing-social-proof-grid"
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}
            >
              {COMMUNITY_WORKFLOWS.map((wf, i) => {
                const rgb = hexToRgb(wf.color);
                return (
                  <motion.div key={wf.name} variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.06, ease: smoothEase }}
                    className="node-card"
                    style={{ '--node-port-color': wf.color } as React.CSSProperties}
                  >
                    {/* Header */}
                    <div className="node-header" style={{
                      background: `linear-gradient(135deg, rgba(${rgb}, 0.12), rgba(${rgb}, 0.04))`,
                      borderBottom: `1px solid rgba(${rgb}, 0.12)`,
                      borderRadius: "16px 16px 0 0",
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: wf.color, boxShadow: `0 0 8px ${wf.color}` }} />
                      <span style={{ color: wf.color }}>{wf.discipline.toUpperCase()}</span>
                      <span style={{ marginLeft: "auto", fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{wf.phase}</span>
                    </div>

                    <div style={{ padding: "20px 20px 16px" }}>
                      <h4 style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F5", margin: "0 0 12px", lineHeight: 1.3 }}>{wf.name}</h4>

                      {/* Builder info */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: `linear-gradient(135deg, rgba(${rgb}, 0.2), rgba(${rgb}, 0.08))`,
                          border: `1px solid rgba(${rgb}, 0.2)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: wf.color, flexShrink: 0,
                        }}>
                          <Building2 size={13} />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#F0F0F5" }}>{wf.builder}</div>
                          <div style={{ fontSize: 10, color: "#5C5C78" }}>{wf.role} · {wf.firm}</div>
                        </div>
                      </div>

                      {/* Divider */}
                      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 12 }} />

                      {/* Stats */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Star size={12} style={{ color: wf.color }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#F0F0F5", fontFamily: "monospace" }}>{wf.uses.toLocaleString()}</span>
                            <span style={{ fontSize: 9, color: "#5C5C78" }}>runs</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Copy size={11} style={{ color: "#5C5C78" }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#9898B0", fontFamily: "monospace" }}>{wf.duplicated}</span>
                            <span style={{ fontSize: 9, color: "#5C5C78" }}>cloned</span>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${Math.min((wf.uses / 600) * 100, 100)}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 1.2, ease: smoothEase, delay: 0.3 + i * 0.1 }}
                          style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${wf.color}, rgba(${rgb}, 0.3))` }}
                        />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Community stat bar */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase, delay: 0.3 }}
              style={{
                marginTop: 40, display: "flex", justifyContent: "center", gap: 40, flexWrap: "wrap",
                padding: "20px 24px", borderRadius: 14,
                background: "rgba(18,18,30,0.6)", border: "1px solid rgba(16,185,129,0.1)",
              }}
            >
              {[
                { label: "Active Builders", value: "1,240+", color: "#10B981" },
                { label: "Workflows Shared", value: "380+", color: "#06B6D4" },
                { label: "Total Executions", value: "52,000+", color: "#F59E0B" },
              ].map(stat => (
                <div key={stat.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: stat.color, fontFamily: '"SF Mono", "Fira Code", monospace' }}>{stat.value}</div>
                  <div style={{ fontSize: 10, color: "#5C5C78", textTransform: "uppercase", letterSpacing: "0.15em", marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ── Community Voting / Tender Board ──────────────────────── */}
        <section id="community" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A14 50%, #07070D 100%)",
        }}>
          {/* Background */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.25 }} />
            <div className="orb-drift-1" style={{ position: "absolute", top: "10%", right: "8%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <div className="orb-drift-2" style={{ position: "absolute", bottom: "15%", left: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(184,115,51,0.06) 0%, transparent 70%)", filter: "blur(20px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            {/* Header */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={stagger}
              style={{ textAlign: "center", marginBottom: 56 }}
            >
              <motion.span variants={fadeUp} className="blueprint-annotation" style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "3px", color: "#F59E0B",
                textTransform: "uppercase" as const, display: "block", marginBottom: 16,
              }}>
                {t('landing.roadmap.sectionAnnotation')}
              </motion.span>
              <motion.div variants={fadeUp} className="accent-line" style={{
                width: 48, height: 2, margin: "0 auto 24px",
                background: "linear-gradient(90deg, #F59E0B, #B87333)",
                borderRadius: 1,
              }} />
              <motion.h2 variants={fadeUp} style={{
                fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, color: "#F0F0F5",
                lineHeight: 1.15, margin: "0 0 16px",
              }}>
                {t('landing.roadmap.sectionTitle1')}{' '}
                <span style={{ background: "linear-gradient(135deg, #F59E0B, #B87333)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {t('landing.roadmap.sectionTitle2')}
                </span>
              </motion.h2>
              <motion.p variants={fadeUp} style={{ fontSize: 16, color: "#9898B0", maxWidth: 560, margin: "0 auto" }}>
                {t('landing.roadmap.sectionSubtitle')}
              </motion.p>
            </motion.div>

            {/* Stats strip */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, ease: smoothEase }}
              style={{
                display: "flex", justifyContent: "center", gap: 48, marginBottom: 48, flexWrap: "wrap",
              }}
            >
              {[
                { label: t('landing.roadmap.totalVotes'), value: totalVotes, color: "#F59E0B" },
                { label: t('landing.roadmap.itemsInPipeline'), value: ROADMAP_ITEMS.length, color: "#4F8AFF" },
                { label: t('landing.roadmap.itemsApproved'), value: ROADMAP_ITEMS.filter(i => i.status === "approved" || i.status === "in-progress").length, color: "#10B981" },
              ].map(stat => (
                <div key={stat.label} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 800, color: stat.color }}>
                    <AnimatedNumber value={stat.value} color={stat.color} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#5C5C78", textTransform: "uppercase" as const, letterSpacing: "1px", marginTop: 4 }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Vote cards grid */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
              variants={stagger}
              className="landing-roadmap-grid"
              style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 40 }}
            >
              {ROADMAP_ITEMS.map(item => (
                <VoteCard
                  key={item.id}
                  item={item}
                  votes={roadmapVotes[item.id] ?? item.defaultVotes}
                  hasVoted={votedItems.has(item.id)}
                  onVote={() => handleVote(item.id)}
                  t={t}
                  maxVotes={maxVotes}
                />
              ))}
            </motion.div>

            {/* Footer CTA */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={fadeUp}
              transition={{ duration: 0.5, ease: smoothEase }}
              style={{ textAlign: "center" }}
            >
              <Link
                href="/login"
                style={{
                  fontSize: 14, color: "#F59E0B", textDecoration: "none",
                  fontWeight: 600, transition: "color 0.2s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#FFBF00"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#F59E0B"; }}
              >
                {t('landing.roadmap.signUpToVote')} →
              </Link>
            </motion.div>
          </div>
        </section>

        {/* ── Workflow Request / Brief Submission ──────────────────── */}
        <section id="request-workflow" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0C0A14 50%, #07070D 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.2 }} />
            <div className="orb-drift-1" style={{ position: "absolute", top: "15%", right: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(184,115,51,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", bottom: "10%", left: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)", filter: "blur(20px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            {/* Section Header */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 56 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(184,115,51,0.6)" }}>
                WORKFLOW BRIEF
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #B87333, #F59E0B)" }} />
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1 }}>
                Request a{" "}
                <span style={{ background: "linear-gradient(135deg, #B87333, #F59E0B)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Workflow</span>
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96", maxWidth: 560, margin: "16px auto 0", lineHeight: 1.7 }}>
                Tell us what workflow your practice needs. We build the most requested ones first. Your brief goes live so others can back the same idea.
              </p>
            </motion.div>

            {/* Two-column: Form + Live Feed */}
            <div className="landing-request-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>
              {/* LEFT: Submission Form */}
              <motion.div
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
                variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
              >
                <div className="node-card" style={{ '--node-port-color': '#B87333' } as React.CSSProperties}>
                  <div className="node-header" style={{
                    background: "linear-gradient(135deg, rgba(184,115,51,0.15), rgba(184,115,51,0.04))",
                    borderBottom: "1px solid rgba(184,115,51,0.12)",
                    borderRadius: "16px 16px 0 0",
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#B87333", boxShadow: "0 0 8px #B87333" }} />
                    <span style={{ color: "#B87333" }}>SUBMIT YOUR BRIEF</span>
                  </div>

                  <form onSubmit={handleRequestSubmit} style={{ padding: "24px 24px 20px" }}>
                    {/* Workflow Name */}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5C5C78", marginBottom: 6, fontFamily: "monospace" }}>
                        Workflow Name
                      </label>
                      <input
                        type="text"
                        value={requestForm.name}
                        onChange={e => setRequestForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Acoustic Performance Assessment"
                        style={{
                          width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14,
                          background: "rgba(7,7,13,0.8)", border: "1px solid rgba(184,115,51,0.15)",
                          color: "#F0F0F5", outline: "none", transition: "border-color 0.2s",
                          boxSizing: "border-box",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.4)"; }}
                        onBlur={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.15)"; }}
                      />
                    </div>

                    {/* Industry / Discipline */}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5C5C78", marginBottom: 6, fontFamily: "monospace" }}>
                        Discipline / Industry
                      </label>
                      <input
                        type="text"
                        value={requestForm.discipline}
                        onChange={e => setRequestForm(prev => ({ ...prev, discipline: e.target.value }))}
                        placeholder="e.g. Structural Engineering, MEP, Planning"
                        style={{
                          width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14,
                          background: "rgba(7,7,13,0.8)", border: "1px solid rgba(184,115,51,0.15)",
                          color: "#F0F0F5", outline: "none", transition: "border-color 0.2s",
                          boxSizing: "border-box",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.4)"; }}
                        onBlur={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.15)"; }}
                      />
                    </div>

                    {/* Problem it solves */}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5C5C78", marginBottom: 6, fontFamily: "monospace" }}>
                        What Problem Does It Solve?
                      </label>
                      <textarea
                        value={requestForm.problem}
                        onChange={e => setRequestForm(prev => ({ ...prev, problem: e.target.value }))}
                        placeholder="Describe the workflow you need and why it matters to your practice..."
                        rows={3}
                        style={{
                          width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14,
                          background: "rgba(7,7,13,0.8)", border: "1px solid rgba(184,115,51,0.15)",
                          color: "#F0F0F5", outline: "none", transition: "border-color 0.2s",
                          resize: "vertical", fontFamily: "inherit", lineHeight: 1.6,
                          boxSizing: "border-box",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.4)"; }}
                        onBlur={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.15)"; }}
                      />
                    </div>

                    {/* Email */}
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5C5C78", marginBottom: 6, fontFamily: "monospace" }}>
                        Your Email (we notify you when it&apos;s built)
                      </label>
                      <input
                        type="email"
                        value={requestForm.email}
                        onChange={e => setRequestForm(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="you@practice.com"
                        style={{
                          width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14,
                          background: "rgba(7,7,13,0.8)", border: "1px solid rgba(184,115,51,0.15)",
                          color: "#F0F0F5", outline: "none", transition: "border-color 0.2s",
                          boxSizing: "border-box",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.4)"; }}
                        onBlur={e => { e.currentTarget.style.borderColor = "rgba(184,115,51,0.15)"; }}
                      />
                    </div>

                    {/* Submit button */}
                    <button
                      type="submit"
                      style={{
                        width: "100%", padding: "14px 24px", borderRadius: 12,
                        background: requestSubmitted
                          ? "rgba(16,185,129,0.15)"
                          : "linear-gradient(135deg, #B87333, #F59E0B)",
                        color: requestSubmitted ? "#10B981" : "#050510",
                        fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "all 0.3s",
                        boxShadow: requestSubmitted ? "none" : "0 4px 20px rgba(184,115,51,0.3)",
                      }}
                    >
                      {requestSubmitted ? (
                        <>Brief Submitted Successfully</>
                      ) : (
                        <>
                          <Send size={15} />
                          Submit Workflow Brief
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </motion.div>

              {/* RIGHT: Live Community Feed */}
              <motion.div
                initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
                variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase, delay: 0.15 }}
              >
                <div className="node-card" style={{ '--node-port-color': '#F59E0B' } as React.CSSProperties}>
                  <div className="node-header" style={{
                    background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))",
                    borderBottom: "1px solid rgba(245,158,11,0.12)",
                    borderRadius: "16px 16px 0 0",
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981", animation: "glow-pulse 2s infinite" }} />
                    <span style={{ color: "#F59E0B" }}>LIVE COMMUNITY FEED</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "#5C5C78", fontFamily: "monospace" }}>{workflowRequests.length} briefs</span>
                  </div>

                  <div style={{ padding: "8px 0", maxHeight: 460, overflowY: "auto" }}>
                    {[...workflowRequests].sort((a, b) => b.votes - a.votes).map((req, i) => {
                      const hasVoted = requestVoted.has(req.id);
                      return (
                        <div key={req.id} style={{
                          padding: "14px 20px",
                          borderBottom: i < workflowRequests.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                          transition: "background 0.15s",
                        }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.03)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                            {/* Vote button */}
                            <button
                              onClick={() => handleRequestVote(req.id)}
                              style={{
                                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                                padding: "6px 8px", borderRadius: 8, border: "none", cursor: "pointer",
                                background: hasVoted ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.08)",
                                color: hasVoted ? "#10B981" : "#F59E0B",
                                transition: "all 0.2s", flexShrink: 0, minWidth: 40,
                              }}
                            >
                              <ChevronUp size={14} />
                              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{req.votes}</span>
                            </button>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h5 style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F5", margin: "0 0 4px", lineHeight: 1.3 }}>{req.name}</h5>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{
                                  fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
                                  padding: "2px 6px", borderRadius: 4,
                                  background: "rgba(79,138,255,0.1)", color: "#4F8AFF",
                                  border: "1px solid rgba(79,138,255,0.2)",
                                }}>{req.discipline}</span>
                                <span style={{ fontSize: 10, color: "#3A3A50", fontFamily: "monospace" }}>{req.createdAt}</span>
                              </div>
                              <p style={{
                                fontSize: 12, color: "#7C7C96", lineHeight: 1.5, margin: 0,
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                              }}>{req.problem}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── How It Works — Horizontal Pipeline ───────────────────── */}
        <section id="how-it-works" className="landing-section" style={{ padding: "120px 48px", position: "relative", overflow: "hidden" }}>
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
            <div className="orb-drift-1" style={{ position: "absolute", bottom: "5%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)", filter: "blur(20px)" }} />
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
            <div className="orb-drift-2" style={{ position: "absolute", top: "5%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", bottom: "10%", right: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)", filter: "blur(20px)" }} />
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
            <div className="orb-drift-1" style={{ position: "absolute", top: "20%", left: "30%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.12) 0%, transparent 70%)", filter: "blur(30px)" }} />
            <div className="orb-drift-2" style={{ position: "absolute", bottom: "10%", right: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)", filter: "blur(25px)" }} />
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
      <footer className="landing-footer-wrapper" style={{
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
            {[
              { label: t('landing.privacy'), href: '/privacy' },
              { label: t('landing.terms'), href: '/terms' },
              { label: t('landing.contact'), href: '/contact' },
            ].map(l => (
              <Link key={l.href} href={l.href} style={{ fontSize: 12, color: "#5C5C78", textDecoration: "none", transition: "color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
              >{l.label}</Link>
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
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* ─── Tablet: 769px – 1024px ───────────────────────────── */
        @media (max-width: 1024px) {
          .landing-grid-3 {
            grid-template-columns: 1fr 1fr !important;
          }
          .landing-social-proof-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .landing-roadmap-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .landing-pipeline-showcase {
            flex-wrap: wrap !important;
          }
          .landing-pipeline-showcase > .node-card {
            flex: 1 1 calc(50% - 48px) !important;
            min-width: 200px !important;
          }
          .landing-pipeline-connector:nth-child(even) {
            display: none !important;
          }
        }

        /* ─── Mobile: 768px and below ──────────────────────────── */
        @media (max-width: 768px) {
          /* ── Navbar ── */
          .landing-nav-links {
            display: none !important;
          }
          .landing-login-link {
            display: none !important;
          }

          /* ── Hero ── */
          .landing-side-toolbar,
          .landing-prompt-card,
          .landing-floating-card {
            display: none !important;
          }
          .landing-partners {
            gap: 12px !important;
            flex-wrap: wrap !important;
            padding: 0 20px !important;
            justify-content: center !important;
          }
          .landing-partners span {
            font-size: 8px !important;
            letter-spacing: 1px !important;
          }

          /* ── Pipeline Grid (Core Capabilities) ── */
          .landing-pipeline-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
          .landing-wire-connector {
            display: none !important;
          }

          /* ── Built For Strip ── */
          .landing-built-for {
            flex-direction: column !important;
            gap: 12px !important;
          }
          .landing-built-for-divider {
            display: none !important;
          }

          /* ── Stats Row ── */
          .landing-stats-row {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 20px 16px !important;
            padding: 32px 20px !important;
          }
          .landing-stats-row > div[style*="width: 1"] {
            display: none !important;
          }

          /* ── Pipeline Showcase ── */
          .landing-pipeline-showcase {
            flex-direction: column !important;
            gap: 16px !important;
          }
          .landing-pipeline-connector {
            display: none !important;
          }

          /* ── All 3-column grids ── */
          .landing-grid-3 {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }

          /* ── Social Proof grid ── */
          .landing-social-proof-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }

          /* ── Roadmap ── */
          .landing-roadmap-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
          .landing-roadmap-cta-strip {
            padding: 20px 16px !important;
          }
          .landing-roadmap-cta-strip > div {
            flex-direction: column !important;
            text-align: center;
            gap: 12px !important;
          }

          /* ── Workflow Request Layout ── */
          .landing-request-layout {
            grid-template-columns: 1fr !important;
            gap: 20px !important;
          }

          /* ── Steps (How It Works) ── */
          .landing-steps {
            flex-direction: column !important;
            gap: 16px !important;
          }
          .landing-step-connector {
            display: none !important;
          }

          /* ── Footer ── */
          .landing-footer {
            flex-direction: column !important;
            gap: 16px !important;
            text-align: center !important;
          }
          .landing-footer-wrapper {
            padding: 24px 16px !important;
          }

          /* ── Section padding override ── */
          .landing-section {
            padding-left: 16px !important;
            padding-right: 16px !important;
          }
          section.landing-section {
            padding-top: 64px !important;
            padding-bottom: 64px !important;
          }

          /* ── Scroll indicator ── */
          .landing-scroll-indicator {
            display: none !important;
          }

          /* ── News ticker ── */
          .landing-news-ticker {
            height: 30px !important;
          }

          /* ── Buttons: ensure tappable size ── */
          button, a[href] {
            min-height: 44px;
          }

          /* ── Hero heading ── */
          h1 {
            font-size: clamp(1.8rem, 8vw, 2.5rem) !important;
          }

          /* ── Hero content padding ── */
          div[style*="maxWidth: 1000"] {
            padding: 0 16px !important;
          }
        }

        /* ─── Small phones: 480px and below ───────────────────── */
        @media (max-width: 480px) {
          h1 {
            font-size: 1.7rem !important;
          }
          h2 {
            font-size: 1.5rem !important;
          }
          .landing-stats-row {
            grid-template-columns: 1fr !important;
          }
          .landing-partners {
            display: none !important;
          }
          .landing-section {
            padding-left: 12px !important;
            padding-right: 12px !important;
          }
        }

        /* ─── Min 320px safety ─────────────────────────────────── */
        @media (max-width: 360px) {
          h1 {
            font-size: 1.5rem !important;
            letter-spacing: -0.02em !important;
          }
          .landing-news-ticker {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
