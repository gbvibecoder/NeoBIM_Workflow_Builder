"use client";

import React, { useState, useMemo, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { ChevronDown, Building2, Ruler, Compass, HardHat, Layers, PenTool, Triangle, Lock, ArrowRight, MessageSquare, Sparkles, Zap } from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useRouter } from "next/navigation";
import type { WorkflowTemplate } from "@/types/workflow";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { awardXP } from "@/lib/award-xp";

/* ── Lazy-loaded 3D scenes — three + @react-three/fiber are ~750KB,
       so split them out of the templates initial chunk. ── */
const TemplatesHeroScene = lazy(() => import("@/features/dashboard/components/TemplatesHeroScene").then(m => ({ default: m.TemplatesHeroScene })));
const CardScene3D = dynamic(() => import("@/features/dashboard/components/TemplateCardScene"), { ssr: false });

/* ── Constants ── */

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
  "wf-11": { type: "video", url: `/videos/img-to-renovation.mp4`, start: 0 },
};


/* ── SVG output illustration ── */
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

/* ═══════════════════════════════════════════════════════════════════
   FEATURED TEMPLATE — Full-width immersive card with animations
   ═══════════════════════════════════════════════════════════════════ */

// Per-workflow decorative overlay — subtle animated SVG elements hinting at the output type
function WorkflowOverlay({ wfId, color, rgb }: { wfId: string; color: string; rgb: string }) {
  const overlays: Record<string, React.ReactNode> = {
    // Floor plan → blueprint grid lines
    "wf-01": (
      <svg viewBox="0 0 120 120" fill="none" style={{ width: 120, height: 120, opacity: 0.15 }}>
        <rect x="10" y="10" width="100" height="100" stroke={color} strokeWidth="0.5" strokeDasharray="4 4"><animate attributeName="stroke-dashoffset" from="0" to="8" dur="3s" repeatCount="indefinite" /></rect>
        <line x1="10" y1="50" x2="70" y2="50" stroke={color} strokeWidth="0.5" />
        <line x1="60" y1="10" x2="60" y2="110" stroke={color} strokeWidth="0.5" />
      </svg>
    ),
    // 3D building → wireframe cube
    "wf-03": (
      <svg viewBox="0 0 100 100" fill="none" style={{ width: 100, height: 100, opacity: 0.12 }}>
        <path d="M20 70 L20 30 L50 15 L80 30 L80 70 L50 85 Z" stroke={color} strokeWidth="0.6"><animate attributeName="stroke-dasharray" values="0 200;200 0" dur="4s" repeatCount="indefinite" /></path>
        <line x1="50" y1="15" x2="50" y2="55" stroke={color} strokeWidth="0.4" opacity="0.5" />
        <line x1="20" y1="30" x2="50" y2="45" stroke={color} strokeWidth="0.4" opacity="0.5" />
      </svg>
    ),
    // Massing → parametric boxes
    "wf-04": (
      <svg viewBox="0 0 100 100" fill="none" style={{ width: 100, height: 100, opacity: 0.12 }}>
        <rect x="15" y="30" width="25" height="55" stroke={color} strokeWidth="0.5"><animate attributeName="height" values="55;50;55" dur="3s" repeatCount="indefinite" /></rect>
        <rect x="45" y="50" width="35" height="35" stroke={color} strokeWidth="0.5"><animate attributeName="height" values="35;40;35" dur="3.5s" repeatCount="indefinite" /></rect>
        <rect x="60" y="20" width="20" height="65" stroke={color} strokeWidth="0.5"><animate attributeName="height" values="65;60;65" dur="2.8s" repeatCount="indefinite" /></rect>
      </svg>
    ),
    // Render + Video → camera frame
    "wf-06": (
      <svg viewBox="0 0 100 80" fill="none" style={{ width: 100, height: 80, opacity: 0.12 }}>
        <rect x="5" y="5" width="90" height="60" rx="3" stroke={color} strokeWidth="0.6" />
        <circle cx="50" cy="35" r="15" stroke={color} strokeWidth="0.5" opacity="0.4"><animate attributeName="r" values="15;17;15" dur="3s" repeatCount="indefinite" /></circle>
        <circle cx="50" cy="35" r="4" fill={`rgba(${rgb},0.2)`} />
        <rect x="5" y="68" width="90" height="6" rx="2" fill={`rgba(${rgb},0.06)`} />
        <rect x="5" y="68" width="30" height="6" rx="2" fill={`rgba(${rgb},0.12)`}><animate attributeName="width" values="0;90;0" dur="5s" repeatCount="indefinite" /></rect>
      </svg>
    ),
    // IFC + video → document flow
    "wf-08": (
      <svg viewBox="0 0 100 80" fill="none" style={{ width: 100, height: 80, opacity: 0.12 }}>
        <rect x="5" y="10" width="30" height="40" rx="2" stroke={color} strokeWidth="0.5" />
        <line x1="10" y1="20" x2="30" y2="20" stroke={color} strokeWidth="0.3" />
        <line x1="10" y1="26" x2="28" y2="26" stroke={color} strokeWidth="0.3" />
        <line x1="10" y1="32" x2="25" y2="32" stroke={color} strokeWidth="0.3" />
        <line x1="40" y1="30" x2="55" y2="30" stroke={color} strokeWidth="0.5" strokeDasharray="2 2"><animate attributeName="stroke-dashoffset" from="0" to="4" dur="1s" repeatCount="indefinite" /></line>
        <polygon points="53,26 60,30 53,34" fill={`rgba(${rgb},0.3)`} />
        <rect x="65" y="10" width="30" height="40" rx="2" stroke={color} strokeWidth="0.5" />
        <rect x="70" y="15" width="20" height="15" rx="1" fill={`rgba(${rgb},0.06)`} />
      </svg>
    ),
    // BOQ cost → data chart
    "wf-09": (
      <svg viewBox="0 0 100 80" fill="none" style={{ width: 100, height: 80, opacity: 0.12 }}>
        {[0,1,2,3,4].map(i => (
          <rect key={i} x={10 + i * 18} y={60 - [30,45,25,50,35][i]} width="12" height={[30,45,25,50,35][i]} rx="1" fill={`rgba(${rgb},0.08)`} stroke={color} strokeWidth="0.4">
            <animate attributeName="height" values={`${[30,45,25,50,35][i]};${[35,40,30,45,40][i]};${[30,45,25,50,35][i]}`} dur={`${2.5 + i * 0.3}s`} repeatCount="indefinite" />
            <animate attributeName="y" values={`${60 - [30,45,25,50,35][i]};${60 - [35,40,30,45,40][i]};${60 - [30,45,25,50,35][i]}`} dur={`${2.5 + i * 0.3}s`} repeatCount="indefinite" />
          </rect>
        ))}
        <line x1="5" y1="62" x2="95" y2="62" stroke={color} strokeWidth="0.3" />
      </svg>
    ),
    // Interactive 3D → rotating cube indicator
    "wf-05": (
      <svg viewBox="0 0 80 80" fill="none" style={{ width: 80, height: 80, opacity: 0.12 }}>
        <g><animateTransform attributeName="transform" type="rotate" from="0 40 40" to="360 40 40" dur="20s" repeatCount="indefinite" />
          <circle cx="40" cy="40" r="30" stroke={color} strokeWidth="0.5" strokeDasharray="4 3" />
          <circle cx="40" cy="40" r="20" stroke={color} strokeWidth="0.4" strokeDasharray="3 4" />
          <circle cx="40" cy="40" r="5" fill={`rgba(${rgb},0.15)`} />
        </g>
      </svg>
    ),
    // Renovation → before/after split
    "wf-11": (
      <svg viewBox="0 0 100 60" fill="none" style={{ width: 100, height: 60, opacity: 0.12 }}>
        <rect x="5" y="5" width="42" height="50" rx="2" stroke={color} strokeWidth="0.5" opacity="0.4" />
        <text x="26" y="33" textAnchor="middle" fill={color} fontSize="6" opacity="0.5">OLD</text>
        <rect x="53" y="5" width="42" height="50" rx="2" stroke={color} strokeWidth="0.5" />
        <text x="74" y="33" textAnchor="middle" fill={color} fontSize="6" opacity="0.8">NEW</text>
        <line x1="50" y1="5" x2="50" y2="55" stroke={color} strokeWidth="0.6"><animate attributeName="x1" values="50;52;50" dur="2s" repeatCount="indefinite" /><animate attributeName="x2" values="50;52;50" dur="2s" repeatCount="indefinite" /></line>
      </svg>
    ),
    // Clash detection → intersection warning
    "wf-12": (
      <svg viewBox="0 0 80 80" fill="none" style={{ width: 80, height: 80, opacity: 0.15 }}>
        <line x1="10" y1="40" x2="70" y2="40" stroke={color} strokeWidth="2" opacity="0.4" />
        <line x1="40" y1="10" x2="40" y2="70" stroke="#F59E0B" strokeWidth="2" opacity="0.4" />
        <circle cx="40" cy="40" r="8" stroke="#EF4444" strokeWidth="1" fill="rgba(239,68,68,0.1)">
          <animate attributeName="r" values="8;12;8" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    ),
  };
  return <>{overlays[wfId] ?? null}</>;
}

function FeaturedTemplate({ wf, index, isMobile, onUse, t, userRole }: {
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
  if (eo.includes("floor plan") || eo.includes("svg")) outputBadges.push({ label: "Floor Plan", icon: "📐", color: "#14B8A6" });
  if (eo.includes("3d") || eo.includes("massing") || eo.includes("interactive")) outputBadges.push({ label: "3D Model", icon: "🧊", color: "#FFBF00" });
  if (eo.includes("render") || eo.includes("image") || eo.includes("concept")) outputBadges.push({ label: "Render", icon: "🖼", color: "#10B981" });
  if (eo.includes("video") || eo.includes("walkthrough") || eo.includes("cinematic")) outputBadges.push({ label: "Video", icon: "🎬", color: "#8B5CF6" });
  if (eo.includes("ifc") || eo.includes("bim")) outputBadges.push({ label: "IFC", icon: "📦", color: "#3B82F6" });
  if (eo.includes("boq") || eo.includes("xlsx") || eo.includes("spreadsheet") || eo.includes("quantities")) outputBadges.push({ label: "BOQ", icon: "💰", color: "#F59E0B" });

  // Hover tilt effect
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

  // Stagger variants for inner content
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.2 },
    },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
  };
  const previewVariants = {
    hidden: { opacity: 0, x: reversed ? 40 : -40, scale: 0.96 },
    visible: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const } },
  };

  return (
    <motion.div
      ref={cardRef}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      className="tpl-featured"
      onClick={() => onUse(wf)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        cursor: "pointer",
        display: "flex",
        flexDirection: isMobile ? "column" : reversed ? "row-reverse" : "row",
        marginBottom: 48,
        borderRadius: 24,
        overflow: "hidden",
        background: "linear-gradient(135deg, rgba(14,16,28,0.95) 0%, rgba(10,12,20,0.98) 100%)",
        border: `1px solid rgba(${catRgb}, 0.12)`,
        boxShadow: `0 8px 40px rgba(0,0,0,0.35), 0 0 80px rgba(${catRgb}, 0.03)`,
        transition: "border-color 0.4s, box-shadow 0.4s, transform 0.35s cubic-bezier(0.22,1,0.36,1)",
        position: "relative",
        transformStyle: "preserve-3d",
        willChange: "transform",
      }}
    >
      {/* Top shimmer line */}
      <div className="tpl-featured-shimmer" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, zIndex: 3, overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", background: `linear-gradient(90deg, transparent, ${catColor}50, transparent)` }} />
      </div>

      {/* ── Preview Side — slides in from direction ── */}
      <motion.div
        variants={previewVariants}
        className="tpl-featured-scene"
        style={{
          width: isMobile ? "100%" : "45%",
          height: isMobile ? 220 : 340,
          position: "relative",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {/* Category-colored glow behind image */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          background: `radial-gradient(ellipse at ${reversed ? "30%" : "70%"} 50%, rgba(${catRgb}, 0.12) 0%, transparent 60%)`,
          pointerEvents: "none",
        }} />

        {/* Preview image/video */}
        {(() => {
          const preview = TEMPLATE_PREVIEWS[wf.id];
          if (preview?.type === "image") return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={preview.url} alt={wf.name} loading="lazy" className="tpl-featured-media" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", position: "relative", zIndex: 1, transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)" }} />
          );
          if (preview?.type === "video") return (
            <video
              src={preview.url} muted playsInline
              onLoadedMetadata={e => { e.currentTarget.currentTime = preview.start; }}
              onMouseEnter={e => { e.currentTarget.play().catch(() => {}); }}
              onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = preview.start; }}
              className="tpl-featured-media"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", position: "relative", zIndex: 1, transition: "transform 0.7s cubic-bezier(0.22,1,0.36,1)" }}
            />
          );
          return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><Building2 size={48} style={{ color: `rgba(${catRgb}, 0.15)` }} /></div>;
        })()}

        {/* Workflow-specific animated overlay */}
        <div style={{ position: "absolute", bottom: 16, [reversed ? "left" : "right"]: 16, zIndex: 2, pointerEvents: "none" }}>
          <WorkflowOverlay wfId={wf.id} color={catColor} rgb={catRgb} />
        </div>

        {/* Fade edge toward content side */}
        {!isMobile && (
          <div style={{
            position: "absolute", top: 0, bottom: 0, zIndex: 2,
            [reversed ? "left" : "right"]: 0, width: 100,
            background: reversed
              ? "linear-gradient(90deg, rgba(10,12,20,0.98), transparent)"
              : "linear-gradient(270deg, rgba(10,12,20,0.98), transparent)",
            pointerEvents: "none",
          }} />
        )}
        {isMobile && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(transparent, rgba(10,12,20,1))", pointerEvents: "none", zIndex: 2 }} />
        )}
      </motion.div>

      {/* ── Content Side — elements stagger in ── */}
      <motion.div
        variants={containerVariants}
        style={{
          flex: 1, padding: isMobile ? "20px 24px 28px" : "32px 44px",
          display: "flex", flexDirection: "column", justifyContent: "center",
          position: "relative", zIndex: 1,
          height: isMobile ? "auto" : 340,
          overflow: "hidden",
        }}
      >
        {/* 3D Background Scene — visible behind text */}
        {!isMobile && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            opacity: 0.45,
          }}>
            <CardScene3D wfId={wf.id} />
          </div>
        )}

        {/* Text content — above 3D background */}
        <div style={{ position: "relative", zIndex: 2 }}>

        {/* Category + complexity */}
        <motion.div variants={itemVariants} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div className="tpl-featured-badge" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 12px", borderRadius: 8,
            background: `rgba(${catRgb}, 0.12)`,
            border: `1px solid rgba(${catRgb}, 0.3)`,
            boxShadow: `0 0 16px rgba(${catRgb}, 0.08)`,
          }}>
            {CATEGORY_ICONS[wf.category] && <span style={{ color: catColor, display: "flex" }}>{CATEGORY_ICONS[wf.category]}</span>}
            <span style={{ fontSize: 10, fontWeight: 700, color: catColor, letterSpacing: "0.08em", textTransform: "uppercase" }}>{wf.category}</span>
          </div>
          <span style={{ fontSize: 11, color: "rgba(160,175,200,0.4)" }}>·</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(160,175,200,0.5)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: wf.complexity === "simple" ? "#10B981" : "#F59E0B", boxShadow: wf.complexity === "simple" ? "0 0 8px rgba(16,185,129,0.5)" : "0 0 8px rgba(245,158,11,0.5)" }} />
            {wf.complexity === "simple" ? t("dash.simpleLabel") : t("dash.advancedLabel")}
          </span>
          <span style={{ fontSize: 11, color: "rgba(160,175,200,0.4)" }}>·</span>
          <span style={{ fontSize: 11, color: "rgba(160,175,200,0.4)", fontFamily: "var(--font-jetbrains), monospace" }}>{wf.tileGraph.nodes.length} {t("dash.nodes")} · {wf.estimatedRunTime}</span>
        </motion.div>

        {/* Title */}
        <motion.h3 variants={itemVariants} style={{ fontSize: 24, fontWeight: 700, color: "#F0F2F8", marginBottom: 12, letterSpacing: "-0.025em", lineHeight: 1.25 }}>
          {wf.name}
        </motion.h3>

        {/* Description */}
        <motion.p variants={itemVariants} style={{ fontSize: 13.5, color: "rgba(160,175,200,0.6)", lineHeight: 1.6, marginBottom: 16, maxWidth: 480, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
          {wf.description}
        </motion.p>

        {/* Output badges — stagger in */}
        <motion.div variants={itemVariants} style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 20 }}>
          {outputBadges.map((b, bi) => (
            <motion.span
              key={b.label}
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.4 + bi * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="tpl-output-badge"
              style={{
                fontSize: 11, fontWeight: 600, color: b.color,
                padding: "5px 14px", borderRadius: 8,
                background: `rgba(${hexToRgb(b.color)}, 0.08)`,
                border: `1px solid rgba(${hexToRgb(b.color)}, 0.2)`,
                display: "flex", alignItems: "center", gap: 5,
                transition: "box-shadow 0.3s ease",
              }}
            >
              <span style={{ fontSize: 13 }}>{b.icon}</span>
              {b.label}
            </motion.span>
          ))}
        </motion.div>

        {/* CTA button */}
        <motion.div variants={itemVariants}>
          <button
            className="tpl-featured-cta"
            style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              padding: "12px 28px", borderRadius: 14, cursor: "pointer",
              background: isLocked
                ? "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.06))"
                : `linear-gradient(135deg, rgba(${catRgb}, 0.15), rgba(${catRgb}, 0.06))`,
              border: isLocked
                ? "1px solid rgba(245,158,11,0.35)"
                : `1px solid rgba(${catRgb}, 0.3)`,
              color: "#fff", fontSize: 14, fontWeight: 700,
              transition: "all 0.3s ease",
              boxShadow: isLocked
                ? "0 0 24px rgba(245,158,11,0.1)"
                : `0 0 24px rgba(${catRgb}, 0.08)`,
              position: "relative", overflow: "hidden",
            }}
          >
            {isLocked && <Lock size={14} style={{ color: "#F59E0B", position: "relative", zIndex: 1 }} />}
            <span style={{ position: "relative", zIndex: 1 }}>{isLocked ? "Unlock Template" : "Use This Template"}</span>
            {isLocked
              ? <Sparkles size={14} style={{ color: "#F59E0B", position: "relative", zIndex: 1 }} />
              : <ArrowRight size={16} className="tpl-cta-arrow" style={{ color: catColor, position: "relative", zIndex: 1, transition: "transform 0.3s ease" }} />
            }
          </button>
        </motion.div>

        </div>{/* end text content wrapper */}
      </motion.div>
    </motion.div>
  );
}

/* eslint-disable @typescript-eslint/no-unused-vars -- CatalogCard kept for filtered views if needed later */
function CatalogCard({ wf, i, onCardClick, t, userRole }: {
  wf: WorkflowTemplate; i: number;
  onCardClick: (wf: WorkflowTemplate) => void;
  t: (key: TranslationKey) => string;
  userRole: string;
}) {
  const catColor = CATEGORY_COLORS[wf.category] ?? "#06B6D4";
  const catRgb = hexToRgb(catColor);
  const preview = TEMPLATE_PREVIEWS[wf.id];
  const nodeCount = wf.tileGraph.nodes.length;
  const isLocked = LOCKED_IDS.has(wf.id) && userRole === "FREE";
  const pipelineSteps = wf.name.split("→").map(s => s.trim());

  const outputBadges: Array<{ label: string; icon: string; color: string }> = [];
  const eo = (wf.expectedOutputs ?? []).join(" ").toLowerCase();
  if (eo.includes("floor plan") || eo.includes("svg")) outputBadges.push({ label: "Floor Plan", icon: "📐", color: "#14B8A6" });
  if (eo.includes("3d") || eo.includes("massing") || eo.includes("interactive")) outputBadges.push({ label: "3D Model", icon: "🧊", color: "#FFBF00" });
  if (eo.includes("render") || eo.includes("image") || eo.includes("concept")) outputBadges.push({ label: "Render", icon: "🖼", color: "#10B981" });
  if (eo.includes("video") || eo.includes("walkthrough") || eo.includes("cinematic")) outputBadges.push({ label: "Video", icon: "🎬", color: "#8B5CF6" });
  if (eo.includes("ifc") || eo.includes("bim")) outputBadges.push({ label: "IFC", icon: "📦", color: "#3B82F6" });
  if (eo.includes("boq") || eo.includes("xlsx") || eo.includes("spreadsheet") || eo.includes("quantities")) outputBadges.push({ label: "BOQ", icon: "💰", color: "#F59E0B" });

  return (
    <motion.div
      className="tpl-catalog-card"
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onCardClick(wf)}
      style={{
        cursor: "pointer", position: "relative",
        borderRadius: 20, overflow: "hidden",
        background: "linear-gradient(170deg, rgba(16,18,30,1) 0%, rgba(10,12,20,1) 100%)",
        border: `1px solid rgba(${catRgb}, 0.1)`,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        transition: "transform 0.5s cubic-bezier(0.22,1,0.36,1), border-color 0.3s, box-shadow 0.4s",
      }}
    >
      {/* ── Thumbnail ── */}
      <div className="tpl-catalog-thumb" style={{ position: "relative", height: 220, overflow: "hidden" }}>
        {preview?.type === "video" ? (
          <video
            src={preview.url} muted playsInline
            onLoadedMetadata={e => { e.currentTarget.currentTime = preview.start; }}
            onMouseEnter={e => { e.currentTarget.play().catch(() => {}); }}
            onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = preview.start; }}
            className="tpl-catalog-media"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.6s cubic-bezier(0.22,1,0.36,1)" }}
          />
        ) : preview?.type === "image" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={preview.url} alt={wf.name} loading="lazy" className="tpl-catalog-media" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.6s cubic-bezier(0.22,1,0.36,1)" }} />
        ) : preview?.type === "svg" ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <OutputPreviewSVG output={preview.output} color={catColor} />
          </div>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Building2 size={36} style={{ color: `rgba(${catRgb}, 0.15)` }} />
          </div>
        )}

        {/* Bottom gradient ONLY — keeps thumbnail visible */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40%", background: "linear-gradient(transparent, rgba(10,12,20,1))", pointerEvents: "none" }} />

        {/* Category badge */}
        <div style={{
          position: "absolute", top: 12, left: 12, zIndex: 2,
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 11px", borderRadius: 8,
          background: `rgba(${catRgb}, 0.15)`, backdropFilter: "blur(16px)",
          border: `1px solid rgba(${catRgb}, 0.35)`,
          boxShadow: `0 0 12px rgba(${catRgb}, 0.12)`,
        }}>
          {CATEGORY_ICONS[wf.category] && <span style={{ color: catColor, display: "flex" }}>{CATEGORY_ICONS[wf.category]}</span>}
          <span style={{ fontSize: 9, fontWeight: 800, color: catColor, letterSpacing: "0.1em", textTransform: "uppercase" }}>{wf.category}</span>
        </div>

        {/* Small "Use Template" button fades in at bottom on hover */}
        <div className="tpl-catalog-use-btn" style={{
          position: "absolute", bottom: 12, right: 12, zIndex: 3,
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 16px", borderRadius: 10,
          background: isLocked ? "rgba(245,158,11,0.2)" : `rgba(${catRgb}, 0.2)`, backdropFilter: "blur(16px)",
          border: isLocked ? "1px solid rgba(245,158,11,0.4)" : `1px solid rgba(${catRgb}, 0.4)`,
          opacity: 0, transition: "opacity 0.3s ease, transform 0.3s ease",
          transform: "translateY(6px)",
        }}>
          {isLocked && <Lock size={10} style={{ color: "#F59E0B" }} />}
          <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{isLocked ? "Unlock" : "Use Template"}</span>
          {isLocked
            ? <Sparkles size={11} style={{ color: "#F59E0B" }} />
            : <ArrowRight size={12} style={{ color: catColor }} />
          }
        </div>
      </div>

      {/* ── Separator ── */}
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, rgba(${catRgb}, 0.12), transparent)` }} />

      {/* ── Content ── */}
      <div style={{ padding: "16px 20px 20px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F2F8", marginBottom: 8, letterSpacing: "-0.015em", lineHeight: 1.3 }}>
          {wf.name}
        </div>

        {/* Pipeline flow */}
        {pipelineSteps.length >= 2 && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, flexWrap: "wrap" }}>
            {pipelineSteps.map((step, si) => (
              <span key={si} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {si > 0 && <span style={{ color: catColor, fontSize: 12, opacity: 0.6 }}>→</span>}
                <span style={{ fontSize: 11, fontWeight: 600, color: si === pipelineSteps.length - 1 ? catColor : "rgba(160,175,200,0.65)" }}>{step}</span>
              </span>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12.5, color: "rgba(160,175,200,0.5)", lineHeight: 1.6, marginBottom: 14, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
          {wf.description}
        </div>

        {/* Separator */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.04)", marginBottom: 14 }} />

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "rgba(160,175,200,0.45)", fontFamily: "var(--font-jetbrains), monospace" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: wf.complexity === "simple" ? "#10B981" : "#F59E0B", boxShadow: wf.complexity === "simple" ? "0 0 8px rgba(16,185,129,0.5)" : "0 0 8px rgba(245,158,11,0.5)" }} />
              <span style={{ color: wf.complexity === "simple" ? "rgba(16,185,129,0.7)" : "rgba(245,158,11,0.7)" }}>{wf.complexity === "simple" ? t("dash.simpleLabel") : t("dash.advancedLabel")}</span>
            </span>
            <span style={{ color: "rgba(255,255,255,0.06)" }}>|</span>
            <span>{nodeCount} {t("dash.nodes")}</span>
            <span style={{ color: "rgba(255,255,255,0.06)" }}>|</span>
            <span>{wf.estimatedRunTime}</span>
          </div>
          <div className="tpl-catalog-arrow" style={{
            width: 28, height: 28, borderRadius: 8,
            background: `rgba(${catRgb}, 0.06)`, border: `1px solid rgba(${catRgb}, 0.1)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.3s ease",
          }}>
            <ArrowRight size={13} style={{ color: `rgba(${catRgb}, 0.4)`, transition: "all 0.3s ease" }} />
          </div>
        </div>
      </div>

      {/* PRO badge — small corner badge, NO blur, thumbnail stays fully visible */}
      {isLocked && (
        <>
          {/* Small PRO badge in top-right of thumbnail */}
          <div style={{
            position: "absolute", top: 12, right: 12, zIndex: 11,
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 8,
            background: "rgba(245,158,11,0.15)", backdropFilter: "blur(12px)",
            border: "1px solid rgba(245,158,11,0.35)",
            boxShadow: "0 0 12px rgba(245,158,11,0.1)",
          }}>
            <Lock size={10} style={{ color: "#F59E0B" }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: "#F59E0B", letterSpacing: "0.08em", fontFamily: "var(--font-jetbrains), monospace" }}>PRO</span>
          </div>
          {/* Subtle "Upgrade to unlock" text in footer area */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 11,
            padding: "6px 0", textAlign: "center",
            background: "linear-gradient(transparent, rgba(245,158,11,0.04))",
            borderTop: "1px solid rgba(245,158,11,0.08)",
            borderRadius: "0 0 20px 20px",
          }}>
            <span style={{ fontSize: 10, color: "rgba(245,158,11,0.6)", fontFamily: "var(--font-jetbrains), monospace" }}>{t("dash.clickToUpgrade")}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════ */

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

  useEffect(() => { setIsMobile(window.innerWidth < 768); }, []);

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

  const { loadFromTemplate } = useWorkflowStore();
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
    toast.success(`"${template.name}" ${t("toast.cloned")}`, { description: t("toast.openingCanvas") });
    awardXP("template-cloned");
    router.push("/dashboard/canvas");
  };

  const SORT_OPTIONS = Object.entries(SORT_OPTION_KEYS).map(([value, key]) => ({ value, label: t(key as TranslationKey) }));
  const currentSort = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? t("templates.popular");

  // Split templates
  const quickStart = filtered.filter(w => QUICK_START_IDS.includes(w.id));
  const core = filtered.filter(w => CORE_IDS.includes(w.id) && !QUICK_START_IDS.includes(w.id));
  const rest = filtered.filter(w => !QUICK_START_IDS.includes(w.id) && !CORE_IDS.includes(w.id));
  const isFiltered = activeCategory !== "All";

  function SectionHeader({ title, subtitle, icon, color, rgb, count }: { title: string; subtitle: string; icon: React.ReactNode; color: string; rgb: string; count: number }) {
    return (
      <div style={{ marginBottom: 40, position: "relative" }}>
        {/* Ambient glow behind section */}
        <div style={{
          position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)",
          width: 500, height: 200, borderRadius: "50%",
          background: `radial-gradient(ellipse, rgba(${rgb}, 0.035) 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />

        {/* Gradient line — draws itself */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          whileInView={{ scaleX: 1, opacity: 1 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: 1, maxWidth: 280, margin: "0 auto 32px", background: `linear-gradient(90deg, transparent, rgba(${rgb}, 0.5), rgba(139,92,246,0.2), transparent)`, transformOrigin: "center" }}
        />

        {/* Header row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: "flex", alignItems: "center", gap: 16, position: "relative", zIndex: 1 }}
        >
          {/* Icon with pulse ring */}
          <div className="tpl-section-icon" style={{
            width: 48, height: 48, borderRadius: 16, position: "relative",
            background: `linear-gradient(135deg, rgba(${rgb}, 0.18), rgba(${rgb}, 0.05))`,
            border: `1px solid rgba(${rgb}, 0.3)`,
            display: "flex", alignItems: "center", justifyContent: "center", color,
            boxShadow: `0 0 28px rgba(${rgb}, 0.15), inset 0 1px 0 rgba(255,255,255,0.06)`,
          }}>
            {icon}
            {/* Pulse ring */}
            <div style={{
              position: "absolute", inset: -4, borderRadius: 20,
              border: `1px solid rgba(${rgb}, 0.15)`,
              animation: "tpl-pulse 3s ease-in-out infinite",
              pointerEvents: "none",
            }} />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#F0F2F8", letterSpacing: "-0.025em" }}>{title}</div>
            <div style={{ fontSize: 13, color: "rgba(160,175,200,0.45)", marginTop: 4 }}>{subtitle}</div>
          </div>

          {/* Count badge */}
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3, type: "spring", stiffness: 200 }}
            style={{
              width: 38, height: 38, borderRadius: 12,
              background: `rgba(${rgb}, 0.1)`, border: `1px solid rgba(${rgb}, 0.22)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color, boxShadow: `0 0 16px rgba(${rgb}, 0.08)`,
            }}
          >{count}</motion.div>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <main ref={mainRef} style={{ flex: 1, overflowY: "auto" }}>

        {/* ════════════════════════════ HERO ════════════════════════════ */}
        <div ref={heroRef} className="tpl-hero" style={{
          position: "relative", overflow: "hidden", minHeight: 420,
          display: "flex", alignItems: "center", padding: "60px 48px 40px",
          background: "radial-gradient(ellipse at 30% 40%, rgba(6,182,212,0.1) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(139,92,246,0.08) 0%, transparent 50%), linear-gradient(180deg, #060610 0%, #07070D 100%)",
        }}>
          <Suspense fallback={<div style={{ position: "absolute", inset: 0, background: "#07070D" }} />}>
            <TemplatesHeroScene />
          </Suspense>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 120, background: "linear-gradient(transparent, #07070D)", zIndex: 1, pointerEvents: "none" }} />

          <motion.div initial="hidden" animate="visible" variants={stagger} style={{ position: "relative", zIndex: 2, maxWidth: 640 }}>
            <motion.div variants={fadeInUp} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 36, height: 2, background: "linear-gradient(90deg, #06B6D4, rgba(139,92,246,0.6))", borderRadius: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(6,182,212,0.8)", textTransform: "uppercase", letterSpacing: "3px", fontFamily: "var(--font-jetbrains), monospace" }}>{t("templates.startWithProven")}</span>
            </motion.div>
            <motion.h1 className="tpl-hero-title" variants={fadeInUp} transition={{ duration: 0.7, delay: 0.1 }} style={{ fontSize: 42, fontWeight: 800, color: "#F0F0F5", lineHeight: 1.1, marginBottom: 16, letterSpacing: "-0.035em", textShadow: "0 0 60px rgba(6,182,212,0.15)" }}>{t("templates.fromBrief")}</motion.h1>
            <motion.p className="tpl-hero-subtitle" variants={fadeInUp} transition={{ duration: 0.7, delay: 0.2 }} style={{ fontSize: 15, color: "rgba(160,170,200,0.7)", lineHeight: 1.7, maxWidth: 480, marginBottom: 32 }}>{t("templates.fromBriefDesc")}</motion.p>
            <motion.div className="tpl-stats-bar" variants={fadeInUp} transition={{ duration: 0.7, delay: 0.35 }} style={{ display: "inline-flex", background: "rgba(10,12,20,0.5)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden" }}>
              {AEC_STATS.map((stat, i) => (
                <div key={stat.labelKey} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderRight: i < AEC_STATS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                  <span style={{ color: "rgba(6,182,212,0.5)", display: "flex" }}>{stat.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#E0E0F0", fontFamily: "var(--font-jetbrains), monospace" }}>{stat.value}</span>
                  <span style={{ fontSize: 10, color: "rgba(160,170,200,0.4)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{t(stat.labelKey)}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>

        {/* ════════════════════════════ FILTER BAR ════════════════════════════ */}
        <div className="tpl-filter-bar" style={{
          position: "sticky", top: 0, zIndex: 20, padding: "14px 32px",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          background: isSticky ? "rgba(7,7,13,0.92)" : "rgba(7,7,13,0.5)",
          backdropFilter: isSticky ? "blur(24px)" : "blur(10px)",
          borderBottom: isSticky ? "1px solid rgba(6,182,212,0.06)" : "1px solid transparent",
          boxShadow: isSticky ? "0 8px 32px rgba(0,0,0,0.3)" : "none",
          transition: "all 0.35s ease",
        }}>
          {CATEGORIES.map(cat => {
            const isActive = cat === activeCategory;
            const cc = CATEGORY_COLORS[cat]; const rgb = cc ? hexToRgb(cc) : "6, 182, 212";
            return (
              <button key={cat} onClick={() => setActiveCategory(cat)} className="tpl-filter-chip" style={{
                padding: "8px 18px", borderRadius: 12, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                background: isActive ? `rgba(${rgb}, 0.15)` : "rgba(255,255,255,0.03)",
                border: isActive ? `1px solid rgba(${rgb}, 0.4)` : "1px solid rgba(255,255,255,0.06)",
                color: isActive ? (cc ?? "#06B6D4") : "#6B6B85",
                boxShadow: isActive ? `0 0 20px rgba(${rgb}, 0.1)` : "none",
                transition: "all 0.25s ease",
              }}
                onMouseEnter={e => { if (!isActive) { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.15)"; el.style.background = "rgba(255,255,255,0.06)"; el.style.color = "#C0C0D8"; } }}
                onMouseLeave={e => { if (!isActive) { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.06)"; el.style.background = "rgba(255,255,255,0.03)"; el.style.color = "#6B6B85"; } }}
              >
                {CATEGORY_ICONS[cat] && <span style={{ opacity: isActive ? 1 : 0.5, display: "flex" }}>{CATEGORY_ICONS[cat]}</span>}
                {cat === "All" ? t("templates.allWorkflows") : (CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat)}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <div ref={sortRef} style={{ position: "relative" }}>
            <button onClick={() => setShowSort(v => !v)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "8px 18px", borderRadius: 12, cursor: "pointer",
              fontSize: 11.5, fontWeight: 500, color: "#8888A0", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", transition: "all 0.2s ease",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
            >
              <span style={{ color: "#3A3A50" }}>{t("templates.sort")}</span>
              <span style={{ color: "#B0B0C8" }}>{currentSort}</span>
              <ChevronDown size={11} style={{ color: "#55556A", transition: "transform 0.2s", transform: showSort ? "rotate(180deg)" : "rotate(0)" }} />
            </button>
            <AnimatePresence>
              {showSort && (
                <motion.div initial={{ opacity: 0, y: -8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.15 }} style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0, width: 185, zIndex: 50,
                  background: "rgba(12,14,22,0.97)", backdropFilter: "blur(24px)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden", padding: "4px 0",
                }}>
                  {SORT_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => { setSortBy(opt.value); setShowSort(false); }} style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 18px", fontSize: 12.5,
                      color: opt.value === sortBy ? "#06B6D4" : "#B0B0C8",
                      background: opt.value === sortBy ? "rgba(6,182,212,0.1)" : "transparent",
                      border: "none", cursor: "pointer", transition: "background 0.15s",
                    }}
                      onMouseEnter={e => { if (opt.value !== sortBy) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
                      onMouseLeave={e => { if (opt.value !== sortBy) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >{opt.label}</button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ════════════════════════════ CONTENT ════════════════════════════ */}
        <div className="tpl-content" style={{ padding: "36px 32px 56px", position: "relative" }}>

          {/* Background grid — fades down */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 800,
            backgroundImage: "linear-gradient(rgba(6,182,212,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.015) 1px, transparent 1px)",
            backgroundSize: "60px 60px", pointerEvents: "none", zIndex: 0,
            maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 50%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 50%, transparent 100%)",
          }} />

          {/* Floating ambient particles — visible */}
          <div className="tpl-particles" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} style={{
                position: "absolute",
                width: 3 + (i % 3) * 1.5,
                height: 3 + (i % 3) * 1.5,
                borderRadius: "50%",
                background: i % 4 === 0 ? "rgba(6,182,212,0.5)" : i % 4 === 1 ? "rgba(139,92,246,0.45)" : i % 4 === 2 ? "rgba(79,138,255,0.4)" : "rgba(16,185,129,0.4)",
                left: `${(i * 2.6 + 1) % 97}%`,
                top: `${(i * 5.3 + 2) % 96}%`,
                animation: `tpl-float-${i % 3} ${10 + (i % 5) * 3}s ease-in-out infinite`,
                animationDelay: `${i * 0.5}s`,
              }} />
            ))}
          </div>

          {/* Results count */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.1 }} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32, position: "relative", zIndex: 1 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#06B6D4", boxShadow: "0 0 8px rgba(6,182,212,0.5)" }} />
            <span style={{ fontSize: 12, color: "rgba(160,175,200,0.35)", fontFamily: "var(--font-jetbrains), monospace" }}>
              {filtered.length} {filtered.length !== 1 ? t("templates.templates") : t("templates.template")}
              {activeCategory !== "All" && ` ${t("templates.inCategory")} ${CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory}`}
            </span>
            <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(6,182,212,0.1), transparent 50%)" }} />
          </motion.div>

          <AnimatePresence mode="wait">
            {filtered.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: "100px 0", textAlign: "center", position: "relative", zIndex: 1 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Building2 size={22} style={{ color: "rgba(6,182,212,0.4)" }} />
                </div>
                <p style={{ fontSize: 14, color: "rgba(160,175,200,0.5)", marginBottom: 14 }}>{t("templates.noTemplates")}</p>
                <button onClick={() => setActiveCategory("All")} style={{ fontSize: 12, color: "#06B6D4", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", padding: "8px 20px", borderRadius: 10, cursor: "pointer" }}>{t("templates.viewAll")}</button>
              </motion.div>
            ) : (
              <motion.div key={activeCategory} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }} style={{ position: "relative", zIndex: 1 }}>

                {isFiltered ? (
                  /* ── Filtered: full-width immersive layout ── */
                  <div style={{ marginBottom: 64 }}>
                    <SectionHeader
                      title={CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory}
                      subtitle={`${filtered.length} templates`}
                      icon={CATEGORY_ICONS[activeCategory] || <Building2 size={18} />}
                      color={CATEGORY_COLORS[activeCategory] || "#06B6D4"}
                      rgb={hexToRgb(CATEGORY_COLORS[activeCategory] || "#06B6D4")}
                      count={filtered.length}
                    />
                    {filtered.map((wf, i) => (
                      <FeaturedTemplate key={wf.id} wf={wf} index={i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* ═══════ FEATURED — Full-width immersive ═══════ */}
                    {quickStart.length > 0 && (
                      <div style={{ marginBottom: 72 }}>
                        <SectionHeader
                          title={t("dash.quickStartSection")} subtitle={t("dash.quickStartDesc")}
                          icon={<Zap size={18} />} color="#10B981" rgb="16,185,129" count={quickStart.length}
                        />
                        {quickStart.map((wf, i) => (
                          <FeaturedTemplate key={wf.id} wf={wf} index={i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />
                        ))}
                      </div>
                    )}

                    {/* ═══════ CORE PIPELINES — Full-width immersive ═══════ */}
                    {core.length > 0 && (
                      <div style={{ marginBottom: 72 }}>
                        <SectionHeader
                          title={t("dash.corePipelines")} subtitle={t("dash.corePipelinesDesc")}
                          icon={<Building2 size={18} />} color="#4F8AFF" rgb="79,138,255" count={core.length}
                        />
                        {core.map((wf, i) => (
                          <FeaturedTemplate key={wf.id} wf={wf} index={quickStart.length + i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />
                        ))}
                      </div>
                    )}

                    {/* ═══════ EXPLORE MORE — Full-width immersive ═══════ */}
                    {rest.length > 0 && (
                      <div style={{ marginBottom: 72 }}>
                        <SectionHeader
                          title={t("dash.exploreMore")} subtitle={t("dash.exploreMoreDesc")}
                          icon={<Sparkles size={18} />} color="#8B5CF6" rgb="139,92,246" count={rest.length}
                        />
                        {rest.map((wf, i) => (
                          <FeaturedTemplate key={wf.id} wf={wf} index={quickStart.length + core.length + i} isMobile={isMobile} onUse={handleUse} t={t} userRole={userRole} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ════════════════════════════ FEEDBACK ════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{
              marginTop: 40, padding: "40px 36px", borderRadius: 24, position: "relative", overflow: "hidden", zIndex: 1,
              background: "linear-gradient(135deg, rgba(14,18,30,0.9), rgba(10,12,20,0.95))",
              border: "1px solid rgba(6,182,212,0.1)",
              display: "flex", alignItems: "center", gap: 28,
              boxShadow: "0 12px 48px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.2), rgba(139,92,246,0.15), transparent)", pointerEvents: "none" }} />
            <div style={{
              width: 56, height: 56, borderRadius: 18, flexShrink: 0,
              background: "linear-gradient(135deg, rgba(6,182,212,0.12), rgba(139,92,246,0.08))",
              border: "1px solid rgba(6,182,212,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px rgba(6,182,212,0.08)",
            }}>
              <MessageSquare size={22} style={{ color: "#06B6D4" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#F0F2F8", marginBottom: 6, letterSpacing: "-0.02em" }}>{t("dash.suggestTitle")}</div>
              <div style={{ fontSize: 13, color: "rgba(160,175,200,0.5)", lineHeight: 1.65 }}>{t("dash.suggestDesc")}</div>
            </div>
            <a href="#" onClick={e => { e.preventDefault(); router.push("/dashboard/feedback"); }} className="tpl-suggest-btn" style={{
              display: "flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg, rgba(6,182,212,0.1), rgba(139,92,246,0.06))",
              border: "1px solid rgba(6,182,212,0.25)", color: "#06B6D4", fontSize: 13, fontWeight: 700,
              textDecoration: "none", fontFamily: "var(--font-jetbrains), monospace",
              transition: "all 0.3s ease", cursor: "pointer", boxShadow: "0 0 24px rgba(6,182,212,0.06)",
            }}>
              {t("dash.suggestBtn")} <ArrowRight size={14} />
            </a>
          </motion.div>
        </div>
      </main>

      {/* ════════════════════════════ STYLES ════════════════════════════ */}
      <style>{`
        /* ── Floating particles ── */
        @keyframes tpl-float-0 {
          0% { transform: translate(0, 0); opacity: 0.2; }
          50% { transform: translate(20px, -60px); opacity: 0.5; }
          100% { transform: translate(-10px, -120px); opacity: 0.1; }
        }
        @keyframes tpl-float-1 {
          0% { transform: translate(0, 0); opacity: 0.15; }
          50% { transform: translate(-30px, -40px); opacity: 0.4; }
          100% { transform: translate(15px, -100px); opacity: 0.1; }
        }
        @keyframes tpl-float-2 {
          0% { transform: translate(0, 0); opacity: 0.25; }
          50% { transform: translate(15px, -50px); opacity: 0.45; }
          100% { transform: translate(-20px, -90px); opacity: 0.05; }
        }

        /* ── Section icon pulse ring ── */
        @keyframes tpl-pulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0; }
        }

        /* ── Featured card hover ── */
        .tpl-featured:hover {
          border-color: rgba(6,182,212,0.22) !important;
          box-shadow: 0 20px 80px rgba(0,0,0,0.45), 0 0 100px rgba(6,182,212,0.05) !important;
        }
        .tpl-featured:hover .tpl-featured-media {
          transform: scale(1.05);
        }
        .tpl-featured:hover .tpl-featured-shimmer > div {
          animation: tpl-shimmer-sweep 1.5s ease forwards;
        }
        @keyframes tpl-shimmer-sweep {
          0% { opacity: 0.3; }
          50% { opacity: 0.8; }
          100% { opacity: 0.3; }
        }

        /* ── CTA button hover ── */
        .tpl-featured-cta:hover {
          box-shadow: 0 0 36px rgba(6,182,212,0.2), 0 0 72px rgba(6,182,212,0.06) !important;
          transform: translateY(-2px) !important;
          border-color: rgba(6,182,212,0.5) !important;
        }
        .tpl-featured-cta:hover .tpl-cta-arrow {
          transform: translateX(4px) !important;
        }

        /* ── Output badge hover ── */
        .tpl-output-badge:hover {
          box-shadow: 0 0 16px currentColor;
          transform: translateY(-1px);
        }

        /* ── Suggest button hover ── */
        .tpl-suggest-btn:hover {
          background: linear-gradient(135deg, rgba(6,182,212,0.18), rgba(139,92,246,0.1)) !important;
          border-color: rgba(6,182,212,0.4) !important;
          box-shadow: 0 0 40px rgba(6,182,212,0.12) !important;
          transform: translateY(-2px);
        }

        /* ── Mobile ── */
        @media (max-width: 768px) {
          .tpl-hero { min-height: 300px !important; padding: 40px 20px 28px !important; }
          .tpl-hero-title { font-size: 28px !important; }
          .tpl-hero-subtitle { font-size: 13px !important; }
          .tpl-stats-bar { flex-wrap: wrap !important; }
          .tpl-stats-bar > div { padding: 8px 14px !important; }
          .tpl-filter-bar { overflow-x: auto !important; flex-wrap: nowrap !important; gap: 5px !important; padding: 10px 16px !important; }
          .tpl-filter-chip { white-space: nowrap !important; flex-shrink: 0 !important; }
          .tpl-content { padding: 20px 16px 36px !important; }
          .tpl-featured { border-radius: 18px !important; }
          .tpl-featured-scene { min-height: 200px !important; }
          .tpl-particles { display: none !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .tpl-hero-title { font-size: 34px !important; }
        }
        @media (max-width: 480px) {
          .tpl-hero { min-height: 260px !important; padding: 28px 16px 20px !important; }
          .tpl-hero-title { font-size: 24px !important; }
        }


        /* ── Upgrade modal animations ── */
        @keyframes upgrade-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes upgrade-shake {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-3deg); }
          75% { transform: rotate(3deg); }
        }
        @keyframes upgrade-sparkle {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>

      {/* ════════════════════════════ CREATIVE UPGRADE MODAL ════════════════════════════ */}
      <AnimatePresence>
        {upgradeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setUpgradeModal(null)}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(0,0,0,0.7)",
                backdropFilter: "blur(8px)",
                zIndex: 9990,
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: "fixed", inset: 0, zIndex: 9991,
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none", padding: 16,
              }}
            >
              <div style={{
                width: "100%", maxWidth: 460, borderRadius: 24, overflow: "hidden",
                background: "linear-gradient(180deg, #111125 0%, #0A0A18 100%)",
                border: "1px solid rgba(245,158,11,0.15)",
                boxShadow: "0 32px 100px rgba(0,0,0,0.7), 0 0 60px rgba(245,158,11,0.05)",
                pointerEvents: "auto",
              }}>
                {/* Top gradient bar */}
                <div style={{ height: 3, background: "linear-gradient(90deg, #F59E0B, #EF4444, #8B5CF6, #F59E0B)" }} />

                {/* Illustration area */}
                <div style={{
                  padding: "36px 32px 20px", textAlign: "center",
                  background: "radial-gradient(ellipse at 50% 80%, rgba(245,158,11,0.06) 0%, transparent 70%)",
                }}>
                  {/* Fun animated character */}
                  <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 8, animation: "upgrade-float 3s ease-in-out infinite" }}>
                    🦊
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
                    {["✨", "⭐", "💎", "⭐", "✨"].map((s, i) => (
                      <span key={i} style={{
                        fontSize: 14, opacity: 0.6,
                        animation: `upgrade-sparkle 2s ease-in-out infinite`,
                        animationDelay: `${i * 0.3}s`,
                      }}>{s}</span>
                    ))}
                  </div>

                  {/* Sarcastic headline */}
                  <h2 style={{
                    fontSize: 22, fontWeight: 800, color: "#F0F2F8",
                    letterSpacing: "-0.03em", margin: "0 0 8px",
                    lineHeight: 1.3,
                  }}>
                    Whoa, easy there! 🔥
                  </h2>
                  <p style={{
                    fontSize: 14, color: "#9898B0", lineHeight: 1.6, margin: "0 0 4px",
                  }}>
                    <strong style={{ color: "#F59E0B" }}>&ldquo;{upgradeModal.wf.name}&rdquo;</strong> is a
                    premium workflow — the kind that makes clients go{" "}
                    <em style={{ color: "#10B981" }}>&ldquo;wait, you built that?!&rdquo;</em>
                  </p>
                </div>

                {/* What you'll unlock */}
                <div style={{ padding: "0 32px 24px" }}>
                  <div style={{
                    background: "rgba(245,158,11,0.04)",
                    border: "1px solid rgba(245,158,11,0.1)",
                    borderRadius: 16, padding: "16px 20px",
                    marginBottom: 20,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>
                      What you&apos;re missing out on
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {[
                        { icon: "🎬", text: "AI video walkthroughs" },
                        { icon: "🧊", text: "Interactive 3D models" },
                        { icon: "🎨", text: "Photorealistic concept renders" },
                        { icon: "⚡", text: "Up to 100 workflow runs/month" },
                      ].map((item, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 16 }}>{item.icon}</span>
                          <span style={{ fontSize: 13, color: "#C0C0D8" }}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* CTA buttons */}
                  <button
                    onClick={() => { setUpgradeModal(null); router.push("/dashboard/billing"); }}
                    style={{
                      width: "100%", padding: "14px 24px", borderRadius: 14,
                      background: "linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)",
                      color: "#fff", fontSize: 15, fontWeight: 800, border: "none",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                      boxShadow: "0 8px 32px rgba(245,158,11,0.25)",
                      transition: "all 0.2s ease",
                      letterSpacing: "-0.01em",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 40px rgba(245,158,11,0.35)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(245,158,11,0.25)"; }}
                  >
                    <Zap size={18} />
                    Upgrade & Unlock This Workflow
                    <ArrowRight size={16} />
                  </button>

                  <button
                    onClick={() => setUpgradeModal(null)}
                    style={{
                      width: "100%", marginTop: 10, padding: "10px", borderRadius: 12,
                      background: "transparent", border: "none",
                      color: "#55556A", fontSize: 12, cursor: "pointer",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#9898B0"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "#55556A"; }}
                  >
                    Nah, I&apos;ll stick with free for now 🐢
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
