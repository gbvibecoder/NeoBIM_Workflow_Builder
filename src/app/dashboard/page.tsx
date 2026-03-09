"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CheckCircle2, Sparkles, Compass, Cable, Lock,
  ChevronRight, Zap, ArrowRight, Lightbulb, Crown,
  FileText, Play, Workflow, Activity, Plus, Grid3X3,
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { MiniWorkflowDiagram } from "@/components/shared/MiniWorkflowDiagram";
import { PageBackground } from "@/components/dashboard/PageBackground";

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
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};
const fadeRight = {
  hidden: { opacity: 0, x: 30 },
  visible: { opacity: 1, x: 0 },
};
const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─── Template category colors ─────────────────────────────────────────────────
const TEMPLATE_CATEGORY_COLORS: Record<string, string> = {
  "Concept Design": "#3B82F6",
  "Visualization": "#10B981",
  "BIM Export": "#F59E0B",
  "Cost Estimation": "#8B5CF6",
  "Full Pipeline": "#06B6D4",
  "Site Analysis": "#10B981",
};

// ─── Default data ────────────────────────────────────────────────────────────
const DEFAULT_DATA: DashboardData = {
  xp: 0,
  level: 1,
  progress: 0,
  xpInLevel: 0,
  xpForNext: 500,
  workflowCount: 0,
  executionCount: 0,
  missions: [
    { id: "m1", title: "Create Your First Workflow", description: "Set up your first empty canvas to begin designing.", action: "workflow-created", href: "/dashboard/workflows/new", icon: "check", status: "in_progress" },
    { id: "m2", title: "Try AI-Assisted Design", description: "Generate a workflow using a natural language prompt.", action: "ai-prompt-used", href: "/dashboard/workflows/new", icon: "sparkles", status: "locked" },
    { id: "m3", title: "Browse Design Templates", description: "Explore and fork a pre-built workflow template.", action: "template-cloned", href: "/dashboard/templates", icon: "compass", status: "locked" },
    { id: "m4", title: "Run a Complete Pipeline", description: "Execute a full workflow from input to output.", action: "render-generated", href: "/dashboard/workflows/new", icon: "cable", status: "locked" },
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

// ─── Mission Icon helper ─────────────────────────────────────────────────────
const MISSION_ICONS: Record<string, React.ReactNode> = {
  check:    <CheckCircle2 size={20} />,
  sparkles: <Sparkles size={20} />,
  compass:  <Compass size={20} />,
  cable:    <Cable size={20} />,
};

// ─── AnimNum — Animated counter ──────────────────────────────────────────────
function AnimNum({ value, suffix = "", size = 36 }: { value: number; suffix?: string; size?: number }) {
  const [d, setD] = useState(0);
  const r = useRef<number>(0);
  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 900, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setD(parseFloat((eased * value).toFixed(1)));
      if (p < 1) r.current = requestAnimationFrame(tick);
    };
    r.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r.current);
  }, [value]);
  const isInt = !String(value).includes(".");
  return (
    <span style={{
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: size, fontWeight: 700, lineHeight: 1,
      color: "#F0F0F5", letterSpacing: "-0.04em",
    }}>
      {isInt ? Math.round(d) : d.toFixed(1)}{suffix}
    </span>
  );
}

// ─── CircularGauge — Conic gradient ring ─────────────────────────────────────
function CircularGauge({ percentage, color }: { percentage: number; color: string }) {
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 1200, 1);
      setAnimPct(percentage * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [percentage]);

  const deg = (animPct / 100) * 360;
  return (
    <div style={{
      width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
      background: `conic-gradient(${color} 0deg, ${color} ${deg}deg, rgba(255,255,255,0.04) ${deg}deg)`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: "50%",
        background: "rgba(12,14,20,0.9)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color,
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {Math.round(animPct)}%
      </div>
    </div>
  );
}

// ─── SignalLine — Decorative SVG waveform ────────────────────────────────────
function SignalLine({ color, delay = 0 }: { color: string; delay?: number }) {
  return (
    <svg width="100%" height="20" viewBox="0 0 100 20" preserveAspectRatio="none" style={{ display: "block", marginTop: 6, opacity: 0.35 }}>
      <motion.path
        d="M0 10 L15 10 L20 3 L25 17 L30 7 L35 13 L40 10 L100 10"
        fill="none" stroke={color} strokeWidth={1} strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.2, delay, ease: "easeOut" }}
      />
    </svg>
  );
}

// ─── Section Label ────────────────────────────────────────────────────────────
function SectionLabel({ number, title, right }: { number: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-7">
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, borderRadius: 8,
        background: "rgba(184,115,51,0.1)", border: "1px solid rgba(184,115,51,0.2)",
        fontSize: 12, fontWeight: 700, color: "#B87333",
        fontFamily: "var(--font-jetbrains), monospace",
        boxShadow: "0 0 12px rgba(184,115,51,0.08)",
      }}>
        {number}
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, color: "#E2E8F0", letterSpacing: "-0.02em" }}>
        {title}
      </span>
      <div style={{
        flex: 1, height: 1,
        background: "linear-gradient(90deg, rgba(184,115,51,0.18), rgba(184,115,51,0.04) 60%, transparent)",
      }} />
      {right}
    </div>
  );
}

// ─── Ambient Node Wave — subtle floating constellation ───────────────────────
const WAVE_NODES = [
  { cx: 8,  cy: 15, r: 2,   color: "#B87333", delay: 0 },
  { cx: 22, cy: 8,  r: 1.5, color: "#4F8AFF", delay: 0.4 },
  { cx: 38, cy: 18, r: 2,   color: "#8B5CF6", delay: 0.8 },
  { cx: 52, cy: 6,  r: 1.5, color: "#10B981", delay: 1.2 },
  { cx: 68, cy: 14, r: 2,   color: "#B87333", delay: 1.6 },
  { cx: 82, cy: 9,  r: 1.5, color: "#4F8AFF", delay: 2.0 },
  { cx: 94, cy: 16, r: 2,   color: "#F59E0B", delay: 2.4 },
];

const WAVE_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
];

function AmbientNodeWave() {
  return (
    <svg
      className="dashboard-node-wave"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
    >
      {/* Edges — faint lines between nodes */}
      {WAVE_EDGES.map(([a, b], i) => (
        <line
          key={`we-${i}`}
          x1={WAVE_NODES[a].cx} y1={WAVE_NODES[a].cy}
          x2={WAVE_NODES[b].cx} y2={WAVE_NODES[b].cy}
          stroke="rgba(184,115,51,0.08)"
          strokeWidth="0.3"
          strokeDasharray="1 2"
        >
          <animate
            attributeName="opacity"
            values="0.3;0.8;0.3"
            dur={`${3 + i * 0.5}s`}
            begin={`${i * 0.3}s`}
            repeatCount="indefinite"
          />
        </line>
      ))}

      {/* Nodes — small dots with staggered wave pulse */}
      {WAVE_NODES.map((n, i) => (
        <g key={`wn-${i}`}>
          {/* Outer ring — breathing */}
          <circle
            cx={n.cx} cy={n.cy} r={n.r * 2.5}
            fill="none" stroke={n.color} strokeWidth="0.2"
            opacity="0"
          >
            <animate
              attributeName="opacity"
              values="0;0.15;0"
              dur="3s"
              begin={`${n.delay}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="r"
              values={`${n.r * 2};${n.r * 3};${n.r * 2}`}
              dur="3s"
              begin={`${n.delay}s`}
              repeatCount="indefinite"
            />
          </circle>
          {/* Core dot */}
          <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.color} opacity="0.12">
            <animate
              attributeName="opacity"
              values="0.08;0.25;0.08"
              dur="3s"
              begin={`${n.delay}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}
    </svg>
  );
}

// ─── Wire Connector SVG between cards ────────────────────────────────────────
function WireConnector() {
  return (
    <svg width="40" height="60" viewBox="0 0 40 60" style={{ flexShrink: 0, alignSelf: "center" }}>
      <line
        x1="0" y1="30" x2="40" y2="30"
        stroke="rgba(184,115,51,0.25)" strokeWidth="1"
        className="wire-animate"
      />
      <circle cx="20" cy="30" r="3" fill="rgba(184,115,51,0.4)">
        <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// ─── Pipeline Connector SVG ──────────────────────────────────────────────────
function PipelineConnector({ fromColor, toColor }: { fromColor: string; toColor: string }) {
  const gradId = `pipe-${fromColor.replace("#", "")}-${toColor.replace("#", "")}`;
  return (
    <svg width="60" height="80" viewBox="0 0 60 80" style={{ flexShrink: 0, alignSelf: "center" }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={fromColor} stopOpacity="0.4" />
          <stop offset="100%" stopColor={toColor} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <line
        x1="0" y1="40" x2="60" y2="40"
        stroke={`url(#${gradId})`} strokeWidth="1.5"
        className="wire-animate"
      />
      <circle cx="30" cy="40" r="2.5" fill={fromColor} opacity="0.5">
        <animate attributeName="r" values="2.5;4;2.5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

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
        if (d && Array.isArray(d.missions)) setData(d);
      })
      .catch(() => {});
    const timeout = setTimeout(() => controller.abort(), 5000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  const statusColor = useCallback((s: string) =>
    s === "completed" ? "#34D399" : s === "in_progress" ? "#B87333" : "#556070", []);

  const successRate = data.executionCount > 0
    ? Math.round((data.workflowCount / Math.max(data.executionCount, 1)) * 100)
    : 0;

  return (
    <div className="dp-page-bg flex flex-col h-full overflow-hidden">
      {/* ── Premium Background Layers ─────────────────────────── */}
      <PageBackground />

      {/* Ambient node wave */}
      <AmbientNodeWave />

      {/* Noise texture overlay */}
      <div className="dashboard-noise" />

      <main className="flex-1 overflow-y-auto relative" style={{ zIndex: 1 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "36px 48px 64px", width: "100%" }}>

          {/* ════════════════════════════════════════════════════════════
              HEADER — Design Studio
              ════════════════════════════════════════════════════════════ */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          >
            <div className="flex items-start justify-between mb-12" style={{ gap: 24 }}>
              <div style={{ flex: 1 }}>
                {/* Blueprint annotation */}
                <motion.div
                  variants={fadeUp}
                  transition={{ duration: 0.5, ease: smoothEase }}
                  className="blueprint-annotation"
                  style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "2.5px",
                    textTransform: "uppercase" as const,
                    color: "rgba(184,115,51,0.4)", marginBottom: 12,
                  }}
                >
                  WORKSPACE / HOME
                </motion.div>

                <motion.h1
                  variants={fadeUp}
                  transition={{ duration: 0.6, ease: smoothEase }}
                  style={{
                    fontSize: 40, fontWeight: 800,
                    letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 12,
                  }}
                >
                  <span style={{ color: "#E2E8F0" }}>Design </span>
                  <span style={{
                    background: "linear-gradient(135deg, #B87333 0%, #FFBF00 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}>
                    Studio
                  </span>
                </motion.h1>

                <motion.p
                  variants={fadeUp}
                  transition={{ duration: 0.5, ease: smoothEase }}
                  style={{ fontSize: 15, color: "#8898A8", maxWidth: 420, lineHeight: 1.6 }}
                >
                  Your concept design workspace — from brief to 3D in minutes.
                </motion.p>

                {/* Accent line with beam-extend animation */}
                <motion.div
                  variants={fadeUp}
                  transition={{ duration: 0.5, ease: smoothEase }}
                >
                  <div style={{
                    width: 60, height: 3, borderRadius: 2, marginTop: 16,
                    background: "linear-gradient(90deg, #B87333, #FFBF00)",
                    animation: "beam-extend 1.5s ease-out forwards",
                    overflow: "hidden",
                  }} />
                </motion.div>
              </div>

              {/* ── Stat Cards ────────────────────────────────────────── */}
              <motion.div
                variants={fadeRight}
                transition={{ duration: 0.6, ease: smoothEase }}
                style={{ display: "flex", gap: 14, flexShrink: 0 }}
              >
                <StatCard
                  label="Workflows"
                  value={data.workflowCount}
                  icon={<Workflow size={15} />}
                  color="#B87333"
                  colorRgb="184,115,51"
                  delay={0.3}
                />
                <StatCard
                  label="Executions"
                  value={data.executionCount}
                  icon={<Activity size={15} />}
                  color="#00F5FF"
                  colorRgb="0,245,255"
                  delay={0.4}
                />
                <StatCard
                  label="Success"
                  value={successRate}
                  icon={<CheckCircle2 size={15} />}
                  color="#34D399"
                  colorRgb="52,211,153"
                  delay={0.5}
                  gauge={successRate}
                />
              </motion.div>
            </div>
          </motion.div>

          {/* ════════════════════════════════════════════════════════════
              SECTION 01 — Quick Actions
              ════════════════════════════════════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <SectionLabel number="01" title="Quick Actions" />
          </motion.div>

          <div className="flex items-stretch gap-0 mb-16">
            {/* Card A: New Workflow */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.5, ease: smoothEase }}
              style={{ flex: 1 }}
            >
              <Link
                href="/dashboard/workflows/new"
                className="node-card dash-card-hover block"
                style={{
                  "--node-port-color": "#B87333",
                  borderStyle: "dashed",
                  borderColor: "rgba(184,115,51,0.2)",
                  padding: "28px 24px",
                  height: "100%",
                  display: "flex", flexDirection: "column",
                  textDecoration: "none",
                  transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                } as React.CSSProperties}
              >
                <div className="flex items-center justify-between mb-5">
                  <div
                    className="dash-plus"
                    style={{
                      width: 52, height: 52, borderRadius: 14,
                      background: "linear-gradient(135deg, rgba(184,115,51,0.15), rgba(255,191,0,0.08))",
                      border: "1px solid rgba(184,115,51,0.25)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#B87333",
                      boxShadow: "0 0 20px rgba(184,115,51,0.1)",
                    }}
                  >
                    <Plus size={24} />
                  </div>
                  <ArrowRight size={16} style={{ color: "#556070" }} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>
                  Create New Workflow
                </div>
                <div style={{ fontSize: 12, color: "#8898A8", lineHeight: 1.55, flex: 1 }}>
                  Start from scratch with a blank canvas
                </div>
              </Link>
            </motion.div>

            <WireConnector />

            {/* Card B: AI Generate */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.43, duration: 0.5, ease: smoothEase }}
              style={{ flex: 1 }}
            >
              <Link
                href="/dashboard/workflows/new"
                className="node-card block"
                style={{
                  "--node-port-color": "#4F8AFF",
                  borderColor: "rgba(79,138,255,0.35)",
                  background: "linear-gradient(135deg, rgba(79,138,255,0.06), rgba(0,212,255,0.03))",
                  padding: "28px 24px",
                  height: "100%",
                  display: "flex", flexDirection: "column",
                  textDecoration: "none",
                  transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                } as React.CSSProperties}
              >
                <div className="flex items-center justify-between mb-5">
                  <div style={{
                    width: 52, height: 52, borderRadius: 14,
                    background: "linear-gradient(135deg, rgba(79,138,255,0.15), rgba(0,212,255,0.08))",
                    border: "1px solid rgba(79,138,255,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#4F8AFF",
                    boxShadow: "0 0 20px rgba(79,138,255,0.12)",
                  }}>
                    <Sparkles size={22} />
                  </div>
                  <span className="arch-ai-badge">AI POWERED</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>
                  AI Generate
                </div>
                <div style={{ fontSize: 12, color: "#8898A8", lineHeight: 1.55, flex: 1 }}>
                  Describe your pipeline in plain English
                </div>
              </Link>
            </motion.div>

            <WireConnector />

            {/* Card C: Browse Templates */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.51, duration: 0.5, ease: smoothEase }}
              style={{ flex: 1 }}
            >
              <Link
                href="/dashboard/templates"
                className="node-card block"
                style={{
                  "--node-port-color": "#F59E0B",
                  borderColor: "rgba(245,158,11,0.25)",
                  padding: "28px 24px",
                  height: "100%",
                  display: "flex", flexDirection: "column",
                  textDecoration: "none",
                  transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                } as React.CSSProperties}
              >
                <div className="flex items-center justify-between mb-5">
                  <div style={{
                    width: 52, height: 52, borderRadius: 14,
                    background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(255,191,0,0.06))",
                    border: "1px solid rgba(245,158,11,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#F59E0B",
                    boxShadow: "0 0 20px rgba(245,158,11,0.08)",
                  }}>
                    <Grid3X3 size={22} />
                  </div>
                  <span style={{
                    padding: "3px 8px", borderRadius: 20,
                    background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)",
                    fontSize: 10, fontWeight: 700, color: "#F59E0B",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {PREBUILT_WORKFLOWS.length}
                  </span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>
                  Browse Templates
                </div>
                <div style={{ fontSize: 12, color: "#8898A8", lineHeight: 1.55, flex: 1 }}>
                  Fork a pre-built workflow template
                </div>
              </Link>
            </motion.div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              SECTION 02 — Your Pipeline
              ════════════════════════════════════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.5 }}
          >
            <SectionLabel number="02" title="Your Pipeline" />
          </motion.div>

          <div className="flex items-stretch gap-0 mb-16">
            {(data.missions ?? []).map((mission, i) => {
              const isCompleted = mission.status === "completed";
              const isActive = mission.status === "in_progress";
              const isLocked = mission.status === "locked";
              const color = statusColor(mission.status);
              const stepColors = ["#4F8AFF", "#8B5CF6", "#10B981", "#F59E0B"];
              const stepColor = stepColors[i] ?? "#4F8AFF";
              const stepNum = String(i + 1).padStart(2, "0");

              return (
                <React.Fragment key={mission.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.08, duration: 0.5, ease: smoothEase }}
                    style={{ flex: 1 }}
                  >
                    <Link
                      href={isLocked ? "#" : mission.href}
                      className={`block ${isActive ? "pipeline-step-active" : ""}`}
                      style={{
                        background: isActive ? "rgba(18,18,30,0.9)" : "rgba(15,18,24,0.85)",
                        backdropFilter: "blur(16px) saturate(1.2)",
                        WebkitBackdropFilter: "blur(16px) saturate(1.2)",
                        borderRadius: 16, overflow: "hidden",
                        border: isCompleted
                          ? `1px solid ${stepColor}50`
                          : isActive
                            ? `1px solid rgba(184,115,51,0.35)`
                            : "1px solid rgba(255,255,255,0.06)",
                        opacity: isLocked ? 0.4 : 1,
                        textDecoration: "none",
                        height: "100%",
                        display: "flex", flexDirection: "column" as const,
                        position: "relative" as const,
                        cursor: isLocked ? "not-allowed" : "pointer",
                        transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                      }}
                    >
                      {/* Node header gradient bar */}
                      <div
                        className="node-header"
                        style={{
                          background: `linear-gradient(135deg, ${stepColor}20, ${stepColor}08)`,
                          borderBottom: `1px solid ${stepColor}15`,
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "10px 16px",
                        }}
                      >
                        {/* Status dot */}
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: isCompleted ? "#34D399" : isActive ? "#B87333" : "#333",
                          boxShadow: isCompleted
                            ? "0 0 8px rgba(52,211,153,0.5)"
                            : isActive
                              ? "0 0 8px rgba(184,115,51,0.5)"
                              : "none",
                          animation: isActive ? "dashboard-pulse-dot 2s ease-in-out infinite" : "none",
                        }} />
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: stepColor,
                          letterSpacing: "1.5px", textTransform: "uppercase",
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}>
                          STEP {stepNum}
                        </span>
                        {isCompleted && <CheckCircle2 size={12} style={{ color: "#34D399", marginLeft: "auto" }} />}
                      </div>

                      {/* Content */}
                      <div style={{ padding: "16px 16px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
                        <div className="flex items-start gap-3 mb-3">
                          <div style={{
                            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: isCompleted
                              ? "rgba(52,211,153,0.12)"
                              : `${stepColor}12`,
                            border: `1px solid ${isCompleted ? "rgba(52,211,153,0.2)" : `${stepColor}25`}`,
                            color: isCompleted ? "#34D399" : color,
                          }}>
                            {isLocked ? <Lock size={15} /> : MISSION_ICONS[mission.icon]}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 650, color: "#E2E8F0", marginBottom: 4 }}>
                              {mission.title}
                            </div>
                            <div style={{ fontSize: 11, color: "#8898A8", lineHeight: 1.5 }}>
                              {mission.description}
                            </div>
                          </div>
                        </div>

                        {isActive && (
                          <div style={{
                            marginTop: "auto", paddingTop: 12,
                            display: "flex", alignItems: "center", gap: 6,
                            fontSize: 11, fontWeight: 600, color: "#B87333",
                            fontFamily: "var(--font-jetbrains), monospace",
                          }}>
                            Get started <ArrowRight size={12} />
                          </div>
                        )}
                      </div>

                      {/* Connection ports */}
                      {i > 0 && (
                        <div style={{
                          position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)",
                          width: 10, height: 10, borderRadius: "50%",
                          background: stepColor, border: "2px solid rgba(15,18,24,0.9)",
                          boxShadow: `0 0 8px ${stepColor}`,
                          zIndex: 2,
                        }} />
                      )}
                      {i < 3 && (
                        <div style={{
                          position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
                          width: 10, height: 10, borderRadius: "50%",
                          background: stepColor, border: "2px solid rgba(15,18,24,0.9)",
                          boxShadow: `0 0 8px ${stepColor}`,
                          zIndex: 2,
                        }} />
                      )}
                    </Link>
                  </motion.div>

                  {/* Pipeline connector between steps */}
                  {i < 3 && (
                    <PipelineConnector
                      fromColor={stepColors[i]}
                      toColor={stepColors[i + 1]}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* ════════════════════════════════════════════════════════════
              SECTION 03 — Design Templates
              ════════════════════════════════════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
          >
            <SectionLabel
              number="03"
              title="Design Templates"
              right={
                <Link href="/dashboard/templates" className="dashboard-link-hover" style={{
                  fontSize: 12, fontWeight: 600, color: "#B87333",
                  textDecoration: "none", display: "flex", alignItems: "center", gap: 4,
                  transition: "all 200ms ease",
                }}>
                  All Templates <ChevronRight size={14} />
                </Link>
              }
            />
          </motion.div>

          <div className="grid grid-cols-3 gap-5 mb-16">
            {(data.blueprints ?? []).map((bp, i) => {
              const workflow = PREBUILT_WORKFLOWS[bp.workflowIndex];
              const name = workflow?.name ?? "Template";
              const desc = workflow?.description ?? "";
              const category = workflow?.category ?? "Concept Design";
              const categoryColor = TEMPLATE_CATEGORY_COLORS[category] ?? "#3B82F6";
              const diagramNodes = (workflow?.tileGraph?.nodes ?? []).map((n: { data: { label: string; category: string } }) => ({
                label: n.data.label,
                category: n.data.category,
              }));

              return (
                <motion.div
                  key={bp.workflowIndex}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.85 + i * 0.1, duration: 0.5, ease: smoothEase }}
                >
                  <TemplateCard
                    unlocked={bp.unlocked}
                    name={name}
                    desc={desc}
                    category={category}
                    categoryColor={categoryColor}
                    diagramNodes={diagramNodes}
                  />
                </motion.div>
              );
            })}
          </div>

          {/* ════════════════════════════════════════════════════════════
              SECTION 04 — Recent Activity
              ════════════════════════════════════════════════════════════ */}
          {(data.recentWorkflows ?? []).length > 0 && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.0, duration: 0.5 }}
              >
                <SectionLabel
                  number="04"
                  title="Recent Activity"
                  right={
                    <Link href="/dashboard/workflows" className="dashboard-link-hover" style={{
                      fontSize: 12, fontWeight: 600, color: "#B87333",
                      textDecoration: "none", display: "flex", alignItems: "center", gap: 4,
                      transition: "all 200ms ease",
                    }}>
                      All Workflows <ChevronRight size={14} />
                    </Link>
                  }
                />
              </motion.div>

              <div className="grid grid-cols-3 gap-4 mb-16">
                {(data.recentWorkflows ?? []).map((wf, i) => (
                  <motion.div
                    key={wf.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.05 + i * 0.07, duration: 0.4, ease: smoothEase }}
                  >
                    <Link
                      href={`/dashboard/canvas?id=${wf.id}`}
                      className="block"
                      style={{
                        background: "rgba(15,18,24,0.85)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 16, overflow: "hidden",
                        textDecoration: "none",
                        transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                        position: "relative",
                      }}
                    >
                      {/* Node header */}
                      <div style={{
                        padding: "12px 18px",
                        background: "linear-gradient(135deg, rgba(79,138,255,0.08), rgba(99,102,241,0.04))",
                        borderBottom: "1px solid rgba(79,138,255,0.1)",
                        display: "flex", alignItems: "center", gap: 10,
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                          background: "rgba(79,138,255,0.12)",
                          border: "1px solid rgba(79,138,255,0.2)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <FileText size={14} style={{ color: "#4F8AFF" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 14, fontWeight: 600, color: "#E2E8F0",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {wf.name}
                          </div>
                          <div className="font-mono-data" style={{ fontSize: 10, color: "#556070" }}>
                            {timeAgo(wf.updatedAt)}
                          </div>
                        </div>
                      </div>

                      {/* Content */}
                      <div style={{ padding: "14px 18px 16px" }}>
                        <div className="flex items-center gap-4 mb-2">
                          <span className="font-mono-data" style={{ fontSize: 10, color: "#556070", display: "flex", alignItems: "center", gap: 4 }}>
                            <Zap size={10} style={{ color: "#B87333" }} /> {wf.nodeCount} nodes
                          </span>
                          <span className="font-mono-data" style={{ fontSize: 10, color: "#556070", display: "flex", alignItems: "center", gap: 4 }}>
                            <Play size={9} style={{ color: "#34D399" }} /> {wf.executionCount} runs
                          </span>
                        </div>

                        <SignalLine color="#4F8AFF" delay={1.1 + i * 0.1} />

                        <div style={{
                          marginTop: 12, textAlign: "center",
                          padding: "8px 0", borderRadius: 8,
                          background: "rgba(184,115,51,0.06)", border: "1px solid rgba(184,115,51,0.12)",
                          fontSize: 11, fontWeight: 600, color: "#B87333",
                          fontFamily: "var(--font-jetbrains), monospace",
                          letterSpacing: "0.04em",
                        }}>
                          Open Workflow
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              TIP CARD
              ════════════════════════════════════════════════════════════ */}
          {data.flashEvent && !data.flashEvent.completed && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2, duration: 0.5, ease: smoothEase }}
            >
              <Link
                href={data.flashEvent.href}
                className="block dashboard-tip"
                style={{
                  position: "relative",
                  borderRadius: 14,
                  border: "1px solid rgba(184,115,51,0.15)",
                  background: "linear-gradient(135deg, rgba(184,115,51,0.04) 0%, rgba(255,191,0,0.02) 100%)",
                  overflow: "hidden",
                  textDecoration: "none",
                  display: "flex", alignItems: "center", gap: 18,
                  padding: "20px 24px",
                  transition: "all 300ms cubic-bezier(0.25, 0.4, 0.25, 1)",
                }}
              >
                {/* Blueprint pattern right side */}
                <div style={{
                  position: "absolute", top: 0, right: 0, bottom: 0, width: "40%",
                  pointerEvents: "none",
                  backgroundImage: "linear-gradient(rgba(184,115,51,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(184,115,51,0.06) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
                  maskImage: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.4) 100%)",
                  WebkitMaskImage: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.4) 100%)",
                }} />

                {/* Left accent bar */}
                <div style={{
                  position: "absolute", left: 0, top: "20%", bottom: "20%", width: 3,
                  borderRadius: "0 4px 4px 0",
                  background: "linear-gradient(180deg, #B87333, #FFBF00)",
                }} />

                <div style={{
                  width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                  background: "linear-gradient(135deg, rgba(184,115,51,0.12), rgba(255,191,0,0.06))",
                  border: "1px solid rgba(184,115,51,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 16px rgba(184,115,51,0.08)",
                }}>
                  <Lightbulb size={18} style={{ color: "#B87333" }} />
                </div>

                <div style={{ flex: 1, position: "relative", zIndex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E2E8F0", marginBottom: 3 }}>
                    {data.flashEvent.title}
                  </div>
                  <div style={{ fontSize: 13, color: "#8898A8", lineHeight: 1.5 }}>
                    {data.flashEvent.description}
                  </div>
                </div>

                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "rgba(184,115,51,0.08)",
                  border: "1px solid rgba(184,115,51,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", zIndex: 1,
                }}>
                  <ArrowRight size={14} style={{ color: "#B87333" }} />
                </div>
              </Link>
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, colorRgb, delay, gauge }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  colorRgb: string;
  delay: number;
  gauge?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: smoothEase }}
      style={{
        "--card-accent": color,
        "--card-accent-rgb": colorRgb,
        position: "relative", overflow: "hidden",
        background: "rgba(15,18,24,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14, padding: "18px 22px",
        minWidth: 140,
        transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1)",
      } as React.CSSProperties}
    >
      {/* Top accent gradient line */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        opacity: 0.5, pointerEvents: "none",
      }} />

      {/* Corner glow */}
      <div style={{
        position: "absolute", top: -30, right: -30,
        width: 80, height: 80,
        background: `radial-gradient(circle, rgba(${colorRgb}, 0.12), transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div className="flex items-center justify-between mb-3">
        <div className="font-mono-data" style={{
          fontSize: 9, color: "#556070", letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
        }}>
          {label}
        </div>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: `rgba(${colorRgb}, 0.12)`, border: `1px solid rgba(${colorRgb}, 0.2)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color,
        }}>
          {icon}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <AnimNum value={value} size={32} suffix={gauge !== undefined ? "%" : ""} />
        {gauge !== undefined && <CircularGauge percentage={gauge} color={color} />}
      </div>

      <SignalLine color={color} delay={delay + 0.2} />
    </motion.div>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────
function TemplateCard({ unlocked, name, desc, category, categoryColor, diagramNodes }: {
  unlocked: boolean;
  name: string;
  desc: string;
  category: string;
  categoryColor: string;
  diagramNodes: Array<{ label: string; category: string }>;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="tmpl-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        "--port-color": categoryColor,
        position: "relative",
        background: "rgba(15,18,24,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: hovered && unlocked
          ? `1px solid ${categoryColor}40`
          : "1px solid rgba(255,255,255,0.07)",
        borderRadius: 16, overflow: "visible",
        transition: "all 350ms cubic-bezier(0.25, 0.4, 0.25, 1)",
        transform: hovered && unlocked ? "translateY(-6px)" : "translateY(0)",
        boxShadow: hovered && unlocked
          ? `0 0 40px ${categoryColor}08, 0 20px 60px rgba(0,0,0,0.3)`
          : "none",
      } as React.CSSProperties}
    >
      {/* Diagram area */}
      <div style={{
        height: 170, position: "relative", overflow: "hidden",
        borderRadius: "16px 16px 0 0",
        background: `linear-gradient(135deg, ${categoryColor}06, rgba(255,255,255,0.02))`,
      }}>
        {/* Node header gradient bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${categoryColor}, ${categoryColor}40)`,
          zIndex: 1,
        }} />

        {/* Isometric grid inside diagram */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `linear-gradient(${categoryColor}08 1px, transparent 1px), linear-gradient(90deg, ${categoryColor}08 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
          opacity: 0.5,
        }} />

        {unlocked ? (
          <MiniWorkflowDiagram nodes={diagramNodes} size="lg" />
        ) : (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(10,12,16,0.8)",
            backdropFilter: "blur(4px)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <Lock size={24} style={{ color: "#556070" }} />
            <span className="font-mono-data" style={{ fontSize: 9, color: "#556070", letterSpacing: "0.1em" }}>
              PRO TEMPLATE
            </span>
          </div>
        )}

        {/* Bottom fade */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
          background: "linear-gradient(transparent, rgba(15,18,24,0.85))",
          pointerEvents: "none",
        }} />

        {/* Category chip */}
        <div style={{
          position: "absolute", top: 12, right: 12,
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 20,
          background: "rgba(10,12,16,0.75)", backdropFilter: "blur(8px)",
          border: `1px solid ${categoryColor}25`,
          fontSize: 10, fontWeight: 600, letterSpacing: "0.02em",
          color: categoryColor, zIndex: 2,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: categoryColor,
            boxShadow: `0 0 6px ${categoryColor}60`,
          }} />
          {category}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 18px 20px" }}>
        <div style={{
          fontSize: 16, fontWeight: 700,
          color: unlocked ? "#E2E8F0" : "#556070",
          marginBottom: 6, letterSpacing: "-0.01em",
          lineHeight: 1.3,
        }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: "#8898A8", lineHeight: 1.55, marginBottom: 16 }}>
          {desc}
        </div>

        {unlocked ? (
          <Link
            href="/dashboard/workflows/new"
            className="dashboard-template-btn"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              textAlign: "center",
              padding: "10px 16px", borderRadius: 10,
              background: "linear-gradient(135deg, #B87333, #D4943D)",
              color: "#0a0c10",
              fontSize: 12, fontWeight: 700, letterSpacing: "0.03em",
              textDecoration: "none",
              fontFamily: "var(--font-jetbrains), monospace",
              transition: "all 250ms ease",
              boxShadow: "0 2px 12px rgba(184,115,51,0.2)",
            }}
          >
            Use Template <ArrowRight size={13} />
          </Link>
        ) : (
          <div style={{
            textAlign: "center", padding: "10px 16px", borderRadius: 10,
            background: "rgba(255,255,255,0.03)", color: "#556070",
            border: "1px solid rgba(255,255,255,0.06)",
            fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
            fontFamily: "var(--font-jetbrains), monospace",
            cursor: "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <Crown size={12} /> PRO
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

