"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import {
  Workflow, Zap, CheckCircle, Globe,
  BarChart3, Activity, AlertTriangle, Clock, Loader2, XCircle,
} from "lucide-react";
import dynamic from "next/dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────
interface DailyExecution {
  date: string;
  total: number;
  success: number;
  failed: number;
}

interface TopNode {
  tileType: string;
  name: string;
  category: string;
  count: number;
}

interface StatsData {
  workflows: {
    total: number;
    published: number;
    templates: number;
    byComplexity: Record<string, number>;
  };
  executions: {
    total: number;
    byStatus: Record<string, number>;
    successRate: number;
    dailyExecutions: DailyExecution[];
  };
  topNodes: TopNode[];
}

// ─── Design Tokens ──────────────────────────────────────────────────────────
const COLORS = {
  bg: "#070809",
  cardBg: "rgba(18,18,30,0.6)",
  cardBorder: "rgba(255,255,255,0.06)",
  textPrimary: "#F0F0F5",
  textSecondary: "#9898B0",
  textMuted: "#5C5C78",
  cyan: "#00F5FF",
  copper: "#B87333",
  amber: "#FFBF00",
  blue: "#4F8AFF",
  success: "#34D399",
  error: "#F87171",
  warning: "#FBBF24",
};

const CATEGORY_COLORS: Record<string, string> = {
  input: "#3B82F6",
  transform: "#8B5CF6",
  generate: "#10B981",
  export: "#F59E0B",
};

const CATEGORY_LABELS: Record<string, string> = {
  input: "Input",
  transform: "Transform",
  generate: "Generate",
  export: "Export",
};

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  SUCCESS: { color: COLORS.success, icon: <CheckCircle size={14} />, label: "Success" },
  FAILED: { color: COLORS.error, icon: <XCircle size={14} />, label: "Failed" },
  PARTIAL: { color: COLORS.warning, icon: <AlertTriangle size={14} />, label: "Partial" },
  PENDING: { color: COLORS.textSecondary, icon: <Clock size={14} />, label: "Pending" },
  RUNNING: { color: COLORS.cyan, icon: <Loader2 size={14} />, label: "Running" },
};

const COMPLEXITY_CONFIG: Record<string, { color: string; label: string; description: string }> = {
  SIMPLE: { color: COLORS.success, label: "Simple", description: "1-3 nodes" },
  INTERMEDIATE: { color: COLORS.amber, label: "Intermediate", description: "4-7 nodes" },
  ADVANCED: { color: COLORS.error, label: "Advanced", description: "8+ nodes" },
};

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

const cardStyle: React.CSSProperties = {
  background: COLORS.cardBg,
  backdropFilter: "blur(16px) saturate(1.3)",
  border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: 14,
};

const monoFont = "var(--font-jetbrains), monospace";
const headingFont = "var(--font-dm-sans), sans-serif";

// ─── Dynamic Recharts (SSR-safe) ────────────────────────────────────────────
const ExecutionTrendChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } = mod;
      return {
        default: ({ data }: { data: DailyExecution[] }) => (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <defs>
                <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.success} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={COLORS.success} stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.error} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={COLORS.error} stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
                tick={{ fill: COLORS.textMuted, fontSize: 10, fontFamily: monoFont }}
                axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COLORS.textMuted, fontSize: 10, fontFamily: monoFont }}
                axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(7,8,9,0.95)",
                  border: `1px solid ${COLORS.cardBorder}`,
                  borderRadius: 10,
                  fontSize: 11,
                  fontFamily: monoFont,
                  backdropFilter: "blur(20px)",
                  color: COLORS.textPrimary,
                }}
                labelStyle={{ color: COLORS.textPrimary, fontWeight: 600, marginBottom: 4 }}
                labelFormatter={(label) => {
                  const d = new Date(String(label));
                  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }}
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
              />
              <Legend
                verticalAlign="top"
                height={32}
                formatter={(value: string) => (
                  <span style={{ color: COLORS.textSecondary, fontSize: 10, fontFamily: monoFont }}>
                    {value}
                  </span>
                )}
              />
              <Bar dataKey="success" name="Success" fill="url(#successGrad)" stackId="exec" radius={[0, 0, 0, 0]} />
              <Bar dataKey="failed" name="Failed" fill="url(#failedGrad)" stackId="exec" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ),
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 280 }} /> }
);

// ─── Animated Counter ───────────────────────────────────────────────────────
function CountUp({ value, suffix = "", decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 1200, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(parseFloat((eased * value).toFixed(decimals)));
      if (p < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(ref.current);
  }, [value, decimals]);

  return (
    <span style={{ fontFamily: monoFont, fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.03em" }}>
      {decimals === 0 ? Math.round(display).toLocaleString() : display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────────────────
function KPICard({
  icon, label, value, suffix, decimals, color, delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: smoothEase }}
      style={{
        ...cardStyle,
        position: "relative",
        overflow: "hidden",
        padding: "20px 22px",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, transparent)`, opacity: 0.5 }} />
      <div style={{ position: "absolute", top: -20, right: -20, width: 60, height: 60, borderRadius: "50%", background: color, opacity: 0.04, filter: "blur(20px)" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ color, opacity: 0.7 }}>{icon}</div>
        <span style={{
          fontSize: 9,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: "1.2px",
          fontWeight: 600,
          fontFamily: monoFont,
        }}>
          {label}
        </span>
      </div>

      <CountUp value={value} suffix={suffix} decimals={decimals} />
    </motion.div>
  );
}

// ─── Section Card ───────────────────────────────────────────────────────────
function SectionCard({
  title, subtitle, children, delay, accentColor,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  delay: number;
  accentColor?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: smoothEase }}
      style={{ ...cardStyle, position: "relative", overflow: "hidden", padding: 24 }}
    >
      {accentColor && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accentColor}, transparent)`, opacity: 0.4 }} />
      )}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, margin: 0, fontFamily: headingFont, letterSpacing: "-0.01em" }}>
          {title}
        </h3>
        {subtitle && (
          <p style={{ fontSize: 11, color: COLORS.textMuted, margin: "4px 0 0", fontFamily: monoFont }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </motion.div>
  );
}

// ─── Node Usage Row ─────────────────────────────────────────────────────────
function NodeUsageRow({ node, maxCount, index }: { node: TopNode; maxCount: number; index: number }) {
  const pct = maxCount > 0 ? (node.count / maxCount) * 100 : 0;
  const color = CATEGORY_COLORS[node.category] || COLORS.blue;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.4 + index * 0.06, duration: 0.4, ease: smoothEase }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
      }}
    >
      {/* Node Name */}
      <span style={{
        fontSize: 12,
        color: COLORS.textPrimary,
        fontWeight: 500,
        minWidth: 140,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontFamily: headingFont,
      }}>
        {node.name}
      </span>

      {/* Category Badge */}
      <span style={{
        fontSize: 9,
        color,
        fontWeight: 600,
        fontFamily: monoFont,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "3px 8px",
        borderRadius: 6,
        background: `${color}15`,
        border: `1px solid ${color}30`,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}>
        {CATEGORY_LABELS[node.category] || node.category}
      </span>

      {/* Usage Bar */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          flex: 1,
          height: 8,
          borderRadius: 4,
          background: "rgba(255,255,255,0.04)",
          overflow: "hidden",
        }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ delay: 0.5 + index * 0.07, duration: 0.7, ease: smoothEase }}
            style={{
              height: "100%",
              borderRadius: 4,
              background: `linear-gradient(90deg, ${color}, ${color}88)`,
              boxShadow: `0 0 10px ${color}33`,
            }}
          />
        </div>
      </div>

      {/* Count */}
      <span style={{
        fontSize: 12,
        color: COLORS.textPrimary,
        fontFamily: monoFont,
        fontWeight: 600,
        minWidth: 40,
        textAlign: "right",
      }}>
        {node.count.toLocaleString()}
      </span>
    </motion.div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonPulse({ width, height, borderRadius = 8 }: { width: string | number; height: number; borderRadius?: number }) {
  return (
    <motion.div
      animate={{ opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      style={{
        width,
        height,
        borderRadius,
        background: "rgba(255,255,255,0.04)",
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 28 }}>
        <SkeletonPulse width={120} height={12} borderRadius={4} />
        <div style={{ marginTop: 8 }}>
          <SkeletonPulse width={220} height={28} borderRadius={6} />
        </div>
      </div>

      {/* KPI grid skeleton */}
      <div className="wf-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...cardStyle, padding: "20px 22px" }}>
            <SkeletonPulse width={80} height={10} borderRadius={4} />
            <div style={{ marginTop: 14 }}>
              <SkeletonPulse width={100} height={28} borderRadius={6} />
            </div>
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div style={{ ...cardStyle, padding: 24, marginBottom: 20 }}>
        <SkeletonPulse width={160} height={14} borderRadius={4} />
        <div style={{ marginTop: 20 }}>
          <SkeletonPulse width="100%" height={280} />
        </div>
      </div>

      {/* Bottom row skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...cardStyle, padding: 24 }}>
          <SkeletonPulse width={140} height={14} borderRadius={4} />
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonPulse key={i} width="100%" height={32} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...cardStyle, padding: 24 }}>
            <SkeletonPulse width={160} height={14} borderRadius={4} />
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <SkeletonPulse key={i} width="100%" height={80} />
              ))}
            </div>
          </div>
          <div style={{ ...cardStyle, padding: 24 }}>
            <SkeletonPulse width={180} height={14} borderRadius={4} />
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonPulse key={i} width="100%" height={72} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function AdminWorkflowsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/admin/stats");
        if (!res.ok) throw new Error(`Failed to fetch stats (${res.status})`);
        const json = await res.json();
        setData({
          workflows: json.workflows,
          executions: json.executions,
          topNodes: json.topNodes,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div style={{
        padding: "24px 28px",
        maxWidth: 1280,
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 400,
      }}>
        <div style={{
          ...cardStyle,
          padding: "32px 40px",
          textAlign: "center",
        }}>
          <XCircle size={24} style={{ color: COLORS.error, marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: COLORS.textPrimary, margin: 0, fontFamily: headingFont }}>
            {error || "Failed to load workflow analytics"}
          </p>
          <button
            onClick={() => { setLoading(true); setError(null); window.location.reload(); }}
            style={{
              marginTop: 16,
              padding: "8px 20px",
              borderRadius: 10,
              border: `1px solid ${COLORS.cardBorder}`,
              background: "rgba(255,255,255,0.04)",
              color: COLORS.textSecondary,
              fontSize: 12,
              fontFamily: monoFont,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { workflows, executions, topNodes } = data;
  const maxNodeCount = topNodes.length > 0 ? Math.max(...topNodes.map((n) => n.count)) : 1;

  const statusEntries = Object.entries(executions.byStatus);
  const complexityEntries = Object.entries(workflows.byComplexity);

  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 28 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: COLORS.copper,
            boxShadow: `0 0 8px rgba(184,115,51,0.4)`,
          }} />
          <span style={{
            fontSize: 9,
            color: COLORS.copper,
            fontWeight: 600,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            fontFamily: monoFont,
          }}>
            Pipeline Intelligence
          </span>
        </div>
        <h1 style={{
          fontSize: 24,
          fontWeight: 700,
          color: COLORS.textPrimary,
          margin: 0,
          fontFamily: headingFont,
          letterSpacing: "-0.02em",
        }}>
          Workflow Analytics
        </h1>
        <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "4px 0 0" }}>
          Real-time execution performance, node usage, and workflow distribution
        </p>
      </motion.div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <div className="wf-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <KPICard
          icon={<Workflow size={15} />}
          label="Total Workflows"
          value={workflows.total}
          color={COLORS.blue}
          delay={0.05}
        />
        <KPICard
          icon={<Zap size={15} />}
          label="Total Executions"
          value={executions.total}
          color={COLORS.copper}
          delay={0.1}
        />
        <KPICard
          icon={<CheckCircle size={15} />}
          label="Success Rate"
          value={executions.successRate}
          suffix="%"
          decimals={1}
          color={COLORS.success}
          delay={0.15}
        />
        <KPICard
          icon={<Globe size={15} />}
          label="Published Workflows"
          value={workflows.published}
          color={COLORS.cyan}
          delay={0.2}
        />
      </div>

      {/* ── Execution Trend Chart ───────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <SectionCard
          title="Execution Trend"
          subtitle="Daily executions over the last 30 days (success vs failed, stacked)"
          delay={0.25}
          accentColor={COLORS.copper}
        >
          <ExecutionTrendChart data={executions.dailyExecutions} />
        </SectionCard>
      </div>

      {/* ── Node Usage + Right Column ───────────────────────────────── */}
      <div className="wf-mid-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {/* Node Usage Breakdown */}
        <SectionCard
          title="Node Usage Breakdown"
          subtitle="Top node types by usage count"
          delay={0.35}
          accentColor={COLORS.cyan}
        >
          {topNodes.length === 0 ? (
            <p style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: monoFont, textAlign: "center", padding: "40px 0" }}>
              No node usage data available
            </p>
          ) : (
            <>
              {topNodes.map((node, i) => (
                <NodeUsageRow key={node.tileType} node={node} maxCount={maxNodeCount} index={i} />
              ))}

              {/* Category Legend */}
              <div style={{ display: "flex", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
                {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 3, background: color, opacity: 0.8 }} />
                    <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: monoFont, textTransform: "capitalize" }}>
                      {cat}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>

        {/* Right Column: Complexity + Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Complexity Distribution */}
          <SectionCard
            title="Complexity Distribution"
            subtitle="Workflows by complexity level"
            delay={0.4}
            accentColor={COLORS.amber}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {(["SIMPLE", "INTERMEDIATE", "ADVANCED"] as const).map((level, i) => {
                const config = COMPLEXITY_CONFIG[level];
                const count = complexityEntries.find(([k]) => k === level)?.[1] ?? 0;

                return (
                  <motion.div
                    key={level}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + i * 0.08, duration: 0.4, ease: smoothEase }}
                    style={{
                      ...cardStyle,
                      padding: "16px 14px",
                      position: "relative",
                      overflow: "hidden",
                      textAlign: "center",
                    }}
                  >
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: `linear-gradient(90deg, ${config.color}, transparent)`,
                      opacity: 0.5,
                    }} />
                    <div style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: config.color,
                      fontFamily: monoFont,
                      letterSpacing: "-0.02em",
                    }}>
                      {count.toLocaleString()}
                    </div>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: COLORS.textPrimary,
                      fontFamily: monoFont,
                      textTransform: "uppercase",
                      letterSpacing: "0.8px",
                      marginTop: 6,
                    }}>
                      {config.label}
                    </div>
                    <div style={{
                      fontSize: 9,
                      color: COLORS.textMuted,
                      fontFamily: monoFont,
                      marginTop: 3,
                    }}>
                      {config.description}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </SectionCard>

          {/* Execution Status Breakdown */}
          <SectionCard
            title="Execution Status Breakdown"
            subtitle="Counts by execution status"
            delay={0.5}
            accentColor={COLORS.success}
          >
            <div className="wf-status-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {(["SUCCESS", "FAILED", "PARTIAL", "PENDING", "RUNNING"] as const).map((status, i) => {
                const config = STATUS_CONFIG[status];
                const count = statusEntries.find(([k]) => k === status)?.[1] ?? 0;

                return (
                  <motion.div
                    key={status}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 + i * 0.06, duration: 0.4, ease: smoothEase }}
                    style={{
                      ...cardStyle,
                      padding: "14px 10px",
                      textAlign: "center",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: `linear-gradient(90deg, ${config.color}, transparent)`,
                      opacity: 0.4,
                    }} />
                    <div style={{ color: config.color, opacity: 0.7, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                      {config.icon}
                    </div>
                    <div style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: COLORS.textPrimary,
                      fontFamily: monoFont,
                      letterSpacing: "-0.02em",
                    }}>
                      {count.toLocaleString()}
                    </div>
                    <div style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: COLORS.textMuted,
                      fontFamily: monoFont,
                      textTransform: "uppercase",
                      letterSpacing: "0.6px",
                      marginTop: 4,
                    }}>
                      {config.label}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Summary Footer ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5, ease: smoothEase }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 18px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.02)",
          border: `1px solid ${COLORS.cardBorder}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={13} style={{ color: COLORS.textMuted }} />
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: monoFont }}>
            {workflows.templates.toLocaleString()} templates
          </span>
          <span style={{ color: COLORS.textMuted, fontSize: 10 }}>|</span>
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: monoFont }}>
            {topNodes.length} active node types
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BarChart3 size={13} style={{ color: COLORS.textMuted }} />
          <span style={{ fontSize: 11, color: COLORS.textSecondary, fontFamily: monoFont, fontWeight: 600 }}>
            {executions.total.toLocaleString()}
          </span>
          <span style={{ fontSize: 10, color: COLORS.textMuted }}>total executions</span>
        </div>
      </motion.div>

      {/* ── Responsive Styles ─────────────────────────────────────── */}
      <style>{`
        @media (max-width: 1024px) {
          .wf-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .wf-mid-grid { grid-template-columns: 1fr !important; }
          .wf-status-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 768px) {
          .wf-kpi-grid { grid-template-columns: 1fr !important; }
          .wf-status-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
