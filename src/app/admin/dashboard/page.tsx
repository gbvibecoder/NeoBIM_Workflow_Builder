"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users, Zap,
  ArrowUpRight, DollarSign,
  CheckCircle2, XCircle, Clock, AlertTriangle,
  RefreshCw, Download,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────
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

interface TopNode {
  tileType: string;
  name: string;
  category: string;
  count: number;
}

interface ActivityItem {
  id: string;
  status: string;
  workflowName: string;
  userName: string;
  userImage: string | null;
  createdAt: string;
}

interface AdminStats {
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
  topNodes: TopNode[];
  recentActivity: ActivityItem[];
  mrr: number;
  feedback: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const COLORS = {
  pageBg: "#070809",
  cardBg: "rgba(18,18,30,0.6)",
  cardBlur: "blur(16px) saturate(1.3)",
  cardBorder: "rgba(255,255,255,0.06)",
  cardBorderHover: "rgba(255,255,255,0.1)",
  textPrimary: "#F0F0F5",
  textSecondary: "#9898B0",
  textMuted: "#5C5C78",
  textGhost: "#2A3040",
  cyan: "#00F5FF",
  copper: "#B87333",
  amber: "#FFBF00",
  blue: "#4F8AFF",
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
  info: "#3B82F6",
} as const;

const CARD_SHADOW = "0 4px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15)";
const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

const tooltipStyle = {
  background: "rgba(10,12,14,0.95)",
  border: "1px solid rgba(184,115,51,0.15)",
  borderRadius: 10,
  fontSize: 11,
  backdropFilter: "blur(20px)",
};

// ─── Dynamic Recharts (SSR-safe) ──────────────────────────────────────────────
const SignupAreaChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
      return {
        default: ({ data, signupsLabel }: { data: DailySignup[]; signupsLabel?: string }) => (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 4 }}>
              <defs>
                <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.cyan} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis
                dataKey="date"
                tick={{ fill: COLORS.textMuted, fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v + "T00:00:00");
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
              />
              <YAxis
                tick={{ fill: COLORS.textMuted, fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: COLORS.textPrimary, fontWeight: 600, marginBottom: 4 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [String(v), signupsLabel || "Signups"]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(label: any) => {
                  const d = new Date(String(label) + "T00:00:00");
                  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={COLORS.cyan}
                strokeWidth={2}
                fill="url(#signupGrad)"
                dot={false}
                activeDot={{ r: 4, fill: COLORS.cyan, stroke: "#070809", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ),
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 260 }} /> },
);

const ExecutionTrendChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
      return {
        default: ({ data, successLabel, failedLabel }: { data: DailyExecution[]; successLabel?: string; failedLabel?: string }) => (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 4 }}>
              <defs>
                <linearGradient id="execSuccessGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.amber} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.amber} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="execFailedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.error} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={COLORS.error} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
              <XAxis
                dataKey="date"
                tick={{ fill: COLORS.textMuted, fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v + "T00:00:00");
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
              />
              <YAxis
                tick={{ fill: COLORS.textMuted, fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: COLORS.textPrimary, fontWeight: 600, marginBottom: 4 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(label: any) => {
                  const d = new Date(String(label) + "T00:00:00");
                  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }}
              />
              <Area
                type="monotone"
                dataKey="success"
                stackId="exec"
                stroke={COLORS.amber}
                strokeWidth={1.5}
                fill="url(#execSuccessGrad)"
                name={successLabel || "Success"}
              />
              <Area
                type="monotone"
                dataKey="failed"
                stackId="exec"
                stroke={COLORS.error}
                strokeWidth={1.5}
                fill="url(#execFailedGrad)"
                name={failedLabel || "Failed"}
              />
            </AreaChart>
          </ResponsiveContainer>
        ),
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 260 }} /> },
);

// ─── Animated Counter ─────────────────────────────────────────────────────────
function CountUp({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 1200, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(parseFloat((eased * value).toFixed(decimals)));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, decimals]);

  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: 28,
        fontWeight: 700,
        color: COLORS.textPrimary,
        letterSpacing: "-0.03em",
        lineHeight: 1,
      }}
    >
      {prefix}
      {decimals === 0 ? Math.round(display).toLocaleString() : display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({
  icon,
  label,
  value,
  prefix,
  suffix,
  decimals,
  accentColor,
  subValue,
  subLabel,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  accentColor: string;
  subValue?: string;
  subLabel?: string;
  delay: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.55, ease: smoothEase }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        background: COLORS.cardBg,
        backdropFilter: COLORS.cardBlur,
        border: `1px solid ${hovered ? COLORS.cardBorderHover : COLORS.cardBorder}`,
        borderRadius: 14,
        padding: "22px 24px",
        boxShadow: CARD_SHADOW,
        transition: "border-color 0.2s ease, transform 0.2s ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      {/* Top accent gradient line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44, transparent)`,
        }}
      />
      {/* Corner glow */}
      <div
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: accentColor,
          opacity: 0.04,
          filter: "blur(25px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ color: accentColor, opacity: 0.8, flexShrink: 0 }}>{icon}</div>
        <span
          style={{
            fontSize: 9,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: "2.5px",
            fontWeight: 600,
            fontFamily: "var(--font-jetbrains), monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>

      <CountUp value={value} prefix={prefix} suffix={suffix} decimals={decimals} />

      {subValue && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
          <span
            style={{
              fontSize: 12,
              color: COLORS.textSecondary,
              fontWeight: 600,
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            {subValue}
          </span>
          {subLabel && (
            <span style={{ fontSize: 10, color: COLORS.textMuted }}>{subLabel}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({
  title,
  subtitle,
  children,
  delay,
  accentColor,
  headerRight,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  delay: number;
  accentColor?: string;
  headerRight?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: smoothEase }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        background: COLORS.cardBg,
        backdropFilter: COLORS.cardBlur,
        border: `1px solid ${hovered ? COLORS.cardBorderHover : COLORS.cardBorder}`,
        borderRadius: 14,
        padding: 24,
        boxShadow: CARD_SHADOW,
        transition: "border-color 0.2s ease",
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
            background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44, transparent)`,
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: COLORS.textPrimary,
              margin: 0,
              letterSpacing: "-0.02em",
              fontFamily: "var(--font-dm-sans), sans-serif",
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
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {headerRight}
      </div>
      {children}
    </motion.div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, t }: { status: string; t: (key: TranslationKey) => string }) {
  const config: Record<string, { bg: string; color: string; icon: React.ReactNode; label: string }> = {
    SUCCESS: {
      bg: "rgba(52,211,153,0.1)",
      color: COLORS.success,
      icon: <CheckCircle2 size={10} />,
      label: t('admin.statusSuccess'),
    },
    FAILED: {
      bg: "rgba(248,113,113,0.1)",
      color: COLORS.error,
      icon: <XCircle size={10} />,
      label: t('admin.statusFailed'),
    },
    RUNNING: {
      bg: "rgba(59,130,246,0.1)",
      color: COLORS.info,
      icon: <Clock size={10} />,
      label: t('admin.statusRunning'),
    },
    PENDING: {
      bg: "rgba(251,191,36,0.1)",
      color: COLORS.warning,
      icon: <Clock size={10} />,
      label: t('admin.statusPending'),
    },
    PARTIAL: {
      bg: "rgba(251,191,36,0.1)",
      color: COLORS.warning,
      icon: <AlertTriangle size={10} />,
      label: t('admin.statusPartial'),
    },
  };

  const c = config[status] || config.PENDING;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: c.bg,
        color: c.color,
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "var(--font-jetbrains), monospace",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

// ─── Relative time ────────────────────────────────────────────────────────────
function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// ─── Activity Row ─────────────────────────────────────────────────────────────
function ActivityRow({ item, index, t }: { item: ActivityItem; index: number; t: (key: TranslationKey) => string }) {
  const timeAgo = useMemo(() => formatTimeAgo(item.createdAt), [item.createdAt]);
  const initials = useMemo(() => {
    const parts = (item.userName || "?").split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : (parts[0][0] || "?").toUpperCase();
  }, [item.userName]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5 + index * 0.04, ease: smoothEase }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: index < 19 ? `1px solid rgba(255,255,255,0.03)` : "none",
      }}
    >
      {/* Avatar */}
      {item.userImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.userImage}
          alt=""
          width={32}
          height={32}
          style={{
            borderRadius: 8,
            background: "rgba(255,255,255,0.05)",
            flexShrink: 0,
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, rgba(0,245,255,0.12), rgba(184,115,51,0.12))",
            border: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
            color: COLORS.textSecondary,
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          {initials}
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            color: COLORS.textPrimary,
            fontWeight: 600,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.userName}
        </div>
        <div
          style={{
            fontSize: 11,
            color: COLORS.textMuted,
            lineHeight: 1.3,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.workflowName}
        </div>
      </div>

      {/* Status + time */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <StatusBadge status={item.status} t={t} />
        <span
          style={{
            fontSize: 9,
            color: COLORS.textGhost,
            fontFamily: "var(--font-jetbrains), monospace",
            whiteSpace: "nowrap",
          }}
        >
          {timeAgo}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SkeletonPulse({ width, height, borderRadius = 6 }: { width: string | number; height: number; borderRadius?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.8s ease-in-out infinite",
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 28 }}>
        <SkeletonPulse width={180} height={12} />
        <div style={{ marginTop: 10 }}>
          <SkeletonPulse width={140} height={24} />
        </div>
        <div style={{ marginTop: 8 }}>
          <SkeletonPulse width={220} height={12} />
        </div>
      </div>

      {/* KPI cards skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              background: COLORS.cardBg,
              backdropFilter: COLORS.cardBlur,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 14,
              padding: "22px 24px",
              boxShadow: CARD_SHADOW,
            }}
          >
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <SkeletonPulse width={16} height={16} borderRadius={4} />
              <SkeletonPulse width={80} height={10} />
            </div>
            <SkeletonPulse width={100} height={28} />
            <div style={{ marginTop: 14 }}>
              <SkeletonPulse width={120} height={10} />
            </div>
          </div>
        ))}
      </div>

      {/* Charts skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              background: COLORS.cardBg,
              backdropFilter: COLORS.cardBlur,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 14,
              padding: 24,
              boxShadow: CARD_SHADOW,
            }}
          >
            <SkeletonPulse width={140} height={14} />
            <div style={{ marginTop: 6 }}>
              <SkeletonPulse width={100} height={10} />
            </div>
            <div style={{ marginTop: 20 }}>
              <SkeletonPulse width="100%" height={260} borderRadius={8} />
            </div>
          </div>
        ))}
      </div>

      {/* Bottom row skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              background: COLORS.cardBg,
              backdropFilter: COLORS.cardBlur,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 14,
              padding: 24,
              boxShadow: CARD_SHADOW,
            }}
          >
            <SkeletonPulse width={160} height={14} />
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <SkeletonPulse width={32} height={32} borderRadius={8} />
                  <div style={{ flex: 1 }}>
                    <SkeletonPulse width="60%" height={12} />
                    <div style={{ marginTop: 4 }}>
                      <SkeletonPulse width="40%" height={10} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 1024px) {
          .admin-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .admin-charts-grid { grid-template-columns: 1fr !important; }
          .admin-bottom-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .admin-kpi-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Error State ──────────────────────────────────────────────────────────────
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        padding: "24px 28px 48px",
        maxWidth: 1280,
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 400,
      }}
    >
      <div
        style={{
          background: COLORS.cardBg,
          backdropFilter: COLORS.cardBlur,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 14,
          padding: "40px 48px",
          textAlign: "center",
          maxWidth: 420,
          boxShadow: CARD_SHADOW,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(248,113,113,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <XCircle size={22} style={{ color: COLORS.error }} />
        </div>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: COLORS.textPrimary,
            margin: "0 0 8px",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          Failed to load stats
        </h3>
        <p style={{ fontSize: 12, color: COLORS.textMuted, margin: "0 0 20px", lineHeight: 1.5 }}>
          {message}
        </p>
        <button
          onClick={onRetry}
          style={{
            padding: "8px 20px",
            borderRadius: 10,
            border: `1px solid ${COLORS.copper}44`,
            background: `${COLORS.copper}15`,
            color: COLORS.copper,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-jetbrains), monospace",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${COLORS.copper}25`;
            e.currentTarget.style.borderColor = `${COLORS.copper}66`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = `${COLORS.copper}15`;
            e.currentTarget.style.borderColor = `${COLORS.copper}44`;
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// ─── "X seconds ago" formatter ────────────────────────────────────────────────
function formatSecondsAgo(date: Date | null): string {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

// ─── Export download helper ──────────────────────────────────────────────────
async function downloadExport(type: "users" | "executions") {
  try {
    const res = await fetch(`/api/admin/export?type=${type}`);
    if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(`Failed to export ${type}:`, err);
  }
}

export default function AdminDashboardPage() {
  const { t } = useLocale();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshInterval] = useState(30);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("");

  const fetchStats = useCallback(async (isPolling = false) => {
    if (!isPolling) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data: AdminStats = await res.json();
      setStats(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh polling
  useEffect(() => {
    const id = setInterval(() => {
      fetchStats(true);
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [fetchStats, refreshInterval]);

  // Update the "Xs ago" label every second
  useEffect(() => {
    const id = setInterval(() => {
      setLastUpdatedLabel(formatSecondsAgo(lastUpdated));
    }, 1000);
    // set immediately
    setLastUpdatedLabel(formatSecondsAgo(lastUpdated));
    return () => clearInterval(id);
  }, [lastUpdated]);

  if (loading) return <LoadingSkeleton />;
  if (error || !stats) return <ErrorState message={error || "No data available"} onRetry={fetchStats} />;

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const totalSignupsLast30 = stats.users.dailySignups.reduce((s, d) => s + d.count, 0);
  const totalExecsLast30 = stats.executions.dailyExecutions.reduce((s, d) => s + d.total, 0);

  return (
    <div className="admin-dash-page" style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 28, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: COLORS.textPrimary,
              margin: 0,
              fontFamily: "var(--font-dm-sans), sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            {t('admin.dash.title')}
          </h1>
          <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "6px 0 0" }}>
            {dateStr}
          </p>
        </div>

        {/* Right side: live indicator, refresh, export */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {/* Live pulse + last updated */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="admin-live-pulse" style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: COLORS.success,
              boxShadow: `0 0 6px ${COLORS.success}88`,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 11,
              color: COLORS.textMuted,
              fontFamily: "var(--font-jetbrains), monospace",
              whiteSpace: "nowrap",
            }}>
              {lastUpdatedLabel ? `Updated ${lastUpdatedLabel}` : "Loading..."}
            </span>
          </div>

          {/* Manual refresh button */}
          <button
            onClick={() => fetchStats(true)}
            title="Refresh now"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${COLORS.cardBorder}`,
              background: COLORS.cardBg,
              backdropFilter: COLORS.cardBlur,
              color: COLORS.textSecondary,
              cursor: "pointer",
              transition: "all 0.15s ease",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.cardBorderHover;
              e.currentTarget.style.color = COLORS.cyan;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.cardBorder;
              e.currentTarget.style.color = COLORS.textSecondary;
            }}
          >
            <RefreshCw size={14} className={loading ? "admin-spin" : ""} />
          </button>

          {/* Export buttons */}
          <div className="admin-dash-export-btns" style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => downloadExport("users")}
              className="admin-dash-export-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.cardBorder}`,
                background: COLORS.cardBg,
                backdropFilter: COLORS.cardBlur,
                color: COLORS.textSecondary,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains), monospace",
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${COLORS.cyan}44`;
                e.currentTarget.style.color = COLORS.cyan;
                e.currentTarget.style.background = `${COLORS.cyan}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = COLORS.cardBorder;
                e.currentTarget.style.color = COLORS.textSecondary;
                e.currentTarget.style.background = COLORS.cardBg;
              }}
            >
              <Download size={12} />
              {t('admin.dash.exportUsers')}
            </button>
            <button
              onClick={() => downloadExport("executions")}
              className="admin-dash-export-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.cardBorder}`,
                background: COLORS.cardBg,
                backdropFilter: COLORS.cardBlur,
                color: COLORS.textSecondary,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains), monospace",
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${COLORS.amber}44`;
                e.currentTarget.style.color = COLORS.amber;
                e.currentTarget.style.background = `${COLORS.amber}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = COLORS.cardBorder;
                e.currentTarget.style.color = COLORS.textSecondary;
                e.currentTarget.style.background = COLORS.cardBg;
              }}
            >
              <Download size={12} />
              {t('admin.dash.exportExec')}
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div
        className="admin-kpi-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}
      >
        <KPICard
          icon={<Users size={16} />}
          label={t('admin.dash.totalUsers')}
          value={stats.users.total}
          accentColor={COLORS.cyan}
          subValue={`${stats.users.newThisMonth} new`}
          subLabel="this month"
          delay={0.05}
        />
        <KPICard
          icon={<DollarSign size={16} />}
          label={t('admin.dash.totalMrr')}
          value={stats.mrr}
          prefix="$"
          accentColor={COLORS.copper}
          subValue={`${stats.users.byRole?.PRO || 0} PRO`}
          subLabel="subscribers"
          delay={0.1}
        />
        <KPICard
          icon={<Zap size={16} />}
          label={t('admin.dash.activeWeek')}
          value={stats.users.activeThisWeek}
          accentColor={COLORS.amber}
          subValue={`${totalExecsLast30.toLocaleString()} ${t('admin.dash.last30')}`}
          delay={0.15}
        />
        <KPICard
          icon={<CheckCircle2 size={16} />}
          label={t('admin.dash.successRate')}
          value={stats.executions.successRate}
          suffix="%"
          decimals={1}
          accentColor={COLORS.success}
          subValue={`${(stats.executions.byStatus?.SUCCESS || 0).toLocaleString()} passed`}
          subLabel={`of ${stats.executions.total.toLocaleString()}`}
          delay={0.2}
        />
      </div>

      {/* ── Charts Row ───────────────────────────────────────────────────── */}
      <div
        className="admin-charts-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}
      >
        <SectionCard
          title={t('admin.dash.userGrowth')}
          subtitle={t('admin.dash.userGrowthSub')}
          delay={0.3}
          accentColor={COLORS.cyan}
          headerRight={
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <ArrowUpRight size={12} style={{ color: COLORS.success }} />
              <span
                style={{
                  fontSize: 11,
                  color: COLORS.success,
                  fontWeight: 600,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {totalSignupsLast30.toLocaleString()} {t('admin.dash.total')}
              </span>
            </div>
          }
        >
          <SignupAreaChart data={stats.users.dailySignups} signupsLabel={t('admin.dash.signups')} />
        </SectionCard>

        <SectionCard
          title={t('admin.dash.executionVolume')}
          subtitle={t('admin.dash.executionVolumeSub')}
          delay={0.35}
          accentColor={COLORS.amber}
          headerRight={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.amber, opacity: 0.7 }} />
                <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "var(--font-jetbrains), monospace" }}>
                  {t('admin.dash.success')}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.error, opacity: 0.7 }} />
                <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "var(--font-jetbrains), monospace" }}>
                  {t('admin.dash.failed')}
                </span>
              </div>
            </div>
          }
        >
          <ExecutionTrendChart data={stats.executions.dailyExecutions} successLabel={t('admin.dash.success')} failedLabel={t('admin.dash.failed')} />
        </SectionCard>
      </div>

      {/* ── Bottom Row ───────────────────────────────────────────────────── */}
      <div
        className="admin-bottom-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
      >
        {/* Recent Activity Feed */}
        <SectionCard
          title={t('admin.dash.recentActivity')}
          subtitle={t('admin.dash.recentActivitySub')}
          delay={0.4}
          accentColor={COLORS.blue}
        >
          <div
            style={{
              maxHeight: 460,
              overflowY: "auto",
              marginRight: -8,
              paddingRight: 8,
            }}
          >
            {stats.recentActivity.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  color: COLORS.textMuted,
                  fontSize: 12,
                }}
              >
                {t('admin.dash.noActivity')}
              </div>
            ) : (
              stats.recentActivity.map((item, i) => (
                <ActivityRow key={item.id} item={item} index={i} t={t} />
              ))
            )}
          </div>
        </SectionCard>

        {/* Top Node Types */}
        <SectionCard
          title={t('admin.dash.topNodes')}
          subtitle={t('admin.dash.topNodesSub')}
          delay={0.45}
          accentColor={COLORS.copper}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {stats.topNodes.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  color: COLORS.textMuted,
                  fontSize: 12,
                }}
              >
                No node usage data
              </div>
            ) : (
              stats.topNodes.map((node, i) => {
                const maxCount = stats.topNodes[0].count;
                const pct = maxCount > 0 ? (node.count / maxCount) * 100 : 0;
                const catColors: Record<string, string> = {
                  input: COLORS.cyan,
                  transform: COLORS.copper,
                  generate: COLORS.amber,
                  export: COLORS.blue,
                };
                const barColor = catColors[node.category] || COLORS.blue;

                return (
                  <div key={node.tileType}>
                    {/* Label row */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 5,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            fontSize: 9,
                            color: barColor,
                            fontWeight: 700,
                            fontFamily: "var(--font-jetbrains), monospace",
                            letterSpacing: "0.5px",
                            opacity: 0.9,
                          }}
                        >
                          {node.tileType}
                        </span>
                        <span
                          style={{
                            fontSize: 11.5,
                            color: COLORS.textSecondary,
                            fontWeight: 500,
                          }}
                        >
                          {node.name}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: COLORS.textPrimary,
                          fontWeight: 600,
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}
                      >
                        {node.count.toLocaleString()}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div
                      style={{
                        width: "100%",
                        height: 6,
                        borderRadius: 3,
                        background: "rgba(255,255,255,0.03)",
                        overflow: "hidden",
                      }}
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{
                          delay: 0.55 + i * 0.06,
                          duration: 0.7,
                          ease: smoothEase,
                        }}
                        style={{
                          height: "100%",
                          borderRadius: 3,
                          background: `linear-gradient(90deg, ${barColor}cc, ${barColor}88)`,
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>
      </div>

      {/* ── Responsive + animation keyframes ─────────────────────────────── */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes admin-pulse-glow {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px rgba(52,211,153,0.53); }
          50% { opacity: 0.5; box-shadow: 0 0 12px rgba(52,211,153,0.8); }
        }
        .admin-live-pulse {
          animation: admin-pulse-glow 2s ease-in-out infinite;
        }
        @keyframes admin-spin-anim {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .admin-spin {
          animation: admin-spin-anim 1s linear infinite;
        }
        @media (max-width: 1024px) {
          .admin-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .admin-charts-grid { grid-template-columns: 1fr !important; }
          .admin-bottom-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .admin-dash-page { padding: 16px 14px 32px !important; }
        }
        @media (max-width: 640px) {
          .admin-kpi-grid { grid-template-columns: 1fr !important; }
          .admin-dash-export-btns { width: 100% !important; }
          .admin-dash-export-btn { flex: 1 !important; justify-content: center !important; }
        }
      `}</style>
    </div>
  );
}
