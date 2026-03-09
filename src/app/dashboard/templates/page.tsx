"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Building2, Ruler, Compass, HardHat, Layers, PenTool, Triangle } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useRouter } from "next/navigation";
import type { WorkflowTemplate } from "@/types/workflow";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { awardXP } from "@/lib/award-xp";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  "All",
  "Concept Design",
  "Visualization",
  "BIM Export",
  "Cost Estimation",
  "Full Pipeline",
  "Site Analysis",
];

const CATEGORY_COLORS: Record<string, string> = {
  "Concept Design":  "#3B82F6",
  "Visualization":   "#10B981",
  "BIM Export":      "#F59E0B",
  "Cost Estimation": "#8B5CF6",
  "Full Pipeline":   "#06B6D4",
  "Site Analysis":   "#10B981",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Concept Design":  <PenTool size={11} />,
  "Visualization":   <Compass size={11} />,
  "BIM Export":      <Layers size={11} />,
  "Cost Estimation": <Ruler size={11} />,
  "Full Pipeline":   <Building2 size={11} />,
  "Site Analysis":   <Triangle size={11} />,
};

const SORT_OPTION_KEYS: Record<string, string> = {
  default: "templates.popular",
  simple: "templates.simpleFirst",
  advanced: "templates.advancedFirst",
  nodes: "templates.fewestNodes",
};

const COMPLEXITY_ORDER: Record<string, number> = { simple: 0, intermediate: 1, advanced: 2 };

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  "Concept Design": 'templates.categoryConceptDesign',
  "Visualization": 'templates.categoryVisualization',
  "BIM Export": 'templates.categoryBimExport',
  "Cost Estimation": 'templates.categoryCostEstimation',
  "Full Pipeline": 'templates.categoryFullPipeline',
  "Site Analysis": 'templates.categorySiteAnalysis',
};

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

// ─── Isometric Building Illustration (SVG) ──────────────────────────────────

function IsometricBuilding() {
  return (
    <motion.svg
      width="280"
      height="220"
      viewBox="0 0 280 220"
      fill="none"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      style={{ overflow: "visible" }}
    >
      {/* Grid floor */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <motion.line
          key={`gx-${i}`}
          x1={60 + i * 30} y1={180} x2={90 + i * 30} y2={200}
          stroke="rgba(79,138,255,0.08)" strokeWidth="0.5"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, delay: 0.1 + i * 0.05 }}
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <motion.line
          key={`gy-${i}`}
          x1={60 + i * 30} y1={180} x2={30 + i * 30} y2={200}
          stroke="rgba(79,138,255,0.08)" strokeWidth="0.5"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, delay: 0.1 + i * 0.05 }}
        />
      ))}

      {/* Building 1 — Main tower */}
      <motion.g
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
      >
        {/* Left face */}
        <path d="M80 180 L80 60 L140 30 L140 150 Z" fill="rgba(59,130,246,0.06)" stroke="rgba(59,130,246,0.25)" strokeWidth="0.8" />
        {/* Right face */}
        <path d="M140 30 L200 60 L200 180 L140 150 Z" fill="rgba(59,130,246,0.03)" stroke="rgba(59,130,246,0.2)" strokeWidth="0.8" />
        {/* Top face */}
        <path d="M80 60 L140 30 L200 60 L140 90 Z" fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.3)" strokeWidth="0.8" />

        {/* Floor lines — left face */}
        {[0, 1, 2, 3, 4].map(i => (
          <motion.line
            key={`fl-${i}`}
            x1={80} y1={80 + i * 24} x2={140} y2={50 + i * 24}
            stroke="rgba(59,130,246,0.12)" strokeWidth="0.5"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.5 + i * 0.08 }}
          />
        ))}
        {/* Floor lines — right face */}
        {[0, 1, 2, 3, 4].map(i => (
          <motion.line
            key={`fr-${i}`}
            x1={140} y1={50 + i * 24} x2={200} y2={80 + i * 24}
            stroke="rgba(59,130,246,0.1)" strokeWidth="0.5"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.5 + i * 0.08 }}
          />
        ))}

        {/* Windows — left face */}
        {[0, 1, 2, 3].map(row => (
          [0, 1].map(col => (
            <motion.rect
              key={`wl-${row}-${col}`}
              x={88 + col * 22} y={68 + row * 24}
              width={10} height={8}
              fill="rgba(79,138,255,0.12)"
              rx={1}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.1, 0.25, 0.1] }}
              transition={{ duration: 3, repeat: Infinity, delay: row * 0.3 + col * 0.15 }}
              style={{ transform: `skewY(-26.5deg)`, transformOrigin: `${88 + col * 22}px ${68 + row * 24}px` }}
            />
          ))
        ))}
      </motion.g>

      {/* Building 2 — Low-rise */}
      <motion.g
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.5, ease: "easeOut" }}
      >
        <path d="M185 180 L185 130 L220 115 L220 165 Z" fill="rgba(16,185,129,0.05)" stroke="rgba(16,185,129,0.2)" strokeWidth="0.8" />
        <path d="M220 115 L255 130 L255 180 L220 165 Z" fill="rgba(16,185,129,0.03)" stroke="rgba(16,185,129,0.15)" strokeWidth="0.8" />
        <path d="M185 130 L220 115 L255 130 L220 145 Z" fill="rgba(16,185,129,0.08)" stroke="rgba(16,185,129,0.25)" strokeWidth="0.8" />
      </motion.g>

      {/* Dimension lines */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.9 }}
      >
        {/* Vertical dimension */}
        <line x1="68" y1="60" x2="68" y2="180" stroke="rgba(245,158,11,0.2)" strokeWidth="0.5" strokeDasharray="2 2" />
        <line x1="64" y1="60" x2="72" y2="60" stroke="rgba(245,158,11,0.25)" strokeWidth="0.5" />
        <line x1="64" y1="180" x2="72" y2="180" stroke="rgba(245,158,11,0.25)" strokeWidth="0.5" />
        <text x="55" y="124" fill="rgba(245,158,11,0.3)" fontSize="7" fontFamily="monospace" textAnchor="middle" transform="rotate(-90, 55, 124)">24m</text>

        {/* Horizontal dimension */}
        <line x1="80" y1="190" x2="200" y2="190" stroke="rgba(245,158,11,0.15)" strokeWidth="0.5" strokeDasharray="2 2" />
        <text x="140" y="198" fill="rgba(245,158,11,0.25)" fontSize="7" fontFamily="monospace" textAnchor="middle">18m</text>
      </motion.g>

      {/* Compass rose */}
      <motion.g
        initial={{ opacity: 0, rotate: -90 }}
        animate={{ opacity: 1, rotate: 0 }}
        transition={{ duration: 0.8, delay: 1.1 }}
        style={{ transformOrigin: "245px 40px" }}
      >
        <circle cx="245" cy="40" r="14" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        <line x1="245" y1="28" x2="245" y2="52" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <line x1="233" y1="40" x2="257" y2="40" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <text x="245" y="25" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace" textAnchor="middle">N</text>
      </motion.g>

      {/* Crane silhouette (subtle) */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.7 }}
      >
        <line x1="30" y1="180" x2="30" y2="20" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
        <line x1="30" y1="20" x2="75" y2="20" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <line x1="75" y1="20" x2="65" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        <line x1="30" y1="20" x2="20" y2="30" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        {/* Cable */}
        <motion.line
          x1="60" y1="20" x2="60" y2="50"
          stroke="rgba(255,255,255,0.03)" strokeWidth="0.5"
          animate={{ y2: [50, 55, 50] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.g>
    </motion.svg>
  );
}

// ─── Blueprint Grid Background ──────────────────────────────────────────────

function BlueprintGrid() {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {/* Primary grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "60px 60px",
      }} />
      {/* Secondary grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.015) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.015) 1px, transparent 1px)
        `,
        backgroundSize: "12px 12px",
      }} />
      {/* Corner markers (architectural section marks) */}
      <svg style={{ position: "absolute", top: 16, left: 24, opacity: 0.15 }} width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M0 8 L0 0 L8 0" stroke="#3B82F6" strokeWidth="1" />
      </svg>
      <svg style={{ position: "absolute", top: 16, right: 24, opacity: 0.15 }} width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M16 0 L24 0 L24 8" stroke="#3B82F6" strokeWidth="1" />
      </svg>
      <svg style={{ position: "absolute", bottom: 16, left: 24, opacity: 0.15 }} width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M0 16 L0 24 L8 24" stroke="#3B82F6" strokeWidth="1" />
      </svg>
      <svg style={{ position: "absolute", bottom: 16, right: 24, opacity: 0.15 }} width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M16 24 L24 24 L24 16" stroke="#3B82F6" strokeWidth="1" />
      </svg>
    </div>
  );
}

// ─── AEC Stats Bar ──────────────────────────────────────────────────────────

const AEC_STATS = [
  { value: PREBUILT_WORKFLOWS.length.toString(), label: "Workflows", icon: <Layers size={13} /> },
  { value: "5", label: "Disciplines", icon: <HardHat size={13} /> },
  { value: "31", label: "Node Types", icon: <Building2 size={13} /> },
  { value: "IFC", label: "Native Export", icon: <Compass size={13} /> },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const { t } = useLocale();
  const [activeCategory, setActiveCategory] = useState("All");
  const [sortBy, setSortBy]       = useState("default");
  const [showSort, setShowSort]   = useState(false);

  const { loadFromTemplate } = useWorkflowStore();
  const router = useRouter();

  const filtered = useMemo(() => {
    let list = [...PREBUILT_WORKFLOWS];
    if (activeCategory !== "All") {
      list = list.filter(w => w.category === activeCategory);
    }
    if (sortBy === "simple")   list.sort((a, b) => COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity]);
    if (sortBy === "advanced") list.sort((a, b) => COMPLEXITY_ORDER[b.complexity] - COMPLEXITY_ORDER[a.complexity]);
    if (sortBy === "nodes")    list.sort((a, b) => a.tileGraph.nodes.length - b.tileGraph.nodes.length);
    return list;
  }, [activeCategory, sortBy]);

  const handleUse = (id: string) => {
    const template = PREBUILT_WORKFLOWS.find(w => w.id === id);
    if (!template) return;
    loadFromTemplate(template as WorkflowTemplate);
    toast.success(`"${template.name}" ${t('toast.cloned')}`, { description: t('toast.openingCanvas') });
    awardXP("template-cloned");
    router.push("/dashboard/canvas");
  };

  const SORT_OPTIONS = Object.entries(SORT_OPTION_KEYS).map(([value, key]) => ({ value, label: t(key as TranslationKey) }));
  const currentSort = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? t('templates.popular');

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Header
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
      />

      <main style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Hero Section — Blueprint Style ──────────────────────────── */}
        <div
          className="templates-hero"
          style={{
            position: "relative", overflow: "hidden",
            minHeight: 240, display: "flex", alignItems: "center",
            padding: "0 40px",
            background: `
              radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.08) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 30%, rgba(16,185,129,0.05) 0%, transparent 40%),
              radial-gradient(ellipse at 60% 80%, rgba(139,92,246,0.04) 0%, transparent 40%),
              linear-gradient(180deg, #060610 0%, #07070D 100%)
            `,
            borderBottom: "1px solid rgba(59,130,246,0.08)",
          }}
        >
          <BlueprintGrid />

          {/* Left content */}
          <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
            {/* Section marker */}
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                marginBottom: 16,
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                border: "1.5px solid rgba(59,130,246,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 800, color: "#3B82F6",
                fontFamily: "monospace",
              }}>
                A
              </div>
              <div style={{
                height: 1, width: 32,
                background: "linear-gradient(90deg, rgba(59,130,246,0.4), rgba(59,130,246,0))",
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, color: "rgba(59,130,246,0.6)",
                textTransform: "uppercase", letterSpacing: "2px",
                fontFamily: "monospace",
              }}>
                {t('templates.startWithProven')}
              </span>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              style={{
                fontSize: 30, fontWeight: 800, color: "#F0F0F5",
                lineHeight: 1.15, marginBottom: 10, letterSpacing: "-0.03em",
              }}
            >
              {t('templates.fromBrief')}
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              style={{
                fontSize: 14, color: "#6B6B85", lineHeight: 1.7, maxWidth: 460,
                marginBottom: 24,
              }}
            >
              {t('templates.fromBriefDesc')}
            </motion.p>

            {/* AEC Stats Bar */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              style={{
                display: "flex", gap: 2,
              }}
            >
              {AEC_STATS.map((stat, i) => (
                <div
                  key={stat.label}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 16px",
                    background: i === 0
                      ? "rgba(59,130,246,0.06)"
                      : "rgba(255,255,255,0.02)",
                    borderRadius: i === 0 ? "8px 0 0 8px" : i === AEC_STATS.length - 1 ? "0 8px 8px 0" : 0,
                    border: "1px solid rgba(255,255,255,0.04)",
                    borderRight: i < AEC_STATS.length - 1 ? "none" : undefined,
                  }}
                >
                  <span style={{ color: "rgba(59,130,246,0.4)" }}>{stat.icon}</span>
                  <div>
                    <span style={{
                      fontSize: 14, fontWeight: 700, color: "#E0E0F0",
                      fontFamily: "monospace",
                    }}>
                      {stat.value}
                    </span>
                    <span style={{
                      fontSize: 10, color: "#4A4A60", marginLeft: 5,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                    }}>
                      {stat.label}
                    </span>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right: Isometric Building */}
          <div className="templates-hero-deco" style={{ flexShrink: 0, zIndex: 1 }}>
            <IsometricBuilding />
          </div>
        </div>

        <div style={{ padding: "24px 28px 40px" }}>

          {/* ── Filter bar ──────────────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            flexWrap: "wrap", marginBottom: 24,
          }}>
            {/* Category chips with AEC icons */}
            {CATEGORIES.map(cat => {
              const isActive = cat === activeCategory;
              const catColor = CATEGORY_COLORS[cat];
              const rgb = catColor ? hexToRgb(catColor) : "79, 138, 255";
              const icon = CATEGORY_ICONS[cat];

              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                    display: "flex", alignItems: "center", gap: 5,
                    background: isActive
                      ? (catColor ? `rgba(${rgb}, 0.12)` : "rgba(79,138,255,0.12)")
                      : "rgba(255,255,255,0.02)",
                    border: isActive
                      ? `1px solid rgba(${rgb}, 0.3)`
                      : "1px solid rgba(255,255,255,0.05)",
                    color: isActive
                      ? (catColor ?? "#4F8AFF")
                      : "#6B6B85",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                      (e.currentTarget as HTMLElement).style.color = "#B0B0C8";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                      (e.currentTarget as HTMLElement).style.color = "#6B6B85";
                    }
                  }}
                >
                  {icon && <span style={{ opacity: isActive ? 1 : 0.5, display: "flex" }}>{icon}</span>}
                  {cat === "All" ? t('templates.allWorkflows') : (CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat)}
                </button>
              );
            })}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Sort dropdown */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowSort(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                  fontSize: 11, fontWeight: 500, color: "#8888A0",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                }}
              >
                <span style={{ color: "#3A3A50" }}>{t('templates.sort')}</span>
                <span style={{ color: "#B0B0C8" }}>{currentSort}</span>
                <ChevronDown size={11} style={{ color: "#55556A" }} />
              </button>

              <AnimatePresence>
                {showSort && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    style={{
                      position: "absolute", top: "calc(100% + 6px)", right: 0,
                      width: 170, zIndex: 50,
                      background: "linear-gradient(145deg, rgba(14,14,22,0.98), rgba(10,10,18,0.99))",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.06)",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                      overflow: "hidden", padding: "4px 0",
                      backdropFilter: "blur(20px)",
                    }}
                  >
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "8px 14px", fontSize: 12,
                          color: opt.value === sortBy ? "#4F8AFF" : "#B0B0C8",
                          background: opt.value === sortBy ? "rgba(79,138,255,0.08)" : "transparent",
                          border: "none", cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => {
                          if (opt.value !== sortBy) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                        }}
                        onMouseLeave={e => {
                          if (opt.value !== sortBy) (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Results count with architectural section marker ─────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            marginBottom: 20,
          }}>
            <div style={{
              width: 4, height: 4, borderRadius: "50%",
              background: "rgba(59,130,246,0.3)",
            }} />
            <span style={{ fontSize: 11, color: "#3A3A50", fontFamily: "monospace" }}>
              {filtered.length} {filtered.length !== 1 ? t('templates.templates') : t('templates.template')}
              {activeCategory !== "All" && ` ${t('templates.inCategory')} ${CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory}`}
            </span>
            <div style={{
              flex: 1, height: 1,
              background: "linear-gradient(90deg, rgba(59,130,246,0.08), transparent)",
            }} />
          </div>

          {/* ── Grid ────────────────────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {filtered.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  padding: "80px 0", textAlign: "center",
                }}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: "rgba(59,130,246,0.06)",
                  border: "1px solid rgba(59,130,246,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 16px",
                }}>
                  <Building2 size={20} style={{ color: "rgba(59,130,246,0.3)" }} />
                </div>
                <p style={{ fontSize: 14, color: "#3A3A50", marginBottom: 12 }}>
                  {t('templates.noTemplates')}
                </p>
                <button
                  onClick={() => setActiveCategory("All")}
                  style={{
                    fontSize: 12, color: "#4F8AFF", background: "rgba(79,138,255,0.08)",
                    border: "1px solid rgba(79,138,255,0.15)",
                    padding: "6px 16px", borderRadius: 6,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.15)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.08)";
                  }}
                >
                  {t('templates.viewAll')}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="templates-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 20,
                }}
              >
                {filtered.map((wf, i) => (
                  <WorkflowCard
                    key={wf.id}
                    workflow={wf}
                    showCloneButton
                    onClone={handleUse}
                    isFeatured={wf.id === "wf-14"}
                    index={i}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
