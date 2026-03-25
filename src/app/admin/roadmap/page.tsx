"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Brain, AlertTriangle, Zap, Clock, CheckCircle2,
  Circle, ArrowRight, ChevronDown, ChevronRight, RefreshCw,
  Bug, Lightbulb, Wrench, Server, Code2, Palette,
  Target, TrendingUp, Users, BarChart3, MessageSquare,
  ArrowUpRight, Pause, X, Trophy, Calendar, Play,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoadmapTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  effort: string;
  category: string;
  status: string;
  reasoning: string | null;
  linkedFeedbackIds: string[];
  sortOrder: number;
}

interface Roadmap {
  id: string;
  weekOf: string;
  summary: string;
  riskFlags: string[];
  quickWins: string[];
  feedbackAnalysis: {
    totalAnalyzed: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    topThemes: string[];
  };
  metricsSnapshot: {
    totalUsers: number;
    totalWorkflows: number;
    totalExecutions: number;
    executionSuccessRate: number;
    usersThisWeek: number;
    execsThisWeek: number;
    feedbackThisWeek: number;
  };
  generatedBy: string | null;
  createdAt: string;
  tasks: RoadmapTask[];
  taskStats?: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    deferred: number;
    dropped: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; glow: string; label: string }> = {
  P0: { color: "#FF4444", bg: "rgba(255,68,68,0.12)", glow: "0 0 12px rgba(255,68,68,0.4)", label: "Critical" },
  P1: { color: "#FFBF00", bg: "rgba(255,191,0,0.10)", glow: "0 0 12px rgba(255,191,0,0.3)", label: "High" },
  P2: { color: "#00F5FF", bg: "rgba(0,245,255,0.08)", glow: "0 0 12px rgba(0,245,255,0.25)", label: "Medium" },
  P3: { color: "#8898A8", bg: "rgba(136,152,168,0.08)", glow: "none", label: "Low" },
};

const EFFORT_CONFIG: Record<string, { label: string; dots: number }> = {
  XS: { label: "< 2h", dots: 1 },
  S: { label: "2-4h", dots: 2 },
  M: { label: "4-8h", dots: 3 },
  L: { label: "1-2d", dots: 4 },
  XL: { label: "3-5d", dots: 5 },
};

const CATEGORY_CONFIG: Record<string, { icon: typeof Bug; color: string; label: string }> = {
  "bug-fix": { icon: Bug, color: "#FF6B6B", label: "Bug Fix" },
  feature: { icon: Lightbulb, color: "#FFBF00", label: "Feature" },
  improvement: { icon: Wrench, color: "#4FC3F7", label: "Improvement" },
  infra: { icon: Server, color: "#B87333", label: "Infrastructure" },
  dx: { icon: Code2, color: "#A78BFA", label: "Dev Experience" },
  ux: { icon: Palette, color: "#34D399", label: "UX / Design" },
};

const STATUS_CONFIG: Record<string, { icon: typeof Circle; color: string; bg: string; label: string }> = {
  todo: { icon: Circle, color: "#8898A8", bg: "rgba(136,152,168,0.08)", label: "To Do" },
  "in-progress": { icon: Play, color: "#FFBF00", bg: "rgba(255,191,0,0.08)", label: "In Progress" },
  done: { icon: CheckCircle2, color: "#34D399", bg: "rgba(52,211,153,0.08)", label: "Done" },
  deferred: { icon: Pause, color: "#B87333", bg: "rgba(184,115,51,0.08)", label: "Deferred" },
  dropped: { icon: X, color: "#556070", bg: "rgba(85,96,112,0.08)", label: "Dropped" },
};

const STATUS_ORDER = ["todo", "in-progress", "done", "deferred", "dropped"];

// ─── Helper Components ────────────────────────────────────────────────────────

function GlowOrb({ color, size, top, left, delay = 0 }: { color: string; size: number; top: string; left: string; delay?: number }) {
  return (
    <motion.div
      animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.25, 0.15] }}
      transition={{ duration: 6, repeat: Infinity, delay }}
      style={{
        position: "absolute", top, left,
        width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: "blur(40px)", pointerEvents: "none",
      }}
    />
  );
}

// ─── AEC Architectural Illustration ───────────────────────────────────────────

function BlueprintBuilding() {
  return (
    <svg width="280" height="200" viewBox="0 0 280 200" fill="none" style={{ opacity: 0.6 }}>
      {/* Ground line */}
      <line x1="10" y1="180" x2="270" y2="180" stroke="rgba(184,115,51,0.2)" strokeWidth="1" strokeDasharray="4 3" />
      {/* Main building */}
      <motion.rect
        x="60" y="40" width="80" height="140" rx="2"
        stroke="rgba(0,245,255,0.25)" strokeWidth="1" fill="rgba(0,245,255,0.02)"
        initial={{ scaleY: 0, originY: 1 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 1.2, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: "70px 180px" }}
      />
      {/* Second tower */}
      <motion.rect
        x="160" y="70" width="60" height="110" rx="2"
        stroke="rgba(184,115,51,0.25)" strokeWidth="1" fill="rgba(184,115,51,0.02)"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: "190px 180px" }}
      />
      {/* Floor lines */}
      {[60, 80, 100, 120, 140, 160].map((y, i) => (
        <motion.line
          key={`floor-${i}`}
          x1="62" y1={y} x2="138" y2={y}
          stroke="rgba(0,245,255,0.1)" strokeWidth="0.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 + i * 0.1 }}
        />
      ))}
      {[85, 105, 125, 145, 165].map((y, i) => (
        <motion.line
          key={`floor2-${i}`}
          x1="162" y1={y} x2="218" y2={y}
          stroke="rgba(184,115,51,0.1)" strokeWidth="0.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 + i * 0.1 }}
        />
      ))}
      {/* Windows */}
      {[50, 70, 90, 110, 130, 150].map((y, i) => (
        <React.Fragment key={`win-${i}`}>
          <motion.rect
            x="72" y={y + 2} width="8" height="12" rx="1"
            fill="rgba(0,245,255,0.08)" stroke="rgba(0,245,255,0.15)" strokeWidth="0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, delay: i * 0.4 }}
          />
          <motion.rect
            x="90" y={y + 2} width="8" height="12" rx="1"
            fill="rgba(0,245,255,0.05)" stroke="rgba(0,245,255,0.12)" strokeWidth="0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.5, 0.2, 0.5] }}
            transition={{ duration: 4, repeat: Infinity, delay: i * 0.3 + 0.5 }}
          />
          <motion.rect
            x="108" y={y + 2} width="8" height="12" rx="1"
            fill="rgba(255,191,0,0.06)" stroke="rgba(255,191,0,0.12)" strokeWidth="0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.2, 0.6, 0.2] }}
            transition={{ duration: 3.5, repeat: Infinity, delay: i * 0.5 + 1 }}
          />
        </React.Fragment>
      ))}
      {/* Crane */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
      >
        <line x1="240" y1="180" x2="240" y2="20" stroke="rgba(255,191,0,0.2)" strokeWidth="1.5" />
        <line x1="200" y1="20" x2="265" y2="20" stroke="rgba(255,191,0,0.2)" strokeWidth="1.5" />
        <line x1="240" y1="20" x2="200" y2="35" stroke="rgba(255,191,0,0.15)" strokeWidth="0.8" />
        {/* Crane hook with subtle swing */}
        <motion.g
          animate={{ rotate: [-2, 2, -2] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "210px 20px" }}
        >
          <line x1="210" y1="20" x2="210" y2="55" stroke="rgba(255,191,0,0.15)" strokeWidth="0.8" />
          <rect x="205" y="55" width="10" height="6" rx="1" fill="rgba(255,191,0,0.1)" stroke="rgba(255,191,0,0.2)" strokeWidth="0.5" />
        </motion.g>
      </motion.g>
      {/* Dimension lines */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        transition={{ delay: 2 }}
      >
        <line x1="45" y1="40" x2="45" y2="180" stroke="rgba(184,115,51,0.15)" strokeWidth="0.5" strokeDasharray="2 2" />
        <line x1="42" y1="40" x2="48" y2="40" stroke="rgba(184,115,51,0.15)" strokeWidth="0.5" />
        <line x1="42" y1="180" x2="48" y2="180" stroke="rgba(184,115,51,0.15)" strokeWidth="0.5" />
        <text x="30" y="115" fill="rgba(184,115,51,0.2)" fontSize="6" fontFamily="var(--font-jetbrains)" textAnchor="middle" transform="rotate(-90, 30, 115)">140m</text>
      </motion.g>
    </svg>
  );
}

function IsometricGrid() {
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.3 }}>
      <defs>
        <pattern id="iso-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 20 M 0 20 L 40 40" stroke="rgba(184,115,51,0.04)" strokeWidth="0.5" fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#iso-grid)" />
    </svg>
  );
}

function ConstructionParticles() {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          animate={{
            y: [-20, -200 - i * 50],
            x: [0, (i % 2 === 0 ? 30 : -30)],
            opacity: [0, 0.6, 0],
          }}
          transition={{
            duration: 6 + i * 2,
            repeat: Infinity,
            delay: i * 1.5,
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            bottom: 0,
            left: `${15 + i * 15}%`,
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: ["#FFBF00", "#00F5FF", "#B87333", "#34D399", "#FFBF00", "#00F5FF"][i],
          }}
        />
      ))}
    </div>
  );
}

function MetricPill({ icon: Icon, label, value, trend }: {
  icon: typeof Users; label: string; value: number | string; trend?: "up" | "down" | "flat";
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 12px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(184,115,51,0.1)",
    }}>
      <Icon size={13} style={{ color: "rgba(255,255,255,0.3)" }} />
      <span style={{ fontSize: 10, color: "#556070", fontFamily: "var(--font-jetbrains)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0", fontFamily: "var(--font-jetbrains)" }}>{value}</span>
      {trend === "up" && <ArrowUpRight size={11} style={{ color: "#34D399" }} />}
      {trend === "down" && <ArrowUpRight size={11} style={{ color: "#FF6B6B", transform: "rotate(90deg)" }} />}
    </div>
  );
}

function EffortDots({ effort }: { effort: string }) {
  const config = EFFORT_CONFIG[effort] || { dots: 1, label: effort };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} title={`Effort: ${config.label}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: i < config.dots ? "#FFBF00" : "rgba(255,255,255,0.08)",
          transition: "background 0.3s ease",
        }} />
      ))}
      <span style={{ fontSize: 9, color: "#556070", marginLeft: 2, fontFamily: "var(--font-jetbrains)" }}>
        {config.label}
      </span>
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task, onStatusChange }: {
  task: RoadmapTask;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.P3;
  const category = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.improvement;
  const CatIcon = category.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setStatusMenuOpen(false); }}
      style={{
        position: "relative",
        padding: "14px 16px",
        borderRadius: 14,
        background: hovered ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${hovered ? "rgba(184,115,51,0.2)" : "rgba(184,115,51,0.08)"}`,
        cursor: "pointer",
        transition: "all 0.2s ease",
        overflow: "hidden",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Priority accent line */}
      <div style={{
        position: "absolute", left: 0, top: 8, bottom: 8, width: 3,
        borderRadius: "0 3px 3px 0",
        background: priority.color,
        boxShadow: priority.glow,
      }} />

      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginLeft: 6 }}>
        {/* Category icon */}
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: `${category.color}12`,
          border: `1px solid ${category.color}25`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <CatIcon size={14} style={{ color: category.color }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: "#E2E8F0",
            lineHeight: 1.4, marginBottom: 6,
          }}>
            {task.title}
          </div>

          {/* Badges row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {/* Priority badge */}
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
              padding: "2px 7px", borderRadius: 6,
              color: priority.color, background: priority.bg,
              fontFamily: "var(--font-jetbrains)",
            }}>
              {task.priority}
            </span>

            {/* Category label */}
            <span style={{
              fontSize: 9, color: category.color, fontWeight: 500,
              fontFamily: "var(--font-jetbrains)",
            }}>
              {category.label}
            </span>

            {/* Effort dots */}
            <EffortDots effort={task.effort} />

            {/* Linked feedback count */}
            {task.linkedFeedbackIds.length > 0 && (
              <span style={{
                fontSize: 9, color: "#556070",
                display: "flex", alignItems: "center", gap: 3,
                fontFamily: "var(--font-jetbrains)",
              }}>
                <MessageSquare size={9} />
                {task.linkedFeedbackIds.length}
              </span>
            )}
          </div>
        </div>

        {/* Status button */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setStatusMenuOpen(!statusMenuOpen); }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 8px", borderRadius: 8,
              border: `1px solid ${STATUS_CONFIG[task.status]?.color ?? "#556070"}30`,
              background: STATUS_CONFIG[task.status]?.bg ?? "transparent",
              color: STATUS_CONFIG[task.status]?.color ?? "#556070",
              fontSize: 10, fontWeight: 600, cursor: "pointer",
              fontFamily: "var(--font-jetbrains)",
              transition: "all 0.15s ease",
            }}
          >
            {React.createElement(STATUS_CONFIG[task.status]?.icon ?? Circle, {
              size: 10,
              ...(task.status === "in-progress" ? { style: { color: "#FFBF00" } } : {}),
            })}
            {STATUS_CONFIG[task.status]?.label ?? task.status}
            <ChevronDown size={9} />
          </button>

          {/* Status dropdown */}
          <AnimatePresence>
            {statusMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 4,
                  background: "rgba(13,15,17,0.98)",
                  border: "1px solid rgba(184,115,51,0.2)",
                  borderRadius: 10, padding: 4, zIndex: 100,
                  minWidth: 140,
                  backdropFilter: "blur(20px)",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {STATUS_ORDER.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  const Icon = cfg.icon;
                  const isActive = s === task.status;
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        onStatusChange(task.id, s);
                        setStatusMenuOpen(false);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "7px 10px", borderRadius: 7,
                        border: "none", cursor: "pointer",
                        background: isActive ? `${cfg.color}15` : "transparent",
                        color: isActive ? cfg.color : "#8898A8",
                        fontSize: 11, fontWeight: isActive ? 600 : 400,
                        transition: "all 0.12s ease",
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                    >
                      <Icon size={12} />
                      {cfg.label}
                      {isActive && <CheckCircle2 size={10} style={{ marginLeft: "auto" }} />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: "hidden", marginLeft: 6 }}
          >
            <div style={{
              marginTop: 12, paddingTop: 12,
              borderTop: "1px solid rgba(184,115,51,0.08)",
            }}>
              <p style={{ fontSize: 12, color: "#8898A8", lineHeight: 1.7, margin: 0 }}>
                {task.description}
              </p>
              {task.reasoning && (
                <div style={{
                  marginTop: 10, padding: "8px 12px",
                  borderRadius: 8, background: "rgba(0,245,255,0.04)",
                  border: "1px solid rgba(0,245,255,0.08)",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                    color: "#00F5FF", marginBottom: 4,
                    fontFamily: "var(--font-jetbrains)",
                  }}>
                    AI REASONING
                  </div>
                  <p style={{ fontSize: 11, color: "#8898A8", lineHeight: 1.6, margin: 0 }}>
                    {task.reasoning}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expand indicator */}
      <div style={{
        display: "flex", justifyContent: "center", marginTop: 6, marginLeft: 6,
      }}>
        <ChevronRight
          size={11}
          style={{
            color: "rgba(255,255,255,0.15)",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </div>
    </motion.div>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({ status, tasks, onStatusChange }: {
  status: string;
  tasks: RoadmapTask[];
  onStatusChange: (id: string, status: string) => void;
}) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.todo;

  return (
    <div style={{
      flex: 1, minWidth: 280, maxWidth: 400,
      display: "flex", flexDirection: "column",
    }}>
      {/* Column header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", marginBottom: 10,
        borderRadius: 10,
        background: cfg.bg,
        border: `1px solid ${cfg.color}18`,
      }}>
        {React.createElement(cfg.icon, {
          size: 14,
          style: { color: cfg.color },
          ...(status === "in-progress" ? { style: { color: "#FFBF00" } } : {}),
        })}
        <span style={{
          fontSize: 12, fontWeight: 700, color: cfg.color,
          letterSpacing: "0.03em",
        }}>
          {cfg.label}
        </span>
        <span style={{
          marginLeft: "auto", fontSize: 11, fontWeight: 700,
          color: cfg.color, opacity: 0.6,
          fontFamily: "var(--font-jetbrains)",
        }}>
          {tasks.length}
        </span>
      </div>

      {/* Tasks */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onStatusChange={onStatusChange} />
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <div style={{
            padding: "28px 20px", textAlign: "center",
            borderRadius: 12, border: "1px dashed rgba(184,115,51,0.12)",
            color: "#3A4450", fontSize: 10,
            fontFamily: "var(--font-jetbrains)",
            background: "rgba(255,255,255,0.005)",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.3,
              backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(184,115,51,0.04) 19px, rgba(184,115,51,0.04) 20px)",
            }} />
            <span style={{ position: "relative" }}>
              {status === "done" ? "Tasks move here on completion" :
               status === "in-progress" ? "Start working on tasks" : "No tasks"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [history, setHistory] = useState<Roadmap[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");

  // Fetch latest roadmap + history
  const fetchRoadmaps = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roadmap?limit=10");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (data.items.length > 0) {
        // Load full detail for the latest
        const detailRes = await fetch(`/api/admin/roadmap/${data.items[0].id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          setRoadmap(detail);
        }
        setHistory(data.items.slice(1));
      }
    } catch {
      // No roadmaps yet — that's fine
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRoadmaps(); }, [fetchRoadmaps]);

  // Generate new roadmap
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/roadmap", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate");
      }
      const newRoadmap = await res.json();
      setRoadmap(newRoadmap);
      // Refresh history
      fetchRoadmaps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  // Update task status
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    if (!roadmap) return;

    // Optimistic update
    setRoadmap((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, status: newStatus } : t
        ),
      };
    });

    try {
      const res = await fetch(`/api/admin/roadmap/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update");
    } catch {
      // Revert on error
      fetchRoadmaps();
    }
  };

  // View a historical roadmap
  const viewHistoricalRoadmap = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/roadmap/${id}`);
      if (res.ok) {
        const data = await res.json();
        setRoadmap(data);
        setHistoryOpen(false);
      }
    } catch {
      // ignore
    }
  };

  const weekLabel = roadmap
    ? new Date(roadmap.weekOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

  const completionRate = roadmap
    ? Math.round((roadmap.tasks.filter((t) => t.status === "done").length / Math.max(roadmap.tasks.length, 1)) * 100)
    : 0;

  // Group tasks by status for kanban
  const tasksByStatus = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = (roadmap?.tasks ?? []).filter((t) => t.status === status);
    return acc;
  }, {} as Record<string, RoadmapTask[]>);

  // ─── Loading State ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16,
      }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Brain size={32} style={{ color: "#B87333" }} />
        </motion.div>
        <span style={{ fontSize: 13, color: "#556070" }}>Loading roadmap...</span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      {/* ── Ambient Background ──────────────────────────────────────────── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <GlowOrb color="rgba(184,115,51,0.15)" size={400} top="-5%" left="60%" delay={0} />
        <GlowOrb color="rgba(0,245,255,0.08)" size={300} top="40%" left="-5%" delay={2} />
        <GlowOrb color="rgba(255,191,0,0.06)" size={350} top="70%" left="80%" delay={4} />
        {/* Isometric grid overlay */}
        <IsometricGrid />
        {/* Blueprint grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "radial-gradient(circle, rgba(184,115,51,0.03) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }} />
        {/* Floating construction particles */}
        <ConstructionParticles />
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: "28px 32px 48px", maxWidth: 1440, margin: "0 auto" }}>

        {/* ── Hero Header ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Top label */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: generating ? "#FFBF00" : "#34D399",
              boxShadow: generating
                ? "0 0 8px rgba(255,191,0,0.6)"
                : "0 0 8px rgba(52,211,153,0.6)",
              animation: generating ? "pulse 1.5s infinite" : "none",
            }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "2.5px",
              textTransform: "uppercase" as const,
              color: "#B87333",
              fontFamily: "var(--font-jetbrains)",
            }}>
              AI ROADMAP AGENT
            </span>
          </div>

          {/* Title + Generate button */}
          <div style={{
            display: "flex", alignItems: "flex-start", justifyContent: "space-between",
            flexWrap: "wrap", gap: 16, marginBottom: 24,
            position: "relative",
          }}>
            {/* AEC Building illustration — right side, behind controls */}
            <div style={{
              position: "absolute", right: 0, top: -40,
              pointerEvents: "none", zIndex: 0,
              opacity: 0.4,
            }}>
              <BlueprintBuilding />
            </div>

            <div style={{ position: "relative", zIndex: 1 }}>
              <h1 style={{
                fontSize: 32, fontWeight: 800, color: "#F0F2FF",
                margin: 0, lineHeight: 1.2,
                fontFamily: "var(--font-dm-sans)",
              }}>
                Weekly{" "}
                <span style={{
                  background: "linear-gradient(135deg, #B87333 0%, #FFBF00 50%, #00F5FF 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>
                  Roadmap
                </span>
              </h1>
              <p style={{
                fontSize: 11, color: "#3A4450", margin: "4px 0 0",
                fontFamily: "var(--font-jetbrains)",
                letterSpacing: "0.05em",
              }}>
                AI-POWERED SPRINT PLANNING FOR AEC TEAMS
              </p>
              {roadmap && (
                <p style={{
                  fontSize: 13, color: "#556070", margin: "6px 0 0",
                  fontFamily: "var(--font-jetbrains)",
                }}>
                  Week of {weekLabel} &middot; Generated by {roadmap.generatedBy || "System"} &middot;{" "}
                  <span style={{ color: completionRate >= 80 ? "#34D399" : completionRate >= 40 ? "#FFBF00" : "#8898A8" }}>
                    {completionRate}% complete
                  </span>
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {/* View toggle */}
              <div style={{
                display: "flex", borderRadius: 10, overflow: "hidden",
                border: "1px solid rgba(184,115,51,0.15)",
              }}>
                {(["kanban", "list"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      padding: "6px 14px", border: "none", cursor: "pointer",
                      background: view === v ? "rgba(184,115,51,0.12)" : "transparent",
                      color: view === v ? "#FFBF00" : "#556070",
                      fontSize: 11, fontWeight: 600,
                      fontFamily: "var(--font-jetbrains)",
                      textTransform: "capitalize" as const,
                      transition: "all 0.15s ease",
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>

              {/* Generate button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={generating}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", borderRadius: 12,
                  border: "1px solid rgba(184,115,51,0.3)",
                  background: generating
                    ? "rgba(255,191,0,0.08)"
                    : "linear-gradient(135deg, rgba(184,115,51,0.15), rgba(255,191,0,0.1))",
                  color: generating ? "#FFBF00" : "#F0F2FF",
                  fontSize: 13, fontWeight: 700, cursor: generating ? "wait" : "pointer",
                  fontFamily: "var(--font-dm-sans)",
                  boxShadow: generating ? "none" : "0 0 20px rgba(184,115,51,0.15)",
                  transition: "all 0.2s ease",
                  opacity: generating ? 0.8 : 1,
                }}
              >
                {generating ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    >
                      <Brain size={16} />
                    </motion.div>
                    Agent Thinking...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Generate Roadmap
                  </>
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* ── Error Banner ──────────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              style={{
                padding: "12px 16px", borderRadius: 12, marginBottom: 20,
                background: "rgba(255,68,68,0.08)",
                border: "1px solid rgba(255,68,68,0.2)",
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <AlertTriangle size={16} style={{ color: "#FF4444" }} />
              <span style={{ fontSize: 13, color: "#FF6B6B" }}>{error}</span>
              <button
                onClick={() => setError(null)}
                style={{
                  marginLeft: "auto", background: "none", border: "none",
                  color: "#FF6B6B", cursor: "pointer", padding: 4,
                }}
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Generating State ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {generating && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                padding: 32, borderRadius: 16, marginBottom: 24,
                background: "rgba(10,12,14,0.8)",
                border: "1px solid rgba(184,115,51,0.15)",
                backdropFilter: "blur(20px)",
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: 16,
              }}
            >
              {/* Animated brain */}
              <div style={{ position: "relative" }}>
                <motion.div
                  animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
                  transition={{ duration: 3, repeat: Infinity }}
                >
                  <Brain size={48} style={{ color: "#B87333" }} />
                </motion.div>
                {/* Orbiting particles */}
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 3 + i,
                      repeat: Infinity,
                      ease: "linear",
                      delay: i * 0.5,
                    }}
                    style={{
                      position: "absolute", top: "50%", left: "50%",
                      width: 60 + i * 20, height: 60 + i * 20,
                      marginTop: -(30 + i * 10), marginLeft: -(30 + i * 10),
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 0, left: "50%",
                      width: 4, height: 4, borderRadius: "50%",
                      background: ["#FFBF00", "#00F5FF", "#B87333"][i],
                      boxShadow: `0 0 8px ${["#FFBF00", "#00F5FF", "#B87333"][i]}`,
                    }} />
                  </motion.div>
                ))}
              </div>

              <div style={{ textAlign: "center" }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#E2E8F0", margin: "0 0 8px" }}>
                  AI Agent is analyzing your platform...
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {["Scanning all user feedback & bug reports", "Analyzing execution health & error patterns", "Evaluating tech stack: Kling AI, Meshy, OpenAI, i18n coverage", "Studying growth metrics & subscription conversion", "Generating prioritized sprint tasks"].map((step, i) => (
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 1.2 }}
                      style={{
                        fontSize: 12, color: "#556070",
                        display: "flex", alignItems: "center", gap: 6,
                        fontFamily: "var(--font-jetbrains)",
                      }}
                    >
                      <motion.div
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3 }}
                      >
                        <ArrowRight size={10} style={{ color: "#B87333" }} />
                      </motion.div>
                      {step}
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── No Roadmap State ──────────────────────────────────────────────── */}
        {!roadmap && !generating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              padding: "48px 32px 64px", borderRadius: 20, textAlign: "center",
              background: "rgba(10,12,14,0.6)",
              border: "1px solid rgba(184,115,51,0.1)",
              position: "relative", overflow: "hidden",
            }}
          >
            {/* Background architectural pattern */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              backgroundImage: `
                repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(184,115,51,0.03) 39px, rgba(184,115,51,0.03) 40px),
                repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(184,115,51,0.03) 39px, rgba(184,115,51,0.03) 40px)
              `,
            }} />
            {/* Building illustration */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, position: "relative" }}>
              <BlueprintBuilding />
            </div>
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Sparkles size={36} style={{ color: "#B87333", margin: "0 auto 12px" }} />
            </motion.div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "#E2E8F0", margin: "0 0 6px", position: "relative" }}>
              No Roadmap Yet
            </h2>
            <p style={{
              fontSize: 11, color: "#3A4450", margin: "0 0 4px",
              fontFamily: "var(--font-jetbrains)", letterSpacing: "0.1em",
              textTransform: "uppercase" as const, position: "relative",
            }}>
              YOUR AI CTO IS READY TO ANALYZE
            </p>
            <p style={{ fontSize: 14, color: "#556070", margin: "8px 0 28px", maxWidth: 520, marginInline: "auto", position: "relative", lineHeight: 1.7 }}>
              The agent will deep-analyze all user feedback, platform metrics, tech stack health,
              service quality, i18n coverage, subscription data, and error patterns to generate
              a prioritized weekly sprint plan.
            </p>
            <motion.button
              whileHover={{ scale: 1.03, boxShadow: "0 8px 40px rgba(184,115,51,0.4), 0 0 60px rgba(184,115,51,0.15)" }}
              whileTap={{ scale: 0.97 }}
              onClick={handleGenerate}
              style={{
                display: "inline-flex", alignItems: "center", gap: 10,
                padding: "14px 32px", borderRadius: 14,
                background: "linear-gradient(135deg, #B87333, #FFBF00)",
                color: "#0A0C0E", fontSize: 15, fontWeight: 800,
                border: "none", cursor: "pointer",
                fontFamily: "var(--font-dm-sans)",
                boxShadow: "0 4px 24px rgba(184,115,51,0.3), 0 0 48px rgba(184,115,51,0.1)",
                position: "relative",
                transition: "box-shadow 0.3s ease",
              }}
            >
              <Brain size={18} />
              Generate Your First Roadmap
            </motion.button>
          </motion.div>
        )}

        {/* ── Roadmap Content ──────────────────────────────────────────────── */}
        {roadmap && !generating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* ── Metrics Strip ──────────────────────────────────────────────── */}
            {roadmap.metricsSnapshot && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                style={{
                  display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20,
                }}
              >
                <MetricPill icon={Users} label="Users" value={roadmap.metricsSnapshot.totalUsers} />
                <MetricPill icon={BarChart3} label="Workflows" value={roadmap.metricsSnapshot.totalWorkflows} />
                <MetricPill icon={Target} label="Executions" value={roadmap.metricsSnapshot.totalExecutions} />
                <MetricPill icon={TrendingUp} label="Success" value={`${roadmap.metricsSnapshot.executionSuccessRate}%`} />
                <MetricPill icon={MessageSquare} label="Feedback" value={roadmap.metricsSnapshot.feedbackThisWeek} />
              </motion.div>
            )}

            {/* ── AI Insight + Risk + Quick Wins row ─────────────────────────── */}
            <div className="roadmap-insight-grid" style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16, marginBottom: 24,
            }}>
              {/* AI Summary */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                style={{
                  padding: "18px 20px", borderRadius: 16,
                  background: "rgba(10,12,14,0.7)",
                  border: "1px solid rgba(0,245,255,0.1)",
                  backdropFilter: "blur(16px)",
                  position: "relative", overflow: "hidden",
                }}
              >
                <div style={{
                  position: "absolute", top: -20, right: -20, width: 100, height: 100,
                  background: "radial-gradient(circle, rgba(0,245,255,0.06) 0%, transparent 70%)",
                  pointerEvents: "none",
                }} />
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                }}>
                  <Brain size={14} style={{ color: "#00F5FF" }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    color: "#00F5FF", fontFamily: "var(--font-jetbrains)",
                  }}>
                    AI WEEKLY INSIGHT
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "#C8CED8", lineHeight: 1.7, margin: 0 }}>
                  {roadmap.summary}
                </p>
              </motion.div>

              {/* Risk Flags */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                style={{
                  padding: "18px 20px", borderRadius: 16,
                  background: "rgba(10,12,14,0.7)",
                  border: "1px solid rgba(255,68,68,0.1)",
                  backdropFilter: "blur(16px)",
                }}
              >
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                }}>
                  <AlertTriangle size={14} style={{ color: "#FF6B6B" }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    color: "#FF6B6B", fontFamily: "var(--font-jetbrains)",
                  }}>
                    RISK FLAGS
                  </span>
                </div>
                {roadmap.riskFlags.length > 0 ? (
                  <ul style={{ margin: 0, padding: "0 0 0 14px", listStyle: "none" }}>
                    {roadmap.riskFlags.map((flag, i) => (
                      <li key={i} style={{
                        fontSize: 12, color: "#8898A8", lineHeight: 1.7,
                        position: "relative", paddingLeft: 4,
                      }}>
                        <span style={{
                          position: "absolute", left: -14, top: 8,
                          width: 4, height: 4, borderRadius: "50%",
                          background: "#FF6B6B",
                        }} />
                        {flag}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 12, color: "#3A4450", margin: 0 }}>No risks identified</p>
                )}
              </motion.div>

              {/* Quick Wins */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                style={{
                  padding: "18px 20px", borderRadius: 16,
                  background: "rgba(10,12,14,0.7)",
                  border: "1px solid rgba(52,211,153,0.1)",
                  backdropFilter: "blur(16px)",
                }}
              >
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                }}>
                  <Zap size={14} style={{ color: "#34D399" }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    color: "#34D399", fontFamily: "var(--font-jetbrains)",
                  }}>
                    QUICK WINS
                  </span>
                </div>
                {roadmap.quickWins.length > 0 ? (
                  <ul style={{ margin: 0, padding: "0 0 0 14px", listStyle: "none" }}>
                    {roadmap.quickWins.map((win, i) => (
                      <li key={i} style={{
                        fontSize: 12, color: "#8898A8", lineHeight: 1.7,
                        position: "relative", paddingLeft: 4,
                      }}>
                        <span style={{
                          position: "absolute", left: -14, top: 8,
                          width: 4, height: 4, borderRadius: "50%",
                          background: "#34D399",
                        }} />
                        {win}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 12, color: "#3A4450", margin: 0 }}>No quick wins identified</p>
                )}
              </motion.div>
            </div>

            {/* ── Completion Bar ──────────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
              style={{ marginBottom: 24 }}
            >
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Trophy size={14} style={{ color: "#FFBF00" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>
                    Sprint Progress
                  </span>
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: completionRate >= 80 ? "#34D399" : completionRate >= 40 ? "#FFBF00" : "#8898A8",
                  fontFamily: "var(--font-jetbrains)",
                }}>
                  {roadmap.tasks.filter((t) => t.status === "done").length}/{roadmap.tasks.length} tasks
                </span>
              </div>
              <div style={{
                height: 6, borderRadius: 3,
                background: "rgba(255,255,255,0.04)",
                overflow: "hidden",
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${completionRate}%` }}
                  transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    height: "100%", borderRadius: 3,
                    background: completionRate >= 80
                      ? "linear-gradient(90deg, #34D399, #00F5FF)"
                      : completionRate >= 40
                        ? "linear-gradient(90deg, #FFBF00, #B87333)"
                        : "linear-gradient(90deg, #556070, #8898A8)",
                    boxShadow: completionRate >= 80
                      ? "0 0 12px rgba(52,211,153,0.4)"
                      : completionRate >= 40
                        ? "0 0 12px rgba(255,191,0,0.3)"
                        : "none",
                  }}
                />
              </div>
            </motion.div>

            {/* ── Kanban Board ────────────────────────────────────────────────── */}
            {view === "kanban" && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                style={{
                  display: "flex", gap: 16, overflowX: "auto",
                  paddingBottom: 16,
                }}
              >
                {/* Only show columns that have tasks or are core statuses */}
                {["todo", "in-progress", "done"].map((status) => (
                  <KanbanColumn
                    key={status}
                    status={status}
                    tasks={tasksByStatus[status] || []}
                    onStatusChange={handleStatusChange}
                  />
                ))}
                {/* Show deferred/dropped only if they have tasks */}
                {["deferred", "dropped"].map((status) =>
                  (tasksByStatus[status] || []).length > 0 ? (
                    <KanbanColumn
                      key={status}
                      status={status}
                      tasks={tasksByStatus[status]}
                      onStatusChange={handleStatusChange}
                    />
                  ) : null
                )}
              </motion.div>
            )}

            {/* ── List View ──────────────────────────────────────────────────── */}
            {view === "list" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {roadmap.tasks
                  .sort((a, b) => {
                    const pOrder = ["P0", "P1", "P2", "P3"];
                    return pOrder.indexOf(a.priority) - pOrder.indexOf(b.priority);
                  })
                  .map((task) => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} />
                  ))}
              </motion.div>
            )}

            {/* ── History Section ────────────────────────────────────────────── */}
            {history.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                style={{ marginTop: 32 }}
              >
                <button
                  onClick={() => setHistoryOpen(!historyOpen)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "none", border: "none", cursor: "pointer",
                    color: "#556070", fontSize: 13, fontWeight: 600,
                    padding: "8px 0",
                  }}
                >
                  <Clock size={14} />
                  Previous Roadmaps ({history.length})
                  <ChevronDown
                    size={14}
                    style={{
                      transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </button>

                <AnimatePresence>
                  {historyOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
                        {history.map((h) => {
                          const stats = h.taskStats;
                          const hWeek = new Date(h.weekOf).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          });
                          const hCompletion = stats
                            ? Math.round((stats.done / Math.max(stats.total, 1)) * 100)
                            : 0;

                          return (
                            <button
                              key={h.id}
                              onClick={() => viewHistoricalRoadmap(h.id)}
                              style={{
                                display: "flex", alignItems: "center", gap: 14,
                                padding: "12px 16px", borderRadius: 12,
                                background: "rgba(255,255,255,0.015)",
                                border: "1px solid rgba(184,115,51,0.08)",
                                cursor: "pointer", textAlign: "left",
                                transition: "all 0.15s ease",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                                e.currentTarget.style.borderColor = "rgba(184,115,51,0.2)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "rgba(255,255,255,0.015)";
                                e.currentTarget.style.borderColor = "rgba(184,115,51,0.08)";
                              }}
                            >
                              <Calendar size={14} style={{ color: "#B87333", flexShrink: 0 }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>
                                  Week of {hWeek}
                                </div>
                                <div style={{
                                  fontSize: 11, color: "#556070",
                                  fontFamily: "var(--font-jetbrains)",
                                }}>
                                  {stats?.total ?? 0} tasks &middot; {hCompletion}% complete
                                </div>
                              </div>
                              {/* Mini completion bar */}
                              <div style={{
                                width: 80, height: 4, borderRadius: 2,
                                background: "rgba(255,255,255,0.04)",
                                overflow: "hidden", flexShrink: 0,
                              }}>
                                <div style={{
                                  height: "100%", borderRadius: 2,
                                  width: `${hCompletion}%`,
                                  background: hCompletion >= 80
                                    ? "linear-gradient(90deg, #34D399, #00F5FF)"
                                    : "linear-gradient(90deg, #FFBF00, #B87333)",
                                }} />
                              </div>
                              <RefreshCw size={12} style={{ color: "#3A4450" }} />
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>

      {/* ── Responsive styles ──────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes shimmer-line {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @media (max-width: 1200px) {
          .roadmap-insight-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 768px) {
          .roadmap-container {
            padding: 16px !important;
          }
          .roadmap-kanban {
            flex-direction: column !important;
          }
          .roadmap-kanban > div {
            max-width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}
