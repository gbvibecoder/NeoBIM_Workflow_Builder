"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Activity,
  UserPlus,
  TrendingUp,
  Bug,
  Lightbulb,
  MessageSquare,
  Zap,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale } from "@/hooks/useLocale";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DailySignup {
  date: string;
  count: number;
}

interface DailyExecution {
  date: string;
  total: number;
  success: number;
  failed: number;
}

interface StatsResponse {
  users: {
    total: number;
    byRole: Record<string, number>;
    activeThisWeek: number;
    newThisMonth: number;
    dailySignups: DailySignup[];
  };
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
  feedback: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
  mrr: number;
  topNodes: { tileType: string; name: string; category: string; count: number }[];
  recentActivity: {
    id: string;
    status: string;
    workflowName: string;
    userName: string;
    userImage: string | null;
    createdAt: string;
  }[];
}

// ─── Design Tokens ──────────────────────────────────────────────────────────

const COLORS = {
  bg: "#070809",
  card: "rgba(18,18,30,0.6)",
  cardBorder: "rgba(255,255,255,0.06)",
  cardBlur: "blur(16px) saturate(1.3)",
  textPrimary: "#F0F0F5",
  textSecondary: "#9898B0",
  textMuted: "#5C5C78",
  cyan: "#00F5FF",
  copper: "#B87333",
  amber: "#FFBF00",
  blue: "#4F8AFF",
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
  tooltipBg: "rgba(10,12,14,0.95)",
  tooltipBorder: "rgba(184,115,51,0.15)",
};

const FONTS = {
  heading: "var(--font-dm-sans), sans-serif",
  mono: "var(--font-jetbrains), monospace",
};

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

const TOOLTIP_STYLE = {
  background: COLORS.tooltipBg,
  border: `1px solid ${COLORS.tooltipBorder}`,
  borderRadius: 10,
  fontSize: 11,
  fontFamily: FONTS.mono,
  backdropFilter: "blur(20px)",
  color: COLORS.textPrimary,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ─── Dynamic Recharts: User Growth (Area) ───────────────────────────────────

const UserGrowthChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        AreaChart,
        Area,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
      } = mod;
      return {
        default: ({ data, signupsLabel }: { data: DailySignup[]; signupsLabel?: string }) => (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={data}
              margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
            >
              <defs>
                <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.cyan} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLORS.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.03)"
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{
                  fill: COLORS.textMuted,
                  fontSize: 10,
                  fontFamily: FONTS.mono,
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{
                  fill: COLORS.textMuted,
                  fontSize: 10,
                  fontFamily: FONTS.mono,
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: COLORS.textPrimary, marginBottom: 4 }}
                labelFormatter={(label) => formatDate(String(label))}
                formatter={(value) => [String(value), signupsLabel || "Signups"]}
              />
              <Area
                type="monotone"
                dataKey="count"
                name={signupsLabel || "Signups"}
                stroke={COLORS.cyan}
                strokeWidth={2}
                fill="url(#cyanGrad)"
                dot={false}
                activeDot={{ r: 4, fill: COLORS.cyan, stroke: COLORS.bg, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ),
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 280 }} /> }
);

// ─── Dynamic Recharts: Execution Trends (Composed) ──────────────────────────

const ExecutionTrendsChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        ComposedChart,
        Bar,
        Line,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
        Legend,
      } = mod;

      type ExecDayPayload = DailyExecution & { successRatePct: number };

      return {
        default: ({ data, totalExecLabel, successRateLabel }: { data: DailyExecution[]; totalExecLabel?: string; successRateLabel?: string }) => {
          const enriched: ExecDayPayload[] = data.map((d) => ({
            ...d,
            successRatePct:
              d.total > 0
                ? Math.round((d.success / d.total) * 1000) / 10
                : 0,
          }));

          const srLabel = successRateLabel || "Success Rate";
          const teLabel = totalExecLabel || "Total Executions";

          return (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={enriched}
                margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.03)"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{
                    fill: COLORS.textMuted,
                    fontSize: 10,
                    fontFamily: FONTS.mono,
                  }}
                  axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="left"
                  tick={{
                    fill: COLORS.textMuted,
                    fontSize: 10,
                    fontFamily: FONTS.mono,
                  }}
                  axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{
                    fill: COLORS.textMuted,
                    fontSize: 10,
                    fontFamily: FONTS.mono,
                  }}
                  axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: COLORS.textPrimary, marginBottom: 4 }}
                  labelFormatter={(label) => formatDate(String(label))}
                  formatter={(value, name) => {
                    if (name === srLabel) return [`${value}%`, String(name)];
                    return [String(value), String(name)];
                  }}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: 10,
                    fontFamily: FONTS.mono,
                    color: COLORS.textMuted,
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="total"
                  name={teLabel}
                  fill={COLORS.blue}
                  fillOpacity={0.5}
                  radius={[4, 4, 0, 0]}
                  barSize={14}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="successRatePct"
                  name={srLabel}
                  stroke={COLORS.success}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: COLORS.success, stroke: COLORS.bg, strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          );
        },
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 280 }} /> }
);

// ─── Dynamic Recharts: Role Distribution (Pie) ─────────────────────────────

const RoleDistributionChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = mod;

      const ROLE_COLORS: Record<string, string> = {
        FREE: COLORS.blue,
        PRO: COLORS.cyan,
        TEAM_ADMIN: COLORS.amber,
        PLATFORM_ADMIN: COLORS.copper,
      };

      return {
        default: ({
          data,
          total,
        }: {
          data: { name: string; value: number }[];
          total: number;
        }) => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              flexWrap: "wrap",
            }}
          >
            <div style={{ width: 180, height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    stroke="none"
                    paddingAngle={2}
                  >
                    {data.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={ROLE_COLORS[entry.name] || COLORS.textMuted}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value, name) => [
                      `${value} (${formatPct((Number(value) / total) * 100)})`,
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                flex: 1,
                minWidth: 180,
              }}
            >
              {data.map((entry) => {
                const pct = total > 0 ? (entry.value / total) * 100 : 0;
                const color = ROLE_COLORS[entry.name] || COLORS.textMuted;
                return (
                  <div
                    key={entry.name}
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: COLORS.textSecondary,
                        fontFamily: FONTS.mono,
                      }}
                    >
                      {entry.name}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: COLORS.textPrimary,
                        fontFamily: FONTS.mono,
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {entry.value}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color,
                        fontWeight: 600,
                        fontFamily: FONTS.mono,
                        minWidth: 48,
                        textAlign: "right",
                      }}
                    >
                      {formatPct(pct)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ),
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 180 }} /> }
);

// ─── Section Card ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  children,
  delay,
  accentColor,
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
      style={{
        position: "relative",
        overflow: "hidden",
        background: COLORS.card,
        backdropFilter: COLORS.cardBlur,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 14,
        padding: 24,
      }}
    >
      {accentColor && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, ${accentColor}, transparent)`,
            opacity: 0.5,
          }}
        />
      )}
      <div style={{ marginBottom: 18 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: COLORS.textPrimary,
            margin: 0,
            fontFamily: FONTS.heading,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            style={{
              fontSize: 11,
              color: COLORS.textMuted,
              margin: "4px 0 0",
              fontFamily: FONTS.mono,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </motion.div>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  color,
  delay,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: smoothEase }}
      style={{
        position: "relative",
        overflow: "hidden",
        background: COLORS.card,
        backdropFilter: COLORS.cardBlur,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 14,
        padding: "20px 22px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${color}, transparent)`,
          opacity: 0.5,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div style={{ color, opacity: 0.8, flexShrink: 0 }}>{icon}</div>
        <span
          style={{
            fontSize: 9,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: "1px",
            fontWeight: 600,
            fontFamily: FONTS.mono,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: COLORS.textPrimary,
          fontFamily: FONTS.heading,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </motion.div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function Skeleton({ width, height }: { width?: string | number; height: number }) {
  return (
    <div
      style={{
        width: width || "100%",
        height,
        borderRadius: 10,
        background:
          "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      {/* Header skeleton */}
      <div style={{ marginBottom: 28 }}>
        <Skeleton width={120} height={12} />
        <div style={{ height: 8 }} />
        <Skeleton width={220} height={28} />
        <div style={{ height: 6 }} />
        <Skeleton width={300} height={14} />
      </div>

      {/* KPI row skeleton */}
      <div
        className="analytics-kpi-row"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 14,
              padding: "20px 22px",
            }}
          >
            <Skeleton width={100} height={10} />
            <div style={{ height: 14 }} />
            <Skeleton width={80} height={28} />
          </div>
        ))}
      </div>

      {/* Chart skeletons */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 14,
            padding: 24,
          }}
        >
          <Skeleton width={200} height={14} />
          <div style={{ height: 16 }} />
          <Skeleton height={280} />
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 14,
            padding: 24,
          }}
        >
          <Skeleton width={180} height={14} />
          <div style={{ height: 16 }} />
          <Skeleton height={280} />
        </div>
      </div>
      <div
        className="analytics-bottom-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 14,
              padding: 24,
            }}
          >
            <Skeleton width={160} height={14} />
            <div style={{ height: 16 }} />
            <Skeleton height={180} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Feedback Card ──────────────────────────────────────────────────────────

function FeedbackCard({
  label,
  count,
  icon,
  color,
  delay,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: smoothEase }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "rgba(255,255,255,0.02)",
        borderRadius: 10,
        padding: "14px 18px",
        border: `1px solid ${COLORS.cardBorder}`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${color}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 9,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.8px",
            fontWeight: 600,
            fontFamily: FONTS.mono,
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: COLORS.textPrimary,
            fontFamily: FONTS.heading,
            lineHeight: 1,
          }}
        >
          {count}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Platform Health Metric ─────────────────────────────────────────────────

function HealthMetric({
  label,
  value,
  icon,
  color,
  delay,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4, ease: smoothEase }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 0",
        borderBottom: `1px solid ${COLORS.cardBorder}`,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${color}12`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: COLORS.textSecondary,
          fontFamily: FONTS.mono,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: COLORS.textPrimary,
          fontFamily: FONTS.heading,
        }}
      >
        {value}
      </span>
    </motion.div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminAnalyticsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingType, setExportingType] = useState<string | null>(null);

  async function downloadExport(type: string) {
    if (exportingType) return;
    setExportingType(type);
    try {
      const res = await fetch(`/api/admin/export?type=${type}`);
      if (!res.ok) throw new Error(`Export failed`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`Failed to export ${type}:`, err);
    } finally {
      setExportingType(null);
    }
  }

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/admin/stats");
        if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
        const json: StatsResponse = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div
        style={{
          padding: "80px 28px",
          textAlign: "center",
          color: COLORS.error,
          fontFamily: FONTS.mono,
          fontSize: 14,
        }}
      >
        {error || t('admin.analytics.errorLoad')}
      </div>
    );
  }

  // ── Derived Metrics ─────────────────────────────────────────────────────
  const conversionRate =
    data.users.total > 0
      ? ((data.users.byRole["PRO"] || 0) / data.users.total) * 100
      : 0;

  const avgExecsPerUser =
    data.users.total > 0 ? data.executions.total / data.users.total : 0;

  const avgWorkflowsPerUser =
    data.users.total > 0 ? data.workflows.total / data.users.total : 0;

  const roleData = Object.entries(data.users.byRole)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const bugCount = data.feedback.byType["BUG"] || 0;
  const featureCount = data.feedback.byType["FEATURE"] || 0;
  const suggestionCount = data.feedback.byType["SUGGESTION"] || 0;

  return (
    <div
      className="analytics-page"
      style={{
        padding: "24px 28px 48px",
        maxWidth: 1280,
        margin: "0 auto",
        minHeight: "100vh",
      }}
    >
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <BarChart3
              size={14}
              style={{ color: COLORS.cyan, opacity: 0.8 }}
            />
            <span
              style={{
                fontSize: 9,
                color: COLORS.cyan,
                fontWeight: 600,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                fontFamily: FONTS.mono,
              }}
            >
              {t('admin.analytics.sectionLabel')}
            </span>
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: COLORS.textPrimary,
              margin: 0,
              fontFamily: FONTS.heading,
              letterSpacing: "-0.02em",
            }}
          >
            {t('admin.analytics.title')}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: COLORS.textMuted,
              margin: "4px 0 0",
              fontFamily: FONTS.heading,
            }}
          >
            {t('admin.analytics.subtitle')}
          </p>
        </div>
        <div className="analytics-header-actions" style={{ display: "flex", gap: 8, flexShrink: 0, marginTop: 4 }}>
          <button
            onClick={() => downloadExport("users")}
            disabled={!!exportingType}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(0,245,255,0.2)",
              background: "rgba(0,245,255,0.06)",
              color: "#00F5FF",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONTS.mono,
              cursor: exportingType ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: exportingType && exportingType !== "users" ? 0.5 : 1,
              transition: "background 0.2s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!exportingType) (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,245,255,0.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,245,255,0.06)";
            }}
          >
            {exportingType === "users" ? (
              <span
                style={{
                  width: 13,
                  height: 13,
                  border: "2px solid rgba(0,245,255,0.3)",
                  borderTopColor: "#00F5FF",
                  borderRadius: "50%",
                  animation: "csvSpinner 0.6s linear infinite",
                  display: "inline-block",
                }}
              />
            ) : (
              <Download size={13} />
            )}
            {t('admin.analytics.exportUsers')}
          </button>
          <button
            onClick={() => downloadExport("executions")}
            disabled={!!exportingType}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(0,245,255,0.2)",
              background: "rgba(0,245,255,0.06)",
              color: "#00F5FF",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONTS.mono,
              cursor: exportingType ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: exportingType && exportingType !== "executions" ? 0.5 : 1,
              transition: "background 0.2s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!exportingType) (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,245,255,0.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,245,255,0.06)";
            }}
          >
            {exportingType === "executions" ? (
              <span
                style={{
                  width: 13,
                  height: 13,
                  border: "2px solid rgba(0,245,255,0.3)",
                  borderTopColor: "#00F5FF",
                  borderRadius: "50%",
                  animation: "csvSpinner 0.6s linear infinite",
                  display: "inline-block",
                }}
              />
            ) : (
              <Download size={13} />
            )}
            {t('admin.analytics.exportExec')}
          </button>
        </div>
      </motion.div>

      {/* ── KPI Row ──────────────────────────────────────────────────── */}
      <div
        className="analytics-kpi-row"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <KpiCard
          label={t('admin.analytics.totalUsers')}
          value={data.users.total.toLocaleString()}
          icon={<Users size={15} />}
          color={COLORS.cyan}
          delay={0.05}
        />
        <KpiCard
          label={t('admin.analytics.activeWeek')}
          value={data.users.activeThisWeek.toLocaleString()}
          icon={<Activity size={15} />}
          color={COLORS.amber}
          delay={0.1}
        />
        <KpiCard
          label={t('admin.analytics.newMonth')}
          value={data.users.newThisMonth.toLocaleString()}
          icon={<UserPlus size={15} />}
          color={COLORS.copper}
          delay={0.15}
        />
        <KpiCard
          label={t('admin.analytics.conversionRate')}
          value={formatPct(conversionRate)}
          icon={<TrendingUp size={15} />}
          color={COLORS.success}
          delay={0.2}
        />
      </div>

      {/* ── User Growth Chart ────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <SectionCard
          title={t('admin.analytics.userGrowth')}
          subtitle={t('admin.analytics.userGrowthSub')}
          delay={0.25}
          accentColor={COLORS.cyan}
        >
          <UserGrowthChart data={data.users.dailySignups} signupsLabel={t('admin.analytics.signups')} />
        </SectionCard>
      </div>

      {/* ── Execution Trends Chart ───────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <SectionCard
          title={t('admin.analytics.execTrends')}
          subtitle={t('admin.analytics.execTrendsSub')}
          delay={0.35}
          accentColor={COLORS.blue}
        >
          <ExecutionTrendsChart data={data.executions.dailyExecutions} totalExecLabel={t('admin.analytics.totalExecLabel')} successRateLabel={t('admin.analytics.successRateLabel')} />
        </SectionCard>
      </div>

      {/* ── Role Distribution + Feedback ─────────────────────────────── */}
      <div
        className="analytics-bottom-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* Role Distribution */}
        <SectionCard
          title={t('admin.analytics.roleDist')}
          subtitle={`${data.users.total.toLocaleString()} ${t('admin.analytics.totalUsersAcross')} ${roleData.length} ${t('admin.analytics.roles')}`}
          delay={0.4}
          accentColor={COLORS.blue}
        >
          <RoleDistributionChart data={roleData} total={data.users.total} />
        </SectionCard>

        {/* Feedback Summary */}
        <SectionCard
          title={t('admin.analytics.feedbackSummary')}
          subtitle={`${data.feedback.total} ${t('admin.analytics.totalFeedback')}`}
          delay={0.45}
          accentColor={COLORS.amber}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <FeedbackCard
              label={t('admin.analytics.bugReports')}
              count={bugCount}
              icon={<Bug size={16} />}
              color={COLORS.error}
              delay={0.5}
            />
            <FeedbackCard
              label={t('admin.analytics.featureRequests')}
              count={featureCount}
              icon={<Lightbulb size={16} />}
              color={COLORS.amber}
              delay={0.55}
            />
            <FeedbackCard
              label={t('admin.analytics.suggestions')}
              count={suggestionCount}
              icon={<MessageSquare size={16} />}
              color={COLORS.cyan}
              delay={0.6}
            />
          </div>
        </SectionCard>
      </div>

      {/* ── Platform Health ───────────────────────────────────────────── */}
      <SectionCard
        title={t('admin.analytics.platformHealth')}
        subtitle={t('admin.analytics.platformHealthSub')}
        delay={0.55}
        accentColor={COLORS.success}
      >
        <div
          className="analytics-health-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 32px",
          }}
        >
          <HealthMetric
            label={t('admin.analytics.execSuccessRate')}
            value={formatPct(data.executions.successRate)}
            icon={<CheckCircle2 size={15} />}
            color={COLORS.success}
            delay={0.6}
          />
          <HealthMetric
            label={t('admin.analytics.avgExecUser')}
            value={avgExecsPerUser.toFixed(1)}
            icon={<Zap size={15} />}
            color={COLORS.cyan}
            delay={0.65}
          />
          <HealthMetric
            label={t('admin.analytics.avgWfUser')}
            value={avgWorkflowsPerUser.toFixed(1)}
            icon={<BarChart3 size={15} />}
            color={COLORS.blue}
            delay={0.7}
          />
          <HealthMetric
            label={t('admin.analytics.totalExec')}
            value={data.executions.total.toLocaleString()}
            icon={<Activity size={15} />}
            color={COLORS.amber}
            delay={0.75}
          />
          <HealthMetric
            label={t('admin.analytics.failedExec')}
            value={(data.executions.byStatus["FAILED"] || 0).toLocaleString()}
            icon={<XCircle size={15} />}
            color={COLORS.error}
            delay={0.8}
          />
          <HealthMetric
            label={t('admin.analytics.pendingExec')}
            value={(data.executions.byStatus["PENDING"] || 0).toLocaleString()}
            icon={<Clock size={15} />}
            color={COLORS.warning}
            delay={0.85}
          />
        </div>
      </SectionCard>

      {/* ── Responsive Styles ────────────────────────────────────────── */}
      <style>{`
        @keyframes csvSpinner {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 1024px) {
          .analytics-kpi-row { grid-template-columns: repeat(2, 1fr) !important; }
          .analytics-bottom-grid { grid-template-columns: 1fr !important; }
          .analytics-health-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .analytics-page { padding: 16px 14px 32px !important; }
          .analytics-kpi-row { grid-template-columns: 1fr !important; }
          .analytics-bottom-grid { grid-template-columns: 1fr !important; }
          .analytics-health-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .analytics-header-actions { width: 100% !important; }
          .analytics-header-actions button { flex: 1 !important; justify-content: center !important; }
        }
      `}</style>
    </div>
  );
}
