"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, TrendingUp, Star, GitFork, Clock, Upload, X, ChevronDown } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useRouter } from "next/navigation";
import type { WorkflowTemplate } from "@/types/workflow";
import { useLocale } from "@/hooks/useLocale";
import { awardXP } from "@/lib/award-xp";

// ─── Mock community data ──────────────────────────────────────────────────────

interface CommunityWorkflow extends WorkflowTemplate {
  authorName: string;
  publishedAt: string;
  ratingAvg: number;
  cloneCount: number;
}

// Extend prebuilts with community data
const BASE: CommunityWorkflow[] = [
  { ...PREBUILT_WORKFLOWS[0], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
  { ...PREBUILT_WORKFLOWS[1], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
  { ...PREBUILT_WORKFLOWS[2], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
  { ...PREBUILT_WORKFLOWS[3], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
  { ...PREBUILT_WORKFLOWS[4], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
  { ...PREBUILT_WORKFLOWS[5], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
  { ...PREBUILT_WORKFLOWS[6], authorName: "BuildFlow Team", publishedAt: "Built-in",      ratingAvg: 0, cloneCount: 0 },
];

// Extra unique community workflows (derived from prebuilt data shapes)
const EXTRA: CommunityWorkflow[] = [
  {
    ...PREBUILT_WORKFLOWS[0],
    id:          "com-001",
    name:        "IFC → Carbon Footprint Estimate",
    description: "Import an IFC model and automatically calculate embodied carbon across all materials, generating a full carbon report.",
    category:    "Cost Estimation",
    complexity:  "intermediate",
    tags:        ["carbon", "sustainability", "ifc", "report"],
    authorName:  "BuildFlow Team",
    publishedAt: "Example",
    ratingAvg:   0,
    cloneCount:  0,
  },
  {
    ...PREBUILT_WORKFLOWS[1],
    id:          "com-002",
    name:        "Sketch → Floor Plan → 3D Model",
    description: "Upload a hand-drawn floor plan sketch and get back a fully-formed 3D building model with room labels and area calculations.",
    category:    "Concept Design",
    complexity:  "advanced",
    tags:        ["sketch", "floor-plan", "3d", "ocr"],
    authorName:  "BuildFlow Team",
    publishedAt: "Example",
    ratingAvg:   0,
    cloneCount:  0,
  },
  {
    ...PREBUILT_WORKFLOWS[2],
    id:          "com-003",
    name:        "Multi-Site Solar Analysis",
    description: "Compare solar radiation and shadow analysis across up to 5 building sites simultaneously, outputting a ranked comparison report.",
    category:    "Site Analysis",
    complexity:  "advanced",
    tags:        ["solar", "analysis", "comparison", "sustainability"],
    authorName:  "BuildFlow Team",
    publishedAt: "Example",
    ratingAvg:   0,
    cloneCount:  0,
  },
  {
    ...PREBUILT_WORKFLOWS[3],
    id:          "com-004",
    name:        "BOQ Auto-Formatter",
    description: "Takes a raw bill of quantities from any IFC source and reformats it into a clean Excel-compatible BOQ with NRM2 cost headings.",
    category:    "Cost Estimation",
    complexity:  "simple",
    tags:        ["boq", "cost", "nrm2", "excel"],
    authorName:  "BuildFlow Team",
    publishedAt: "Example",
    ratingAvg:   0,
    cloneCount:  0,
  },
  {
    ...PREBUILT_WORKFLOWS[4],
    id:          "com-005",
    name:        "Competition Brief Analyzer",
    description: "Feed a PDF competition brief and receive structured program analysis, site constraints summary, and a suggested workflow scaffold.",
    category:    "Concept Design",
    complexity:  "intermediate",
    tags:        ["competition", "brief", "analysis", "program"],
    authorName:  "BuildFlow Team",
    publishedAt: "Example",
    ratingAvg:   0,
    cloneCount:  0,
  },
];

const ALL_COMMUNITY: CommunityWorkflow[] = [...BASE, ...EXTRA];

const FILTER_CHIPS = ["All", "Concept", "BIM", "Analysis", "Visualization", "Cost"];
const SORT_OPTIONS = [
  { value: "popular",  labelKey: "community.mostPopular" as const,   icon: <TrendingUp size={10} /> },
  { value: "rating",   labelKey: "community.highestRated" as const,  icon: <Star size={10} /> },
  { value: "clones",   labelKey: "community.mostCloned" as const,    icon: <GitFork size={10} /> },
  { value: "newest",   labelKey: "community.newest" as const,        icon: <Clock size={10} /> },
];

const CATEGORY_MAP: Record<string, string[]> = {
  "Concept":       ["Concept Design"],
  "BIM":           ["BIM Export"],
  "Analysis":      ["Site Analysis", "Compliance"],
  "Visualization": ["Visualization"],
  "Cost":          ["Cost Estimation"],
};

// ─── Stats ────────────────────────────────────────────────────────────────────

const STATS = [
  { labelKey: "community.templateWorkflows" as const, value: String(PREBUILT_WORKFLOWS.length), color: "#4F8AFF" },
  { labelKey: "community.nodeTypes" as const,         value: "31",     color: "#10B981" },
  { labelKey: "community.title" as const,             value: "Beta",    color: "#8B5CF6" },
];

// ─── Publish Dialog ───────────────────────────────────────────────────────────

const TAG_OPTIONS = ["Concept", "BIM", "Visualization", "Analysis", "Cost", "Compliance", "Site", "Parametric"];

function PublishDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [title, setTitle]       = useState("");
  const [desc, setDesc]         = useState("");
  const [tags, setTags]         = useState<string[]>([]);
  const router = useRouter();

  const toggleTag = (tag: string) =>
    setTags(prev => prev.includes(tag) ? prev.filter(tg => tg !== tag) : [...prev, tag]);

  const handlePublish = () => {
    if (!title.trim()) { toast.error(t('toast.titleRequired')); return; }
    if (!desc.trim())  { toast.error(t('toast.descRequired')); return; }
    toast.success(t('toast.published'));
    onClose();
    router.push("/dashboard/community");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: -16 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{   opacity: 0, scale: 0.96,  y: -8 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: 480, background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))",
          borderRadius: 14, border: "1px solid #1E1E2E",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "16px 20px", borderBottom: "1px solid #1A1A26",
        }}>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.02em" }}>
            {t('community.publishDialog')}
          </span>
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, borderRadius: 6, border: "none",
              background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#4A4A60",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#EF4444"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#4A4A60"; }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: "20px" }}>
          {/* Title */}
          <label style={{ fontSize: 11, fontWeight: 600, color: "#7C7C96", display: "block", marginBottom: 6 }}>
            {t('community.titleLabel')} <span style={{ color: "#EF4444" }}>*</span>
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Multi-Site Carbon Analysis"
            style={{
              width: "100%", padding: "8px 12px",
              borderRadius: 8, border: "1px solid #1E1E2E",
              background: "#0E0E16", color: "#F0F0F5",
              fontSize: 13, outline: "none",
              boxSizing: "border-box", marginBottom: 16,
              transition: "border-color 0.1s",
            }}
            onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#4F8AFF"; }}
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; }}
          />

          {/* Description */}
          <label style={{ fontSize: 11, fontWeight: 600, color: "#7C7C96", display: "block", marginBottom: 6 }}>
            {t('community.descriptionLabel')} <span style={{ color: "#EF4444" }}>*</span>
          </label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder={t('community.descPlaceholder')}
            rows={3}
            style={{
              width: "100%", padding: "8px 12px",
              borderRadius: 8, border: "1px solid #1E1E2E",
              background: "#0E0E16", color: "#F0F0F5",
              fontSize: 13, outline: "none", resize: "none",
              boxSizing: "border-box", marginBottom: 16,
              fontFamily: "inherit", lineHeight: 1.5,
              transition: "border-color 0.1s",
            }}
            onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#4F8AFF"; }}
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; }}
          />

          {/* Tags */}
          <label style={{ fontSize: 11, fontWeight: 600, color: "#7C7C96", display: "block", marginBottom: 8 }}>
            {t('community.tagsLabel')}
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
            {TAG_OPTIONS.map(tag => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  style={{
                    padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                    fontSize: 11, fontWeight: 500,
                    background: active ? "rgba(79,138,255,0.15)" : "#1A1A26",
                    border: active ? "1px solid rgba(79,138,255,0.35)" : "1px solid #2A2A3E",
                    color: active ? "#4F8AFF" : "#8888A0",
                    transition: "all 0.1s",
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 18px", borderRadius: 8, cursor: "pointer",
                fontSize: 12, fontWeight: 600, color: "#7C7C96",
                background: "transparent", border: "1px solid #1E1E2E",
                transition: "all 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; }}
            >
              {t('community.cancel')}
            </button>
            <button
              onClick={handlePublish}
              style={{
                padding: "8px 18px", borderRadius: 8, cursor: "pointer",
                fontSize: 12, fontWeight: 600, color: "white",
                background: "linear-gradient(135deg, #4F8AFF 0%, #6D6AF6 100%)",
                border: "none",
                boxShadow: "0 2px 10px rgba(79,138,255,0.3)",
                transition: "opacity 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.87"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            >
              {t('community.publishBtn')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommunityPage() {
  const { t } = useLocale();
  const [search, setSearch]       = useState("");
  const [activeFilter, setFilter] = useState("All");
  const [sortBy, setSortBy]       = useState("popular");
  const [showSort, setShowSort]   = useState(false);
  const [showPublish, setPublish] = useState(false);

  const { loadFromTemplate } = useWorkflowStore();
  const router = useRouter();

  const filtered = useMemo(() => {
    // Defensive: if no workflows loaded, return empty
    if (!ALL_COMMUNITY || ALL_COMMUNITY.length === 0) return [];
    let list = [...ALL_COMMUNITY];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(w =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some(tg => tg.toLowerCase().includes(q))
      );
    }
    if (activeFilter !== "All") {
      const cats = CATEGORY_MAP[activeFilter] ?? [];
      list = list.filter(w => cats.includes(w.category));
    }
    if (sortBy === "rating")  list.sort((a, b) => b.ratingAvg  - a.ratingAvg);
    if (sortBy === "clones")  list.sort((a, b) => b.cloneCount - a.cloneCount);
    if (sortBy === "newest")  list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return list;
  }, [search, activeFilter, sortBy]);

  const handleClone = (id: string) => {
    const wf = ALL_COMMUNITY.find(w => w.id === id);
    if (!wf) return;
    loadFromTemplate(wf as WorkflowTemplate);
    toast.success(`"${wf.name}" ${t('toast.cloned')}`, { description: t('toast.openingCanvas') });
    awardXP("template-cloned");
    router.push("/dashboard/canvas");
  };

  const currentSortKey = SORT_OPTIONS.find(o => o.value === sortBy)?.labelKey ?? "community.mostPopular" as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Header
        title={t('community.title')}
        subtitle={t('community.subtitle')}
      />

      <main style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Disclaimer banner ──────────────────────────────────────────── */}
        <div style={{
          padding: "10px 16px",
          background: "rgba(79,138,255,0.06)",
          border: "1px solid rgba(79,138,255,0.15)",
          borderRadius: 8,
          fontSize: 12,
          color: "#9898B0",
          marginBottom: 16,
          margin: "16px 24px 0",
        }}>
          All shared workflows are community-contributed. Workflows marked <span style={{ color: "#10B981", fontWeight: 600 }}>Verified</span> have been tested by our team.
        </div>

        {/* ── Compact Hero ────────────────────────────────────────────────── */}
        <div style={{
          padding: "20px 28px",
          background: "radial-gradient(ellipse at 60% 50%, rgba(139,92,246,0.06) 0%, transparent 60%), #0A0A0F",
          borderBottom: "1px solid #1A1A26",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
        className="community-hero">
          {/* Stats */}
          <div className="community-stats" style={{ display: "flex", gap: 32 }}>
            {STATS.map(s => (
              <div key={s.labelKey} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: "-0.02em" }}>{s.value}</span>
                <span style={{ fontSize: 10, color: "#55556A" }}>{t(s.labelKey)}</span>
              </div>
            ))}
          </div>

          {/* Publish button */}
          <button
            onClick={() => setPublish(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px", borderRadius: 8, cursor: "pointer",
              fontSize: 12, fontWeight: 600, color: "#4F8AFF",
              background: "rgba(79,138,255,0.08)",
              border: "1px solid rgba(79,138,255,0.2)",
              transition: "all 0.12s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.14)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.35)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.08)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.2)";
            }}
          >
            <Upload size={13} />
            {t('community.publishYour')}
          </button>
        </div>

        <div style={{ padding: "16px 24px" }}>

          {/* ── Search + Filter bar ──────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            flexWrap: "wrap", marginBottom: 20,
          }}>
            {/* Search */}
            <div className="community-search" style={{ position: "relative", width: 300 }}>
              <Search size={12} style={{
                position: "absolute", left: 10, top: "50%",
                transform: "translateY(-50%)", color: "#55556A",
              }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('community.search')}
                aria-label="Search community workflows"
                style={{
                  width: "100%", paddingLeft: 32, paddingRight: 12,
                  height: 34, borderRadius: 8,
                  border: "1px solid #1E1E2E",
                  background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", color: "#F0F0F5",
                  fontSize: 12, outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.1s",
                }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#4F8AFF"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; }}
              />
            </div>

            {/* Filter chips */}
            {FILTER_CHIPS.map(chip => {
              const isActive = chip === activeFilter;
              const chipLabelMap: Record<string, string> = {
                "All": t('community.all'),
                "Concept": t('community.concept'),
                "BIM": t('community.bim'),
                "Analysis": t('community.analysis'),
                "Visualization": t('community.visualization'),
                "Cost": t('community.cost'),
              };
              return (
                <button
                  key={chip}
                  onClick={() => setFilter(chip)}
                  style={{
                    padding: "4px 11px", borderRadius: 20, cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                    background: isActive ? "rgba(79,138,255,0.15)" : "#12121E",
                    border: isActive ? "1px solid rgba(79,138,255,0.35)" : "1px solid #1E1E2E",
                    color: isActive ? "#4F8AFF" : "#8888A0",
                    transition: "all 0.1s",
                  }}
                >
                  {chipLabelMap[chip] ?? chip}
                </button>
              );
            })}

            <div style={{ flex: 1 }} />

            {/* Sort dropdown */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowSort(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                  fontSize: 11, color: "#7C7C96",
                  background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid #1E1E2E",
                }}
              >
                <span style={{ color: "#55556A" }}>{t('community.sortLabel')}</span>
                <span style={{ color: "#C0C0D0" }}>{t(currentSortKey)}</span>
                <ChevronDown size={11} style={{ color: "#55556A" }} />
              </button>

              <AnimatePresence>
                {showSort && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    style={{
                      position: "absolute", top: "calc(100% + 6px)", right: 0,
                      width: 170, zIndex: 50,
                      background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", borderRadius: 10,
                      border: "1px solid #1E1E2E",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      overflow: "hidden", padding: "4px 0",
                    }}
                  >
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", textAlign: "left",
                          padding: "7px 14px", fontSize: 12,
                          color: opt.value === sortBy ? "#4F8AFF" : "#C0C0D0",
                          background: opt.value === sortBy ? "rgba(79,138,255,0.08)" : "transparent",
                          border: "none", cursor: "pointer",
                        }}
                      >
                        {opt.icon}
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Grid / Empty state ───────────────────────────────────────── */}
          {filtered.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "#3A3A50", marginBottom: 8 }}>
                {t('community.noMatching')} &ldquo;{search}&rdquo;
              </p>
              <p style={{ fontSize: 12, color: "#2A2A40", marginBottom: 12 }}>
                {t('community.tryDifferent')}
              </p>
              <button
                onClick={() => { setSearch(""); setFilter("All"); }}
                style={{
                  fontSize: 12, color: "#4F8AFF", background: "none",
                  border: "none", cursor: "pointer",
                }}
              >
                {t('community.clearSearch')}
              </button>
            </div>
          ) : (
            <div className="community-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 18,
            }}>
              {filtered.map((wf, i) => (
                <WorkflowCard
                  key={wf.id}
                  workflow={wf}
                  showCloneButton
                  onClone={handleClone}
                  authorName={wf.authorName}
                  publishedAt={wf.publishedAt}
                  ratingAvg={wf.ratingAvg}
                  cloneCount={wf.cloneCount}
                  buttonLabel={t('community.cloneToMy')}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Publish Dialog */}
      <AnimatePresence>
        {showPublish && <PublishDialog onClose={() => setPublish(false)} />}
      </AnimatePresence>
    </div>
  );
}
