"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, CheckCircle2, XCircle, Clock, Workflow, ArrowRight, Activity } from "lucide-react";
import { PageBackground } from "@/components/dashboard/PageBackground";
import { Header } from "@/components/dashboard/Header";
import { useLocale } from "@/hooks/useLocale";
import dynamic from "next/dynamic";

// ──────────────────────────────────────────────────────────────────
// Recharts (dynamic, SSR-safe)
// ──────────────────────────────────────────────────────────────────

const RechartsBarChart = dynamic(
  () => import("recharts").then(mod => {
    const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
    return {
      default: ({ data }: { data: DailyStat[] }) => (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#44445A", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,0.04)" }} />
            <YAxis tick={{ fill: "#44445A", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,0.04)" }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "rgba(12,12,22,0.95)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, fontSize: 11, backdropFilter: "blur(20px)" }} labelStyle={{ color: "#F0F0F5" }} />
            <Bar dataKey="success" name="Success" fill="#10B981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="failed" name="Failed" fill="#F87171" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ),
    };
  }),
  { ssr: false, loading: () => <div style={{ height: 220 }} /> }
);

const RechartsPieChart = dynamic(
  () => import("recharts").then(mod => {
    const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = mod;
    const COLORS = ["#4F8AFF", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"];
    return {
      default: ({ data }: { data: NodeStat[] }) => (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" outerRadius={80} innerRadius={40} dataKey="count" nameKey="name" paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "rgba(12,12,22,0.95)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, fontSize: 11 }} labelStyle={{ color: "#F0F0F5" }} />
          </PieChart>
        </ResponsiveContainer>
      ),
    };
  }),
  { ssr: false, loading: () => <div style={{ height: 220 }} /> }
);

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface DailyStat { date: string; total: number; success: number; failed: number }
interface NodeStat { name: string; count: number }
interface TopWorkflow { name: string; runs: number }
interface AnalyticsData {
  totalExecutions: number; successCount: number; failedCount: number;
  successRate: number; avgDurationMs: number;
  dailyStats: DailyStat[]; nodeStats: NodeStat[]; topWorkflows: TopWorkflow[];
}

// ──────────────────────────────────────────────────────────────────
// Animated Counter
// ──────────────────────────────────────────────────────────────────

function AnimNum({ value, suffix = "" }: { value: number; suffix?: string }) {
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
    <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: 36, fontWeight: 700, lineHeight: 1, color: "#F0F0F5", letterSpacing: "-0.04em" }}>
      {isInt ? Math.round(d) : d.toFixed(1)}{suffix}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Circular Gauge — conic gradient arc for success rate
// ──────────────────────────────────────────────────────────────────

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
        background: "rgba(12,12,22,0.9)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color,
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {Math.round(animPct)}%
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Signal Line — decorative mini waveform
// ──────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────
// KPI Card
// ──────────────────────────────────────────────────────────────────

function KPICard({ icon, label, value, suffix, color, delay, gauge }: {
  icon: React.ReactNode; label: string; value: number; suffix?: string;
  color: string; delay: number; gauge?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: "relative", overflow: "hidden",
        background: "rgba(12,12,22,0.7)", backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.05)", borderRadius: 14,
        padding: "20px 22px",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, transparent)`, opacity: 0.5 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ color, opacity: 0.7 }}>{icon}</div>
        <span style={{ fontSize: 10, color: "#55556A", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <AnimNum value={value} suffix={suffix} />
        {gauge !== undefined && <CircularGauge percentage={gauge} color={color} />}
      </div>
      <SignalLine color={color} delay={delay + 0.2} />
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Ghost Telemetry — animated empty chart state
// ──────────────────────────────────────────────────────────────────

function GhostTelemetry({ color = "#1B4FFF", label }: { color?: string; label: string }) {
  const bars = [40, 65, 30, 80, 50, 35, 60];
  return (
    <div style={{ position: "relative", height: 200 }}>
      <div style={{ height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, padding: "0 20px" }}>
        {bars.map((h, i) => (
          <motion.div key={i}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: `${h}%`, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.08, duration: 0.6, ease: "easeOut" }}
            style={{
              width: 24, borderRadius: "4px 4px 0 0",
              background: `${color}0A`, border: `1px solid ${color}18`,
              animation: "dp-breathe 4s ease-in-out infinite",
              animationDelay: `${i * 0.4}s`,
            }}
          />
        ))}
      </div>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "rgba(7,8,14,0.4)",
      }}>
        <Activity size={20} style={{ color: `${color}40`, marginBottom: 8 }} />
        <span style={{ fontSize: 11, color: "#44445A", textAlign: "center" }}>{label}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Skeleton Rows — shimmer loading for empty workflows
// ──────────────────────────────────────────────────────────────────

function SkeletonWorkflows() {
  const router = useRouter();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[1, 2, 3].map(i => (
        <motion.div key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 + i * 0.1 }}
          className="dp-skeleton"
          style={{ height: 44, borderRadius: 10 }}
        />
      ))}
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <span style={{ fontSize: 12, color: "#44445A" }}>Awaiting workflow telemetry</span>
        <br />
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => router.push('/dashboard/canvas')}
          style={{
            marginTop: 10, display: "inline-flex", alignItems: "center", gap: 5,
            padding: "8px 16px", borderRadius: 8,
            border: "1px solid rgba(79,138,255,0.25)", background: "rgba(79,138,255,0.04)",
            color: "#4F8AFF", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
          <ArrowRight size={12} /> Go to Canvas
        </motion.button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Section Card wrapper
// ──────────────────────────────────────────────────────────────────

function SectionCard({ children, delay, accentColor }: {
  children: React.ReactNode; delay: number; accentColor?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: "relative", overflow: "hidden",
        background: "rgba(12,12,22,0.6)", backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.04)", borderRadius: 16,
        padding: 24,
      }}
    >
      {accentColor && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accentColor}, transparent)`, opacity: 0.4 }} />
      )}
      {children}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user-analytics")
      .then(res => { if (!res.ok) throw new Error("Failed"); return res.json(); })
      .then(d => setData(d as AnalyticsData))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="dp-page-bg" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PageBackground />
        <Header title={t('analytics.title')} subtitle={t('analytics.subtitle')} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
          <Activity size={28} style={{ color: "#4F8AFF", animation: "dp-pulse 1.5s ease-in-out infinite" }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="dp-page-bg" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PageBackground />
        <Header title={t('analytics.title')} subtitle={t('analytics.subtitle')} />
        <div style={{ padding: 32, position: "relative", zIndex: 1 }}>
          <SectionCard delay={0}>
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <BarChart3 size={36} style={{ color: "#2A2A3A", margin: "0 auto 12px" }} />
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F5", margin: "0 0 8px" }}>
                {error ? t('analytics.loadError') : t('analytics.noData')}
              </h2>
              <p style={{ fontSize: 13, color: "#55556A", margin: 0 }}>{t('analytics.noDataDesc')}</p>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  const avgSec = parseFloat((data.avgDurationMs / 1000).toFixed(1));

  return (
    <div className="dp-page-bg" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageBackground />
      <Header title={t('analytics.title')} subtitle={t('analytics.subtitle')} />

      <main style={{ flex: 1, overflowY: "auto", padding: "28px 36px", position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
        {/* Live telemetry indicator */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 24, justifyContent: "flex-end" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 10px #10B98180", animation: "dp-pulse 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#10B981", letterSpacing: "1.5px", textTransform: "uppercase", fontFamily: "var(--font-jetbrains), monospace" }}>
            TELEMETRY ACTIVE
          </span>
        </motion.div>

        {/* KPI Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
          <KPICard icon={<Workflow size={15} />} label={t('analytics.totalRuns')} value={data.totalExecutions} color="#4F8AFF" delay={0.05} />
          <KPICard icon={<CheckCircle2 size={15} />} label={t('analytics.successRate')} value={data.successRate} suffix="%" color="#10B981" delay={0.1} gauge={data.successRate} />
          <KPICard icon={<Clock size={15} />} label={t('analytics.avgDuration')} value={avgSec} suffix="s" color="#A78BFA" delay={0.15} />
          <KPICard icon={<XCircle size={15} />} label={t('analytics.failed')} value={data.failedCount} color="#F87171" delay={0.2} />
        </div>

        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <SectionCard delay={0.3} accentColor="#4F8AFF">
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", margin: "0 0 16px", letterSpacing: "-0.01em" }}>
              {t('analytics.dailyExecutions')}
            </h3>
            {data.dailyStats.some(d => d.total > 0) ? (
              <RechartsBarChart data={data.dailyStats} />
            ) : (
              <GhostTelemetry color="#4F8AFF" label={t('analytics.noExecutions')} />
            )}
          </SectionCard>

          <SectionCard delay={0.4} accentColor="#10B981">
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", margin: "0 0 16px", letterSpacing: "-0.01em" }}>
              {t('analytics.nodeUsage')}
            </h3>
            {data.nodeStats.length > 0 ? (
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}><RechartsPieChart data={data.nodeStats} /></div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                  {data.nodeStats.map((n, i) => (
                    <div key={n.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: ["#4F8AFF", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"][i % 8], flexShrink: 0 }} />
                      <span style={{ color: "#6B6B80", flex: 1 }}>{n.name}</span>
                      <span style={{ color: "#F0F0F5", fontWeight: 600, fontFamily: "var(--font-jetbrains), monospace" }}>{n.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <GhostTelemetry color="#10B981" label={t('analytics.noNodeUsage')} />
            )}
          </SectionCard>
        </div>

        {/* Top Workflows */}
        <SectionCard delay={0.5} accentColor="#A78BFA">
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", margin: "0 0 16px", letterSpacing: "-0.01em" }}>
            {t('analytics.mostUsed')}
          </h3>
          {data.topWorkflows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.topWorkflows.map((w, i) => (
                <motion.div key={w.name}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.04 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", borderRadius: 10,
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                    transition: "all 200ms ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(79,138,255,0.04)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.1)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)"; }}
                >
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(167,139,250,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#A78BFA", fontFamily: "var(--font-jetbrains), monospace" }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: "#E0E0EA", fontWeight: 500 }}>{w.name}</span>
                  <span style={{ fontSize: 12, color: "#55556A", fontFamily: "var(--font-jetbrains), monospace" }}>{w.runs} run{w.runs !== 1 ? "s" : ""}</span>
                  <TrendingUp size={12} style={{ color: "#10B981" }} />
                </motion.div>
              ))}
            </div>
          ) : (
            <SkeletonWorkflows />
          )}
        </SectionCard>
      </main>
    </div>
  );
}
