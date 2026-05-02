"use client";

import React, { useState, useMemo, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { ChevronDown, Building2, Ruler, Compass, HardHat, Layers, PenTool, Triangle, Lock, ArrowRight, MessageSquare, Sparkles, Zap } from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/features/workflows/constants/prebuilt-workflows";
import { useWorkflowStore, selectLoadFromTemplate } from "@/features/workflows/stores/workflow-store";
import { useRouter } from "next/navigation";
import type { WorkflowTemplate } from "@/types/workflow";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { awardXP } from "@/lib/award-xp";
import { BriefRendersTemplateCard } from "@/features/brief-renders/components/BriefRendersTemplateCard";
import s from "./page.module.css";

/* ── Lazy-loaded 3D scenes — three + @react-three/fiber are ~750KB,
       so split them out of the templates initial chunk. ── */
const TemplatesHeroScene = lazy(() => import("@/features/dashboard/components/TemplatesHeroScene").then(m => ({ default: m.TemplatesHeroScene })));
const CardScene3D = dynamic(() => import("@/features/dashboard/components/TemplateCardScene"), { ssr: false });

/* ══════════════════════════════════════════════════════════════════════
   SHARED CONSTANTS — used by both light and dark themes
   ══════════════════════════════════════════════════════════════════════ */

const CATEGORIES = ["All", "Concept Design", "Visualization", "BIM Export", "Cost Estimation", "Full Pipeline", "Site Analysis"];

const CATEGORY_COLORS: Record<string, string> = {
  "Concept Design": "#3B82F6", "Visualization": "#10B981", "BIM Export": "#F59E0B",
  "Cost Estimation": "#8B5CF6", "Full Pipeline": "#06B6D4", "Site Analysis": "#10B981",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Concept Design": <PenTool size={11} />, "Visualization": <Compass size={11} />,
  "BIM Export": <Layers size={11} />, "Cost Estimation": <Ruler size={11} />,
  "Full Pipeline": <Building2 size={11} />, "Site Analysis": <Triangle size={11} />,
};

const SORT_OPTION_KEYS: Record<string, string> = {
  default: "templates.popular", simple: "templates.simpleFirst",
  advanced: "templates.advancedFirst", nodes: "templates.fewestNodes",
};

const COMPLEXITY_ORDER: Record<string, number> = { simple: 0, intermediate: 1, advanced: 2 };
const LOCKED_IDS = new Set(["wf-05", "wf-06", "wf-08", "wf-11"]);
const QUICK_START_IDS = ["wf-08", "wf-01", "wf-06"];
const CORE_IDS = ["wf-09", "wf-11", "wf-03"];
const HIDDEN_IDS = new Set(["wf-12"]);
const FEATURED_ID = "wf-08";

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  "Concept Design": "templates.categoryConceptDesign", "Visualization": "templates.categoryVisualization",
  "BIM Export": "templates.categoryBimExport", "Cost Estimation": "templates.categoryCostEstimation",
  "Full Pipeline": "templates.categoryFullPipeline", "Site Analysis": "templates.categorySiteAnalysis",
};

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

/* ── Preview mapping ── */
const R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";
const TEMPLATE_PREVIEWS: Record<string, { type: "video"; url: string; start: number } | { type: "svg"; output: string } | { type: "image"; url: string }> = {
  "wf-04": { type: "video", url: `${R2}/ifc-exporter.mp4`, start: 120 },
  "wf-09": { type: "image", url: `/boq-cost-estimate-preview.png` },
  "wf-01": { type: "image", url: `/floor-plan-editor-preview.png` },
  "wf-12": { type: "svg", output: "clash" },
  "wf-08": { type: "video", url: `${R2}/pdf-to-3d-model.mp4`, start: 2 },
  "wf-06": { type: "video", url: `${R2}/floor-plan-to-video-render.mp4`, start: 2 },
  "wf-05": { type: "video", url: `${R2}/interactive-3d-model.mp4`, start: 8 },
  "wf-03": { type: "video", url: `${R2}/text-to-concept-building.mp4`, start: 132 },
  "wf-11": { type: "video", url: `${R2}/img-to-renovation.mp4`, start: 0 },
};

/* ── SVG output illustration (dark theme) ── */
function OutputPreviewSVG({ output, color }: { output: string; color: string }) {
  const rgb = hexToRgb(color);
  const cases: Record<string, React.ReactNode> = {
    clash: (
      <svg viewBox="0 0 200 120" fill="none" style={{ width: "100%", height: "100%" }}>
        <rect x="25" y="42" width="150" height="12" rx="1.5" fill={`rgba(${rgb},0.08)`} stroke={`rgba(${rgb},0.2)`} strokeWidth="0.8" />
        <rect x="88" y="15" width="14" height="85" rx="1.5" fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.2)" strokeWidth="0.8" />
        <line x1="40" y1="85" x2="160" y2="25" stroke="rgba(139,92,246,0.2)" strokeWidth="6" strokeLinecap="round" />
        <circle cx="95" cy="48" r="10" fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.5)" strokeWidth="1">
          <animate attributeName="r" values="10;14;10" dur="2s" repeatCount="indefinite" />
        </circle>
        <text x="100" y="114" textAnchor="middle" fill={`rgba(${rgb},0.3)`} fontSize="8" fontFamily="monospace">CLASH DETECTION</text>
      </svg>
    ),
  };
  return <>{cases[output] ?? <svg viewBox="0 0 200 120" fill="none" style={{ width: "100%", height: "100%" }}><rect x="60" y="30" width="80" height="60" rx="4" fill={`rgba(${rgb},0.05)`} stroke={`rgba(${rgb},0.1)`} strokeWidth="0.8" /></svg>}</>;
}

/* ── Stats bar data ── */
const AEC_STATS = [
  { value: PREBUILT_WORKFLOWS.length.toString(), labelKey: "templates.statWorkflows" as const, icon: <Layers size={13} /> },
  { value: "5", labelKey: "templates.statDisciplines" as const, icon: <HardHat size={13} /> },
  { value: "31", labelKey: "templates.statNodeTypes" as const, icon: <Building2 size={13} /> },
  { value: "IFC", labelKey: "templates.statNativeExport" as const, icon: <Compass size={13} /> },
];

const fadeInUp = { hidden: { opacity: 0, y: 30, filter: "blur(6px)" }, visible: { opacity: 1, y: 0, filter: "blur(0px)" } };
const stagger = { visible: { transition: { staggerChildren: 0.1 } } };

/* ══════════════════════════════════════════════════════════════════════
   DARK THEME COMPONENTS — preserved for data-theme="dark" fallback
   ══════════════════════════════════════════════════════════════════════ */

function WorkflowOverlay({ wfId, color, rgb }: { wfId: string; color: string; rgb: string }) {
  const overlays: Record<string, React.ReactNode> = {
    "wf-01": (<svg viewBox="0 0 120 120" fill="none" style={{ width: 120, height: 120, opacity: 0.15 }}><rect x="10" y="10" width="100" height="100" stroke={color} strokeWidth="0.5" strokeDasharray="4 4"><animate attributeName="stroke-dashoffset" from="0" to="8" dur="3s" repeatCount="indefinite" /></rect><line x1="10" y1="50" x2="70" y2="50" stroke={color} strokeWidth="0.5" /><line x1="60" y1="10" x2="60" y2="110" stroke={color} strokeWidth="0.5" /></svg>),
    "wf-03": (<svg viewBox="0 0 100 100" fill="none" style={{ width: 100, height: 100, opacity: 0.12 }}><path d="M20 70 L20 30 L50 15 L80 30 L80 70 L50 85 Z" stroke={color} strokeWidth="0.6"><animate attributeName="stroke-dasharray" values="0 200;200 0" dur="4s" repeatCount="indefinite" /></path><line x1="50" y1="15" x2="50" y2="55" stroke={color} strokeWidth="0.4" opacity="0.5" /><line x1="20" y1="30" x2="50" y2="45" stroke={color} strokeWidth="0.4" opacity="0.5" /></svg>),
    "wf-04": (<svg viewBox="0 0 100 100" fill="none" style={{ width: 100, height: 100, opacity: 0.12 }}><rect x="15" y="30" width="25" height="55" stroke={color} strokeWidth="0.5"><animate attributeName="height" values="55;50;55" dur="3s" repeatCount="indefinite" /></rect><rect x="45" y="50" width="35" height="35" stroke={color} strokeWidth="0.5"><animate attributeName="height" values="35;40;35" dur="3.5s" repeatCount="indefinite" /></rect><rect x="60" y="20" width="20" height="65" stroke={color} strokeWidth="0.5"><animate attributeName="height" values="65;60;65" dur="2.8s" repeatCount="indefinite" /></rect></svg>),
    "wf-06": (<svg viewBox="0 0 100 80" fill="none" style={{ width: 100, height: 80, opacity: 0.12 }}><rect x="5" y="5" width="90" height="60" rx="3" stroke={color} strokeWidth="0.6" /><circle cx="50" cy="35" r="15" stroke={color} strokeWidth="0.5" opacity="0.4"><animate attributeName="r" values="15;17;15" dur="3s" repeatCount="indefinite" /></circle><circle cx="50" cy="35" r="4" fill={`rgba(${rgb},0.2)`} /><rect x="5" y="68" width="90" height="6" rx="2" fill={`rgba(${rgb},0.06)`} /><rect x="5" y="68" width="30" height="6" rx="2" fill={`rgba(${rgb},0.12)`}><animate attributeName="width" values="0;90;0" dur="5s" repeatCount="indefinite" /></rect></svg>),
    "wf-08": (<svg viewBox="0 0 100 80" fill="none" style={{ width: 100, height: 80, opacity: 0.12 }}><rect x="5" y="10" width="30" height="40" rx="2" stroke={color} strokeWidth="0.5" /><line x1="10" y1="20" x2="30" y2="20" stroke={color} strokeWidth="0.3" /><line x1="10" y1="26" x2="28" y2="26" stroke={color} strokeWidth="0.3" /><line x1="10" y1="32" x2="25" y2="32" stroke={color} strokeWidth="0.3" /><line x1="40" y1="30" x2="55" y2="30" stroke={color} strokeWidth="0.5" strokeDasharray="2 2"><animate attributeName="stroke-dashoffset" from="0" to="4" dur="1s" repeatCount="indefinite" /></line><polygon points="53,26 60,30 53,34" fill={`rgba(${rgb},0.3)`} /><rect x="65" y="10" width="30" height="40" rx="2" stroke={color} strokeWidth="0.5" /><rect x="70" y="15" width="20" height="15" rx="1" fill={`rgba(${rgb},0.06)`} /></svg>),
    "wf-09": (<svg viewBox="0 0 100 80" fill="none" style={{ width: 100, height: 80, opacity: 0.12 }}>{[0,1,2,3,4].map(i => (<rect key={i} x={10 + i * 18} y={60 - [30,45,25,50,35][i]} width="12" height={[30,45,25,50,35][i]} rx="1" fill={`rgba(${rgb},0.08)`} stroke={color} strokeWidth="0.4"><animate attributeName="height" values={`${[30,45,25,50,35][i]};${[35,40,30,45,40][i]};${[30,45,25,50,35][i]}`} dur={`${2.5 + i * 0.3}s`} repeatCount="indefinite" /><animate attributeName="y" values={`${60 - [30,45,25,50,35][i]};${60 - [35,40,30,45,40][i]};${60 - [30,45,25,50,35][i]}`} dur={`${2.5 + i * 0.3}s`} repeatCount="indefinite" /></rect>))}<line x1="5" y1="62" x2="95" y2="62" stroke={color} strokeWidth="0.3" /></svg>),
    "wf-05": (<svg viewBox="0 0 80 80" fill="none" style={{ width: 80, height: 80, opacity: 0.12 }}><g><animateTransform attributeName="transform" type="rotate" from="0 40 40" to="360 40 40" dur="20s" repeatCount="indefinite" /><circle cx="40" cy="40" r="30" stroke={color} strokeWidth="0.5" strokeDasharray="4 3" /><circle cx="40" cy="40" r="20" stroke={color} strokeWidth="0.4" strokeDasharray="3 4" /><circle cx="40" cy="40" r="5" fill={`rgba(${rgb},0.15)`} /></g></svg>),
    "wf-11": (<svg viewBox="0 0 100 60" fill="none" style={{ width: 100, height: 60, opacity: 0.12 }}><rect x="5" y="5" width="42" height="50" rx="2" stroke={color} strokeWidth="0.5" opacity="0.4" /><text x="26" y="33" textAnchor="middle" fill={color} fontSize="6" opacity="0.5">OLD</text><rect x="53" y="5" width="42" height="50" rx="2" stroke={color} strokeWidth="0.5" /><text x="74" y="33" textAnchor="middle" fill={color} fontSize="6" opacity="0.8">NEW</text><line x1="50" y1="5" x2="50" y2="55" stroke={color} strokeWidth="0.6"><animate attributeName="x1" values="50;52;50" dur="2s" repeatCount="indefinite" /><animate attributeName="x2" values="50;52;50" dur="2s" repeatCount="indefinite" /></line></svg>),
    "wf-12": (<svg viewBox="0 0 80 80" fill="none" style={{ width: 80, height: 80, opacity: 0.15 }}><line x1="10" y1="40" x2="70" y2="40" stroke={color} strokeWidth="2" opacity="0.4" /><line x1="40" y1="10" x2="40" y2="70" stroke="#F59E0B" strokeWidth="2" opacity="0.4" /><circle cx="40" cy="40" r="8" stroke="#EF4444" strokeWidth="1" fill="rgba(239,68,68,0.1)"><animate attributeName="r" values="8;12;8" dur="2s" repeatCount="indefinite" /><animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" /></circle></svg>),
  };
  return <>{overlays[wfId] ?? null}</>;
}

function DarkFeaturedTemplate({ wf, index, isMobile, onUse, t, userRole }: {
  wf: WorkflowTemplate; index: number; isMobile: boolean;
  onUse: (wf: WorkflowTemplate) => void; t: (key: TranslationKey) => string;
  userRole: string;
}) {
  const catColor = CATEGORY_COLORS[wf.category] ?? "#06B6D4";
  const catRgb = hexToRgb(catColor);
  const isLocked = LOCKED_IDS.has(wf.id) && userRole === "FREE";
  const reversed = index % 2 === 1;
  const pipelineSteps = wf.name.split("→").map(s => s.trim());
  const cardRef = useRef<HTMLDivElement>(null);

  const outputBadges: Array<{ label: string; icon: string; color: string }> = [];
  const eo = (wf.expectedOutputs ?? []).join(" ").toLowerCase();
  if (eo.includes("floor plan") || eo.includes("svg")) outputBadges.push({ label: "Floor Plan", icon: "\u{1F4D0}", color: "#14B8A6" });
  if (eo.includes("3d") || eo.includes("massing") || eo.includes("interactive")) outputBadges.push({ label: "3D Model", icon: "\u{1F9CA}", color: "#FFBF00" });
  if (eo.includes("render") || eo.includes("image") || eo.includes("concept")) outputBadges.push({ label: "Render", icon: "\u{1F5BC}", color: "#10B981" });
  if (eo.includes("video") || eo.includes("walkthrough") || eo.includes("cinematic")) outputBadges.push({ label: "Video", icon: "\u{1F3AC}", color: "#8B5CF6" });
  if (eo.includes("ifc") || eo.includes("bim")) outputBadges.push({ label: "IFC", icon: "\u{1F4E6}", color: "#3B82F6" });
  if (eo.includes("boq") || eo.includes("xlsx") || eo.includes("spreadsheet") || eo.includes("quantities")) outputBadges.push({ label: "BOQ", icon: "\u{1F4B0}", color: "#F59E0B" });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el || isMobile) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(1200px) rotateY(${x * 3}deg) rotateX(${-y * 2}deg) translateY(-6px)`;
  }, [isMobile]);

  const handleMouseLeave = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = "perspective(1200px) rotateY(0deg) rotateX(0deg) translateY(0px)";
  }, []);

  const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.2 } } };
  const itemVariants = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } } };
  const previewVariants = { hidden: { opacity: 0, x: reversed ? 40 : -40, scale: 0.96 }, visible: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const } } };

  return (
    <motion.div ref={cardRef} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="tpl-featured" onClick={() => onUse(wf)} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
      style={{ cursor: "pointer", display: "flex", flexDirection: isMobile ? "column" : reversed ? "row-reverse" : "row", marginBottom: 48, borderRadius: 24, overflow: "hidden", background: "linear-gradient(135deg, rgba(14,16,28,0.95) 0%, rgba(10,12,20,0.98) 100%)", border: `1px solid rgba(${catRgb}, 0.12)`, boxShadow: `0 8px 40px rgba(0,0,0,0.35), 0 0 80px rgba(${catRgb}, 0.03)`, transition: "border-color 0.4s, box-shadow 0.4s, transform 0.35s cubic-bezier(0.22,1,0.36,1)", position: "relative", transformStyle: "preserve-3d", willChange: "transform" }}>
      <div className="tpl-featured-shimmer" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, zIndex: 3, overflow: "hidden" }}><div style={{ width: "100%", height: "100%", background: `linear-gradient(90deg, transparent, ${catColor}50, transparent)` }} /></div>
      <motion.div variants={previewVariants} className="tpl-featured-scene" style={{ width: isMobile ? "100%" : "45%", height: isMobile ? 220 : 340, position: "relative", flexShrink: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, zIndex: 0, background: `radial-gradient(ellipse at ${reversed ? "30%" : "70%"} 50%, rgba(${catRgb}, 0.12) 0%, transparent 60%)`, pointerEvents: "none" }} />
        {(() => { const preview = TEMPLATE_PREVIEWS[wf.id]; if (preview?.type === "image") return <img src={preview.url} alt={wf.name} loading="lazy" className="tpl-featured-media" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", position: "relative", zIndex: 1, transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)" }} />; if (preview?.type === "video") return <video src={preview.url} muted playsInline onLoadedMetadata={e => { e.currentTarget.currentTime = preview.start; }} onMouseEnter={e => { e.currentTarget.play().catch(() => {}); }} onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = preview.start; }} className="tpl-featured-media" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", position: "relative", zIndex: 1, transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)" }} />; return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><Building2 size={48} style={{ color: `rgba(${catRgb}, 0.15)` }} /></div>; })()}
        <div style={{ position: "absolute", bottom: 16, [reversed ? "left" : "right"]: 16, zIndex: 2, pointerEvents: "none" }}><WorkflowOverlay wfId={wf.id} color={catColor} rgb={catRgb} /></div>
        {!isMobile && <div style={{ position: "absolute", top: 0, bottom: 0, zIndex: 2, [reversed ? "left" : "right"]: 0, width: 100, background: reversed ? "linear-gradient(90deg, rgba(10,12,20,0.98), transparent)" : "linear-gradient(270deg, rgba(10,12,20,0.98), transparent)", pointerEvents: "none" }} />}
        {isMobile && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(transparent, rgba(10,12,20,1))", pointerEvents: "none", zIndex: 2 }} />}
      </motion.div>
      <motion.div variants={containerVariants} style={{ flex: 1, padding: isMobile ? "20px 24px 28px" : "32px 44px", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", zIndex: 1, height: isMobile ? "auto" : 340, overflow: "hidden" }}>
        {!isMobile && <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.45 }}><CardScene3D wfId={wf.id} /></div>}
        <div style={{ position: "relative", zIndex: 2 }}>
          <motion.div variants={itemVariants} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div className="tpl-featured-badge" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 8, background: `rgba(${catRgb}, 0.12)`, border: `1px solid rgba(${catRgb}, 0.3)`, boxShadow: `0 0 16px rgba(${catRgb}, 0.08)` }}>
              {CATEGORY_ICONS[wf.category] && <span style={{ color: catColor, display: "flex" }}>{CATEGORY_ICONS[wf.category]}</span>}
              <span style={{ fontSize: 10, fontWeight: 700, color: catColor, letterSpacing: "0.08em", textTransform: "uppercase" }}>{wf.category}</span>
            </div>
            <span style={{ fontSize: 11, color: "rgba(160,175,200,0.4)" }}>&middot;</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(160,175,200,0.5)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: wf.complexity === "simple" ? "#10B981" : "#F59E0B" }} />{wf.complexity === "simple" ? t("dash.simpleLabel") : t("dash.advancedLabel")}</span>
            <span style={{ fontSize: 11, color: "rgba(160,175,200,0.4)" }}>&middot;</span>
            <span style={{ fontSize: 11, color: "rgba(160,175,200,0.4)", fontFamily: "var(--font-jetbrains), monospace" }}>{wf.tileGraph.nodes.length} {t("dash.nodes")} &middot; {wf.estimatedRunTime}</span>
          </motion.div>
          <motion.h3 variants={itemVariants} style={{ fontSize: 24, fontWeight: 700, color: "#F0F2F8", marginBottom: 12, letterSpacing: "-0.025em", lineHeight: 1.25 }}>{wf.name}</motion.h3>
          <motion.p variants={itemVariants} style={{ fontSize: 13.5, color: "rgba(160,175,200,0.6)", lineHeight: 1.6, marginBottom: 16, maxWidth: 480, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>{wf.description}</motion.p>
          <motion.div variants={itemVariants} style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 20 }}>
            {outputBadges.map((b, bi) => (<motion.span key={b.label} initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.4 + bi * 0.06, ease: [0.22, 1, 0.36, 1] }} className="tpl-output-badge" style={{ fontSize: 11, fontWeight: 600, color: b.color, padding: "5px 14px", borderRadius: 8, background: `rgba(${hexToRgb(b.color)}, 0.08)`, border: `1px solid rgba(${hexToRgb(b.color)}, 0.2)`, display: "flex", alignItems: "center", gap: 5, transition: "box-shadow 0.3s ease" }}><span style={{ fontSize: 13 }}>{b.icon}</span>{b.label}</motion.span>))}
          </motion.div>
          <motion.div variants={itemVariants}>
            <button className="tpl-featured-cta" style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 28px", borderRadius: 14, cursor: "pointer", background: isLocked ? "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.06))" : `linear-gradient(135deg, rgba(${catRgb}, 0.15), rgba(${catRgb}, 0.06))`, border: isLocked ? "1px solid rgba(245,158,11,0.35)" : `1px solid rgba(${catRgb}, 0.3)`, color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.3s ease", boxShadow: isLocked ? "0 0 24px rgba(245,158,11,0.1)" : `0 0 24px rgba(${catRgb}, 0.08)`, position: "relative", overflow: "hidden" }}>
              {isLocked && <Lock size={14} style={{ color: "#F59E0B", position: "relative", zIndex: 1 }} />}
              <span style={{ position: "relative", zIndex: 1 }}>{isLocked ? "Unlock Template" : "Use This Template"}</span>
              {isLocked ? <Sparkles size={14} style={{ color: "#F59E0B", position: "relative", zIndex: 1 }} /> : <ArrowRight size={16} className="tpl-cta-arrow" style={{ color: catColor, position: "relative", zIndex: 1, transition: "transform 0.3s ease" }} />}
            </button>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   LIGHT THEME SVG ILLUSTRATIONS — Phase Z.1B
   ══════════════════════════════════════════════════════════════════════ */

/* wf-08: Featured — PDF Brief → IFC + Video (stacked panels) */
function IllusFeatured() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }} aria-hidden="true">
      {/* Back panel: Document */}
      <div style={{ position: "absolute", width: 200, height: 260, background: "#fff", borderRadius: 12, border: "1px solid rgba(14,18,24,.08)", boxShadow: "0 8px 32px rgba(14,18,24,.06)", transform: "rotate(-6deg) translate(-30px, -10px)", padding: "18px 16px" }}>
        <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".12em", textTransform: "uppercase", color: "#9AA1B0", marginBottom: 10 }}>BRIEF.PDF &middot; P 1/3</div>
        <div style={{ fontFamily: "var(--font-display, Georgia, serif)", fontSize: 14, fontWeight: 500, color: "#0E1218", marginBottom: 8, fontStyle: "italic" }}>Office Building Brief</div>
        {[90, 75, 85, 60, 80, 50].map((w, i) => <div key={i} style={{ height: 3, width: `${w}%`, background: "rgba(14,18,24,.06)", borderRadius: 2, marginBottom: 5 }} />)}
        <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 6.5, letterSpacing: ".15em", textTransform: "uppercase", color: "#1A4D5C", marginTop: 8, marginBottom: 6 }}>SPECIFICATIONS</div>
        {[70, 55, 65].map((w, i) => <div key={i} style={{ height: 3, width: `${w}%`, background: "rgba(14,18,24,.04)", borderRadius: 2, marginBottom: 4 }} />)}
      </div>
      {/* Middle panel: IFC wireframe */}
      <div style={{ position: "absolute", width: 200, height: 240, background: "#0F1822", borderRadius: 12, border: "1px solid rgba(26,77,92,.3)", boxShadow: "0 12px 40px rgba(14,18,24,.15)", transform: "translate(0px, 5px)", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 10, right: 12, fontFamily: "var(--font-jetbrains, monospace)", fontSize: 6.5, letterSpacing: ".15em", textTransform: "uppercase", color: "rgba(229,168,120,.7)" }}>IFC4 &middot; OUTPUT</div>
        <svg viewBox="0 0 200 200" fill="none" style={{ width: "100%", height: "100%", padding: 24 }}>
          {/* Isometric building wireframe */}
          <path d="M60 140 L60 80 L100 60 L140 80 L140 140 L100 160 Z" stroke="#E5A878" strokeWidth="1.2" fill="none" />
          <line x1="100" y1="60" x2="100" y2="120" stroke="#E5A878" strokeWidth="0.8" opacity="0.5" />
          <line x1="60" y1="80" x2="100" y2="100" stroke="#E5A878" strokeWidth="0.6" opacity="0.4" />
          <line x1="140" y1="80" x2="100" y2="100" stroke="#E5A878" strokeWidth="0.6" opacity="0.4" />
          {/* Floor lines */}
          <line x1="60" y1="100" x2="100" y2="120" stroke="#E5A878" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.3" />
          <line x1="100" y1="120" x2="140" y2="100" stroke="#E5A878" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.3" />
          <line x1="60" y1="120" x2="100" y2="140" stroke="#E5A878" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.3" />
          <line x1="100" y1="140" x2="140" y2="120" stroke="#E5A878" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.3" />
          {/* Vertex dots */}
          <circle cx="60" cy="80" r="2" fill="#E5A878" opacity="0.6" />
          <circle cx="100" cy="60" r="2" fill="#E5A878" opacity="0.6" />
          <circle cx="140" cy="80" r="2" fill="#E5A878" opacity="0.6" />
          <circle cx="60" cy="140" r="2" fill="#E5A878" opacity="0.6" />
          <circle cx="100" cy="160" r="2" fill="#E5A878" opacity="0.6" />
          <circle cx="140" cy="140" r="2" fill="#E5A878" opacity="0.6" />
        </svg>
        <div style={{ position: "absolute", bottom: 10, left: 12, right: 12, display: "flex", justifyContent: "space-between", fontFamily: "var(--font-jetbrains, monospace)", fontSize: 6, color: "rgba(255,255,255,.35)", letterSpacing: ".1em" }}>
          <span>X 12.4M</span><span>Y 8.6M</span><span>Z 9.0M</span>
        </div>
      </div>
      {/* Front panel: Video */}
      <div style={{ position: "absolute", width: 180, height: 120, borderRadius: 12, overflow: "hidden", transform: "rotate(5deg) translate(40px, 60px)", boxShadow: "0 16px 48px rgba(14,18,24,.18)", border: "1px solid rgba(229,168,120,.2)" }}>
        <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #E5A878 0%, #C26A3B 50%, #1A4D5C 100%)" }}>
          {/* Skyline silhouette */}
          <svg viewBox="0 0 180 120" fill="none" style={{ position: "absolute", inset: 0 }}>
            <path d="M0 85 L20 75 L30 80 L45 60 L55 65 L65 45 L75 50 L90 35 L105 55 L115 48 L130 60 L145 55 L160 65 L180 58 L180 120 L0 120 Z" fill="rgba(14,18,24,.25)" />
          </svg>
          {/* Play button */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,.9)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,.15)" }}>
            <svg viewBox="0 0 16 16" fill="#0E1218" style={{ width: 14, height: 14, marginLeft: 2 }}><polygon points="3,1 13,8 3,15" /></svg>
          </div>
          <div style={{ position: "absolute", bottom: 8, right: 10, fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, color: "rgba(255,255,255,.7)", letterSpacing: ".08em" }}>0:15</div>
        </div>
      </div>
      {/* Floating data tags */}
      <div style={{ position: "absolute", top: 28, left: 20, display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 99, background: "rgba(245,242,236,.94)", border: "1px solid rgba(14,18,24,.06)", fontSize: 9, fontWeight: 500, fontFamily: "var(--font-jetbrains, monospace)", color: "#4A6B4D" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4A6B4D" }} />Brief parsed
      </div>
      <div style={{ position: "absolute", bottom: 32, right: 20, display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 99, background: "rgba(245,242,236,.94)", border: "1px solid rgba(14,18,24,.06)", fontSize: 9, fontWeight: 500, fontFamily: "var(--font-jetbrains, monospace)", color: "#1A4D5C" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#1A4D5C" }} />3 storeys &middot; IFC4
      </div>
    </div>
  );
}

/* wf-01: Text → Floor Plan */
function IllusFloorPlan() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }} aria-hidden="true">
      {/* Dot grid */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(14,18,24,.06) 1px, transparent 1px)", backgroundSize: "16px 16px", opacity: 0.5 }} />
      {/* Prompt card */}
      <div style={{ position: "absolute", top: 20, left: 16, width: 140, background: "#fff", borderRadius: 10, border: "1px solid rgba(14,18,24,.07)", boxShadow: "0 6px 20px rgba(14,18,24,.05)", padding: "12px 14px", transform: "rotate(-3deg)" }}>
        <div style={{ fontFamily: "var(--font-display, Georgia, serif)", fontSize: 22, fontWeight: 400, color: "#1A4D5C", lineHeight: 1, marginBottom: 6, fontStyle: "italic" }}>&ldquo;</div>
        <div style={{ fontFamily: "var(--font-display, Georgia, serif)", fontSize: 10, fontStyle: "italic", color: "#2A3142", lineHeight: 1.45 }}>A 3BHK apartment with sunlit living room facing south...</div>
      </div>
      {/* Floor plan SVG */}
      <svg viewBox="0 0 200 160" fill="none" style={{ position: "absolute", right: 8, bottom: 12, width: 180, height: 145 }}>
        {/* Outer walls */}
        <rect x="10" y="10" width="180" height="130" stroke="#0E1218" strokeWidth="2.5" fill="none" />
        {/* Interior walls */}
        <line x1="80" y1="10" x2="80" y2="90" stroke="#0E1218" strokeWidth="2" />
        <line x1="80" y1="90" x2="190" y2="90" stroke="#0E1218" strokeWidth="2" />
        <line x1="140" y1="10" x2="140" y2="90" stroke="#0E1218" strokeWidth="1.5" />
        {/* Door arcs */}
        <path d="M80 65 Q95 65 95 80" stroke="#1A4D5C" strokeWidth="1" fill="none" strokeDasharray="2 2" />
        <path d="M140 55 Q125 55 125 70" stroke="#1A4D5C" strokeWidth="1" fill="none" strokeDasharray="2 2" />
        {/* Windows (ember) */}
        <line x1="30" y1="10" x2="60" y2="10" stroke="#E5A878" strokeWidth="3" />
        <line x1="100" y1="10" x2="130" y2="10" stroke="#E5A878" strokeWidth="3" />
        <line x1="190" y1="40" x2="190" y2="70" stroke="#E5A878" strokeWidth="3" />
        {/* Room labels */}
        <text x="40" y="55" fontFamily="var(--font-jetbrains, monospace)" fontSize="7" fill="#5A6478" letterSpacing=".1em">LIVING</text>
        <text x="105" y="55" fontFamily="var(--font-jetbrains, monospace)" fontSize="6.5" fill="#5A6478" letterSpacing=".1em">KITCHEN</text>
        <text x="155" y="55" fontFamily="var(--font-jetbrains, monospace)" fontSize="6.5" fill="#5A6478" letterSpacing=".1em">BED 1</text>
        <text x="105" y="115" fontFamily="var(--font-jetbrains, monospace)" fontSize="6.5" fill="#5A6478" letterSpacing=".1em">BEDROOM</text>
        <text x="40" y="115" fontFamily="var(--font-jetbrains, monospace)" fontSize="6.5" fill="#5A6478" letterSpacing=".1em">BATH</text>
        {/* Dimension line */}
        <line x1="10" y1="150" x2="190" y2="150" stroke="#9AA1B0" strokeWidth="0.5" />
        <line x1="10" y1="147" x2="10" y2="153" stroke="#9AA1B0" strokeWidth="0.5" />
        <line x1="190" y1="147" x2="190" y2="153" stroke="#9AA1B0" strokeWidth="0.5" />
        <text x="100" y="157" textAnchor="middle" fontFamily="var(--font-jetbrains, monospace)" fontSize="6" fill="#9AA1B0">12.4 M</text>
      </svg>
    </div>
  );
}

/* wf-11: Photo → Renovation Video */
function IllusRenovation() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", overflow: "hidden" }} aria-hidden="true">
      {/* Before half */}
      <div style={{ flex: 1, background: "linear-gradient(180deg, #D0D5DC 0%, #A8B0BA 100%)", position: "relative", filter: "grayscale(0.6)" }}>
        <svg viewBox="0 0 100 240" fill="none" style={{ width: "100%", height: "100%" }}>
          {/* Building silhouette */}
          <rect x="10" y="30" width="80" height="200" fill="rgba(14,18,24,.12)" />
          {[0,1,2,3,4,5,6].map(row => [0,1,2].map(col => <rect key={`${row}-${col}`} x={18 + col * 24} y={40 + row * 28} width="16" height="12" rx="1" fill="rgba(14,18,24,.08)" stroke="rgba(14,18,24,.1)" strokeWidth="0.5" />))}
        </svg>
        <div style={{ position: "absolute", top: 10, left: 10, padding: "3px 8px", borderRadius: 99, background: "rgba(14,18,24,.6)", fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, color: "#fff", letterSpacing: ".12em", textTransform: "uppercase" }}>Before</div>
      </div>
      {/* Divider */}
      <div style={{ width: 2, background: "#fff", position: "relative", zIndex: 2 }}>
        <div style={{ position: "absolute", top: "25%", left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,.15)" }} />
        <div style={{ position: "absolute", top: "75%", left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,.15)" }} />
      </div>
      {/* After half */}
      <div style={{ flex: 1, background: "linear-gradient(180deg, #E5A878 0%, #1A4D5C 100%)", position: "relative" }}>
        <svg viewBox="0 0 100 240" fill="none" style={{ width: "100%", height: "100%" }}>
          <rect x="10" y="30" width="80" height="200" fill="rgba(26,77,92,.15)" />
          {[0,1,2,3,4,5,6].map(row => [0,1,2].map(col => <rect key={`${row}-${col}`} x={18 + col * 24} y={40 + row * 28} width="16" height="12" rx="1" fill="rgba(26,77,92,.12)" stroke="rgba(93,175,192,.3)" strokeWidth="0.5" />))}
          {/* Planter strip */}
          <rect x="10" y="220" width="80" height="8" rx="2" fill="rgba(74,107,77,.25)" />
        </svg>
        <div style={{ position: "absolute", top: 10, right: 10, padding: "3px 8px", borderRadius: 99, background: "rgba(14,18,24,.6)", fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, color: "#fff", letterSpacing: ".12em", textTransform: "uppercase" }}>After</div>
      </div>
      {/* Play button */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 44, height: 44, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(0,0,0,.15)", zIndex: 3 }}>
        <svg viewBox="0 0 16 16" fill="#0E1218" style={{ width: 16, height: 16, marginLeft: 2 }}><polygon points="3,1 13,8 3,15" /></svg>
      </div>
      <div style={{ position: "absolute", bottom: 10, right: 10, fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, color: "rgba(255,255,255,.7)", letterSpacing: ".1em", textTransform: "uppercase", zIndex: 3 }}>0:15 &middot; KLING</div>
    </div>
  );
}

/* wf-06: Floor Plan → Render + Video */
function IllusRenderVideo() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #0F1822 0%, #1A2533 100%)", overflow: "hidden" }} aria-hidden="true">
      {/* Teal grid */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(26,77,92,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(26,77,92,.08) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
      {/* Blueprint floor plan (left) */}
      <svg viewBox="0 0 120 100" fill="none" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", width: 120, height: 100 }}>
        <rect x="5" y="5" width="110" height="85" stroke="#1A4D5C" strokeWidth="1.2" fill="none" />
        <line x1="50" y1="5" x2="50" y2="60" stroke="#1A4D5C" strokeWidth="0.8" />
        <line x1="50" y1="60" x2="115" y2="60" stroke="#1A4D5C" strokeWidth="0.8" />
        <line x1="15" y1="5" x2="40" y2="5" stroke="#E5A878" strokeWidth="2" />
        <line x1="70" y1="5" x2="100" y2="5" stroke="#E5A878" strokeWidth="2" />
      </svg>
      {/* Arrow */}
      <div style={{ position: "absolute", left: "44%", top: "50%", transform: "translate(-50%,-50%)" }}>
        <svg viewBox="0 0 30 16" fill="none" style={{ width: 30, height: 16 }}>
          <line x1="0" y1="8" x2="24" y2="8" stroke="#E5A878" strokeWidth="1.5" />
          <polygon points="22,4 30,8 22,12" fill="#E5A878" />
        </svg>
      </div>
      {/* Render preview (right) */}
      <div style={{ position: "absolute", right: 16, top: 20, width: 130, height: 100, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(229,168,120,.2)" }}>
        <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #E5A878 0%, #C26A3B 60%, #1A4D5C 100%)" }}>
          {/* Light beam */}
          <div style={{ position: "absolute", top: 0, right: 20, width: 40, height: "100%", background: "linear-gradient(180deg, rgba(255,255,255,.15) 0%, transparent 60%)", transform: "skewX(-15deg)" }} />
        </div>
      </div>
      {/* Stamp */}
      <div style={{ position: "absolute", top: 10, right: 12, fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".12em", textTransform: "uppercase", color: "#E5A878" }}>PHOTOREAL &middot; 15S</div>
      {/* Film strip */}
      <div style={{ position: "absolute", bottom: 14, right: 16, display: "flex", gap: 4 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: 28, height: 18, borderRadius: 3, background: i === 1 ? "radial-gradient(ellipse at 50% 50%, rgba(229,168,120,.3), rgba(14,24,34,.5))" : "rgba(30,37,49,.6)", border: i === 1 ? "1px solid rgba(229,168,120,.5)" : "1px solid rgba(255,255,255,.06)", boxShadow: i === 1 ? "0 0 8px rgba(229,168,120,.2)" : "none" }} />
        ))}
      </div>
    </div>
  );
}

/* wf-09: IFC → BOQ Cost Estimate */
function IllusBOQ() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }} aria-hidden="true">
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(14,18,24,.05) 1px, transparent 1px)", backgroundSize: "18px 18px", opacity: 0.6 }} />
      <div style={{ width: "82%", background: "#fff", borderRadius: 14, border: "1px solid rgba(14,18,24,.07)", boxShadow: "0 8px 28px rgba(14,18,24,.06)", padding: "20px 22px", transform: "rotate(-1deg)", transition: "transform .3s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".15em", textTransform: "uppercase", color: "#9AA1B0", marginBottom: 4 }}>TOTAL PROJECT COST</div>
            <div style={{ fontFamily: "var(--font-display, Georgia, serif)", fontSize: 28, fontWeight: 500, fontStyle: "italic", color: "#1A4D5C", letterSpacing: "-.03em" }}>&#x20B9;9.03 Cr</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".12em", textTransform: "uppercase", color: "#9AA1B0", marginBottom: 4 }}>CONFIDENCE</div>
            <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 16, fontWeight: 600, color: "#4A6B4D" }}>88%</div>
          </div>
        </div>
        {[
          { label: "Concrete", value: "\u20B93.42 Cr", color: "#1A4D5C" },
          { label: "Brick + masonry", value: "\u20B91.18 Cr", color: "#C26A3B" },
          { label: "MEP + finishes", value: "\u20B92.84 Cr", color: "#4A6B4D" },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 2 ? "1px dashed rgba(14,18,24,.08)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: row.color }} />
              <span style={{ fontSize: 12, color: "#2A3142", fontWeight: 500 }}>{row.label}</span>
            </div>
            <span style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 11, color: "#0E1218", fontWeight: 500 }}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* wf-03: Text → 3D Building + IFC */
function IllusBuilding3D() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #0F1822 0%, #1A2533 100%)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }} aria-hidden="true">
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(26,77,92,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(26,77,92,.06) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      <svg viewBox="0 0 200 200" fill="none" style={{ width: "70%", height: "70%", position: "relative", zIndex: 1 }}>
        {/* Isometric building */}
        <path d="M60 140 L60 70 L100 50 L140 70 L140 140 L100 160 Z" stroke="#E5A878" strokeWidth="1.5" fill="none" />
        <line x1="100" y1="50" x2="100" y2="110" stroke="#E5A878" strokeWidth="1" opacity="0.5" />
        <line x1="60" y1="70" x2="100" y2="90" stroke="#E5A878" strokeWidth="0.8" opacity="0.4" />
        <line x1="140" y1="70" x2="100" y2="90" stroke="#E5A878" strokeWidth="0.8" opacity="0.4" />
        {/* Floor lines (dashed) */}
        <line x1="60" y1="93" x2="100" y2="113" stroke="#E5A878" strokeWidth="0.6" strokeDasharray="4 4" opacity="0.3" />
        <line x1="100" y1="113" x2="140" y2="93" stroke="#E5A878" strokeWidth="0.6" strokeDasharray="4 4" opacity="0.3" />
        <line x1="60" y1="116" x2="100" y2="136" stroke="#E5A878" strokeWidth="0.6" strokeDasharray="4 4" opacity="0.3" />
        <line x1="100" y1="136" x2="140" y2="116" stroke="#E5A878" strokeWidth="0.6" strokeDasharray="4 4" opacity="0.3" />
        {/* Windows */}
        <rect x="70" y="78" width="8" height="6" rx="1" fill="rgba(229,168,120,.12)" stroke="#E5A878" strokeWidth="0.5" />
        <rect x="70" y="100" width="8" height="6" rx="1" fill="rgba(229,168,120,.12)" stroke="#E5A878" strokeWidth="0.5" />
        {/* Vertex dots */}
        {[[60,70],[100,50],[140,70],[60,140],[100,160],[140,140]].map(([cx,cy], i) => <circle key={i} cx={cx} cy={cy} r="2.5" fill="#E5A878" opacity="0.5" />)}
      </svg>
      <div style={{ position: "absolute", top: 14, right: 16, fontFamily: "var(--font-jetbrains, monospace)", fontSize: 8, letterSpacing: ".12em", textTransform: "uppercase", color: "#E5A878" }}>IFC4</div>
      <div style={{ position: "absolute", bottom: 14, left: 16, fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, color: "rgba(255,255,255,.3)", letterSpacing: ".08em" }}>3 STOREYS &middot; 12.4 &times; 8.6 M</div>
    </div>
  );
}

/* wf-04: Parameters → Massing + IFC */
function IllusMassing() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "36% 64%", overflow: "hidden" }} aria-hidden="true">
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(14,18,24,.04) 1px, transparent 1px)", backgroundSize: "16px 16px", opacity: 0.5 }} />
      {/* Left: Sliders */}
      <div style={{ padding: "24px 14px 24px 18px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, position: "relative", zIndex: 1 }}>
        {[
          { label: "FLOORS", value: "3" },
          { label: "GFA M\u00B2", value: "2,400" },
          { label: "HEIGHT M", value: "12" },
          { label: "FOOTPRINT", value: "CYL" },
        ].map((p, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".15em", textTransform: "uppercase", color: "#9AA1B0" }}>{p.label}</span>
              <span style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 8, fontWeight: 600, color: "#1A4D5C" }}>{p.value}</span>
            </div>
            <div style={{ height: 4, background: "rgba(14,18,24,.06)", borderRadius: 2, position: "relative" }}>
              <div style={{ height: "100%", width: `${40 + i * 15}%`, background: "#1A4D5C", borderRadius: 2 }} />
              <div style={{ position: "absolute", top: "50%", left: `${40 + i * 15}%`, transform: "translate(-50%,-50%)", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: "2px solid #1A4D5C", boxShadow: "0 1px 4px rgba(0,0,0,.1)" }} />
            </div>
          </div>
        ))}
      </div>
      {/* Right: Cylinder wireframe */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
        <svg viewBox="0 0 160 200" fill="none" style={{ width: "85%", height: "85%" }}>
          {/* Top ellipse */}
          <ellipse cx="80" cy="40" rx="55" ry="18" stroke="#0E1218" strokeWidth="1.2" fill="none" />
          {/* Bottom ellipse */}
          <ellipse cx="80" cy="160" rx="55" ry="18" stroke="#0E1218" strokeWidth="1.2" fill="none" />
          {/* Middle ellipses (dashed) */}
          <ellipse cx="80" cy="80" rx="55" ry="18" stroke="#0E1218" strokeWidth="0.6" fill="none" strokeDasharray="4 3" />
          <ellipse cx="80" cy="120" rx="55" ry="18" stroke="#0E1218" strokeWidth="0.6" fill="none" strokeDasharray="4 3" />
          {/* Vertical edges */}
          <line x1="25" y1="40" x2="25" y2="160" stroke="#0E1218" strokeWidth="1" />
          <line x1="135" y1="40" x2="135" y2="160" stroke="#0E1218" strokeWidth="1" />
          {/* Vertex dots */}
          {[[25,40],[135,40],[25,160],[135,160]].map(([cx,cy], i) => <circle key={i} cx={cx} cy={cy} r="3" fill="#C26A3B" opacity="0.6" />)}
          <text x="80" y="190" textAnchor="middle" fontFamily="var(--font-jetbrains, monospace)" fontSize="7" fill="#9AA1B0" letterSpacing=".12em">IFC4 EXPORT</text>
        </svg>
      </div>
    </div>
  );
}

/* wf-05: Floor Plan → Interactive 3D */
function IllusInteractive3D() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" }} aria-hidden="true">
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, rgba(14,18,24,.04) 1px, transparent 1px)", backgroundSize: "16px 16px", opacity: 0.5 }} />
      {/* 2D floor plan (top) */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <svg viewBox="0 0 160 80" fill="none" style={{ width: 140, height: 70 }}>
          <rect x="5" y="5" width="150" height="65" stroke="#0E1218" strokeWidth="2" fill="none" />
          <line x1="60" y1="5" x2="60" y2="50" stroke="#0E1218" strokeWidth="1.5" />
          <line x1="60" y1="50" x2="155" y2="50" stroke="#0E1218" strokeWidth="1.5" />
          <line x1="110" y1="5" x2="110" y2="50" stroke="#0E1218" strokeWidth="1" />
        </svg>
        <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".15em", textTransform: "uppercase", color: "#9AA1B0", textAlign: "center", marginTop: 4 }}>2D PLAN</div>
      </div>
      {/* Arrow circle */}
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#fff", border: "1.5px solid #1A4D5C", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1, boxShadow: "0 2px 8px rgba(0,0,0,.06)" }}>
        <svg viewBox="0 0 16 16" fill="none" style={{ width: 14, height: 14 }}><line x1="8" y1="12" x2="8" y2="4" stroke="#1A4D5C" strokeWidth="1.5" /><polyline points="4,7 8,3 12,7" stroke="#1A4D5C" strokeWidth="1.5" fill="none" /></svg>
      </div>
      {/* Dashed connection lines */}
      <div style={{ position: "absolute", top: "32%", left: "25%", width: 1, height: "36%", borderLeft: "1.5px dashed rgba(26,77,92,.2)", zIndex: 0 }} />
      <div style={{ position: "absolute", top: "32%", left: "50%", width: 1, height: "36%", borderLeft: "1.5px dashed rgba(26,77,92,.2)", zIndex: 0 }} />
      <div style={{ position: "absolute", top: "32%", left: "75%", width: 1, height: "36%", borderLeft: "1.5px dashed rgba(26,77,92,.2)", zIndex: 0 }} />
      {/* 3D extruded view (bottom) */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <svg viewBox="0 0 180 100" fill="none" style={{ width: 160, height: 90 }}>
          {/* Front face */}
          <path d="M20 85 L20 45 L80 45 L80 85 Z" fill="rgba(26,77,92,.08)" stroke="#0E1218" strokeWidth="1.5" />
          {/* Side face */}
          <path d="M80 85 L80 45 L130 25 L130 65 Z" fill="rgba(26,77,92,.04)" stroke="#0E1218" strokeWidth="1" />
          {/* Top face */}
          <path d="M20 45 L70 25 L130 25 L80 45 Z" fill="rgba(26,77,92,.02)" stroke="#0E1218" strokeWidth="0.8" />
          {/* Interior wall hint */}
          <line x1="52" y1="45" x2="52" y2="85" stroke="#0E1218" strokeWidth="0.8" opacity="0.5" />
          <line x1="52" y1="45" x2="102" y2="25" stroke="#0E1218" strokeWidth="0.6" opacity="0.3" />
        </svg>
        <div style={{ fontFamily: "var(--font-jetbrains, monospace)", fontSize: 7, letterSpacing: ".15em", textTransform: "uppercase", color: "#9AA1B0", textAlign: "center", marginTop: 4 }}>3D &middot; INTERACTIVE</div>
      </div>
    </div>
  );
}

/* Map wfId → illustration component */
const ILLUS_MAP: Record<string, React.FC> = {
  "wf-08": IllusFeatured,
  "wf-01": IllusFloorPlan,
  "wf-11": IllusRenovation,
  "wf-06": IllusRenderVideo,
  "wf-09": IllusBOQ,
  "wf-03": IllusBuilding3D,
  "wf-04": IllusMassing,
  "wf-05": IllusInteractive3D,
};

/* ══════════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ══════════════════════════════════════════════════════════════════════ */

export default function TemplatesPage() {
  const { t } = useLocale();
  const [activeCategory, setActiveCategory] = useState("All");
  const [sortBy, setSortBy] = useState("default");
  const [showSort, setShowSort] = useState(false);
  const [userRole, setUserRole] = useState("FREE");
  const [upgradeModal, setUpgradeModal] = useState<{ wf: WorkflowTemplate } | null>(null);
  const [isSticky, setIsSticky] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  // Theme: "light" is the Render Studio default. "dark" preserves the original.
  const [theme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    fetch("/api/user/dashboard-stats").then(r => r.ok ? r.json() : null).then(d => { if (d?.userRole) setUserRole(d.userRole); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showSort) return;
    const h = (e: MouseEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showSort]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      if (heroRef.current) {
        const heroBottom = heroRef.current.getBoundingClientRect().bottom;
        const mainTop = el.getBoundingClientRect().top;
        setIsSticky(heroBottom <= mainTop + 1);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const loadFromTemplate = useWorkflowStore(selectLoadFromTemplate);
  const router = useRouter();

  const filtered = useMemo(() => {
    let list = PREBUILT_WORKFLOWS.filter(w => !HIDDEN_IDS.has(w.id));
    if (activeCategory !== "All") list = list.filter(w => w.category === activeCategory);
    if (sortBy === "simple") list.sort((a, b) => COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity]);
    if (sortBy === "advanced") list.sort((a, b) => COMPLEXITY_ORDER[b.complexity] - COMPLEXITY_ORDER[a.complexity]);
    if (sortBy === "nodes") list.sort((a, b) => a.tileGraph.nodes.length - b.tileGraph.nodes.length);
    return list;
  }, [activeCategory, sortBy]);

  const handleUse = (wf: WorkflowTemplate) => {
    if (LOCKED_IDS.has(wf.id) && userRole === "FREE") {
      setUpgradeModal({ wf });
      return;
    }
    const template = PREBUILT_WORKFLOWS.find(w => w.id === wf.id);
    if (!template) return;
    loadFromTemplate(template as WorkflowTemplate);
    awardXP("template-cloned");
    router.push("/dashboard/canvas");
  };

  const SORT_OPTIONS = Object.entries(SORT_OPTION_KEYS).map(([value, key]) => ({ value, label: t(key as TranslationKey) }));
  const currentSort = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? t("templates.popular");

  /* ── Light theme: bucket templates ── */
  const featuredWf = filtered.find(w => w.id === FEATURED_ID);
  const nonFeatured = filtered.filter(w => w.id !== FEATURED_ID);
  const isFiltered = activeCategory !== "All";

  const quickStart = nonFeatured.filter(w => QUICK_START_IDS.includes(w.id));
  const core = nonFeatured.filter(w => CORE_IDS.includes(w.id) && !QUICK_START_IDS.includes(w.id));
  const rest = nonFeatured.filter(w => !QUICK_START_IDS.includes(w.id) && !CORE_IDS.includes(w.id));

  /* ── Dark theme: same bucketing as before ── */
  const darkQuickStart = filtered.filter(w => QUICK_START_IDS.includes(w.id));
  const darkCore = filtered.filter(w => CORE_IDS.includes(w.id) && !QUICK_START_IDS.includes(w.id));
  const darkRest = filtered.filter(w => !QUICK_START_IDS.includes(w.id) && !CORE_IDS.includes(w.id));

  /* ── Shared render helpers ── */
  function renderLightCard(wf: WorkflowTemplate, idx: number) {
    const isLocked = LOCKED_IDS.has(wf.id) && userRole === "FREE";
    const IllusComp = ILLUS_MAP[wf.id];
    const isDarkIllus = wf.id === "wf-06" || wf.id === "wf-03";
    const isCostCard = wf.category === "Cost Estimation";
    const steps = wf.name.split("\u2192").map(x => x.trim());

    return (
      <div
        key={wf.id}
        className={s.card}
        role="article"
        aria-label={wf.name}
        tabIndex={0}
        onClick={() => handleUse(wf)}
        onKeyDown={e => { if (e.key === "Enter") handleUse(wf); }}
        style={{ animationDelay: `${idx * 0.08}s` }}
      >
        <div className={isDarkIllus ? s.cardIllusDark : s.cardIllus}>
          <div className={isDarkIllus ? s.cardCornerDark : isCostCard ? s.cardCornerCost : s.cardCorner}>
            <span className={isDarkIllus ? s.cardCornerDarkDot : isCostCard ? s.cardCornerCostDot : s.cardCornerDot} />
            {wf.category}
          </div>
          {isLocked ? (
            <div className={s.cardLock}><Lock size={9} /> PRO</div>
          ) : (
            <span className={isDarkIllus ? s.cardNumLight : s.cardNum}>{String(idx + 1).padStart(2, "0")}</span>
          )}
          {IllusComp && <IllusComp />}
        </div>
        <div className={s.cardContent}>
          <div className={s.cardMeta}>
            <span>{wf.complexity === "simple" ? t("dash.simpleLabel") : t("dash.advancedLabel")}</span>
            <span className={s.cardMetaDot} />
            <span>{wf.tileGraph.nodes.length} {t("dash.nodes")}</span>
            <span className={s.cardMetaDot} />
            <span>{wf.estimatedRunTime}</span>
          </div>
          <h3 className={s.cardTitle}>
            {steps.length >= 2 ? <>{steps[0]} <em>&rarr; {steps.slice(1).join(" \u2192 ")}</em></> : wf.name}
          </h3>
          <p className={s.cardDesc}>{wf.description}</p>
          <div className={s.cardFoot}>
            <div className={s.cardTags}>
              {wf.tags.slice(0, 3).map(tag => <span key={tag} className={s.tag}>{tag}</span>)}
            </div>
            <span className={isLocked ? s.cardCtaLocked : s.cardCta}>
              {isLocked ? "Upgrade" : "Use template"} <ArrowRight size={13} />
            </span>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  if (theme === "dark") {
    /* ────── DARK THEME — original markup preserved exactly ────── */
    function DarkSectionHeader({ title, subtitle, icon, color, rgb, count }: { title: string; subtitle: string; icon: React.ReactNode; color: string; rgb: string; count: number }) {
      return (
        <div style={{ marginBottom: 40, position: "relative" }}>
          <div style={{ position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)", width: 500, height: 200, borderRadius: "50%", background: `radial-gradient(ellipse, rgba(${rgb}, 0.035) 0%, transparent 70%)`, pointerEvents: "none" }} />
          <motion.div initial={{ scaleX: 0, opacity: 0 }} whileInView={{ scaleX: 1, opacity: 1 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} style={{ height: 1, maxWidth: 280, margin: "0 auto 32px", background: `linear-gradient(90deg, transparent, rgba(${rgb}, 0.5), rgba(139,92,246,0.2), transparent)`, transformOrigin: "center" }} />
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} style={{ display: "flex", alignItems: "center", gap: 16, position: "relative", zIndex: 1 }}>
            <div className="tpl-section-icon" style={{ width: 48, height: 48, borderRadius: 16, position: "relative", background: `linear-gradient(135deg, rgba(${rgb}, 0.18), rgba(${rgb}, 0.05))`, border: `1px solid rgba(${rgb}, 0.3)`, display: "flex", alignItems: "center", justifyContent: "center", color, boxShadow: `0 0 28px rgba(${rgb}, 0.15), inset 0 1px 0 rgba(255,255,255,0.06)` }}>{icon}<div style={{ position: "absolute", inset: -4, borderRadius: 20, border: `1px solid rgba(${rgb}, 0.15)`, animation: "tpl-pulse 3s ease-in-out infinite", pointerEvents: "none" }} /></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 20, fontWeight: 700, color: "#F0F2F8", letterSpacing: "-0.025em" }}>{title}</div><div style={{ fontSize: 13, color: "rgba(160,175,200,0.45)", marginTop: 4 }}>{subtitle}</div></div>
            <motion.div initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3, type: "spring", stiffness: 200 }} style={{ width: 38, height: 38, borderRadius: 12, background: `rgba(${rgb}, 0.1)`, border: `1px solid rgba(${rgb}, 0.22)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color, boxShadow: `0 0 16px rgba(${rgb}, 0.08)` }}>{count}</motion.div>
          </motion.div>
        </div>
      );
    }

    return (
      <div className={s.page} data-theme="dark" style={{ background: "#07070D" }}>
        <main ref={mainRef} style={{ flex: 1, overflowY: "auto" }}>
          <div ref={heroRef} className="tpl-hero" style={{ position: "relative", overflow: "hidden", minHeight: 420, display: "flex", alignItems: "center", padding: "60px 48px 40px", background: "radial-gradient(ellipse at 30% 40%, rgba(6,182,212,0.1) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(139,92,246,0.08) 0%, transparent 50%), linear-gradient(180deg, #060610 0%, #07070D 100%)" }}>
            <Suspense fallback={<div style={{ position: "absolute", inset: 0, background: "#07070D" }} />}><TemplatesHeroScene /></Suspense>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 120, background: "linear-gradient(transparent, #07070D)", zIndex: 1, pointerEvents: "none" }} />
            <motion.div initial="hidden" animate="visible" variants={stagger} style={{ position: "relative", zIndex: 2, maxWidth: 640 }}>
              <motion.div variants={fadeInUp} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 20 }}><div style={{ width: 36, height: 2, background: "linear-gradient(90deg, #06B6D4, rgba(139,92,246,0.6))", borderRadius: 1 }} /><span style={{ fontSize: 11, fontWeight: 700, color: "rgba(6,182,212,0.8)", textTransform: "uppercase", letterSpacing: "3px", fontFamily: "var(--font-jetbrains), monospace" }}>{t("templates.startWithProven")}</span></motion.div>
              <motion.h1 className="tpl-hero-title" variants={fadeInUp} transition={{ duration: 0.7, delay: 0.1 }} style={{ fontSize: 42, fontWeight: 800, color: "#F0F0F5", lineHeight: 1.1, marginBottom: 16, letterSpacing: "-0.035em", textShadow: "0 0 60px rgba(6,182,212,0.15)" }}>{t("templates.fromBrief")}</motion.h1>
              <motion.p className="tpl-hero-subtitle" variants={fadeInUp} transition={{ duration: 0.7, delay: 0.2 }} style={{ fontSize: 15, color: "rgba(160,170,200,0.7)", lineHeight: 1.7, maxWidth: 480, marginBottom: 32 }}>{t("templates.fromBriefDesc")}</motion.p>
              <motion.div className="tpl-stats-bar" variants={fadeInUp} transition={{ duration: 0.7, delay: 0.35 }} style={{ display: "inline-flex", background: "rgba(10,12,20,0.5)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden" }}>
                {AEC_STATS.map((stat, i) => (<div key={stat.labelKey} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderRight: i < AEC_STATS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}><span style={{ color: "rgba(6,182,212,0.5)", display: "flex" }}>{stat.icon}</span><span style={{ fontSize: 15, fontWeight: 700, color: "#E0E0F0", fontFamily: "var(--font-jetbrains), monospace" }}>{stat.value}</span><span style={{ fontSize: 10, color: "rgba(160,170,200,0.4)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{t(stat.labelKey)}</span></div>))}
              </motion.div>
            </motion.div>
          </div>
          <BriefRendersTemplateCard />
          {/* Dark filter bar */}
          <div className="tpl-filter-bar" style={{ position: "sticky", top: 0, zIndex: 20, padding: "14px 80px 14px 32px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: isSticky ? "rgba(7,7,13,0.92)" : "rgba(7,7,13,0.5)", backdropFilter: isSticky ? "blur(24px)" : "blur(10px)", borderBottom: isSticky ? "1px solid rgba(6,182,212,0.06)" : "1px solid transparent", boxShadow: isSticky ? "0 8px 32px rgba(0,0,0,0.3)" : "none", transition: "all 0.35s ease" }}>
            {CATEGORIES.map(cat => { const isActive = cat === activeCategory; const cc = CATEGORY_COLORS[cat]; const rgb = cc ? hexToRgb(cc) : "6, 182, 212"; return (<button key={cat} onClick={() => setActiveCategory(cat)} className="tpl-filter-chip" style={{ padding: "8px 18px", borderRadius: 12, cursor: "pointer", fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, background: isActive ? `rgba(${rgb}, 0.15)` : "rgba(255,255,255,0.03)", border: isActive ? `1px solid rgba(${rgb}, 0.4)` : "1px solid rgba(255,255,255,0.06)", color: isActive ? (cc ?? "#06B6D4") : "#6B6B85", boxShadow: isActive ? `0 0 20px rgba(${rgb}, 0.1)` : "none", transition: "all 0.25s ease" }}>{CATEGORY_ICONS[cat] && <span style={{ opacity: isActive ? 1 : 0.5, display: "flex" }}>{CATEGORY_ICONS[cat]}</span>}{cat === "All" ? t("templates.allWorkflows") : (CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat)}</button>); })}
            <div style={{ flex: 1 }} />
            <div ref={sortRef} style={{ position: "relative" }}>
              <button onClick={() => setShowSort(v => !v)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 18px", borderRadius: 12, cursor: "pointer", fontSize: 11.5, fontWeight: 500, color: "#8888A0", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", transition: "all 0.2s ease" }}><span style={{ color: "#3A3A50" }}>{t("templates.sort")}</span><span style={{ color: "#B0B0C8" }}>{currentSort}</span><ChevronDown size={11} style={{ color: "#55556A", transition: "transform 0.2s", transform: showSort ? "rotate(180deg)" : "rotate(0)" }} /></button>
              <AnimatePresence>
                {showSort && (<motion.div initial={{ opacity: 0, y: -8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.15 }} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 185, zIndex: 50, background: "rgba(12,14,22,0.97)", backdropFilter: "blur(24px)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden", padding: "4px 0" }}>{SORT_OPTIONS.map(opt => (<button key={opt.value} onClick={() => { setSortBy(opt.value); setShowSort(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 18px", fontSize: 12.5, color: opt.value === sortBy ? "#06B6D4" : "#B0B0C8", background: opt.value === sortBy ? "rgba(6,182,212,0.1)" : "transparent", border: "none", cursor: "pointer", transition: "background 0.15s" }}>{opt.label}</button>))}</motion.div>)}
              </AnimatePresence>
            </div>
          </div>
          {/* Dark content */}
          <div className="tpl-content" style={{ padding: "36px 32px 56px", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 800, backgroundImage: "linear-gradient(rgba(6,182,212,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.015) 1px, transparent 1px)", backgroundSize: "60px 60px", pointerEvents: "none", zIndex: 0, maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 50%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 50%, transparent 100%)" }} />
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.1 }} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32, position: "relative", zIndex: 1 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#06B6D4", boxShadow: "0 0 8px rgba(6,182,212,0.5)" }} />
              <span style={{ fontSize: 12, color: "rgba(160,175,200,0.35)", fontFamily: "var(--font-jetbrains), monospace" }}>{filtered.length} {filtered.length !== 1 ? t("templates.templates") : t("templates.template")}{activeCategory !== "All" && ` ${t("templates.inCategory")} ${CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory}`}</span>
              <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(6,182,212,0.1), transparent 50%)" }} />
            </motion.div>
            <AnimatePresence mode="wait">
              {filtered.length === 0 ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: "100px 0", textAlign: "center", position: "relative", zIndex: 1 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Building2 size={22} style={{ color: "rgba(6,182,212,0.4)" }} /></div>
                  <p style={{ fontSize: 14, color: "rgba(160,175,200,0.5)", marginBottom: 14 }}>{t("templates.noTemplates")}</p>
                  <button onClick={() => setActiveCategory("All")} style={{ fontSize: 12, color: "#06B6D4", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", padding: "8px 20px", borderRadius: 10, cursor: "pointer" }}>{t("templates.viewAll")}</button>
                </motion.div>
              ) : (
                <motion.div key={activeCategory} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }} style={{ position: "relative", zIndex: 1 }}>
                  {isFiltered ? (
                    <div style={{ marginBottom: 64 }}>
                      <DarkSectionHeader title={CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory} subtitle={`${filtered.length} templates`} icon={CATEGORY_ICONS[activeCategory] || <Building2 size={18} />} color={CATEGORY_COLORS[activeCategory] || "#06B6D4"} rgb={hexToRgb(CATEGORY_COLORS[activeCategory] || "#06B6D4")} count={filtered.length} />
                      {filtered.map((wf, i) => <DarkFeaturedTemplate key={wf.id} wf={wf} index={i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />)}
                    </div>
                  ) : (
                    <>
                      {darkQuickStart.length > 0 && (<div style={{ marginBottom: 72 }}><DarkSectionHeader title={t("dash.quickStartSection")} subtitle={t("dash.quickStartDesc")} icon={<Zap size={18} />} color="#10B981" rgb="16,185,129" count={darkQuickStart.length} />{darkQuickStart.map((wf, i) => <DarkFeaturedTemplate key={wf.id} wf={wf} index={i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />)}</div>)}
                      {darkCore.length > 0 && (<div style={{ marginBottom: 72 }}><DarkSectionHeader title={t("dash.corePipelines")} subtitle={t("dash.corePipelinesDesc")} icon={<Building2 size={18} />} color="#4F8AFF" rgb="79,138,255" count={darkCore.length} />{darkCore.map((wf, i) => <DarkFeaturedTemplate key={wf.id} wf={wf} index={quickStart.length + i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />)}</div>)}
                      {darkRest.length > 0 && (<div style={{ marginBottom: 72 }}><DarkSectionHeader title={t("dash.exploreMore")} subtitle={t("dash.exploreMoreDesc")} icon={<Sparkles size={18} />} color="#8B5CF6" rgb="139,92,246" count={darkRest.length} />{darkRest.map((wf, i) => <DarkFeaturedTemplate key={wf.id} wf={wf} index={quickStart.length + core.length + i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />)}</div>)}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div className="tpl-feedback" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
              <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.2), rgba(139,92,246,0.15), transparent)", pointerEvents: "none" }} />
              <div className="tpl-feedback-icon"><MessageSquare size={22} style={{ color: "#06B6D4" }} /></div>
              <div className="tpl-feedback-text"><div className="tpl-feedback-title">{t("dash.suggestTitle")}</div><div className="tpl-feedback-desc">{t("dash.suggestDesc")}</div></div>
              <a href="#" onClick={e => { e.preventDefault(); router.push("/dashboard/feedback"); }} className="tpl-suggest-btn">{t("dash.suggestBtn")} <ArrowRight size={14} /></a>
            </motion.div>
          </div>
        </main>
        {/* Dark theme styles */}
        <style>{`
          @keyframes tpl-float-0 { 0% { transform: translate(0, 0); opacity: 0.2; } 50% { transform: translate(20px, -60px); opacity: 0.5; } 100% { transform: translate(-10px, -120px); opacity: 0.1; } }
          @keyframes tpl-float-1 { 0% { transform: translate(0, 0); opacity: 0.15; } 50% { transform: translate(-30px, -40px); opacity: 0.4; } 100% { transform: translate(15px, -100px); opacity: 0.1; } }
          @keyframes tpl-float-2 { 0% { transform: translate(0, 0); opacity: 0.25; } 50% { transform: translate(15px, -50px); opacity: 0.45; } 100% { transform: translate(-20px, -90px); opacity: 0.05; } }
          @keyframes tpl-pulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.15); opacity: 0; } }
          .tpl-featured:hover { border-color: rgba(6,182,212,0.22) !important; box-shadow: 0 20px 80px rgba(0,0,0,0.45), 0 0 100px rgba(6,182,212,0.05) !important; }
          .tpl-featured:hover .tpl-featured-media { transform: scale(1.05); }
          .tpl-featured:hover .tpl-featured-shimmer > div { animation: tpl-shimmer-sweep 1.5s ease forwards; }
          @keyframes tpl-shimmer-sweep { 0% { opacity: 0.3; } 50% { opacity: 0.8; } 100% { opacity: 0.3; } }
          .tpl-featured-cta:hover { box-shadow: 0 0 36px rgba(6,182,212,0.2), 0 0 72px rgba(6,182,212,0.06) !important; transform: translateY(-2px) !important; border-color: rgba(6,182,212,0.5) !important; }
          .tpl-featured-cta:hover .tpl-cta-arrow { transform: translateX(4px) !important; }
          .tpl-output-badge:hover { box-shadow: 0 0 16px currentColor; transform: translateY(-1px); }
          .tpl-suggest-btn:hover { background: linear-gradient(135deg, rgba(6,182,212,0.18), rgba(139,92,246,0.1)) !important; border-color: rgba(6,182,212,0.4) !important; box-shadow: 0 0 40px rgba(6,182,212,0.12) !important; transform: translateY(-2px); }
          .tpl-feedback { margin-top: 40px; padding: 40px 36px; border-radius: 24px; position: relative; overflow: hidden; z-index: 1; background: linear-gradient(135deg, rgba(14,18,30,0.9), rgba(10,12,20,0.95)); border: 1px solid rgba(6,182,212,0.1); box-shadow: 0 12px 48px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04); display: flex; flex-direction: row; align-items: center; gap: 28px; }
          .tpl-feedback-icon { width: 56px; height: 56px; border-radius: 18px; flex-shrink: 0; background: linear-gradient(135deg, rgba(6,182,212,0.12), rgba(139,92,246,0.08)); border: 1px solid rgba(6,182,212,0.2); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 24px rgba(6,182,212,0.08); }
          .tpl-feedback-text { flex: 1; min-width: 0; }
          .tpl-feedback-title { font-size: 17px; font-weight: 700; color: #F0F2F8; margin-bottom: 6px; letter-spacing: -0.02em; }
          .tpl-feedback-desc { font-size: 13px; color: rgba(160,175,200,0.5); line-height: 1.65; }
          .tpl-suggest-btn { display: flex; align-items: center; gap: 8px; padding: 12px 28px; border-radius: 14px; flex-shrink: 0; background: linear-gradient(135deg, rgba(6,182,212,0.1), rgba(139,92,246,0.06)); border: 1px solid rgba(6,182,212,0.25); color: #06B6D4; font-size: 13px; font-weight: 700; white-space: nowrap; text-decoration: none; font-family: var(--font-jetbrains), monospace; transition: all 0.3s ease; cursor: pointer; box-shadow: 0 0 24px rgba(6,182,212,0.06); }
          @media (max-width: 768px) { .tpl-hero { min-height: 300px !important; padding: 40px 20px 28px !important; } .tpl-hero-title { font-size: 28px !important; } .tpl-hero-subtitle { font-size: 13px !important; } .tpl-stats-bar { flex-wrap: wrap !important; } .tpl-stats-bar > div { padding: 8px 14px !important; } .tpl-filter-bar { overflow-x: auto !important; flex-wrap: nowrap !important; gap: 5px !important; padding: 10px 16px !important; } .tpl-filter-chip { white-space: nowrap !important; flex-shrink: 0 !important; } .tpl-content { padding: 20px 16px 36px !important; } .tpl-featured { border-radius: 18px !important; } .tpl-featured-scene { min-height: 200px !important; } .tpl-feedback { flex-direction: column; align-items: flex-start; gap: 16px; padding: 24px 20px; border-radius: 18px; margin-top: 24px; } .tpl-feedback-icon { width: 44px; height: 44px; border-radius: 14px; } .tpl-feedback-title { font-size: 15px; } .tpl-feedback-desc { font-size: 12.5px; } .tpl-suggest-btn { width: 100%; justify-content: center; padding: 12px 20px; border-radius: 12px; } }
          @media (min-width: 769px) and (max-width: 1024px) { .tpl-hero-title { font-size: 34px !important; } }
          @media (max-width: 480px) { .tpl-hero { min-height: 260px !important; padding: 28px 16px 20px !important; } .tpl-hero-title { font-size: 24px !important; } }
        `}</style>
        {/* Dark upgrade modal */}
        <AnimatePresence>
          {upgradeModal && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setUpgradeModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 9990 }} />
              <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} style={{ position: "fixed", inset: 0, zIndex: 9991, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", padding: 16 }}>
                <div style={{ width: "100%", maxWidth: 460, borderRadius: 24, overflow: "hidden", background: "linear-gradient(180deg, #111125 0%, #0A0A18 100%)", border: "1px solid rgba(245,158,11,0.15)", boxShadow: "0 32px 100px rgba(0,0,0,0.7), 0 0 60px rgba(245,158,11,0.05)", pointerEvents: "auto" }}>
                  <div style={{ height: 3, background: "linear-gradient(90deg, #F59E0B, #EF4444, #8B5CF6, #F59E0B)" }} />
                  <div style={{ padding: "36px 32px 20px", textAlign: "center", background: "radial-gradient(ellipse at 50% 80%, rgba(245,158,11,0.06) 0%, transparent 70%)" }}>
                    <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 8, animation: "upgrade-float 3s ease-in-out infinite" }}>{"\u{1F98A}"}</div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: "#F0F2F8", letterSpacing: "-0.03em", margin: "0 0 8px", lineHeight: 1.3 }}>Whoa, easy there! {"\u{1F525}"}</h2>
                    <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.6, margin: "0 0 4px" }}><strong style={{ color: "#F59E0B" }}>&ldquo;{upgradeModal.wf.name}&rdquo;</strong> is a premium workflow &mdash; the kind that makes clients go <em style={{ color: "#10B981" }}>&ldquo;wait, you built that?!&rdquo;</em></p>
                  </div>
                  <div style={{ padding: "0 32px 24px" }}>
                    <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)", borderRadius: 16, padding: "16px 20px", marginBottom: 20 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>What you&apos;re missing out on</div>
                      {[{ icon: "\u{1F3AC}", text: "AI video walkthroughs" }, { icon: "\u{1F9CA}", text: "Interactive 3D models" }, { icon: "\u{1F3A8}", text: "Photorealistic concept renders" }, { icon: "\u26A1", text: "Up to 100 workflow runs/month" }].map((item, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}><span style={{ fontSize: 16 }}>{item.icon}</span><span style={{ fontSize: 13, color: "#C0C0D8" }}>{item.text}</span></div>))}
                    </div>
                    <button onClick={() => { setUpgradeModal(null); router.push("/dashboard/billing"); }} style={{ width: "100%", padding: "14px 24px", borderRadius: 14, background: "linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)", color: "#fff", fontSize: 15, fontWeight: 800, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 8px 32px rgba(245,158,11,0.25)", transition: "all 0.2s ease", letterSpacing: "-0.01em" }}><Zap size={18} />Upgrade &amp; Unlock This Workflow<ArrowRight size={16} /></button>
                    <button onClick={() => setUpgradeModal(null)} style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 12, background: "transparent", border: "none", color: "#55556A", fontSize: 12, cursor: "pointer", transition: "color 0.15s" }}>Nah, I&apos;ll stick with free for now {"\u{1F422}"}</button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
        <style>{`@keyframes upgrade-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }`}</style>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     LIGHT THEME — Render Studio Design System
     ═══════════════════════════════════════════════════════════════════ */

  const featuredIsLocked = featuredWf ? LOCKED_IDS.has(featuredWf.id) && userRole === "FREE" : false;
  const FeaturedIllus = featuredWf ? ILLUS_MAP[featuredWf.id] : null;

  return (
    <div className={s.page} data-theme="light">
      <main ref={mainRef} className={s.main}>

        {/* ════════════════════════ HERO ════════════════════════ */}
        <section ref={heroRef} className={s.hero}>
          <div className={s.heroInner}>
            <div className={s.heroLeft}>
              <div className={s.heroEyebrow}>
                <span className={s.heroEyebrowDot} />
                <span className={s.heroEyebrowText}>Workflow Templates</span>
              </div>
              <h1 className={s.heroTitle}>
                From brief to <em>building</em> in minutes
              </h1>
              <p className={s.heroLead}>
                {t("templates.fromBriefDesc")}
              </p>
              <div className={s.heroStats}>
                {AEC_STATS.map(stat => (
                  <div key={stat.labelKey} className={s.stat}>
                    <div className={s.statNum}><em>{stat.value}</em></div>
                    <div className={s.statLabel}>{t(stat.labelKey)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Hero moodboard (right column) ── */}
            <div className={s.heroBoard} aria-hidden="true">
              {/* Floating tag pills */}
              <div className={`${s.heroTag} ${s.heroTag1}`}>
                <span className={s.heroTagDot} />
                Photoreal in 3 min
              </div>
              <div className={`${s.heroTag} ${s.heroTag2}`}>
                <span className={`${s.heroTagDot} ${s.heroTagDotBlueprint}`} />
                QS-grade BOQ
              </div>

              {/* Moodcard 1: BOQ cost estimate */}
              <div className={`${s.moodcard} ${s.moodcard1}`}>
                <div className={s.moodcardImg}>
                  <div className={s.mood1Illus}>
                    <div className={s.mood1Card}>
                      <div className={s.mood1Label}>Total Cost</div>
                      <div className={s.mood1Num}><span className={s.mood1NumEm}>{"\u20B9"}9.03</span> Cr</div>
                      <div className={s.mood1Rows}>
                        {[
                          { name: "Concrete", val: "\u20B93.42 Cr", color: "var(--rs-blueprint)" },
                          { name: "Brick", val: "\u20B91.18 Cr", color: "var(--rs-burnt)" },
                          { name: "MEP", val: "\u20B92.84 Cr", color: "var(--rs-sage)" },
                        ].map(r => (
                          <div key={r.name} className={s.mood1Row}>
                            <div className={s.mood1RowName}><span className={s.mood1RowDot} style={{ background: r.color }} />{r.name}</div>
                            <div className={s.mood1RowVal}>{r.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className={s.moodcardMeta}>
                  <div className={s.moodcardCat}><span className={s.moodcardCatDot} style={{ background: "var(--rs-burnt)" }} />Cost Estimation</div>
                  <div className={s.moodcardTitle}>IFC &rarr; <em className={s.moodcardTitleEm}>BOQ</em></div>
                </div>
              </div>

              {/* Moodcard 2: 3D wireframe building */}
              <div className={`${s.moodcard} ${s.moodcard2}`}>
                <div className={s.moodcardImg}>
                  <div className={s.mood2Illus}>
                    <svg viewBox="0 0 280 200" fill="none">
                      <g stroke="rgba(229,168,120,.85)" strokeWidth="1.4" fill="none">
                        <polygon points="60,150 140,110 220,150 140,190" />
                        <polygon points="60,80 140,40 220,80 140,120" />
                        <line x1="60" y1="150" x2="60" y2="80" />
                        <line x1="220" y1="150" x2="220" y2="80" />
                        <line x1="140" y1="190" x2="140" y2="120" />
                        <line x1="140" y1="110" x2="140" y2="40" />
                        <line x1="60" y1="130" x2="220" y2="130" strokeOpacity=".5" strokeDasharray="3,3" />
                        <line x1="60" y1="105" x2="220" y2="105" strokeOpacity=".5" strokeDasharray="3,3" />
                      </g>
                      <g fill="rgba(229,168,120,.5)">
                        {[[60,150],[220,150],[60,80],[220,80],[140,40],[140,190]].map(([cx,cy], i) => <circle key={i} cx={cx} cy={cy} r="2.5" />)}
                      </g>
                      <text x="240" y="50" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(229,168,120,.7)" letterSpacing="2">IFC4</text>
                    </svg>
                  </div>
                </div>
                <div className={s.moodcardMeta}>
                  <div className={s.moodcardCat}><span className={s.moodcardCatDot} style={{ background: "var(--rs-ember)" }} />BIM Export</div>
                  <div className={s.moodcardTitle}>Text &rarr; <em className={s.moodcardTitleEm}>3D + IFC</em></div>
                </div>
              </div>

              {/* Moodcard 3: Floor plan */}
              <div className={`${s.moodcard} ${s.moodcard3}`}>
                <div className={s.moodcardImg}>
                  <div className={s.mood3Illus}>
                    <svg viewBox="0 0 240 130" fill="none">
                      <g stroke="var(--rs-ink)" strokeWidth="1.6" fill="none" opacity=".7">
                        <rect x="20" y="20" width="200" height="90" />
                        <line x1="120" y1="20" x2="120" y2="60" />
                        <line x1="80" y1="60" x2="220" y2="60" />
                        <line x1="120" y1="60" x2="120" y2="110" />
                      </g>
                      <g stroke="var(--rs-blueprint)" strokeWidth="1.2" fill="rgba(26,77,92,.15)">
                        <path d="M 90 20 A 12 12 0 0 1 102 32 L 90 32 Z" />
                      </g>
                      <g stroke="var(--rs-burnt)" strokeWidth="1.4">
                        <line x1="140" y1="20" x2="180" y2="20" />
                        <line x1="20" y1="40" x2="20" y2="70" />
                      </g>
                      <g fontFamily="JetBrains Mono" fontSize="6" fill="var(--rs-text)" letterSpacing="1">
                        <text x="68" y="48">LIVING</text>
                        <text x="155" y="48">KITCHEN</text>
                        <text x="68" y="92">BEDROOM</text>
                        <text x="155" y="92">BATH</text>
                      </g>
                    </svg>
                  </div>
                </div>
                <div className={s.moodcardMeta}>
                  <div className={s.moodcardCat}><span className={s.moodcardCatDot} />Concept Design</div>
                  <div className={s.moodcardTitle}>Text &rarr; <em className={s.moodcardTitleEm}>Floor Plan</em></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Brief Renders Beta (canary-gated) */}
        <BriefRendersTemplateCard />

        {/* ════════════════════════ FILTER BAR ════════════════════════ */}
        <div className={s.filterbar}>
          <div className={s.filters}>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cat === activeCategory ? s.filterChipActive : s.filterChip}
                aria-pressed={cat === activeCategory}
              >
                {CATEGORY_ICONS[cat] && <span style={{ display: "flex", opacity: cat === activeCategory ? 1 : 0.5 }}>{CATEGORY_ICONS[cat]}</span>}
                {cat === "All" ? t("templates.allWorkflows") : (CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat)}
              </button>
            ))}
          </div>
          <div ref={sortRef} className={s.sortWrap}>
            <button onClick={() => setShowSort(v => !v)} className={s.sortBtn}>
              <span className={s.sortBtnLabel}>{t("templates.sort")}</span>
              <span>{currentSort}</span>
              <ChevronDown size={11} style={{ transition: "transform 0.2s", transform: showSort ? "rotate(180deg)" : "rotate(0)" }} />
            </button>
            <AnimatePresence>
              {showSort && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className={s.sortMenu}
                >
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                      className={opt.value === sortBy ? s.sortOptionActive : s.sortOption}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ════════════════════════ CONTENT ════════════════════════ */}

        {filtered.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}><Building2 size={22} /></div>
            <p className={s.emptyText}>{t("templates.noTemplates")}</p>
            <button onClick={() => setActiveCategory("All")} className={s.emptyBtn}>{t("templates.viewAll")}</button>
          </div>
        ) : isFiltered ? (
          /* ── Filtered view: all templates in grid ── */
          <section className={s.section}>
            <div className={s.groupHeadFirst}>
              <div>
                <div className={s.groupEyebrow}>
                  <span className={s.groupEyebrowNum}>{filtered.length}</span> templates
                </div>
                <h2 className={s.groupTitle}>
                  {CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory}
                </h2>
              </div>
              <span className={s.groupCount}>{filtered.length}</span>
            </div>
            <div className={s.grid2}>
              {filtered.map((wf, i) => renderLightCard(wf, i))}
            </div>
          </section>
        ) : (
          <>
            {/* ═══════ FEATURED ═══════ */}
            {featuredWf && (
              <section className={s.featured}>
                <div
                  className={s.featuredCard}
                  role="article"
                  aria-label={featuredWf.name}
                  tabIndex={0}
                  onClick={() => handleUse(featuredWf)}
                  onKeyDown={e => { if (e.key === "Enter") handleUse(featuredWf); }}
                >
                  <div className={s.featuredIllus}>
                    {FeaturedIllus && <FeaturedIllus />}
                  </div>
                  <div className={s.featuredContent}>
                    <span className={s.featuredNum}>01</span>
                    <div className={s.featuredMeta}>
                      <span className={s.featuredCat}>{featuredWf.category}</span>
                      <span>&middot;</span>
                      <span>{featuredWf.complexity === "simple" ? t("dash.simpleLabel") : t("dash.advancedLabel")}</span>
                      <span>&middot;</span>
                      <span>{featuredWf.tileGraph.nodes.length} {t("dash.nodes")}</span>
                      <span>&middot;</span>
                      <span>{featuredWf.estimatedRunTime}</span>
                    </div>
                    {featuredIsLocked && <div className={s.lockBadge}><Lock size={9} /> PRO</div>}
                    <h2 className={s.featuredTitle}>
                      {(() => { const parts = featuredWf.name.split("\u2192").map(x => x.trim()); return parts.length >= 2 ? <>{parts[0]} <em>&rarr; {parts.slice(1).join(" \u2192 ")}</em></> : featuredWf.name; })()}
                    </h2>
                    <p className={s.featuredDesc}>{featuredWf.description}</p>
                    <div className={s.ioflow}>
                      {featuredWf.requiredInputs.map(inp => (
                        <span key={inp} className={s.ionodeInput}><Layers size={11} /> {inp}</span>
                      ))}
                      <span className={s.ioarrow}><ArrowRight size={13} /></span>
                      {featuredWf.expectedOutputs.slice(0, 3).map(out => (
                        <span key={out} className={s.ionodeOutput}><Building2 size={11} /> {out.split("(")[0].trim()}</span>
                      ))}
                    </div>
                    <button className={featuredIsLocked ? s.useBtnLocked : s.useBtn} aria-label={featuredIsLocked ? "Upgrade to unlock" : "Use this template"}>
                      {featuredIsLocked && <Lock size={14} />}
                      {featuredIsLocked ? "Upgrade to unlock" : "Use this template"}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ═══════ QUICK START ═══════ */}
            {quickStart.length > 0 && (
              <section className={s.section}>
                <div className={s.groupHeadFirst}>
                  <div>
                    <div className={s.groupEyebrow}><Zap size={11} /> Quick Start</div>
                    <h2 className={s.groupTitle}>Get started <em>fast</em></h2>
                    <p className={s.groupSub}>{t("dash.quickStartDesc")}</p>
                  </div>
                  <span className={s.groupCount}>{quickStart.length}</span>
                </div>
                <div className={s.grid2}>
                  {quickStart.map((wf, i) => renderLightCard(wf, i))}
                </div>
              </section>
            )}

            {/* ═══════ CORE PIPELINES ═══════ */}
            {core.length > 0 && (
              <section className={s.section}>
                <div className={s.groupHead}>
                  <div>
                    <div className={s.groupEyebrow}><Building2 size={11} /> Core Pipelines</div>
                    <h2 className={s.groupTitle}>Production-ready <em>workflows</em></h2>
                    <p className={s.groupSub}>{t("dash.corePipelinesDesc")}</p>
                  </div>
                  <span className={s.groupCount}>{core.length}</span>
                </div>
                <div className={s.grid2}>
                  {core.map((wf, i) => renderLightCard(wf, i + quickStart.length))}
                </div>
              </section>
            )}

            {/* ═══════ EXPLORE MORE ═══════ */}
            {rest.length > 0 && (
              <section className={s.section}>
                <div className={s.groupHead}>
                  <div>
                    <div className={s.groupEyebrow}><Sparkles size={11} /> Explore More</div>
                    <h2 className={s.groupTitle}>Specialized <em>tools</em></h2>
                    <p className={s.groupSub}>{t("dash.exploreMoreDesc")}</p>
                  </div>
                  <span className={s.groupCount}>{rest.length}</span>
                </div>
                <div className={s.grid2}>
                  {rest.map((wf, i) => renderLightCard(wf, i + quickStart.length + core.length))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ════════════════════════ CLOSER CTA ════════════════════════ */}
        <div className={s.closer}>
          <div className={s.closerInner}>
            <div className={s.closerEyebrow}>Missing a workflow?</div>
            <h3 className={s.closerTitle}>{t("dash.suggestTitle")}</h3>
            <p className={s.closerSub}>{t("dash.suggestDesc")}</p>
          </div>
          <button className={s.closerBtn} onClick={() => router.push("/dashboard/feedback")}>
            {t("dash.suggestBtn")} <ArrowRight size={14} />
          </button>
        </div>

        {/* ════════════════════════ FOOTNOTE ════════════════════════ */}
        <div className={s.footnote}>
          <span className={s.footnoteGlyph}>&mdash;</span>
          BuildFlow &middot; Render Studio
        </div>
      </main>

      {/* ════════════════════════ LIGHT UPGRADE MODAL ════════════════════════ */}
      <AnimatePresence>
        {upgradeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setUpgradeModal(null)}
              className={s.upgradeOverlay}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className={s.upgradeCenter}
            >
              <div className={s.upgradeCard}>
                <div className={s.upgradeBar} />
                <div className={s.upgradeIllus}>
                  <div className={s.upgradeEmoji}>{"\u{1F98A}"}</div>
                  <h2 className={s.upgradeH2}>Whoa, easy there!</h2>
                  <p className={s.upgradeSub}>
                    <span className={s.upgradeSubName}>&ldquo;{upgradeModal.wf.name}&rdquo;</span> is a premium workflow &mdash; the kind that makes clients go{" "}
                    <span className={s.upgradeSubPunch}>&ldquo;wait, you built that?!&rdquo;</span>
                  </p>
                </div>
                <div className={s.upgradeBody}>
                  <div className={s.upgradeFeatures}>
                    <div className={s.upgradeFeatLabel}>What you&apos;re missing out on</div>
                    {[
                      { icon: "\u{1F3AC}", text: "AI video walkthroughs" },
                      { icon: "\u{1F9CA}", text: "Interactive 3D models" },
                      { icon: "\u{1F3A8}", text: "Photorealistic concept renders" },
                      { icon: "\u26A1", text: "Up to 100 workflow runs/month" },
                    ].map((item, i) => (
                      <div key={i} className={s.upgradeFeatItem}>
                        <span className={s.upgradeFeatIcon}>{item.icon}</span>
                        <span className={s.upgradeFeatText}>{item.text}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className={s.upgradeMainBtn}
                    onClick={() => { setUpgradeModal(null); router.push("/dashboard/billing"); }}
                  >
                    <Zap size={18} />
                    Upgrade &amp; Unlock This Workflow
                    <ArrowRight size={16} />
                  </button>
                  <button className={s.upgradeDismiss} onClick={() => setUpgradeModal(null)}>
                    Nah, I&apos;ll stick with free for now {"\u{1F422}"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
