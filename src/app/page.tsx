"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useScroll, useTransform, useInView } from "framer-motion";
import {
  ArrowRight, Zap, Sparkles, Users, LayoutGrid,
  Box, Play, Image as ImageIcon, FileCode,
  MousePointerClick, Workflow, Layers, Settings, Target, Calendar,
  ChevronUp, ChevronDown, ClipboardList, Send, Copy, Building2, Star,
  Film, Eye, Heart, Upload,
} from "lucide-react";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useLocale } from '@/hooks/useLocale';
import type { TranslationKey } from '@/lib/i18n';
import { trackLead } from '@/lib/meta-pixel';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { PipelineSection } from '@/components/landing/PipelineSection';

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
  const { t } = useLocale();
  const icons = [
    { icon: <MousePointerClick size={18} />, tip: t('landing.toolbarSelect') },
    { icon: <Workflow size={18} />, tip: t('landing.toolbarAddNode') },
    { icon: <Settings size={18} />, tip: t('landing.toolbarConfigure') },
    { icon: <Layers size={18} />, tip: t('landing.toolbarLayers') },
    { icon: <Target size={18} />, tip: t('landing.toolbarAIAssist') },
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

const PARTNER_LOGO_KEYS = ['landing.builtForAecBadge', 'landing.complementBadge', 'landing.noCadBadge', 'landing.schematicBadge'] as const;

// ─── Community Social Proof Data ────────────────────────────────────────────

const COMMUNITY_WORKFLOWS = [
  { name: "MEP Coordination Clash Review", builder: "Sarah M.", role: "MEP Lead", firm: "Arup", discipline: "MEP", phase: "RIBA Stage 4", uses: 342, duplicated: 89, color: "#3B82F6", lastRun: 1, preview: "mep" as const },
  { name: "Pre-Commencement Condition Discharge", builder: "James T.", role: "Project Manager", firm: "Mace Group", discipline: "Planning", phase: "Stage 5", uses: 218, duplicated: 56, color: "#8B5CF6", lastRun: 3, preview: "planning" as const },
  { name: "RIBA Stage 4 Drawing Issue Workflow", builder: "Priya K.", role: "BIM Manager", firm: "Foster + Partners", discipline: "Architecture", phase: "RIBA Stage 4", uses: 567, duplicated: 134, color: "#10B981", lastRun: 0, preview: "architecture" as const },
  { name: "Structural Steel Takeoff & BOQ", builder: "Marcus W.", role: "QS Engineer", firm: "Turner & Townsend", discipline: "Structures", phase: "Stage 3–4", uses: 421, duplicated: 97, color: "#F59E0B", lastRun: 2, preview: "structural" as const },
  { name: "Façade Panel Schedule Generator", builder: "Lena H.", role: "Façade Engineer", firm: "Schüco", discipline: "Envelope", phase: "Detail Design", uses: 189, duplicated: 43, color: "#EF4444", lastRun: 5, preview: "facade" as const },
  { name: "Site Logistics & Crane Reach Analysis", builder: "David C.", role: "Site Manager", firm: "Laing O'Rourke", discipline: "Construction", phase: "Pre-Construction", uses: 305, duplicated: 71, color: "#06B6D4", lastRun: 1, preview: "construction" as const },
  { name: "Embodied Carbon Reporting Pipeline", builder: "Amara O.", role: "Sustainability Lead", firm: "BDP", discipline: "Sustainability", phase: "RIBA Stage 2–3", uses: 478, duplicated: 112, color: "#22C55E", lastRun: 0, preview: "sustainability" as const },
  { name: "Automated Clash Detection & Resolution", builder: "Tom R.", role: "BIM Coordinator", firm: "Multiplex", discipline: "BIM Coordination", phase: "Stage 4", uses: 623, duplicated: 158, color: "#A855F7", lastRun: 0, preview: "bim" as const },
  { name: "Client Presentation Deck Generator", builder: "Nina S.", role: "Design Director", firm: "Zaha Hadid Architects", discipline: "Design Management", phase: "RIBA Stage 2", uses: 284, duplicated: 67, color: "#EC4899", lastRun: 4, preview: "design" as const },
  { name: "NBS Specification Writer & Mapper", builder: "George L.", role: "Specification Manager", firm: "Gleeds", discipline: "Specifications", phase: "Stage 3–4", uses: 196, duplicated: 51, color: "#14B8A6", lastRun: 6, preview: "specs" as const },
  { name: "Construction Phasing Sequence Planner", builder: "Rachel K.", role: "Planning Manager", firm: "Balfour Beatty", discipline: "Construction Planning", phase: "Pre-Construction", uses: 347, duplicated: 82, color: "#F97316", lastRun: 2, preview: "phasing" as const },
  { name: "As-Built vs Design Comparison", builder: "Ahmed B.", role: "QA Lead", firm: "WSP", discipline: "Quality Assurance", phase: "Stage 5–6", uses: 259, duplicated: 63, color: "#0EA5E9", lastRun: 3, preview: "qa" as const },
];

/* ── Procedural SVG preview for each workflow type ──────────────────────── */
function WorkflowPreviewSVG({ type, color, rgb }: { type: string; color: string; rgb: string }) {
  const w = 320, h = 140;
  const shared = { width: w, height: h, viewBox: `0 0 ${w} ${h}`, fill: "none", xmlns: "http://www.w3.org/2000/svg" };

  switch (type) {
    case "mep": return (
      <svg {...shared}>
        <defs><linearGradient id="mep-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.15)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#mep-g)"/>
        {/* Horizontal ducts */}
        <rect x="20" y="30" width="120" height="8" rx="2" fill={`rgba(${rgb},0.25)`}/>
        <rect x="20" y="62" width="180" height="8" rx="2" fill={`rgba(${rgb},0.18)`}/>
        <rect x="20" y="94" width="100" height="8" rx="2" fill={`rgba(${rgb},0.12)`}/>
        {/* Vertical pipes */}
        <rect x="140" y="10" width="6" height="50" rx="2" fill={`rgba(${rgb},0.3)`}/>
        <rect x="200" y="40" width="6" height="70" rx="2" fill={`rgba(${rgb},0.2)`}/>
        <rect x="250" y="20" width="6" height="90" rx="2" fill={`rgba(${rgb},0.15)`}/>
        {/* Clash markers */}
        <circle cx="142" cy="34" r="10" fill="rgba(239,68,68,0.25)" stroke="#EF4444" strokeWidth="1.5"/>
        <text x="142" y="38" textAnchor="middle" fontSize="10" fill="#EF4444" fontWeight="700">!</text>
        <circle cx="202" cy="66" r="10" fill="rgba(239,68,68,0.25)" stroke="#EF4444" strokeWidth="1.5"/>
        <text x="202" y="70" textAnchor="middle" fontSize="10" fill="#EF4444" fontWeight="700">!</text>
        {/* Labels */}
        <text x="280" y="28" fontSize="7" fill={`rgba(${rgb},0.5)`} fontFamily="monospace">HVAC-01</text>
        <text x="280" y="60" fontSize="7" fill={`rgba(${rgb},0.5)`} fontFamily="monospace">PIPE-03</text>
        <text x="280" y="92" fontSize="7" fill={`rgba(${rgb},0.5)`} fontFamily="monospace">ELEC-02</text>
        <text x="260" y="128" fontSize="8" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">2 clashes found</text>
      </svg>
    );
    case "planning": return (
      <svg {...shared}>
        <defs><linearGradient id="plan-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.12)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#plan-g)"/>
        {/* Document stack */}
        <rect x="30" y="16" width="140" height="108" rx="6" fill="rgba(255,255,255,0.03)" stroke={`rgba(${rgb},0.15)`} strokeWidth="1"/>
        <rect x="36" y="12" width="140" height="108" rx="6" fill="rgba(255,255,255,0.04)" stroke={`rgba(${rgb},0.2)`} strokeWidth="1"/>
        {/* Checklist */}
        {[30, 50, 70, 88].map((y, i) => (
          <g key={i}>
            <rect x="50" y={y} width="10" height="10" rx="2" fill={i < 3 ? `rgba(${rgb},0.2)` : "rgba(255,255,255,0.05)"} stroke={`rgba(${rgb},0.3)`} strokeWidth="1"/>
            {i < 3 && <path d={`M53 ${y+5}l2 2 4-4`} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
            <rect x="68" y={y+2} width={70 - i*10} height="5" rx="2" fill={`rgba(${rgb},${i<3?0.15:0.06})`}/>
          </g>
        ))}
        {/* Status badge */}
        <rect x="200" y="24" width="90" height="22" rx="6" fill={`rgba(${rgb},0.1)`} stroke={`rgba(${rgb},0.2)`} strokeWidth="1"/>
        <text x="245" y="39" textAnchor="middle" fontSize="8" fill={color} fontWeight="600">3/4 COMPLETE</text>
        {/* Progress arc */}
        <circle cx="245" cy="85" r="28" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4"/>
        <circle cx="245" cy="85" r="28" fill="none" stroke={color} strokeWidth="4" strokeDasharray="132" strokeDashoffset="33" strokeLinecap="round" opacity="0.6" transform="rotate(-90 245 85)"/>
        <text x="245" y="89" textAnchor="middle" fontSize="12" fill={color} fontWeight="700">75%</text>
      </svg>
    );
    case "architecture": return (
      <svg {...shared}>
        <defs><linearGradient id="arch-g" x1="0" y1={h} x2={w} y2="0" gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.12)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#arch-g)"/>
        {/* Building elevation */}
        <rect x="60" y="28" width="80" height="95" rx="2" fill="none" stroke={`rgba(${rgb},0.3)`} strokeWidth="1" strokeDasharray="3 2"/>
        <rect x="160" y="48" width="60" height="75" rx="2" fill="none" stroke={`rgba(${rgb},0.25)`} strokeWidth="1" strokeDasharray="3 2"/>
        {/* Windows */}
        {[40, 58, 76, 94].map(y => [72, 92, 112].map(x => (
          <rect key={`${x}-${y}`} x={x} y={y} width="10" height="8" rx="1" fill={`rgba(${rgb},0.12)`} stroke={`rgba(${rgb},0.2)`} strokeWidth="0.5"/>
        )))}
        {[58, 76, 94].map(y => [172, 192].map(x => (
          <rect key={`${x}-${y}`} x={x} y={y} width="10" height="8" rx="1" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.15)`} strokeWidth="0.5"/>
        )))}
        {/* Ground line */}
        <line x1="30" y1="123" x2="250" y2="123" stroke={`rgba(${rgb},0.2)`} strokeWidth="1"/>
        {/* Dimensions */}
        <line x1="60" y1="18" x2="140" y2="18" stroke={`rgba(${rgb},0.2)`} strokeWidth="0.5"/>
        <text x="100" y="15" textAnchor="middle" fontSize="7" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">24.0m</text>
        <line x1="240" y1="48" x2="240" y2="123" stroke={`rgba(${rgb},0.2)`} strokeWidth="0.5"/>
        <text x="255" y="88" fontSize="7" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">22.5m</text>
        {/* Floor labels */}
        <text x="46" y="48" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">L4</text>
        <text x="46" y="66" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">L3</text>
        <text x="46" y="84" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">L2</text>
        <text x="46" y="102" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">L1</text>
      </svg>
    );
    case "structural": return (
      <svg {...shared}>
        <defs><linearGradient id="str-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#str-g)"/>
        {/* Steel frame grid */}
        {[40, 80, 120].map(y => (
          <line key={`h${y}`} x1="30" y1={y} x2="260" y2={y} stroke={`rgba(${rgb},0.2)`} strokeWidth="2"/>
        ))}
        {[60, 120, 180, 240].map(x => (
          <line key={`v${x}`} x1={x} y1="20" x2={x} y2="130" stroke={`rgba(${rgb},0.25)`} strokeWidth="3"/>
        ))}
        {/* Connection nodes */}
        {[40, 80, 120].map(y => [60, 120, 180, 240].map(x => (
          <circle key={`n${x}-${y}`} cx={x} cy={y} r="3" fill={`rgba(${rgb},0.3)`} stroke={color} strokeWidth="0.5"/>
        )))}
        {/* BOQ table mini */}
        <rect x="268" y="20" width="44" height="50" rx="3" fill="rgba(255,255,255,0.03)" stroke={`rgba(${rgb},0.15)`} strokeWidth="0.5"/>
        <text x="275" y="32" fontSize="5" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">UC 305</text>
        <text x="275" y="42" fontSize="5" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">UB 457</text>
        <text x="275" y="52" fontSize="5" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">SHS 200</text>
        <text x="275" y="62" fontSize="5" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">PFC 150</text>
        {/* Weight label */}
        <rect x="268" y="80" width="44" height="18" rx="3" fill={`rgba(${rgb},0.1)`}/>
        <text x="290" y="93" textAnchor="middle" fontSize="7" fill={color} fontWeight="600">847t</text>
      </svg>
    );
    case "facade": return (
      <svg {...shared}>
        <defs><linearGradient id="fac-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#fac-g)"/>
        {/* Panel grid */}
        {[0,1,2,3,4,5,6].map(col => [0,1,2,3].map(row => {
          const x = 25 + col * 36, y = 12 + row * 30;
          const isHighlighted = (col === 2 && row === 1) || (col === 4 && row === 2);
          return (
            <g key={`p${col}-${row}`}>
              <rect x={x} y={y} width="30" height="24" rx="2"
                fill={isHighlighted ? `rgba(${rgb},0.15)` : "rgba(255,255,255,0.02)"}
                stroke={isHighlighted ? color : `rgba(${rgb},0.12)`}
                strokeWidth={isHighlighted ? "1.5" : "0.5"}
              />
              <text x={x+15} y={y+14} textAnchor="middle" fontSize="5" fill={`rgba(${rgb},${isHighlighted?0.6:0.2})`} fontFamily="monospace">
                {String.fromCharCode(65+col)}{row+1}
              </text>
            </g>
          );
        }))}
        {/* Schedule legend */}
        <text x="280" y="26" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">28 panels</text>
        <text x="280" y="38" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">CW system</text>
        <rect x="278" y="48" width="8" height="8" rx="1" fill={`rgba(${rgb},0.15)`} stroke={color} strokeWidth="1"/>
        <text x="290" y="55" fontSize="5" fill={`rgba(${rgb},0.4)`}>Review</text>
      </svg>
    );
    case "construction": return (
      <svg {...shared}>
        <defs><linearGradient id="con-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#con-g)"/>
        {/* Site boundary */}
        <rect x="20" y="15" width="200" height="110" rx="4" fill="none" stroke={`rgba(${rgb},0.2)`} strokeWidth="1" strokeDasharray="4 3"/>
        {/* Buildings */}
        <rect x="40" y="35" width="50" height="40" rx="2" fill={`rgba(${rgb},0.1)`} stroke={`rgba(${rgb},0.25)`} strokeWidth="1"/>
        <rect x="110" y="50" width="35" height="55" rx="2" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.2)`} strokeWidth="1"/>
        {/* Crane arc */}
        <circle cx="155" cy="45" r="55" fill="none" stroke={color} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.3"/>
        <circle cx="155" cy="45" r="35" fill="none" stroke={color} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.2"/>
        {/* Crane */}
        <line x1="155" y1="15" x2="155" y2="90" stroke={color} strokeWidth="1.5" opacity="0.4"/>
        <line x1="155" y1="25" x2="200" y2="25" stroke={color} strokeWidth="1" opacity="0.4"/>
        {/* Access routes */}
        <path d="M20 100 L40 85 L80 90 L130 80" fill="none" stroke={`rgba(${rgb},0.3)`} strokeWidth="1.5" strokeDasharray="3 2"/>
        {/* Legend */}
        <rect x="238" y="20" width="70" height="60" rx="4" fill="rgba(255,255,255,0.02)" stroke={`rgba(${rgb},0.1)`} strokeWidth="0.5"/>
        <text x="248" y="35" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Tower Crane</text>
        <text x="248" y="47" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Reach: 55m</text>
        <text x="248" y="59" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Capacity: 12t</text>
        <text x="248" y="71" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Coverage: 94%</text>
      </svg>
    );
    case "sustainability": return (
      <svg {...shared}>
        <defs><linearGradient id="sus-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#sus-g)"/>
        {/* Bar chart */}
        {[
          { x: 40, h: 70, label: "A1–A3", opacity: 0.35 },
          { x: 75, h: 45, label: "A4", opacity: 0.25 },
          { x: 110, h: 30, label: "A5", opacity: 0.2 },
          { x: 145, h: 55, label: "B1–B5", opacity: 0.3 },
          { x: 180, h: 20, label: "C1–C4", opacity: 0.15 },
          { x: 215, h: 15, label: "D", opacity: 0.12 },
        ].map(bar => (
          <g key={bar.label}>
            <rect x={bar.x} y={120-bar.h} width="25" height={bar.h} rx="3" fill={`rgba(${rgb},${bar.opacity})`} stroke={`rgba(${rgb},0.2)`} strokeWidth="0.5"/>
            <text x={bar.x+12} y="132" textAnchor="middle" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">{bar.label}</text>
          </g>
        ))}
        {/* CO2 total */}
        <text x="272" y="50" fontSize="18" fill={color} fontWeight="800" opacity="0.7" fontFamily="monospace">482</text>
        <text x="272" y="64" fontSize="7" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">kgCO₂e/m²</text>
        {/* Trend indicator */}
        <path d="M275 80 L290 72 L305 76" fill="none" stroke={color} strokeWidth="1.5" opacity="0.4"/>
        <text x="272" y="100" fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">↓ 12% vs baseline</text>
      </svg>
    );
    case "bim": return (
      <svg {...shared}>
        <defs><linearGradient id="bim-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.12)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#bim-g)"/>
        {/* 3D wireframe box */}
        <path d="M60 90 L60 40 L120 20 L180 40 L180 90 L120 110 Z" fill={`rgba(${rgb},0.05)`} stroke={`rgba(${rgb},0.25)`} strokeWidth="1"/>
        <line x1="120" y1="20" x2="120" y2="70" stroke={`rgba(${rgb},0.15)`} strokeWidth="1"/>
        <line x1="60" y1="40" x2="120" y2="70" stroke={`rgba(${rgb},0.15)`} strokeWidth="1" strokeDasharray="2 2"/>
        <line x1="180" y1="40" x2="120" y2="70" stroke={`rgba(${rgb},0.15)`} strokeWidth="1" strokeDasharray="2 2"/>
        {/* Clash indicators */}
        <circle cx="100" cy="55" r="12" fill="rgba(239,68,68,0.2)" stroke="#EF4444" strokeWidth="1"/>
        <text x="100" y="59" textAnchor="middle" fontSize="10" fill="#EF4444" fontWeight="700">✕</text>
        <circle cx="150" cy="75" r="8" fill="rgba(245,158,11,0.2)" stroke="#F59E0B" strokeWidth="1"/>
        <text x="150" y="79" textAnchor="middle" fontSize="8" fill="#F59E0B" fontWeight="700">!</text>
        {/* Stats */}
        <rect x="210" y="20" width="90" height="95" rx="6" fill="rgba(255,255,255,0.02)" stroke={`rgba(${rgb},0.1)`} strokeWidth="0.5"/>
        <text x="220" y="38" fontSize="7" fill="#EF4444" fontFamily="monospace">● 3 Critical</text>
        <text x="220" y="52" fontSize="7" fill="#F59E0B" fontFamily="monospace">● 7 Warning</text>
        <text x="220" y="66" fontSize="7" fill="#10B981" fontFamily="monospace">● 42 Passed</text>
        <line x1="218" y1="76" x2="292" y2="76" stroke={`rgba(${rgb},0.1)`} strokeWidth="0.5"/>
        <text x="220" y="90" fontSize="8" fill={color} fontWeight="600">96.2%</text>
        <text x="220" y="102" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Pass Rate</text>
      </svg>
    );
    case "design": return (
      <svg {...shared}>
        <defs><linearGradient id="des-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#des-g)"/>
        {/* Presentation slides */}
        <rect x="20" y="15" width="110" height="70" rx="4" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.2)`} strokeWidth="1"/>
        <rect x="30" y="25" width="40" height="25" rx="2" fill={`rgba(${rgb},0.12)`}/>
        <rect x="30" y="56" width="90" height="4" rx="1" fill={`rgba(${rgb},0.1)`}/>
        <rect x="30" y="64" width="60" height="4" rx="1" fill={`rgba(${rgb},0.06)`}/>
        <rect x="80" y="28" width="40" height="18" rx="2" fill={`rgba(${rgb},0.06)`}/>
        {/* Slide 2 (offset) */}
        <rect x="145" y="20" width="90" height="58" rx="4" fill={`rgba(${rgb},0.05)`} stroke={`rgba(${rgb},0.15)`} strokeWidth="1"/>
        <rect x="155" y="30" width="70" height="4" rx="1" fill={`rgba(${rgb},0.08)`}/>
        <rect x="155" y="40" width="30" height="20" rx="2" fill={`rgba(${rgb},0.1)`}/>
        <rect x="190" y="40" width="30" height="20" rx="2" fill={`rgba(${rgb},0.07)`}/>
        {/* Slide 3 */}
        <rect x="250" y="25" width="55" height="36" rx="3" fill={`rgba(${rgb},0.04)`} stroke={`rgba(${rgb},0.1)`} strokeWidth="0.5"/>
        {/* Page indicator */}
        <text x="160" y="110" textAnchor="middle" fontSize="8" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">12 slides · 3 renders · PDF ready</text>
        {/* Dots */}
        {[0,1,2,3,4].map(i => (
          <circle key={i} cx={140+i*10} cy="122" r="2.5" fill={i===0?color:`rgba(${rgb},0.15)`}/>
        ))}
      </svg>
    );
    case "specs": return (
      <svg {...shared}>
        <defs><linearGradient id="spc-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#spc-g)"/>
        {/* Document */}
        <rect x="30" y="10" width="160" height="120" rx="4" fill="rgba(255,255,255,0.02)" stroke={`rgba(${rgb},0.15)`} strokeWidth="1"/>
        {/* NBS header */}
        <rect x="38" y="18" width="50" height="12" rx="2" fill={`rgba(${rgb},0.15)`}/>
        <text x="63" y="27" textAnchor="middle" fontSize="7" fill={color} fontWeight="600">NBS</text>
        {/* Spec lines */}
        {[38, 50, 62, 74, 86, 98, 110].map((y, i) => (
          <g key={i}>
            <text x="38" y={y} fontSize="6" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">{`${30+i*5}`}</text>
            <rect x="54" y={y-5} width={80+Math.sin(i)*30} height="4" rx="1" fill={`rgba(${rgb},${0.06+i*0.01})`}/>
          </g>
        ))}
        {/* Mapping arrows */}
        <path d="M200 40 L230 30 M200 60 L230 50 M200 80 L230 70" stroke={`rgba(${rgb},0.2)`} strokeWidth="0.8" fill="none" markerEnd="url(#arrow)"/>
        {/* Mapped items */}
        <rect x="232" y="20" width="70" height="18" rx="3" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.15)`} strokeWidth="0.5"/>
        <text x="242" y="32" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Uniclass Ss_25</text>
        <rect x="232" y="44" width="70" height="18" rx="3" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.15)`} strokeWidth="0.5"/>
        <text x="242" y="56" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">Uniclass Pr_40</text>
        <rect x="232" y="68" width="70" height="18" rx="3" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.15)`} strokeWidth="0.5"/>
        <text x="242" y="80" fontSize="6" fill={`rgba(${rgb},0.4)`} fontFamily="monospace">IFC IfcWall</text>
        <text x="255" y="110" fontSize="7" fill={`rgba(${rgb},0.3)`} fontFamily="monospace">3 mapped</text>
      </svg>
    );
    case "phasing": return (
      <svg {...shared}>
        <defs><linearGradient id="pha-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#pha-g)"/>
        {/* Gantt chart */}
        {[
          { y: 20, x: 30, w: 80, label: "Excavation", opacity: 0.25 },
          { y: 40, x: 70, w: 100, label: "Substructure", opacity: 0.3 },
          { y: 60, x: 120, w: 90, label: "Superstructure", opacity: 0.2 },
          { y: 80, x: 170, w: 70, label: "Envelope", opacity: 0.15 },
          { y: 100, x: 200, w: 80, label: "Fit-out", opacity: 0.12 },
        ].map(bar => (
          <g key={bar.label}>
            <rect x={bar.x} y={bar.y} width={bar.w} height="14" rx="3" fill={`rgba(${rgb},${bar.opacity})`} stroke={`rgba(${rgb},0.15)`} strokeWidth="0.5"/>
            <text x={bar.x+4} y={bar.y+10} fontSize="6" fill={`rgba(${rgb},0.5)`} fontFamily="monospace">{bar.label}</text>
          </g>
        ))}
        {/* Timeline markers */}
        {["Wk 1", "Wk 8", "Wk 16", "Wk 24", "Wk 32"].map((label, i) => (
          <text key={i} x={30+i*60} y={130} fontSize="5" fill={`rgba(${rgb},0.2)`} fontFamily="monospace">{label}</text>
        ))}
        {/* Today marker */}
        <line x1="150" y1="12" x2="150" y2="120" stroke={color} strokeWidth="1" strokeDasharray="3 2" opacity="0.4"/>
        <text x="150" y="10" textAnchor="middle" fontSize="6" fill={color} fontWeight="600">TODAY</text>
      </svg>
    );
    case "qa": return (
      <svg {...shared}>
        <defs><linearGradient id="qa-g" x1="0" y1="0" x2={w} y2={h} gradientUnits="userSpaceOnUse"><stop stopColor={`rgba(${rgb},0.1)`}/><stop offset="1" stopColor="rgba(0,0,0,0)"/></linearGradient></defs>
        <rect width={w} height={h} fill="url(#qa-g)"/>
        {/* Design overlay */}
        <rect x="20" y="15" width="120" height="80" rx="4" fill={`rgba(${rgb},0.06)`} stroke={`rgba(${rgb},0.15)`} strokeWidth="1"/>
        <text x="80" y="10" textAnchor="middle" fontSize="7" fill={`rgba(${rgb},0.3)`} fontWeight="600">DESIGN</text>
        <rect x="30" y="28" width="40" height="30" rx="2" fill={`rgba(${rgb},0.1)`}/>
        <rect x="78" y="28" width="50" height="20" rx="2" fill={`rgba(${rgb},0.08)`}/>
        {/* As-built overlay */}
        <rect x="160" y="15" width="120" height="80" rx="4" fill="rgba(16,185,129,0.04)" stroke="rgba(16,185,129,0.15)" strokeWidth="1"/>
        <text x="220" y="10" textAnchor="middle" fontSize="7" fill="rgba(16,185,129,0.3)" fontWeight="600">AS-BUILT</text>
        <rect x="170" y="28" width="42" height="32" rx="2" fill="rgba(16,185,129,0.08)"/>
        <rect x="220" y="28" width="48" height="20" rx="2" fill="rgba(16,185,129,0.06)"/>
        {/* Comparison arrows */}
        <path d="M145 55 L155 55" stroke={`rgba(${rgb},0.3)`} strokeWidth="1.5" markerEnd="url(#arrow)"/>
        {/* Deviation markers */}
        <circle cx="190" cy="45" r="6" fill="rgba(245,158,11,0.2)" stroke="#F59E0B" strokeWidth="1"/>
        <text x="190" y="48" textAnchor="middle" fontSize="6" fill="#F59E0B">Δ</text>
        {/* Result */}
        <rect x="60" y="105" width="180" height="24" rx="6" fill={`rgba(${rgb},0.06)`} stroke={`rgba(${rgb},0.12)`} strokeWidth="0.5"/>
        <text x="80" y="120" fontSize="8" fill={color} fontWeight="600">97.3% Match</text>
        <text x="200" y="120" fontSize="7" fill="rgba(245,158,11,0.5)" fontFamily="monospace">2 deviations</text>
      </svg>
    );
    default: return (
      <svg {...shared}>
        <rect width={w} height={h} fill={`rgba(${rgb},0.05)`}/>
        <text x={w/2} y={h/2} textAnchor="middle" fontSize="12" fill={`rgba(${rgb},0.3)`}>Preview</text>
      </svg>
    );
  }
}

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

/** Generate a date string N days ago from today */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/** Show relative time like "2d ago", "1w ago" */
function relativeDate(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "1d ago";
  if (diff < 7) return `${diff}d ago`;
  if (diff < 14) return "1w ago";
  return `${Math.floor(diff / 7)}w ago`;
}

const SEED_REQUESTS: WorkflowRequest[] = [
  { id: "req-001", name: "Acoustic Performance Assessment", discipline: "Building Physics", problem: "Need automated reverberation time calculations from room geometry and material specifications for compliance with BB93 and ADE.", email: "hidden", votes: 47, createdAt: daysAgo(6) },
  { id: "req-002", name: "Fire Escape Route Compliance Check", discipline: "Fire Safety", problem: "Automated travel distance and exit width verification against Approved Document B from IFC model geometry.", email: "hidden", votes: 83, createdAt: daysAgo(7) },
  { id: "req-003", name: "Daylight Factor Analysis Pipeline", discipline: "Environmental Design", problem: "Generate daylight factor reports from IFC model with automated window-to-floor ratios and Part L compliance checks.", email: "hidden", votes: 61, createdAt: daysAgo(5) },
  { id: "req-004", name: "Embodied Carbon Calculator", discipline: "Sustainability", problem: "Calculate whole-life carbon from material schedules against RICS methodology and LETI 2030 targets.", email: "hidden", votes: 129, createdAt: daysAgo(8) },
  { id: "req-005", name: "Accessibility Audit Workflow", discipline: "Inclusive Design", problem: "Check corridor widths, door clearances, and ramp gradients against Part M and BS 8300 requirements from BIM model.", email: "hidden", votes: 35, createdAt: daysAgo(4) },
  { id: "req-006", name: "Thermal Bridging Analysis", discipline: "Building Physics", problem: "Automated Psi-value calculations at wall-floor-roof junctions from construction details, with SAP compliance output for Part L submissions.", email: "hidden", votes: 94, createdAt: daysAgo(9) },
  { id: "req-007", name: "HVAC Duct Sizing Pipeline", discipline: "MEP Engineering", problem: "Automated duct sizing from room-by-room heat load calculations with pressure drop verification and CIBSE Guide C compliance.", email: "hidden", votes: 76, createdAt: daysAgo(8) },
  { id: "req-008", name: "Structural Loading Assessment", discipline: "Structural Engineering", problem: "Calculate imposed, dead, and wind loads per floor from IFC geometry with automated load combination tables per BS EN 1990.", email: "hidden", votes: 112, createdAt: daysAgo(10) },
  { id: "req-009", name: "Rainwater Harvesting Calculator", discipline: "Sustainability", problem: "Size rainwater collection systems from roof area and local rainfall data with BREEAM Wat 01 credit calculation.", email: "hidden", votes: 38, createdAt: daysAgo(3) },
  { id: "req-010", name: "Material Schedule & BOQ Generator", discipline: "Quantity Surveying", problem: "Extract material quantities from IFC model and generate formatted BOQ with NRM2-compliant cost categories.", email: "hidden", votes: 156, createdAt: daysAgo(11) },
  { id: "req-011", name: "Parking Layout Optimizer", discipline: "Urban Planning", problem: "Generate optimal parking layouts from site boundary geometry with turning circle verification and minimum bay dimensions per local authority standards.", email: "hidden", votes: 42, createdAt: daysAgo(5) },
  { id: "req-012", name: "Wind Load Analysis Pipeline", discipline: "Structural Engineering", problem: "Automated wind pressure calculations from building geometry and location data per BS EN 1991-1-4 with zone pressure coefficients.", email: "hidden", votes: 68, createdAt: daysAgo(7) },
  { id: "req-013", name: "Lift Traffic Analysis", discipline: "Building Services", problem: "Calculate required lift numbers, speeds, and waiting times from building population data with BCO compliance verification.", email: "hidden", votes: 29, createdAt: daysAgo(2) },
  { id: "req-014", name: "Condensation Risk Assessment", discipline: "Building Physics", problem: "Automated interstitial condensation analysis at wall build-ups with dewpoint tracking and BS 5250 compliance reporting.", email: "hidden", votes: 55, createdAt: daysAgo(6) },
  { id: "req-015", name: "Flood Risk Assessment Pipeline", discipline: "Environmental", problem: "Generate flood risk reports from site coordinates with EA flood zone mapping, surface water analysis, and SuDS sizing calculations.", email: "hidden", votes: 73, createdAt: daysAgo(8) },
  { id: "req-016", name: "Noise Impact Assessment", discipline: "Acoustics", problem: "Automated noise level predictions from site layout and source data with BS 8233 and ProPG compliance assessment for planning applications.", email: "hidden", votes: 44, createdAt: daysAgo(4) },
  { id: "req-017", name: "Staircase Compliance Checker", discipline: "Building Regulations", problem: "Verify stair dimensions, handrail heights, and going/rise ratios against Approved Document K with automated markup of non-compliant elements.", email: "hidden", votes: 87, createdAt: daysAgo(9) },
  { id: "req-018", name: "Waste Management Plan Generator", discipline: "Construction", problem: "Generate site waste management plans from project BIM data with material categorization, recycling targets, and SWMP compliance documentation.", email: "hidden", votes: 31, createdAt: daysAgo(3) },
  { id: "req-019", name: "Roof Drainage & Loading Calculator", discipline: "Structures", problem: "Calculate roof drainage requirements and ponding loads from roof geometry with outlet sizing per BS EN 12056-3.", email: "hidden", votes: 52, createdAt: daysAgo(5) },
  { id: "req-020", name: "Thermal Comfort Analysis (PPD/PMV)", discipline: "Environmental Design", problem: "Predict thermal comfort indices from room geometry, glazing ratios, and HVAC setpoints with CIBSE Guide A compliance for overheating risk.", email: "hidden", votes: 66, createdAt: daysAgo(7) },
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
  const [showAllCommunity, setShowAllCommunity] = useState(false);
  const [communityTab, setCommunityTab] = useState<"built" | "vote">("built");

  // ─── Video Showcase state ───────────────────────────────────────────────────
  const SHOWCASE_R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";
  const DEMO_VIDEOS = [
    { id: "wv-01", title: "Text Prompt → Concept Building", subtitle: "From brief to 3D in 90 seconds", category: "Concept Design", duration: "1:32", url: `${SHOWCASE_R2}/text-to-concept-building.mp4`, nodes: ["Text Prompt", "Brief Analyzer", "Massing Generator"], spec: "3 Nodes · AI-Powered · ~90s", previewStart: 105 },
    { id: "wv-02", title: "2D Floor Plan → Interactive 3D Model", subtitle: "ML-powered spatial intelligence", category: "Floor Plans", duration: "2:45", url: `${SHOWCASE_R2}/floorplan-to-3d-model.mp4`, nodes: ["Image Upload", "Floor Plan Analyzer", "3D Model Builder"], spec: "3 Nodes · ML Vision · ~120s", previewStart: 110 },
    { id: "wv-03", title: "3D Model Visualization", subtitle: "Interactive architectural 3D models", category: "Visualization", duration: "1:45", url: "/videos/3d%20model.mp4", nodes: ["Building Data", "3D Engine", "Model Viewer"], spec: "3 Nodes · WebGL · ~45s", previewStart: 5 },
  ];
  interface LandingVideo { id: string; title: string; category: string; videoUrl: string; duration: string | null; views: number; likes: number; author: { name: string | null; image: string | null } }
  const [communityVideos, setCommunityVideos] = useState<LandingVideo[]>([]);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const videoSectionRef = useRef<HTMLDivElement>(null);
  const videoSectionInView = useInView(videoSectionRef, { once: false, margin: "-10%" });

  useEffect(() => {
    fetch("/api/community-videos")
      .then(r => r.json())
      .then(data => { if (data.videos?.length) setCommunityVideos(data.videos.slice(0, 5)); })
      .catch(() => {});
  }, []);

  // Autoplay videos when section is in view, starting at previewStart
  useEffect(() => {
    const refs = videoRefs.current;
    if (videoSectionInView) {
      DEMO_VIDEOS.forEach(d => {
        const v = refs[d.id];
        if (v) {
          if (v.readyState >= 1 && v.currentTime < d.previewStart) v.currentTime = d.previewStart;
          v.play().catch(() => {});
        }
      });
    } else {
      Object.values(refs).forEach(v => { if (v) v.pause(); });
    }
  }, [videoSectionInView]);

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

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm.name.trim() || !requestForm.discipline.trim() || !requestForm.problem.trim() || !requestForm.email.trim()) return;
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestForm.email)) return;

    trackLead({ content_name: "workflow_request", content_category: requestForm.discipline });

    // Persist to backend (fire-and-forget — works even if API doesn't exist yet)
    fetch("/api/workflow-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: requestForm.name.trim(),
        discipline: requestForm.discipline.trim(),
        problem: requestForm.problem.trim(),
        email: requestForm.email.trim(),
      }),
    }).catch(() => {});

    const newReq: WorkflowRequest = {
      id: `req-${Date.now()}`,
      name: requestForm.name.trim(),
      discipline: requestForm.discipline.trim(),
      problem: requestForm.problem.trim(),
      email: "hidden",
      votes: 1,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setWorkflowRequests(prev => {
      const next = [newReq, ...prev];
      try { localStorage.setItem("buildflow-workflow-requests", JSON.stringify({ requests: next, voted: [...requestVoted] })); } catch { /* ignore */ }
      return next;
    });
    // Store submitted emails separately for later backend sync
    try {
      const emails = JSON.parse(localStorage.getItem("buildflow-request-emails") || "[]");
      emails.push({ email: requestForm.email.trim(), name: requestForm.name.trim(), discipline: requestForm.discipline.trim(), ts: Date.now() });
      localStorage.setItem("buildflow-request-emails", JSON.stringify(emails));
    } catch { /* ignore */ }
    setRequestForm({ name: '', discipline: '', problem: '', email: '' });
    setRequestSubmitted(true);
    setTimeout(() => setRequestSubmitted(false), 4000);
  };

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
          <Link href="/" className="landing-logo-link" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", marginRight: "auto" }}>
            <div className="landing-logo-icon" style={{
              width: 40, height: 40, borderRadius: 12, overflow: "hidden",
              boxShadow: "0 2px 12px rgba(79,138,255,0.2)",
              flexShrink: 0,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span className="landing-logo-text" style={{ fontSize: 18, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.3px" }}>
              Build<span style={{ color: "#4F8AFF" }}>Flow</span>
              <span className="landing-beta-badge" style={{ fontSize: 9, fontWeight: 600, color: "#F59E0B", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", padding: "1px 5px", borderRadius: 6, marginLeft: 6 }}>{t('dashboard.beta')}</span>
            </span>
          </Link>

          <div className="landing-nav-links" style={{ display: "flex", alignItems: "center", gap: 32, marginRight: 32 }}>
            {[
              { label: t('landing.workflows'), href: '#workflows' },
              { label: t('landing.community'), href: '#community' },
              { label: t('landing.request'), href: '#request-workflow' },
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
            <Link href="/workflows" className="landing-demos-link" style={{
              fontSize: 13, fontWeight: 700, textDecoration: "none",
              color: "#00F5FF",
              padding: "5px 14px", borderRadius: 8,
              background: "rgba(0,245,255,0.06)",
              border: "1px solid rgba(0,245,255,0.15)",
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.2s",
              letterSpacing: "0.3px",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#00F5FF",
                boxShadow: "0 0 8px #00F5FF",
                animation: "glow-pulse 2s infinite",
              }} />
              {t('landing.watchDemos')}
            </Link>
            <LanguageSwitcher />
            <Link href="/login" className="landing-login-link" style={{
              fontSize: 14, fontWeight: 600, color: "#F0F0F5",
              textDecoration: "none", padding: "8px 0",
            }}>
              {t('landing.login')}
            </Link>
            <Link href="/dashboard" className="landing-signup-link" style={{
              padding: "9px 22px", borderRadius: 10, fontSize: 14, fontWeight: 600,
              color: "white", background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              textDecoration: "none", whiteSpace: "nowrap",
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
          <FloatingCard label={t('landing.pdfUpload')} category="input" delay={0.6} style={{ right: 80, top: 140, transform: "rotate(3deg)" }} />
          <FloatingCard label={t('landing.massingGen')} category="generate" delay={0.9} style={{ right: 120, bottom: 200, transform: "rotate(-2deg)" }} />
          <FloatingCard label={t('landing.imageRender')} category="generate" delay={1.2} style={{ left: 140, bottom: 160, transform: "rotate(1deg)" }} />

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
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#3B82F6' }}>{t('landing.floorPlanPanel')}</span>
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
                <text x="55" y="42" fill="rgba(59,130,246,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">{t('landing.living')}</text>
                <text x="55" y="52" fill="rgba(59,130,246,0.4)" fontSize="7" fontFamily="monospace" textAnchor="middle">35 m²</text>
                <text x="55" y="98" fill="rgba(59,130,246,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">{t('landing.bed')}</text>
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
              <Link href="/dashboard" className="landing-hero-cta" style={{
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
                border: "1px solid rgba(0,245,255,0.2)", background: "rgba(0,245,255,0.05)",
                color: "#00F5FF", fontSize: 14, fontWeight: 600,
                textDecoration: "none", transition: "all 0.25s",
              }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "rgba(0,245,255,0.12)";
                  el.style.borderColor = "rgba(0,245,255,0.35)";
                  el.style.boxShadow = "0 0 24px rgba(0,245,255,0.12)";
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "rgba(0,245,255,0.05)";
                  el.style.borderColor = "rgba(0,245,255,0.2)";
                  el.style.boxShadow = "none";
                }}
              >
                <Play size={15} />
                {t('landing.tryDemo')}
              </Link>

              <Link href="/book-demo" style={{
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
                href="#community"
                onClick={e => { e.preventDefault(); document.getElementById("community")?.scrollIntoView({ behavior: "smooth" }); }}
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
            onClick={() => document.getElementById("community")?.scrollIntoView({ behavior: "smooth" })}
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
            {PARTNER_LOGO_KEYS.map(key => (
              <span key={key} style={{
                fontSize: 14, fontWeight: 700, color: "#3A3A50",
                letterSpacing: "2px", textTransform: "uppercase",
                transition: "color 0.2s", cursor: "default",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#3A3A50"; }}
              >
                {t(key as TranslationKey)}
              </span>
            ))}
          </motion.div>
        </motion.section>

        {/* ── Coming Soon — Workflow Pipeline ─────────────────────── */}
        <PipelineSection />

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

        {/* CTA banner removed — merged into unified community section below */}

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

        {/* ── Unified Community Hub — Built + Vote ─────────────────── */}
        <section id="community" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #0A0A16 50%, #07070D 100%)",
        }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.2 }} />
            <div className="orb-drift-2" style={{ position: "absolute", top: "10%", left: "10%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <div className="orb-drift-3" style={{ position: "absolute", bottom: "10%", right: "8%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,138,255,0.06) 0%, transparent 70%)", filter: "blur(20px)" }} />
            <div className="orb-drift-1" style={{ position: "absolute", top: "60%", right: "12%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)", filter: "blur(20px)" }} />
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            {/* Section Header */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 48 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(16,185,129,0.5)" }}>
                COMMUNITY HUB
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #10B981, #F59E0B)" }} />
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1 }}>
                Built by the{" "}
                <span style={{ background: "linear-gradient(135deg, #10B981, #06B6D4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Community</span>
                {", "}Shaped by{" "}
                <span style={{ background: "linear-gradient(135deg, #F59E0B, #B87333)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Your Votes</span>
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96", maxWidth: 580, margin: "16px auto 0", lineHeight: 1.7 }}>
                Explore proven workflows from AEC professionals, or vote on what we build next. This is your platform.
              </p>
            </motion.div>

            {/* Unified Stats Bar */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
              style={{
                marginBottom: 40, display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap",
                padding: "18px 24px", borderRadius: 14,
                background: "rgba(18,18,30,0.6)", border: "1px solid rgba(255,255,255,0.06)",
              }}
              className="landing-community-stats"
            >
              {[
                { label: "Active Builders", value: 2840, suffix: "+", color: "#10B981" },
                { label: "Workflows Shared", value: 720, suffix: "+", color: "#06B6D4" },
                { label: "Total Executions", value: 128, suffix: "K+", color: "#F59E0B" },
                { label: t('landing.roadmap.totalVotes'), value: totalVotes, suffix: "", color: "#F59E0B" },
                { label: t('landing.roadmap.itemsApproved'), value: ROADMAP_ITEMS.filter(i => i.status === "approved" || i.status === "in-progress").length, suffix: "", color: "#10B981" },
              ].map(stat => (
                <div key={stat.label} style={{ textAlign: "center", minWidth: 80 }}>
                  <AnimatedNumber value={stat.value} suffix={stat.suffix} color={stat.color} />
                  <div style={{ fontSize: 9, color: "#5C5C78", textTransform: "uppercase", letterSpacing: "0.15em", marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </motion.div>

            {/* Tab Switcher */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={fadeUp} transition={{ duration: 0.4, ease: smoothEase }}
              style={{ display: "flex", justifyContent: "center", marginBottom: 40 }}
            >
              <div className="landing-community-tabs" style={{
                display: "inline-flex", gap: 4, padding: 4, borderRadius: 14,
                background: "rgba(18,18,30,0.8)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                {([
                  { key: "built" as const, label: "What Others Built", icon: <Building2 size={14} />, color: "#10B981" },
                  { key: "vote" as const, label: "Vote on What\u2019s Next", icon: <ClipboardList size={14} />, color: "#F59E0B" },
                ]).map(tab => {
                  const isActive = communityTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setCommunityTab(tab.key)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 24px", borderRadius: 10, cursor: "pointer",
                        fontSize: 13, fontWeight: 600, letterSpacing: "0.3px",
                        border: "none",
                        background: isActive
                          ? `linear-gradient(135deg, rgba(${tab.color === "#10B981" ? "16,185,129" : "245,158,11"}, 0.15), rgba(${tab.color === "#10B981" ? "16,185,129" : "245,158,11"}, 0.05))`
                          : "transparent",
                        color: isActive ? tab.color : "#5C5C78",
                        transition: "all 0.3s",
                        position: "relative" as const,
                      }}
                      onMouseEnter={e => {
                        if (!isActive) {
                          e.currentTarget.style.color = "#9898B0";
                          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isActive) {
                          e.currentTarget.style.color = "#5C5C78";
                          e.currentTarget.style.background = "transparent";
                        }
                      }}
                    >
                      {tab.icon}
                      {tab.label}
                      {isActive && (
                        <motion.div
                          layoutId="community-tab-indicator"
                          style={{
                            position: "absolute", bottom: 0, left: "20%", right: "20%",
                            height: 2, borderRadius: 1,
                            background: tab.color,
                            boxShadow: `0 0 8px ${tab.color}`,
                          }}
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* ── Tab Content: What Others Built ── */}
            <AnimatePresence mode="wait">
              {communityTab === "built" && (
                <motion.div
                  key="built-tab"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35, ease: smoothEase }}
                >
                  <div
                    className="landing-social-proof-grid"
                    style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}
                  >
                    {(showAllCommunity ? COMMUNITY_WORKFLOWS : COMMUNITY_WORKFLOWS.slice(0, 6)).map((wf, i) => {
                      const rgb = hexToRgb(wf.color);
                      return (
                        <motion.div key={wf.name}
                          initial={{ opacity: 0, y: 24 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true, margin: "-40px" }}
                          transition={{ duration: 0.5, delay: (i % 6) * 0.08, ease: smoothEase }}
                          style={{
                            borderRadius: 16, overflow: "hidden", cursor: "pointer",
                            background: "rgba(14,14,24,0.85)",
                            border: `1px solid rgba(${rgb}, 0.12)`,
                            transition: "all 0.4s cubic-bezier(0.25,0.4,0.25,1)",
                            position: "relative" as const,
                          }}
                          whileHover={{
                            y: -6,
                            boxShadow: `0 20px 60px rgba(${rgb}, 0.15), 0 0 0 1px rgba(${rgb}, 0.25)`,
                          }}
                        >
                          {/* ── Preview Area ── */}
                          <div style={{
                            position: "relative", overflow: "hidden", height: 140,
                            background: `radial-gradient(ellipse at 30% 20%, rgba(${rgb}, 0.08), transparent 60%), linear-gradient(180deg, rgba(${rgb}, 0.04), rgba(0,0,0,0.3))`,
                            borderBottom: `1px solid rgba(${rgb}, 0.1)`,
                          }}>
                            {/* SVG Visualization */}
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <WorkflowPreviewSVG type={wf.preview} color={wf.color} rgb={rgb} />
                            </div>
                            {/* Discipline badge (top left) */}
                            <div style={{
                              position: "absolute", top: 10, left: 10,
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "4px 10px", borderRadius: 8,
                              background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
                              border: `1px solid rgba(${rgb}, 0.2)`,
                            }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: wf.color, boxShadow: `0 0 6px ${wf.color}` }} />
                              <span style={{ fontSize: 9, fontWeight: 700, color: wf.color, letterSpacing: "0.08em", textTransform: "uppercase" }}>{wf.discipline}</span>
                            </div>
                            {/* Phase badge (top right) */}
                            <div style={{
                              position: "absolute", top: 10, right: 10,
                              padding: "4px 8px", borderRadius: 6,
                              background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
                            }}>
                              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.06em" }}>{wf.phase}</span>
                            </div>
                            {/* Active indicator (bottom right) */}
                            {wf.lastRun === 0 && (
                              <div style={{
                                position: "absolute", bottom: 10, right: 10,
                                display: "flex", alignItems: "center", gap: 4,
                                padding: "3px 8px", borderRadius: 6,
                                background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.25)",
                              }}>
                                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 6px #10B981" }} />
                                <span style={{ fontSize: 8, fontWeight: 600, color: "#10B981" }}>Live</span>
                              </div>
                            )}
                            {/* Gradient overlay at bottom */}
                            <div style={{
                              position: "absolute", bottom: 0, left: 0, right: 0, height: 40,
                              background: "linear-gradient(transparent, rgba(14,14,24,0.9))",
                            }} />
                          </div>

                          {/* ── Card Content ── */}
                          <div style={{ padding: "16px 18px 14px" }}>
                            <h4 style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F5", margin: "0 0 12px", lineHeight: 1.35, letterSpacing: "-0.01em" }}>{wf.name}</h4>

                            {/* Builder row */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: 8,
                                background: `linear-gradient(135deg, rgba(${rgb}, 0.2), rgba(${rgb}, 0.06))`,
                                border: `1px solid rgba(${rgb}, 0.18)`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: wf.color, flexShrink: 0,
                              }}>
                                <Building2 size={12} />
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: "#E0E0EC" }}>{wf.builder}</div>
                                <div style={{ fontSize: 9, color: "#5C5C78", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{wf.role} · {wf.firm}</div>
                              </div>
                            </div>

                            {/* Stats bar */}
                            <div style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "8px 10px", borderRadius: 8,
                              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                  <Star size={10} style={{ color: wf.color }} />
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#F0F0F5", fontFamily: "monospace" }}>{wf.uses.toLocaleString()}</span>
                                  <span style={{ fontSize: 8, color: "#5C5C78" }}>runs</span>
                                </div>
                                <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.06)" }} />
                                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                  <Copy size={9} style={{ color: "#5C5C78" }} />
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "#9898B0", fontFamily: "monospace" }}>{wf.duplicated}</span>
                                  <span style={{ fontSize: 8, color: "#5C5C78" }}>cloned</span>
                                </div>
                              </div>
                              {wf.lastRun > 0 && (
                                <span style={{ fontSize: 8, color: "#5C5C78", fontFamily: "monospace" }}>{wf.lastRun}d ago</span>
                              )}
                            </div>

                            {/* Usage bar */}
                            <div style={{ marginTop: 8, height: 2, borderRadius: 2, background: "rgba(255,255,255,0.03)", overflow: "hidden" }}>
                              <motion.div
                                initial={{ width: 0 }}
                                whileInView={{ width: `${Math.min((wf.uses / 700) * 100, 100)}%` }}
                                viewport={{ once: true }}
                                transition={{ duration: 1.2, ease: smoothEase, delay: 0.3 + i * 0.1 }}
                                style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${wf.color}, rgba(${rgb}, 0.2))` }}
                              />
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Show More / Show Less toggle */}
                  <div style={{ textAlign: "center", marginTop: 32 }}>
                    <button
                      onClick={() => setShowAllCommunity(prev => !prev)}
                      style={{
                        padding: "12px 28px", borderRadius: 12, cursor: "pointer",
                        fontSize: 13, fontWeight: 600, letterSpacing: "0.5px",
                        background: "rgba(16,185,129,0.08)",
                        border: "1px solid rgba(16,185,129,0.2)",
                        color: "#10B981",
                        display: "inline-flex", alignItems: "center", gap: 8,
                        transition: "all 0.3s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "rgba(16,185,129,0.15)";
                        e.currentTarget.style.borderColor = "rgba(16,185,129,0.35)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "rgba(16,185,129,0.08)";
                        e.currentTarget.style.borderColor = "rgba(16,185,129,0.2)";
                      }}
                    >
                      {showAllCommunity ? (
                        <>Show Less <ChevronUp size={14} /></>
                      ) : (
                        <>View All {COMMUNITY_WORKFLOWS.length} Workflows <ChevronDown size={14} /></>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Tab Content: Vote on What's Next ── */}
              {communityTab === "vote" && (
                <motion.div
                  key="vote-tab"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35, ease: smoothEase }}
                >
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
                  <div style={{ textAlign: "center" }}>
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
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Video Showcase — Screening Room ──────────────────────── */}
        <section id="videos" className="landing-section" style={{
          padding: "120px 48px", position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg, #07070D 0%, #090912 50%, #07070D 100%)",
        }}>
          {/* Background */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="blueprint-grid" style={{ opacity: 0.12 }} />
            {/* Film reel sprocket holes — top */}
            <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 40, opacity: 0.06 }} viewBox="0 0 1440 40" preserveAspectRatio="none">
              {Array.from({ length: 36 }).map((_, i) => (
                <rect key={i} x={i * 40 + 12} y="12" width="16" height="16" rx="3" fill="none" stroke="#00F5FF" strokeWidth="1" />
              ))}
            </svg>
            {/* Film reel sprocket holes — bottom */}
            <svg style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 40, opacity: 0.06 }} viewBox="0 0 1440 40" preserveAspectRatio="none">
              {Array.from({ length: 36 }).map((_, i) => (
                <rect key={i} x={i * 40 + 12} y="12" width="16" height="16" rx="3" fill="none" stroke="#00F5FF" strokeWidth="1" />
              ))}
            </svg>
            {/* Projection cone */}
            <svg style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 800, height: 400, opacity: 0.04 }} viewBox="0 0 800 400" fill="none">
              <path d="M400 0 L100 400 L700 400 Z" fill="url(#proj-grad)" />
              <defs>
                <linearGradient id="proj-grad" x1="400" y1="0" x2="400" y2="400" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00F5FF" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
            <div className="orb-drift-1" style={{ position: "absolute", top: "5%", left: "5%", width: 450, height: 450, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,245,255,0.07) 0%, transparent 70%)", filter: "blur(30px)" }} />
            <div className="orb-drift-2" style={{ position: "absolute", bottom: "5%", right: "8%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)", filter: "blur(25px)" }} />
            <svg style={{ position: "absolute", top: 80, right: 40, opacity: 0.06 }} width="80" height="300" viewBox="0 0 80 300" fill="none">
              <line x1="40" y1="0" x2="40" y2="300" stroke="#00F5FF" strokeWidth="0.5" strokeDasharray="4 4" />
              <line x1="36" y1="0" x2="44" y2="0" stroke="#00F5FF" strokeWidth="0.5" />
              <line x1="36" y1="300" x2="44" y2="300" stroke="#00F5FF" strokeWidth="0.5" />
              <text x="50" y="155" fill="#00F5FF" fontSize="7" fontFamily="monospace" transform="rotate(-90, 50, 155)">SCREENING ROOM</text>
            </svg>
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
            {/* Section Header */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp} transition={{ duration: 0.6, ease: smoothEase }}
              style={{ textAlign: "center", marginBottom: 56 }}
            >
              <span className="blueprint-annotation" style={{ marginBottom: 16, display: "block", color: "rgba(0,245,255,0.5)" }}>
                SCREENING ROOM
              </span>
              <div className="accent-line" style={{ background: "linear-gradient(90deg, #00F5FF, #8B5CF6)" }} />
              <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 900, color: "#F0F0F5", letterSpacing: "-0.04em", lineHeight: 1.1 }}>
                Watch Workflows{" "}
                <span style={{ background: "linear-gradient(135deg, #00F5FF, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  Come to Life
                </span>
              </h2>
              <p style={{ fontSize: 16, color: "#7C7C96", maxWidth: 560, margin: "16px auto 0", lineHeight: 1.7 }}>
                Platform demos and community builds — see real AEC pipelines in action, then share yours.
              </p>
            </motion.div>

            {/* Bento Video Grid */}
            <motion.div
              ref={videoSectionRef}
              initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
              variants={stagger}
              className="landing-video-bento"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gridTemplateRows: "1fr 1fr",
                gap: 16,
                height: 520,
              }}
            >
              {/* ── Featured: Text Prompt → Concept Building (wv-01) ── */}
              {(() => {
                const d = DEMO_VIDEOS[0];
                const color = "#4F8AFF";
                const r = hexToRgb(color);
                return (
                  <motion.div
                    key={d.id}
                    variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}
                    onClick={() => window.open("/workflows", "_self")}
                    style={{
                      gridColumn: "1 / 3", gridRow: "1 / 3",
                      borderRadius: 20, overflow: "hidden", cursor: "pointer",
                      position: "relative",
                      background: `linear-gradient(145deg, rgba(${r}, 0.04), rgba(14,14,24,0.95))`,
                      border: `1px solid rgba(${r}, 0.12)`,
                      transition: "all 0.5s cubic-bezier(0.25,0.4,0.25,1)",
                    }}
                  >
                    <video
                      ref={el => { videoRefs.current[d.id] = el; }}
                      src={d.url} muted playsInline
                      onLoadedMetadata={e => { const v = e.currentTarget; v.currentTime = d.previewStart; }}
                      onEnded={e => { const v = e.currentTarget; v.currentTime = d.previewStart; v.play().catch(() => {}); }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    {/* Scan line */}
                    <motion.div animate={{ y: ["-100%", "200%"] }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: "30%", pointerEvents: "none", background: "linear-gradient(180deg, transparent, rgba(0,245,255,0.03), transparent)" }} />
                    {/* Corner marks */}
                    <svg style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} width={20} height={20}><path d="M0 20 L0 0 L20 0" stroke={color} strokeWidth="1.5" fill="none" opacity={0.3} /></svg>
                    <svg style={{ position: "absolute", top: 0, right: 0, pointerEvents: "none" }} width={20} height={20}><path d="M0 0 L20 0 L20 20" stroke={color} strokeWidth="1.5" fill="none" opacity={0.3} /></svg>
                    <svg style={{ position: "absolute", bottom: 0, left: 0, pointerEvents: "none" }} width={20} height={20}><path d="M0 0 L0 20 L20 20" stroke={color} strokeWidth="1.5" fill="none" opacity={0.3} /></svg>
                    <svg style={{ position: "absolute", bottom: 0, right: 0, pointerEvents: "none" }} width={20} height={20}><path d="M20 0 L20 20 L0 20" stroke={color} strokeWidth="1.5" fill="none" opacity={0.3} /></svg>
                    {/* Badges */}
                    <div style={{ position: "absolute", top: 16, left: 16, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ padding: "4px 10px", borderRadius: 8, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)", border: `1px solid rgba(${r}, 0.3)`, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981", animation: "pulse 2s ease infinite" }} />
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#10B981", letterSpacing: "0.1em" }}>FEATURED</span>
                      </div>
                      <div style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", border: `1px solid rgba(${r}, 0.2)` }}>
                        <span style={{ fontSize: 8, fontWeight: 600, color, letterSpacing: "0.06em", textTransform: "uppercase" }}>{d.category}</span>
                      </div>
                    </div>
                    {/* Duration */}
                    <div style={{ position: "absolute", top: 16, right: 16, padding: "4px 8px", borderRadius: 6, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 4 }}>
                      <Film size={10} color="#8898AA" />
                      <span style={{ fontSize: 10, color: "#8898AA", fontFamily: "monospace" }}>{d.duration}</span>
                    </div>
                    {/* Bottom info */}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "60px 24px 20px", background: "linear-gradient(transparent, rgba(7,7,13,0.95))" }}>
                      <h3 style={{ fontSize: 20, fontWeight: 800, color: "#F0F0F5", marginBottom: 4, letterSpacing: "-0.02em" }}>{d.title}</h3>
                      <p style={{ fontSize: 13, color: "#00F5FF", fontWeight: 600, marginBottom: 8 }}>{d.subtitle}</p>
                      {/* Pipeline nodes */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {d.nodes.map((n, ni) => (
                          <React.Fragment key={n}>
                            <span style={{ fontSize: 9, fontWeight: 600, color: "#9898B0", padding: "3px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace", letterSpacing: "0.04em", textTransform: "uppercase" }}>{n}</span>
                            {ni < d.nodes.length - 1 && <span style={{ fontSize: 10, color: "#3A3A50" }}>→</span>}
                          </React.Fragment>
                        ))}
                        <span style={{ fontSize: 9, color: "#5C5C78", marginLeft: 8, fontFamily: "monospace" }}>{d.spec}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })()}

              {/* ── Side top: 2D Floor Plan → Interactive 3D Model (wv-02) ── */}
              {(() => {
                const d = DEMO_VIDEOS[1];
                const color = "#06B6D4";
                const r = hexToRgb(color);
                return (
                  <motion.div
                    key={d.id}
                    variants={fadeUp} transition={{ duration: 0.5, delay: 0.1, ease: smoothEase }}
                    onClick={() => window.open("/workflows", "_self")}
                    style={{ gridColumn: "3", gridRow: "1", borderRadius: 16, overflow: "hidden", cursor: "pointer", position: "relative", background: `linear-gradient(145deg, rgba(${r}, 0.04), rgba(14,14,24,0.95))`, border: `1px solid rgba(${r}, 0.1)`, transition: "all 0.4s cubic-bezier(0.25,0.4,0.25,1)" }}
                  >
                    <video
                      ref={el => { videoRefs.current[d.id] = el; }}
                      src={d.url} muted playsInline
                      onLoadedMetadata={e => { const v = e.currentTarget; v.currentTime = d.previewStart; }}
                      onEnded={e => { const v = e.currentTarget; v.currentTime = d.previewStart; v.play().catch(() => {}); }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <motion.div animate={{ y: ["-100%", "200%"] }} transition={{ duration: 3, repeat: Infinity, ease: "linear", delay: 0.5 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: "40%", pointerEvents: "none", background: "linear-gradient(180deg, transparent, rgba(0,245,255,0.04), transparent)" }} />
                    {/* Corner marks */}
                    <svg style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} width={14} height={14}><path d="M0 14 L0 0 L14 0" stroke={color} strokeWidth="1" fill="none" opacity={0.25} /></svg>
                    <svg style={{ position: "absolute", bottom: 0, right: 0, pointerEvents: "none" }} width={14} height={14}><path d="M14 0 L14 14 L0 14" stroke={color} strokeWidth="1" fill="none" opacity={0.25} /></svg>
                    {/* Category badge */}
                    <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ padding: "3px 7px", borderRadius: 5, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", border: `1px solid rgba(${r}, 0.25)`, display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
                        <span style={{ fontSize: 7, fontWeight: 700, color, letterSpacing: "0.1em" }}>{d.category.toUpperCase()}</span>
                      </div>
                    </div>
                    {/* Duration */}
                    <div style={{ position: "absolute", top: 10, right: 10, padding: "3px 7px", borderRadius: 5, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Film size={9} color="#8898AA" />
                      <span style={{ fontSize: 9, color: "#8898AA", fontFamily: "monospace" }}>{d.duration}</span>
                    </div>
                    {/* Bottom info */}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "32px 14px 12px", background: "linear-gradient(transparent, rgba(7,7,13,0.95))" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#F0F0F5", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</p>
                      <p style={{ fontSize: 10, color, fontWeight: 600 }}>{d.subtitle}</p>
                    </div>
                  </motion.div>
                );
              })()}

              {/* ── Side bottom: 3D Model Visualization (wv-03) ── */}
              {(() => {
                const d = DEMO_VIDEOS[2];
                const color = "#8B5CF6";
                const r = hexToRgb(color);
                return (
                  <motion.div
                    key={d.id}
                    variants={fadeUp} transition={{ duration: 0.5, delay: 0.2, ease: smoothEase }}
                    onClick={() => window.open("/workflows", "_self")}
                    style={{ gridColumn: "3", gridRow: "2", borderRadius: 16, overflow: "hidden", cursor: "pointer", position: "relative", background: `linear-gradient(145deg, rgba(${r}, 0.04), rgba(14,14,24,0.95))`, border: `1px solid rgba(${r}, 0.1)`, transition: "all 0.4s cubic-bezier(0.25,0.4,0.25,1)" }}
                  >
                    <video
                      ref={el => { videoRefs.current[d.id] = el; }}
                      src={d.url} muted playsInline
                      onLoadedMetadata={e => { const v = e.currentTarget; v.currentTime = d.previewStart; }}
                      onEnded={e => { const v = e.currentTarget; v.currentTime = d.previewStart; v.play().catch(() => {}); }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <motion.div animate={{ y: ["-100%", "200%"] }} transition={{ duration: 3, repeat: Infinity, ease: "linear", delay: 1 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: "40%", pointerEvents: "none", background: "linear-gradient(180deg, transparent, rgba(0,245,255,0.04), transparent)" }} />
                    <svg style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} width={14} height={14}><path d="M0 14 L0 0 L14 0" stroke={color} strokeWidth="1" fill="none" opacity={0.25} /></svg>
                    <svg style={{ position: "absolute", bottom: 0, right: 0, pointerEvents: "none" }} width={14} height={14}><path d="M14 0 L14 14 L0 14" stroke={color} strokeWidth="1" fill="none" opacity={0.25} /></svg>
                    {/* Category badge */}
                    <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ padding: "3px 7px", borderRadius: 5, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", border: `1px solid rgba(${r}, 0.25)`, display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
                        <span style={{ fontSize: 7, fontWeight: 700, color, letterSpacing: "0.1em" }}>{d.category.toUpperCase()}</span>
                      </div>
                    </div>
                    {/* Duration */}
                    <div style={{ position: "absolute", top: 10, right: 10, padding: "3px 7px", borderRadius: 5, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Film size={9} color="#8898AA" />
                      <span style={{ fontSize: 9, color: "#8898AA", fontFamily: "monospace" }}>{d.duration}</span>
                    </div>
                    {/* Bottom info */}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "32px 14px 12px", background: "linear-gradient(transparent, rgba(7,7,13,0.95))" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#F0F0F5", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</p>
                      <p style={{ fontSize: 10, color, fontWeight: 600 }}>{d.subtitle}</p>
                    </div>
                  </motion.div>
                );
              })()}
            </motion.div>

            {/* Bottom strip: stats + CTAs */}
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={fadeUp} transition={{ duration: 0.5, delay: 0.3, ease: smoothEase }}
              className="landing-video-bottom"
              style={{
                marginTop: 20,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "20px 28px",
                borderRadius: 16,
                background: "rgba(14,14,24,0.7)",
                border: "1px solid rgba(0,245,255,0.08)",
                backdropFilter: "blur(12px)",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              {/* Stats */}
              <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
                {[
                  { icon: <Film size={14} />, label: "Platform Demos", value: "7", color: "#00F5FF" },
                  { icon: <Users size={14} />, label: "Community Videos", value: communityVideos.length > 0 ? communityVideos.length + "+" : "New", color: "#8B5CF6" },
                  { icon: <Eye size={14} />, label: "Total Views", value: communityVideos.length > 0 ? communityVideos.reduce((s, v) => s + v.views, 0).toLocaleString() : "—", color: "#F59E0B" },
                ].map(stat => (
                  <div key={stat.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ color: stat.color, opacity: 0.7 }}>{stat.icon}</div>
                    <span style={{ fontSize: 18, fontWeight: 800, color: stat.color, fontFamily: "monospace", letterSpacing: "-0.02em" }}>{stat.value}</span>
                    <span style={{ fontSize: 10, color: "#5C5C78", textTransform: "uppercase", letterSpacing: "0.08em" }}>{stat.label}</span>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link
                  href="/workflows"
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "10px 20px", borderRadius: 10,
                    background: "linear-gradient(135deg, rgba(0,245,255,0.1), rgba(139,92,246,0.08))",
                    border: "1px solid rgba(0,245,255,0.2)",
                    color: "#00F5FF", fontSize: 13, fontWeight: 700,
                    textDecoration: "none", transition: "all 0.2s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={e => { const el = e.currentTarget; el.style.background = "linear-gradient(135deg, rgba(0,245,255,0.18), rgba(139,92,246,0.14))"; el.style.boxShadow = "0 0 24px rgba(0,245,255,0.12)"; }}
                  onMouseLeave={e => { const el = e.currentTarget; el.style.background = "linear-gradient(135deg, rgba(0,245,255,0.1), rgba(139,92,246,0.08))"; el.style.boxShadow = "none"; }}
                >
                  Watch All Demos <ArrowRight size={14} />
                </Link>
                <Link
                  href="/workflows"
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "10px 20px", borderRadius: 10,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#9898B0", fontSize: 13, fontWeight: 600,
                    textDecoration: "none", transition: "all 0.2s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={e => { const el = e.currentTarget; el.style.color = "#F0F0F5"; el.style.borderColor = "rgba(255,255,255,0.15)"; }}
                  onMouseLeave={e => { const el = e.currentTarget; el.style.color = "#9898B0"; el.style.borderColor = "rgba(255,255,255,0.08)"; }}
                >
                  <Upload size={13} />
                  Share Your Build
                </Link>
              </div>
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

                  <div style={{ padding: "8px 0", maxHeight: 560, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(245,158,11,0.2) transparent" }}>
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
                                <span style={{ fontSize: 10, color: "#3A3A50", fontFamily: "monospace" }}>{relativeDate(req.createdAt)}</span>
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
            {t('landing.copyrightFull').replace('{year}', String(new Date().getFullYear()))}
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
          /* ── Video Bento ── */
          .landing-video-bento {
            grid-template-columns: 1fr 1fr !important;
            grid-template-rows: auto auto !important;
            height: auto !important;
          }
          .landing-video-bento > *:first-child {
            grid-column: 1 / -1 !important;
            grid-row: 1 !important;
            min-height: 320px !important;
          }
          .landing-video-bento > *:nth-child(2),
          .landing-video-bento > *:nth-child(3) {
            grid-column: auto !important;
            grid-row: auto !important;
            min-height: 220px !important;
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
          .landing-nav-cta {
            gap: 6px !important;
          }
          .landing-demos-link {
            font-size: 11px !important;
            padding: 4px 10px !important;
            white-space: nowrap !important;
          }
          .landing-signup-link {
            font-size: 12px !important;
            padding: 7px 14px !important;
          }
          .landing-beta-badge {
            display: none !important;
          }
          .lang-switcher {
            padding: 5px 8px !important;
            gap: 4px !important;
          }
          .lang-switcher span:last-child {
            display: none !important;
          }

          /* ── Hero ── */
          .landing-hero-cta {
            height: 50px !important;
            padding: 0 28px !important;
            font-size: 15px !important;
          }
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
          .landing-built-for span {
            font-size: 10px !important;
            letter-spacing: 1px !important;
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
          .landing-community-tabs {
            flex-wrap: wrap !important;
            justify-content: center !important;
          }
          .landing-community-stats {
            gap: 16px !important;
            padding: 16px !important;
          }

          /* ── Video Bento ── */
          .landing-video-bento {
            grid-template-columns: 1fr !important;
            grid-template-rows: auto !important;
            height: auto !important;
          }
          .landing-video-bento > *:first-child {
            grid-column: 1 !important;
            grid-row: auto !important;
            min-height: 240px !important;
          }
          .landing-video-bento > *:nth-child(2),
          .landing-video-bento > *:nth-child(3) {
            grid-column: 1 !important;
            grid-row: auto !important;
            min-height: 200px !important;
          }
          .landing-video-bottom {
            flex-direction: column !important;
            align-items: stretch !important;
            text-align: center !important;
          }
          .landing-video-bottom > div:first-child {
            justify-content: center !important;
          }
          .landing-video-bottom > div:last-child {
            justify-content: center !important;
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
          /* ── Navbar ── */
          .landing-logo-text {
            display: none !important;
          }
          .landing-demos-link {
            font-size: 10px !important;
            padding: 4px 8px !important;
          }
          .landing-signup-link {
            font-size: 11px !important;
            padding: 6px 12px !important;
          }

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
          /* ── Navbar ── */
          .landing-demos-link {
            display: none !important;
          }
          .landing-signup-link {
            font-size: 11px !important;
            padding: 6px 10px !important;
          }

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
