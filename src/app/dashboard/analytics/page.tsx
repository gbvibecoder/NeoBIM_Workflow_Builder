"use client";

import { useEffect, useState } from "react";
import { BarChart3, TrendingUp, CheckCircle2, XCircle, Clock, Workflow } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import dynamic from "next/dynamic";

// Dynamic import recharts to avoid SSR issues
const RechartsBarChart = dynamic(
  () => import("recharts").then(mod => {
    const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
    return {
      default: ({ data }: { data: DailyStat[] }) => (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: "#5C5C78", fontSize: 10 }} />
            <YAxis tick={{ fill: "#5C5C78", fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "#F0F0F5" }}
            />
            <Bar dataKey="success" name="Success" fill="#10B981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="failed" name="Failed" fill="#EF4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ),
    };
  }),
  { ssr: false, loading: () => <div style={{ height: 220, background: "rgba(255,255,255,0.02)", borderRadius: 8 }} /> }
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
            <Tooltip
              contentStyle={{ background: "#1A1A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "#F0F0F5" }}
            />
          </PieChart>
        </ResponsiveContainer>
      ),
    };
  }),
  { ssr: false, loading: () => <div style={{ height: 220, background: "rgba(255,255,255,0.02)", borderRadius: 8 }} /> }
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface DailyStat { date: string; total: number; success: number; failed: number }
interface NodeStat { name: string; count: number }
interface TopWorkflow { name: string; runs: number }

interface AnalyticsData {
  totalExecutions: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgDurationMs: number;
  dailyStats: DailyStat[];
  nodeStats: NodeStat[];
  topWorkflows: TopWorkflow[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user-analytics")
      .then(res => {
        if (!res.ok) throw new Error("Failed to load analytics");
        return res.json();
      })
      .then(d => setData(d as AnalyticsData))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 32, color: "#7C7C96", fontSize: 13 }}>
        {t('analytics.loading')}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{
          background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 12, padding: "48px 32px", textAlign: "center",
        }}>
          <BarChart3 size={40} style={{ color: "#3A3A50", margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F5", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
            {error ? t('analytics.loadError') : t('analytics.noData')}
          </h2>
          <p style={{ fontSize: 13, color: "#7C7C96", margin: 0 }}>
            {t('analytics.noDataDesc')}
          </p>
        </div>
      </div>
    );
  }

  const avgDurationSec = (data.avgDurationMs / 1000).toFixed(1);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
          {t('analytics.title')}
        </h1>
        <p style={{ fontSize: 13, color: "#7C7C96", margin: 0 }}>
          {t('analytics.subtitle')}
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <KPICard icon={<Workflow size={16} />} label={t('analytics.totalRuns')} value={String(data.totalExecutions)} color="#4F8AFF" />
        <KPICard icon={<CheckCircle2 size={16} />} label={t('analytics.successRate')} value={`${data.successRate}%`} color="#10B981" />
        <KPICard icon={<Clock size={16} />} label={t('analytics.avgDuration')} value={`${avgDurationSec}s`} color="#8B5CF6" />
        <KPICard icon={<XCircle size={16} />} label={t('analytics.failed')} value={String(data.failedCount)} color="#EF4444" />
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Daily Executions */}
        <div style={{
          background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 12, padding: 20,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", margin: "0 0 16px", letterSpacing: "-0.01em" }}>
            {t('analytics.dailyExecutions')}
          </h3>
          {data.dailyStats.some(d => d.total > 0) ? (
            <RechartsBarChart data={data.dailyStats} />
          ) : (
            <EmptyChart text={t('analytics.noExecutions')} />
          )}
        </div>

        {/* Node Usage */}
        <div style={{
          background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 12, padding: 20,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", margin: "0 0 16px", letterSpacing: "-0.01em" }}>
            {t('analytics.nodeUsage')}
          </h3>
          {data.nodeStats.length > 0 ? (
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <RechartsPieChart data={data.nodeStats} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                {data.nodeStats.map((n, i) => (
                  <div key={n.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: ["#4F8AFF", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"][i % 8],
                      flexShrink: 0,
                    }} />
                    <span style={{ color: "#8888A0", flex: 1 }}>{n.name}</span>
                    <span style={{ color: "#F0F0F5", fontWeight: 600 }}>{n.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyChart text={t('analytics.noNodeUsage')} />
          )}
        </div>
      </div>

      {/* Top Workflows */}
      <div style={{
        background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 12, padding: 20,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", margin: "0 0 16px", letterSpacing: "-0.01em" }}>
          {t('analytics.mostUsed')}
        </h3>
        {data.topWorkflows.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.topWorkflows.map((w, i) => (
              <div key={w.name} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: "rgba(79,138,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: "#4F8AFF",
                }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontSize: 12, color: "#E0E0EA", fontWeight: 500 }}>
                  {w.name}
                </span>
                <span style={{ fontSize: 12, color: "#7C7C96" }}>
                  {w.runs} run{w.runs !== 1 ? "s" : ""}
                </span>
                <TrendingUp size={12} style={{ color: "#10B981" }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: "#7C7C96" }}>
            {t('analytics.noWorkflows')}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KPICard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{
      background: "linear-gradient(145deg, rgba(18,18,30,0.95), rgba(14,14,22,0.98))", border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 12, padding: "16px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ color }}>{icon}</div>
        <span style={{ fontSize: 11, color: "#7C7C96", textTransform: "uppercase", letterSpacing: "0.4px" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#F0F0F5", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div style={{
      height: 220, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(255,255,255,0.02)", borderRadius: 8, fontSize: 12, color: "#3A3A50",
    }}>
      {text}
    </div>
  );
}
