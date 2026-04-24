"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  CircleDollarSign,
  DollarSign,
  Users,
  BarChart3,
  Calendar,
  Workflow,
  Zap,
  Info,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  X,
  ChevronLeft,
  ChevronRight,
  CreditCard,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale } from "@/hooks/useLocale";

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];
const PLAN_PRICES: Record<string, number> = { MINI: 99, STARTER: 799, PRO: 1999, TEAM_ADMIN: 4999 };

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminStats {
  users: {
    total: number;
    byRole: Record<string, number>;
    activeThisWeek: number;
    newThisMonth: number;
    dailySignups: { date: string; count: number }[];
  };
  mrr: number;
  paidByRole: Record<string, number>;
  paidTotal: number;
  executions: {
    total: number;
    successRate: number;
    byStatus: Record<string, number>;
    dailyExecutions: { date: string; total: number; success: number; failed: number }[];
  };
}

interface ProUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  stripeSubscriptionId: string | null;
  stripeCurrentPeriodEnd: string | null;
  razorpaySubscriptionId: string | null;
  paymentGateway: string | null;
  createdAt: string;
  _count: { workflows: number; executions: number };
}

interface SubscriberSummary {
  paidInFilter: number;
  mrrInFilter: number;
  byRoleInFilter: Record<string, number>;
}

interface SubscribersResponse {
  users: ProUser[];
  total: number;
  page: number;
  totalPages: number;
  summary?: SubscriberSummary;
}

type SubSortField = "createdAt" | "name" | "email" | "role" | "subEnd" | "workflows" | "executions";
type SubSortDir = "asc" | "desc";
type SubDatePreset = "ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "LAST_30" | "CUSTOM";
type SubPlanFilter = "ALL" | "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN";
type SubGatewayFilter = "ALL" | "stripe" | "razorpay";

const SUB_PAGE_SIZE = 25;

// ─── Dynamic Recharts (SSR-safe) ─────────────────────────────────────────────

const PlanBarChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } = mod;

      type PlanBar = { name: string; count: number; color: string };

      return {
        default: ({ data }: { data: PlanBar[] }) => (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
              <XAxis
                dataKey="name"
                tick={{
                  fill: "#9898B0",
                  fontSize: 10,
                  fontFamily: "var(--font-jetbrains)",
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
              />
              <YAxis
                tick={{
                  fill: "#5C5C78",
                  fontSize: 10,
                  fontFamily: "var(--font-jetbrains)",
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(10,12,14,0.95)",
                  border: "1px solid rgba(184,115,51,0.15)",
                  borderRadius: 10,
                  fontSize: 11,
                  backdropFilter: "blur(20px)",
                }}
                labelStyle={{ color: "#F0F0F5" }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [`${v} users`, "Count"]}
                cursor={{ fill: "rgba(255,255,255,0.02)" }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell key={`bar-${i}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ),
      };
    }),
  { ssr: false, loading: () => <div style={{ height: 220 }} /> }
);

// ─── Animated Counter ────────────────────────────────────────────────────────

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
    <span
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: 28,
        fontWeight: 700,
        color: "#F0F0F5",
        letterSpacing: "-0.03em",
        lineHeight: 1,
      }}
    >
      {prefix}
      {decimals === 0
        ? Math.round(display).toLocaleString()
        : display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({
  icon,
  label,
  value,
  prefix,
  suffix,
  decimals,
  color,
  subtext,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  color: string;
  subtext: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: smoothEase }}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "rgba(18,18,30,0.6)",
        backdropFilter: "blur(16px) saturate(1.3)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 14,
        padding: "20px 22px",
      }}
    >
      {/* Top accent gradient */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${color}, transparent)`,
          opacity: 0.6,
        }}
      />
      {/* Corner glow */}
      <div
        style={{
          position: "absolute",
          top: -20,
          right: -20,
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: color,
          opacity: 0.04,
          filter: "blur(20px)",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ color, opacity: 0.7 }}>{icon}</div>
        <span
          style={{
            fontSize: 9,
            color: "#9898B0",
            textTransform: "uppercase",
            letterSpacing: "1px",
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

      <CountUp
        value={value}
        prefix={prefix}
        suffix={suffix}
        decimals={decimals}
      />

      <div style={{ marginTop: 10 }}>
        <span
          style={{
            fontSize: 10,
            color: "#5C5C78",
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          {subtext}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Section Card ────────────────────────────────────────────────────────────

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
        background: "rgba(18,18,30,0.6)",
        backdropFilter: "blur(16px) saturate(1.3)",
        border: "1px solid rgba(255,255,255,0.06)",
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
            color: "#F0F0F5",
            margin: 0,
            letterSpacing: "-0.01em",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            style={{
              fontSize: 11,
              color: "#5C5C78",
              margin: "3px 0 0",
              fontFamily: "var(--font-jetbrains), monospace",
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

// ─── Plan Distribution Row ───────────────────────────────────────────────────

function PlanDistRow({
  label,
  count,
  total,
  color,
  delay,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  delay: number;
}) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4, ease: smoothEase }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
      }}
    >
      {/* Dot + label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}44`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: "#F0F0F5",
            fontWeight: 500,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {label}
        </span>
      </div>

      {/* Count */}
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#F0F0F5",
          fontFamily: "var(--font-jetbrains), monospace",
          minWidth: 40,
          textAlign: "right",
        }}
      >
        {count.toLocaleString()}
      </span>

      {/* Bar */}
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.04)",
          overflow: "hidden",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.2, duration: 0.6, ease: smoothEase }}
          style={{
            height: "100%",
            borderRadius: 3,
            background: `linear-gradient(90deg, ${color}, ${color}88)`,
          }}
        />
      </div>

      {/* Percentage */}
      <span
        style={{
          fontSize: 11,
          color: "#9898B0",
          fontFamily: "var(--font-jetbrains), monospace",
          minWidth: 44,
          textAlign: "right",
        }}
      >
        {pct}%
      </span>
    </motion.div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function SkeletonPulse({ width, height, borderRadius = 8 }: { width: string | number; height: number; borderRadius?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 28 }}>
        <SkeletonPulse width={120} height={12} />
        <div style={{ marginTop: 8 }}><SkeletonPulse width={200} height={24} /></div>
        <div style={{ marginTop: 6 }}><SkeletonPulse width={300} height={14} /></div>
      </div>

      {/* KPI grid skeleton */}
      <div
        className="billing-kpi-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              background: "rgba(18,18,30,0.6)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 14,
              padding: "20px 22px",
            }}
          >
            <SkeletonPulse width={80} height={10} />
            <div style={{ marginTop: 14 }}><SkeletonPulse width={120} height={28} /></div>
            <div style={{ marginTop: 12 }}><SkeletonPulse width={100} height={10} /></div>
          </div>
        ))}
      </div>

      {/* Plan distribution skeleton */}
      <div
        style={{
          background: "rgba(18,18,30,0.6)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <SkeletonPulse width={160} height={14} />
        <div style={{ marginTop: 20 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <SkeletonPulse width="100%" height={24} />
            </div>
          ))}
        </div>
      </div>

      {/* Table skeleton */}
      <div
        style={{
          background: "rgba(18,18,30,0.6)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          padding: 24,
        }}
      >
        <SkeletonPulse width={180} height={14} />
        <div style={{ marginTop: 20 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <SkeletonPulse width="100%" height={36} />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 1024px) {
          .billing-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 768px) {
          .billing-kpi-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value: number): string {
  return `₹${value.toLocaleString()}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
  const { t } = useLocale();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [proUsers, setProUsers] = useState<ProUser[]>([]);
  const [proTotal, setProTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Subscriber table filters / sort / pagination ───────────────────────────
  const [subSearch, setSubSearch] = useState("");
  const [subSearchDebounced, setSubSearchDebounced] = useState("");
  const [subPlan, setSubPlan] = useState<SubPlanFilter>("ALL");
  const [subPaidOnly, setSubPaidOnly] = useState(false);
  const [subGateway, setSubGateway] = useState<SubGatewayFilter>("ALL");
  const [subDatePreset, setSubDatePreset] = useState<SubDatePreset>("ALL");
  const [subCustomFrom, setSubCustomFrom] = useState<string>("");
  const [subCustomTo, setSubCustomTo] = useState<string>("");
  const [subSortField, setSubSortField] = useState<SubSortField>("createdAt");
  const [subSortDir, setSubSortDir] = useState<SubSortDir>("desc");
  const [subPage, setSubPage] = useState(1);
  const [subTotalPages, setSubTotalPages] = useState(1);
  const [subSummary, setSubSummary] = useState<SubscriberSummary | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);
  const [subRetryNonce, setSubRetryNonce] = useState(0);

  // ── Stats fetch (initial, gates the page skeleton) ─────────────────────────
  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/admin/stats");
        if (!res.ok) throw new Error(`Stats fetch failed: ${res.status}`);
        const data: AdminStats = await res.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load billing data");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  // ── Debounce search input ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSubSearchDebounced(subSearch), 300);
    return () => clearTimeout(t);
  }, [subSearch]);

  // ── Reset to page 1 whenever a filter changes ──────────────────────────────
  useEffect(() => {
    setSubPage(1);
  }, [subSearchDebounced, subPlan, subPaidOnly, subGateway, subDatePreset, subCustomFrom, subCustomTo, subSortField, subSortDir]);

  // ── Compute date range from preset + custom inputs ─────────────────────────
  const buildDateRange = useCallback((): { from: string; to: string } => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    switch (subDatePreset) {
      case "TODAY":
        return { from: today.toISOString(), to: now.toISOString() };
      case "THIS_WEEK": {
        const w = new Date(today);
        w.setDate(today.getDate() - today.getDay());
        return { from: w.toISOString(), to: now.toISOString() };
      }
      case "THIS_MONTH": {
        const m = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: m.toISOString(), to: now.toISOString() };
      }
      case "LAST_30":
        return {
          from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          to: now.toISOString(),
        };
      case "CUSTOM": {
        const from = subCustomFrom ? new Date(`${subCustomFrom}T00:00:00`).toISOString() : "";
        const to = subCustomTo ? new Date(`${subCustomTo}T23:59:59.999`).toISOString() : "";
        return { from, to };
      }
      default:
        return { from: "", to: "" };
    }
  }, [subDatePreset, subCustomFrom, subCustomTo]);

  // ── Subscribers fetch (filter-driven, re-runs on any filter change) ────────
  // Uses AbortController so rapid filter changes cancel stale requests
  // instead of racing — the latest filter always wins.
  const fetchSubscribers = useCallback(async (signal?: AbortSignal) => {
    setSubLoading(true);
    setSubError(null);
    try {
      const { from, to } = buildDateRange();
      const params = new URLSearchParams();
      if (subSearchDebounced) params.set("search", subSearchDebounced);
      if (subPlan !== "ALL") params.set("role", subPlan);
      if (subPaidOnly) params.set("paidOnly", "true");
      if (subGateway !== "ALL") params.set("gateway", subGateway);
      if (from) params.set("joinedFrom", from);
      if (to) params.set("joinedTo", to);
      params.set("sort", subSortField);
      params.set("order", subSortDir);
      params.set("page", String(subPage));
      params.set("limit", String(SUB_PAGE_SIZE));
      params.set("includeSummary", "true");

      const res = await fetch(`/api/admin/users?${params.toString()}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          res.status === 401
            ? "Your admin session expired. Please sign in again."
            : body.error || `Failed to load subscribers (${res.status})`;
        throw new Error(msg);
      }
      const data: SubscribersResponse = await res.json();
      if (signal?.aborted) return;
      setProUsers(data.users ?? []);
      setProTotal(data.total ?? 0);
      setSubTotalPages(Math.max(1, data.totalPages ?? 1));
      setSubSummary(data.summary ?? null);
      setSubLoading(false);
    } catch (err) {
      // Aborted fetches leave state alone so the newer fetch drives the UI
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (signal?.aborted) return;
      setSubError(err instanceof Error ? err.message : "Failed to load subscribers");
      setSubLoading(false);
    }
  }, [
    buildDateRange,
    subSearchDebounced,
    subPlan,
    subPaidOnly,
    subGateway,
    subSortField,
    subSortDir,
    subPage,
  ]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSubscribers(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchSubscribers, subRetryNonce]);

  // ── Sort handler: clicking same column flips direction ─────────────────────
  function handleSubSort(field: SubSortField) {
    if (subSortField === field) {
      setSubSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSubSortField(field);
      setSubSortDir(field === "name" || field === "email" ? "asc" : "desc");
    }
  }

  function clearAllSubFilters() {
    setSubSearch("");
    setSubPlan("ALL");
    setSubPaidOnly(false);
    setSubGateway("ALL");
    setSubDatePreset("ALL");
    setSubCustomFrom("");
    setSubCustomTo("");
  }

  const hasActiveSubFilters =
    !!subSearch ||
    subPlan !== "ALL" ||
    subPaidOnly ||
    subGateway !== "ALL" ||
    subDatePreset !== "ALL";

  if (loading) return <LoadingSkeleton />;

  if (error || !stats) {
    return (
      <div style={{ padding: "80px 28px", textAlign: "center" }}>
        <p style={{ color: "#F87171", fontSize: 14 }}>{error || "Failed to load data"}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            padding: "8px 20px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(18,18,30,0.6)",
            color: "#F0F0F5",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {t('admin.billing.retry')}
        </button>
      </div>
    );
  }

  const mrr = stats.mrr;
  const arr = mrr * 12;
  const totalUsers = stats.users.total;
  const paidTotal = stats.paidTotal;
  const arpu = paidTotal > 0 ? Math.round((mrr / paidTotal) * 100) / 100 : 0;
  const byRole = stats.users.byRole;

  const planRoles: { label: string; key: string; color: string }[] = [
    { label: "FREE", key: "FREE", color: "#5C5C78" },
    { label: "MINI", key: "MINI", color: "#F59E0B" },
    { label: "STARTER", key: "STARTER", color: "#10B981" },
    { label: "PRO", key: "PRO", color: "#00F5FF" },
    { label: "TEAM", key: "TEAM_ADMIN", color: "#FFBF00" },
    { label: "ADMIN", key: "PLATFORM_ADMIN", color: "#B87333" },
  ];

  const planBarData = planRoles.map((p) => ({
    name: p.label.replace("_", " "),
    count: byRole[p.key] ?? 0,
    color: p.color,
  }));

  return (
    <div className="admin-billing-page" style={{ padding: "24px 28px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 28 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#B87333",
              boxShadow: "0 0 8px rgba(184,115,51,0.4)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: 9,
              color: "#B87333",
              fontWeight: 600,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            {t('admin.billing.sectionLabel')}
          </span>
        </div>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#F0F0F5",
            margin: 0,
            fontFamily: "var(--font-dm-sans), sans-serif",
            letterSpacing: "-0.02em",
          }}
        >
          {t('admin.billing.title')}
        </h1>
        <p style={{ fontSize: 13, color: "#5C5C78", margin: "4px 0 0" }}>
          {t('admin.billing.subtitle')}
        </p>
      </motion.div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div
        className="billing-kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <KPICard
          icon={<CircleDollarSign size={15} />}
          label={t('admin.billing.mrr')}
          value={mrr}
          prefix="₹"
          color="#B87333"
          subtext={`${paidTotal} paid ${t('admin.billing.users')}`}
          delay={0.05}
        />
        <KPICard
          icon={<DollarSign size={15} />}
          label={t('admin.billing.arr')}
          value={arr}
          prefix="₹"
          color="#FFBF00"
          subtext={`${formatCurrency(mrr)} MRR × 12`}
          delay={0.1}
        />
        <KPICard
          icon={<Users size={15} />}
          label={t('admin.billing.paidUsers')}
          value={paidTotal}
          color="#00F5FF"
          subtext={`${totalUsers.toLocaleString()} ${t('admin.billing.users')}`}
          delay={0.15}
        />
        <KPICard
          icon={<BarChart3 size={15} />}
          label={t('admin.billing.arpu')}
          value={arpu}
          prefix="₹"
          decimals={2}
          color="#4F8AFF"
          subtext={`MRR / ${paidTotal.toLocaleString()} ${t('admin.billing.paidUsers')}`}
          delay={0.2}
        />
      </div>

      {/* ── Plan Distribution + Chart ─────────────────────────────────────── */}
      <div
        className="billing-dist-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* Plan Breakdown List */}
        <SectionCard
          title={t('admin.billing.planDist')}
          subtitle={`${totalUsers.toLocaleString()} ${t('admin.billing.users')}`}
          delay={0.3}
          accentColor="#00F5FF"
        >
          {planRoles.map((plan, i) => (
            <PlanDistRow
              key={plan.key}
              label={plan.label}
              count={byRole[plan.key] ?? 0}
              total={totalUsers}
              color={plan.color}
              delay={0.35 + i * 0.05}
            />
          ))}
        </SectionCard>

        {/* Bar Chart */}
        <SectionCard
          title={t('admin.billing.usersByPlan')}
          subtitle={t('admin.billing.visualBreakdown')}
          delay={0.35}
          accentColor="#FFBF00"
        >
          <PlanBarChart data={planBarData} />
        </SectionCard>
      </div>

      {/* ── Subscriber Explorer (filter / sort / paginate) ────────────────── */}
      <SectionCard
        title={t('admin.billing.allSubscribers')}
        subtitle={
          subSummary
            ? `${proTotal.toLocaleString()} match · ${subSummary.paidInFilter.toLocaleString()} paid · ${formatCurrency(subSummary.mrrInFilter)} MRR`
            : `${proTotal.toLocaleString()} ${t('admin.billing.users')}`
        }
        delay={0.5}
        accentColor="#B87333"
      >
        {/* ── Filter bar: search + plan + paid + gateway + clear ──────────── */}
        <div
          className="billing-filter-bar"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          {/* Search */}
          <div
            style={{
              position: "relative",
              flex: "1 1 220px",
              minWidth: 200,
            }}
          >
            <Search
              size={13}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#5C5C78",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
              placeholder="Search name or email..."
              style={{
                width: "100%",
                padding: "8px 30px 8px 30px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(10,12,14,0.6)",
                color: "#F0F0F5",
                fontSize: 12,
                fontFamily: "var(--font-dm-sans), sans-serif",
                outline: "none",
              }}
            />
            {subSearch && (
              <button
                type="button"
                onClick={() => setSubSearch("")}
                aria-label="Clear search"
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "#5C5C78",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Plan dropdown */}
          <select
            value={subPlan}
            onChange={(e) => setSubPlan(e.target.value as SubPlanFilter)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(10,12,14,0.6)",
              color: "#F0F0F5",
              fontSize: 12,
              fontFamily: "var(--font-jetbrains), monospace",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="ALL">All plans</option>
            <option value="FREE">FREE</option>
            <option value="MINI">MINI</option>
            <option value="STARTER">STARTER</option>
            <option value="PRO">PRO</option>
            <option value="TEAM_ADMIN">TEAM</option>
            <option value="PLATFORM_ADMIN">ADMIN</option>
          </select>

          {/* Paid only toggle */}
          <button
            type="button"
            onClick={() => setSubPaidOnly((v) => !v)}
            aria-pressed={subPaidOnly}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${subPaidOnly ? "rgba(0,245,255,0.4)" : "rgba(255,255,255,0.06)"}`,
              background: subPaidOnly ? "rgba(0,245,255,0.08)" : "rgba(10,12,14,0.6)",
              color: subPaidOnly ? "#00F5FF" : "#9898B0",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-jetbrains), monospace",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              transition: "all 0.15s ease",
            }}
          >
            <DollarSign size={12} />
            Paid only
          </button>

          {/* Gateway dropdown */}
          <select
            value={subGateway}
            onChange={(e) => setSubGateway(e.target.value as SubGatewayFilter)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(10,12,14,0.6)",
              color: "#F0F0F5",
              fontSize: 12,
              fontFamily: "var(--font-jetbrains), monospace",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="ALL">All gateways</option>
            <option value="stripe">Stripe</option>
            <option value="razorpay">Razorpay</option>
          </select>

          {hasActiveSubFilters && (
            <button
              type="button"
              onClick={clearAllSubFilters}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(248,113,113,0.2)",
                background: "rgba(248,113,113,0.06)",
                color: "#F87171",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains), monospace",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              <X size={11} />
              Clear filters
            </button>
          )}
        </div>

        {/* ── Date preset chips ───────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: "#5C5C78",
              fontWeight: 600,
              letterSpacing: "1px",
              textTransform: "uppercase",
              fontFamily: "var(--font-jetbrains), monospace",
              marginRight: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Calendar size={11} />
            Joined
          </span>
          {([
            { key: "ALL", label: "All time" },
            { key: "TODAY", label: "Today" },
            { key: "THIS_WEEK", label: "This week" },
            { key: "THIS_MONTH", label: "This month" },
            { key: "LAST_30", label: "Last 30 days" },
            { key: "CUSTOM", label: "Custom" },
          ] as const).map((p) => {
            const active = subDatePreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setSubDatePreset(p.key)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 14,
                  border: `1px solid ${active ? "rgba(184,115,51,0.4)" : "rgba(255,255,255,0.06)"}`,
                  background: active ? "rgba(184,115,51,0.12)" : "rgba(10,12,14,0.6)",
                  color: active ? "#FFBF00" : "#9898B0",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--font-jetbrains), monospace",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {p.label}
              </button>
            );
          })}
          {subDatePreset === "CUSTOM" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4, flexWrap: "wrap" }}>
              <input
                type="date"
                value={subCustomFrom}
                onChange={(e) => setSubCustomFrom(e.target.value)}
                aria-label="From date"
                style={{
                  padding: "5px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(10,12,14,0.6)",
                  color: "#F0F0F5",
                  fontSize: 11,
                  fontFamily: "var(--font-jetbrains), monospace",
                  outline: "none",
                  colorScheme: "dark",
                }}
              />
              <span style={{ color: "#5C5C78", fontSize: 11 }}>→</span>
              <input
                type="date"
                value={subCustomTo}
                onChange={(e) => setSubCustomTo(e.target.value)}
                aria-label="To date"
                style={{
                  padding: "5px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(10,12,14,0.6)",
                  color: "#F0F0F5",
                  fontSize: 11,
                  fontFamily: "var(--font-jetbrains), monospace",
                  outline: "none",
                  colorScheme: "dark",
                }}
              />
            </div>
          )}
        </div>

        {/* ── Per-plan paid breakdown for current filter ──────────────────── */}
        {subSummary && subSummary.paidInFilter > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(0,245,255,0.04)",
              border: "1px solid rgba(0,245,255,0.1)",
            }}
          >
            <span style={{
              fontSize: 9,
              color: "#5C5C78",
              fontWeight: 600,
              letterSpacing: "1px",
              textTransform: "uppercase",
              fontFamily: "var(--font-jetbrains), monospace",
              alignSelf: "center",
              marginRight: 4,
            }}>
              <CreditCard size={10} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
              Paid in filter
            </span>
            {planRoles.filter(p => (subSummary.byRoleInFilter[p.key] ?? 0) > 0).map(p => (
              <span key={p.key} style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.03)",
                fontSize: 10,
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color }} />
                <span style={{ color: "#F0F0F5", fontWeight: 600 }}>{p.label}</span>
                <span style={{ color: "#9898B0" }}>{subSummary.byRoleInFilter[p.key]}</span>
              </span>
            ))}
          </div>
        )}

        {/* ── Sortable table header ───────────────────────────────────────── */}
        <div
          className="billing-sub-header"
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 80px 1.8fr 130px 90px 90px 120px",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.02)",
            marginBottom: 4,
          }}
        >
          {([
            { key: 'name', label: t('admin.billing.name'), sort: 'name' as SubSortField },
            { key: 'plan', label: 'Plan', sort: 'role' as SubSortField },
            { key: 'email', label: t('admin.billing.email'), sort: 'email' as SubSortField },
            { key: 'sub', label: t('admin.billing.subEnd'), sort: 'subEnd' as SubSortField },
            { key: 'wf', label: t('admin.billing.workflows'), sort: 'workflows' as SubSortField },
            { key: 'exec', label: t('admin.billing.executions'), sort: 'executions' as SubSortField },
            { key: 'joined', label: t('admin.billing.joined'), sort: 'createdAt' as SubSortField },
          ]).map((h) => {
            const isActive = subSortField === h.sort;
            const Icon = isActive ? (subSortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
            return (
              <button
                key={h.key}
                type="button"
                onClick={() => handleSubSort(h.sort)}
                className={`billing-col-${h.key}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 9,
                  color: isActive ? "#F0F0F5" : "#5C5C78",
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  fontWeight: 600,
                  fontFamily: "var(--font-jetbrains), monospace",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                {h.label}
                <Icon size={10} style={{ opacity: isActive ? 1 : 0.4 }} />
              </button>
            );
          })}
        </div>

        {/* ── Table body ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", position: "relative", minHeight: 120 }}>
          {subError && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                background: "rgba(248,113,113,0.06)",
                border: "1px solid rgba(248,113,113,0.15)",
                color: "#F87171",
                fontSize: 12,
                margin: "8px 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{subError}</span>
              <button
                type="button"
                onClick={() => setSubRetryNonce(n => n + 1)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(248,113,113,0.3)",
                  background: "transparent",
                  color: "#F87171",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {!subError && proUsers.length === 0 && !subLoading && (
            <div
              style={{
                padding: "32px 12px",
                textAlign: "center",
                color: "#5C5C78",
                fontSize: 13,
              }}
            >
              {hasActiveSubFilters
                ? "No subscribers match these filters."
                : t('admin.billing.noSubscribers')}
            </div>
          )}

          {subLoading && proUsers.length === 0 && (
            <div style={{ padding: "8px 0" }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <SkeletonPulse width="100%" height={36} />
                </div>
              ))}
            </div>
          )}

          {/* Subtle dim while refetching with existing data */}
          <div style={{ opacity: subLoading && proUsers.length > 0 ? 0.5 : 1, transition: "opacity 0.15s" }}>
            {proUsers.map((user, i) => (
              <motion.div
                key={user.id}
                className="billing-sub-row"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: Math.min(0.4, i * 0.02),
                  duration: 0.25,
                  ease: smoothEase,
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 80px 1.8fr 130px 90px 90px 120px",
                  gap: 8,
                  padding: "10px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.02)",
                  alignItems: "center",
                  transition: "background 0.15s ease",
                  borderRadius: 6,
                  cursor: "default",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {/* Name */}
                <div
                  className="billing-col-name"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  {user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.image}
                      alt=""
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.06)",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "rgba(0,245,255,0.1)",
                        border: "1px solid rgba(0,245,255,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        color: "#00F5FF",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {(user.name || user.email || "?")[0]?.toUpperCase()}
                    </div>
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      color: "#F0F0F5",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontFamily: "var(--font-dm-sans), sans-serif",
                    }}
                  >
                    {user.name || t('admin.users.unnamed')}
                  </span>
                </div>

                {/* Plan Badge */}
                <span
                  className="billing-col-plan"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 6,
                    textAlign: "center",
                    fontFamily: "var(--font-jetbrains), monospace",
                    background: user.role === "PRO" ? "rgba(0,245,255,0.1)" :
                      user.role === "MINI" ? "rgba(245,158,11,0.1)" :
                      user.role === "STARTER" ? "rgba(16,185,129,0.1)" :
                      user.role === "TEAM_ADMIN" ? "rgba(255,191,0,0.1)" :
                      "rgba(92,92,120,0.1)",
                    color: user.role === "PRO" ? "#00F5FF" :
                      user.role === "MINI" ? "#F59E0B" :
                      user.role === "STARTER" ? "#10B981" :
                      user.role === "TEAM_ADMIN" ? "#FFBF00" :
                      "#5C5C78",
                  }}
                >
                  {user.role === "TEAM_ADMIN" ? "TEAM" : user.role}
                </span>

                {/* Email */}
                <span
                  className="billing-col-email"
                  style={{
                    fontSize: 11,
                    color: "#9898B0",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}
                >
                  {user.email || "--"}
                </span>

                {/* Subscription End + Gateway */}
                <div className="billing-col-sub" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Calendar size={11} style={{ color: "#5C5C78", flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: 11,
                      color: user.stripeCurrentPeriodEnd
                        ? new Date(user.stripeCurrentPeriodEnd) < new Date()
                          ? "#F87171"
                          : "#9898B0"
                        : "#5C5C78",
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}
                  >
                    {user.stripeCurrentPeriodEnd
                      ? formatDate(user.stripeCurrentPeriodEnd)
                      : "--"}
                  </span>
                  {(user.paymentGateway || user.stripeSubscriptionId || user.razorpaySubscriptionId) && (
                    <span style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: (user.paymentGateway === "razorpay" || user.razorpaySubscriptionId) ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.12)",
                      color: (user.paymentGateway === "razorpay" || user.razorpaySubscriptionId) ? "#10B981" : "#6366F1",
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}>
                      {(user.paymentGateway === "razorpay" || user.razorpaySubscriptionId) ? "RZP" : "Stripe"}
                    </span>
                  )}
                </div>

                {/* Workflows */}
                <div className="billing-col-wf" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Workflow size={11} style={{ color: "#5C5C78" }} />
                  <span
                    style={{
                      fontSize: 12,
                      color: "#F0F0F5",
                      fontWeight: 600,
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}
                  >
                    {user._count.workflows}
                  </span>
                </div>

                {/* Executions */}
                <div className="billing-col-exec" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Zap size={11} style={{ color: "#5C5C78" }} />
                  <span
                    style={{
                      fontSize: 12,
                      color: "#F0F0F5",
                      fontWeight: 600,
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}
                  >
                    {user._count.executions}
                  </span>
                </div>

                {/* Joined */}
                <span
                  className="billing-col-joined"
                  style={{
                    fontSize: 11,
                    color: "#5C5C78",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}
                >
                  {formatDate(user.createdAt)}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {proTotal > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 16,
              paddingTop: 12,
              borderTop: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <span style={{
              fontSize: 11,
              color: "#5C5C78",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              Showing {Math.min(proTotal, (subPage - 1) * SUB_PAGE_SIZE + 1)}–{Math.min(proTotal, subPage * SUB_PAGE_SIZE)} of {proTotal.toLocaleString()}
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => setSubPage(p => Math.max(1, p - 1))}
                disabled={subPage <= 1 || subLoading}
                aria-label="Previous page"
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(10,12,14,0.6)",
                  color: subPage <= 1 ? "#3a3a4a" : "#F0F0F5",
                  cursor: subPage <= 1 || subLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <span style={{
                fontSize: 11,
                color: "#9898B0",
                padding: "0 8px",
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                Page {subPage} of {subTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setSubPage(p => Math.min(subTotalPages, p + 1))}
                disabled={subPage >= subTotalPages || subLoading}
                aria-label="Next page"
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(10,12,14,0.6)",
                  color: subPage >= subTotalPages ? "#3a3a4a" : "#F0F0F5",
                  cursor: subPage >= subTotalPages || subLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Revenue Note ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.4, ease: smoothEase }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 10,
          background: "rgba(184,115,51,0.06)",
          border: "1px solid rgba(184,115,51,0.1)",
        }}
      >
        <Info size={14} style={{ color: "#B87333", flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            color: "#9898B0",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {t('admin.billing.revenueNote')}
        </span>
      </motion.div>

      {/* ── Responsive + Animations ───────────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 1024px) {
          .billing-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .billing-dist-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .admin-billing-page {
            padding: 16px 14px 32px !important;
          }
          .billing-kpi-grid { grid-template-columns: 1fr !important; }
          .billing-sub-header { display: none !important; }
          .billing-sub-row {
            display: flex !important;
            flex-wrap: wrap !important;
            padding: 14px !important;
            gap: 6px !important;
            border-bottom: 1px solid rgba(255,255,255,0.04) !important;
          }
          .billing-col-name { flex: 1 1 100% !important; font-size: 14px !important; font-weight: 600 !important; }
          .billing-col-email { flex: 1 1 100% !important; font-size: 12px !important; }
          .billing-col-sub, .billing-col-wf, .billing-col-exec { display: none !important; }
          .billing-col-joined { flex: 1 1 100% !important; }
        }
      `}</style>
    </div>
  );
}
