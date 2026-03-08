"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
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

// ─── Hero decoration (abstract workflow illustration) ─────────────────────────

const DECO_NODE_COLORS = [
  { color: "#3B82F6", key: "templates.inputLabel" },
  { color: "#8B5CF6", key: "templates.aiLabel" },
  { color: "#10B981", key: "templates.genLabel" },
  { color: "#F59E0B", key: "templates.exportLabel" },
];

function HeroDecoration() {
  const { t } = useLocale();
  const DECO_NODES = DECO_NODE_COLORS.map(n => ({ ...n, label: t(n.key as TranslationKey) }));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, opacity: 0.6 }}>
      {DECO_NODES.map((n, i) => (
        <React.Fragment key={i}>
          <motion.div
            animate={{ scale: [1, 1.18, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: i * 0.7 }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: `rgba(${hexToRgb(n.color)}, 0.15)`,
              border: `1px solid rgba(${hexToRgb(n.color)}, 0.4)`,
              boxShadow: `0 0 16px rgba(${hexToRgb(n.color)}, 0.3)`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.color }} />
            </div>
            <span style={{ fontSize: 9, color: n.color, fontWeight: 500 }}>{n.label}</span>
          </motion.div>
          {i < DECO_NODES.length - 1 && (
            <div style={{ width: 24, height: 1, background: "rgba(255,255,255,0.12)", marginBottom: 14, flexShrink: 0 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

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

        {/* ── Hero Section ────────────────────────────────────────────────── */}
        <div
          className="templates-hero"
          style={{
          position: "relative", overflow: "hidden",
          minHeight: 180, display: "flex", alignItems: "center",
          padding: "0 32px",
          background: "radial-gradient(ellipse at 30% 50%, rgba(79,138,255,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.06) 0%, transparent 60%), #07070D",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          {/* Left text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: "#4F8AFF",
              textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10,
            }}>
              {t('templates.startWithProven')}
            </p>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "#F0F0F5", lineHeight: 1.2, marginBottom: 8, letterSpacing: "-0.02em" }}>
              {t('templates.fromBrief')}
            </h2>
            <p style={{ fontSize: 14, color: "#7C7C96", lineHeight: 1.6, maxWidth: 440 }}>
              {t('templates.fromBriefDesc')}
            </p>
          </div>

          {/* Right decoration */}
          <div className="templates-hero-deco" style={{ flexShrink: 0, padding: "0 16px" }}>
            <HeroDecoration />
          </div>

          {/* Faint grid lines */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }} />
        </div>

        <div style={{ padding: "20px 24px" }}>

          {/* ── Filter bar ──────────────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            flexWrap: "wrap", marginBottom: 20,
          }}>
            {/* Category chips */}
            {CATEGORIES.map(cat => {
              const isActive = cat === activeCategory;
              const catColor = CATEGORY_COLORS[cat];
              const rgb = catColor ? hexToRgb(catColor) : "79, 138, 255";

              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: "5px 12px", borderRadius: 20, cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                    background: isActive
                      ? (catColor ? `rgba(${rgb}, 0.15)` : "rgba(79,138,255,0.15)")
                      : "#12121E",
                    border: isActive
                      ? `1px solid rgba(${rgb}, 0.35)`
                      : "1px solid rgba(255,255,255,0.05)",
                    color: isActive
                      ? (catColor ?? "#4F8AFF")
                      : "#8888A0",
                    transition: "all 0.12s",
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E";
                      (e.currentTarget as HTMLElement).style.color = "#C0C0D0";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.borderColor = "#1E1E2E";
                      (e.currentTarget as HTMLElement).style.color = "#8888A0";
                    }
                  }}
                >
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
                  padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                  fontSize: 11, fontWeight: 500, color: "#8888A0",
                  background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid rgba(255,255,255,0.05)",
                  transition: "border-color 0.1s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#1E1E2E"; }}
              >
                <span style={{ color: "#55556A" }}>{t('templates.sort')}</span>
                <span style={{ color: "#C0C0D0" }}>{currentSort}</span>
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
                      width: 160, zIndex: 50,
                      background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.05)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      overflow: "hidden", padding: "4px 0",
                    }}
                  >
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "7px 14px", fontSize: 12,
                          color: opt.value === sortBy ? "#4F8AFF" : "#C0C0D0",
                          background: opt.value === sortBy ? "rgba(79,138,255,0.08)" : "transparent",
                          border: "none", cursor: "pointer",
                          transition: "background 0.08s",
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

          {/* ── Results count ────────────────────────────────────────────── */}
          <div style={{ marginBottom: 16, fontSize: 11, color: "#3A3A50" }}>
            {filtered.length} {filtered.length !== 1 ? t('templates.templates') : t('templates.template')}
            {activeCategory !== "All" && ` ${t('templates.inCategory')} ${CATEGORY_LABEL_KEYS[activeCategory] ? t(CATEGORY_LABEL_KEYS[activeCategory]) : activeCategory}`}
          </div>

          {/* ── Grid ────────────────────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {filtered.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ padding: "60px 0", textAlign: "center" }}
              >
                <p style={{ fontSize: 14, color: "#3A3A50", marginBottom: 10 }}>
                  {t('templates.noTemplates')}
                </p>
                <button
                  onClick={() => setActiveCategory("All")}
                  style={{
                    fontSize: 12, color: "#4F8AFF", background: "none",
                    border: "none", cursor: "pointer",
                  }}
                >
                  {t('templates.viewAll')} →
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
                  gap: 18,
                }}
              >
                {filtered.map((wf, i) => (
                  <WorkflowCard
                    key={wf.id}
                    workflow={wf}
                    showCloneButton
                    onClone={handleUse}
                    isFeatured={wf.id === "wf-10"}
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
