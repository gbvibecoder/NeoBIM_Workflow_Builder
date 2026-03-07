"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  CheckCircle2, Sparkles, Compass, Cable, Lock,
  Megaphone, ChevronRight, Star, Clock, Zap,
  FileText, Play,
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { RARITY_COLORS } from "@/lib/gamification";

// ─── Types ───────────────────────────────────────────────────────────────────
interface DashboardData {
  xp: number;
  level: number;
  progress: number;
  xpInLevel: number;
  xpForNext: number;
  workflowCount: number;
  executionCount: number;
  missions: Array<{
    id: string;
    title: string;
    description: string;
    action: string;
    href: string;
    icon: string;
    status: "completed" | "in_progress" | "locked";
  }>;
  blueprints: Array<{
    workflowIndex: number;
    rarity: string;
    requiredLevel: number;
    unlocked: boolean;
  }>;
  achievements: Array<{ action: string; xp: number; date: string }>;
  flashEvent: {
    key: string;
    eventKey: string;
    title: string;
    description: string;
    href: string;
    completed: boolean;
    msRemaining: number;
  };
  recentWorkflows: Array<{
    id: string;
    name: string;
    updatedAt: string;
    nodeCount: number;
    executionCount: number;
  }>;
}

// ─── Animation presets ────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};
const fadeRight = {
  hidden: { opacity: 0, x: 30 },
  visible: { opacity: 1, x: 0 },
};
const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─── XP Ring ──────────────────────────────────────────────────────────────────
function XPRing({ percent = 0, size = 44 }: { percent?: number; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="#1B4FFF" strokeWidth={4} strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.5, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
      />
    </svg>
  );
}

// ─── Countdown Timer ──────────────────────────────────────────────────────────
function CountdownTimer({ initialMs }: { initialMs: number }) {
  const [seconds, setSeconds] = useState(Math.max(0, Math.floor(initialMs / 1000)));

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(s => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");

  return (
    <span className="font-mono-data" style={{ fontSize: 13, color: "#7C7C96", letterSpacing: "0.05em" }}>
      {h}:{m}:{s}
    </span>
  );
}

// ─── Section Label ────────────────────────────────────────────────────────────
function SectionLabel({ number, title, right }: { number: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 6,
        background: "rgba(27,79,255,0.12)", border: "1px solid rgba(27,79,255,0.25)",
        fontSize: 12, fontWeight: 700, color: "#4F8AFF",
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {number}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.02em" }}>
        {title}
      </span>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(27,79,255,0.2), transparent)" }} />
      {right}
    </div>
  );
}

// ─── Mission Icon helper ─────────────────────────────────────────────────────
const MISSION_ICONS: Record<string, React.ReactNode> = {
  check:    <CheckCircle2 size={22} />,
  sparkles: <Sparkles size={22} />,
  compass:  <Compass size={22} />,
  cable:    <Cable size={22} />,
};

// ─── Blueprint display names ─────────────────────────────────────────────────
const BLUEPRINT_NAMES: Record<number, { name: string; desc: string; image: string }> = {
  0: {
    name: "Volumetric Concept Engine",
    desc: "A high-tier generator for rapid urban massing experiments.",
    image: "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=600&q=80",
  },
  1: {
    name: "PDF Brief Analyzer",
    desc: "Automatically extract FAR and site limits from planning docs.",
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&q=80",
  },
  2: {
    name: "Neural Render Suite",
    desc: "Turn wireframes into photoreal visualizations instantly.",
    image: "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=600&q=80",
  },
};

// ─── Default data (shown when API fails or user is new) ──────────────────────
const DEFAULT_DATA: DashboardData = {
  xp: 0,
  level: 1,
  progress: 0,
  xpInLevel: 0,
  xpForNext: 500,
  workflowCount: 0,
  executionCount: 0,
  missions: [
    { id: "m1", title: "Initialize Node", description: "Create your first empty canvas to begin.", action: "workflow-created", href: "/dashboard/workflows/new", icon: "check", status: "in_progress" },
    { id: "m2", title: "AI Whispering", description: "Generate a workflow using a natural prompt.", action: "ai-prompt-used", href: "/dashboard/workflows/new", icon: "sparkles", status: "locked" },
    { id: "m3", title: "Pattern Hunter", description: "Browse and fork your first public template.", action: "template-cloned", href: "/dashboard/templates", icon: "compass", status: "locked" },
    { id: "m4", title: "The Integrator", description: "Connect a 3rd party API node.", action: "render-generated", href: "/dashboard/workflows/new", icon: "cable", status: "locked" },
  ],
  blueprints: [
    { workflowIndex: 0, rarity: "rare", requiredLevel: 1, unlocked: true },
    { workflowIndex: 1, rarity: "epic", requiredLevel: 5, unlocked: false },
    { workflowIndex: 2, rarity: "legendary", requiredLevel: 8, unlocked: false },
  ],
  achievements: [],
  flashEvent: {
    key: "run-3-workflows", eventKey: "run-3-workflows:fallback",
    title: "Run 3 workflows today", description: "Execute three different workflows before midnight UTC.",
    href: "/dashboard/workflows", completed: false, msRemaining: 43200000,
  },
  recentWorkflows: [],
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/user/dashboard-stats", { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error("API error");
        return r.json();
      })
      .then((d: DashboardData) => {
        if (d && Array.isArray(d.missions)) {
          setData(d);
        }
      })
      .catch(() => {
        // Use default data — dashboard already rendered
      });
    // Timeout: if API takes >5s, abort
    const timeout = setTimeout(() => controller.abort(), 5000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  const statusColor = (s: string) =>
    s === "completed" ? "#00E676" : s === "in_progress" ? "#4F8AFF" : "#6B6B8A";

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#0a0c10" }}>
      {/* Subtle grid overlay */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        opacity: 0.5,
      }} />

      <main className="flex-1 overflow-y-auto relative" style={{ zIndex: 1 }}>
        <div style={{ padding: "32px 40px 48px", width: "100%" }}>

          {/* ── HEADER — Quest Log ─────────────────────────────────────── */}
          <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.1 } } }}>
            <div className="flex items-start justify-between mb-10">
              <div>
                <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: smoothEase }}>
                  <span style={{
                    display: "inline-block", padding: "4px 12px", borderRadius: 4,
                    background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.3)",
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const,
                    color: "#FFB800", marginBottom: 12,
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    SEASON 1: THE ARCHITECT&apos;S PATH
                  </span>
                </motion.div>

                <motion.h1
                  variants={fadeUp}
                  transition={{ duration: 0.6, ease: smoothEase }}
                  style={{
                    fontSize: 48, fontWeight: 900, fontStyle: "italic",
                    letterSpacing: "-1px", lineHeight: 1.05, marginBottom: 10,
                    color: "#F0F0F5",
                  }}
                >
                  QUEST LOG: <span style={{ color: "#00BFFF" }}>CORE SYSTEM</span>
                </motion.h1>

                <motion.p
                  variants={fadeUp}
                  transition={{ duration: 0.5, ease: smoothEase }}
                  style={{ fontSize: 15, color: "#5C5C78", maxWidth: 480 }}
                >
                  Complete missions to unlock legendary parametric blueprints.
                </motion.p>
              </div>

              {/* XP Level Card — REAL DATA */}
              <motion.div
                variants={fadeRight}
                transition={{ duration: 0.6, ease: smoothEase }}
                style={{
                  background: "#0F1218",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12, padding: "16px 20px",
                  display: "flex", alignItems: "center", gap: 14,
                  flexShrink: 0,
                }}
              >
                <div>
                  <div className="font-mono-data" style={{ fontSize: 9, color: "#5C5C78", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 2 }}>
                    XP LEVEL
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.02em", lineHeight: 1 }}>
                    LVL {String(data.level ?? 1).padStart(2, "0")}
                  </div>
                  <div className="font-mono-data" style={{ fontSize: 9, color: "#3A3A50", marginTop: 3 }}>
                    {data.xpInLevel ?? 0} / {(data.xpForNext ?? 500) - ((data.level ?? 1) - 1) * 500} XP
                  </div>
                </div>
                <div style={{ position: "relative", width: 44, height: 44 }}>
                  <XPRing percent={data.progress} size={44} />
                  <span style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: "#9898B0",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {data.progress}%
                  </span>
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* ── SECTION 01 — Active Missions ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <SectionLabel number="01" title="Active Missions" />
          </motion.div>

          <div className="grid grid-cols-4 gap-4 mb-14 relative">
            {/* Connecting line behind cards */}
            <div style={{
              position: "absolute", top: "50%", left: 24, right: 24, height: 1,
              background: "linear-gradient(90deg, rgba(0,230,118,0.15), rgba(27,79,255,0.15), rgba(107,107,138,0.08), rgba(107,107,138,0.04))",
              zIndex: 0,
            }} />

            {(data.missions ?? []).map((mission, i) => {
              const isCompleted = mission.status === "completed";
              const isActive = mission.status === "in_progress";
              const isLocked = mission.status === "locked";
              const color = statusColor(mission.status);

              return (
                <motion.div
                  key={mission.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.075, duration: 0.5, ease: smoothEase }}
                  style={{ position: "relative", zIndex: 1 }}
                >
                  <Link
                    href={isLocked ? "#" : mission.href}
                    className={`block ${isActive ? "mission-card-active" : ""}`}
                    style={{
                      background: "#0F1218",
                      borderRadius: 12, padding: 20,
                      border: isCompleted
                        ? "1px solid rgba(0,230,118,0.3)"
                        : isActive
                          ? "1px solid rgba(27,79,255,0.5)"
                          : "1px solid rgba(255,255,255,0.06)",
                      boxShadow: isActive ? "0 0 20px rgba(27,79,255,0.15)" : "none",
                      opacity: isLocked ? 0.5 : 1,
                      textDecoration: "none",
                      transition: "all 200ms ease",
                      cursor: isLocked ? "not-allowed" : "pointer",
                      height: "100%",
                      display: "flex", flexDirection: "column" as const,
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div style={{
                        width: 42, height: 42, borderRadius: 10,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isCompleted
                          ? "rgba(0,230,118,0.12)"
                          : isActive
                            ? "rgba(27,79,255,0.12)"
                            : "rgba(255,255,255,0.04)",
                        color,
                      }}>
                        {isLocked ? <Lock size={18} style={{ color: "#6B6B8A" }} /> : MISSION_ICONS[mission.icon]}
                      </div>
                      <span className="font-mono-data" style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase" as const,
                        color,
                      }}>
                        {isCompleted ? "COMPLETED" : isActive ? "IN PROGRESS" : "LOCKED"}
                      </span>
                    </div>

                    <div style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F5", marginBottom: 4 }}>
                      {mission.title}
                    </div>
                    <div style={{ fontSize: 12, color: "#5C5C78", lineHeight: 1.5, flex: 1 }}>
                      {mission.description}
                    </div>

                    {isActive && (
                      <div style={{
                        marginTop: 12, height: 3, borderRadius: 2,
                        background: "rgba(27,79,255,0.15)", overflow: "hidden",
                      }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: "40%" }}
                          transition={{ delay: 0.8, duration: 1, ease: "easeOut" }}
                          className="progress-shimmer"
                          style={{
                            height: "100%", borderRadius: 2,
                            background: "linear-gradient(90deg, #1B4FFF, #00BFFF)",
                          }}
                        />
                      </div>
                    )}
                  </Link>
                </motion.div>
              );
            })}
          </div>

          {/* ── SECTION 02 — Blueprint Vault ──────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.65, duration: 0.5 }}
          >
            <SectionLabel
              number="02"
              title="Blueprint Vault"
              right={
                <Link href="/dashboard/templates" style={{
                  fontSize: 12, fontWeight: 600, color: "#FFB800",
                  textDecoration: "none", display: "flex", alignItems: "center", gap: 4,
                }}>
                  Full Vault <ChevronRight size={14} />
                </Link>
              }
            />
          </motion.div>

          <div className="grid grid-cols-3 gap-5 mb-14">
            {(data.blueprints ?? []).map((bp, i) => {
              const meta = BLUEPRINT_NAMES[i] ?? { name: PREBUILT_WORKFLOWS[bp.workflowIndex]?.name ?? "Blueprint", desc: "", image: "" };
              const rarityColor = RARITY_COLORS[bp.rarity] ?? "#6B7280";
              const rarityLabel = `${bp.rarity.toUpperCase()} BLUEPRINT`;

              return (
                <motion.div
                  key={bp.workflowIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 + i * 0.1, duration: 0.5, ease: smoothEase }}
                  className={bp.unlocked ? "loot-card" : ""}
                  style={{
                    background: "#0F1218",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 12, overflow: "hidden",
                    transition: "all 300ms ease",
                  }}
                >
                  {/* Image area */}
                  <div style={{
                    height: 180, position: "relative", overflow: "hidden",
                    backgroundImage: `url('${meta.image}')`,
                    backgroundSize: "cover", backgroundPosition: "center",
                  }}>
                    {!bp.unlocked && (
                      <div style={{
                        position: "absolute", inset: 0,
                        background: "rgba(10,12,16,0.75)",
                        backdropFilter: "blur(4px)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Lock size={28} style={{ color: "#6B6B8A" }} />
                      </div>
                    )}
                    {bp.unlocked && (
                      <div style={{
                        position: "absolute", top: 10, right: 10,
                        padding: "4px 10px", borderRadius: 6,
                        background: `rgba(${hexToRgb(rarityColor)}, 0.2)`, border: `1px solid rgba(${hexToRgb(rarityColor)}, 0.4)`,
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                        color: rarityColor, textTransform: "uppercase" as const,
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}>
                        UNLOCKED
                      </div>
                    )}
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
                      background: "linear-gradient(transparent, #0F1218)",
                    }} />
                  </div>

                  {/* Content */}
                  <div style={{ padding: "14px 18px 18px" }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                      color: rarityColor, textTransform: "uppercase" as const,
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}>
                      <Star size={10} fill={rarityColor} />
                      {rarityLabel}
                    </div>

                    {!bp.unlocked && (
                      <div className="font-mono-data" style={{
                        fontSize: 9, color: "#5C5C78", letterSpacing: "0.05em",
                        marginBottom: 4, textTransform: "uppercase" as const,
                      }}>
                        UNLOCK AT LVL {bp.requiredLevel}
                      </div>
                    )}

                    <div style={{
                      fontSize: 17, fontWeight: 700, fontStyle: "italic",
                      color: bp.unlocked ? "#F0F0F5" : "#5C5C78",
                      marginBottom: 6, letterSpacing: "-0.01em",
                    }}>
                      {meta.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#5C5C78", lineHeight: 1.5, marginBottom: 14 }}>
                      {meta.desc}
                    </div>

                    {bp.unlocked ? (
                      <Link
                        href="/dashboard/workflows/new"
                        style={{
                          display: "block", textAlign: "center",
                          padding: "10px 16px", borderRadius: 8,
                          background: rarityColor, color: "#0a0c10",
                          fontSize: 12, fontWeight: 700, letterSpacing: "0.08em",
                          textTransform: "uppercase" as const, textDecoration: "none",
                          fontFamily: "var(--font-jetbrains), monospace",
                          transition: "all 200ms ease",
                        }}
                      >
                        USE BLUEPRINT
                      </Link>
                    ) : (
                      <div style={{
                        textAlign: "center", padding: "10px 16px", borderRadius: 8,
                        background: "rgba(255,255,255,0.04)", color: "#3A3A50",
                        fontSize: 12, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase" as const,
                        fontFamily: "var(--font-jetbrains), monospace",
                        cursor: "not-allowed",
                      }}>
                        LOCKED — LEVEL {bp.requiredLevel} REQUIRED
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* ── SECTION 03 — Recent Activity ──────────────────────────── */}
          {(data.recentWorkflows ?? []).length > 0 && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9, duration: 0.5 }}
              >
                <SectionLabel
                  number="03"
                  title="Recent Activity"
                  right={
                    <Link href="/dashboard/workflows" style={{
                      fontSize: 12, fontWeight: 600, color: "#4F8AFF",
                      textDecoration: "none", display: "flex", alignItems: "center", gap: 4,
                    }}>
                      All Workflows <ChevronRight size={14} />
                    </Link>
                  }
                />
              </motion.div>

              <div className="grid grid-cols-3 gap-4 mb-14">
                {(data.recentWorkflows ?? []).map((wf, i) => (
                  <motion.div
                    key={wf.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.95 + i * 0.07, duration: 0.4, ease: smoothEase }}
                  >
                    <Link
                      href={`/dashboard/canvas?id=${wf.id}`}
                      style={{
                        display: "block", textDecoration: "none",
                        background: "#0F1218",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 12, padding: "18px 20px",
                        transition: "all 200ms ease",
                      }}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div style={{
                          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                          background: "rgba(79,138,255,0.08)", border: "1px solid rgba(79,138,255,0.15)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <FileText size={16} style={{ color: "#4F8AFF" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 14, fontWeight: 600, color: "#F0F0F5",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {wf.name}
                          </div>
                          <div className="font-mono-data" style={{ fontSize: 10, color: "#5C5C78" }}>
                            {timeAgo(wf.updatedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono-data" style={{ fontSize: 10, color: "#3A3A50", display: "flex", alignItems: "center", gap: 3 }}>
                          <Zap size={10} style={{ color: "#4F8AFF" }} /> {wf.nodeCount} nodes
                        </span>
                        <span className="font-mono-data" style={{ fontSize: 10, color: "#3A3A50", display: "flex", alignItems: "center", gap: 3 }}>
                          <Play size={9} style={{ color: "#10B981" }} /> {wf.executionCount} runs
                        </span>
                      </div>
                      <div style={{
                        marginTop: 12, textAlign: "center",
                        padding: "7px 0", borderRadius: 6,
                        background: "rgba(79,138,255,0.06)", border: "1px solid rgba(79,138,255,0.12)",
                        fontSize: 11, fontWeight: 600, color: "#4F8AFF",
                        fontFamily: "var(--font-jetbrains), monospace",
                        letterSpacing: "0.03em",
                      }}>
                        Open
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </>
          )}

          {/* ── FLASH EVENT Banner ─────────────────────────────────────── */}
          {data.flashEvent && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0, duration: 0.5, ease: smoothEase }}
          >
            <Link
              href={data.flashEvent.href}
              className="block"
              style={{
                background: "#0F1218",
                border: data.flashEvent.completed
                  ? "1px solid rgba(0,230,118,0.3)"
                  : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16, padding: "24px 28px",
                textDecoration: "none",
                display: "flex", alignItems: "center", gap: 24,
                transition: "all 200ms ease",
              }}
            >
              <div style={{
                width: 64, height: 64, borderRadius: 14, flexShrink: 0,
                background: data.flashEvent.completed ? "rgba(0,230,118,0.1)" : "rgba(27,79,255,0.1)",
                border: data.flashEvent.completed ? "1px solid rgba(0,230,118,0.2)" : "1px solid rgba(27,79,255,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {data.flashEvent.completed
                  ? <CheckCircle2 size={26} style={{ color: "#00E676" }} />
                  : <Megaphone size={26} style={{ color: "#4F8AFF" }} />}
              </div>

              <div style={{ flex: 1 }}>
                <div className="flex items-center gap-3 mb-2">
                  <span style={{ fontSize: 14, fontWeight: 700, fontStyle: "italic", color: data.flashEvent.completed ? "#00E676" : "#4F8AFF", letterSpacing: "0.02em" }}>
                    {data.flashEvent.completed ? "EVENT COMPLETE" : "FLASH EVENT"}
                  </span>
                  {!data.flashEvent.completed && (
                    <>
                      <span className="event-dot" style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#4F8AFF", display: "inline-block",
                      }} />
                      <span className="font-mono-data" style={{ fontSize: 11, color: "#5C5C78", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                        ENDING IN <CountdownTimer initialMs={data.flashEvent.msRemaining} />
                      </span>
                    </>
                  )}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, fontStyle: "italic", color: "#F0F0F5", marginBottom: 4, letterSpacing: "-0.01em" }}>
                  {data.flashEvent.title}
                </div>
                <div style={{ fontSize: 13, color: "#5C5C78", lineHeight: 1.5 }}>
                  {data.flashEvent.description}
                  {!data.flashEvent.completed && (
                    <span style={{ color: "#FFB800", fontWeight: 600 }}> +500 XP</span>
                  )}
                </div>
              </div>

              {!data.flashEvent.completed && (
                <div style={{
                  padding: "14px 28px", borderRadius: 8, flexShrink: 0,
                  background: "#F0F0F5", color: "#0a0c10",
                  fontSize: 13, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase" as const,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  START CHALLENGE
                </div>
              )}
            </Link>
          </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79,138,255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
