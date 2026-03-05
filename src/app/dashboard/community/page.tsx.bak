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

// ─── Mock community data ──────────────────────────────────────────────────────

interface CommunityWorkflow extends WorkflowTemplate {
  authorName: string;
  publishedAt: string;
  ratingAvg: number;
  cloneCount: number;
}

// Extend prebuilts with community data
const BASE: CommunityWorkflow[] = [
  { ...PREBUILT_WORKFLOWS[0], authorName: "Sarah Chen",     publishedAt: "2 days ago",    ratingAvg: 4.8, cloneCount: 1847 },
  { ...PREBUILT_WORKFLOWS[1], authorName: "Marcus Rivera",  publishedAt: "1 week ago",    ratingAvg: 4.6, cloneCount: 924  },
  { ...PREBUILT_WORKFLOWS[2], authorName: "Priya Patel",    publishedAt: "3 days ago",    ratingAvg: 4.5, cloneCount: 612  },
  { ...PREBUILT_WORKFLOWS[3], authorName: "James O'Brien",  publishedAt: "2 weeks ago",   ratingAvg: 4.3, cloneCount: 341  },
  { ...PREBUILT_WORKFLOWS[4], authorName: "Aiko Tanaka",    publishedAt: "1 month ago",   ratingAvg: 4.7, cloneCount: 789  },
  { ...PREBUILT_WORKFLOWS[5], authorName: "Lars Eriksson",  publishedAt: "5 days ago",    ratingAvg: 4.2, cloneCount: 203  },
  { ...PREBUILT_WORKFLOWS[6], authorName: "Sarah Chen",     publishedAt: "3 months ago",  ratingAvg: 4.4, cloneCount: 1243 },
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
    authorName:  "Priya Patel",
    publishedAt: "2 hours ago",
    ratingAvg:   4.9,
    cloneCount:  87,
  },
  {
    ...PREBUILT_WORKFLOWS[1],
    id:          "com-002",
    name:        "Sketch → Floor Plan → 3D Model",
    description: "Upload a hand-drawn floor plan sketch and get back a fully-formed 3D building model with room labels and area calculations.",
    category:    "Concept Design",
    complexity:  "advanced",
    tags:        ["sketch", "floor-plan", "3d", "ocr"],
    authorName:  "James O'Brien",
    publishedAt: "4 days ago",
    ratingAvg:   4.3,
    cloneCount:  156,
  },
  {
    ...PREBUILT_WORKFLOWS[2],
    id:          "com-003",
    name:        "Multi-Site Solar Analysis",
    description: "Compare solar radiation and shadow analysis across up to 5 building sites simultaneously, outputting a ranked comparison report.",
    category:    "Site Analysis",
    complexity:  "advanced",
    tags:        ["solar", "analysis", "comparison", "sustainability"],
    authorName:  "Lars Eriksson",
    publishedAt: "1 week ago",
    ratingAvg:   4.6,
    cloneCount:  312,
  },
  {
    ...PREBUILT_WORKFLOWS[3],
    id:          "com-004",
    name:        "BOQ Auto-Formatter",
    description: "Takes a raw bill of quantities from any IFC source and reformats it into a clean Excel-compatible BOQ with NRM2 cost headings.",
    category:    "Cost Estimation",
    complexity:  "simple",
    tags:        ["boq", "cost", "nrm2", "excel"],
    authorName:  "Marcus Rivera",
    publishedAt: "3 weeks ago",
    ratingAvg:   4.0,
    cloneCount:  445,
  },
  {
    ...PREBUILT_WORKFLOWS[4],
    id:          "com-005",
    name:        "Competition Brief Analyzer",
    description: "Feed a PDF competition brief and receive structured program analysis, site constraints summary, and a suggested workflow scaffold.",
    category:    "Concept Design",
    complexity:  "intermediate",
    tags:        ["competition", "brief", "analysis", "program"],
    authorName:  "Aiko Tanaka",
    publishedAt: "12 days ago",
    ratingAvg:   4.7,
    cloneCount:  629,
  },
];

const ALL_COMMUNITY: CommunityWorkflow[] = [...BASE, ...EXTRA];

const FILTER_CHIPS = ["All", "Concept", "BIM", "Analysis", "Visualization", "Cost"];
const SORT_OPTIONS = [
  { value: "popular",  label: "Most Popular",    icon: <TrendingUp size={10} /> },
  { value: "rating",   label: "Highest Rated",   icon: <Star size={10} /> },
  { value: "clones",   label: "Most Cloned",      icon: <GitFork size={10} /> },
  { value: "newest",   label: "Newest",           icon: <Clock size={10} /> },
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
  { label: "Published Workflows", value: "500+",   color: "#4F8AFF" },
  { label: "Community Members",   value: "5,200+", color: "#10B981" },
  { label: "Total Clones",        value: "28,400+",color: "#8B5CF6" },
];

// ─── Publish Dialog ───────────────────────────────────────────────────────────

const TAG_OPTIONS = ["Concept", "BIM", "Visualization", "Analysis", "Cost", "Compliance", "Site", "Parametric"];

function PublishDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle]       = useState("");
  const [desc, setDesc]         = useState("");
  const [tags, setTags]         = useState<string[]>([]);
  const router = useRouter();

  const toggleTag = (tag: string) =>
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const handlePublish = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!desc.trim())  { toast.error("Description is required"); return; }
    toast.success("Workflow published to community!");
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
          width: 480, background: "#12121E",
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
          <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "#F0F0F5" }}>
            Publish to Community
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
          <label style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", display: "block", marginBottom: 6 }}>
            Title <span style={{ color: "#EF4444" }}>*</span>
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
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
          />

          {/* Description */}
          <label style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", display: "block", marginBottom: 6 }}>
            Description <span style={{ color: "#EF4444" }}>*</span>
          </label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Describe what your workflow does and who it's for..."
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
            onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
          />

          {/* Tags */}
          <label style={{ fontSize: 11, fontWeight: 600, color: "#8888A0", display: "block", marginBottom: 8 }}>
            Tags
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
                fontSize: 12, fontWeight: 600, color: "#8888A0",
                background: "transparent", border: "1px solid #1E1E2E",
                transition: "all 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2A2A3E"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
            >
              Cancel
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
              Publish to Community
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommunityPage() {
  const [search, setSearch]       = useState("");
  const [activeFilter, setFilter] = useState("All");
  const [sortBy, setSortBy]       = useState("popular");
  const [showSort, setShowSort]   = useState(false);
  const [showPublish, setPublish] = useState(false);

  const { loadFromTemplate } = useWorkflowStore();
  const router = useRouter();

  const filtered = useMemo(() => {
    let list = [...ALL_COMMUNITY];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(w =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    if (activeFilter !== "All") {
      const cats = CATEGORY_MAP[activeFilter] ?? [];
      list = list.filter(w => cats.includes(w.category));
    }
    if (sortBy === "rating")  list.sort((a, b) => b.ratingAvg  - a.ratingAvg);
    if (sortBy === "clones")  list.sort((a, b) => b.cloneCount - a.cloneCount);
    if (sortBy === "newest")  list.sort((a, b) => b.cloneCount - a.cloneCount); // date sim
    return list;
  }, [search, activeFilter, sortBy]);

  const handleClone = (id: string) => {
    const wf = ALL_COMMUNITY.find(w => w.id === id);
    if (!wf) return;
    loadFromTemplate(wf as WorkflowTemplate);
    toast.success(`"${wf.name}" cloned`, { description: "Opening in canvas…" });
    router.push("/dashboard/canvas");
  };

  const currentSort = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? "Most Popular";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Header
        title="Community"
        subtitle="Discover and clone workflows shared by AEC professionals worldwide"
      />

      <main style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Compact Hero ────────────────────────────────────────────────── */}
        <div style={{
          padding: "20px 28px",
          background: "radial-gradient(ellipse at 60% 50%, rgba(139,92,246,0.06) 0%, transparent 60%), #0A0A0F",
          borderBottom: "1px solid #1A1A26",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          {/* Stats */}
          <div style={{ display: "flex", gap: 32 }}>
            {STATS.map(s => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</span>
                <span style={{ fontSize: 10, color: "#55556A" }}>{s.label}</span>
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
            Publish Your Workflow
          </button>
        </div>

        <div style={{ padding: "16px 24px" }}>

          {/* ── Search + Filter bar ──────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            flexWrap: "wrap", marginBottom: 20,
          }}>
            {/* Search */}
            <div style={{ position: "relative", width: 300 }}>
              <Search size={12} style={{
                position: "absolute", left: 10, top: "50%",
                transform: "translateY(-50%)", color: "#55556A",
              }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search community workflows..."
                aria-label="Search community workflows"
                style={{
                  width: "100%", paddingLeft: 32, paddingRight: 12,
                  height: 34, borderRadius: 8,
                  border: "1px solid #1E1E2E",
                  background: "#12121E", color: "#F0F0F5",
                  fontSize: 12, outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.1s",
                }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = "#4F8AFF"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
              />
            </div>

            {/* Filter chips */}
            {FILTER_CHIPS.map(chip => {
              const isActive = chip === activeFilter;
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
                  {chip}
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
                  fontSize: 11, color: "#8888A0",
                  background: "#12121E", border: "1px solid #1E1E2E",
                }}
              >
                <span style={{ color: "#55556A" }}>Sort:</span>
                <span style={{ color: "#C0C0D0" }}>{currentSort}</span>
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
                      background: "#12121E", borderRadius: 10,
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
                        {opt.label}
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
                No workflows matching &ldquo;{search}&rdquo;
              </p>
              <p style={{ fontSize: 12, color: "#2A2A40", marginBottom: 12 }}>
                Try different keywords or browse all workflows
              </p>
              <button
                onClick={() => { setSearch(""); setFilter("All"); }}
                style={{
                  fontSize: 12, color: "#4F8AFF", background: "none",
                  border: "none", cursor: "pointer",
                }}
              >
                Clear search →
              </button>
            </div>
          ) : (
            <div style={{
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
                  buttonLabel="Clone to My Workflows"
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
