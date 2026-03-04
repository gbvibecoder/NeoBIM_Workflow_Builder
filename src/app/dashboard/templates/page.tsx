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

const SORT_OPTIONS = [
  { value: "default", label: "Popular" },
  { value: "simple",  label: "Simple first" },
  { value: "advanced",label: "Advanced first" },
  { value: "nodes",   label: "Fewest nodes" },
];

const COMPLEXITY_ORDER: Record<string, number> = { simple: 0, intermediate: 1, advanced: 2 };

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

// ─── Hero decoration (abstract workflow illustration) ─────────────────────────

const DECO_NODES = [
  { color: "#3B82F6", label: "Input" },
  { color: "#8B5CF6", label: "AI" },
  { color: "#10B981", label: "Gen" },
  { color: "#F59E0B", label: "Export" },
];

function HeroDecoration() {
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
    toast.success(`"${template.name}" cloned`, { description: "Opening in canvas…" });
    router.push("/dashboard/canvas");
  };

  const currentSort = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? "Popular";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Header
        title="Workflow Templates"
        subtitle={`${PREBUILT_WORKFLOWS.length} prebuilt AEC workflows ready to run`}
      />

      <main style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Hero Section ────────────────────────────────────────────────── */}
        <div style={{
          position: "relative", overflow: "hidden",
          minHeight: 180, display: "flex", alignItems: "center",
          padding: "0 32px",
          background: "radial-gradient(ellipse at 30% 50%, rgba(79,138,255,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.06) 0%, transparent 60%), #07070D",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          {/* Left text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: "#4F8AFF",
              textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10,
            }}>
              Start with a proven workflow
            </p>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "#F0F0F5", lineHeight: 1.2, marginBottom: 8 }}>
              From brief to building<br />in minutes
            </h2>
            <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.6, maxWidth: 440 }}>
              Pre-built by AEC experts. Clone, customize, and run in seconds — no configuration needed.
            </p>
          </div>

          {/* Right decoration */}
          <div style={{ flexShrink: 0, padding: "0 16px" }}>
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
                      : "1px solid rgba(255,255,255,0.06)",
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
                  {cat === "All" ? "All Workflows" : cat}
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
                  background: "#12121E", border: "1px solid rgba(255,255,255,0.06)",
                  transition: "border-color 0.1s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#1E1E2E"; }}
              >
                <span style={{ color: "#55556A" }}>Sort:</span>
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
                      background: "#12121E", borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.06)",
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
            {filtered.length} template{filtered.length !== 1 ? "s" : ""}
            {activeCategory !== "All" && ` in ${activeCategory}`}
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
                  No templates in this category
                </p>
                <button
                  onClick={() => setActiveCategory("All")}
                  style={{
                    fontSize: 12, color: "#4F8AFF", background: "none",
                    border: "none", cursor: "pointer",
                  }}
                >
                  View all templates →
                </button>
              </motion.div>
            ) : (
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
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
